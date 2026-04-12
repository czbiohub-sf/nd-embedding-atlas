"""Project configuration model for multi-dataset YAML files."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator, model_validator


class DatasetSpec(BaseModel):
    """A single dataset entry in a project YAML config."""

    model_config = ConfigDict(populate_by_name=True)

    anndata: Path | None = None
    # MuData store (.h5mu or .zarr with mod/ group) — mutually exclusive with anndata
    mudata: Path | None = None
    # "ome-zarr" is the canonical key; "hcs_plate" is accepted for backward compatibility
    ome_zarr: Path | None = Field(
        None,
        alias="ome-zarr",
        validation_alias=AliasChoices("ome-zarr", "hcs_plate"),
    )

    @field_validator("anndata", "mudata", "ome_zarr", mode="before")
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

    @model_validator(mode="after")
    def check_mutual_exclusivity(self):
        """Validate that exactly one of anndata/mudata is specified."""
        if self.anndata is not None and self.mudata is not None:
            msg = "Cannot specify both 'anndata' and 'mudata' in a dataset entry"
            raise ValueError(msg)
        if self.anndata is None and self.mudata is None:
            msg = "Must specify either 'anndata' or 'mudata' in a dataset entry"
            raise ValueError(msg)
        return self

    @property
    def data_path(self) -> Path:
        """Return the primary data path (anndata or mudata)."""
        if self.mudata is not None:
            return self.mudata
        if self.anndata is not None:
            return self.anndata
        msg = "DatasetSpec requires either 'anndata' or 'mudata'"
        raise ValueError(msg)

    @property
    def is_mudata(self) -> bool:
        """Return True if this dataset uses MuData format."""
        return self.mudata is not None


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

    # Resolve relative paths relative to the YAML file's parent directory.
    # Accept both "ome-zarr" (canonical) and "hcs_plate" (legacy).
    for ds in raw.get("datasets", {}).values():
        for key in ("anndata", "mudata", "ome-zarr", "hcs_plate"):
            if ds.get(key):
                p = Path(ds[key])
                if not p.is_absolute():
                    ds[key] = str((base_dir / p).resolve())

    return ProjectConfig.model_validate(raw)


def is_project_config(path: Path) -> bool:
    """Return True if *path* is a YAML project config file."""
    return path.suffix in (".yaml", ".yml")
