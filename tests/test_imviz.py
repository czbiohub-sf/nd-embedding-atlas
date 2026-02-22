"""Tests for the imviz OME-Zarr viewer module.

These tests cover metadata extraction, FOV table construction, multi-store
support, OME version detection, and the FastAPI server endpoints.

Test data lives on the HPC filesystem.  Tests are skipped when data is absent
(e.g. in CI without the large-file mount).
"""

from __future__ import annotations

from pathlib import Path

import pytest

# ── Test data paths ──────────────────────────────────────────────────────────

_DATA_ROOT = Path(
    "/hpc/projects/intracellular_dashboard/virtual_stain_ft_infected"
    "/2026_01_29_A549_H2B_CAAX_DAPI_DENV_ZIKV"
)
ZARR_V2 = _DATA_ROOT / "0-convert" / "convert.zarr"
ZARR_V3 = _DATA_ROOT / "0-convert_zarrv3" / "convert.zarr"

requires_data = pytest.mark.skipif(
    not ZARR_V2.exists() or not ZARR_V3.exists(),
    reason="Test data not available (HPC mount required)",
)


# ── OME version detection ───────────────────────────────────────────────────


@requires_data
def test_detect_ome_version_v2():
    from nd_embedding_atlas.imviz import detect_ome_version

    assert detect_ome_version(ZARR_V2) == "0.4"


@requires_data
def test_detect_ome_version_v3():
    from nd_embedding_atlas.imviz import detect_ome_version

    assert detect_ome_version(ZARR_V3) == "0.5"


# ── Plate metadata extraction ───────────────────────────────────────────────


@requires_data
class TestGetPlateMetadata:
    def test_returns_plate_type(self):
        from nd_embedding_atlas.imviz import get_plate_metadata

        meta = get_plate_metadata(ZARR_V2)
        assert meta["type"] == "plate"

    def test_positions_count(self):
        from nd_embedding_atlas.imviz import get_plate_metadata

        meta = get_plate_metadata(ZARR_V2)
        assert len(meta["positions"]) == 134

    def test_channel_names(self):
        from nd_embedding_atlas.imviz import get_plate_metadata

        meta = get_plate_metadata(ZARR_V2)
        assert meta["channel_names"] == ["DAPI", "TXR", "BF"]

    def test_shape_is_5d(self):
        from nd_embedding_atlas.imviz import get_plate_metadata

        meta = get_plate_metadata(ZARR_V2)
        assert len(meta["shape"]) == 5  # TCZYX

    def test_pixel_scale_present(self):
        from nd_embedding_atlas.imviz import get_plate_metadata

        meta = get_plate_metadata(ZARR_V2)
        assert "x" in meta["pixel_scale"]
        assert "y" in meta["pixel_scale"]

    def test_v3_matches_v2_positions(self):
        from nd_embedding_atlas.imviz import get_plate_metadata

        meta_v2 = get_plate_metadata(ZARR_V2)
        meta_v3 = get_plate_metadata(ZARR_V3)
        assert meta_v2["positions"] == meta_v3["positions"]

    def test_v3_matches_v2_channels(self):
        from nd_embedding_atlas.imviz import get_plate_metadata

        meta_v2 = get_plate_metadata(ZARR_V2)
        meta_v3 = get_plate_metadata(ZARR_V3)
        assert meta_v2["channel_names"] == meta_v3["channel_names"]


# ── FOV DataFrame ────────────────────────────────────────────────────────────


@requires_data
class TestGetFovDataframe:
    def test_row_count(self):
        from nd_embedding_atlas.imviz import get_fov_dataframe

        df = get_fov_dataframe(ZARR_V2)
        assert len(df) == 134

    def test_required_columns(self):
        from nd_embedding_atlas.imviz import get_fov_dataframe

        df = get_fov_dataframe(ZARR_V2)
        expected = {"__row_index__", "position", "T", "C", "Z", "Y", "X", "z_um", "y_um", "x_um"}
        assert expected.issubset(set(df.columns))

    def test_row_index_is_sequential(self):
        from nd_embedding_atlas.imviz import get_fov_dataframe

        df = get_fov_dataframe(ZARR_V2)
        assert list(df["__row_index__"]) == list(range(len(df)))

    def test_v3_matches_v2_shape(self):
        from nd_embedding_atlas.imviz import get_fov_dataframe

        df_v2 = get_fov_dataframe(ZARR_V2)
        df_v3 = get_fov_dataframe(ZARR_V3)
        assert len(df_v2) == len(df_v3)
        assert list(df_v2.columns) == list(df_v3.columns)


# ── Multi-store FOV DataFrame ───────────────────────────────────────────────


@requires_data
class TestGetMultiStoreFovDataframe:
    def test_combined_row_count(self):
        from nd_embedding_atlas.imviz import get_multi_store_fov_dataframe

        df = get_multi_store_fov_dataframe([ZARR_V2, ZARR_V3])
        assert len(df) == 268  # 134 * 2

    def test_extra_columns_present(self):
        from nd_embedding_atlas.imviz import get_multi_store_fov_dataframe

        df = get_multi_store_fov_dataframe([ZARR_V2, ZARR_V3])
        assert "dataset" in df.columns
        assert "store_index" in df.columns
        assert "ome_version" in df.columns

    def test_store_index_values(self):
        from nd_embedding_atlas.imviz import get_multi_store_fov_dataframe

        df = get_multi_store_fov_dataframe([ZARR_V2, ZARR_V3])
        assert set(df["store_index"].unique()) == {0, 1}

    def test_ome_version_values(self):
        from nd_embedding_atlas.imviz import get_multi_store_fov_dataframe

        df = get_multi_store_fov_dataframe([ZARR_V2, ZARR_V3])
        versions = df.groupby("store_index")["ome_version"].first().to_dict()
        assert versions[0] == "0.4"
        assert versions[1] == "0.5"

    def test_row_index_globally_unique(self):
        from nd_embedding_atlas.imviz import get_multi_store_fov_dataframe

        df = get_multi_store_fov_dataframe([ZARR_V2, ZARR_V3])
        assert list(df["__row_index__"]) == list(range(268))

    def test_dataset_names_disambiguated(self):
        """When stems collide, parent dir is prepended."""
        from nd_embedding_atlas.imviz import get_multi_store_fov_dataframe

        df = get_multi_store_fov_dataframe([ZARR_V2, ZARR_V3])
        names = df["dataset"].unique().tolist()
        assert len(names) == 2
        # Both are "convert.zarr" — should include parent dir
        assert names[0] != names[1]

    def test_single_store_fallback(self):
        from nd_embedding_atlas.imviz import get_multi_store_fov_dataframe

        df = get_multi_store_fov_dataframe([ZARR_V3])
        assert len(df) == 134
        assert "dataset" in df.columns
        assert df["store_index"].iloc[0] == 0


# ── FastAPI app endpoints ────────────────────────────────────────────────────


@requires_data
class TestCreateApp:
    @pytest.fixture
    def client(self):
        """Create a TestClient for the imviz app with both stores."""
        from starlette.testclient import TestClient

        from nd_embedding_atlas.imviz import create_app

        app = create_app([ZARR_V2, ZARR_V3])
        return TestClient(app)

    def test_metadata_endpoint(self, client):
        resp = client.get("/data/metadata.json")
        assert resp.status_code == 200
        data = resp.json()
        assert data["obsm"] == {}
        assert data["plate"] is True
        assert "plate_stores" in data
        assert len(data["plate_stores"]) == 2
        assert data["plate_stores"][0]["ome_version"] == "0.4"
        assert data["plate_stores"][1]["ome_version"] == "0.5"

    def test_metadata_obs_columns(self, client):
        resp = client.get("/data/metadata.json")
        data = resp.json()
        assert "dataset" in data["obs_columns"]
        assert "ome_version" in data["obs_columns"]
        assert "position" in data["obs_columns"]

    def test_parquet_endpoint(self, client):
        resp = client.get("/data/dataset.parquet")
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "application/octet-stream"
        assert len(resp.content) > 0

    def test_cell_endpoint_store_0(self, client):
        resp = client.get("/api/cell/0")
        assert resp.status_code == 200
        data = resp.json()
        assert "fov_name" in data
        assert data["store_index"] == 0
        assert "t" in data
        assert "x" in data
        assert "y" in data

    def test_cell_endpoint_store_1(self, client):
        resp = client.get("/api/cell/134")
        assert resp.status_code == 200
        data = resp.json()
        assert data["store_index"] == 1

    def test_cell_endpoint_not_found(self, client):
        resp = client.get("/api/cell/99999")
        assert resp.status_code == 404

    def test_health_endpoint(self, client):
        resp = client.get("/api/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert len(data["stores"]) == 2

    def test_embedding_stubs(self, client):
        resp = client.post("/api/embeddings/X_umap")
        assert resp.status_code == 404

        resp = client.get("/api/embeddings/X_umap/status")
        assert resp.status_code == 200
        assert resp.json()["status"] == "not_started"

    def test_mosaic_query_endpoint(self, client):
        resp = client.post("/data/query", json={"sql": "SELECT COUNT(*) FROM dataset", "type": "json"})
        assert resp.status_code == 200
        data = resp.json()
        assert data[0]["count_star()"] == 268


@requires_data
class TestCreateAppSingleStore:
    """Verify backward compatibility with a single plate path."""

    @pytest.fixture
    def client(self):
        from starlette.testclient import TestClient

        from nd_embedding_atlas.imviz import create_app

        app = create_app(ZARR_V3)
        return TestClient(app)

    def test_metadata_single_store(self, client):
        resp = client.get("/data/metadata.json")
        data = resp.json()
        assert len(data["plate_stores"]) == 1
        assert data["plate_stores"][0]["ome_version"] == "0.5"

    def test_cell_endpoint_single_store(self, client):
        resp = client.get("/api/cell/0")
        data = resp.json()
        assert data["store_index"] == 0

    def test_mosaic_count(self, client):
        resp = client.post("/data/query", json={"sql": "SELECT COUNT(*) FROM dataset", "type": "json"})
        data = resp.json()
        assert data[0]["count_star()"] == 134
