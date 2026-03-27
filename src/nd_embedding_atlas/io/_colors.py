"""Categorical color palette utilities."""

from __future__ import annotations

import re
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import numpy as np


def list_qualitative_colormaps() -> list[str]:
    """Return qualitative colormap names suitable for categorical data.

    Filters the ``cmap`` catalog to qualitative colormaps, excluding
    namespaced aliases (``colorbrewer:Set3``) and fixed-N variants
    (``Set3_8``) to keep the list concise.

    Returns
    -------
    list[str]
        Sorted list of base colormap names.
    """
    from cmap import Catalog

    cat = Catalog()
    # Always include glasbey — it's the best option for large N but is tagged
    # "miscellaneous" rather than "qualitative" so the filter below misses it.
    names = ["glasbey"]
    for name, info in cat.items():
        if ":" in name:
            continue
        if re.search(r"_\d+$", name):
            continue
        category = getattr(info, "category", "") or ""
        if "qualitative" in category.lower():
            names.append(name)
    return sorted(set(names))


_FALLBACK_CONTINUOUS_COLORMAPS = [
    "viridis",
    "plasma",
    "magma",
    "inferno",
    "cividis",
    "coolwarm",
    "RdBu",
    "Blues",
    "Reds",
    "Greens",
    "YlOrRd",
]


def list_continuous_colormaps() -> list[str]:
    """Return names of continuous (sequential/diverging) colormaps.

    Filters the ``cmap`` catalog to sequential, diverging, and perceptually
    uniform colormaps suitable for continuous data.

    Returns
    -------
    list[str]
        Sorted list of colormap names.
    """
    try:
        from cmap import Catalog

        cat = Catalog()
        continuous = []
        for name, info in cat.items():
            if ":" in name:
                continue
            if re.search(r"_\d+$", name):
                continue
            cat_str = str(getattr(info, "category", "") or "").lower()
            if any(k in cat_str for k in ["sequential", "diverging", "perceptually"]):
                continuous.append(name)
        return sorted(continuous) if continuous else _FALLBACK_CONTINUOUS_COLORMAPS
    except ImportError:
        return _FALLBACK_CONTINUOUS_COLORMAPS


def sample_continuous_colormap(colormap: str, values: np.ndarray) -> np.ndarray:
    """Map normalized [0, 1] values to RGB via colormap.

    Parameters
    ----------
    colormap : str
        Colormap name recognised by ``cmap``.
    values : np.ndarray
        Shape ``(N,)``, values in ``[0, 1]``.

    Returns
    -------
    np.ndarray
        Shape ``(N, 3)`` uint8 RGB.
    """
    import numpy as np

    try:
        from cmap import Colormap

        cm = Colormap(colormap)
        n_lut = 256
        lut = np.array(
            [[int(c * 255) for c in cm(i / (n_lut - 1))[:3]] for i in range(n_lut)],
            dtype=np.uint8,
        )
        indices = np.clip((values * (n_lut - 1)).astype(int), 0, n_lut - 1)
        return lut[indices]
    except Exception:  # noqa: BLE001
        gray = (values * 255).astype(np.uint8)
        return np.stack([gray, gray, gray], axis=1)


def make_categorical_palette(colormap: str = "glasbey", n: int = 256) -> list[str]:
    """Generate a list of hex colors for categorical scatter coloring.

    Samples the colormap at ``n`` evenly-spaced points across [0, 1].
    For discrete qualitative colormaps (``tab20``, ``Paired``, ``Set3`` …)
    this hits each distinct color band; when ``n`` exceeds the number of
    natural colors the palette cycles automatically.

    Parameters
    ----------
    colormap
        Any colormap name recognised by ``cmap``.  Qualitative colormaps
        (``"tab20"``, ``"Paired"``, ``"Set3"``) work best for categories.
    n
        Number of colors to return.

    Returns
    -------
    list[str]
        Hex color strings including the leading ``#`` (e.g. ``"#1f77b4"``).
    """
    from cmap import Colormap

    cm = Colormap(colormap)
    return [cm((i + 0.5) / n).hex for i in range(n)]
