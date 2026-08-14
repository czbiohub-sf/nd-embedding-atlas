---
title: Docs Blog, Theme, and Content Pipeline
type: feature
date: 2026-08-12
---

# Docs Blog, Theme, and Content Pipeline

## Summary

Upgrade the standalone Waku/Fumapress site, adopt the glass layout and Shadcn color preset, add a Sätteri-backed blog, and expose GitHub, Open Graph, and LLM-friendly metadata. Preserve static GitHub Pages deployment and existing MDX documentation.

## Current State

- `docs/waku.config.ts` already loads Tailwind CSS v4, Fumapress, and Fumadocs MDX.
- `docs/src/app.css` uses the Fumadocs neutral preset, not the Shadcn preset.
- `docs/package.json` installs the direct `fumadocs-ui` package, which is the Radix build. No `components.json` or Shadcn component registry exists.
- `docs/press.config.tsx` already configures GitHub repository metadata and `llmsPlugin()`.
- Fumadocs MDX owns the single `docs` content source. No blog source exists.

## Requirements

- R1. Render documentation pages with the Fumapress glass layout while preserving sidebar, search, table of contents, and GitHub Pages base-path behavior.
- R2. Use Tailwind CSS v4 with Fumadocs UI's Shadcn color preset and Base UI build.
- R3. Add `/blog`, blog post, tag index, and tag detail routes through `blogPlugin()`.
- R4. Compile blog Markdown and MDX from `docs/blog/` with `@fumadocs/satteri`; keep existing documentation under `docs/content/` on Fumadocs MDX.
- R5. Add one substantive introductory post so blog rendering, tags, search, LLM export, and Open Graph output have real content.
- R6. Enable Takumi-generated WebP Open Graph images for documentation and blog pages.
- R7. Use the Fumapress recommended preset to expose `/llms.txt`, `/llms-full.txt`, per-page Markdown, sitemap, robots, RSS, and Takumi metadata.
- R8. Show `czbiohub-sf/nd-embedding-atlas` stars and forks in shared navigation and link to `/blog`.
- R9. Update every docs dependency to its latest release compatible with Fumapress beta and repository policy.
- R10. Preserve static output under `docs/dist/public` and the existing `DOCS_BASE_URL` deployment contract.

## Key Technical Decisions

- KTD1. **Two exclusive content roots:** Retain `fumadocs-mdx` for `docs/content/` and use Sätteri only for `docs/blog/`. Separate roots prevent duplicate ingestion while limiting migration risk.
- KTD2. **Small Sätteri adapter:** Add one Fumapress adapter for Sätteri body, table-of-contents, structured-data, raw-text, and tag access. Fumapress ships no Sätteri adapter, but its adapter contract supports mixed sources.
- KTD3. **Fumapress beta release line:** Use `fumapress@1.0.0-beta.3` and its exact Waku beta.8 peer. Stable Fumapress 0.7.3 does not export the requested glass layout or current configuration API.
- KTD4. **Base UI with explicit Shadcn tokens:** Alias `fumadocs-ui` to `@fumadocs/base-ui`, install `@base-ui/react`, import `fumadocs-ui/css/shadcn.css`, and define the official neutral Shadcn light, dark, and sidebar variables. Do not initialize a component registry until custom Shadcn components are needed.
- KTD5. **Recommended preset with Orama search:** Keep `preset: "recommended"` and register `oramaSearchPlugin()` explicitly. Fumapress then suppresses its default FlexSearch plugin while retaining recommended sitemap, robots, llms.txt, RSS, and Takumi outputs.
- KTD6. **Nonblocking GitHub metadata:** Use `fetchRepositoryInfo` from Fumadocs GitHub Info behind a local fallback that always renders the repository link and adds counts when available. Pass the read-only Actions token during CI builds.
- KTD7. **Base-path-aware Takumi metadata:** Keep generated image routes relative to Waku's router, but construct absolute `og:image` URLs with the required `/nd-embedding-atlas/` `siteBasePath`. Never publish docs or image metadata at the organization-level `https://czbiohub-sf.github.io/` root. The stock plugin drops the project subpath because it resolves a root-relative pathname.

## Implementation Units

### U1. Dependency and UI foundation

- **Files:** `docs/package.json`, `docs/bun.lock`, `docs/src/app.css`, `docs/waku.config.ts`, `docs/press.config.tsx`
- **Changes:**
  - Update to `fumapress@1.0.0-beta.3`, Waku beta.8, Fumadocs 16.14.x/15.2.x, React 19.2.8, Tailwind 4.3.3, and latest compatible type packages.
  - Keep TypeScript at 6.0.3; TypeScript 7 conflicts with repository policy.
  - Add latest compatible `@fumadocs/satteri`, `@base-ui/react`, and `shiki`.
  - Switch `fumadocs-ui` to the matching `@fumadocs/base-ui` alias.
  - Replace the neutral theme import with `shadcn.css`, add the generated glass stylesheet, and define complete neutral Shadcn token blocks.
  - Migrate the custom redirect plugin to the beta API's `AppShape` and `PressPlugin` types.
- **Verification:** `vp` dependency audit reports no remaining eligible docs updates; docs type generation and static build pass.

### U2. Sätteri blog source and adapter

- **Files:** `docs/src/blog-source.ts`, `docs/src/satteri-adapter.tsx`, `docs/waku.config.ts`
- **Changes:**
  - Define a `docs/blog/` Sätteri source with Fumapress blog frontmatter and meta schemas; leave `docs/source.config.ts` limited to Fumadocs MDX.
  - Enable Vite-backed invalidation for blog files during development.
  - Implement Fumapress adapter hooks for rendered body, table of contents, structured data, raw Markdown text, and `frontmatter.tags`.
  - Keep the existing docs collection unchanged.
- **Verification scenarios:**
  1. Adapter checks return Sätteri body, table of contents, structured data, raw text, and nested frontmatter tags.
  2. Existing docs pages still resolve only through `fumadocsMdx()`.
  3. Editing a blog file invalidates the Sätteri source in development.

### U3. Blog, glass layout, and metadata plugins

- **Files:** `docs/press.config.tsx`, `docs/src/github-repo-info.tsx`, `docs/src/base-path-takumi.tsx`, `docs/blog/meta.json`, `docs/blog/introducing-nd-embedding-atlas.mdx`
- **Changes:**
  - Register named `docs` and `blog` sources, with blog mounted at `/blog`.
  - Render content pages with `createGlassLayoutPage`.
  - Add ordered Docs, Blog, and repository links to shared desktop and mobile navigation; preserve visible focus and current-route cues.
  - Render repository stars and forks when GitHub responds; fall back to the repository link without counts.
  - Keep the recommended preset and register `blogPlugin()`, `oramaSearchPlugin()`, and a base-path-correct Takumi plugin. The explicit Orama plugin prevents the preset from adding FlexSearch.
  - Write an introductory post for researchers evaluating linked embedding/image exploration. Explain the problem, TCZYX linkage, Node Workspace, supported data, and installation path; end with links to installation docs and GitHub.
- **Verification scenarios:**
  1. `/blog` lists the introductory post.
  2. Blog index → post → tag detail navigation works; unknown tags return not found; every tag view links back to all posts.
  3. Docs pages use glass chrome; blog pages retain the blog plugin's layout.
  4. GitHub stars and forks render when available; simulated fetch failure preserves a working repository link.
  5. Orama search includes both docs and blog content; FlexSearch is not initialized.

### U4. Static deployment and output proof

- **Files:** `.github/workflows/docs.yml`
- **Changes:** Pass `${{ github.token }}` as `GITHUB_TOKEN` only to the static docs build.
- **Verification scenarios:**
  1. `vp run docs:build` succeeds with the production base URL.
  2. Static output contains `/llms.txt`, `/llms-full.txt`, sitemap, robots, RSS, a Markdown export for one docs page and the blog post, and Takumi WebP images for both.
  3. Generated `og:image` metadata and files include `/nd-embedding-atlas/` exactly once.
  4. Browser smoke confirms glass layout, blog index/post/tags, GitHub info, keyboard focus, and correct `/nd-embedding-atlas/` links at desktop and mobile widths.
  5. Docs workflow succeeds from a clean install with the frozen docs lockfile.

## Risks and Boundaries

- Sätteri is not a native Fumapress adapter. Keep its adapter local and narrow; do not migrate existing docs content.
- Fumapress beta is required because stable 0.7.3 lacks the glass export and current config API. Keep its exact Waku peer until Fumapress publishes a newer compatible beta.
- GitHub and Takumi wrappers exist only to handle unavailable metadata and GitHub Pages base paths; do not generalize them.
- TypeScript 7, a full Shadcn CLI initialization, AI chat, and MCP are outside this change.

## Sources

- [Fumapress configuration](https://press.fumadocs.dev/docs/config)
- [Fumapress MDX adapter](https://press.fumadocs.dev/docs/adapters/mdx)
- [Glass layout](https://press.fumadocs.dev/docs/layouts/glass)
- [Blog plugin](https://press.fumadocs.dev/docs/plugins/blog)
- [llms.txt plugin](https://press.fumadocs.dev/docs/plugins/llms.txt)
- [Takumi plugin](https://press.fumadocs.dev/docs/plugins/takumi)
- [Fumadocs themes](https://www.fumadocs.dev/docs/ui/theme)
- [Fumadocs component libraries](https://www.fumadocs.dev/docs/ui/component-library)
- [GitHub Info](https://www.fumadocs.dev/docs/ui/components/github-info)
- [Sätteri local Markdown](https://www.fumadocs.dev/docs/integrations/content/satteri-local-md)
