# Dashboard SPA — Canvas & source canvas

Two unrelated right-side panels that share the chat detail column: the AI co-edited
**canvas** (`features/canvas/`) and the read-only **source canvas**
(`features/chat/source-canvas/`). `ChatDetail` owns both and closes siblings when one
opens.

## CanvasPanel

`features/canvas/CanvasPanel.tsx` is a composition root gated by the `canvas.enabled`
runtime flag (`isCanvasEnabled()` in `utils/config.ts`, default on). It owns the public
props, the workspace-routed `useCocClient(workspaceId)`, fullscreen chrome, and layout,
and delegates the rest:

| Layer | Holds |
|---|---|
| `features/canvas/hooks/` | `useCanvasRecord` (load, live `canvas-updated` reconciliation, `reloadNonce`, debounced revision-checked autosave, 409 conflicts), `useCanvasVersions`, `useCanvasComments`, `useCanvasExport`, `useCreateKustoCanvas` |
| `canvas-panel-model.ts` | Pure helpers |
| `features/canvas/components/` | Header, banners, body renderer, selection toolbar, comments panel |

The routed client is passed into every kernel **explicitly** — that is what keeps
remote and clone workspaces hitting the workspace-owning server.

`ChatDetail` discovers canvases linked to the open process via
`client.canvases.list(workspaceId, { processId })`, keeps the summaries in API order
for the title switcher, and refreshes on live `canvas-updated` SSE events (surfaced by
`useChatSSE`'s `onCanvasUpdated`). The panel mounts as a desktop-only (`lg:`) resizable
right column with width persisted under `coc.canvasPanel.width.<workspaceId>` via
`useResizablePanel`, as the right side of a top-level split so it spans the full detail
height beside the composer.

### Editing and conflicts

Markdown canvases toggle between Preview (the shared `useMarkdownPreview` pipeline,
with rendered HTML passed to `useMermaid` as its re-render key, and
`.canvas-mermaid-preview` fit-to-pane SVG sizing) and Edit (plain textarea). Edits
autosave debounced through `client.canvases.save(...)` carrying `expectedRevision`. An
HTTP 409 shows a conflict banner with a **Load latest** action; a live AI update
arriving over unsaved local edits shows a pending-update banner rather than clobbering
the draft.

The header revision chip is a version stepper over the canvas versions API: stepping
back shows an older snapshot read-only behind a history banner whose **Restore as
latest** action saves that snapshot as a new revision (disabled while local edits are
unsaved).

With two or more linked canvases the title becomes a dropdown listing every linked
title, highlighting the active one and updating `activeCanvasId` in `ChatDetail`.

### Window controls

`onFullscreenChange` re-renders the panel as a `fixed inset-0 z-50` overlay (Esc
exits); while fullscreen `ChatDetail` collapses the in-flow column to width 0 so the
conversation reclaims the space. `onPopOut` opens `PopOutCanvasShell`, routed from
`entry.tsx` on `#popout/canvas` with `?workspace=&canvasId=`; that window maps the
global WebSocket `canvas-updated` event into the panel's `liveEvent` and bumps
`reloadNonce` on focus to pick up AI tool edits that streamed over the chat SSE
channel. Closing the canvas does not detach it — `ChatDetail` keeps a thin right-side
reopen rail so a linked canvas stays reachable.

### Selection, comments, and copy

Selecting text in the preview or textarea raises a selection action bar. **Ask AI**
prefills the follow-up composer through `ChatDetail`'s `onAskAi` (setting
`followUpInput` and the `RichTextInput` ref) with a prompt quoting the selection plus
the canvas id and revision. **Comment** opens an inline compose box storing an anchored
comment; open comments list in a footer with **Send N to AI**, which posts one batch
message through `onSendToAi` (`sendFollowUp(message, 'enqueue')`, so a busy AI receives
it at the next turn boundary) and marks those comments `sent`.

Right-clicking an inline preview image opens a **Copy image** menu writing an
`image/png` bitmap via `copyImageToClipboard`. A native Ctrl+C over a preview selection
containing an inline image inlines each image as a base64 `data:` URI in the
`text/html` clipboard flavor (`copySelectionWithInlineImages` in `utils/format.ts`,
sync `clipboardData` fallback plus async `navigator.clipboard.write` upgrade) so images
survive a paste into Word, Google Docs, or email. Text-only selections fall through to
the browser's native copy.

The Export menu offers Copy content and, for markdown canvases, Save to Notes — writing
to `canvases/<slug>.md` in the workspace Notes tree via `notes.saveContent`.

## Canvas types

### Code and SVG

`type: 'code'` canvases show a language chip and use `MonacoFileEditor` (shared with
the repo explorer) in Edit mode with the same debounced autosave. The preview is
normally a fenced highlighted block.

`language: 'svg'`, or `xml`/unset content whose trimmed source starts with `<svg`,
instead mounts `SvgCanvasView`: rendered mode by default, Source showing highlighted
XML, wheel and drag for zoom/pan. It inserts only `sanitizeSvg` output into a
ShadowRoot so SVG styles stay isolated; invalid SVG shows the sanitizer error and
escaped source. Downloads use the raw persisted source in an `image/svg+xml` blob.
Selection actions stay available in preview mode.

`shared/svg/sanitizeSvg.ts` is the client SVG trust boundary. It rejects malformed or
non-SVG XML, runs DOMPurify's SVG profile, removes scripts, event handlers,
`foreignObject`, script-bearing CSS/SMIL values, and external resource references, and
preserves safe styles, gradients, filters, and animation. Direct `href`/`xlink:href`/
`src` values are limited to base64 raster `data:` URIs; internal paint references such
as `fill="url(#gradient)"` remain valid. **Any surface mounting the sanitized result
must use a shadow root** so allowed SVG `<style>` rules cannot reach the surrounding
document.

### Extension canvases

`type: 'extension'` renders `ExtensionCanvasView` in preview mode: the extension's
`ui.html` runs inside an `<iframe sandbox="allow-scripts">` whose injected
`window.CanvasHost` bridge (`version`/`onState`/`invoke`/`setState`/`listFiles`/
`readFile`) talks to the host over `postMessage`. Edit mode shows the raw JSON shared
state.

The host side lives in `useExtensionCanvasHostController`, not the view. It posts
`canvas-state` on ready and on every live update, services `invoke-capability` through
`canvases.invokeCapability`, and services `set-state` through the revision-checked
`canvases.save` — so human UI actions and AI capability calls share one gate.

**Bridge protocol v2.** Constants, the method table, and the error shape live in
`features/canvas/canvas-host-contract.ts`; `canvas-host-bootstrap.ts` generates both
the live and the offline in-frame host from that one table. `invoke`/`setState` tag
each message with a monotonic `id` and return a promise settling on the host's
`{ type: 'response', id, ok, result | error }`, or rejecting after 60s with
`code: 'timeout'`. Rejections carry `{ code, message }` with `code` in `offline` /
`timeout` / `revision-conflict` / `capability-error` / `file-error`. A failed capability
both rejects the promise and shows the host banner; a failed `readFile`/`listFiles`
only rejects — a missing data file is the artifact's business, not a panel-level error.
A message with **no `id`** is a pre-v2 sender and is still serviced in full, just
without a reply.

While one or more `invoke` calls are outstanding the panel shows an
`extension-canvas-pending` indicator, since a capability the manifest declares
`async: true` runs server-side with a 30s budget; it clears when the **last** invoke
settles.

There is deliberately no `CanvasHost.complete()` — model access lives only inside an
async capability's server-side `host`, so the "a capability returns the next state"
contract stays intact and rate limiting and logging stay in one place.

In an exported HTML artifact the offline bootstrap **rejects** `invoke`/`setState` with
`code: 'offline'` rather than no-oping, so a v2 extension's `await` fails fast instead
of hanging. A canvas's files are not inlined into an export (unbounded size).

`listFiles`/`readFile` are READ-ONLY and scoped to `canvases/<canvasId>/files/`, the
canvas's own directory. They hit `canvases.listFiles` / `canvases.readFile`, returning
`{ path, size, encoding, content }` (`utf-8` for text, `base64` otherwise;
`{ encoding: 'base64' }` forces bytes). Only the AI writes into that directory, through
`extension_canvas`'s `files` argument.

Extension load, `invoke-capability`, `set-state`, `list-files`, and `read-file` all
route through the workspace-scoped `useCocClient(workspaceId)` like `CanvasPanel`, so a
remote workspace's extension is read from and written to its owning server rather than
the local page origin.

### Kusto canvases

`type: 'kusto'` renders `features/canvas/KustoView.tsx` (with `KustoChart.tsx` for
native SVG charts), gated by `kusto.enabled` (`isKustoEnabled()` in `utils/config.ts`,
default off). The view exposes an editable KQL query, cluster URL, and database; a Run
button executing server-side via `client.canvases.run(...)` through the routed client
with no AI turn; table and chart views; CSV download; and — when linked to a chat — an
Ask AI box sending a follow-up naming `kusto_query`.

With the flag on, `CanvasPanel`'s header offers **New Kusto query**
(`data-testid="canvas-panel-new-kusto"`), creating a blank `type: 'kusto'` canvas
titled `Kusto Query` and best-effort seeding cluster/database from the workspace's most
recent Kusto canvas (`kustoCreate.ts`). Kusto canvases own their editing surface — no
markdown Preview/Edit toggle, no HTML export.

Viewing an older revision routes the stored snapshot through the same `KustoView` in
`readOnly` mode (no Run, no Ask AI, read-only editors, chart toggle local-only and
never persisted) so historical rows render via `InteractiveTable`. Kusto canvases never
feed serialized row JSON to the markdown pipeline (`chatMarkdownToHtml`), which would
cost a parse of up to `MAX_KUSTO_ROWS` (10,000) rows on every revision switch.

### Inline embeds

`canvas://<canvasId>` references render through `shared/CanvasEmbed.tsx`, which fetches
the descriptor through the same workspace-routed client and picks the renderer from the
persisted `type`: Excalidraw keeps the view-only preview, extension canvases mount
`ExtensionCanvasView`, `kusto` mounts a compact `KustoView`, and markdown/code use a
document preview. Legacy `.md-excalidraw-embed` placeholders stay supported for
historical message HTML.

With several inline Kusto embeds in one conversation, `KustoEmbedGroupProvider`
(`shared/KustoEmbedGroup.tsx`, wrapping the turn list in `ConversationArea`) keeps only
the last embed in document order expanded and collapses the rest to a clickable header
(title + row-count summary). Each embed registers its wrapper element and the group
picks the last via `compareDocumentPosition`. A manual toggle overrides the default,
and an embed outside any provider stays expanded. To keep the embed compact the
expanded header exposes a `canvas-embed-kusto-connection-slot`, and `KustoView` — given
`connectionInHeader` + `connectionSlot` — `createPortal`s its cluster/database editors
into it instead of the body row; the editors stay owned by `KustoView`, only their
mount point moves.

The SPA client no-emit gate (`npx tsc -p tsconfig.client.json --noEmit`) is
intentionally scoped to this Canvas/Kusto surface and its imported helpers.

## Source canvas

`features/chat/source-canvas/` renders the docked, read-only source-file canvas for
local file references clicked inside assistant chat responses.

### Link delegation

Global file-path delegation normalizes bare `.file-path-link` spans, shared renderer
`.md-link` spans, and local Markdown `<a href>` anchors into one file-reference path.
Bare prose linkification keeps a terminal run of `.`, `,`, `;`, `!`, or `?` outside the
clickable span and its metadata; explicit Markdown hrefs and paths inside code or
preformatted blocks keep their literal behavior.

With `SHOW_SOURCE_CANVAS_FOR_CHAT_LINKS` enabled, assistant-response clicks dispatch
`coc-open-source-canvas` carrying the bare path, workspace hint, optional
`sourceFilePath`, and optional line/range metadata. Local `file://` hrefs convert to
filesystem paths and GitHub-style `#L<line>` / `#L<start>-L<end>` hashes carry as line
metadata, so the resolver never treats a file URI as workspace-relative text.

`ChatDetail` owns the listener, closes sibling right-side panels, and mounts
`SourceCanvasPanel` as the right column on desktop or a bottom sheet on mobile.
Flag-off, user-message, and non-chat file references route to the floating
`MarkdownReviewDialog` instead. File-backed plan paths in `ImplementPlanCard` use the
same dock through `onOpenPlanFile`, rendering as native keyboard-accessible controls
and opening an editable note scoped to the chat's source workspace, including a remote
clone. Canvas-backed plan labels stay static because they do not identify an on-disk
file.

Separately, the shared `MarkdownView` intercepts assistant-prose conversation
deep-links with `#/process/<id>`, `#/session/<id>`, or `#/processes/<id>` hrefs,
prevents the default action, and assigns `window.location.hash`. The router recognizes
those shorthand hashes, resolves the owning workspace from cached queue/history state
(falling back to the selected workspace), selects the queue task, and normalizes the
URL to `#repos/<workspace>/<chat-tab>/<id>`. Other hash and external links keep normal
renderer behavior.

### Path resolution

The resolver picks the explicit workspace hint when present, otherwise the longest
matching workspace root, and resolves relative paths against `sourceFilePath` when
available or the selected workspace root before calling the workspace file preview API.

WSL workspaces on a Windows host have a `\\wsl$\<distro>\...` root. The shared helpers
in `react/utils/path-resolution.ts` keep that UNC prefix through relative resolution
and tilde expansion, and the resolver re-roots plain Linux paths (`/home/u/repo/...`,
what WSL agents emit) onto a workspace share when the result lands inside that root.
The preview endpoint applies the same re-rooting server-side through
`resolveRequestedFilePath` (`server/tasks/tasks-handler-utils.ts`).

`useSourceCanvasContent` folds remote-server workspaces (which live in the repos list,
not `state.workspaces`) into the resolver's workspace set, so a link clicked in a remote
conversation resolves against that workspace's remote `rootPath`, and it routes the
preview fetch through `getCocClientForWorkspace(wsId)` so a remote ref is read from its
own server.

### File switcher

`ChatDetail` derives the source-header switcher candidates in memory from the current
conversation's loaded assistant turns, using the same markdown/file-link metadata as
click handling. It excludes notes and folders, de-duplicates normalized
workspace/path identities, keeps the latest line/range, and orders newest-first. The
selector appears only when a code canvas has multiple candidates, including inside the
mobile sheet; selecting one replaces the active canvas with that candidate's workspace
and line/range. **The candidate list is never written to browser or disk storage.**

The header shows project-relative paths for files inside the current workspace root
while keeping the absolute path in the hover tooltip; files outside the root display
their absolute path. The folder explorer uses the same resolver but converts the
resolved absolute folder to a workspace-relative tree path before calling
`explorer.tree` — the workspace root is sent as `.` while outside-root paths stay
absolute, so the server-side repo guard can reject them clearly.
