---
status: pending
commit: "004-extract-client-js-deep-wiki"
depends_on:
  - "001"
  - "002"
---

# 004 — Extract deep-wiki Client JavaScript to Real TypeScript Source Files

## Objective

Convert the 10 string-returning script modules in `packages/deep-wiki/src/server/spa/scripts/`
into real `.ts` source files in a new `packages/deep-wiki/src/server/spa/client/` directory.
After this commit, the `client/` directory contains genuine TypeScript that esbuild (from commit 002)
can bundle into a single IIFE, replacing the runtime string concatenation in `script.ts`.

> This commit only creates the client source files and the entry point.
> It does **not** wire esbuild or modify `html-template.ts` — that happens in commit 006 (integration).

---

## Scope — File-by-File Mapping

| # | Old file (string-returning) | Lines | New file (real TS) | Key concerns |
|---|---|---|---|---|
| 1 | `scripts/core.ts` → `getCoreScript(defaultTheme)` | 61 | `client/core.ts` | `defaultTheme` injected via `window.__WIKI_CONFIG__`; declares global vars (`moduleGraph`, `currentModuleId`, `currentTheme`, `markdownCache`) |
| 2 | `scripts/theme.ts` → `getThemeScript()` | 73 | `client/theme.ts` | Theme toggle/persist, hljs stylesheet swap, sidebar collapse state |
| 3 | `scripts/sidebar.ts` → `getSidebarScript(opts)` | 279 | `client/sidebar.ts` | `enableSearch` / `enableGraph` flags → read from `window.__WIKI_CONFIG__`; area-based + category-based + topic sidebar builders |
| 4 | `scripts/content.ts` → `getContentScript(opts)` | 363 | `client/content.ts` | `enableAI` flag; `showHome`, `loadModule`, `renderModulePage`, `loadSpecialPage`, `loadTopicArticle`, `regenerateModule` with SSE |
| 5 | `scripts/markdown.ts` → `getMarkdownScript()` | 175 | `client/markdown.ts` | Uses CDN globals `marked`, `hljs`, `mermaid`; imports mermaid-zoom from `mermaid-zoom.ts`; SPA link interception |
| 6 | `scripts/toc.ts` → `getTocScript()` | 70 | `client/toc.ts` | TOC generation, scroll spy |
| 7 | `scripts/graph.ts` → `getGraphScript()` | 228 | `client/graph.ts` | Uses CDN global `d3`; force-directed graph, zoom, legend, drag handlers |
| 8 | `scripts/ask-ai.ts` → `getAskAiScript()` | 418 | `client/ask-ai.ts` | SSE streaming, conversation history, session management, Deep Dive, keyboard shortcuts |
| 9 | `scripts/websocket.ts` → `getWebSocketScript()` | 70 | `client/websocket.ts` | WebSocket live reload with reconnect backoff |
| 10 | `scripts/admin.ts` → `getAdminScript()` | 618 | `client/admin.ts` | Admin portal: tabs, seeds/config editors, phase-based generation SSE, Phase 4 module list |
| — | *(new)* | — | `client/globals.d.ts` | CDN global type declarations |
| — | *(new)* | — | `client/index.ts` | Entry point: reads `window.__WIKI_CONFIG__`, calls init, conditionally activates modules |

**Total lines of string-returning JS to convert: ~2355** (excluding the assembler and mermaid-zoom)

---

## Detailed Plan

### Step 1 — Create `client/globals.d.ts`

Declare the CDN-loaded globals that the client code references without importing:

```ts
// CDN globals loaded via <script> tags in html-template.ts
declare const marked: { parse(md: string): string };
declare const hljs: { highlightElement(el: Element): void };
declare const mermaid: {
    initialize(config: any): void;
    run(opts: { nodes: NodeListOf<Element> }): Promise<void>;
};
declare const d3: any;

// Config injected by the server into a <script> tag before the bundle
interface WikiConfig {
    defaultTheme: string;
    enableSearch: boolean;
    enableAI: boolean;
    enableGraph: boolean;
    enableWatch: boolean;
}

interface Window {
    __WIKI_CONFIG__: WikiConfig;
}
```

### Step 2 — Create `client/core.ts`

Extract from `scripts/core.ts` → `getCoreScript(defaultTheme)`.

**Changes from string version:**
- `currentTheme` initialised from `window.__WIKI_CONFIG__.defaultTheme` instead of template literal `'${defaultTheme}'`
- Global vars declared at module scope (they are `var` in the original → remain as `var` or become `let` at IIFE scope)
- `init()` call happens from `client/index.ts`, not inline
- `escapeHtml()` is a plain function (already is)
- `popstate` handler stays as-is

**Functions exported (to be called from other modules):**
- `init()` — must be exported or called from `index.ts`
- `escapeHtml(str)` — used by sidebar, content, graph, ask-ai, admin
- Globals: `moduleGraph`, `currentModuleId`, `currentTheme`, `markdownCache` — exposed on `window` or exported

**Design decision — global state:** The original code puts everything in one `<script>` scope.
In the esbuild IIFE bundle, all modules share IIFE scope if they use `var` at top level.
However, with TypeScript modules, each file has its own scope.
**Approach:** Declare shared state in `core.ts` and export it. Other modules import from `core.ts`.
For functions that are called from inline `onclick` handlers in HTML strings (e.g., `loadModule`, `showGraph`, `showHome`), attach them to `window` in `index.ts`.

### Step 3 — Create `client/theme.ts`

Extract from `scripts/theme.ts` → `getThemeScript()`.

**Changes:**
- References to `currentTheme` → import from `core.ts`
- `initTheme()`, `toggleTheme()`, `updateThemeStyles()` become real functions
- Event listeners at module top level → move to an `initTheme()` or keep at module scope (they run when the bundle loads, same as before)
- Sidebar collapse handler and `restoreSidebarState` IIFE stay as-is

**Exports:** `initTheme`, `toggleTheme`, `updateThemeStyles`, `updateSidebarCollapseBtn`

### Step 4 — Create `client/sidebar.ts`

Extract from `scripts/sidebar.ts` → `getSidebarScript(opts)`.

**Changes:**
- Feature flags `enableSearch`, `enableGraph` → read from `window.__WIKI_CONFIG__`
- Calls `escapeHtml()` → import from `core.ts`
- References `moduleGraph` → import from `core.ts`
- Builds DOM for area-based, category-based, and topic sidebar navigation
- `setActive()`, `showWikiContent()`, `showAdminContent()` used by content/admin → export

**Conditional code patterns:**
- The old code conditionally *includes* search event listener and graph nav item via string interpolation
- New code: always include the code, but wrap in `if (config.enableSearch) { ... }` / `if (config.enableGraph) { ... }` runtime checks

**Exports:** `initializeSidebar`, `setActive`, `showWikiContent`, `showAdminContent`, `buildTopicsSidebar`

### Step 5 — Create `client/content.ts`

Extract from `scripts/content.ts` → `getContentScript(opts)`.

**Changes:**
- `enableAI` flag → read from `window.__WIKI_CONFIG__`
- Calls to `setActive`, `showWikiContent` → import from `sidebar.ts`
- Calls to `processMarkdownContent`, `buildToc` → import from `markdown.ts` and `toc.ts`
- Calls to `updateAskSubject`, `addDeepDiveButton` → conditionally import from `ask-ai.ts`
- `escapeHtml`, `moduleGraph`, `currentModuleId`, `markdownCache` → import from `core.ts`
- `renderModulePage` renders `marked.parse(markdown)` → `marked` is a CDN global (declared in `globals.d.ts`)
- SSE streaming for `regenerateModule` stays as-is
- Note: There's a stray `}` at line 293 in the original — appears to be a closing brace for `regenerateModule`. Verify and fix if it's a bug.

**Conditional code patterns:**
- `updateAskSubject(...)` calls guarded by `if (config.enableAI)`
- `addDeepDiveButton(...)` call guarded by `if (config.enableAI)`

**Exports:** `showHome`, `loadModule`, `renderModulePage`, `loadSpecialPage`, `loadTopicArticle`, `toggleSourceFiles`, `regenerateModule`

### Step 6 — Create `client/markdown.ts`

Extract from `scripts/markdown.ts` → `getMarkdownScript()`.

**Changes:**
- Uses CDN globals `marked`, `hljs`, `mermaid` — no change needed (declared in `globals.d.ts`)
- Imports `getMermaidZoomScript()` from `../../../rendering/mermaid-zoom` — this returns a string of JS code that gets concatenated. **This is the trickiest part**: the mermaid-zoom code must be inlined.
  - **Option A:** Copy the mermaid-zoom JS content directly into `client/markdown.ts` as real code
  - **Option B:** Keep mermaid-zoom as a string import and use `eval()` (bad)
  - **Option C:** Create a `client/mermaid-zoom.ts` that is real code extracted from the mermaid-zoom module's script string
  - **Recommended: Option C** — create `client/mermaid-zoom.ts` with the zoom/pan logic as real TypeScript, then import and call `initMermaidZoom()` from `client/markdown.ts`
- `renderMarkdownContent()`, `processMarkdownContent()`, `findModuleIdBySlugClient()`, `addCopyButton()`, `initMermaid()` → export
- SPA link interception (click handler on `.markdown-body`) references `loadModule`, `loadSpecialPage` → import from `content.ts` (creates circular concern — resolve by attaching to window or by having content.ts register the handler)

**Circular dependency concern:**
- `markdown.ts` → needs `loadModule`, `loadSpecialPage` (from `content.ts`)
- `content.ts` → needs `processMarkdownContent`, `buildToc` (from `markdown.ts` / `toc.ts`)
- **Resolution:** The SPA link click handler in `processMarkdownContent` calls `loadModule`/`loadSpecialPage` which are on `window`. So no import needed — just `(window as any).loadModule(...)`.

**Exports:** `renderMarkdownContent`, `processMarkdownContent`, `findModuleIdBySlugClient`, `addCopyButton`, `initMermaid`

### Step 7 — Create `client/mermaid-zoom.ts`

Extract the JS content from `getMermaidZoomScript()` in `packages/deep-wiki/src/rendering/mermaid-zoom.ts` into real TypeScript.

**Source:** ~113 lines of zoom/pan logic (constants, `initMermaidZoom()`, per-container state, wheel zoom, drag pan, button handlers).

**Exports:** `initMermaidZoom`

### Step 8 — Create `client/toc.ts`

Extract from `scripts/toc.ts` → `getTocScript()`.

**Changes:** Minimal — no parameters, no conditionals, no CDN globals.

**Exports:** `buildToc`, `setupScrollSpy`, `updateActiveToc`

### Step 9 — Create `client/graph.ts`

Extract from `scripts/graph.ts` → `getGraphScript()`.

**Changes:**
- Uses CDN global `d3` (declared in `globals.d.ts`)
- References `escapeHtml`, `moduleGraph`, `currentModuleId` → import from `core.ts`
- References `setActive`, `loadModule` → import from `sidebar.ts` / `content.ts` (or use `window.loadModule`)
- `showGraph` is called from sidebar onclick and popstate → attach to `window`

**Exports:** `showGraph`, `renderGraph`, `updateGraphVisibility`

### Step 10 — Create `client/ask-ai.ts`

Extract from `scripts/ask-ai.ts` → `getAskAiScript()`.

**Changes:**
- References `escapeHtml`, `moduleGraph` → import from `core.ts`
- References `loadModule`, `loadTopicArticle` → use `window` globals
- CDN global `marked` used for rendering assistant messages
- CDN global `hljs` used for code highlighting in Deep Dive results
- Keyboard shortcuts (Ctrl+B, Ctrl+I, Escape) → keep at module scope
- Widget DOM selectors assume elements exist → guard with null checks

**Exports:** `updateAskSubject`, `expandWidget`, `collapseWidget`, `addDeepDiveButton`

### Step 11 — Create `client/websocket.ts`

Extract from `scripts/websocket.ts` → `getWebSocketScript()`.

**Changes:**
- References `markdownCache`, `currentModuleId`, `loadModule` → import from `core.ts` / use `window`
- `connectWebSocket()` called immediately at module scope → call from `index.ts` instead

**Exports:** `connectWebSocket`

### Step 12 — Create `client/admin.ts`

Extract from `scripts/admin.ts` → `getAdminScript()`.

**Changes:**
- References `currentModuleId`, `escapeHtml`, `moduleGraph` → import from `core.ts`
- References `showHome`, `showAdminContent` → import from `sidebar.ts` / `content.ts` (or `window`)
- References `loadModule` → `window.loadModule`
- `showAdmin` called from popstate handler in `core.ts` → attach to `window`
- `formatDuration` is a utility → could move to core, but keeping in admin is fine since it's only used there and in content's `regenerateModule`
  - Actually, `formatDuration` is only in admin.ts. Keep it there.

**Exports:** `showAdmin`, `formatDuration`

### Step 13 — Create `client/index.ts` (Entry Point)

The entry point that esbuild bundles as an IIFE.

```ts
import { init, escapeHtml } from './core';
import { initTheme, toggleTheme } from './theme';
import { initializeSidebar, setActive, showWikiContent, showAdminContent } from './sidebar';
import { showHome, loadModule, loadSpecialPage, loadTopicArticle, toggleSourceFiles, regenerateModule } from './content';
import { renderMarkdownContent, processMarkdownContent } from './markdown';
import { buildToc } from './toc';
import { showGraph } from './graph';
import { updateAskSubject, addDeepDiveButton } from './ask-ai';
import { connectWebSocket } from './websocket';
import { showAdmin } from './admin';

// Read config injected by server
const config = window.__WIKI_CONFIG__;

// Expose functions used by inline onclick handlers in dynamically-built HTML
(window as any).loadModule = loadModule;
(window as any).showHome = showHome;
(window as any).showGraph = showGraph;
(window as any).showAdmin = showAdmin;
(window as any).loadSpecialPage = loadSpecialPage;
(window as any).loadTopicArticle = loadTopicArticle;
(window as any).toggleSourceFiles = toggleSourceFiles;
(window as any).escapeHtml = escapeHtml;
(window as any).regenerateModule = regenerateModule;

// Initialize
init();

// Conditionally start optional modules
if (config.enableWatch) {
    connectWebSocket();
}
```

**Key design decisions:**
1. Functions referenced in `onclick="..."` strings in dynamically-built HTML (e.g., `onclick="loadModule('...')"`) must be on `window`
2. The `init()` call was previously at the top of the concatenated script — now it's explicit
3. Feature-flag checks for `enableGraph`, `enableAI`, `enableWatch` happen at the module level (guarded in each module's init code) and in `index.ts` for top-level wiring

---

## Cross-Module Dependency Graph

```
index.ts ──→ core.ts (state + init + escapeHtml)
    │   ──→ theme.ts (initTheme, toggleTheme)
    │   ──→ sidebar.ts (initializeSidebar, setActive, showWikiContent/AdminContent)
    │   ──→ content.ts (showHome, loadModule, loadSpecialPage, loadTopicArticle)
    │   ──→ markdown.ts (renderMarkdownContent, processMarkdownContent)
    │   │        └──→ mermaid-zoom.ts (initMermaidZoom)
    │   ──→ toc.ts (buildToc)
    │   ──→ graph.ts (showGraph)          [conditional: enableGraph]
    │   ──→ ask-ai.ts (updateAskSubject)  [conditional: enableAI]
    │   ──→ websocket.ts (connectWebSocket) [conditional: enableWatch]
    │   ──→ admin.ts (showAdmin)

core.ts ←── imported by: theme, sidebar, content, markdown, graph, ask-ai, websocket, admin
sidebar.ts ←── imported by: content, admin
toc.ts ←── imported by: content, markdown
```

---

## CDN Globals Summary

| Global | CDN source (from `html-template.ts`) | Used in client modules |
|---|---|---|
| `hljs` | `highlight.js@11.9.0` | `markdown.ts` (highlightElement), `ask-ai.ts` (Deep Dive results) |
| `mermaid` | `mermaid@10` | `markdown.ts` (initialize + run) |
| `marked` | `marked` (latest) | `markdown.ts` (parse), `content.ts` (renderModulePage), `ask-ai.ts` (streaming render) |
| `d3` | `d3@7` (conditional) | `graph.ts` (force layout, zoom, drag) |

All declared in `client/globals.d.ts` so TypeScript doesn't complain.

---

## Config Injection Pattern

Server-side (`html-template.ts`) will inject a `<script>` tag before the bundle:

```html
<script>
window.__WIKI_CONFIG__ = {
    defaultTheme: "${theme}",
    enableSearch: ${enableSearch},
    enableAI: ${enableAI},
    enableGraph: ${enableGraph},
    enableWatch: ${enableWatch}
};
</script>
<script src="/assets/wiki.js"></script>
```

> This wiring is done in commit 006 (integration), not this commit.

---

## Window Globals Required

Functions referenced by dynamic `onclick` attributes in HTML strings built at runtime:

| Function | Called from |
|---|---|
| `loadModule(id)` | Sidebar nav items, home module cards, graph node click, ask-ai context links, admin module regen |
| `showHome()` | Sidebar "Overview" item |
| `showGraph()` | Sidebar "Dependency Graph" item |
| `showAdmin()` | Popstate handler |
| `loadSpecialPage(key, title)` | Markdown link interception |
| `loadTopicArticle(topicId, slug)` | Sidebar topic items, ask-ai context links |
| `toggleSourceFiles()` | Module page "Relevant source files" toggle |
| `escapeHtml(str)` | Used in dynamic HTML building across modules |
| `regenerateModule(id)` | Module page regenerate button |
| `runModuleRegenFromAdmin(id)` | Admin Phase 4 module list run buttons |

---

## Mermaid-Zoom Handling

The `scripts/markdown.ts` file calls `getMermaidZoomScript()` which returns ~113 lines of JS as a string from `packages/deep-wiki/src/rendering/mermaid-zoom.ts`.

**Plan:** Create `client/mermaid-zoom.ts` containing the zoom/pan logic as real TypeScript:
- Extract the code from `getMermaidZoomScript()` return value
- Convert `var` declarations to `let`/`const` as appropriate
- Export `initMermaidZoom()`
- Import in `client/markdown.ts` and call after `mermaid.run()`

The original `rendering/mermaid-zoom.ts` module is **not modified** — it continues to serve the static website generator which still uses string concatenation. The client version is a parallel real-code copy.

---

## Differences from Commit 003 (pipeline-cli)

| Aspect | pipeline-cli (003) | deep-wiki (004) |
|---|---|---|
| Script modules | 8 | 10 (+markdown, graph, ask-ai, admin; −detail, filters, queue, utils) |
| CDN globals | none | `marked`, `hljs`, `mermaid`, `d3` |
| Feature flags | `enableWatch` only | `enableSearch`, `enableAI`, `enableGraph`, `enableWatch` |
| Conditional script inclusion | WebSocket only | Graph, Ask AI, WebSocket |
| Config object name | `window.__PIPELINE_CONFIG__` | `window.__WIKI_CONFIG__` |
| Mermaid zoom | n/a | Needs `client/mermaid-zoom.ts` extracted from shared module |
| Admin portal | n/a | Full admin with tabs, editors, SSE phase generation |
| Total JS lines | ~1100 | ~2355 |

---

## Files Created (this commit)

```
packages/deep-wiki/src/server/spa/client/
├── globals.d.ts       — CDN global type declarations + WikiConfig interface
├── index.ts           — Entry point: config read, window globals, init
├── core.ts            — Global state, init(), escapeHtml(), popstate handler
├── theme.ts           — Theme toggle, hljs swap, sidebar collapse
├── sidebar.ts         — Area/category/topic navigation builders
├── content.ts         — Page loading: home, module, special, topic + regenerate
├── markdown.ts        — Markdown rendering, mermaid init, link interception
├── mermaid-zoom.ts    — Mermaid diagram zoom/pan controls
├── toc.ts             — Table of contents, scroll spy
├── graph.ts           — D3 force-directed dependency graph
├── ask-ai.ts          — AI Q&A widget, SSE streaming, Deep Dive
├── websocket.ts       — WebSocket live reload
└── admin.ts           — Admin portal: tabs, seeds/config, phase generation
```

## Files NOT Modified (this commit)

- `packages/deep-wiki/src/server/spa/scripts/*.ts` — old string-returning modules kept intact
- `packages/deep-wiki/src/server/spa/script.ts` — assembler kept intact
- `packages/deep-wiki/src/server/spa/html-template.ts` — not modified until commit 006
- `packages/deep-wiki/src/rendering/mermaid-zoom.ts` — shared module kept intact

---

## Testing Strategy

1. **TypeScript compilation:** `cd packages/deep-wiki && npx tsc --noEmit` — all new client files must compile cleanly
2. **No runtime test yet** — the client files are not wired into the HTML template until commit 006
3. **Existing tests unaffected** — no old files modified, `npm run test:run` in `packages/deep-wiki/` must still pass
4. **Manual inspection:** Verify each client file's exports match what `index.ts` imports
5. **Verify `globals.d.ts`** includes all CDN globals referenced across client files

---

## Estimated Effort

~2–3 hours. Larger than commit 003 due to:
- 10 modules vs 8
- CDN globals needing type declarations
- Mermaid-zoom extraction
- More complex feature-flag conditional patterns
- Admin portal is the largest single module (~618 lines)
