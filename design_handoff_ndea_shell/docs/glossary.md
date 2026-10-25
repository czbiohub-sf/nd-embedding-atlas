# ndea · Glossary

One name per concept, used the same way in the UI, these docs, and harness instructions. System-level terms (interface, spine, edit, proposal, manifest, link role…) are in [system-language.md](system-language.md).

## On screen

| Term | Meaning |
| --- | --- |
| **Layout** | The whole grid arrangement on screen ("Exploration", "Review"). A workspace has several. |
| **Tile** | One region of the layout grid. Has a position and size; can be split, resized, swapped, or made fullscreen. Has a header with tabs and the cog. |
| **Empty tile** | A tile with no tabs yet, waiting for a component. (Previously "slot".) |
| **Tab** | One entry in a tile's tab strip. A tile has one or more tabs; exactly one is showing. |
| **View** | What a tab shows: one embedding plot, one table, one image viewer. Owns its settings (color by, axes, sort, contrast…). Settings, refs and links belong to the view, not the tile, so moving a tab to another tile keeps them. |
| **Component** | The *type* of a view: Embedding, Table, Crop gallery, Image, Histogram, Annotation. "Add a component" creates a new view of that type. Two embedding tabs are two views of the same component. |

## Inside a view

| Term | Meaning |
| --- | --- |
| **Controls** | The floating buttons on a view: tool group, axis picker, channels. |
| **Legend** | A view's color key. A pop-up, or pinned into the view. |
| **Selection** | The obs picked with box, lasso, or table rows. Shared through the Filter link. |
| **Focus** | The single obs currently inspected. Shared through the Focus link. |

## Data and state

| Term | Meaning |
| --- | --- |
| **Workspace** | The live document: datasets, sources, layouts, links. Every change, by a person or the harness, edits it. |
| **Collection** | A set of datasets that share the same obs schema (e.g. one per plate, well, or FOV in one experiment). |
| **Dataset** | One AnnData + OME-Zarr pair. |
| **obs** | One observation (a cell, tissue patch, organoid, tracked object). The unit for every count. |
| **Source** | A named subset of obs defined by filters ("QC pass"). |
| **Link** | A shared Filter, Focus or Color-by that ties views together. Called **scope** in code and harness docs. |
| **Harness** | The external agent (Claude Code, Codex, pi…) editing the workspace over MCP. The app has no chat. |

## Not used

- **Panel**: ambiguous between tile, view and sidebar flyout.
- **Node / widget / card**: use tile or view.
- **Slot**: use empty tile.
- **cells / detections** as a unit: use obs.
