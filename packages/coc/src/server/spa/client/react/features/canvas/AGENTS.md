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
