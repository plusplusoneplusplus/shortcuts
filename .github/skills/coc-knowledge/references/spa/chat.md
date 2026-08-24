# Dashboard SPA — Chat

Chat detail composer gating is driven by persisted process state. A cancelled
chat can be continued only when the process has a saved `sdkSessionId`; if no
SDK session was saved, or if `metadata.stoppedChatResume.resumable === false`
after a strict stopped-chat resume failure, `ChatDetail` keeps
`FollowUpInputArea` disabled and shows a non-retryable inline error with no
follow-up resume or fresh-session fallback. A terminal **failed** chat in that
state still surfaces a "Retry task" button (`onRetryTask` → `retry-task-button`)
inside the error block, gated by `ChatDetail.canRetryFailedTask`, which re-runs
the original payload as a new conversation via `client.queue.retry`; a
`cancelled` chat without a session does not get this button.

When `features.commitChatLens` is enabled from Admin -> Configure -> Features, review chat uses `useReviewChatPresentation()` / `useCommitChatPresentation()` to render unpinned supported chat targets such as commit detail, commit-backed file diff, commit review popouts, PR detail Ask AI, PR review popouts, and Work Item detail Ask AI as bottom-right lenses. Commit and PR mobile/tablet layouts use their existing side-panel or drawer fallback, while Work Item chat keeps the lens presentation on non-desktop viewports. Pinned desktop chat targets render with the shared side-panel frame and an Unpin action; Work Item detail places the pinned chat in a right-side resizable column beside the detail content and persists that column width with a workspace- and Work Item-scoped `coc.workItemChatPanel.width.*` key. Lens open, pin, and minimized states are client-local localStorage scoped by workspace plus review target (`commit` hash, PR repo/id/head discriminator, or Work Item ID). Active Commit, PR, and Work Item lens chats pass a **New chat with same context** action into the current chat header's metadata/overflow menu; the action archives and clears the workspace-scoped target binding through the domain client, leaves the previous process recoverable in history, and returns the panel to the compact empty composer for the same workspace and target label. Minimized state only affects lens presentation and restores from a compact bottom-right pill while keeping the hidden chat tree mounted so drafts and attachments stay intact. `features.commitChatLensDormantMode` (`'ghost'` | `'pill'`, default `'ghost'`) controls the automatic dormant behavior: when the cursor leaves the lens, after a 600ms delay the lens either ghost-fades (near-transparent with scale-down, click-through) or collapses to a compact status pill. The dormant pill keeps the full card mounted but marks it inert, hidden from assistive technology, non-selectable, and click-through until pointer hit-testing restores the card. The full-size outer shell also disables pointer hit testing while dormant, and the visible pill explicitly opts back into pointer interaction, so only the pill covers underlying page content. Focus detection uses a `useLensDormantState` hook backed by document-level `mousemove` hit-testing against the card or pill bounding rect, rather than element-level mouseenter/leave, which is unreliable when child elements toggle `pointerEvents` or when the hit-target shape changes between card and pill. Open lens frames share a visible top-left resize grip that changes width and height while keeping the bottom-right corner anchored; this size is persisted to `localStorage` under `coc.commitChatLens.size` (global, not per-target) and restored on subsequent mounts, clamped to valid viewport bounds. The flag is enabled by default (bootstrap-conservative `absentFallback` keeps legacy partial configs reading it off), so commit review falls back to the legacy `coc.commitChat.open` visibility key and `coc.commitChatPanel.width` resizing behavior only when the admin flag is turned off.

`ReviewChatPlacementFrame` accepts an opt-in `hideHeader` prop; Notes passes it while commits, PRs, and Work Items keep the shared generic Lens/side-panel header. It also accepts opt-in `onDropExistingChat` + `dropWorkspaceId` props that turn the frame into a drop target for a chat row dragged out of the chat list: a `coc.session-context` payload lights a dashed overlay on dragover, and dropping it calls back with the dragged `sourceProcessId` after `stopPropagation()` so the composer's attach-as-context path underneath does not also fire. Cross-workspace drops render a dismissible rejection strip instead. Commit Chat is the only wired surface: `CommitChatPlacementFrame` gates the props on `isSessionContextAttachmentsEnabled()` and forwards the drop to `useCommitChatBinding.bindExistingChat`, which optimistically swaps `taskId` (rolling back on failure) and persists the rebind through `POST /commit-chat-bindings`. The lens dormancy hit test feeds on `dragover` as well as `mousemove` — no `mousemove` fires during an HTML5 drag, so without it a ghosted lens stays `pointer-events: none` and the drop falls through; while a drag is in flight the card, not the compact pill, is the hit target and the ghost→pill collapse is suppressed. `ChatDetail` also accepts an opt-in `hideHeader` prop, which Notes uses to suppress the nested `ChatHeader` without affecting other consumers. The ask/autopilot `NoteModeToggle` stays out of the header and renders beside the empty-state composer input, matching the placement of `ChatDetail`'s `compactModeSelector` once a chat is active.

Chat-list hierarchy grouping is consolidated behind a shared engine:
`features/chat/task-group-grouping.ts` owns the generic matching/aggregation
logic (the `payload.context.taskGroup` tag reader, activity/end timestamp
chains, seeded grouping used by For Each and Map Reduce, shared helpers used
by Ralph), `features/chat/task-group-descriptors.ts` registers per-type
presentation/behavior descriptors (label, badge, accent, pin type,
`matchesTask`, `groupable` — Dreams is `groupable: false` so its internals
stay ungrouped), and `features/chat/TaskGroupRunRow.tsx` is the shared
parent-row chrome that `ForEachRunRow`/`MapReduceRunRow`/`RalphSessionRow`
configure as thin wrappers (Ralph supplies its phase dot, `R` badge,
clarifying/iteration sub-label, and session-context drag payload through the
row's optional display/behavior hooks). The per-feature grouping modules
(`for-each-run-grouping.ts`, `map-reduce-run-grouping.ts`,
`ralph-session-grouping.ts`) are adapters over the engine that keep their
legacy matching (feature contexts, `generationProcessId`) in addition to the
generic tag, so historical chats group without data migration.

The task-group UI family shares the same wrapper-over-generic pattern beyond
rows: `features/chat/TaskGroupRunPane.tsx` is the shared run-detail pane
(load/refresh/busy-action state, header with run metadata and Start/Continue,
Cancel remaining, Refresh actions, original-request/shared-instructions
sections, items table with per-item Retry/Skip and child-chat links) that
`ForEachRunPane`/`MapReduceRunPane` configure per kind — Map Reduce adds its
reduce-step section and header metadata through config render slots.
`features/chat/TaskGroupPlanReviewCard.tsx` is the shared plan-review card
(transcript-vs-persisted scan merge, structured item editor, Advanced JSON
editor, validation footer, approve flow) that
`ForEachPlanReviewCard`/`MapReducePlanReviewCard` configure with per-kind
scan/build/format/parse/validate adapters and an `approve` submission; Map
Reduce contributes its max-parallel input, reduce-instructions editor, and
header pill via render slots. `features/chat/task-group-expansion.ts` holds
the workspace-scoped expand/collapse state for all group kinds behind
`useTaskGroupExpansion` (pure, unit-tested helpers; state resets on workspace
switch), and `features/chat/task-group-copy-info.ts` holds the pure "Copy
run/session info" context-menu text builders.

`features/chat/ChatListPane.tsx` keeps grouped chat-history expansion state
local to the mounted view. Ralph session groups, For Each run groups, Map
Reduce run groups, and plan-file/history groups render collapsed by default on
mount or workspace switch; unread dots/count badges and Mark all read controls
remain the visibility affordances for unread children. Queue pause insert zones
open the shared pause-duration menu (`Until resumed`, 1/2/3/4/8-hour presets,
plus a `Custom…` row with an inline number input accepting float hours in
(0, 24] — invalid values show an inline error without closing the menu) and send
the selected `durationHours` only for timed pause markers; queued timed markers
render a static `Queue pauses here · <duration>` label (fractional hours
formatted as `Xh Ym`, e.g. `1.5` → `1h 30m`) until the executor reaches and
consumes them. Workspace-scoped group pins from
`client.processes.listGroupPins(workspaceId)` render non-running Ralph session
groups, For Each run groups, and Map Reduce run groups as parent rows in the
existing Pinned section, interleaved with individually pinned chats by pin time;
pinned parent rows are removed from their normal recency bucket without mutating
child process pin/archive state. Running For Each and Map Reduce parent rows
stay in the Running section even when pinned, while retaining the pinned
affordance. Parent rows expose the same hover pin affordance and context-menu
Pin to top/Unpin actions as individual chat rows, but those actions call the
workspace group-pin API instead of changing child process `pinnedAt`. The
chat-list multi-select range model follows rendered grouped rows: collapsed
Ralph sessions, For Each runs, and Map Reduce runs count as one row and expand
to their real child process IDs when selected; expanded groups range over visible
child rows, and desktop Shift-click on a parent row uses that parent as a range
endpoint without opening the detail pane. For Each run groups are backed by
workspace-scoped `client.forEach.list(workspaceId)` summaries and nest linked
generation/child chats by `payload.context.forEach`, persisted `forEach`
metadata, or `generationProcessId`. Map Reduce run groups are backed by
workspace-scoped `client.mapReduce.list(workspaceId)` summaries and nest linked
generation/map/reduce chats by `payload.context.mapReduce`, persisted
`mapReduce` metadata, or `generationProcessId` so child chats do not duplicate
as standalone rows.

`RepoChatTab` stores the Activity chat-list collapsed state and left-panel width
in localStorage keys suffixed by the active `workspaceId`
(`activity-list-collapsed-{workspaceId}` and
`activity-left-panel-width-{workspaceId}`), so each workspace restores its own
rail visibility and desktop/tablet panel width.

Chat row pin/archive state comes from process summaries (`pinnedAt` and
`archived`) and is synchronized through `ChatPreferencesProvider` /
`ChatPrefsSync`. Mutating row actions call `pinArchiveApi` with the provider's
`workspaceId`, and that helper resolves `getCocClientForWorkspace(workspaceId)`
so remote clone conversations mutate the selected remote CoC server while local
conversations keep using the default SPA client. `ChatDetail` also uses its
workspace-routed `useCocClient(workspaceId)` for process reads, refreshes, and
per-turn delete/pin/archive actions; loaded conversation turns render persisted
`pinnedAt`, `archived`, and `deletedAt` from the process detail response as the
source of truth. Chat pop-out URLs include `cloneBaseUrl` for remote workspaces
and `PopOutChatShell` seeds the clone registry before rendering `ChatDetail`, so
standalone windows keep the same clone-aware row and turn actions.

`features/chat/RalphGrillSetupPanel.tsx` renders the disabled-by-default
multi-agent Ralph grilling setup card when `features.ralphMultiAgentGrill` is
enabled. New Chat Ralph grilling (`NewChatArea`) and promoted ask-mode chats
(`FollowUpInputArea` via `ChatDetail`) both use the same compact card so users
choose Light/Standard/Deep depth, see inherited provider/effort defaults once,
and expand individual role rows only when per-role provider/tier overrides are
needed before the consolidated question-planning turn is submitted. While the
server runs the separate grill-agent preflight, `ConversationArea` renders the
transient
`ralph-grill-planning` SSE state as an immediate compact status card. The live
`ask_user` form then renders any Ralph grill planning metadata from
`pendingAskUser` as one compact "Question planning" card plus grouped role
sections and provenance chips; it does not create separate agent threads or
separate answer submissions.

`features/canvas/CanvasPanel.tsx` renders the chat canvas side panel, gated by
the `canvas.enabled` runtime flag. It is a composition root: it owns the public
props, the workspace-routed `useCocClient(workspaceId)`, fullscreen chrome, and
layout, and delegates everything else to kernels under `features/canvas/hooks/`
(`useCanvasRecord` — load, live `canvas-updated` reconciliation, `reloadNonce`,
debounced revision-checked autosave and 409 conflicts; `useCanvasVersions`;
`useCanvasComments`; `useCanvasExport`; `useCreateKustoCanvas`), pure helpers in
`canvas-panel-model.ts`, and presentational components under
`features/canvas/components/` (header, banners, body renderer, selection
toolbar, comments panel). The routed client is passed into every kernel
explicitly, which is what keeps remote/clone workspaces hitting the
workspace-owning server (`isCanvasEnabled()` in `utils/config.ts`,
default on). When enabled, `ChatDetail` discovers canvases linked to the open
process via `client.canvases.list(workspaceId, { processId })`, keeps those
summaries in API order for the panel title switcher, and refreshes the list on
live `canvas-updated` SSE events (surfaced by `useChatSSE`'s `onCanvasUpdated`
callback). It mounts the panel as a desktop-only (`lg:`) resizable right column
beside the conversation, with width persisted under
`coc.canvasPanel.width.<workspaceId>` via `useResizablePanel`. The panel shows
the canvas title, revision, and a Preview (shared `useMarkdownPreview`
pipeline, with rendered HTML passed through to `useMermaid` as its re-render key
and `.canvas-mermaid-preview` fit-to-pane SVG sizing; `.canvas-mermaid-preview
.markdown-body` shares the chat semantic-HTML block spacing rules in
`tailwind.css`) / Edit (plain textarea) toggle. When a conversation has two or
more canvases, the title renders as a button with a chevron; its dropdown lists
every linked canvas title only, highlights the active canvas, and updates
`activeCanvasId` in `ChatDetail` when an item is selected. User edits autosave
with a debounce through `client.canvases.save(...)` carrying
`expectedRevision`; an HTTP 409 shows a conflict banner with a "Load latest"
action, and a live AI update arriving over unsaved local edits shows a
pending-update banner instead of clobbering the draft. The canvas mounts as a
full-height right column of a top-level split in `ChatDetail` (the
conversation and follow-up composer share the left column), so the panel spans
the whole detail pane height beside the composer. A header fullscreen toggle
(`onFullscreenChange`) re-renders the panel as a `fixed inset-0 z-50` overlay
covering the viewport (Esc exits); while fullscreen, `ChatDetail` collapses the
in-flow canvas column width to 0 so the conversation reclaims the space. The
header also offers a pop-out button (`onPopOut`) that opens the canvas in a
standalone window (`PopOutCanvasShell`, routed from `entry.tsx` on
`#popout/canvas` with `?workspace=&canvasId=`); that window maps the global
WebSocket `canvas-updated` event into the panel's `liveEvent` and bumps
`reloadNonce` on focus to pick up AI tool edits that streamed over the chat SSE
channel. Closing the canvas does not detach it: `ChatDetail` keeps a thin
right-side reopen rail (mirroring the chat-list collapse rail) so a linked
canvas stays reachable. Canvas header controls reuse the shared ICON_BTN style
(matching `ChatHeader`). The header revision chip is a
version stepper backed by the canvas versions API: stepping back shows an
older snapshot read-only with a history banner whose **Restore as latest**
action saves that snapshot's content as a new revision (disabled while local
edits are unsaved). Selecting text in the preview or the edit textarea shows a
selection action bar: **Ask AI** prefills the follow-up composer (via
ChatDetail's `onAskAi`, which sets `followUpInput` and the `RichTextInput`
ref) with a prompt quoting the selection plus the canvas id/revision, and
**Comment** opens an inline compose box that stores an anchored comment. Open
comments render in a footer list with a **Send N to AI** action that posts one
batch message through ChatDetail's `onSendToAi` (`sendFollowUp(message,
'enqueue')`, so a busy AI receives it at the next turn boundary) and then
marks those comments `sent`. Right-clicking an inline image in the preview
opens a custom **Copy image** menu that writes an `image/png` bitmap via
`copyImageToClipboard`; a native Ctrl+C over a preview selection that contains
an inline image inlines each image as a base64 `data:` URI in the `text/html`
clipboard flavor (`copySelectionWithInlineImages` in `utils/format.ts`, sync
`clipboardData` fallback + async `navigator.clipboard.write` upgrade) so images
survive a paste into Word/Google Docs/email — text-only selections fall through
to the browser's native copy untouched. Code canvases (`type: 'code'`) show a
language chip and use `MonacoFileEditor` (shared with the repo explorer) in Edit
mode with the same debounced autosave. Their preview is normally a fenced,
highlighted block. `language: 'svg'`, or `xml`/unset content whose trimmed source
starts with `<svg`, instead mounts `SvgCanvasView`: rendered mode is the default,
Source shows the highlighted XML, and wheel/drag provide zoom/pan. The view
inserts only `sanitizeSvg` output into a ShadowRoot so SVG styles stay isolated;
invalid SVG shows the sanitizer error and escaped source. SVG downloads use the
raw persisted source in an `image/svg+xml` blob with a `.svg` filename. Selection
actions stay available in preview mode. The header Export menu also offers Copy
content and — for markdown canvases — Save to Notes, which writes the content to
`canvases/<slug>.md` in the workspace Notes tree via `notes.saveContent`.
Extension canvases (`type: 'extension'`) render
`ExtensionCanvasView` in preview mode: the extension's `ui.html` runs inside an
`<iframe sandbox="allow-scripts">` whose injected `window.CanvasHost` bridge
(`version`/`onState`/`invoke`/`setState`/`listFiles`/`readFile`) talks to the host over `postMessage`.
The host side lives in `useExtensionCanvasHostController`, not the view: it
posts `canvas-state` on ready and on every live update, services
`invoke-capability` through `canvases.invokeCapability` and `set-state` through
the revision-checked `canvases.save`, so human UI actions and AI capability
calls share one gate. The bridge is protocol **v2** (constants, the method
table and the error shape live in `features/canvas/canvas-host-contract.ts`;
`canvas-host-bootstrap.ts` generates both the live and the offline in-frame
host from that one table): `invoke`/`setState`
tag each message with a monotonic `id` and return a promise that settles on the
host's `{ type: 'response', id, ok, result | error }` reply, or rejects after
60s with `code: 'timeout'`. Rejections all carry `{ code, message }` with
`code` in `offline` / `timeout` / `revision-conflict` / `capability-error` /
`file-error`; a failed capability both rejects the extension's promise and shows
the host banner, while a failed `readFile`/`listFiles` only rejects — a missing
data file is the artifact's business, not a panel-level error. A message with **no `id`** is a pre-v2 sender and is still serviced in
full, just without a reply. While one or more `invoke` calls are outstanding the
panel shows a `extension-canvas-pending` indicator, since a capability the
manifest declares `async: true` runs server-side with a 30s budget; it clears
when the LAST invoke settles. There is deliberately no `CanvasHost.complete()` —
model access lives only inside an async capability's server-side `host`, so the
"a capability returns the next state" contract stays intact and rate limiting
and logging live in one place. In an exported HTML artifact the offline bootstrap
rejects `invoke`/`setState` with `code: 'offline'` rather than no-oping, so a
v2 extension's `await` fails fast instead of hanging (the canvas's files are not
inlined into an export — unbounded size). `listFiles`/`readFile` are READ-ONLY
and scoped to `canvases/<canvasId>/files/`, the canvas's own directory: they hit
`canvases.listFiles` / `canvases.readFile`, which return
`{ path, size, encoding, content }` (`utf-8` for text, `base64` otherwise, and
`{ encoding: 'base64' }` forces bytes). Only the AI writes into that directory,
via `extension_canvas`'s `files` argument. The extension load,
`invoke-capability`, `set-state`, `list-files` and `read-file`
calls all route through the workspace-scoped `useCocClient(workspaceId)` client
(like `CanvasPanel`), so a remote workspace's extension is read from and written
to its owning server rather than the local page origin. Edit mode shows the raw
JSON shared state. Inline `canvas://<canvasId>` references are rendered by
`shared/CanvasEmbed.tsx`, which fetches the descriptor through the same
workspace-routed client and chooses the renderer from its persisted `type`:
Excalidraw keeps the view-only preview, extension canvases mount
`ExtensionCanvasView`, `type: 'kusto'` canvases mount a compact `KustoView`, and
markdown/code canvases use a document preview. Legacy
`.md-excalidraw-embed` placeholders remain supported for historical message HTML.

Kusto query canvases (`type: 'kusto'`) render `features/canvas/KustoView.tsx` (and
`KustoChart.tsx` for the native SVG charts), gated by the `kusto.enabled` runtime
flag (`isKustoEnabled()` in `utils/config.ts`, default off). The view exposes an
editable KQL query, cluster URL, and database, a Run button that executes
server-side via `client.canvases.run(...)` (no AI turn) through the
workspace-routed client, table/chart views, CSV download, and — when the canvas is
linked to a chat — an Ask AI box that sends a follow-up naming `kusto_query`. When
the flag is on, `CanvasPanel`'s header shows a **New Kusto query** action
(`data-testid="canvas-panel-new-kusto"`) that creates a blank `type: 'kusto'`
canvas titled `Kusto Query`, best-effort seeding cluster/database from the
workspace's most recent Kusto canvas (`kustoCreate.ts`). Kusto canvases carry a
`kusto` badge, own their editing surface (no markdown Preview/Edit toggle or HTML
export), and are rendered inline from `canvas://` links by `CanvasEmbed`. Viewing
an older revision routes the stored snapshot through the same `KustoView` in a
`readOnly` mode (no Run, no Ask AI, read-only editors, chart toggle is local-only
and never persisted) so historical rows render via `InteractiveTable` — kusto
canvases never feed their serialized row JSON to the markdown pipeline
(`chatMarkdownToHtml`), avoiding a costly parse of up to `MAX_KUSTO_ROWS` (10,000)
rows on each revision switch. When a conversation holds several inline Kusto
embeds, `KustoEmbedGroupProvider` (`shared/KustoEmbedGroup.tsx`, wrapping the turn
list in `ConversationArea`) keeps only the last embed in document order expanded
and collapses the rest to a clickable header (title + row-count summary); each
embed registers its wrapper element and the group picks the last via
`compareDocumentPosition`. A reader's manual toggle overrides the default, and an
embed rendered outside any provider stays expanded. To keep the embed compact,
the expanded header exposes a slot (`canvas-embed-kusto-connection-slot`) and
`KustoView` — given `connectionInHeader` + `connectionSlot` — `createPortal`s its
cluster/database editors into it instead of the body labeled row (the editors
stay owned by `KustoView`; only their mount point moves). The SPA client no-emit gate
(`npx tsc -p tsconfig.client.json --noEmit`) is intentionally scoped to this
Canvas/Kusto surface and its imported helpers.

`shared/svg/sanitizeSvg.ts` is the client SVG trust boundary. It rejects
malformed/non-SVG XML, runs DOMPurify's SVG profile, removes scripts, event
handlers, `foreignObject`, script-bearing CSS/SMIL values, and external resource
references, and preserves safe SVG styles, gradients, filters, and animation.
Direct `href`/`xlink:href`/`src` values are limited to base64 raster `data:`
URIs; internal paint references such as `fill="url(#gradient)"` remain valid.
Any surface that mounts the sanitized result must use a shadow root so allowed
SVG `<style>` rules cannot affect the surrounding dashboard document.

`features/chat/source-canvas/` renders the docked, read-only source-file canvas
for local file references clicked inside assistant chat responses. The global
file-path delegation normalizes bare `.file-path-link` spans, shared renderer
`.md-link` spans, and local Markdown `<a href>` anchors from chat's markdown
renderer into one file-reference path. Bare prose linkification keeps a terminal
run of `.`, `,`, `;`, `!`, or `?` outside the clickable span and its metadata;
explicit Markdown hrefs and paths in code or preformatted blocks retain their
literal behavior. When `SHOW_SOURCE_CANVAS_FOR_CHAT_LINKS` is enabled,
assistant-response clicks dispatch `coc-open-source-canvas` with the bare path,
workspace hint, optional `sourceFilePath`, and optional line/range metadata.
Local `file://` hrefs are converted to filesystem paths and GitHub-style
`#L<line>` / `#L<start>-L<end>` hashes are carried as line metadata, so the
resolver never treats a file URI as workspace-relative text. The
shared `MarkdownView` intercepts assistant-prose conversation deep-links with
`#/process/<id>`, `#/session/<id>`, or `#/processes/<id>` hrefs, prevents the
default link action, and assigns `window.location.hash`; the router recognizes
those shorthand hashes, resolves the owning workspace from cached queue/history
state when possible (falling back to the currently selected workspace), selects
the queue task, and normalizes the URL to the existing
`#repos/<workspace>/<chat-tab>/<id>` chat route. Other hash and external links
keep their normal renderer behavior. The
source-canvas resolver chooses the explicit workspace hint when
present, otherwise the longest matching workspace root, and resolves relative
paths against `sourceFilePath` when available or the selected workspace root
before calling the workspace file preview API. WSL workspaces on a Windows host
have a `\\wsl$\<distro>\...` root: the shared helpers in
`react/utils/path-resolution.ts` keep that UNC prefix through relative
resolution and tilde expansion, and the resolver re-roots plain Linux paths
(`/home/u/repo/...`, what WSL agents emit) onto a workspace share when the
result lands inside that root. The preview endpoint applies the same re-rooting
server-side via `resolveRequestedFilePath` (`server/tasks/tasks-handler-utils.ts`). `useSourceCanvasContent` folds the
remote-server workspaces (which live in the repos list, not `state.workspaces`)
into the resolver's workspace set, so a link clicked in a remote conversation
resolves against that workspace's remote `rootPath`, and it routes the preview
fetch through `getCocClientForWorkspace(wsId)` so a remote ref is read from its
own server instead of the local one. `ChatDetail` owns the listener,
closes sibling right-side panels, and mounts `SourceCanvasPanel` as the right
column on desktop or a bottom sheet on mobile. Flag-off, user-message, and
non-chat file references continue to route to the floating
`MarkdownReviewDialog`. File-backed plan paths in `ImplementPlanCard` use the
same dock through `onOpenPlanFile`: they render as native keyboard-accessible
controls and open an editable note scoped to the chat's source workspace,
including a remote clone. Canvas-backed plan labels remain static because they
do not identify an on-disk file.
`ChatDetail` derives the source-header switcher candidates in memory from the
current conversation's loaded assistant turns through the same markdown/file-link
metadata used by click handling. It excludes notes and folders, de-duplicates
normalized workspace/path identities, keeps the latest line/range, and orders
files newest-first. The selector appears only when a code canvas has multiple
candidates, including inside the mobile sheet; selecting one replaces the single
active canvas with that candidate's workspace and line/range. The candidate list
is never written to browser or disk storage. The source canvas header shows
project-relative paths for files inside the current workspace root while
retaining the full absolute path in the hover tooltip; files outside the
workspace root continue to display their absolute path. The source-canvas folder
explorer uses the same resolver but converts the resolved absolute folder to a
workspace-relative tree path before calling `explorer.tree`; the workspace root
is sent as `.` while outside-root paths stay absolute so the server-side repo
guard can reject them clearly.

## Chat UI Architecture

`ConversationTurnBubble` renders:
- **Assistant turns:** Left-aligned with `C` avatar whose color tracks the
  chat's provider via `getProviderAvatarClasses` (`ProviderBadge.tsx`) —
  Copilot=green, Claude=coral/orange, Codex=indigo. Body is borderless,
  flowing content. The `provider` prop flows from `ChatDetail` →
  `ConversationArea` → `ConversationTurnBubble`; missing/unknown provider
  metadata falls back to the Copilot (green) palette.
- **User turns:** Right-aligned with `Y` avatar (blue), soft-gray rounded bubbles.
  Message text renders as markdown through the same escape-at-generation
  `chatMarkdownToHtml` pipeline as assistant turns (`breaks: true` preserves
  single newlines; `linkifyFilePaths` skips code spans/blocks; raw HTML in the
  message is escaped, never injected), so pasted/typed markdown displays
  formatted; the raw toggle remains the escape hatch showing literal source.
  Turns with `pasteExternalized: true` keep any detected short typed prompt
  visible and render the large pasted payload as an in-bubble card with character
  count, three-line preview, expand/collapse, and Copy full content; no extra
  persistent display state is stored.
- **Error turns:** Red error-strip aside with retry button; the avatar
  keeps its dedicated red palette and ignores `provider`.
- **Interrupted assistant turns:** Amber "Partial response preserved" banner
  renders above the still-visible partial transcript and tool timeline. The
  Continue / retry button sends a generated raw follow-up through the normal
  follow-up path (auth/session/provider/network-looking interruptions use retry
  wording; other interruptions ask the assistant to continue). It does not
  replay preserved partial content into a prompt or include current composer
  draft/paste/context/attachments.
- **Script output:** Dark terminal window with PASS/FAIL highlighting; the
  avatar keeps its dedicated dark-terminal palette and ignores `provider`.

`ProviderBadge` (the chat-header agent pill) shares the same provider
palette and mirrors `ChatStatusPill`'s "Thinking" style: rounded-full
bordered pill with a leading colored dot followed by the provider label.
Running chat-list rows do not render separate provider pills; their leading
status dot uses the provider palette (Copilot green, Claude coral, Codex
indigo) and falls back to Copilot green when provider metadata is missing.
Task-tree queue activity badges reuse the provider dot palette from
`ProviderBadge`: queued/running items carry `payload.provider` through
`useQueueChat`, and file/folder "in progress" badges fall back to Copilot
green when provider metadata is missing.

`ChatHeader` measures its own container via `useContainerWidth` with a
chat-header-specific `wideThreshold` of 960px (raised above the generic 700px
default) because its wide tier renders the inline `ReferencesDropdown` plus the
full status pill on the left while the right side carries the agent tree
popover, copy, and `ChatHeaderOverflowMenu` controls. At `wide`
(≥960px) References is inline and the status pill shows its label + duration; at
`medium` (500–959px, including 700–900px split-pane, source-canvas, and
browser-zoom widths) References folds into the overflow menu and the pill goes
icon-only; at `narrow` (<500px) the action group wraps onto a full, end-aligned
second row and float/pop-out move into overflow. The left identity group is
`flex-1 min-w-0 overflow-hidden` and the title is always `min-w-0 truncate`, so
the title yields width first and can never bleed under the non-shrinking action
group. The `ConversationMetadataPopover` "i" trigger sits inline in this identity
group immediately after the title (rendered at every tier when the process is
resolved and not pending), not in the `ChatHeaderOverflowMenu`.

`QueuedFollowUps` renders pending messages as compact dashed-border cards with cancel buttons.

For commit chats, `buildRows()` adds a monospace, break-all **Commit** row with the full hash and, when one was persisted, a wrapping **Commit message** row. Both come from the process's `metadata.commitChat` (validated by `readCommitChatContext`), never from `git rev-parse HEAD` or the prompt text, so the row keeps naming the commit the conversation was created for after HEAD moves. `buildMetadataProcess()` falls back to `task.payload.context.commitChat` until process details load. Malformed metadata and ordinary chats produce no rows, and the hash stays out of the categorical summary strip. Because the rows live in the shared popover, they appear in the commit lens, pinned/floating views, pop-outs, the mobile bottom sheet, and Activity detail without extra props.

`ConversationMetadataPopover` keeps long identifiers as separate label/value rows
for wrapping and log links, while short categorical fields render as a compact
summary chip strip and related fields collapse into `Time`, `Workspace`,
`Ralph`, `Goal`, and `System` rows. When a process exposes
`cumulativeTokenUsage`, the popover also renders live conversation-level
`Tokens` and `USD cost` rows: token totals expand to input/output/cache
breakdowns, and cost uses the server-derived native-first
`conversationCostEstimate.displayedUsdCost` (`actualUsdCost ?? estimatedUsdCost`
per turn) with compact source labels, URL-backed pricing-source links, and
partial/unavailable-pricing caveats. While a conversation is
running, `useChatSSE` mirrors `token-usage` event `cumulativeTokenUsage` and
`conversationCostEstimate` snapshots into the cached process details that feed
the popover; after completion, the normal process refresh replaces that live
snapshot with the final server read model.

`UsageStatsView` renders token totals per model/day plus USD-only cost metadata
for every populated usage cell. The displayed cost uses the native-first
`displayedUsdCost` field (`actualUsdCost ?? estimatedUsdCost` as computed by the
server/Forge layer); cells without a displayable USD value show explicit
`USD pricing unavailable` copy instead of silently leaving cost blank. The UI
does not render Copilot premium request units.

### Implement-plan card (plan → autopilot handoff)

`ImplementPlanCard` (`features/chat/ImplementPlanCard.tsx`) is the thread-only
flow card shown after a completed **Ask-mode plan-file chat** (gated in
`ChatDetail` on terminal status, not busy, Ask mode, and a known
`effectivePlanPath`). `ChatDetail` derives the plan path from
`context.files[0]` → `payload.planFilePath` → `metadata.planFilePath` →
detected `.plan.md` created files → detected plan canvas, and each persisted
slot is filtered through `asPlanPath` (path-shaped: absolute POSIX or Windows
drive path). This matters because scheduled chats enqueue their raw instruction
text as `context.files[0]`, and the server only records `metadata.planFilePath`
from `context.files[0]` when it is path-shaped (`asPlanFilePath` in
`executors/process-lifecycle-runner.ts`) — prompt text must never surface as a
readable plan path (the launch dialog would 404 reading it via `/fs/blob`). The
canvas-title label persisted for canvas-backed plans (non-path) is still
admitted when `metadata.planCanvasId` is set. The card is a trigger: clicking **Implement** expands
`ImplementPlanLaunchDialog` (`features/chat/ImplementPlanLaunchDialog.tsx`), an
inline launch panel below the banner styled like `RalphStartPanel`'s open
state (not a modal). When a conversation creates multiple `.plan.md` files, the
banner lists them in a compact selector and the panel repeats the same shared
selection; persisting the first detected path to process metadata does not
collapse the detected list. Explicit task-provided paths and canvas-backed plans
remain single-plan. The panel also hosts the target selector, shared AI controls
(`ModalJobAiControls` via `useModalJobAiSelection`, keyed to the selected target),
a read-only plan summary, and the confirm/enqueue action;
the resolved provider/effort selection is carried into the queue payload
(`payload.provider/model/reasoningEffort` + `config.effortTier` +
`context.autoProviderRouting`) and recorded on the `ImplementationRecord`.
When a **remote** target is selected, the panel fetches the provider list and
effort tiers from the target server (`getCocClientFor(baseUrl).agentProviders`)
and injects them as `externalAgentProviders`/`externalEffortTierMap` overrides
into `useModalJobAiSelection`; if the target is unreachable the AI controls are
replaced by a "Cannot reach target server" hint while enqueue stays available.
The card renders a status banner when prior runs exist (live status of
the latest run, total run count, an expandable per-run list, and a `View →`
action per run).

A compact **target-repo selector** ("Run in …") lets the user run the plan in
the current repo or in an already-registered, **online** remote clone:
- The target list comes from the pure helper `buildImplementTargets(repos,
  current)` (`features/chat/implementTargets.ts`): current repo + local repos +
  **online** remote clones (`remote.offline === false && remote.connection ===
  'online'`); offline/connecting remotes and virtual workspaces are excluded so
  they can never be selected. The list is **scoped to the current repo's git
  origin**: when `current.remoteUrl` is set, only repos sharing its canonical
  origin id (`resolveCanonicalOriginId` / `resolveRepoOriginScope` from
  `repos/originScope.ts`) survive — sibling local clones and remote clones of the
  same repo stay; unrelated repos are dropped. When the current origin is unknown
  (no remote URL) no origin filter applies. The current repo is guaranteed
  present and ordered first (never filtered out), so it stays the default and the
  existing one-click local behavior is unchanged. `ChatDetail` builds the list from `useReposOptional()` and gates it
  on `isRemoteShellEnabled()` — no new feature flag. The selector renders only
  when more than one target exists; outside a `ReposProvider` (e.g. the pop-out
  chat window) the card degrades to local-only.
- **Local target** → keeps the path-based prompt
  (`Read and implement the plan file at <path>` + `context.files`) and enqueues
  on the current repo's client.
- **Remote target** → reads the plan content on the *initiating* (source) server
  via `explorer.readTrustedBlob(planFilePath)`, inlines it in the prompt (the
  remote machine can't read the source machine's local path), drops
  `context.files`, and enqueues on the **target** repo's routed CoC client (a
  `{ id, baseUrl, remote: {} }` `CloneRef` through `useCocClient`). A failed
  source read surfaces an inline error and never enqueues.
- **Remote-sourced plan** → when the *source* workspace itself is a remote clone
  (`sourceIsRemote`/`sourceBaseUrl` props, derived by `ChatDetail` from the
  aggregated repo entry → `lookupCloneBaseUrl` → membership in this server's own
  workspace list), the plan content is always inlined regardless of what the
  target list claims, and both the source read and the fallback enqueue route to
  the source server's baseUrl explicitly. This prevents a remote machine's plan
  path from being enqueued as a path-reference task on the local server (which
  the executor would rewrite to `Follow the instruction <path>.` via
  `context.files`). `buildImplementTargets` carries the caller-supplied
  `isRemote`/`baseUrl`/`serverLabel` when it synthesizes the missing current
  repo instead of hardcoding a local target.

Each run records an `ImplementationRecord` (process id, plan path, enqueue time,
plus target identity: `targetWorkspaceId`, `targetLabel`, `targetServerLabel`,
`isRemoteTarget`) into `task.metadata.implementations` on the **source** task via
the source client. The banner shows the target repo/server for each run, and
`onViewRun(processId, targetWorkspaceId)` opens the run on the server it was
dispatched to. `ChatDetail` resolves a remote run's live status via
`getCocClientForWorkspace(run.targetWorkspaceId)`; local runs use the default
client.

### Agents view (sub-agent canvas)

`ChatHeader` exposes one agent navigation control through its `viewToggle` slot:
`AgentTreeMenu` (`features/chat/agent-canvas/AgentTreeMenu.tsx`). `ChatDetail`
owns one `AgentNav` state union (`thread`, `map`, or `agent`) and derives
`effectiveNav` from it, forcing `thread` when the chat has no sub-agents
(`hasSubAgents = agentRoot.children.length > 0`) or a selected agent id no
longer resolves. The control is hidden when the chat has no sub-agents, in the
`floating` variant, and while loading/pending, so stale `?view=agents` links
land on the thread instead of an empty map. Inline chat hashes read and write
through `agentNavHash.ts`: legacy `?agent=<id>` opens that detail view and wins
over `view`, legacy `?view=agents` opens the map, and the default/no-param state
is the thread. Writing keeps `?view=agents` for the map so old links stay in the
same vocabulary. `parseActivityDeepLink` strips the `?query` so these params
never corrupt the taskId. Agent navigation resets from the current hash on chat
switch after the initial mount, and a stale `agent` id clears to `thread`.

`buildAgentRunTreeFromTurns(turns, root)` derives the tree with no extra fetch:
the orchestrator (this process) is the root and each `Task` tool call becomes a
sub-agent node, nested under the sub-agent that spawned it (via
`parentToolCallId`) so the tree has real depth (L0 → L1 → L2 → …); a Task whose
parent isn't another captured Task — or whose parent chain is cyclic — attaches
to the orchestrator. From the call's args it captures the agent name (`args.name`,
falling back to `description`/`prompt`), type (`agent_type`/`subagent_type`),
`model`, `mode`, `description`, and `prompt`; status/timing come from the call.
For background `task` calls whose immediate result is only an `agent_id`
startup acknowledgement, the tree correlates that id with later `read_agent`
tool calls and uses the completed agent output for the node's result/summary and
completion time.
Children are deduped across `toolCalls`+timeline — keeping the snapshot with
non-empty args, since a terminal `tool-complete` often carries empty args while
an earlier snapshot holds the full invocation — and ordered by start time.
Tool name/args are read
via `toolName ?? name` and `args ?? parameters` so sub-agents are detected in
both the live (SSE) shape and the persisted forge read model — they stay on the
canvas after the chat completes and turns refresh. (These tool-call readers live
in `agentToolCalls.ts`, shared with the sub-agent reconstructor below.)
`AgentCanvas` reuses the shared `useZoomPan` hook — it opens at 100% zoom,
centered (`centerContent`), re-centering on mount/growth/resize until the user
takes over. The toolbar's % is a dropdown of preset levels
(25/50/75/100/150/200% + Fit) backed by `useZoomPan`'s `zoomTo(scale)`
(zooms about the viewport center); the Fit button zooms to fit the whole tree.
`useZoomPan`'s wheel-zoom and pan-drag both skip events originating inside a
`[data-no-drag]` overlay — the toolbar and legend — so those scroll/click
natively instead of zooming/panning the canvas behind them.
It renders curved SVG edges + node cards (role glyph, name, live elapsed,
spawn-count pill, status dot, progress bar) and a live 1s clock for running
nodes. The map is opened from `AgentTreeMenu`'s footer when the tree is large
enough to benefit from spatial shape (`countRuns(root) > 6`). Clicking any
canvas node routes through `onOpenAgentDetail`: sub-agent nodes open the same
read-only detail view as tree rows, while the orchestrator root returns to the
main thread.

**Tree popover + in-place sub-agent detail.** `AgentTreeMenu` renders the real
tree as ARIA `tree`/`treeitem` rows with indentation, twisty expand/collapse,
status dot, role glyph, name, role, elapsed text, selected state, and keyboard
navigation (Up/Down, Right/Left, Enter/Space, Escape). The root row is
`Main thread`; selecting it sets `{ kind: 'thread' }`. Selecting a sub-agent sets
`{ kind: 'agent', id }`; selecting the footer map action sets `{ kind: 'map' }`.
Expansion is seeded once: every parent expands in small trees (<= 12 runs), and
large trees expand the root plus the selected agent's ancestor chain. Because the
live `agentRoot` object is rebuilt as turns stream in, the menu does not reseed
on root identity changes; it only unions in selected ancestors when the selected
id changes, so user collapse state survives streaming updates.

`buildSubAgentTurns(turns, id)` reconstructs a selected sub-agent's conversation
as `[userTurn(prompt), assistantTurn(steps + result)]` by collecting its full
descendant subtree via `parentToolCallId`, then renders it through the **same**
`ConversationArea` / `ConversationTurnBubble` as the main thread — identical
tool-call rendering. The filtered steps keep their `parentToolCallId`: the
sub-agent's own Task id is absent from the synthetic turn, so the renderer leaves
its direct steps at top level and nests deeper descendants under their parents
(nested sub-agents render as Task cards), re-rooting the subtree. The
`SubAgentDetailView` header shows the full breadcrumb plus status, duration,
model, mode, and spawned-count metadata; it does not duplicate the task prompt or
result, because those are already the synthetic user/assistant turns. There is no
follow-up input in detail mode, and the sub-agent's status (not the
orchestrator's) drives the streaming tail. For background sub-agents, the closing
content uses the matching `read_agent` final output when available, rather than
the `task` startup acknowledgement. Limitation: `content`-type timeline items
carry no parent linkage, so a sub-agent's prose isn't attributed — its Task
result (or matching `read_agent` final output) shows as the closing content
instead.
`ConversationTurnBubble` builds parent/child chunk maps after falling back from
timeline events to persisted `toolCalls`, so nested child tools still render
inside their parent Task when a detail view (or older history record) only has
flat tool-call snapshots. Whisper mode (`toolCompactness === 3`) applies to the
same synthetic assistant turn: preceding descendant tool calls collapse into the
normal `WhisperCollapsedGroup` and the sub-agent result remains visible as the
tail content.
Styles live in scoped `agent-canvas.css` (`.agent-canvas`,
light/dark via `.dark`); there is no clock scrubber (the prototype's replay
control is dropped — the real view is
live). Distinct from the co-edited `CanvasPanel` side panel.

## Tool Call Rendering

Inside `WhisperCollapsedGroup`, tool calls render as compact "whisper-row" variant:
- Single flat row: kind pill + truncated summary + duration + chevron
- Color-coded pills: Read/blue, Grep/Glob/green, Edit/Write/amber, Shell/PS/SQL/purple, Skill/grey

`ToolCallView` display policy is a pure kernel: `buildToolCallRenderModel`
(`toolCallRenderModel.ts`) derives normalized identity, summary, truncation,
preview eligibility, and the whisper-row metric; the whisper-row and card
variants share one `ToolCallDetailSections` body. For generic `shell`/`bash`
calls (Codex routes every command through the canonical `shell` tool), the
display-only `shellCommandClassifier.ts` reads the command *string* — never
executing it — and, when it is confidently one clear family, relabels the call
to Search / Read / Files / Git: it unwraps one `sh|bash|zsh -c/-lc` interpreter
wrapper, refuses redirection / substitution / subshells / `&` / assignments /
mutating variants (`sed -i`, `find -delete/-exec`, `tee`, `fd --exec`), allows
same-family chains and read-only presentation pipelines (`| head`, `| sed -n`),
and returns null (keep Shell) otherwise. The render model then overrides the
kind pill/label (reusing green Search, blue Read, green Files, purple Git
colors), the concise summary (a human `description` wins when present, else a
derived pattern/path/subcommand, else the unwrapped command text), the
whisper-row metric noun (hits/files/lines), the card `displayName` (title-cased,
so `shell` reads as "Shell"), and an `isSemanticShell` flag driving the honest
"executed through shell" pill tooltip. The canonical stored name, raw args, and
`bashCommand` (Copy Command source, expanded Command section) are untouched.
Homogeneous shell groups get a semantic summary (`4 searches`, `2 Git commands`)
via `getShellGroupSemanticLabel` (`toolGroupUtils.ts`); mixed/unknown groups keep
`N shell operations`. PowerShell is not classified in this version. Whisper header parts and the
group's reconstructable tool calls come from `buildWhisperGroupModel` /
`collectGroupToolCalls` (`whisperGroupModel.ts`). The whisper summary spans
(skills/memories/files/commits/PRs/pushes) share the `useHoverPopover` /
`HoverSummarySpan` hover primitive (`hoverPopover.tsx`). Skill-count hover
lists stay anchored to the whisper summary, but selecting a skill opens
`WhisperSkillDetailDialogProvider`'s panel-scoped dialog. `ChatDetail` mounts
that provider around the left conversation stack, so the backdrop and centered
skill detail are bounded by the active conversation column and do not span
right-side canvas/source/diff sibling panels; the DAG item conversation panel
uses the same provider around its slide-in surface. The dialog lazy-loads skill
details through the clone-routed skill client, tries workspace lookup before
global lookup, caches per workspace/name while the provider is mounted, shows a
stable not-found state for total lookup failure, traps focus, closes on Escape,
backdrop, or the close button, and returns focus to the selected row or skill
count trigger.

In whisper mode (`toolCompactness === 3`), `filterWhisperChunks` keeps a tail of
the final assistant message plus any `task_complete`/visible `ask_user` chunks,
collapsing everything else into one summary group. The final message is the last
`content` chunk plus earlier content chunks separated from it only by
non-breaking trailing tools (`suggest_follow_ups`, `report_intent`,
`task_complete`, `ask_user`); the walk-back stops at the first substantive
tool/tool-group. This keeps a rich answer visible even when a hidden
`suggest_follow_ups` call splits it from a trivial closing line.

Chat commit strips are detected entirely in the SPA from already-loaded turn
tool data; no server-side commit binding or persistence is required for display.
The detector treats commit-creating commands (`git commit`, `git merge`,
`git cherry-pick`, `git revert`) with native git output such as
`[branch abc1234] subject`, or compact verification output such as
`abc1234 subject`, as commits. For truncated commit-command output, the SPA
keeps a short same-turn verification window so a correlated `git log -1`
verification command can supply the hash/subject. Unrelated read-only git
commands and generic assistant prose remain ignored.

Live unanswered `ask_user` batches remain owned by
`ChatDetail`/`ConversationArea` through `processDetails.pendingAskUser` and
`AskUserInline`. The form is laid out for density: a single header row carries
the title, the question count, and the Submit/Skip actions (there is no separate
footer row), option rows put the label and a truncated description on one line
with the full description in the row's `title` tooltip, and a one-question batch
drops the nested per-question card so only the outer card frames it. Each live
question card has a borderless response-type dropdown (boxed on hover) with
Answer, Skip, and Need context choices; the deferred choice marks that question
complete for batch submission and reveals an optional short note field. Unsubmitted live-batch drafts are saved in browser
localStorage scoped by process id and batch id, restored after navigation or
refresh for the same batch, and cleared on accepted submission, skip-all,
process cancellation, or replacement by a newer batch id. For Ralph
multi-agent grilling, optional per-question metadata renders a compact
"Question planning" summary, role-group headers, provenance chips such as
`UX Agent · provider/model`, consolidation chips for merged questions, and
warning copy for failed, empty, unavailable, or duplicate-only agent coverage
while keeping the same single batch submission. Completed `ask_user` tool calls
render as read-only historical question cards via `AskUserHistoryCard` inside
`ConversationTurnBubble`; the history card displays persisted
`args.questions[]` plus the completed answer/skip/deferred result, including
"Need more context" notes, with a compatibility unwrap for older Codex MCP
captures stored as `args.arguments.questions[]`, and is kept visible outside
whisper collapse. It shares the live form's compact layout: one header row
carrying the "Asked user" title, the status pill and the question count; no
nested card when there is a single question; and option chips on one row behind
an inline `Options` caption, with the full option description surviving as the
chip tooltip. Generic `ToolCallView` still handles `ask_user` as a fallback
and summarizes `args.questions[0].question` when present.

`toolNormalization.ts` → `normalizeToolName()` canonicalises SDK-specific names before display and storage. Notable aliases: `read_file`/`open_file` → `view`, `edit_file`/`str_replace`/`str_replace_editor` → `edit`, `write_file`/`create_file` → `create`, `command_execution` → `shell`, `file_change` → `apply_patch`, `Skill` (Claude Code SDK PascalCase) → `skill`. All downstream logic (`getToolKindInfo`, `getToolSummary`, `filterWhisperChunks` skill counting) operates on the normalised lowercase name.
For Codex `file_change` calls normalized to `apply_patch`, `ToolCallView`
continues to summarize from `args.changes`; when the backend enriches the
parameters with a unified `args.diff`, expanded tool details and hover previews
render that patch text instead of the short result summary.
Collapsed whisper summaries also count file edits from `args.changes` when an
enriched `apply_patch` carries a unified `diff --git` patch that has no legacy
`*** Add/Update/Delete File:` markers; legacy apply-patch marker diffs still
provide line counts when present.
`utils/conversationScan.ts` powers chat References and goal-file detection by
scanning completed file-writing tool calls for pinned document extensions
(`.md`, `.txt`, `.yaml`, `.yml`, `.json`). Tool names and args are run through
`normalizeToolName`/`normalizeToolArgs` first, so provider-specific shapes are
recognised — e.g. Claude Code's PascalCase `Write`/`Edit`/`MultiEdit` (with a
`file_path` arg) map to the canonical create/edit tools, which is what lets a
`.goal.md` written by a Claude session surface the inline Ralph launch panel.
It detects direct create/write/edit paths, `apply_patch` added files, and
conservative shell `mv`/`move` command destinations from command arguments,
including `bash -c`/`bash -lc` wrappers. It does not infer created files from
arbitrary shell output.

## Input Area

Stacked layout with:
1. `RichTextInput` (contenteditable). Paste is always inserted as plain text (via `execCommand('insertText')`, preserving undo); when the clipboard carries a meaningful `text/html` flavor, `shared/pasteHtmlToMarkdown.ts` (a lean chat-specific turndown config: bold/italic/strikethrough, headings, lists, links, inline/fenced code, blockquotes, GFM tables; inline `<img>` dropped, script/style stripped) converts it to markdown source first. Trivial markup (converted markdown equals the plain-text flavor modulo escapes/whitespace), absent HTML, or conversion failure falls back to the `text/plain` flavor. Chained `onPaste` hooks (attachments, >16 KB large-paste chip) still run first and veto via `preventDefault()`.
2. Toolbar reads as ownership zones separated by 1 px vertical dividers (`chat-toolbar-divider-*`):
    - **Initial chat (`NewChatArea` / `InitialChatComposer`)**: the Activity composer uses `settingsLayout="responsive"`: it renders the full toolbar at desktop-width container measurements (`AgentSelectorChip` → divider → primary `ModePillSelector` (Ask/Autopilot) plus a Workflow submenu for enabled workflow modes → divider → model picker → `EffortPillSelector` or `EffortTierSelector` → spacer → ctool buttons (`/`, attach) → divider → send) and switches to compact layout whenever its own measured container is below the `wide` tier (<700px via `useContainerWidth`), so the toolbar compacts before its full chip row would wrap onto a second line. `InitialChatComposer` also supports explicit `settingsLayout="compact"` for lens-sized surfaces. Compact layout replaces the visible provider/mode/workflow/model/effort controls with one AI settings chip labeled `provider · active mode/workflow · effort` (for example `Copilot · Ask · Auto` or `Copilot · Ralph · High`), omits the model from the chip label, and keeps attach, `/`, and send visible. The chip opens an AI settings editor that pairs the provider and effort controls on one row, mode/workflow on the next, and renders the model picker only when effort-tier mode is inactive — in effort-tier mode the selected tier supplies the model, so the standalone model control is hidden (matching the full-toolbar logic); the editor uses an anchored 360px popover with visible overflow so nested selector menus remain unclipped when the measured composer width can fit it, and falls back to scrollable fixed bottom-sheet positioning when the compact composer is too narrow. Commit, PR, and Work Item review-chat empty states reuse `InitialChatComposer` with compact layout, preserving slash commands, `/model`, prompt history, ghost-text autocomplete, file attachments, session-context attachments, and sends bound through `context.commitChat`, `context.pullRequestChat`, or `context.workItemChat`. Ralph is selected from the Workflow submenu; in the Activity tab the active Ralph send control is a split submit where the primary action is **Grill** and **Start from goal...** opens an editable direct-goal review dialog that posts the reviewed text to `/api/ralph-launch` without sending attachments. Review-chat initial composers use the same Ralph grilling send path but omit the direct-goal split action so every send remains bound to the review target. When `forEach.enabled` is true, initial chat exposes `For Each` through the Workflow submenu with the internal value `for-each`; when `mapReduce.enabled` is true, it exposes `Map Reduce` with the internal value `map-reduce`; neither workflow mode is shown in follow-up composers. Submitting For Each or Map Reduce creates a normal persisted Ask-mode generation chat, selects it in the Activity detail pane, and stores `payload.context.forEach.kind='generation'` or `payload.context.mapReduce.kind='generation'` metadata with workspace, generation ID, child mode, original request, status, latest valid structured plan, latest invalid-plan error, and eventual run linkage. The generation chat uses the normal provider/model/reasoning, slash-skill, prompt-history, session-context, and file/image attachment path; follow-ups remain locked to the matching plan-generation system context through persisted process metadata. `ChatDetail` passes `ForEachPlanReviewCard` and `MapReducePlanReviewCard` into `ConversationArea` as post-conversation content so generated-plan review cards stay inside the main `activity-chat-conversation` scroll region above the follow-up composer. `ForEachPlanReviewCard` renders the persisted latest valid item plan when available, falls back to transcript scanning for newer assistant turns, keeps the previous valid plan when a refinement emits invalid JSON or no Advanced JSON, shows that error inline, renders a structured editor plus Advanced JSON fallback, and approves through `client.forEach.create/updatePlan/approve` without calling child start/continue endpoints. `MapReducePlanReviewCard` mirrors that flow with editable `maxParallel` and `reduceInstructions`, validates the complete map/reduce JSON plan, and approves through `client.mapReduce.create/updatePlan/approve` without starting map or reduce work. `ChatListPane` renders these generation chats as normal chat-history rows with sky-blue **For Each** or indigo **Map Reduce** badges and generated-plan previews such as `3 proposed items - draft`, `1 proposed item - approved`, or `4 proposed map items, max 3 parallel - draft`.
    - **Follow-up (`FollowUpInputArea`)**: provider chip → divider → `ModePillSelector` → divider → model picker → `EffortPillSelector` (rendered only when the parent supplies `onEffortChange`) → flexible middle hosting `ComposerMetaStrip` right-aligned → ctool buttons (`/`, attach) → divider → `QueueFollowUpButton`. The flexible middle has `flex-basis: 0` + `min-w-0` + `container-type: inline-size`, so the meta strip can never push the toolbar onto a second row — it grows into free space, shrinks by truncating the cwd path, and because basis-0 makes the middle's width equal the toolbar's free space, container queries hide the strip's unshrinkable pieces instead of letting them overlap neighbours: the cwd group hides below 320px of free space and the whole strip below 160px. The toolbar measures its own width via `useContainerWidth` with a raised `wideThreshold` of 820px and sheds progressively as the pane narrows: below 820px it compacts labels (icon-only model chip, cwd basename, no `Effort:` prefix); below 500px (container-tight) it swaps in the mobile controls — the segmented mode pills become the tap-to-cycle button and slash/attach fold into the "⋯" overflow menu — driven by the container signal, not just the `lg:` viewport gate; below 380px the provider chip and Send button go icon-only (`iconOnly` prop on `AgentSelectorChip` / `QueueFollowUpButton`, accessible names preserved). Only below ~300px does the `lg:flex-wrap` fallback wrap to a second row. Provider isn't switchable on a follow-up (locked to the session), so the provider chip is read-only. At widths below `lg` (≤1023px), the row stays `flex-nowrap`, the segmented mode selector collapses to a tap-to-cycle button, slash/attach collapse into a single overflow menu, `ComposerMetaStrip` is hidden, and visible reachable controls use approximately 32px tap targets; `lg:` classes restore the compact desktop sizes and wrapping behavior. Stopped chats in `cancelled` status keep the composer disabled while the transient `cancelling` state is active, then re-enable only when a saved `sdkSessionId` is present; if no SDK session was saved, the composer remains disabled with a non-retryable inline error rather than showing "Session expired" or a retry/new-chat shortcut.
   - **Focused composer shortcuts**: model/slash menus keep first priority. With the text input focused and no slash/model menu open, `Shift+Up/Down` cycles the visible effort control in both composers (`EffortTierSelector` skips unconfigured tiers; legacy `EffortPillSelector` cycles Auto plus selectable supported efforts). In `NewChatArea` only, provider cycling uses `Ctrl+Up/Down` on Windows/Linux and `Cmd+Up/Down` on macOS, skips disabled/unavailable providers, and persists through the repo-scoped `lastChatProvider` preference. These shortcuts are intentionally not exposed in toolbar labels, tooltips, or ARIA copy.
3. `ComposerMetaStrip`: cwd chip + context-window fuel gauge + provider badge for non-Copilot sessions. The context-window gauge renders a segmented system/tool/conversation breakdown when `useChatSSE` receives all three persisted snapshot values (`sessionSystemTokens`, `sessionToolTokens`, `sessionConversationTokens`) or the same fields from live `token-usage`; otherwise it falls back to the single-colour usage bar. In the follow-up toolbar it sits right-aligned inside the flexible middle between the mode/model zone and the tools zone, so its info reads as status without ever forcing the toolbar to wrap.

**Conversation-warm dot (`WarmIndicatorDot`).** The tiny dot next to the send button reflects this conversation process's backend warm-client state, with the two halves of the UX deliberately split (`features/chat/hooks/`):
- **Display** is stream-only: `useWarmClientStatus({ workspaceId, processId })` opens the warm-only SSE stream (`/processes/:id/stream?warm=1` via `cloneApiBase`), maps `warm_status` frames to `cold | warming | warm | active`, and resets to `cold` on process/workspace change, error, or unmount. The stream's initial snapshot makes an already-warm conversation show the dot immediately. The dot is **never** set from a POST response — the stream is the single source of truth (no client-side TTL/decay).
- **Side effect** is `useTypingPrewarmClient({ input, workspaceId, processId, enabled, debounceMs })`: the first non-empty composer input schedules one debounced `client.processes.prewarm(processId, { workspace })` (routed through `getCocClientForWorkspace`), fires at most once per typing window, re-arms on empty input or a `(workspace, process)` change, and swallows errors. The server prewarms under the process id warm key, so other conversations in the same cwd stay cold. `FollowUpInputArea` gates it with `enabled: !inputDisabled && !sending && !isActiveGeneration` and `debounceMs: getPrewarmDebounceMs()`. Claude and other non-warming providers only ever emit `cold`, so their dot stays an invisible spacer.

Focus indicator propagates mode-colored ring from contenteditable to parent card.

File/image attachments flow through the shared `useFileAttachments` hook before
new-chat, follow-up, note-chat, queue, task-generation, review-chat, For Each,
and Map Reduce send paths serialize them. Browser-supported raster chat images at or above 64 KiB (`png`, `jpg`/`jpeg`,
`webp`) are canvas-downscaled to at most 1600px on the long edge and re-encoded
as JPEG only when that reduces the payload before the wire `AttachmentPayload`/
legacy `images` data URLs reach the server; smaller images, unsupported images,
and failed canvas conversions retain the original attachment bytes.

`InitialChatComposer` persists pending attachments to a per-tab `sessionStorage`
sidecar (`attachmentDraftStore`, key `coc.attachmentDraft.<draftKey>`) keyed by the
same `draftKey` as the `useDraftStore` text draft, so pasted images and files
survive in-SPA navigation (workspace switch, opening another chat, leaving and
returning) instead of being lost on unmount. Only the wire `AttachmentPayload`
subset is stored (no client id/category; both are regenerated/re-derived on load
via `useFileAttachments.restoreAttachments`); saves over ~2 MB serialized are
skipped to avoid quota errors. The sidecar is cleared on successful send and
Ralph direct-goal launch, and reset when switching to a draft key with no saved
attachments. Follow-up composers and `EnqueueDialog` do not use this path.

When `features.sessionContextAttachments` is enabled, same-workspace chat/process
rows, Ralph session group rows, Work Item list/hierarchy rows, Git commit rows,
branch range headers/overview headers, and Pull Request rows are copy-drag
context sources. `NewChatArea`, `FollowUpInputArea`, and the desktop repo header
Queue Task / Ask buttons accept these shared drag/drop payloads. The composers
show a dashed copy-context overlay while supported payloads are dragged over
them and render inline feedback for unsupported drops. They validate
same-workspace, duplicate, self-drop/current-child for session-backed pointers,
and a shared three-logical-attachment cap before adding removable context chips
through `AttachedContextPreviews`. `get_conversation` tool availability is
required only for single-session and Ralph pointers. Single
sessions render as neutral **Session** chips, Ralph groups render as purple
**RALPH** chips, and Work Item/Commit/Range/PR pointers render as sky chips with
stable labels such as `Work Item #123`, `Commit abc1234`, `Range base..head`,
and `PR #45` plus short safe metadata. Git commit row body drags are copy-only
context drags; the existing unpushed-commit reorder path remains isolated to the
row's grab handle so context dragging does not trigger commit reordering.

The header buttons validate the drop, open the queue dialog in task or ask mode,
and seed a removable context chip without submitting. Send paths re-check the same constraints before formatting already-attached
source IDs so stale feature/capability state cannot send unusable pointers. The
attached-context formatter emits pointer-only `<attached_session_context>` blocks
for single sessions, pointer-only `<attached_ralph_session_context>` blocks for
Ralph groups, and generic pointer-only `<attached_pointer_context>` blocks for
Work Item, Git commit, Git range, and Pull Request references. Pointer blocks
store source workspace ID and stable identifiers/references only (for example
work item ID/number, commit hash, base/head refs, PR ID/number) plus safe labels,
titles/statuses, and summary counts when available; they do not store work item
bodies, diffs, PR descriptions, file contents, or latest-turn previews. The Ralph
block stores source workspace ID, Ralph session ID, phase/status, safe
title/display label, latest activity, process/iteration counts, and ordered child
process IDs only. Single-session drag payloads derive their title from custom
title/title/displayName, prompt preview or prompt metadata, then process ID; they
do not use latest-turn previews such as `lastMessagePreview`.
`ConversationTurnBubble` parses persisted attached-context blocks on user turns
and renders them as collapsed cards: neutral "Attached session context" cards
for single sessions, purple "Attached Ralph context" cards for Ralph groups, and
sky pointer cards for Work Item/Commit/Range/PR pointers. These cards show their
pointer metadata and a raw-block copy affordance while raw mode still exposes the
exact persisted message content.

New chats use `AgentSelectorChip` to choose a per-chat provider. When `features.autoAgentProviderRouting` is enabled, `Auto` appears beside Copilot, Codex, and Claude as a composer-facing option; selecting it persists `lastChatProvider: "auto"` for the workspace, omits an explicit provider override, and sends only `context.autoProviderRouting.requested` so the server resolves a concrete provider at scheduling time. When the flag is disabled, persisted `auto` selections are ignored and the composer falls back to a selectable concrete provider. Concrete provider selections still send `payload.provider`. Follow-up inputs show the concrete provider stored on the process metadata so existing chats continue using their original provider and never offer Auto switching.

`repos/modeConfig.ts` owns the central `WORKFLOW_REGISTRY` for chat/workflow mode labels, icons, tooltips, pill dots, accent colors, categories, surfaces, and feature flags. `ModePillSelector` derives Ask and Autopilot defaults from that registry, while New Chat and follow-up composers derive visible mode options through the registry-backed visibility helper. Ralph is appended only where the existing Ralph feature flag and eligibility rules allow it. For Each is appended only in New Chat when `forEach.enabled` is true, or in follow-up composers when explicitly allowed and feature-enabled. Map Reduce is appended only in New Chat when `mapReduce.enabled` is true. In New Chat, `ModePillSelector` renders Ask, Autopilot, and an optional Workflow dropdown as one segmented pill; the Workflow segment shows the generic `Workflow` label until a workflow mode is selected, then displays the selected workflow option's registry label (e.g. `Ralph`, `For Each`, `Map Reduce`). The Workflow segment remains visibly active when a workflow mode is selected, mirrors the selected workflow dot, and the composer card keeps the selected workflow mode's registry accent. Prompt schedules expose Ask and Autopilot only. Legacy loaded draft/task/schedule records with `mode='plan'` are normalized to Ask for display and follow-up behavior, and the dashboard does not render a separate Plan pill, badge, tooltip, icon, or custom-instruction tab. Mode accents are Ask yellow, Autopilot green, Ralph purple, For Each sky blue, and Map Reduce indigo.

`features/chat/ForEachRunPane.tsx` renders the dedicated For Each detail pane for `#repos/<workspaceId>/(activity|chats|tasks)/for-each/<runId>` links, approved generation chats, and For Each group-row selection when `forEach.enabled` is true. It reads the parent run through `coc-client`'s `forEach` domain, shows the full original request, parent status, child mode, shared instructions, item status chips, generated prompt previews, a link back to the persisted generation chat when `generationProcessId` is present, and child process links, and exposes explicit Start/Continue, Retry failed item, Skip pending/failed item, Cancel remaining, and Refresh actions. It does not render Ralph journals, recurring loop controls, DAG workflow nodes, or sibling item result context. Generation chats pass approval navigation through `ChatDetailPane`/`RepoChatTab`, which clears the selected chat and opens the run-pane hash after the reviewed plan is approved; For Each group rows use the same parent routing, For Each hashes restore the parent pane on desktop and mobile, and selecting a generation or child chat clears the parent pane and opens the chat detail.

`features/chat/MapReduceRunPane.tsx` renders the dedicated Map Reduce detail pane for `#repos/<workspaceId>/(activity|chats|tasks)/map-reduce/<runId>` links, approved generation chats, and Map Reduce group-row selection when `mapReduce.enabled` is true. It reads the parent run through `coc-client`'s `mapReduce` domain, shows the full original request, parent status, max parallelism, child mode, shared instructions, map item table, reduce-step status/instructions, a link back to the persisted generation chat when `generationProcessId` is present, map child process links, and an `Open final result` link to the completed reduce child process. It exposes explicit Start/Continue, Retry failed map item, Skip pending/failed map item, Retry reduce, Cancel remaining, and Refresh actions. Generation chats pass approval navigation through `ChatDetailPane`/`RepoChatTab`, which clears the selected chat and opens the run-pane hash after the reviewed plan is approved; Map Reduce group rows use the same parent routing, Map Reduce hashes restore the parent pane on desktop and mobile, and selecting a generation/map/reduce child chat clears the parent pane and opens the chat detail.

Modal job-submission dialogs use `shared/ModalJobAiControls.tsx` when they need New Chat-compatible provider/model/reasoning controls. Its `useModalJobAiSelection()` hook centralizes workspace-scoped `lastChatProvider` restore/persist, provider-scoped model catalogs, effort-tier mode, legacy model picker + `EffortPillSelector` fallback, optional initial AI selections for Resume-style flows, a dirty bit, and resolved payload values for queue/chat submissions. Concrete selections resolve to `{ provider, model?, reasoningEffort? }`; Auto resolves to `{ effortTier, autoProviderRouting: true }` with no provider/model override, and submitters translate that flag to `context.autoProviderRouting.requested` or route-level `autoProviderRouting: true` so scheduling routes can pick a concrete provider first and then expand that tier through the selected provider's configuration. `queue/EnqueueDialog.tsx` uses these compact controls in its Advanced area for Ask AI, ad hoc autopilot tasks, skill/context-file runs, bulk context-file submissions, and floating-chat launches. `tasks/GenerateTaskDialog.tsx` uses these compact controls in its configuration area and forwards the resolved values to `/api/workspaces/:id/queue/generate`; `shared/UpdateDocumentDialog.tsx` uses them in the existing configuration area and enqueues custom chat tasks; `features/work-items/WorkItemExecuteDialog.tsx` renders the same controls through `RunSkillPanel` and forwards them to `/api/workspaces/:id/work-items/:wid/execute`; `features/chat/SkillContextDialog.tsx` uses them for git commit, multi-commit, and branch-range skill runs. `queue/SkillPicker.tsx` splits its search box + repo/global grouped, keyboard-navigable list into an exported `SkillPickerPanel`; `SkillPicker` wraps it in the multi-select trigger/chips popover, and `queue/SkillBrowserDialog.tsx` wraps it in a centered single-select-then-close modal. The Git tab's commit context menu lists the top `MRU_SKILL_LIMIT` skills (ranked by `rankSkillsByRecency` over the `commitSkillUsageMap` preference) inline under **Use Skill**; when more exist, a `Browse all skills… (N more)` entry opens `SkillBrowserDialog` instead of a third-tier hover submenu. `useGitSkillActions` snapshots the context-menu target into `skillBrowserContext` when the modal opens and replays it through `startSkillRun(name, target)` on pick, so the confirm dialog and MRU recording work the same as the inline entries. `queue/SkillPicker.tsx` splits its search box + repo/global grouped, keyboard-navigable list into an exported `SkillPickerPanel`; `SkillPicker` wraps it in the multi-select trigger/chips popover, and `queue/SkillBrowserDialog.tsx` wraps it in a centered single-select-then-close modal. The Git tab's commit context menu lists the top `MRU_SKILL_LIMIT` skills (ranked by `rankSkillsByRecency` over the `commitSkillUsageMap` preference) inline under **Use Skill**; when more exist, a `Browse all skills… (N more)` entry opens `SkillBrowserDialog` instead of a third-tier hover submenu. `useGitSkillActions` snapshots the context-menu target into `skillBrowserContext` when the modal opens and replays it through `startSkillRun(name, target)` on pick, so the confirm dialog and MRU recording work the same as the inline entries.

Ralph start surfaces use `shared/RalphExecutionRepoSelector.tsx`. Launch callers
pass a transient source reference with the physical `workspaceId`, the
clone-qualified `selectionId` from `getRepoSelectionId(repo)` when available,
and a `baseUrl` fallback for clone-routed pop-out windows. The selector builds
targets keyed by `(serverId, workspaceId)` (`local` is the dashboard server),
resolves remote selection IDs by exact server and workspace, and uses a unique
normalized base URL only as a compatibility fallback. It never treats a missing
clone-registry entry as evidence that the source is local. An unresolved,
ambiguous, connecting, or cached-offline source remains unselected and shows its
focused availability warning; unrelated remote aggregation warnings remain
visible without disabling healthy targets. Repo refreshes and reconnects restore
the source target until the user explicitly selects another repository, after
which that manual choice remains owned by the open dialog. Source-less callers
retain the first-available default.

`features/chat/RalphStartPanel.tsx` drives `ModalJobAiControls` from the selected
execution workspace and reuses `/api/processes/:id/ralph-start` only when the
resolved source and selection have the same exact target key.
`shared/RalphLaunchDialog.tsx` uses the same target identity for direct
goal-file launches from Notes and New Chat and can accept a caller-owned
resolved AI selection. Every cross-workspace or cross-server launch posts to
the selected target server's `/api/ralph-launch`, and source paths are forwarded
only for an exact source-target match. `features/chat/RalphWorkflowPane.tsx`
uses `ModalJobAiControls` in both the stuck-session Resume confirmation and the
completed-session Continue-loop confirmation, each initialized from transient
session `resumeDefaults` when recoverable and disabled while that action is
submitting.

`EffortPillSelector` drives the per-turn `reasoningEffort` override (Low/Medium/High; `null` = no override, falls back to the persisted per-model effort then the SDK default). The chip is structurally a dropdown menu (`AgentSelectorChip` style): trigger button (bars icon + label + chevron) opens a popover listbox with `Auto`/`Low`/`Medium`/`High` entries. The `Auto` entry explicitly clears the override and is also what the currently-selected level toggles to when re-clicked. New chats persist the selection alongside the draft (`useDraftStore` → `Draft.effortOverride`). Follow-ups thread the choice through `useSendMessage → ProcessMessageRequest.reasoningEffort → POST /api/processes/:id/message` and into either `bridge.enqueue` (queued) or `bridge.executeFollowUp` (direct/buffered). The server mirrors the value into `task.config.reasoningEffort` via `queue-shared.validateAndParseTask`, so executors see it from a single canonical location.

`ChatStyleSelector` renders a `Style: <label>` chip after Effort in both composers (inline toolbar and compact settings editor agree on Effort-then-Style) when `features.chatStyleSelector` is on. Options and labels come from `CHAT_STYLES` / `CHAT_STYLE_LABELS` in `@plusplusoneplusplus/coc-client` — `Default` first, then Human, Direct, Analytical, Structured — so only the one-line descriptions live in the component; do not re-list the wire values. `Default` is what a new chat starts on and its description says plainly that no style instruction is added; the chip still reads `Style: Default` rather than hiding itself. It mirrors `EffortTierSelector`'s popover, focus, outside-click, dark-mode, and compact-trigger conventions, but every style is always selectable — there is no per-provider configuration. `useChatStyleSelectorEnabled(baseUrl)` resolves the flag against the server that owns the target: with no `baseUrl` it reads the live dashboard config and subscribes to `DASHBOARD_CONFIG_UPDATED_EVENT`; with one — the clone's raw server root as returned by `useResolveCloneBaseUrl` / `sourceRemoteInfo`, the same shape sibling hooks like `useAgentProviders` take — it appends the configured api base path itself (mirroring `cloneApiBase`; remote servers are never container-mode) and fetches `${root}${apiBasePath}/config/runtime` (cached per root), treating an unreachable or older server as unsupported. `NewChatArea` shows the chip for Ask/Autopilot only and always starts on `DEFAULT_CHAT_STYLE` — there is deliberately no preference seed and no `preferences.patchRepo` write, so a workspace never carries a style into a new chat. `ChatDetail` derives the follow-up style rather than syncing it into state: a `chatStyleOverride` (null until the user picks, reset on task change) takes precedence over `processDetails.metadata.chatStyle` (the style the last turn recorded; missing or invalid reads as `'default'`), so a late or partial process record — e.g. the synthetic queued snapshot — still lands the right style while a user pick is never clobbered, and conversations stay independent; `useSendMessage.buildMessageRequest()` includes `chatStyle` only when the flag is on, so a flag-off client omits the field entirely. `ConversationMetadataPopover` shows the `Style` row unconditionally, `Default` included, because Default is a real state. The style is prepended to the user message server-side and is visible verbatim in the user bubble — the SPA does no stripping or special rendering. There is no keyboard shortcut for Style.

Effort-tier mode is enabled by default through `effortLevels.enabled` and can be turned off live from Admin when users need the legacy separate model picker and reasoning-effort controls. `EffortTierSelector` lists `Very Low`, `Low`, `Medium`, and `High` in that order. For concrete providers, tooltips expose the concrete model and reasoning effort mapped to the selected tier and each configured menu option; empty reasoning effort displays as `Auto`, and unconfigured options remain disabled with an Admin configuration tooltip. For the Auto provider selection, all tier keys remain selectable and tooltips explain that the provider and model are resolved at scheduling time.

The Admin AI Provider page's Provider routing subtab exposes the single `features.autoAgentProviderRouting` toggle. When enabled, Auto becomes the default for omitted-provider chats, tasks, and API-created work; explicit provider selections and follow-ups keep their provider. The same subtab lets admins reorder provider rules, toggle each rule, edit normal minimum remaining quota percentages, toggle and edit weekly guard thresholds, choose a fallback provider, and preview the concrete provider selected by the shared Auto router using the current availability state plus cached quota response. The Default Provider buttons only select concrete providers (`copilot`, `codex`, `claude`) for the non-Auto fallback path. The Refresh quota button force-refreshes the provider quota cache and updates the preview. When Auto is disabled, the rule editor is hidden behind an Auto-disabled message.

The Admin AI Provider page's `ProviderEffortTiersSection` uses the same tier order (`Very Low`, `Low`, `Medium`, `High`) when editing provider defaults. Rows sourced from hardcoded provider defaults are prefilled and marked with a `Default` badge; saving persists only rows explicitly changed from those defaults, and clearing an override reverts that row to its provider default.

Framework-free quota math lives in `@plusplusoneplusplus/coc-client`'s
`quota.ts`: it clamps remaining and used display percentages, splits finite and
unlimited pools, and selects the tightest finite quota across one provider or
across enabled providers. `shared/quotaUtils.ts`
re-exports that public math while keeping dashboard-only quota-window labels and
risk classes. Known provider windows label `five_hour` as `5h` and
`seven_day` as `Weekly`; unknown ids are converted to readable text. The Admin
provider routing table uses those helpers for quota cells: Codex and Claude
finite `quotaTypes[]` snapshots render as compact per-window rows with a
readable quota-window label, remaining percentage, used/entitlement caption,
and remaining-usage bar. Copilot finite quotas render as the single
tightest-limit row used by the legacy quota cell. The page-level quota-risk
summary uses the tightest finite quota across all providers. When the non-container
Admin AI Provider tab is active, `AdminPanel` loads
`admin.getAgentProvidersQuota()` without `force` so the page displays the
server's cached quota snapshot after refresh or tab entry; the page's Refresh
quota button still calls the force path. The desktop
top-bar `AgentProviderQuotaIndicator` uses the same helpers to fill a circular
gauge to the most-constrained enabled provider's used percentage and to render a
NotificationBell-style dropdown. The dropdown lists one row per enabled
provider; each row's gauge and risk badge are driven by that provider's tightest
finite quota window, while the body lists every finite quota window (e.g. both
`5h` and `Weekly`) with its used/entitlement caption and a minute-level UTC reset
timestamp (`YYYY-MM-DD HH:MM`) plus a remaining-time countdown (`Xd Yh left` for
multi-day windows, `Xh Ym left` otherwise, or `due` once elapsed). It also
shows an unlimited badge for all-unlimited providers, provider-level errors, a
last-updated line,
a force-refresh button that calls `admin.getAgentProvidersQuota({ force: true })`,
and an `#admin/agents` link to the AI Provider page.

The model-picker chip in both `NewChatArea` and `FollowUpInputArea` mirrors the `AgentSelectorChip` style: icon + label + chevron, no inline `✕` clear. When a `modelOverride` is set, `ModelCommandMenu` renders a `Use default` entry at the top of the dropdown that calls `setModelOverride(null)`; clearing flows through the menu rather than a chip-side button. `NoteChatPanel` reuses the same menu without passing `onClearOverride`, so the clear row only appears in the chat composers.
