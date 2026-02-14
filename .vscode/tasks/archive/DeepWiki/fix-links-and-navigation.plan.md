# Fix Deep Wiki HTML: Internal Links & Back Navigation

## Problem

Two issues in the generated deep-wiki HTML page (`packages/deep-wiki/src/writing/website-generator.ts`):

1. **Internal `.md` links navigate to raw files** — Markdown articles contain links like `[Pipeline Core](./modules/pipeline-core.md)`. When `marked.js` renders them, they become `<a href="./modules/pipeline-core.md">` which causes the browser to navigate to the `.md` file on disk instead of loading the corresponding module within the SPA.

2. **Back button goes to default page** — There is no browser history management. The generated HTML is a single-page app but doesn't use `pushState`/`popstate`, so pressing the browser back button leaves the wiki entirely instead of going to the previous wiki page.

## Proposed Approach

All changes are in `packages/deep-wiki/src/writing/website-generator.ts`, specifically in the `getScript()` function that generates the client-side JavaScript.

### Fix 1: Intercept internal `.md` links

After `renderMarkdownContent()` renders HTML, add a click-event delegate on the content container that:
- Detects clicks on `<a>` tags whose `href` ends with `.md`
- Extracts the slug from the href (e.g., `./modules/pipeline-core.md` → `pipeline-core`)
- Looks up the corresponding module ID in `moduleGraph.modules` via slug matching
- If found, calls `loadModule(moduleId)` instead of navigating
- Also handles special pages (`index.md`, `architecture.md`, `getting-started.md`)
- Falls through to default browser behavior for external links

### Fix 2: Browser history with `pushState`/`popstate`

- In `loadModule()`, `showHome()`, and `loadSpecialPage()`, call `history.pushState()` with state data (e.g., `{ type: 'module', id: moduleId }`)
- Add a `popstate` event listener that reads `event.state` and navigates to the appropriate page
- Use `replaceState` for the initial `showHome()` call to avoid a double-entry

## Workplan

- [x] Add link interception logic in `renderMarkdownContent()` (delegate click handler on `#content`)
- [x] Add `history.pushState()` calls to `loadModule()`, `showHome()`, `loadSpecialPage()`
- [x] Add `popstate` event listener to handle back/forward navigation
- [x] Use `replaceState` for initial page load to avoid extra history entry
- [x] Add tests for the new link interception behavior (verify generated HTML contains the handler code)
- [x] Add tests for history management (verify generated HTML contains pushState/popstate code)
- [x] Run existing tests to ensure no regressions

## Notes

- The `findModuleIdBySlug` TypeScript function (line 1229) already exists on the server side but needs a client-side equivalent in the generated JS since the HTML is standalone.
- Module IDs in `MARKDOWN_DATA` map directly to module IDs in `MODULE_GRAPH.modules`, so slug matching logic needs to normalize both the href slug and module IDs.
- Links may use relative paths like `./modules/foo.md`, `../modules/bar.md`, or just `foo.md` — all patterns should be handled.
- The interception should be a delegated event listener on the `#content` element (not per-link) so it works for dynamically rendered content.
