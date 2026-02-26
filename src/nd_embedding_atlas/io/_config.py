"""YAML-based column mapping config for nd-embedding-atlas."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Self

from pydantic import BaseModel, field_validator, model_validator


class ColumnMapping(BaseModel):
    """Maps ndea's expected column roles to actual obs column names.

    All fields are optional — omit a key if the dataset lacks that concept.
    """

    x: str | None = None
    y: str | None = None
    fov: str | None = None
    t: str | None = None
    track_id: str | None = None
    bbox: str | None = None

    @field_validator("*", mode="before")
    @classmethod
    def strip_whitespace(cls, v: Any) -> Any:
        """Strip whitespace from all string values."""
        return v.strip() if isinstance(v, str) else v

    @model_validator(mode="after")
    def x_y_must_be_paired(self) -> Self:
        """If x is specified, y must also be specified (and vice versa)."""
        if (self.x is None) != (self.y is None):
            msg = "x and y columns must both be specified or both omitted"
            raise ValueError(msg)
        return self


class NdeaConfig(BaseModel):
    """Top-level config parsed from a YAML file."""

    columns: ColumnMapping = ColumnMapping()

    def validate_against_obs(self, obs_columns: set[str]) -> Self:
        """Check that all specified columns exist in the anndata obs.

        Parameters
        ----------
        obs_columns
            Set of column names available in the dataset's ``.obs``.

        Returns
        -------
        self, for chaining.

        Raises
        ------
        ValueError
            If any mapped column is not found in *obs_columns*.
        """
        missing = []
        for role, col in self.columns.model_dump(exclude_none=True).items():
            if col not in obs_columns:
                missing.append(f"  {role}: '{col}' not found in obs")
        if missing:
            msg = "Column mapping references columns not in the dataset:\n" + "\n".join(missing)
            raise ValueError(msg)
        return self


def load_config(path: Path) -> NdeaConfig:
    """Load and validate a YAML config file.

    Parameters
    ----------
    path
        Path to a ``.yaml`` / ``.yml`` config file.

    Returns
    -------
    Validated :class:`NdeaConfig`.
    """
    import yaml

    data = yaml.safe_load(path.read_text())
    return NdeaConfig.model_validate(data or {})
