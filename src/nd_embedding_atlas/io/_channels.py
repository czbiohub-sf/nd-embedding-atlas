"""Default fluorescence channel color mapping.

Provides a case-insensitive lookup from common fluorophore/channel names to
``cmap.Color`` objects. Used by both the embedding viewer (``vz``) and the
image viewer (``ndimg``) when OME-Zarr metadata lacks explicit channel colors.

Examples
--------
>>> from nd_embedding_atlas.io import ChannelColors
>>> ChannelColors["DAPI"]
Color('0080FF')
>>> ChannelColors.hex("GFP")
'00FF00'
>>> ChannelColors.hex("unknown-channel")
'FFFFFF'
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import override

from cmap import Color

from nd_embedding_atlas.io._registry import Registry


class ChannelColorRegistry(Registry[Color]):
    """Channel name → ``cmap.Color`` registry with fuzzy lookup.

    Lookup order:

    1. Exact match (case-insensitive)
    2. Substring match (case-insensitive) — e.g. ``"Alexa488-Phalloidin"`` matches ``"Alexa488"``
    3. Default white (``FFFFFF``)
    """

    _DEFAULT = Color("FFFFFF")

    def __init__(self, data: Mapping[str, str]) -> None:
        super().__init__({k: Color(v) for k, v in data.items()})
        self._lower: dict[str, Color] = {k.lower(): v for k, v in self._data.items()}

    @override
    def __getitem__(self, key: str) -> Color:
        """Case-insensitive lookup with substring fallback."""
        lower = key.lower()
        if lower in self._lower:
            return self._lower[lower]
        for name, color in self._lower.items():
            if name in lower:
                return color
        return self._DEFAULT

    @override
    def __contains__(self, key: object) -> bool:
        if not isinstance(key, str):
            return False
        return key.lower() in self._lower

    def hex(self, channel_name: str) -> str:
        """Return 6-character hex color string (no ``#`` prefix).

        Parameters
        ----------
        channel_name
            Channel label (e.g. ``"DAPI"``, ``"GFP"``).

        Returns
        -------
        str
            Hex color like ``"0080FF"``.
        """
        return self[channel_name].hex[1:]


ChannelColors: ChannelColorRegistry = ChannelColorRegistry(
    {
        # DNA stains
        "DAPI": "0080FF",
        "Hoechst": "0080FF",
        "H2B": "0080FF",
        # Green fluorophores
        "GFP": "00FF00",
        "FITC": "00FF00",
        "Alexa488": "00FF00",
        "EGFP": "00FF00",
        # Red fluorophores
        "RFP": "FF0000",
        "mCherry": "FF0000",
        "TXR": "FF0000",
        "Texas Red": "FF0000",
        "TRITC": "FF4D00",
        "Alexa594": "FF0000",
        "Alexa568": "FF4D00",
        "tdTomato": "FF0000",
        "mScarlet": "FF0000",
        "CAAX": "FF0000",
        # Far-red / Magenta
        "Cy5": "FF00FF",
        "Alexa647": "FF00FF",
        "Cy7": "FF0080",
        # Cyan
        "CFP": "00FFFF",
        "mTurquoise": "00FFFF",
        # Yellow
        "YFP": "FFFF00",
        "Venus": "FFFF00",
        # Brightfield / Phase
        "BF": "FFFFFF",
        "Phase": "FFFFFF",
        "Phase3D": "FFFFFF",
        "Brightfield": "FFFFFF",
        "DIC": "FFFFFF",
    }
)
