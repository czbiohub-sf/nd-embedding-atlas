# ndea · System language

**Draft.** This names the parts of ndea and how they relate, so people and agents describe the system the same way. It is a vocabulary, not an API spec. Screen terms (layout, tile, tab, view, component) are in [glossary.md](glossary.md).

---

## The three layers

```
 harness (Claude Code, Codex, pi…)          person
        │                                     │
        ▼                                     ▼
 ┌──────────────┐                     ┌──────────────┐
 │  Interface   │  MCP                │   Shell UI   │  sidebar, tiles, ⌘K, cog
 └──────┬───────┘                     └──────┬───────┘
        │            edits · queries         │
        ▼                                    ▼
 ┌────────────────────────────────────────────────────┐
 │                       Spine                        │
 │  workspace · edit pipeline · links · data · registry │
 └──────────────────────────┬─────────────────────────┘
                            │ state + data
                            ▼
 ┌────────────────────────────────────────────────────┐
 │                    Components                      │
 │      Embedding · Table · Crops · Image · …         │
 └────────────────────────────────────────────────────┘
```

1. **Interface:** how a harness talks to ndea, over MCP. It can read the workspace, query data, and submit edits. It has no UI of its own.
2. **Spine:** the core that both the harness and the person go through. It owns the workspace, checks and applies every edit, resolves links, serves data, and keeps the registry of components.
3. **Components:** the building blocks that render views. They can be extended, composed and modified while the app runs, by the person or their harness.

The person and the harness are peers. Both change the workspace only by sending edits to the spine. The shell UI is the person's interface in the same way MCP is the harness's.

---

## Spine

| Term | Meaning |
| --- | --- |
| **Workspace** | The single live document: datasets, sources, layouts, views, links. The spine holds the only copy; everything else renders from it. |
| **Edit** | One atomic change to the workspace ("add view", "set color by", "define source"). The only way anything changes. |
| **Change set** | Edits submitted together, applied or rejected as a unit. |
| **Edit pipeline** | Validate, then apply or hold as a proposal, then broadcast to every open window. |
| **Rejection** | An edit that fails validation. It changes nothing and returns a precise reason ("field moa_class does not exist; closest: moa"). |
| **Proposal** | A change set held for the person to accept or reject, shown as a preview on the dashboard. |
| **Edit mode** | Per workspace: *propose* (harness edits become proposals) or *apply* (they take effect immediately). |
| **Provenance** | Who made each edit (person or harness) and the intent it gave. Kept on the workspace, not shown as chrome. |
| **Link resolver** | Computes what each view sees from its links (Filter, Focus, Color by…), so components never coordinate directly. |
| **Data service** | Answers queries against datasets: obs rows, embedding coordinates, image regions, exact counts. |
| **Registry** | The list of available components and their manifests. |

---

## Interface (MCP)

What a harness can do, described as verbs rather than function names:

| Verb | Meaning |
| --- | --- |
| **Read** | Get the workspace, or one layout, view, source or link. |
| **Describe** | List components (with manifests), datasets, fields and sources. |
| **Query** | Ask the data service: counts behind any view or link, field summaries, obs by id. |
| **Edit** | Submit a change set. Returns applied, proposed, or rejected with reasons. |
| **Point** | Focus an obs, or set a selection, for the person to look at. This is a normal edit to the Focus or Filter link. |
| **Register** | Add or update a component in the registry (see Extending). |

Rules:
- The harness never draws UI. It changes the workspace and the shell renders the result.
- Every answer that cites data cites exact counts from the data service.

---

## Components

| Term | Meaning |
| --- | --- |
| **Component** | A type of view: Embedding, Table, Crop gallery, Image, Histogram, Annotation. |
| **View** | One instance of a component, inside a tab. Owns its settings and bindings. |
| **Manifest** | A component's declaration: name, what data it needs, its settings schema, which link roles it supports, the controls it shows. |
| **Binding** | What a view is attached to: a dataset or collection, a source, and fields (e.g. embedding key and axes, color field). |
| **Settings schema** | A typed list of the view's settings (switch, choice, number, field). The cog renders it, and the harness can set it with edits. No hand-built settings UI. |
| **Link role** | How a view takes part in a link: *produces* (its selections feed the link), *consumes* (it narrows or colors by the link), or both. Example: an embedding produces and consumes Filter; a Count view only consumes it. |
| **Event** | Something a view reports to the spine: select, focus, hover. The spine turns events into edits on links. |
| **Controls** | The floating buttons a view shows (tool group, axis picker, channels), declared in the manifest. |

### Extending, composing, modifying

- **Extend:** register a new component, with its manifest and code, in the registry. It appears in ⌘K and in the tab "add" menu like the built-in ones.
- **Compose:** arrange existing components without new code: layouts, tiles, tabs, links, sources.
- **Modify:** change a view's settings or bindings, or fork a component into a variant (for example, a crop gallery that groups by plate).

### Contract every component keeps

1. Reads state and data only from the spine, never from other views.
2. Changes things only by emitting events or edits.
3. Declares every setting in its settings schema, so the person and the harness can both reach it.
4. Declares its link roles, so linking works without wiring.
5. Uses the design system's tokens and shared controls (Tile header, OverlayGroup, Select, Popover, Tooltip).
6. Renders a useful default with no settings changed.

---

## UI ↔ language

| You see | It is |
| --- | --- |
| Changing color by in the cog | An edit to a view setting |
| Lasso on an embedding | An event, turned into an edit on the Filter link |
| Clicking a row | An edit on the Focus link |
| Dashed ghost tile with Accept / Reject | A proposal |
| "Field moa_class does not exist…" notification | A rejection |
| ⌘K "Fill slot: Histogram" | An edit that adds a view of the Histogram component |
| Links popover on a view | The view's link roles and current link values |
| Sidebar Harness panel | Interface activity: reads, queries, edits |

---

## Guidance for agents working on ndea

- Use these names and the glossary. Don't invent synonyms (panel, widget, node, slot).
- A new capability is a new **component**, a new **setting** on a component, or a new **link** type. It is never new shell chrome.
- Anything the person can change in the UI must also be reachable as an edit, and the other way round.
- Don't add agent-only UI (chat, buttons for the agent). The harness is reached through the interface.
- Keep counts exact and the unit **obs**.

---

## Open questions

- Is **Spine** the public name, or an internal one (with "core" or "workspace server" shown to users)?
- How do registered components ship: files in the workspace folder, a package, or code the harness writes on the fly?
- Do forks of a component live in the workspace or in a shared library?
- Which link types are first-class: Filter, Focus and Color by today; Viewport and Sort planned?
- Does Provenance surface anywhere in the UI, or only through the interface?
