"""ObsSet CRUD + activate endpoints."""

import asyncio
import logging
import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from nd_embedding_atlas.server._state import ViewerState

_log = logging.getLogger("ndea.obssets")


# ── Request / Response models ─────────────────────────────────────────────────


class ObsSetMemberIn(BaseModel):
    dataset_key: str
    obs_name: str


class CreateObsSetBody(BaseModel):
    name: str
    color: str | None = None
    members: list[ObsSetMemberIn]


# ── Router factory ────────────────────────────────────────────────────────────


def make_obssets_router(get_state: Callable[[], ViewerState]) -> APIRouter:
    """Return an APIRouter for ObsSet CRUD and activation."""
    router = APIRouter(prefix="/api/obssets", tags=["obssets"])
    State = Annotated[ViewerState, Depends(get_state)]

    # ── GET /api/obssets ──────────────────────────────────────────────────────

    @router.get("")
    async def list_obssets(state: State) -> JSONResponse:
        """List all ObsSets with live current_count via JOIN."""

        def _query() -> list[dict]:
            rows = state.store.con.execute("""
                SELECT
                    o.obsset_id,
                    o.name,
                    o.color,
                    o.created_at,
                    o.created_count,
                    COUNT(m.obs_name) AS current_count
                FROM obssets o
                LEFT JOIN obsset_members m USING (obsset_id)
                GROUP BY o.obsset_id, o.name, o.color, o.created_at, o.created_count
                ORDER BY o.created_at
            """).fetchall()
            cols = ["obsset_id", "name", "color", "created_at", "created_count", "current_count"]
            rows_out = []
            for row in rows:
                d = dict(zip(cols, row, strict=False))
                # created_at may be a datetime object — coerce to ISO string for JSON
                if hasattr(d.get("created_at"), "isoformat"):
                    d["created_at"] = d["created_at"].isoformat()
                rows_out.append(d)
            return rows_out

        result = await asyncio.get_running_loop().run_in_executor(state.executor, _query)
        return JSONResponse(result)

    # ── POST /api/obssets ─────────────────────────────────────────────────────

    @router.post("")
    async def create_obsset(body: CreateObsSetBody, state: State) -> JSONResponse:
        """Create a new ObsSet; write sidecar if project_config_path is set."""
        obsset_id = str(uuid.uuid4())
        created_at = datetime.now(tz=UTC).isoformat()
        created_count = len(body.members)

        def _insert() -> dict:
            con = state.store.con
            con.execute(
                "INSERT INTO obssets (obsset_id, name, color, created_at, created_count) VALUES (?, ?, ?, ?, ?)",
                [obsset_id, body.name, body.color, created_at, created_count],
            )
            if body.members:
                rows = [(obsset_id, m.dataset_key, m.obs_name) for m in body.members]
                con.executemany(
                    "INSERT OR IGNORE INTO obsset_members (obsset_id, dataset_key, obs_name) VALUES (?, ?, ?)",
                    rows,
                )
            return {
                "obsset_id": obsset_id,
                "name": body.name,
                "color": body.color,
                "created_at": created_at,
                "created_count": created_count,
                "current_count": created_count,
            }

        result = await asyncio.get_running_loop().run_in_executor(state.executor, _insert)
        _maybe_write_sidecar(state)
        return JSONResponse(result, status_code=201)

    # ── DELETE /api/obssets/{obsset_id} ───────────────────────────────────────

    @router.delete("/{obsset_id}")
    async def delete_obsset(obsset_id: str, state: State) -> JSONResponse:
        """Delete an ObsSet and all its members; write sidecar."""

        def _delete() -> bool:
            con = state.store.con
            # Explicit cascade — DuckDB does not enforce FK cascades
            con.execute("DELETE FROM obsset_members WHERE obsset_id = ?", [obsset_id])
            result = con.execute("DELETE FROM obssets WHERE obsset_id = ?", [obsset_id])
            return result.rowcount > 0 if hasattr(result, "rowcount") else True

        found = await asyncio.get_running_loop().run_in_executor(state.executor, _delete)
        if not found:
            raise HTTPException(status_code=404, detail=f"ObsSet {obsset_id!r} not found")
        _maybe_write_sidecar(state)
        return JSONResponse({"deleted": obsset_id})

    # ── POST /api/obssets/{obsset_id}/activate ────────────────────────────────

    @router.post("/{obsset_id}/activate")
    async def activate_obsset(obsset_id: str, state: State) -> JSONResponse:
        """Return a Mosaic-compatible SQL predicate for the ObsSet.

        No side-effects — callers apply the predicate via ActiveFilterStore.
        Uses (_dataset, obs_name) IN (subquery) which DuckDB >=0.8 supports.
        """

        def _check_exists() -> bool:
            row = state.store.con.execute("SELECT 1 FROM obssets WHERE obsset_id = ?", [obsset_id]).fetchone()
            return row is not None

        exists = await asyncio.get_running_loop().run_in_executor(state.executor, _check_exists)
        if not exists:
            raise HTTPException(status_code=404, detail=f"ObsSet {obsset_id!r} not found")

        # Sanitise the ID to prevent SQL injection (UUIDs are hex+dash only)
        safe_id = obsset_id.replace("'", "''")
        predicate = (
            f"(_dataset, obs_name) IN (SELECT dataset_key, obs_name FROM obsset_members WHERE obsset_id = '{safe_id}')"
        )
        return JSONResponse({"predicate": predicate})

    return router


# ── Sidecar helper ────────────────────────────────────────────────────────────


def _maybe_write_sidecar(state: ViewerState) -> None:
    """Serialize all obssets+members to sidecar JSON if project_config_path is set."""
    if state.project_config_path is None:
        return
    try:
        from nd_embedding_atlas.server._obssets_io import save_obssets, sidecar_path

        con = state.store.con
        obssets_rows = con.execute(
            "SELECT obsset_id, name, color, created_at, created_count FROM obssets ORDER BY created_at"
        ).fetchall()

        result: list[dict] = []
        for row in obssets_rows:
            oid, name, color, created_at, created_count = row
            members = con.execute(
                "SELECT dataset_key, obs_name FROM obsset_members WHERE obsset_id = ?", [oid]
            ).fetchall()
            result.append(
                {
                    "obsset_id": oid,
                    "name": name,
                    "color": color,
                    "created_at": str(created_at) if created_at is not None else None,
                    "created_count": created_count,
                    "members": [{"dataset_key": dk, "obs_name": on} for dk, on in members],
                }
            )

        path = sidecar_path(state.project_config_path)
        save_obssets(path, result)
    except Exception:  # noqa: BLE001
        _log.exception("Failed to write obsset sidecar")
