"""Project configuration model for multi-dataset YAML files."""

from __future__ import annotations

from pathlib import Path

from pydantic import BaseModel, DirectoryPath, field_validator


class DatasetSpec(BaseModel):
    hcs_plate: DirectoryPath | None = None  # zarr stores are directories
    anndata: DirectoryPath  # zarr stores are directories


class ProjectConfig(BaseModel):
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

    Parameters
    ----------
    path
        Path to the YAML file defining the project datasets.

    Returns
    -------
    Validated ProjectConfig instance.
    """
    import yaml  # noqa: PLC0415

    with open(path) as f:
        raw = yaml.safe_load(f)
    return ProjectConfig.model_validate(raw)


def is_project_config(path: Path) -> bool:
    """Return True if *path* is a YAML project config file."""
    return path.suffix in (".yaml", ".yml")
