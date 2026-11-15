# canvas/html-export

Client-side export of one self-contained `.html` snapshot. The raw `content` download in `useCanvasExport` stays the re-import path. Kusto has no HTML export.

## Layers

| Layer | File | Role |
|-------|------|------|
| A | `buildCanvasHtmlDocument.ts` | Pure serializer. Inlines CSS and image data URIs. Source sits in a non-rendering `<script id="source">`. Extension body is shipped verbatim. |
| B | `assets.ts` | `collectImageRefs` / `resolveAssets`. A failed fetch is a warning, not a throw. `resolveLibraryBundles` inlines `/canvas-vendor/*`. |
| C | `mermaid.ts` | Injected `api.render` to inline SVG. Runtime is not shipped. Failure becomes a code block plus a warning. |
| D | `excalidraw.ts` | Injected `exportToSvg`. This file does not import Excalidraw. |
| D-ext | `extension.ts` | Offline iframe, `allow-scripts` only. `invoke` / `setState` reject with `code: 'offline'` and a pre-attached `catch`. `capabilitiesJs` is never shipped. Host comes from `CANVAS_HOST_METHODS`. JSX inlines bundles ahead of `extension-runtime` with no `assetBase`. |
| E | `exportCanvasAsHtml.ts` | Markdown is B→C→bake→A. Code is A. Excalidraw is D→A. Extension is D-ext→A. Never throws. Missing extension UI is `{ok:false}`. |
| F | `htmlExportDeps.ts`, `useCanvasExport.ts` | Production deps. `exportToSvg` and mermaid are lazy imports. Extension UI is fetched with the workspace-routed client. |

`ExportCanvasAsHtmlDeps` injects `renderMarkdown`, `fetch`, `mermaidApi`, `exportToSvg`, `triggerDownload`, and optional `getMathCss`. Markdown math CSS comes from `getExportKatexCss` (`shared/math/katexCssExtract.ts`), which reads already-inlined `data:` font rules. A throwing provider ships unstyled math.

## Constraints

- `@excalidraw/excalidraw` cannot load under Node ≥ 24. Do not import it from a node test.
- No `Date.now()` or `Math.random()`. Same canvas, same bytes.
- Output must work from `file://` with no `/api/…`, `.attachments/`, external stylesheet or script, or absolute filesystem path. The only permitted `http(s)://` strings are XML namespaces.

## Tests

`packages/coc/test/server/spa/client/canvas/`, vitest project `node`. jsdom is per-file where DOM is required.

`npx vitest run --project node test/server/spa/client/canvas/htmlExportPipeline.test.ts`

Client typecheck: `npx tsc -p tsconfig.client.json --noEmit`.
