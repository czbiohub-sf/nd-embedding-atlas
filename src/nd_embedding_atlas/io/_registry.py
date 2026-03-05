"""Generic immutable typed registry."""

from __future__ import annotations

from collections.abc import Iterator, Mapping


class Registry[V](Mapping[str, V]):
    """Immutable typed string-keyed registry.

    A frozen mapping from string keys to typed values.  Subclass to add
    domain-specific lookup behavior (e.g. fuzzy matching for channel names,
    alias resolution for plate stores).

    Parameters
    ----------
    data
        Initial key-value pairs.

    Examples
    --------
    >>> r = Registry({"a": 1, "b": 2})
    >>> r["a"]
    1
    >>> len(r)
    2
    >>> list(r)
    ['a', 'b']
    """

    __slots__ = ("_data",)

    def __init__(self, data: Mapping[str, V]) -> None:
        self._data: dict[str, V] = dict(data)

    def __getitem__(self, key: str) -> V:
        return self._data[key]

    def __contains__(self, key: object) -> bool:
        return key in self._data

    def __iter__(self) -> Iterator[str]:
        return iter(self._data)

    def __len__(self) -> int:
        return len(self._data)

    def __repr__(self) -> str:
        cls = type(self).__name__
        return f"{cls}({{{', '.join(f'{k!r}: ...' for k in self._data)}}})"
