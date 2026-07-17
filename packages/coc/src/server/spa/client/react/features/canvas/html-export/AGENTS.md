# canvas/html-export

Exports any canvas to a **single, self-contained `.html` file** that opens in any
browser with zero tooling and zero network — a one-way viewing snapshot (the raw
`content` download in `CanvasPanel` stays for re-import). The exporter runs
**client-side** because all four renderers (`marked`, `highlight.js`, `mermaid`,
`@excalidraw/excalidraw`) are browser-bound; the logic is split into a pure core
plus thin, injected I/O adapters so every layer unit-tests in isolation.

## Layers (build order = dependency order)

| Layer | File | Role |
|-------|------|------|
| **A** | `buildCanvasHtmlDocument.ts` | Pure, Node-safe, deterministic serializer. Assembles the standalone doc: doctype, inlined `<style>` (`styles.ts`), body with every `<img>` src rewritten to its data URI, and the source in a non-rendering `<script id="source">`. Highlights `code` canvases itself; ships the `extension` body **verbatim** (no image rewrite — its `<img>`s live inside the escaped iframe `srcdoc`). Never touches the DOM/network. |
| **B** | `assets.ts` | `collectImageRefs(html)` (pure) finds local image refs (proxy URLs, `data-local-path`, `.attachments/…`); `resolveAssets(refs, fetchFn)` fetches each via the **injected** `fetchFn` → base64 `data:` URI. A failed fetch is omitted + warned, never thrown — Layer A supplies the placeholder. |
| **C** | `mermaid.ts` | `inlineMermaid(html, api)` replaces mermaid blocks (both forge's `.mermaid-container` markup and plain `language-mermaid`) with the diagram rendered to inline `<svg>` via the **injected** `api.render`. Runtime is **not** shipped. Render failure → source code block + warning. |
| **D** | `excalidraw.ts` | `excalidrawToInlineSvg(sceneJson, exportToSvg)` rasterizes a scene to inline `<svg>` (scene `files` inlined too). **Excalidraw-free by construction** (see constraint below); the real `exportToSvg` is injected. Empty/invalid scene → placeholder, no crash. |
| **D-ext** | `extension.ts` | `buildExtensionExportBody({uiHtml, stateContent, title, revision?})` (pure) builds the offline VIEW-ONLY extension body: a view-only banner + a sandboxed `<iframe srcdoc>` (`allow-scripts` only) hosting `uiHtml` with an offline `CanvasHost` — `onState` delivers the frozen state synchronously, `invoke`/`setState` are inert no-ops, `capabilitiesJs` never shipped. Neutralizes external `<script src>`/`<link>` + warns on residual network URLs. Malformed state → `{}` + warning, never throws. |
| **E** | `exportCanvasAsHtml.ts` | Orchestrator. Dispatches by type — markdown → B→C→bake→A, code → A, excalidraw → D→A, extension → D-ext→A (needs the separately-fetched `canvas.extension` UI; missing → `{ok:false}`, no download). Builds the Blob + triggers `<slug(title)>.html` download. Also exports `refToUrl`, `htmlExportFilename`, `browserDownload`, the `ExtensionExportSource` type. **Never throws.** |
| E-helper | `codeHighlight.ts` | `highlightMarkdownCodeBlocks(html)` — pure/Node-safe. Pre-bakes hljs spans into `chatMarkdownToHtml`'s `language-X` blocks so the embedded theme CSS colours code offline. Skips unknown langs + `mermaid`. |
| **F** | `htmlExportDeps.ts` + `../CanvasPanel.tsx` | `createHtmlExportDeps()` builds the production `ExportCanvasAsHtmlDeps` (browser-only). `CanvasPanel` adds an enabled "Export as HTML" menu item for **every** type. For `extension` it first fetches the separately-stored UI doc via the workspace-routed `useCocClient(ws).canvases.getExtension` (clone-aware; `capabilitiesJs` is dropped, never shipped) and passes `extension:{uiHtml, revision}` into the orchestrator; a fetch failure surfaces an error toast and aborts before any download. |
| shared | `types.ts`, `styles.ts` | Layer-A input/result types + `CanvasHtmlExportType`; `BASE_CSS`, `HLJS_THEME_CSS` (github-light), `BROKEN_IMAGE_PLACEHOLDER` (URL-encoded SVG data URI). |

## Injected-deps contract (Layer E)

`exportCanvasAsHtml(canvas: ExportableCanvas, deps: ExportCanvasAsHtmlDeps)` — E
imports none of the browser-only libraries; **all** capabilities are injected so
the orchestrator (and every layer) unit-tests with plain mocks:

```
ExportCanvasAsHtmlDeps = {
  renderMarkdown(content, wsId) -> html   // prod: chatMarkdownToHtml
  fetch(url) -> AssetFetchResponse         // prod: DOM fetch
  mermaidApi: { render(id, code) -> {svg} }// prod: lazy mermaid.render
  exportToSvg(opts) -> SVG                  // prod: lazy @excalidraw/excalidraw
  triggerDownload(filename, html) -> void  // prod: browserDownload
}
```

`htmlExportDeps.ts` supplies the real ones; `exportToSvg` and `mermaidApi` are
**lazy dynamic imports** so the Node-unloadable runtimes stay out of test graphs.

## Hard constraints

- **`@excalidraw/excalidraw` cannot load under Node ≥ 24** (open-color
  import-attribute error). The whole export test suite runs in the vitest **node**
  project, so: Layer D is excalidraw-free, `htmlExportDeps` loads excalidraw via a
  lazy `await import(...)`, and the CanvasPanel test partial-mocks
  `exportCanvasAsHtml`. Never pull a real-excalidraw module into a node test.
- **Determinism**: no `Date.now()` / `Math.random()` anywhere. Same canvas →
  byte-identical output (asserted by the Layer-G determinism test).
- **Portability contract** (enforced by tests): the output must render fully
  offline via `file://` and contain **no** external reference — no `/api/…`
  proxy URL, no `.attachments/` ref, no external `<link rel=stylesheet>` /
  `<script src>`, and **no absolute local filesystem path** (Linux/macOS/Windows).
  The only permitted `http(s)://` strings are XML namespaces
  (`http://www.w3.org/…`), which are not network fetches.

## Tests

All under `packages/coc/test/server/spa/client/canvas/`, all in the vitest
**node** project (jsdom is opted into per-file with a top `/** @vitest-environment
jsdom */` pragma where `FileReader`/`Blob`/DOM/`XMLSerializer`/React render are
needed — B, D, E, F, and the Layer-G pipeline use it; A, C, code-highlight don't).

- Per-layer: `buildCanvasHtmlDocument` (A), `assets` (B), `mermaid` (C),
  `excalidraw` (D), `extension` (D-ext), `exportCanvasAsHtml` (E),
  `codeHighlight` (E-helper), `CanvasPanel.test.tsx` (F cases at the end).
- `htmlExportPipeline.test.ts` (**G**) — full-pipeline integration: real E over
  real A/B/C + `chatMarkdownToHtml`, only `fetch`/`mermaidApi`/`exportToSvg`
  stubbed. Asserts the full portability contract on a doc with an image +
  mermaid + code + table. A second suite drives the real E → D-ext → A extension
  path: a state-rendering UI in the offline sandboxed iframe, asserting
  allow-scripts-only sandbox, inert offline `CanvasHost`, frozen state visible in
  the `srcdoc`, no `capabilitiesJs`/network, byte-identical determinism, plus a
  dirty-UI case (external `<script src>`/`<link>` neutralized with warnings, still
  exports). Keep every string assertion path-separator agnostic.

Run one file / the whole dir (from `packages/coc`):

```
npx vitest run --project node test/server/spa/client/canvas/htmlExportPipeline.test.ts
npx vitest run --project node test/server/spa/client/canvas/
```

Client typecheck (the base tsconfig excludes `src/**/client`):
`npx tsc -p tsconfig.client.json --noEmit` — carries pre-existing reds elsewhere,
so grep your filename to prove no new errors.
