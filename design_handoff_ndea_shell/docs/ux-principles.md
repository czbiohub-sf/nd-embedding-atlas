# ndea · UX principles

Why `ndea Shell v2.dc.html` behaves the way it does, and where each idea comes from. Each section states the principle, what it changes in ndea, and the sources behind it.

Status markers: **Built** = in `ndea Shell v2`. **Planned** = proposed, not yet built.

Terms (layout, tile, tab, view, component, link…) are defined in [glossary.md](glossary.md).

---

## 1. Shorten the time to an answer, not just the space

Density is how much useful work the interface gives you for the time and screen space it takes. Responsiveness and the number of steps count as much as how much fits on screen.

**In ndea**
- The core loop is: see structure in an embedding → select → look at the images → compare → label. Every extra click, wait or animation in that loop costs density.
- Tiles sit 4px apart and 4px from the window edges. Chrome is a 32px sidebar on the left; headers stay compact.

**Sources**
- Matt Ström-Awn, *UI Density*: https://mattstromawn.com/writing/ui-density/
- Envy Labs, *When More is More in Interface Design*: https://www.envylabs.com/insights/when-more-is-more-in-interface-design
- uxdesign.cc, *Designing for information density*: https://uxdesign.cc/designing-for-information-density-69775165a18e

---

## 2. One strong default, depth on request

Every tile should be useful the moment it appears, with no setup. There are no "simple" and "advanced" modes; advanced options sit one level deeper.

**In ndea**
- Tile settings live behind each tile's cog. Settings change how a tile looks, never whether it works.
- Pop-ups share one frame and one row style, so they read as one layer of the app rather than separate dialogs.

**Sources**
- Naman Subedi, *Design Considerations for Data-Dense Interfaces*: https://namansubedi.com/
- Linear, *Settings are not a design failure*: https://linear.app/now/settings-are-not-a-design-failure

---

## 3. Overview first, zoom and filter, then details on demand

Shneiderman's order for exploratory tools maps directly onto ndea: embedding → selection → image.

**In ndea**
- **Built:** finishing a box or lasso selection moves focus to the largest selected cell, so the image viewer and table already show it.

**Sources**
- Ben Shneiderman, *The Eyes Have It: A Task by Data Type Taxonomy for Information Visualizations* (1996): https://www.cs.umd.edu/~ben/papers/Shneiderman1996eyes.pdf

---

## 4. Highlight first, filter on request (brushing and linking)

Highlighting a subset in context and removing everything else are different operations. Highlighting keeps the context the selection came from; filtering is a deliberate second step.

**In ndea**
- **Built:** a selection highlights its cells in every linked tile and dims the rest. Selected rows and crops move to the top; the others drop to 35% opacity.
- **Built:** **Filter to selection** on the selection bar narrows every linked tile. It then reads **Show all** to undo that.
- The F1 count keeps the full total while a selection is only highlighted. The selection bar shows the selected count.

**Sources**
- Stephen Few, *Coordinated Highlighting in Context*: https://www.perceptualedge.com/articles/visual_business_intelligence/coordinated_highlighting_in_context.pdf
- Becker & Cleveland, *Brushing Scatterplots*, Technometrics 29(2), 1987: https://doi.org/10.1080/00401706.1987.10488204
- Wikipedia, *Brushing and linking*: https://en.wikipedia.org/wiki/Brushing_and_linking

---

## 5. Focus + context

Keep the overall shape visible while you work on one part.

**In ndea**
- Points outside a filter or selection stay on the embedding as a faint layer instead of disappearing.
- **Planned:** apply the same rule to crops and table, with a "showing 1,284 of 48,312" summary.

**Sources**
- Stephen Few, *Coordinated Highlighting in Context* (above)

---

## 6. Undo instead of confirmation

Confirmations train people to click through them. Undo forgives mistakes without slowing anyone down.

**In ndea**
- **Built:** **Remove** in tile settings acts right away. The tile becomes an empty slot, and the notification offers **Undo**.
- **Built:** **Clear** on the selection bar offers **Undo** in its notification.
- **Planned:** the same for clearing with esc, and for reverting changes the harness made.

**Sources**
- Jef Raskin, *The Humane Interface* (2000): chapter on undo vs. confirmation dialogs.
- Aza Raskin, *Never Use a Warning When You Mean Undo*: https://alistapart.com/article/neveruseawarning/

---

## 7. Keep the layout stable so people learn where things are

Controls should always be in the same place, and tiles should never move unless you moved them. When they do move, they should travel to the new spot rather than jump.

**In ndea**
- Fixed corners on every tile: selection tools top-left, settings cog top-right, axis picker bottom-right.
- Layout switches and fullscreen move tiles smoothly to their new positions.
- The sidebar is quieter than the tiles, so the work area stands out.

**Sources**
- Rauno Freiberg, *Invisible Details of Interaction Design*: https://rauno.me/craft/interaction-design
- Linear, *How we redesigned the Linear UI (part II)*: https://linear.app/now/how-we-redesigned-the-linear-ui
- Linear, *A calmer interface for a product in motion*: https://linear.app/now/behind-the-latest-design-refresh

---

## 8. Animate rare actions, keep frequent ones instant

Motion helps you follow a change you don't make often. On something you do constantly, it becomes friction.

**In ndea**
- Tab switches inside a tile are instant.
- **Planned:** a written rule:
  - **instant:** tab switches, tool changes, hover, focus.
  - **animated:** layout changes, fullscreen, harness edits arriving, notifications.

**Sources**
- Rauno Freiberg, *Invisible Details of Interaction Design* (above)

---

## 9. Fitts's law: edges and corners are the easiest targets

Targets at a screen edge are effectively infinitely deep, because the cursor can't overshoot them.

**In ndea**
- The sidebar sits on the left edge, and the controls you use most are in fixed tile corners.
- **Planned:** extend the sidebar's click area to the window edge, and open context menus at the pointer.

**Sources**
- Rauno Freiberg, *Invisible Details of Interaction Design* (above)
- Wikipedia, *Fitts's law*: https://en.wikipedia.org/wiki/Fitts%27s_law

---

## 10. Hick's law: fewer choices, faster decisions

Decision time grows with the number of options shown at once.

**In ndea**
- ⌘K opens to switching layouts and collections; other commands sit behind `>`.
- **Planned:** short menus show the 3–5 most likely options first (for example, recently used color-by fields), with the rest behind search.

**Sources**
- Wikipedia, *Hick's law*: https://en.wikipedia.org/wiki/Hick%27s_law

---

## 11. Recognition over recall

The current state should be visible, not something people have to remember.

**In ndea**
- The Links pop-up on each tile lists its scopes (filter, focus, color by), their current values, and the tiles they link to.
- **Planned:** a one-line workspace summary (for example "F1: treatment = Taxol · lasso 1,284 · focus B07-s3-412"), and a small badge on any tile that something set elsewhere is narrowing.

**Sources**
- Jakob Nielsen, *10 Usability Heuristics* (#6, recognition rather than recall): https://www.nngroup.com/articles/ten-usability-heuristics/

---

## 12. A color budget: data gets the color, chrome stays neutral

Too much color, and too much detail or precision, are among the most common dashboard mistakes.

**In ndea**
- Chrome uses neutrals only. The single accent color marks only "selected or active".
- Data colors come from the theme's categorical set; continuous fields use viridis.
- Counts are exact, with thousands separators and tabular figures.

**Sources**
- Stephen Few, *Common Pitfalls in Dashboard Design*: https://www.perceptualedge.com/articles/Whitepapers/Common_Pitfalls.pdf
- Edward Tufte, *The Visual Display of Quantitative Information* (data-ink ratio).

---

## 13. Small multiples for comparison

Comparing is easier side by side than by switching back and forth.

**In ndea**
- **Planned:** when two collections are open, the embedding splits into one small panel per collection, sharing axes and colors. This replaces the compare mode that was removed.

**Sources**
- Edward Tufte, *Envisioning Information* (small multiples).

---

## 14. Make modes visible

Selection tools are modes, and invisible modes cause mistakes.

**In ndea**
- The active tool is highlighted in the tool group and the cursor changes.
- **Planned:** the pointer tool comes back after one selection unless Shift is held, so nobody stays in lasso mode by accident.

**Sources**
- Jef Raskin, *The Humane Interface* (on modes).

---

## 15. The workspace is a shared view for people and the agent

The workspace is a shared picture of what's true, used by both the researcher and the harness. The app's job is to make the current state and its recent changes readable at a glance.

**In ndea**
- The harness drives layout and workspace edits; the app never chats.
- Harness edits arrive as proposals you accept or reject, and rejected edits are shown without noise.

**Sources**
- Benn Stancil, *Data is for dashboards*: https://benn.substack.com/p/data-is-for-dashboards
