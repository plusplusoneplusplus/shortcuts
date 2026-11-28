# features/canvas

Chat-linked canvas: Markdown, code, SVG, Excalidraw, sandboxed extension UI, desktop Copilot extension guest, or a live Kusto query.

Hosted by `coc://canvas/<canvasId>` (`UnifiedCanvasTab`) or `layout/PopOutCanvasShell.tsx`. Inline embeds are read-only via `shared/CanvasEmbed.tsx`. The chat has no canvas column. Chat actions come from `unifiedChatCanvasActions.ts`. Tab chat, server, or workspace changes remount selection state.

`CanvasPanel.tsx` is a composition root. It resolves `useCocClient(workspaceId)` once and passes that client down. Add behavior in a kernel, pixels in `components/`.

| File | Role |
|------|------|
| `canvas-panel-model.ts` | Pure prompt, filename, kind, and save-state helpers. |
| `hooks/useCanvasRecord.ts` | Load, `reloadNonce`, live reconcile, debounced revision autosave, 409 conflict. |
| `hooks/useCanvasVersions.ts` | Stepper. Restore writes a new revision. |
| `hooks/useCanvasComments.ts` | Comments. Send uses the host `onSendToAi`. Late results stay bound to the original client. |
| `hooks/useCanvasExport.ts` | Copy, download, Notes, HTML. Browser primitives are injectable. |
| `hooks/useCreateKustoCanvas.ts` | Blank Kusto canvas. `onCanvasCreated` opens a sibling tab. |
| `canvasPopOut.ts` | Window `coc-canvas-<id>` on the owning workspace. Repeat click focuses. |
| `extension-runtime.ts`, `canvas-host-contract.ts`, `canvas-host-bootstrap.ts` | Pure, Node-safe iframe runtime and both hosts generated from `CANVAS_HOST_METHODS`. |
| `html-export/` | Offline HTML pipeline. Own AGENTS.md. |

## Rules

- Do not import `getSpaCocClient` from a kernel. `KustoView` uses the panel `routingRef` (`null` is page origin). Fence: `CanvasPanel-remote-workspace.test.tsx`.
- A newer AI revision while dirty sets `remoteUpdatePending`. `reloadNonce` is ignored while dirty. Only "Load latest" discards local edits.
- Autosave keeps the dirty mark when `draftRef` changed in flight and echoes the local content.
- `loadNonce` starts at 0 and bumps only on a successful load. Kernels skip fetch at 0.
- `viewingVersion` is read-only and hides the selection toolbar.
- Kusto and Markdown wrap state is view-local and never saved into canvas content. Key the Markdown viewer by workspace, routing ref, and canvas id.
- The extension header reload confirms loss of guest input, blocks pending invokes/state saves, freezes new bridge requests, fetches code and persisted state from the exact routed owner, and replaces only its iframe. Never replay actions or deliver old guest replies to a replacement. Installed Copilot guests register the same header reload icon (disabled while the guest loads; no separate Reload row), confirm Reload, retire the exact owner's shared extension runtime through desktop main, and remount a fresh guest from saved instance/input. Tool and desktop reloads refresh every saved open instance through a shared reload-only marker; ordinary opens preserve it to avoid loops. Error markers close stale guests and retain Retry. Late old-view replies cannot attach.
- CanvasHost v2 settles `invoke` / `setState` with a correlated response. A message with no `id` is a pre-v2 sender and is still serviced, with no reply. Every path answers or times out at `CANVAS_HOST_REQUEST_TIMEOUT_MS`. Capability failure rejects and shows the banner. File failure is `file-error` with no banner.
- Extension iframe is `sandbox="allow-scripts"` without `allow-same-origin`. Libraries load as classic scripts at absolute page-origin URLs, then the global is checked. A missing `/canvas-vendor/*.js` can return SPA HTML with 200.
- No `uiJs` means the legacy `ui.html` path, byte for byte.
- Excalidraw and Kusto skip the Markdown pipeline. SVG classification uses the displayed body. `copilot-extension` never renders as Markdown or editable JSON. Desktop main gates guests on `canvasExtensions.enabled`, not `canvas.enabled`. Only `UnifiedCanvasTab` passes `allowDesktopGuest`. Remote owners never attach a guest.
- `SvgCanvasView` passes `selectableSelector: 'text, tspan, foreignObject'` and resolves hits with `composedPath()`.
- "New Kusto query" needs `kustoEnabled && kind.isKusto`. The other create path is the right panel `+` menu.

## Tests

`packages/coc/test/server/spa/client/canvas/`. Mock Monaco, `ExtensionCanvasView`, `@excalidraw/excalidraw`, and the HTML-export orchestrator. They cannot load under Node.
