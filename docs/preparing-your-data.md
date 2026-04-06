---
icon: lucide/layers
---

# Preparing your imaging data

The viewer streams image data directly from OME-Zarr over HTTP using tile-based
fetching. How your data is stored has a large impact on loading speed, memory
usage, and interactivity. This page explains what to do and why.

## At a glance

| | Recommended | Avoid |
|---|---|---|
| **Zarr version** | Zarr v3 (OME-NGFF 0.5) with `sharding_indexed` | Zarr v2 or unsharded v3 |
| **Pyramid** | ≥ 4 resolution levels (LODs) | Single LOD |
| **Inner chunk (XY)** | 512 × 512 px or 256 × 256 | Anything that covers a full XY plane |

---

## Why storage format matters

The viewer uses [idetik's][idetik-gh] tile-based renderer which fetches only the chunks
that intersect the current camera viewport (the crop region). Two things determine
how much data is transferred on every obs click:

[idetik-gh]: https://github.com/chanzuckerberg/idetik

**1. Background thumbnail loading.**
The renderer always pre-loads a low-resolution thumbnail of the full FOV in the
background so that panning feels smooth. With a proper pyramid the thumbnail is
the coarsest LOD, a small amount of data. Without a pyramid the renderer falls
back to the only LOD available (full resolution), downloading the entire image
every time.

**2. Chunk granularity.**
The smallest unit of data the viewer can fetch using idetik *one* chunk. If your chunks cover an entire
XY plane (e.g. `(1, 1, 1, 748, 1135)`), loading even a single pixel requires
downloading the entire plane. With 512 × 512 inner chunks the visible crop
typically intersects ≤ 4 chunks per channel.

---

## Zarr v3 with sharding (recommended)

OME-NGFF 0.5 stores data as Zarr v3. Use the `sharding_indexed` codec to pack
many small inner chunks into larger shard files on disk. This is ideal for HTTP
access because:

- Each shard file has an index table at the end. The client issues one byte-range
  request to read the index, then one more to fetch the specific inner chunk it
  needs. No unnecessary data is transferred.
- Packing all channels into a single shard (`C` dimension = full channel count)
  means one shard-index read covers all 12 channels simultaneously.

### Recommended layout


```shell
Shard shape  :  (T, C, Z, Y, X) - For now feel free to use any sharding configuration you prefer
Chunk Shape  :  (1, 1, 1,  256,  265) - Chunks are the most important aspect as this is how the viewer fetches data
Codec        :  sharding_indexed → [bytes(little-endian), blosc/zstd clevel=1] # (1)!
```

1. The codec used for compression is flexible, pick what suites you best.

At LOD 0 for a 100 k × 100 k image this gives a 12 × 12 grid of shard files
(≈ 144 shards). Each shard is ~3 GB on disk but the viewer only reads a few
hundred KB via byte-range requests.

### Verifying your layout

```bash
uv run iohub info --verbose <plate.zarr>
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

Pyramids (multi-scale / multi-resolution) are **strongly recommended** for a good viewer
experience. Without them the viewer cannot distinguish between "immediately important data" (the current crop in the viewer) and "background thumbnail tiles"
(the image outside of the one being displayed ).

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

Zarr v2 (OME-NGFF 0.4) is supported but has limitations:

- **No byte-range sharding.** Each chunk is stored as a separate file. Reading
  a 512 × 512 px crop fetches one file per chunk. This might be fine if are
  small.
- **Chunk size still matters.** Make sure the XY chunk dimensions do **not**
  cover the full image plane. A chunk of `(1, 1, 1, 748, 1135)` forces the
  client to download an entire 748 × 1135 px plane to display a 10 × 10 px
  region.

Multi-scale pyramids are equally important for zarr v2 as the viewer's
background-loading behaviour is the same regardless of storage version.
