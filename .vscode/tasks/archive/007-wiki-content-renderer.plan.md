---
status: pending
---

# 007: Port Wiki Content Renderer and Markdown Viewer

## Summary
Port the content rendering pipeline (markdown viewer, syntax highlighting, mermaid diagrams, table of contents) from deep-wiki SPA client into the CoC Wiki tab.

## Motivation
The content renderer is the core wiki reading experience. Users need to view component documentation with rich markdown, code highlighting, and diagrams.

## Changes

### Files to Create
- `packages/coc/src/server/spa/client/wiki-content.ts` — Component/page loading and rendering
- `packages/coc/src/server/spa/client/wiki-markdown.ts` — Markdown processing (marked, hljs, mermaid)
- `packages/coc/src/server/spa/client/wiki-toc.ts` — Table of contents
- `packages/coc/src/server/spa/client/wiki-mermaid-zoom.ts` — Diagram zoom controls

### Files to Modify
- `packages/coc/src/server/spa/html-template.ts` — Add CDN script tags for marked, highlight.js, mermaid (lazy-loaded when Wiki tab active)
- `packages/coc/src/server/spa/client/index.ts` — Import and wire wiki content modules
- `packages/coc/src/server/spa/client/wiki.ts` (or the wiki tab module from 006) — Wire content renderer into wiki tab content area
- `packages/coc/src/server/spa/client/styles.css` — Add markdown content styles, code block styles, ToC styles, mermaid styles

### Files to Delete
- (none)

## Implementation Notes

### Content Loading (`wiki-content.ts`, ported from `content.ts`)

The deep-wiki `content.ts` implements a multi-page content loader with the following key functions:

1. **`showHome(skipHistory?)`** — Renders the wiki home page with project stats (component count, categories, language, build system) displayed as `.stat-card` elements in a `.project-stats` grid. Lists all components grouped by domain (if `componentGraph.domains` exists) or as a flat grid. Each component card shows name, complexity badge, and purpose. Uses `componentGraph` from `core.ts` for data.

2. **`loadComponent(componentId, skipHistory?)`** — Fetches component markdown via `GET /api/components/:componentId`, caches responses in a `markdownCache` record, then calls `renderComponentPage()`. Shows loading spinner while fetching. For CoC, the API path will be wiki-scoped (e.g., `/api/wikis/:wikiId/components/:componentId`).

3. **`renderComponentPage(mod, markdown)`** — Builds HTML with three sections:
   - A regenerate button (hidden by default, shown if `/api/admin/generate/status` reports available — **omit for CoC v1**, since regeneration requires the deep-wiki generate pipeline)
   - A collapsible source files section listing `mod.keyFiles` as `.source-pill` elements
   - The markdown body: calls `marked.parse(markdown)` to convert MD→HTML, inserts into `.markdown-body` div, then calls `processMarkdownContent()` and `buildToc()` for post-processing

4. **`loadSpecialPage(key, title, skipHistory?)`** — Fetches pre-generated pages (index, architecture, getting-started) from `GET /api/pages/:key`. Uses the same markdown cache pattern and calls `renderMarkdownContent()` + `buildToc()`.

5. **`loadThemeArticle(themeId, slug, skipHistory?)`** — Fetches theme-organized articles from `GET /api/themes/:themeId/:slug`. Same pattern: fetch → cache → `renderMarkdownContent()` + `buildToc()`.

6. **`toggleSourceFiles()`** — Toggles `.expanded` class on `#source-files` section (CSS-driven expand/collapse).

**CoC adaptation:** Strip `regenerateComponent()` and the admin regen check (not applicable in CoC). The browser history pushState calls should integrate with CoC's existing hash-based routing (`#wiki/:wikiId/component/:componentId`, `#wiki/:wikiId/page/:pageKey`, etc.) instead of deep-wiki's path-based approach. Store `componentGraph` and `markdownCache` in a CoC wiki state module rather than global `core.ts` state.

### Markdown Processing (`wiki-markdown.ts`, ported from `markdown.ts`)

The deep-wiki `markdown.ts` uses three CDN-loaded libraries (declared in `globals.d.ts`):

- **`marked`** — `marked.parse(markdown)` converts markdown to HTML. No custom renderer configuration; uses default marked behavior.
- **`hljs`** (highlight.js) — `hljs.highlightElement(block)` applied to each `<pre><code>` block that is NOT `language-mermaid`.
- **`mermaid`** — Initialized with `mermaid.initialize()` + `mermaid.run({ nodes })`.

Key functions:

1. **`renderMarkdownContent(markdown)`** — Calls `marked.parse(markdown)`, wraps in `.markdown-body` div, inserts into `#content`, then calls `processMarkdownContent()`.

2. **`processMarkdownContent()`** — Post-processes the rendered HTML:
   - Iterates `pre code` blocks inside `.markdown-body`
   - **Mermaid blocks** (`code.language-mermaid`): Replaces the `<pre><code>` with a `.mermaid-container` structure containing toolbar (zoom out `−`, zoom level `100%`, zoom in `+`, reset `⟲`) and a `.mermaid-viewport` > `.mermaid-svg-wrapper` > `pre.mermaid` with the raw mermaid code
   - **Code blocks** (all other languages): Calls `hljs.highlightElement(block)` then `addCopyButton(pre)` to add a "Copy" button
   - **Heading anchors**: Assigns kebab-case IDs to h1–h4, appends `a.heading-anchor` with `#` text
   - Calls `initMermaid()` to render all `.mermaid` blocks
   - **Internal `.md` link interception**: Adds click listener on `.markdown-body` that catches links ending in `.md`, strips path prefixes (`domains/*/components/`, `components/`), resolves to component IDs via `findComponentIdBySlugClient()`, and navigates via SPA

3. **`findComponentIdBySlugClient(slug)`** — Normalizes slug to kebab-case, matches against `componentGraph.components[].id`. For CoC, this enables internal wiki links to navigate between component articles.

4. **`addCopyButton(pre)`** — Appends a `button.copy-btn` ("Copy") to `<pre>` elements that writes code text to clipboard via `navigator.clipboard.writeText()`.

5. **`initMermaid()`** — Detects dark/light theme from `currentTheme` variable (considers `'auto'` + `prefers-color-scheme`), calls `mermaid.initialize({ startOnLoad: false, theme: isDark ? 'dark' : 'default', securityLevel: 'loose', flowchart: { useMaxWidth: false, htmlLabels: true, curve: 'basis' }, fontSize: 14 })`, then `mermaid.run({ nodes: blocks })`, and finally `initMermaidZoom()`.

### Mermaid Zoom (`wiki-mermaid-zoom.ts`, ported from `mermaid-zoom.ts`)

Constants: `MIN_ZOOM = 0.25`, `MAX_ZOOM = 4`, `ZOOM_STEP = 0.25`.

State per container: `{ scale, translateX, translateY, isDragging, dragStartX, dragStartY, lastTX, lastTY }`.

**`initMermaidZoom()`** — Iterates all `.mermaid-container` elements and attaches:
- **Zoom in/out buttons** (`.mermaid-zoom-in`, `.mermaid-zoom-out`): Increment/decrement `scale` by `ZOOM_STEP`, clamped to min/max. Updates `transform` CSS and zoom level display.
- **Reset button** (`.mermaid-zoom-reset`): Resets scale to 1, translate to 0,0.
- **Ctrl/Cmd + mouse wheel**: Zooms toward cursor position using pointer-relative coordinate math (calculates point under cursor, scales, then adjusts translation to keep that point stationary).
- **Mouse drag panning**: `mousedown` on viewport starts drag, `mousemove` on document updates translation, `mouseup` ends drag. Adds `.mermaid-dragging` class during drag.

Port as-is — this module is self-contained with no external dependencies beyond DOM queries on the `.mermaid-container` structure created by `processMarkdownContent()`.

### Table of Contents (`wiki-toc.ts`, ported from `toc.ts`)

1. **`buildToc()`** — Queries `#content .markdown-body` for `h2, h3, h4` headings (not h1). For each heading with an `id`, creates an `<a>` link in `#toc-nav` with:
   - `href="#<heading-id>"`
   - Text from heading content (strips trailing `#` from anchor text)
   - CSS class: `toc-h3` for h3, `toc-h4` for h4 (h2 has no extra class — base indent)
   - `onclick`: Prevents default, calls `target.scrollIntoView({ behavior: 'smooth', block: 'start' })`
   - Then calls `setupScrollSpy()`

2. **`setupScrollSpy()`** — Attaches a `scroll` listener on `#content-scroll` (the scrollable content wrapper).

3. **`updateActiveToc()`** — On scroll, iterates all h2/h3/h4 headings, finds the last heading whose `offsetTop - 80 <= scrollTop`, and applies `.active` class to the corresponding ToC link.

**CoC adaptation:** The `#toc-nav` and `#content-scroll` element IDs must exist in the Wiki tab's HTML structure. The ToC sidebar should be part of the wiki content area layout (a right-hand aside), matching deep-wiki's `.toc-sidebar` > `.toc-container` > `#toc-nav` structure.

### CDN Libraries (from `html-template.ts`)

The deep-wiki HTML template includes these CDN scripts in `<head>`:

```html
<!-- highlight.js 11.9.0 — syntax highlighting -->
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css" id="hljs-light">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css" id="hljs-dark" disabled>
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>

<!-- mermaid 10.x — diagram rendering -->
<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>

<!-- marked — markdown-to-HTML parser -->
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
```

The `hljs-dark` stylesheet starts with `disabled` attribute; the theme module toggles `disabled` on `hljs-light` / `hljs-dark` when switching themes.

**Lazy-loading strategy for CoC:** The CoC dashboard currently has zero CDN dependencies (all inline). To avoid loading ~300KB of libraries for users who never visit the Wiki tab:
- Add the CDN `<link>` and `<script>` tags to the HTML template but wrap them in a conditional or load them dynamically
- **Recommended approach:** Insert the tags into the HTML template only when `enableWiki` option is true (similar to how deep-wiki conditionally includes D3.js with `enableGraph`). The `generateDashboardHtml()` function gains an `enableWiki?: boolean` option.
- **Alternative:** Dynamically inject `<script>` tags on first Wiki tab activation, but this adds complexity (must await script load before rendering). Simpler to follow deep-wiki's pattern of conditional inclusion in the template.

### CSS Styles Required

Port these CSS sections from deep-wiki `styles.css` into a new `wiki-content.css` file (or append to CoC's existing `styles.css`):

1. **CSS variables** — The wiki content needs these variables (add to CoC's `:root` / dark theme):
   - `--code-bg`, `--code-border` (for code blocks)
   - `--copy-btn-bg`, `--copy-btn-hover-bg`
   - `--source-pill-bg`, `--source-pill-border`, `--source-pill-text`
   - `--toc-active`, `--toc-text`, `--toc-hover`
   - `--link-color`, `--content-border`, `--content-muted`
   - `--card-bg`, `--card-border`, `--card-hover-border`
   - `--stat-bg`, `--stat-border`

2. **`.markdown-body`** — Full typography styles (h1–h4 sizing/margins, paragraph spacing, inline code, pre/code blocks, tables, lists, blockquote, images, horizontal rules). ~45 lines.

3. **`.heading-anchor`** — Hidden by default, shown on hover. Positioned with padding-left, opacity transition.

4. **`.copy-btn`** — Positioned absolute top-right of `<pre>`, opacity 0 → 1 on `pre:hover`.

5. **`.source-files-section`** — Collapsible section with toggle arrow rotation on `.expanded`.

6. **`.toc-sidebar`** — Right-hand aside (~200px wide), sticky positioning. Contains `.toc-container` > `.toc-title` + `.toc-nav a` links with indent classes `.toc-h3` (27px) and `.toc-h4` (39px). Active state uses `--toc-active` color + left border.

7. **`.mermaid-container`** — Contains toolbar (flex row with zoom buttons) and viewport (overflow hidden, min-height 200px). `.mermaid-svg-wrapper` uses `transform-origin: 0 0` for zoom/pan. `.mermaid-dragging` sets `cursor: grabbing`.

8. **`.home-view`** — Project home with `.project-stats` grid (4-column repeat) of `.stat-card` items. `.component-grid` (3-column repeat) of `.component-card` items with hover effect.

9. **`.complexity-badge`** — Colored badge with variants `.complexity-high` (red), `.complexity-medium` (amber), `.complexity-low` (green).

10. **Responsive** — At small viewports, `.toc-sidebar` is hidden (`display: none`).

### TypeScript Globals Declaration

Add to CoC's client globals (or create `wiki-globals.d.ts`):

```typescript
declare const marked: { parse(md: string): string };
declare const hljs: { highlightElement(el: Element): void };
declare const mermaid: {
    initialize(config: Record<string, unknown>): void;
    run(opts: { nodes: NodeListOf<Element> }): Promise<void>;
};
```

These are CDN-loaded globals, not imported modules.

### Wiki Tab HTML Structure

The Wiki tab content area (from 006 scaffold) needs this structure to match the content/toc rendering expectations:

```html
<div id="wiki-content-scroll" class="content-scroll">
    <div class="content-layout">
        <article class="article">
            <div id="wiki-content" class="markdown-body">
                <!-- Rendered content goes here -->
            </div>
        </article>
        <aside class="toc-sidebar" id="wiki-toc-sidebar">
            <div class="toc-container">
                <h4 class="toc-title">On this page</h4>
                <nav id="toc-nav" class="toc-nav"></nav>
            </div>
        </aside>
    </div>
</div>
```

## Tests
- Test markdown rendering produces correct HTML (marked.parse call, `.markdown-body` wrapper)
- Test code block syntax highlighting (hljs.highlightElement called for non-mermaid blocks)
- Test mermaid diagram container construction (language-mermaid blocks replaced with `.mermaid-container`)
- Test copy button insertion on code blocks
- Test heading anchor generation (kebab-case IDs, `a.heading-anchor` appended)
- Test internal `.md` link interception and SPA navigation
- Test ToC generation from h2/h3/h4 headings (correct indentation classes)
- Test scroll spy active state tracking
- Test mermaid zoom controls (zoom in/out/reset, scale clamping)
- Test mermaid drag panning state management
- Test theme-aware mermaid initialization (dark vs default theme)
- Test lazy loading: CDN scripts only included when `enableWiki` is true

## Acceptance Criteria
- [ ] Component markdown renders with syntax highlighting
- [ ] Mermaid diagrams render and support zoom/pan
- [ ] Table of contents generated from headings with scroll spy
- [ ] Copy button on code blocks works
- [ ] Internal `.md` links navigate within SPA
- [ ] CDN libs conditionally included when wiki feature enabled
- [ ] Dark/light theme applied to code blocks (hljs-light/hljs-dark toggle)
- [ ] Home view shows project stats and component grid
- [ ] Source files section is collapsible
- [ ] CoC build succeeds

## Dependencies
- Depends on: 006 (Wiki tab scaffold with content area, sidebar navigation, wiki state)
