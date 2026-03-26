"""Categorical color palette utilities."""

from __future__ import annotations

import re


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
