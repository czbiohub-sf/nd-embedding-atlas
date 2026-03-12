"""Mosaic DuckDB query protocol endpoints (``/data/query``)."""

import asyncio
import json
import logging
import time
from collections.abc import Callable
from typing import TYPE_CHECKING, Annotated

from fastapi import APIRouter, Depends, FastAPI, Request, Response
from fastapi.responses import JSONResponse

if TYPE_CHECKING:
    import duckdb

from nd_embedding_atlas._server import arrow_to_ipc_bytes
from nd_embedding_atlas.server._state import ViewerState

# Mutations the frontend legitimately needs
_ALLOWED_MUTATIONS = (
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
_BLOCKED_PREFIXES = (
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

_log = logging.getLogger("ndea.query")


def _handle_query(query: dict, state: ViewerState) -> Response:
    """Execute a Mosaic query against DuckDB (runs in thread pool)."""
    if "sql" not in query or "type" not in query:
        return JSONResponse({"error": "Missing 'sql' or 'type' in query payload"}, status_code=400)

    sql = query["sql"]
    command = query["type"]
    t0 = time.perf_counter()
    _log.debug("SQL [%s]: %s", command, sql[:200])

    # Block destructive statements (allow specific safe mutations)
    stripped = sql.strip().upper()
    if any(stripped.startswith(p) for p in _BLOCKED_PREFIXES) and not any(
        stripped.startswith(a) for a in _ALLOWED_MUTATIONS
    ):
        return JSONResponse({"error": "Statement type not allowed"}, status_code=400)

    try:
        with state.store.cursor() as cursor:
            result = cursor.execute(sql)
            if command == "exec":
                return JSONResponse({})
            if command == "arrow":
                return Response(
                    arrow_to_ipc_bytes(result.arrow()),
                    headers={"Content-Type": "application/octet-stream"},
                )
            if command == "json":
                cols = [d[0] for d in result.description]
                rows = result.fetchall()
                data = json.dumps(
                    [dict(zip(cols, row, strict=False)) for row in rows],
                    default=str,
                )
                return Response(data, headers={"Content-Type": "application/json"})
            msg = f"Unknown command {command}"
            raise ValueError(msg)  # noqa: TRY301
    except Exception as e:  # noqa: BLE001
        return JSONResponse({"error": str(e)}, status_code=500)
    finally:
        elapsed = (time.perf_counter() - t0) * 1000
        if elapsed > 100:
            _log.warning("SLOW [%s] %.0fms: %s", command, elapsed, sql[:300])


def mount_duckdb_endpoints(app: FastAPI, con: "duckdb.DuckDBPyConnection") -> None:
    """Mount ``/data/query`` endpoints using a raw DuckDB connection.

    Compatibility shim for modules (e.g. ``ndimg``) that manage their own
    DuckDB connection without an :class:`EmbeddingStore`.
    """
    import concurrent.futures

    executor = concurrent.futures.ThreadPoolExecutor(thread_name_prefix="ndea-mosaic")

    def _handle(query: dict) -> Response:
        if "sql" not in query or "type" not in query:
            return JSONResponse({"error": "Missing 'sql' or 'type' in query payload"}, status_code=400)
        sql = query["sql"]
        command = query["type"]
        stripped = sql.strip().upper()
        if any(stripped.startswith(p) for p in _BLOCKED_PREFIXES) and not any(
            stripped.startswith(a) for a in _ALLOWED_MUTATIONS
        ):
            return JSONResponse({"error": "Statement type not allowed"}, status_code=400)
        try:
            with con.cursor() as cursor:
                result = cursor.execute(sql)
                if command == "exec":
                    return JSONResponse({})
                if command == "arrow":
                    return Response(
                        arrow_to_ipc_bytes(result.arrow()),
                        headers={"Content-Type": "application/octet-stream"},
                    )
                if command == "json":
                    cols = [d[0] for d in result.description]
                    rows = result.fetchall()
                    data = json.dumps(
                        [dict(zip(cols, row, strict=False)) for row in rows],
                        default=str,
                    )
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
        return await asyncio.get_running_loop().run_in_executor(executor, lambda: _handle(data))

    @app.post("/data/query")
    async def post_query(req: Request) -> Response:
        body = await req.body()
        data = json.loads(body)
        return await asyncio.get_running_loop().run_in_executor(executor, lambda: _handle(data))


def make_mosaic_router(get_state: Callable[[], ViewerState]) -> APIRouter:
    """Return an APIRouter for the Mosaic query protocol."""
    router = APIRouter()
    State = Annotated[ViewerState, Depends(get_state)]

    @router.get("/data/query")
    async def get_query(req: Request, state: State) -> Response:
        if "query" not in req.query_params:
            return JSONResponse({"error": "Missing 'query' parameter"}, status_code=400)
        data = json.loads(req.query_params["query"])
        return await asyncio.get_running_loop().run_in_executor(state.executor, lambda: _handle_query(data, state))

    @router.post("/data/query")
    async def post_query(req: Request, state: State) -> Response:
        body = await req.body()
        data = json.loads(body)
        return await asyncio.get_running_loop().run_in_executor(state.executor, lambda: _handle_query(data, state))

    return router
