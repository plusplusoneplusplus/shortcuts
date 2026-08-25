# Dashboard SPA — Canvas & source canvas

Two unrelated right-side panels sharing the chat detail column: the AI co-edited
**canvas** (`features/canvas/`) and the read-only **source canvas**
(`features/chat/source-canvas/`). `ChatDetail` owns both and closes the sibling when one
opens. Chat list and lens: [chat.md](chat.md); conversation rendering:
[chat-conversation.md](chat-conversation.md).

## CanvasPanel

`features/canvas/CanvasPanel.tsx` is a composition root gated by `canvas.enabled`
(`isCanvasEnabled()` in `utils/config.ts`, default on). It owns the public props, the
workspace-routed `useCocClient(workspaceId)`, fullscreen chrome, and layout, delegating
the rest:

| Layer | Holds |
|---|---|
| `features/canvas/hooks/` | `useCanvasRecord` (load, live `canvas-updated` reconciliation, `reloadNonce`, debounced revision-checked autosave, 409 conflicts), `useCanvasVersions`, `useCanvasComments`, `useCanvasExport`, `useCreateKustoCanvas` |
| `canvas-panel-model.ts` | Pure helpers |
| `features/canvas/components/` | Header, banners, body renderer, selection toolbar, comments panel |

The routed client is passed into every kernel **explicitly** — that is what keeps remote and
clone workspaces hitting the workspace-owning server, and every canvas call in this file
(record load/save, versions, comments, export, run, extension load, `invoke-capability`,
`set-state`, `list-files`, `read-file`, embeds, source previews) goes through it (see
[clone-routing.md](clone-routing.md)). `ChatDetail` discovers linked canvases via
`client.canvases.list(workspaceId, { processId })`, keeps the summaries in API order for
the title switcher (which updates `activeCanvasId` once two or more are linked), and
refreshes on live `canvas-updated` SSE events (`useChatSSE`'s `onCanvasUpdated`). The panel
mounts as a desktop-only (`lg:`) resizable right column, width persisted under
`coc.canvasPanel.width.<workspaceId>` via `useResizablePanel`, on the right of a top-level
split so it spans the full detail height beside the composer.

### Editing and conflicts

Markdown canvases toggle between Preview (the shared `useMarkdownPreview` pipeline, its
rendered HTML passed to `useMermaid` as the re-render key) and Edit (plain textarea).
Edits autosave debounced through `client.canvases.save(...)` carrying `expectedRevision`;
HTTP 409 surfaces a conflict, and a live AI update arriving over unsaved local edits is
held rather than clobbering the draft. The header revision chip steps through the canvas
versions API, showing older snapshots read-only and restoring one as a new revision
(blocked while local edits are unsaved).

### Window controls

`onFullscreenChange` re-renders the panel as a full-viewport overlay with the in-flow
column collapsed. `onPopOut` opens `PopOutCanvasShell`, routed from `entry.tsx` on
`#popout/canvas` with `?workspace=&canvasId=`; that window maps the global WebSocket
`canvas-updated` event into the panel's `liveEvent` and bumps `reloadNonce` on focus to
pick up AI tool edits that streamed over the chat SSE channel. Closing a canvas does not
detach it — `ChatDetail` keeps a reopen rail.

### Selection, comments, and copy

Ask AI prefills the follow-up composer through `ChatDetail`'s `onAskAi` (setting
`followUpInput` and the `RichTextInput` ref) with a prompt quoting the selection plus
canvas id and revision. Comments anchor to the selection; sending them posts one batch
message through `onSendToAi` (`sendFollowUp(message, 'enqueue')`, so a busy AI receives it
at the next turn boundary) and marks them `sent`.

`copyImageToClipboard` copies a preview image as an `image/png` bitmap;
`copySelectionWithInlineImages` (`utils/format.ts`) inlines images in a copied selection as
base64 `data:` URIs in the `text/html` clipboard flavor so they survive an external paste.
Markdown export can save to Notes, writing `canvases/<slug>.md` via `notes.saveContent`.

## Canvas types

### Code and SVG

`type: 'code'` canvases use `MonacoFileEditor` (shared with the repo explorer) in Edit
mode with the same debounced autosave.

`language: 'svg'`, or `xml`/unset content whose trimmed source starts with `<svg`, mounts
`SvgCanvasView` instead: rendered by default with a source view, downloading the raw
persisted source as `image/svg+xml`. It inserts only `sanitizeSvg` output into a
ShadowRoot; invalid SVG shows the sanitizer error and escaped source.

`shared/svg/sanitizeSvg.ts` is the client SVG trust boundary: it rejects malformed or
non-SVG XML, runs DOMPurify's SVG profile, strips scripts, event handlers, `foreignObject`,
script-bearing CSS/SMIL values, and external resource references, and preserves safe styles,
gradients, filters, and animation. Direct `href`/`xlink:href`/`src` values are limited to
base64 raster `data:` URIs; internal paint references like `fill="url(#gradient)"` stay
valid. **Any surface mounting the sanitized result must use a shadow root** so allowed SVG
`<style>` rules cannot reach the surrounding document.

### Extension canvases

`type: 'extension'` renders `ExtensionCanvasView` in preview mode: the extension's
`ui.html` runs inside an `<iframe sandbox="allow-scripts">` whose injected
`window.CanvasHost` bridge (`version`/`onState`/`invoke`/`setState`/`listFiles`/`readFile`)
talks to the host over `postMessage`. Edit mode shows the raw JSON shared state.

The host side lives in `useExtensionCanvasHostController`, not the view: it posts
`canvas-state` on ready and on every live update, services `invoke-capability` via
`canvases.invokeCapability`, and services `set-state` via the revision-checked
`canvases.save`, so human UI actions and AI capability calls share one gate.

**Bridge protocol v2.** Constants, the method table, and the error shape live in
`features/canvas/canvas-host-contract.ts`; `canvas-host-bootstrap.ts` generates both the
live and the offline in-frame host from that table. `invoke`/`setState` tag each message
with a monotonic `id` and return a promise settling on
`{ type: 'response', id, ok, result | error }` or rejecting after 60s with
`code: 'timeout'`. Rejections carry `{ code, message }` with `code` in `offline` /
`timeout` / `revision-conflict` / `capability-error` / `file-error`. A failed capability
rejects *and* raises a host banner; a failed `readFile`/`listFiles` only rejects. A message
with **no `id`** is a pre-v2 sender, serviced in full without a reply.

An outstanding `invoke` shows `extension-canvas-pending` (a capability declared
`async: true` runs server-side with a 30s budget), clearing when the last one settles. In
an exported HTML artifact the offline bootstrap **rejects** `invoke`/`setState` with
`code: 'offline'` rather than no-oping, so a v2 extension's `await` fails fast; a canvas's
files are not inlined into an export. `CanvasHost` exposes no `complete()`: model access
lives only inside an async capability's server-side `host`.

`listFiles`/`readFile` are READ-ONLY and scoped to `canvases/<canvasId>/files/`, hitting
`canvases.listFiles` / `canvases.readFile` and returning
`{ path, size, encoding, content }` (`utf-8` for text, `base64` otherwise;
`{ encoding: 'base64' }` forces bytes). Only the AI writes into that directory, through
`extension_canvas`'s `files` argument.

### Kusto canvases

`type: 'kusto'` renders `features/canvas/KustoView.tsx` (`KustoChart.tsx` for native SVG
charts), gated by `kusto.enabled` (`isKustoEnabled()` in `utils/config.ts`, default off).
It exposes an editable KQL query, cluster URL, and database, plus table/chart views and CSV
download. Run executes server-side via `client.canvases.run(...)` with no AI turn; when
linked to a chat, Ask AI sends a follow-up naming `kusto_query`.

`CanvasPanel`'s header offers a new-Kusto action (`data-testid="canvas-panel-new-kusto"`)
creating a blank `type: 'kusto'` canvas, best-effort seeding cluster/database from the
workspace's most recent Kusto canvas (`kustoCreate.ts`). Kusto canvases own their editing
surface: no markdown Preview/Edit toggle, no HTML export. Older revisions route the stored
snapshot through the same `KustoView` in `readOnly` mode so historical rows render via
`InteractiveTable`. Kusto canvases never feed serialized row JSON to `chatMarkdownToHtml`,
which would cost a parse of up to `MAX_KUSTO_ROWS` (10,000) rows per revision switch.

### Inline embeds

`canvas://<canvasId>` references render through `shared/CanvasEmbed.tsx`, which fetches the
descriptor and picks the renderer from the persisted `type`: Excalidraw a view-only preview, extension `ExtensionCanvasView`, `kusto` a compact
`KustoView`, markdown/code a document preview. `.md-excalidraw-embed` placeholders in
historical message HTML remain supported.

`KustoEmbedGroupProvider` (`shared/KustoEmbedGroup.tsx`, wrapping the turn list in
`ConversationArea`) keeps only the last inline Kusto embed in document order expanded,
picking it via each embed's registered wrapper element and `compareDocumentPosition`; a
manual toggle overrides that, and an embed outside any provider stays expanded. Its
expanded header exposes a `canvas-embed-kusto-connection-slot` into which `KustoView` —
given `connectionInHeader` + `connectionSlot` — `createPortal`s its cluster/database
editors, which stay owned by `KustoView`.

The SPA client no-emit gate (`npx tsc -p tsconfig.client.json --noEmit`) is intentionally
scoped to this Canvas/Kusto surface and its imported helpers.

## Source canvas

`features/chat/source-canvas/` renders the docked, read-only source-file canvas for local
file references clicked inside assistant chat responses.

### Link delegation

Global delegation normalizes bare `.file-path-link` spans, shared renderer `.md-link`
spans, and local Markdown `<a href>` anchors into one file-reference path. Bare prose
linkification keeps a terminal `.`, `,`, `;`, `!`, or `?` run outside the clickable span
and its metadata; explicit Markdown hrefs and paths inside code or preformatted blocks stay
literal.

With `SHOW_SOURCE_CANVAS_FOR_CHAT_LINKS` enabled, assistant-response clicks dispatch
`coc-open-source-canvas` carrying the bare path, workspace hint, optional `sourceFilePath`,
and optional line/range metadata. Local `file://` hrefs convert to filesystem paths and
GitHub-style `#L<line>` / `#L<start>-L<end>` hashes carry as line metadata, so the resolver
never treats a file URI as workspace-relative text. `ChatDetail` owns the listener, closes
sibling right-side panels, and mounts `SourceCanvasPanel` as the desktop right column or a
mobile bottom sheet; flag-off, user-message, and non-chat references route to
`MarkdownReviewDialog` instead. File-backed plan paths in `ImplementPlanCard` use the same
dock through `onOpenPlanFile`, opening an editable note scoped to the chat's source
workspace including a remote clone; canvas-backed plan labels stay static because they name
no on-disk file.

Separately, the shared `MarkdownView` intercepts assistant-prose deep-links with
`#/process/<id>`, `#/session/<id>`, or `#/processes/<id>` hrefs; the router resolves the
owning workspace from cached queue/history state (falling back to the selected workspace)
and normalizes the URL to `#repos/<workspace>/<chat-tab>/<id>` (see [routes.md](routes.md)).

### Path resolution

The resolver keeps an explicit workspace hint when its root contains the resolved absolute
path. When the hinted root does not contain the path, the longest matching known workspace
root wins; if no root matches, the hint remains the fallback. This routes absolute member-repo
paths from repo-group chats to the owning workspace. Relative paths resolve against
`sourceFilePath`; otherwise ordinary workspace refs anchor at the workspace root while
repo-group refs stay relative for the preview endpoint's ordered live-member probe.

WSL workspaces on a Windows host have a `\\wsl$\<distro>\...` root. `react/utils/path-resolution.ts`
keeps that UNC prefix through relative resolution and tilde expansion, and the resolver
re-roots plain Linux paths (`/home/u/repo/...`, what WSL agents emit) onto a workspace share
when the result lands inside that root. The preview endpoint applies the same re-rooting
server-side through `resolveRequestedFilePath` (`server/tasks/tasks-handler-utils.ts`).

`useSourceCanvasContent` folds remote-server workspaces (which live in the repos list, not
`state.workspaces`) into the resolver's workspace set and fetches the preview through
`getCocClientForWorkspace(wsId)`. It adopts the response `path` and `resolvedWorkspaceId`,
then derives the owning member root for the panel header, copy path, and clone-routed Reveal
action. Shared React and delegated hover previews use the same resolver. Group-scoped
Markdown links open in the read-only viewer so member probing never widens a write route.

### File switcher

`ChatDetail` derives switcher candidates in memory from the conversation's loaded assistant
turns using the same markdown/file-link metadata as click handling: notes and folders
excluded, normalized workspace/path identities de-duplicated, latest line/range kept,
newest-first. Selecting one replaces the active canvas with that candidate's workspace and
line/range. **The candidate list is never written to browser or disk storage.**

### Repo attribution (repo-group chats)

`repoAttribution.ts` labels a previewed file with its owning member repo whenever the chat
workspace is a `group-…` id (or the resolved workspace differs from the chat's). The header
shows a chip (`source-canvas-repo-chip`) with the member's name — falling back to its root
basename, then its id — and a colored dot; the switcher groups options under per-repo
headers (`source-canvas-file-group-<wsId>`) and marks the active row with the same accent.
Colors come from `getRepoAccentColor`, an FNV-1a hash of the workspace id over a fixed
VS Code-ish palette, so a repo keeps one color in both themes with no shared state.

A conversation source file carries the GROUP workspace id, so the owning member is unknown
until the preview endpoint probes the members. `SourceCanvasPanel` therefore records each
`resolvedWorkspaceId` per file key as files get opened (memory-only, no batch round trip);
files not opened yet sit in a neutral "Other" bucket at the bottom of the switcher. Plain
single-repo chats show no chip and keep the flat switcher list.

The folder explorer uses the same resolver. A relative group folder first goes through the
preview endpoint to obtain its absolute member path and `resolvedWorkspaceId`; the root and
all lazy child calls then use that member's clone-routed `explorer.tree` client and
repo-relative paths. The workspace root is sent as `.`, while outside-root paths stay
absolute so the server guard can reject them clearly.
