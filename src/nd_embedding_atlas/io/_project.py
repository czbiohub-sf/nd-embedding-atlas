"""Project configuration model for multi-dataset YAML files."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator


class DatasetSpec(BaseModel):
    """A single dataset entry in a project YAML config."""

    model_config = ConfigDict(populate_by_name=True)

    anndata: Path
    ome_zarr: Path | None = Field(None, alias="ome-zarr")

    @field_validator("anndata", "ome_zarr", mode="before")
    @classmethod
    def path_must_exist(cls, v: Any) -> Any:
        """Validate that the path exists (file or directory)."""
        if v is None:
            return v
        p = Path(v)
        if not p.exists():
            msg = f"Path does not exist: {p}"
            raise ValueError(msg)
        return p


class ProjectConfig(BaseModel):
    """Top-level project configuration from a multi-dataset YAML file."""

    datasets: dict[str, DatasetSpec]

    @field_validator("datasets")
    @classmethod
    def at_least_one(cls, v: dict) -> dict:
        if not v:
            msg = "At least one dataset entry is required"
            raise ValueError(msg)
        return v


def load_project(path: Path) -> ProjectConfig:
    """Load and validate a project YAML file.

    Paths in the YAML may be absolute or relative to the YAML file location.

    Parameters
    ----------
    path
        Path to the YAML file defining the project datasets.

    Returns
    -------
    Validated ProjectConfig instance.
    """
    import yaml

    base_dir = path.parent
    with path.open() as f:
        raw = yaml.safe_load(f)

    # Resolve relative paths relative to the YAML file's parent directory
    for ds in raw.get("datasets", {}).values():
        for key in ("anndata", "ome-zarr"):
            if ds.get(key):
                p = Path(ds[key])
                if not p.is_absolute():
                    ds[key] = str((base_dir / p).resolve())

    return ProjectConfig.model_validate(raw)


def is_project_config(path: Path) -> bool:
    """Return True if *path* is a YAML project config file."""
    return path.suffix in (".yaml", ".yml")
