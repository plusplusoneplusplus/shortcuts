# features/canvas

Chat-linked canvas: Markdown, code, SVG, Excalidraw, desktop extension guest, or a live Kusto query.

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
| `html-export/` | Offline HTML pipeline. Own AGENTS.md. |

## Rules

- Do not import `getSpaCocClient` from a kernel. `KustoView` uses the panel `routingRef` (`null` is page origin). Fence: `CanvasPanel-remote-workspace.test.tsx`.
- A newer AI revision while dirty sets `remoteUpdatePending`. `reloadNonce` is ignored while dirty. Only "Load latest" discards local edits.
- Autosave keeps the dirty mark when `draftRef` changed in flight and echoes the local content.
- `loadNonce` starts at 0 and bumps only on a successful load. Kernels skip fetch at 0.
- `viewingVersion` is read-only and hides the selection toolbar.
- Kusto and Markdown wrap state is view-local and never saved into canvas content. Key the Markdown viewer by workspace, routing ref, and canvas id.
- Desktop guest Reload confirms shared runtime/input loss, retires the exact owner runtime and reopens saved instances/input. Reload-only markers replace affected guests or show errors. Both channels carry `refreshOnly`; late replies cannot attach. Generated packages share this host and renderer. Runtime identity is never editable or exportable.
- Excalidraw and Kusto skip the Markdown pipeline. SVG classification uses the displayed body. `copilot-extension` never renders as Markdown or editable JSON. Desktop main gates guests on `canvasExtensions.enabled`, not `canvas.enabled`. Only `UnifiedCanvasTab` passes `allowDesktopGuest`. Remote owners never attach a guest.
- `SvgCanvasView` passes `selectableSelector: 'text, tspan, foreignObject'` and resolves hits with `composedPath()`.
- "New Kusto query" needs `kustoEnabled && kind.isKusto`. The other create path is the right panel `+` menu.

## Tests

`packages/coc/test/server/spa/client/canvas/`. Mock Monaco, `@excalidraw/excalidraw`, and the HTML-export orchestrator. They cannot load under Node.
