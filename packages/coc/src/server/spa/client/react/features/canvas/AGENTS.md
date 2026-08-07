# features/canvas

The chat-linked canvas side panel: an AI-and-user co-edited document that also
renders as code, an SVG, an Excalidraw scene, a sandboxed extension UI, or a
live Kusto query.

`CanvasPanel.tsx` is a **composition root only** — public props, the
workspace-routed client, fullscreen chrome, layout. Behavior lives in kernels
and presentational components. Add new behavior to a kernel, new pixels to a
component; do not grow `CanvasPanel.tsx` back.

## Layout

| File | Role |
|------|------|
| `CanvasPanel.tsx` | Composition root. Resolves `useCocClient(workspaceId)` **once** and passes it into every kernel. Owns `mode`, fullscreen, and the inline-image context menu. |
| `canvas-panel-model.ts` | Pure, React-free: `buildAskAiPrompt`, `buildCommentsMessage`, `isSvgCodeCanvas`, `downloadFilenameFor`, `notesPathFor`, `monacoLanguageFor`, `fenceCode`, `canvasKind`, `previewMarkdownFor`, `saveStatusLabel`, `AUTOSAVE_DELAY_MS`, `ViewMode`/`SaveState`. |
| `hooks/useCanvasRecord.ts` | The data kernel. Load on mount/canvas switch, `reloadNonce` forced reload (skipped while dirty), live `canvas-updated` reconciliation, debounced revision-checked autosave, 409 → `conflict`. Exposes `canvasRef` (timer-safe) and `loadNonce`. |
| `hooks/useCanvasVersions.ts` | Version stepper + restore-as-latest (writes a NEW revision, never rewrites history). |
| `hooks/useCanvasComments.ts` | Selection anchoring, comment CRUD, batch send-to-AI via the host's `onSendToAi` follow-up path. |
| `hooks/useCanvasExport.ts` | Copy / download / save-to-Notes / export-as-HTML. Browser primitives (`copyText`, `downloadBlob`) are injectable via `deps`. |
| `hooks/useCreateKustoCanvas.ts` | AC-07 blank Kusto canvas creation with best-effort cluster/database prefill. |
| `components/` | `CanvasPanelHeader` (title switcher, badges, version stepper, export menu, chrome), `CanvasPanelBanners`, `CanvasBodyRenderer`, `CanvasSelectionToolbar`, `CanvasCommentsPanel`, `icons.tsx`. |
| `ExtensionCanvasView.tsx`, `KustoView.tsx`, `KustoChart.tsx`, `SvgCanvasView.tsx` | Per-type interactive views mounted by `CanvasBodyRenderer`. |
| `extension-runtime.ts` | Pure string builders for the in-iframe runtime of a **JSX-authored** extension: the root element, the sequential library loader (classic `<script src>` / `<link>` at absolute URLs), and the runner that executes the compiled `ui.js` and calls `window.CanvasExtension.mount(rootEl, CanvasHost)`. Shared verbatim by the live view and the offline export — the export just omits `assetBase` because its bundles are already inlined. Every failure (load error, missing global, absent `CanvasExtension`, throwing `mount`) paints an in-frame banner **and** posts `extension-error` to the host. No DOM, no fetch, Node-safe. |
| `canvas-host-protocol.ts` | Single definition of the `window.CanvasHost` bridge contract: `CANVAS_HOST_VERSION` (2), `CANVAS_HOST_REQUEST_TIMEOUT_MS` (60s), and the `CanvasHostError` `{ code, message }` shape with codes `offline` / `timeout` / `revision-conflict` / `capability-error`. No React, no DOM, no imports — the offline export bootstrap must stay pure and Node-safe, and both bootstraps read the version from here so they cannot drift. |
| `kustoCreate.ts`, `html-export/` | Kusto seed helpers; the self-contained HTML export pipeline (own AGENTS.md). |

## Rules that must not regress

- **Clone routing (AC-07).** `useCocClient(workspaceId)` is resolved only in
  `CanvasPanel` and passed down. A kernel that imports `getSpaCocClient` itself
  would break remote workspaces while every same-origin test still passed —
  `CanvasPanel-remote-workspace.test.tsx` exists to catch exactly that.
- **Never clobber a dirty draft.** A newer live AI revision while dirty sets
  `remoteUpdatePending` (banner) instead of reloading; `reloadNonce` is ignored
  while dirty. Only an explicit "Load latest" discards local edits.
- **Autosave keeps the dirty mark** when the user typed while the save was in
  flight (`draftRef` compare), and echoes the saved canvas with the *local*
  content so the server response cannot overwrite what was typed.
- **`loadNonce`, not a callback**, drives the best-effort version/comment
  refetches, so every load path (initial, live update, conflict reload, pop-out
  focus) refreshes them like the original single load did. It starts at `0` and
  bumps only on a **successful** load; kernels skip fetching at `0`.
- **History views are read-only.** With `viewingVersion` set, no edit branch is
  reachable and the selection toolbar is hidden.
- **The CanvasHost bridge stays backwards compatible.** `invoke`/`setState`
  return promises settled by a correlated `{ type: 'response', id, ok,
  result | error }` reply, but a message that arrives with **no `id`** is a
  pre-v2 sender and must still be serviced in full — the host just posts no reply
  for it. Dropping id-less messages would silently break every extension already
  on disk. Every unhandled request path answers (or times out at
  `CANVAS_HOST_REQUEST_TIMEOUT_MS`) rather than leaving a promise pending, and a
  failed capability both rejects the extension's promise and shows the banner.
- **An extension frame is never blank.** The iframe is `sandbox="allow-scripts"`
  with no `allow-same-origin`, so it is an opaque origin: module scripts, import
  maps and `fetch` get no `Access-Control-Allow-Origin` from CoC's
  loopback-only CORS policy and are blocked. Vendored libraries therefore load
  as **classic** scripts at **absolute** URLs built from the page origin (the
  one deliberate exception to clone routing — they are static dashboard assets),
  and each is verified to have defined its global afterwards: a missing
  `/canvas-vendor/*.js` does not 404, it falls through to the SPA index HTML
  with a 200 that a `<script src>` "loads" while defining nothing.
- **`ui.js` wins over `ui.html`.** A canvas with no `uiJs` renders on the legacy
  path byte for byte — no root element, no loader, no injection.
- **Canvas type owns the render branch.** Excalidraw and Kusto never reach the
  markdown pipeline (a Kusto result JSON can be 10k rows); extension canvases
  only do so to show raw JSON in a history view. SVG detection runs against the
  *displayed* content, so an older revision is classified on its own body.

## Tests

`packages/coc/test/server/spa/client/canvas/` — `CanvasPanel.test.tsx` is the
full-panel regression suite (every canvas type, banners, export, AC-07 Kusto);
`CanvasPanel-remote-workspace.test.tsx` pins clone routing; per-kernel suites
(`useCanvasRecord`, `useCanvasVersions`, `useCanvasComments`, `useCanvasExport`)
use `renderHook`; `CanvasPanelComponents.test.tsx` and
`canvas-panel-model.test.ts` cover the presentational and pure layers.

Monaco, `ExtensionCanvasView`, `@excalidraw/excalidraw`, and the HTML-export
orchestrator must be mocked in these tests — they cannot load under Node.
