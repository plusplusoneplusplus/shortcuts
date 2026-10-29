# Dashboard SPA — Canvas & source canvas

Two unrelated surfaces: the AI co-edited **canvas** (`features/canvas/`) and the
read-only **source canvas** (`features/chat/source-canvas/`). Chat list and lens:
[chat.md](chat.md); conversation rendering: [chat-conversation.md](chat-conversation.md).

The AI canvas has **no chat-side column**. It lives in the unified right panel as a
`canvas` tab (`UnifiedCanvasTab`), in the standalone pop-out window, or as an inline
embed; the chat itself renders no rail, resize handle, or reserved width for it. An AI
`canvas-updated` event activates that tab and reveals the panel for non-Kusto kinds.
Kusto events carry `canvasType: 'kusto'` and only refresh mounted views, preserving
the selected tab and panel visibility; result links and the `+` menu open them explicitly.
With no panel hosting the chat, every kind only refreshes mounted views. The panel
supplies `liveEvent` through its `useSyncExternalStore` relay. See
`features/repo-detail/unified-right-panel/AGENTS.md`.

The initial and follow-up composers expose `/canvas` while `canvas.enabled` is on.
It is a skill-backed prompt directive: the composer removes the token, selects the
bundled `canvas` skill, and sends the remaining artifact request through the normal
provider-neutral selected-skill path. The skill chooses among Markdown, code,
Mermaid, SVG, Excalidraw, and extension canvases using the existing canvas tools;
it does not add a canvas route, tool, or storage location.

Source files, notes, folders, and whisper diffs use the unified panel when it hosts
their chat. Mobile, embedded, pop-out, and background chats retain chat-owned source
or diff docks and session-only restore memory (`features/chat/openCanvasMemory.ts`).
Inline content remains in the transcript.

## CanvasPanel

`features/canvas/CanvasPanel.tsx` is a composition root gated by `canvas.enabled`
(`isCanvasEnabled()` in `utils/config.ts`, default on). It owns the public props, the
owner-routed `useCocClient` (explicit `routingRef` when supplied), fullscreen chrome, and layout, delegating
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
[clone-routing.md](clone-routing.md)). The right panel's `+` menu discovers linked
canvases via `client.canvases.list(workspaceId, { processId })` and opens each as its own
tab; the tab strip is the canvas switcher, so the header's in-panel switcher only appears
for a host that passes `availableCanvases`. `ChatDetail` no longer lists canvases at all —
it only routes live `canvas-updated` SSE events (`useChatSSE`'s `onCanvasUpdated`) to the
panel.

The unified tab strip compresses four or more open canvases into the active canvas tab and
a fixed count chip. While a canvas is active the chip renders in its `CanvasPanel` header right
after the title (via the `titleAccessory` prop); otherwise it sits in the strip. The chip opens a searchable switcher in stored order and routes
individual or bulk closes through the panel's dirty-close queue. This is presentation-only:
canvas ownership, active selection, clone routing, and the persisted tab set keep using the
normal unified-panel model.

### Editing and conflicts

Markdown canvases toggle between Preview (`chatMarkdownToHtml` with canvas embeds and
SVG fences enabled, hydrated by `MarkdownView`) and Edit (plain textarea).
Edits autosave debounced through `client.canvases.save(...)` carrying `expectedRevision`;
HTTP 409 surfaces a conflict, and a live AI update arriving over unsaved local edits is
held rather than clobbering the draft. The header revision chip steps through the canvas
versions API, showing older snapshots read-only and restoring one as a new revision
(blocked while local edits are unsaved).

`useCanvasRecord.saveNow()` cancels the pending debounce and writes through the same
`writeDraft` the timer uses — an explicit save is not a second write path. It returns
false on a 409, on any refused write, and when the draft moved while the write was in
flight (the write landed but the text on screen did not, so a close would still lose an
edit). `CanvasPanel` exposes it to a host through `onDirtyChange` / `onRegisterSave`,
the same two props `explorer/PreviewPane` and `NoteEditor` publish, so a host owning the
close affordance can prompt Save / Don't Save / Cancel.

### Window controls

`onFullscreenChange` re-renders the panel as a full-viewport overlay with the in-flow
column collapsed. `onPopOut` (supplied by the canvas tab through
`features/canvas/canvasPopOut.ts`) opens `PopOutCanvasShell`, routed from `entry.tsx` on
`#popout/canvas` with `?workspace=&canvasId=` at the canvas's OWNING workspace; the window
is named `coc-canvas-<id>`, so a repeat pop-out focuses it instead of duplicating, and a
blocked popup leaves the canvas in its tab. That window maps the global WebSocket
`canvas-updated` event into the panel's `liveEvent` and bumps `reloadNonce` on focus to
pick up AI tool edits that streamed over the chat SSE channel. Closing a canvas tab does
not unlink the canvas — it stays in the `+` menu and in transcript links.

### Selection, comments, and copy

Ask AI prefills the follow-up composer with a prompt quoting the selection plus canvas id
and revision; comments anchor to the selection, and sending them posts one batch message
that is marked `sent` only after the send succeeds. Both reach the canvas's OWNING
conversation — never the selected one — through the
`unified-right-panel/unifiedChatCanvasActions.ts` registry: `ChatDetail` publishes
`{ askAi, insertDraft, sendToAi }` under its chat id (`sendFollowUp(message, 'enqueue')`, so a busy AI
receives the batch at the next turn boundary), and the canvas tab looks them up by
`tab.chatId`. An unmounted chat publishes nothing and the tab hides both actions.

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

### Copilot canvas extension discovery

`server/canvas-extensions/discovery.ts` reads `.github/extensions/*/extension.mjs`
under registered repository roots and `.copilot/extensions/*/extension.mjs` under
`os.homedir()`, independent of `COPILOT_HOME`. `canvasExtensions.enabled` gates all
discovery I/O. Groups resolve live members on every call; keys retain member
ownership as `<workspaceId>:<name>`, with `global:<name>` for user extensions.
Results carry the entry path, owning repository cwd (extension folder for globals),
optional package description and a SHA-256 hash of entry bytes and package metadata.
Discovery never imports code; malformed optional JSON is ignored, while unexpected
filesystem errors propagate.

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
Layout, top to bottom: one connection bar (cluster + database, `kusto-connection`, or
portaled into an embed header slot), a query editor card whose footer holds Run, the run
status pill, and the Ask AI toggle, then a Results card whose header carries the row/column
summary, the Table/Chart segmented switch, and CSV download. Chart controls are one toolbar:
icon buttons for the chart type (`kusto-chart-type-<type>`), an X select, numeric Y
columns as toggle chips (`aria-pressed`, swatch matches the plotted series), and a
Split-by select. Run executes server-side via `client.canvases.run(...)` with no AI turn;
Shift/Ctrl/Cmd+Enter in the editor also runs (`isRunShortcut`). When linked to a chat (and
not compact or read-only), the Ask AI toggle opens a one-line prompt that sends a follow-up
naming `kusto_query`.

Results use `shared/InteractiveTable`, shared with markdown tables. Unwrapped tables
with more than twelve visible columns grow past the pane to retain readable
content-proportional widths; the table's own scroll container handles overflow.
Hidden columns are excluded from width normalization. Header and numeric-summary
overflow is clipped, with full text in tooltips. Resizing uses measured pixel widths.
Kusto supplies the shared Wrap text control with in-memory state per mounted view.
Wrapping survives result revisions and Table/Chart switches, resets on workspace or
canvas changes, and defaults off on remount. Native table rows grow with wrapped
content without virtual row measurements. Display settings do not mutate query
results or canvas revisions.

Authentication belongs to the owning server's `kusto-client-runtime.ts`, shared by
Run and tools through `getKustoRuntime`. Authentication always
uses native `MicrosoftTokenProvider` with Azure CLI/auto refresh. Host file settings
`kusto.azureCli.account`, `tenant`, and `subscription` optionally pin the exact CLI
`user.name` and tenant/subscription UUIDs. Empty settings select native active-account
mode; partial settings fail. Rust resolves and pins active identity on first token
use, checks it before cached returns, and rejects changes with `AccountMismatch`.
A new provider lifecycle is required to select another identity. File edits require
host refresh or the next manual start. The SDK resolves
cloud/MFA audiences into the credential's scopes. Clients invalidate on host
identity/flag changes and close on shutdown. Native auth owns token validation,
expiry, caching and renewal; the adapter maps access token/expiry to the SDK
credential shape and passes redacted `AuthError` through the SDK error envelope.
Unknown auth payloads are sanitized without fallback or replay.
Real standalone execution requires a host client factory;
unwired callers fail rather than constructing an alternative credential.

`CanvasPanel`'s header offers a new-Kusto action (`data-testid="canvas-panel-new-kusto"`)
creating a blank `type: 'kusto'` canvas, best-effort seeding cluster/database from the
workspace's most recent Kusto canvas (`kustoCreate.ts`). The button renders only when the
flag is on **and** the open canvas is itself Kusto (`kustoEnabled && kind.isKusto`), so it is
reachable only from an existing Kusto canvas. Kusto canvases own their editing
surface: no markdown Preview/Edit toggle, no HTML export. Older revisions route the stored
snapshot through the same `KustoView` in `readOnly` mode so historical rows render via
`InteractiveTable`. Kusto canvases never feed serialized row JSON to `chatMarkdownToHtml`,
which would cost a parse of up to `MAX_KUSTO_ROWS` (10,000) rows per revision switch.

### Inline embeds

Bare `canvas://<canvasId>` and `[label](canvas://<canvasId>)` references in chat and
Markdown canvas previews render through `shared/CanvasEmbed.tsx`. IDs contain 1–128
letters, digits or hyphens and start with a letter or digit. Inline/fenced code
and Edit text stay literal. The owning workspace routes descriptor reads and
interactive calls. Persisted `type` selects Excalidraw, `ExtensionCanvasView`, compact
`KustoView`, or a plain markdown/code document preview. Document previews do not expand
nested references, bounding self/cyclic links. Preview displays saved Kusto results
without running queries. Historical `.md-excalidraw-embed` placeholders remain supported.

All generic embeds share a title/type disclosure. Sentinel conversations default every
kind to collapsed, including Kusto's last group member and historical Excalidraw
placeholders. `ChatDetail` passes its resolved conversation mode through
`ConversationArea`, both pinned and normal bubbles, and `ChatRenderContext`;
embed defaults never infer mode from titles or individual turns. Ordinary chats keep
expanded generic embeds and the Kusto group default. Dedicated panels keep their own state.

Collapsed bodies and Kusto connection portals stay mounted, hidden and inert,
preserving iframe state and drafts without layout space. Manual choices override
defaults per occurrence. `MarkdownView` retains choices across HTML-driven portal
remounts, scoped by resolved server/workspace owner, chat, canvas and occurrence; changing ownership
resets that memory. Loading and errors use the same disclosure and rendering gate.

With the unified right panel enabled for the embed's own chat, a loaded embed
retains a separate **Open in panel** action in its header, including while collapsed.
The chat id reaches the embed through `ChatRenderContext.chatId` —
`CanvasEmbed` is mounted by `MarkdownView` through a `createPortal` from a placeholder
in pre-rendered HTML, and React context crosses portals where props cannot. The tab
descriptor is built by the `+` menu's own builder, so the embed, the menu, and an AI
update all reach one tab id for one canvas. Without a matching host, the action is
omitted and the inline disclosure remains available.

`KustoEmbedGroupProvider` (`shared/KustoEmbedGroup.tsx`, wrapping the turn list in
`ConversationArea`) keeps only the last inline Kusto embed in document order expanded,
picking it via each embed's registered wrapper element and `compareDocumentPosition`; a
manual toggle overrides that, and an embed outside any provider stays expanded. Its
header retains a `canvas-embed-kusto-connection-slot` into which `KustoView` —
given `connectionInHeader` + `connectionSlot` — `createPortal`s its cluster/database
editors, which stay owned by `KustoView` and are hidden/inert while collapsed.

The SPA client no-emit gate (`npx tsc -p tsconfig.client.json --noEmit`) is intentionally
scoped to this Canvas/Kusto surface and its imported helpers.

## Source canvas

`features/chat/source-canvas/` renders the docked, read-only source-file canvas for local
file references clicked inside assistant chat responses.

### File rendering

`previewResponse.toFileBlob` maps preview responses to the shared `FileBlob` contract.
`useSourceCanvasContent` carries the content, encoding, and MIME type through
`SourceCanvasPanel` and `SourceCanvasBody` into `shared/file-viewer/FileViewer`.
Image responses render as base64 data-URL images, including SVGs; oversized or malformed
image previews surface the panel's error state. Text uses Monaco or the rendered/raw
Markdown toggle. Line highlighting applies only to text.

### Link delegation

Global delegation in `shared/file-path/file-path-preview.ts` normalizes bare
`.file-path-link` spans, shared renderer `.md-link` spans, and local Markdown
`<a href>` anchors into one file-reference path. Bare prose linkification keeps
terminal punctuation outside the clickable span and its metadata; explicit Markdown
hrefs and paths inside code or preformatted blocks stay literal. Forge protects
explicit Markdown destinations before bare-path matching. Local anchors in rendered
previews share the delegate; hashes, downloads, external links and modified clicks
retain their existing handlers.

`MarkdownFileLinkScope` claims the bubbling `coc-open-file-reference` event for
file/canvas previews before the chat fallback. It binds the displayed file directory
and concrete owner, reads roots on that server, and uses `resolveChatFileLink` plus
`openUnifiedPanelTab`. Unmount/owner changes cancel pending reads. The tab store
activates and reveals repeat ranges without replacing buffers. Non-hosted source
docks use their existing navigation callback; standalone canvas previews show
`PreviewPane` in a floating, read-only workspace preview. Errors stay in that surface.

With `SHOW_SOURCE_CANVAS_FOR_CHAT_LINKS` enabled, user/assistant file clicks and
portaled tool previews dispatch `coc-open-source-canvas` with originating chat,
workspace, source-file, and line/range metadata. File URIs and GitHub line hashes
normalize through the shared parser. `ChatDetail` uses `resolveChatFileLink` to open
or focus a permanent right-panel tab; group ownership is preflighted without reading
content. Outside-root and group-probed paths use read-only workspace preview tabs.
Directories reveal the owning Explorer folder. Hosted resolution errors are surfaced,
not redirected into another column. Without a matching panel, the source dock remains;
flag-off and non-chat links use `MarkdownReviewDialog`.

File-backed plans use the same routing with `kind: 'note'`, preserving editable
workspace-owned note tabs and concrete remote routes. Inline thumbnails, lightboxes,
tables, and canvas embeds stay inline. CSV files render as text; PDF, Office, media,
and archives have no general file viewer. File tabs offer Download for unsupported,
oversized, and binary previews through the same owning server's authorized endpoint.

With `features.htmlPageTab` on in the desktop host, assistant `.html`/`.htm`
links resolve through `resolveSourceCanvasTarget` and open through
`window.cocDesktop.htmlPage.open`; repo-group relative paths first use the
preview endpoint to identify the owning member. The owning local server then
canonicalizes and authorizes the absolute path through `files/html/resolve`;
workspace roots, repo output data, OS temp, `~/.copilot`, `~/.codex`, and
`~/.claude` are eligible HTML roots. The desktop host checks that the approved
path still names an existing HTML file. A successful open emits `coc-open-html-page` with
`{ pageId, filePath, wsId, scopeWsId }`; the owning right panel claims the
event and opens a workspace-scoped, session-only tab. Without a matching panel
the native view closes and the ordinary source-canvas event fires. Rejected,
unresolved, remote, and browser-hosted links use that source-canvas path too.
The page tab's View source action carries `forceSourceViewer` and the selected chat:
a matching host opens a read-only source tab, and non-hosted chats use the source dock.

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
Each candidate must land inside a live group member; sibling references such as
`../other-repo/src/file.ts` report the containing member as owner, with the most
specific root winning. Candidates outside every live member are excluded. Metadata
resolution and downloads also validate realpath containment.

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
