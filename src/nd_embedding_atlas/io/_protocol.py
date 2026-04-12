"""DataSource protocol — structural interface for data backends.

Both ``DatasetCollection`` (multi-AnnData) and ``MuDataSource`` (multi-modal)
satisfy this protocol, so ``ViewerState`` and routes can work with either
without isinstance checks or type-tag dispatch.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Protocol, runtime_checkable

if TYPE_CHECKING:
    import numpy as np
    import pandas as pd


@runtime_checkable
class DataSource(Protocol):
    """Any data backend served by the viewer.

    Implementations must provide both metadata (n_obs, n_vars, etc.)
    and data access (get_obs, get_obsm, obsm_keys).
    """

    @property
    def n_obs(self) -> int: ...

    @property
    def n_vars(self) -> int: ...

    @property
    def shape(self) -> tuple[int, int]: ...

    @property
    def keys(self) -> list[str]: ...

    def get_obs(
        self,
        *,
        columns: list[str] | None = None,
        include_index: bool = False,
    ) -> pd.DataFrame:
        """Return obs metadata as a DataFrame."""
        ...

    def get_obsm(
        self,
        key: str,
        *,
        dtype: np.dtype | None = ...,
        columns: list[int] | None = None,
    ) -> np.ndarray:
        """Return an obsm embedding array."""
        ...

    def obsm_keys(self) -> list[str]:
        """Return available obsm keys."""
        ...
