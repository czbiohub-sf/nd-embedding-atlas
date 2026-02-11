"""In-process DuckDB for serving Mosaic queries via FastAPI."""

from __future__ import annotations

import asyncio
import concurrent.futures
import json
from typing import Any, ClassVar

import duckdb
import numpy as np
import pandas as pd
import pyarrow as pa
from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse

from ome_atlas.vz._prepare import _obsm_column_prefix

# ═══════════════════════════════════════════════════════════════════════════════
# EmbeddingStore — lazy embedding management via VIEWs
# ═══════════════════════════════════════════════════════════════════════════════


class EmbeddingStore:
    """Manages DuckDB with lazy embedding loading via VIEWs.

    Creates an ``obs_base`` table from the obs DataFrame, and a ``dataset`` VIEW
    that JOINs ``obs_base`` with per-embedding tables as they are registered.

    Parameters
    ----------
    obs_df
        Obs-only DataFrame (no embedding columns).
    """

    DEFAULT_OBSM_PRIORITY: ClassVar[list[str]] = ["X_umap", "X_tsne", "X_phate", "X_pca"]

    def __init__(self, obs_df: pd.DataFrame) -> None:
        self.con = duckdb.connect(":memory:")
        self._loaded: dict[str, dict[str, Any]] = {}

        obs_df = obs_df.copy()
        obs_df["__row_index__"] = range(len(obs_df))
        _ = obs_df  # prevent GC — DuckDB scans local Python objects by name
        self.con.sql("CREATE TABLE obs_base AS (SELECT * FROM obs_df)")
        self.con.sql("CREATE VIEW dataset AS SELECT * FROM obs_base")
        self.n_obs = len(obs_df)

    def register_embedding(self, obsm_key: str, coords: np.ndarray) -> None:
        """Register a materialized embedding in DuckDB and rebuild the VIEW.

        Parameters
        ----------
        obsm_key
            Key in ``.obsm`` (e.g. ``"X_umap"``).
        coords
            2-D numpy array of shape ``(n_obs, n_dims)``.
        """
        prefix = _obsm_column_prefix(obsm_key)
        table_name = f"emb_{prefix}"
        n_dims = coords.shape[1]

        df = pd.DataFrame({"__row_index__": np.arange(coords.shape[0], dtype=np.int64)})
        for i in range(n_dims):
            df[f"{prefix}_{i}"] = np.asarray(coords[:, i], dtype=np.float32)

        _ = df  # prevent GC — DuckDB scans local Python objects by name
        self.con.sql(f"CREATE TABLE {table_name} AS (SELECT * FROM df)")
        self._loaded[obsm_key] = {"prefix": prefix, "n_dims": n_dims, "table": table_name}
        self._rebuild_view()

    def _rebuild_view(self) -> None:
        """Recreate the ``dataset`` VIEW to include all registered embeddings."""
        joins = " ".join(f"LEFT JOIN {meta['table']} USING (__row_index__)" for meta in self._loaded.values())
        self.con.sql(f"CREATE OR REPLACE VIEW dataset AS SELECT * FROM obs_base {joins}")

    @property
    def loaded_embeddings(self) -> dict[str, dict[str, Any]]:
        """Mapping of loaded obsm keys to their metadata."""
        return dict(self._loaded)

    def close(self) -> None:
        """Close the DuckDB connection."""
        self.con.close()


def mount_duckdb_endpoints(app: FastAPI, con: duckdb.DuckDBPyConnection) -> None:
    """Mount ``/data/query`` GET and POST endpoints on *app*.

    These serve the Mosaic query protocol: accept ``{"sql": ..., "type": "arrow"|"json"|"exec"}``,
    return Arrow IPC, JSON, or empty response.

    Parameters
    ----------
    app
        FastAPI app to add routes to.
    con
        DuckDB connection with the ``dataset`` table.
    """
    executor = concurrent.futures.ThreadPoolExecutor()

    # Mutations the frontend legitimately needs
    _allowed_mutations = (
        "ALTER TABLE OBS_BASE ADD COLUMN",
        "UPDATE OBS_BASE SET",
        "CREATE OR REPLACE VIEW DATASET",
        # Mosaic pre-aggregation tables
        "CREATE SCHEMA",
        "CREATE TABLE",
        "DROP TABLE IF EXISTS",
        "DROP SCHEMA",
    )
    # Everything else that mutates state is blocked
    _blocked_prefixes = (
        "DROP",
        "DELETE",
        "INSERT",
        "UPDATE",
        "CREATE",
        "ALTER",
        "COPY",
        "ATTACH",
        "DETACH",
        "EXPORT",
        "IMPORT",
    )

    def _handle_query(query: dict) -> Response:
        if "sql" not in query or "type" not in query:
            return JSONResponse({"error": "Missing 'sql' or 'type' in query payload"}, status_code=400)
        sql = query["sql"]
        command = query["type"]
        # Block destructive statements (allow specific safe mutations)
        stripped = sql.strip().upper()
        if any(stripped.startswith(p) for p in _blocked_prefixes) and not any(
            stripped.startswith(a) for a in _allowed_mutations
        ):
            return JSONResponse({"error": "Statement type not allowed"}, status_code=400)
        try:
            with con.cursor() as cursor:
                result = cursor.execute(sql)
                if command == "exec":
                    return JSONResponse({})
                if command == "arrow":
                    arrow = result.arrow()
                    sink = pa.BufferOutputStream()
                    if isinstance(arrow, pa.Table):
                        with pa.ipc.new_stream(sink, arrow.schema) as writer:
                            writer.write(arrow)
                    else:
                        # DuckDB >= 1.4 returns a RecordBatchReader
                        with pa.ipc.new_stream(sink, arrow.schema) as writer:
                            for batch in arrow:
                                writer.write_batch(batch)
                    return Response(sink.getvalue().to_pybytes(), headers={"Content-Type": "application/octet-stream"})
                if command == "json":
                    data = result.df().to_json(orient="records")
                    return Response(data, headers={"Content-Type": "application/json"})
                msg = f"Unknown command {command}"
                raise ValueError(msg)  # noqa: TRY301
        except Exception as e:  # noqa: BLE001
            return JSONResponse({"error": str(e)}, status_code=500)

    @app.get("/data/query")
    async def get_query(req: Request) -> Response:
        if "query" not in req.query_params:
            return JSONResponse({"error": "Missing 'query' parameter"}, status_code=400)
        data = json.loads(req.query_params["query"])
        return await asyncio.get_running_loop().run_in_executor(executor, lambda: _handle_query(data))

    @app.post("/data/query")
    async def post_query(req: Request) -> Response:
        body = await req.body()
        data = json.loads(body)
        return await asyncio.get_running_loop().run_in_executor(executor, lambda: _handle_query(data))
