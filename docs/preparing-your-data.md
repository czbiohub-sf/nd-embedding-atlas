---
icon: lucide/layers
---

# Preparing your imaging data

The viewer streams OME-Zarr image data over HTTP, tile by tile. Storage layout dominates loading speed, memory, and interactivity. This page covers what to do and why.

## At a glance

|                      | Recommended                                    | Avoid                                |
| -------------------- | ---------------------------------------------- | ------------------------------------ |
| **Zarr version**     | Zarr v3 (OME-NGFF 0.5) with `sharding_indexed` | Zarr v2 or unsharded v3              |
| **Pyramid**          | ≥ 4 resolution levels (LODs)                   | Single LOD                           |
| **Inner chunk (XY)** | 512 × 512 px or 256 × 256                      | Anything that covers a full XY plane |

---

## Why storage format matters

The viewer uses [idetik's][idetik-gh] tile renderer, which fetches only the chunks intersecting the current viewport. Two factors drive the bytes transferred per obs click:

[idetik-gh]: https://github.com/chanzuckerberg/idetik

**1. Background thumbnail loading.**
The renderer pre-loads a full-FOV thumbnail to keep panning smooth. With a pyramid the thumbnail is the coarsest LOD — small. Without a pyramid the renderer downloads the full-resolution image as the thumbnail on every click.

**2. Chunk granularity.**
The smallest unit idetik can fetch is one chunk. Chunks that cover an entire XY plane (e.g. `(1, 1, 1, 748, 1135)`) force a full-plane download for any pixel inside. With 512 × 512 inner chunks the visible crop typically intersects ≤ 4 chunks per channel.

---

## Zarr v3 with sharding (recommended)

OME-NGFF 0.5 stores data as Zarr v3. The `sharding_indexed` codec packs many small inner chunks into larger shard files on disk — ideal for HTTP access:

- Each shard file ends with an index table. The client makes one byte-range request to read the index, then one more for the specific inner chunk. Two requests, zero wasted bytes.
- Packing all channels into one shard (full `C` dimension per shard) means a single index read covers every channel at once.

### Recommended layout

```shell
Shard shape  :  (T, C, Z, Y, X) - For now feel free to use any sharding configuration you prefer
Chunk Shape  :  (1, 1, 1,  256,  265) - Chunks are the most important aspect as this is how the viewer fetches data
Codec        :  sharding_indexed → [bytes(little-endian), blosc/zstd clevel=1] # (1)!
```

1. The codec used for compression is flexible, pick what suites you best.

At LOD 0 a 100 k × 100 k image lays out as a 12 × 12 shard grid (≈ 144 shards). Each shard is ~3 GB on disk; the viewer reads a few hundred KB via byte-range requests.

### Verifying your layout

Any zarr inspector that exposes shape + chunking will do. [`iohub`](https://czbiohub-sf.github.io/iohub/) (a separate tool) needs no permanent install:

```bash
uvx iohub info --verbose <plate.zarr>
```

Look for:

```
Chunk size:  (1, 1, 1, 512, 512)          ← inner chunk
No. bytes decompressed: 1.4 TiB           ← sanity check on total size
```

And in the zarr hierarchy, confirm 4–5 resolution levels per position:

```
0  (1, 12, 1, 104683, 104776)  float32    ← LOD 0 — full res
1  (1, 12, 1,  52342,  52388)  float32
2  (1, 12, 1,  26171,  26194)  float32
3  (1, 12, 1,  13086,  13097)  float32
4  (1, 12, 1,   6543,   6549)  float32    ← LOD 4 — thumbnail
```

---

## Multi-scale pyramids

Pyramids (multi-scale / multi-resolution) are **strongly recommended**. Without them the viewer can't tell foreground tiles (the current crop) from background tiles (the rest of the image) — every level downloads as if it were the focus.

### Generating pyramids with iohub

```python
from iohub import open_ome_zarr

with open_ome_zarr("plate.zarr", mode="r+") as plate:
    for _, position in plate.positions():
        position.make_multiscale(
            scale_factors=[[1, 1, 2, 2]],  # downsample XY by 2×
            chunks=(1, 1, 1, 512, 512),
            num_levels=4,
        )
```

---

## Zarr v2

Zarr v2 (OME-NGFF 0.4) works, with caveats:

- **No byte-range sharding.** Each chunk lives in its own file. A 512 × 512 px crop fetches one file per chunk — fine for small datasets, costly at scale.
- **Chunk size still matters.** Keep XY chunk dimensions below the full image plane. A `(1, 1, 1, 748, 1135)` chunk forces the client to download a 748 × 1135 px plane to display a 10 × 10 px region.

Pyramids matter as much for v2 as for v3 — the background-loading path doesn't change with storage version.
