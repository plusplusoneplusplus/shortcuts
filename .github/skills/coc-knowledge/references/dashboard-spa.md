# Dashboard SPA

React-based single-page application served by `coc serve`. Located at `packages/coc/src/server/spa/client/`.

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

## Entry Point & Shell

- `entry.tsx` — Mounts `App` (main shell) or `PopOut` (floating chat window)
- `html-template.ts` — Server-side HTML generation with inline bundled assets from `client/dist/`

## Module Layout

```
spa/client/react/
├── App.tsx              # Root React component
├── admin/              # Admin panel & preferences UI
├── chat/               # Reusable conversation rendering
├── components/         # Shared UI components (ContextWindowIndicator)
├── contexts/           # React contexts (App, Queue, Task, Toast, FloatingChats)
├── hooks/              # 30+ custom hooks
├── layout/             # Layout (Router, TopBar, BottomNav, ThemeProvider)
├── features/
│   ├── canvas/         # Canvas side panel: CanvasPanel + ExtensionCanvasView (sandboxed iframe) for AI co-edited documents, code, and custom extension canvases
│   ├── chat/           # Chat UI: ChatDetail, ChatListPane, ConversationArea
│   ├── dreams/         # Workspace Dreams review panel with feature/opt-in states, queue-backed run-now task summary, provider-attributed Activity/Admin AI Provider visibility, filters, plain-language card guidance, source evidence links, and card lifecycle actions
│   ├── memory/         # Memory V2 route, facts/review/episodes tabs, repo memory settings section
│   ├── native-copilot-sessions/  # Read-only CLI Sessions tab over native Copilot/Codex/Claude stores (see CLI Sessions Tab)
│   ├── notes/          # Notes UI: NoteEditor, Mermaid zoom/pan, sidebar, multi-root dropdown with modifier/range root selection and bulk root removal (useNotesRoots)
│   ├── pull-requests/  # PR dashboard: attention groups, provider-derived PR helpers, shared provider-id/displayName Team author matching, Team auto-classification triggers, real diff-stat queue badges/risk, deterministic review summary, BatchCommandPanel
│   └── terminal/       # Terminal UI: TerminalView, pin/unpin
├── processes/          # Process detail, DAG visualization
├── queue/              # Queue management (EnqueueDialog, QueueView)
├── repos/              # Repository views, clone/add dialogs, file explorer, Monaco editor
├── shared/             # Feature-level shared (MarkdownView, RichTextInput, SourceEditor, markdown-document session helpers)
├── tasks/              # Task/plan management, inline comments
├── ui/                 # UI primitives (Button, Card, Dialog, Spinner, Badge, Toast)
├── welcome/            # Onboarding (WelcomeTour, FirstStepsCard, FeatureTip)
├── wiki/               # Wiki UI (WikiView, WikiAsk, WikiGraph)
├── types/              # TypeScript type definitions
├── utils/              # Utility modules
└── featureFlags.ts     # Compile-time feature flags
```

When `features.commitChatLens` is enabled from Admin -> Configure -> Features, review chat uses `useReviewChatPresentation()` / `useCommitChatPresentation()` to render unpinned supported chat targets such as commit detail, commit-backed file diff, commit review popouts, PR detail Ask AI, PR review popouts, and Work Item detail Ask AI as bottom-right lenses. Commit and PR mobile/tablet layouts use their existing side-panel or drawer fallback, while Work Item chat keeps the lens presentation on non-desktop viewports. Pinned desktop chat targets render with the shared side-panel frame and an Unpin action; Work Item detail places the pinned chat in a right-side resizable column beside the detail content and persists that column width with a workspace- and Work Item-scoped `coc.workItemChatPanel.width.*` key. Lens open, pin, and minimized states are client-local localStorage scoped by workspace plus review target (`commit` hash, PR repo/id/head discriminator, or Work Item ID). Active Commit, PR, and Work Item lens chats pass a **New chat with same context** action into the current chat header's metadata/overflow menu; the action archives and clears the workspace-scoped target binding through the domain client, leaves the previous process recoverable in history, and returns the panel to the compact empty composer for the same workspace and target label. Minimized state only affects lens presentation and restores from a compact bottom-right pill while keeping the hidden chat tree mounted so drafts and attachments stay intact. `features.commitChatLensDormantMode` (`'ghost'` | `'pill'`, default `'ghost'`) controls the automatic dormant behavior: when the cursor leaves the lens, after a 600ms delay the lens either ghost-fades (near-transparent with scale-down, click-through) or collapses to a compact status pill; re-entering the lens or pill restores focus immediately. Focus detection uses a `useLensDormantState` hook backed by document-level `mousemove` hit-testing against the card or pill bounding rect (not element-level mouseenter/leave, which is unreliable when child elements toggle `pointerEvents` or when the hit-target shape changes between card and pill). Focus detection uses a `useLensDormantState` hook backed by document-level `mousemove` hit-testing against the card or pill bounding rect (not element-level mouseenter/leave, which is unreliable when child elements toggle `pointerEvents` or when the hit-target shape changes between card and pill). Focus detection uses a `useLensDormantState` hook backed by document-level `mousemove` hit-testing against the card or pill bounding rect (not element-level mouseenter/leave, which is unreliable when child elements toggle `pointerEvents` or when the hit-target shape changes between card and pill). Open lens frames share a visible top-left resize grip that changes width and height while keeping the bottom-right corner anchored; this size is persisted to `localStorage` under `coc.commitChatLens.size` (global, not per-target) and restored on subsequent mounts, clamped to valid viewport bounds. The flag is enabled by default (bootstrap-conservative `absentFallback` keeps legacy partial configs reading it off), so commit review falls back to the legacy `coc.commitChat.open` visibility key and `coc.commitChatPanel.width` resizing behavior only when the admin flag is turned off.

The Notes view inherits the same `features.commitChatLens` source of truth for its AI chat surface. `NotesView` uses `useReviewChatPresentation()` with a workspace-scoped `notes` target, preserving the legacy workspace-scoped notes chat open key while Lens is disabled and using the shared target-scoped Lens open/pin/minimize keys when Lens is enabled. The notes area shows no separate Lens indicator; no notes-specific Lens setting is stored or exposed. Note-producing SPA flows that originate from notes/chat UI (notes chat edits, AI note creation, and bulk chat summaries) attach `context.lensChat = { inherited: true, source: 'features.commitChatLens' }` only while the shared Lens flag is enabled, so the process metadata records inherited Lens routing without adding persistent notes-specific state.

Notes Chat renders exactly one compact 48px header (`NotesChatHeader.tsx`, next to `NoteChatPanel.tsx`) across the Lens, pinned side-panel, and embedded (mobile / Lens-disabled) presentations and across both the empty and active-conversation states — there is no density setting or alternate full header. The header shows a Notes Chat identity mark, a muted context label (current note title in per-note scope, workspace display name via `resolveWorkspaceName` in per-workspace scope, truncated with the full value on hover), the `NotesChatScopeToggle` segmented control (This note / Workspace), and a window-action group whose contents depend on `NoteChatPanel`'s `presentation` prop (`'lens' | 'side-panel' | 'embedded'`, computed in `NotesView` from `useReviewChatPresentation()`'s state): minimize + pin in `'lens'`, unpin in `'side-panel'`, neither in `'embedded'`; close is always present. "New chat" (resets the active scope's chat, keeping it recoverable in history) lives in the header's `ChatHeaderOverflowMenu` instead of a dedicated button, and only renders when a chat exists. To avoid duplicated chrome, `ReviewChatPlacementFrame` accepts an opt-in `hideHeader` prop (Notes passes it; commits/PRs/Work Items omit it and keep the shared generic Lens/side-panel header unchanged) and `ChatDetail` accepts an opt-in `hideHeader` prop (Notes passes it to suppress the nested `ChatHeader`; other `ChatDetail` consumers are unaffected). The ask/autopilot mode toggle (`NoteModeToggle`) is intentionally kept out of the header and renders inline with the empty-state composer next to the input, matching where `ChatDetail`'s own `compactModeSelector` places it once a chat is active.

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
open the shared pause-duration menu (`Until resumed`, 1/2/3/4/8 hours) and send
the selected `durationHours` only for timed pause markers; queued timed markers
render a static `Queue pauses here · Nh` label until the executor reaches and
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

Workspace inner-tab navigation is also client-local and workspace-scoped.
`AppContext` persists `repoTabState` under `coc-repo-tab-state` and the full
inner route suffix under `coc-repo-route-state`, dropping unknown sub-tab ids on
hydrate. `Router` records the suffix for every `#repos/<workspaceId>/<subroute>`
hash and expands bare `#repos/<workspaceId>` hashes to the remembered route,
then the remembered tab, then `/chats`. Workspace switchers use
`useWorkspaceNavigation()` so TopBar, repo grid, process-sidebar links, and
clone completion all write full hashes. `RepoDetail` treats `chats`/`activity`
and `cli-sessions`/`copilot-sessions` as logical aliases, waits for git
capability loading to finish, and falls back to the chat surface only when the
active sub-tab is absent from the resolved `visibleSubTabs`; that display
fallback does not erase the stored deep route suffix.

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

`features/chat/conversation/ChatComposerPrChips.tsx` docks a stack of compact,
read-only PR chips **inside the composer** (above the textarea, via the
`prComposerChips` slot that `FollowUpInputArea` renders as the first child of the
input card) for chats that created pull requests — there is no top-of-thread PR
card. The
`usePrChatStatusItems` hook unions PRs detected in the loaded turns
(`pullRequestDetection.ts`, no new regex) with persisted bindings looked up by
`task_id`. Detection requires PR-creation evidence from the GitHub connector's
create-pull-request tool, or per shell tool call: a `gh pr create` /
`az repos pr create` command — including when the harness serializes it inside a
shell-interpreter wrapper (`bash -lc '…'`, `/bin/bash -c "…"`, `sh -c '…'`), whose
quoted payload is unwrapped and scanned so the wrapped command still matches — a
result carrying the
`submit_commits_as_pr.py` wrapper's structured success line (a line-start
`JSON: {... "pr_url": "...", "status": "done"}` — recognized even when surfaced
by a later `grep`/`tail` of the wrapper's persisted stdout, since the original
command output is often truncated under a large git dump), a known wrapper
command whose untruncated result echoes a creating command, or output with no
command metadata; read-only PR commands and connector lookups are ignored. The
hook looks up bindings by `task_id`
(`listChatBindingsForOrigin(originId, { taskId })`), resolves each
PR's canonical origin through `resolveCanonicalOriginId`, upserts a binding
(`createChatBindingForOrigin`) for any freshly-detected PR so it survives reload
with the creating turn collapsed, and fetches PR detail per row
(`getForOrigin`) into per-row loading/ready/error state with retry. The union
and origin logic live in the pure `conversation/prChatAssociation.ts` module.
Each chip (`ComposerPrChip`, presentational) shows a git glyph, a pin marker, the
`#number` (opening the provider PR URL from detail/detection, falling back to
`PullRequestDetail` via `buildPrDetailHash` only when no provider URL exists), the
title, the lifecycle status badge (`prStatusBadge` — Open / Draft / Merged /
Closed), a reviewer-count badge (`approved/total reviewers`, via
`summarizeReviewerApprovals` on eager-loaded origin reviewers; names stay out of
the chip and a lightweight popover separates approved, waiting, and
change-requested/blocking reviewers), a CI-checks count badge (`✓ passing/total`
like `10/30`, via `summarizeCheckRows` on the eager-loaded `item.checks`; tinted
red/amber/blue/green by worst-active status, omitted until the checks fetch
resolves with ≥1 check), the `+adds / −dels` diff (from
`mapPrDetailToCardPr`'s `diffStats`, parsed by `parseDiffStats`; omitted when the
detail carries no counts), a filled **View** provider link, and a ✕ dismiss. A loading row renders a skeleton; an error
row shows the message plus Retry and View. `ChatComposerPrChips` orders chips
newest-first, hides any the user ✕-dismisses for the session (a fresh detection
or binding re-surfaces it on reload), and renders nothing when no PR is
associated, so the composer keeps no PR chrome otherwise. The stack's first row
sits flush with the composer card via `rounded-t-lg overflow-hidden`, and each
chip's bottom border doubles as the divider above the textarea.

When the `triggers.enabled` flag is on, each chip also carries CI auto-fix
controls (`usePrAutoFixTrigger`, gated on `isTriggersEnabled()` read in
`ChatComposerPrChips`, which threads the conversation `processId` + `workspaceId`
down as an `autoFix` context prop). The checks-badge popover
(`ComposerPrChecksPopover`) opens when ≥1 check is failing **or** when CI
auto-fix is available, so the monitor can be armed proactively while checks are
still pending/green (with no failures the badge would otherwise be a plain,
non-interactive pill). It gains an "Auto-fix CI" toggle that arms/disarms a
`ci-failure` condition-monitor trigger bound to that PR's `originId`/`prId` and
the conversation `processId`. The toggle stays usable regardless of current
check state; a separate `fixNowDisabledReason` disables only the manual "Fix
now" button when nothing is failing. "Fix now" sends one `autopilot` fix message
(`prAutoFixPrompt.ts#buildCiFixPrompt`, a browser copy of the server
`ci-failure-prompt.ts` template) via `processes.sendMessage`. While a monitor is
armed the chip shows an "Auto-fix on" badge — and because the toggle is
failure-independent, that monitor can also be disarmed after CI goes green. All arm/disarm/list/fix calls route
through the workspace-scoped `getCocClientForWorkspace(workspaceId).triggers` /
`.processes` (so remote-clone conversations act on their owning server — never a
raw `fetchApi`). When the PR/conversation context is unresolved the controls
render disabled with an explanatory tooltip; when the flag is off the toggle,
button, and badge are hidden and no trigger network calls are made.

`mapPrDetailToCardPr` carries the canonical `autoMerge`
(`{ enabled, state, enabledBy?, mergeMethod?, blockedReason? }`, mapped
server-side from GitHub REST `pulls.get` / ADO `autoCompleteSetBy`) and
`diffStats` onto the card PR. The legacy presentational card components
(`PrStatusCard` / `ChatPrStatusCard`) and their pure helpers — `describeAutoMerge`
/ `autoMergeLabel` / `prProviderFromUrl`, `summarizeLifecycleStatus` /
`summarizeMergeStatus` in `prMergeStatusSummary.ts`, the
`features/pull-requests/PrChecksSummary.tsx` chips, and freshness in
`prStatusFreshness.ts` — remain exported and unit-tested but are no longer
mounted. `usePrChatStatusItems` still eager-loads each ready row's CI checks
(`getChecksForOrigin` once detail resolves to `ready`, deduped via
`checksStatusRef`, mapped by `buildCheckRowsFromChecks`) and reviewers
(`getReviewersForOrigin` once detail resolves to `ready`, deduped via
`reviewersStatusRef`) and exposes
`expandChecks`, `refresh(key?)` (force-refreshes one row by `key`, or every row
when called with no key — the composer chips pass their own key for a per-row
refresh; the card's single control refreshes all — always running silently with
`{ force: true }` so rows don't flash a skeleton), `refreshingKeys` (the set of
row keys with a manual refresh in flight, so only the refreshed rows' controls
spin; the smart poll refreshes silently and adds nothing to it), `lastUpdatedAt`,
and `isPolling`. Freshness lives in the pure
`conversation/prStatusFreshness.ts`: `shouldPollPrStatusItems` returns true only
while some PR is non-terminal AND has checks pending/running, auto-merge
armed/queued, or unresolved reviewer approval (false once all merged/closed;
because checks/reviewers are eager-loaded, a never-expanded row with pending
checks or waiting reviewers still keeps the poll active); an internal
`setInterval(PR_STATUS_POLL_INTERVAL_MS = 45s)` is armed only while `isPolling`
is true and torn down once everything settles. Force-refresh threads through
`getForOrigin`/`getReviewersForOrigin`/`getChecksForOrigin` `{ force }` to the
`?force=true` query, which the reviewers and checks routes honour by evicting
their subresource caches (the detail route already evicts sub-caches).

`features/canvas/CanvasPanel.tsx` renders the chat canvas side panel, gated by
the `canvas.enabled` runtime flag (`isCanvasEnabled()` in `utils/config.ts`,
default off). When enabled, `ChatDetail` discovers canvases linked to the open
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
marks those comments `sent`. Code canvases (`type: 'code'`) show a language
chip, render the preview as a fenced highlighted block, and use
`MonacoFileEditor` (shared with the repo explorer) in Edit mode with the same
debounced autosave; selection actions stay available in preview mode. The
header Export menu offers Copy content, Download file (extension derived from
the language), and — for markdown canvases — Save to Notes, which writes the
content to `canvases/<slug>.md` in the workspace Notes tree via
`notes.saveContent`. Extension canvases (`type: 'extension'`) render
`ExtensionCanvasView` in preview mode: the extension's `ui.html` runs inside an
`<iframe sandbox="allow-scripts">` whose injected `window.CanvasHost` bridge
(`onState`/`invoke`/`setState`) talks to the host over `postMessage`. The host
posts `canvas-state` on ready and on every live update, services
`invoke-capability` through `canvases.invokeCapability` and `set-state` through
the revision-checked `canvases.save`, so human UI actions and AI capability
calls share one gate. The extension load, `invoke-capability`, and `set-state`
calls all route through the workspace-scoped `useCocClient(workspaceId)` client
(like `CanvasPanel`), so a remote workspace's extension is read from and written
to its owning server rather than the local page origin. Edit mode shows the raw
JSON shared state. Inline `canvas://<canvasId>` references are rendered by
`shared/CanvasEmbed.tsx`, which fetches the descriptor through the same
workspace-routed client and chooses the renderer from its persisted `type`:
Excalidraw keeps the view-only preview, extension canvases mount
`ExtensionCanvasView`, and markdown/code canvases use a document preview. Legacy
`.md-excalidraw-embed` placeholders remain supported for historical message HTML.

`features/chat/source-canvas/` renders the docked, read-only source-file canvas
for local file references clicked inside assistant chat responses. The global
file-path delegation normalizes bare `.file-path-link` spans, shared renderer
`.md-link` spans, and local Markdown `<a href>` anchors from chat's markdown
renderer into one file-reference path; when `SHOW_SOURCE_CANVAS_FOR_CHAT_LINKS`
is enabled, assistant-response clicks dispatch `coc-open-source-canvas` with the
bare path, workspace hint, optional `sourceFilePath`, and optional line/range
metadata. Local `file://` hrefs are converted to filesystem paths and
GitHub-style `#L<line>` / `#L<start>-L<end>` hashes are carried as line metadata,
so the resolver never treats a file URI as workspace-relative text. The
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
before calling the workspace file preview API. `useSourceCanvasContent` folds the
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
The source canvas header shows project-relative paths for files inside the
current workspace root while retaining the full absolute path in the hover
tooltip; files outside the workspace root continue to display their absolute
path. The source-canvas folder explorer uses the same resolver but converts the
resolved absolute folder to a workspace-relative tree path before calling
`explorer.tree`; the workspace root is sent as `.` while outside-root paths stay
absolute so the server-side repo guard can reject them clearly.

## Key Contexts

| Context | Purpose |
|---------|---------|
| `AppContext` | Global app state, workspace selection |
| `QueueContext` | Queue state, enqueue/cancel actions |
| `TaskContext` | Active task tracking |
| `ToastContext` | Toast notification queue |
| `FloatingChatsContext` | Floating chat window management |

`App.tsx` reports `AppContext.selectedRepoId` to the server through
`client.workspaces.reportActiveWorkspace({ clientId, workspaceId })` on mount,
workspace changes, and a 60-second heartbeat while a workspace is selected. The
client ID is session-scoped in `sessionStorage` so multiple dashboard tabs can
report independent active workspaces without collapsing multi-repo state. The
server uses these recent active-workspace reports to refresh the active
workspace's Pull Requests and Work Items caches immediately on active-workspace
changes and then on a 5-minute interval while dashboard activity remains
present.

## Key Hooks

| Hook | Purpose |
|------|---------|
| `useApi` | HTTP client wrapper |
| `useWebSocket` | WebSocket connection management |
| `useMarkdownPreview` | Shared markdown rendering pipeline |
| `useMarkdownDocumentSession` | Shared markdown document loading, dirty state, save/flush, refresh, conflict, beforeunload, and keyboard-save kernel used by Notes and MarkdownReviewEditor through injected I/O adapters |
| `useDiffComments` | Inline diff comment state |
| `useUnseenChat` | Read/unread tracking |

## Chat load performance (per-conversation request budget)

Opening a chat used to fan out ~11 separate requests
(`pull-request-chat-bindings`, `models`, `reasoning-efforts`, `effort-tiers`,
`loops`, `llm-tools-config`, `canvases`, the sidebar `all`, the process detail
`queue_<id>`, `stream?warm=1`, and the unseen `count`). Most were redundant —
static provider/workspace config is identical across conversations, and several
workspace-scoped calls refetched on every conversation switch. The target is a
**warm** second open (same SPA session, same workspace, provider already seen)
that issues **≤3** fetch round-trips — process detail, `canvases?processId=`,
and `pull-request-chat-bindings?taskId=` — excluding the persistent
`stream?warm=1` SSE EventSource (which opens only for running conversations).
The sidebar `all` list is left untouched and there is no new server
aggregation/bootstrap endpoint; the wins are all client caching, re-keying,
deferral, and additive cache headers.

- **Static config client cache** — `react/api/staticConfigCache.ts` is a
  module-level singleton mirroring the AppContext `ConversationCacheEntry`
  `{value, cachedAt}` + 60-min-TTL pattern (deliberately **not** React-Query/SWR).
  `getOrFetchConfig(key, fetcher, ttlMs?)` returns a cache hit, fetches once on a
  miss, dedupes concurrent same-key fetches, and does **not** cache failures;
  `peekConfig(key)` is a synchronous seed used so a warm reopen paints with no
  loading flash; `invalidateConfig(key)` drops one key; `configCacheKey` builds
  the keys (`.models`/`.reasoningEfforts`/`.effortTiers(provider)` per **provider**,
  `.llmToolsConfig(workspaceId)` per **workspace**). The provider-config hooks
  (`hooks/useModels.ts`, `hooks/useProviderModels.ts`,
  `hooks/useProviderReasoningEfforts.ts`, `hooks/useProviderEffortTiers.ts`) and
  the two llm-tools-config consumers (`features/repo-settings/LlmToolsPanel.tsx`
  `loadConfig`, `features/chat/sessionContextDrop.ts`
  `useConversationRetrievalCapability`) all read through this cache, so a
  conversation whose provider/workspace was already seen this session triggers
  **zero** config calls. `test/setup.ts` clears the singleton in a global
  `beforeEach` so it stays transparent to consumer tests.
- **Invalidate-on-mutate** — each settings mutation drops only its own key so the
  next read refetches without a page reload: `setEnabledModels` →
  `models:<provider>`, `setReasoningEffort` → `reasoning-efforts:<provider>`,
  `effortTiers.save()` → `effort-tiers:<provider>`, and `LlmToolsPanel`'s toggle
  → `llm-tools-config:<workspaceId>` after a successful `updateLlmToolsConfig`.
- **Workspace-scoped data is not refetched per conversation** —
  `features/chat/hooks/useLoops.ts` fetches `loops.list` keyed by
  `[workspaceId, cloneClient]` only (processId is dropped from the fetch dep); the
  per-process view is a `useMemo([allLoops, processId])`, so a conversation switch
  re-derives the filtered list with no round-trip and only a workspace change
  refetches. The unseen `count` refresh is gated on a real seen-state change:
  `useUnseenChat`'s `markSeen`/`markAllSeen`/`markTasksSeen`/`markUnseen` now
  return whether they changed seen-state (detected synchronously via a
  `seenMapRef`), and `RepoChatTab` only calls `scheduleUnseenRefresh()` when that
  boolean is true — so reopening an already-seen conversation issues no `count`
  call.
- **Deferral past first paint** — the conversation process-detail fetch + message
  render is the critical path; the two remaining non-critical per-conversation
  fetches run after first paint via `utils/runWhenIdle.ts`
  (`requestIdleCallback` with a `{timeout}` bound so the data still loads
  automatically on a busy page, `setTimeout(cb, 0)` fallback for Safari/jsdom;
  returns a disposer). `ChatDetail` keeps
  `setCanvasPanelClosed(readCanvasClosed(...))` synchronous (no collapse-rail
  flash) and defers only `client.canvases.list`; `usePrChatStatusItems` keeps its
  synchronous resets immediate and defers only the async binding IIFE
  (`listChatBindingsForOrigin` + association build + detail fan-out), guarding the
  idle fire with `generationRef` so an A→B switch never fires a stale fetch. Both
  effects `cancelIdle()` in cleanup.
- **Short-lived HTTP cache headers** — the four static-config GET routes carry
  `Cache-Control: private, max-age=60` (so a cold reload within the window skips
  the round-trip) via `setStaticConfigCacheHeaders(res)` in
  `src/server/shared/router.ts`, applied on the 200 path only:
  `agent-providers/agent-providers-routes.ts` (`reasoning-efforts`, `effort-tiers`),
  `routes/queue-enqueue.ts` (`models`), and `routes/api-workspace-routes.ts`
  (`llm-tools-config`). The 60s TTL is conservative because client-side
  invalidate-on-mutate already covers same-session edits, so the header only
  bounds cross-reload staleness.

## Work Items UI

The hierarchy tree uses `WorkItemHierarchyTree` and `WorkItemHierarchyNode`.
Local trees show the work-item number beside the title and a status chip for
leaf rows. Remote/Synced trees keep the type avatar, title, remote mirror badge,
and container rollups, but omit local work-item numbers and leaf status chips so
remote identifiers remain the primary row metadata. Compact GitHub mirror badges
render the issue number only; full detail-page badges keep the provider label and
link title. Core Work Item list/detail/create/update/pin/archive/delete, hierarchy-tree, plan
history, parent re-linking, sync status, remote import/convert, execution, Submit PR, AI review, Dreams work-item next actions, and comment-resolve UI paths compute a
canonical origin ID from the selected workspace remote (`gh_*`, `ado_*`,
`git_*`, or `local_*`) and call the origin-scoped coc-client methods while still
passing `workspaceId` when the route needs a concrete clone for provider,
queue, or filesystem semantics. PR list/detail, provider
subresources (threads, reviewers, commits, checks, combined/per-file diffs), and
chat bindings use the same browser-safe origin resolver and call origin-scoped
APIs while passing the selected `workspaceId`/`repoId` to choose the concrete
clone; fresh-chat reset still passes the selected `workspaceId` so
archiving/process actions run against a concrete clone. `WorkItemContext` keys persistent Work Item lists, pagination, unseen IDs,
and realtime revisions by that origin ID so same-origin clones share the same
list state and remote-shell Work Items badges.
`work-item-added`, `work-item-updated`, and `work-item-removed` WebSocket events
update the raw event scope and the resolved origin scope for known workspaces;
origin-scoped events update the origin scope directly. `WorkItemHierarchyTree`
uses the origin-scoped realtime revision and `client.workItems.treeForOrigin(...)`
to refetch tree data, passing the selected `workspaceId` only for clone metadata
validation. Work Item chat bindings use origin-scoped client methods and pass
the selected `workspaceId` only for fresh-chat archive/reset actions.
The hierarchy toolbar exposes a Refresh control that calls the same tree fetch
path and is disabled while the tree request is in flight.
Both the hierarchy node and flat `WorkItemSection` right-click context menus share
a 📋 Copy submenu (Copy ID / Copy title / Copy info) built by
`buildCopyContextMenuItem` (`workItemCopyMenu.ts`); the clipboard text comes from
the pure `workItemInfo.ts` formatters, which reuse `getWorkItemChatIdentifier`,
`TYPE_LABELS`, and `STATUS_LABEL` (no new prefix/label maps). Each action copies
via `copyToClipboard` and reports through the optional `ToastContext` (success /
error toast). Note: `ContextMenu` renders an item flagged `separator: true` as a
divider only and drops its content, so menus add dedicated separator entries to
group the Copy item rather than flagging it.

`workItems.workflow.enabled` is the disabled-by-default durable workflow gate for
turning local Work Items and Goals into the command-center planning/execution
surface. The SPA receives it as `workItemsWorkflowEnabled` from bootstrap config
and `GET /api/config/runtime`; use `isWorkItemsWorkflowEnabled()` for UI gates so
legacy Work Items and Chat behavior remains unchanged while the flag is off.
Work Item detail renders the editable title in the top header row and keeps
type, status, mirror, plan version, priority, updated time, parent, tags,
auto-execute, source, and primary actions in the compact properties row directly
below it; the scrollable body starts with description/plan content rather than a
separate metadata card.
When the flag is on, the local create dialog exposes a Work Item vs Goal type
selector for title-first shell creation even when hierarchy mode is off; existing
bug and hierarchy-type creation paths keep their prior behavior. Saved local-only
Work Item and Goal details render as a command center around the editable current
version, primary actions, review state, and execution timeline. The mobile detail
layout keeps the same Work Item-centered flow with full-width touch-friendly
primary actions, wrapping Review buttons, lens-compatible chat behavior, and a
readable version/run timeline on narrow screens. Saved local-only Goal details
expose a Start/Continue grilling action that opens the existing Work Item chat
lens with Ralph grilling context (`grill-me` plus
`context.ralph.phase='grilling'`) and records the chat process on
`grillSessionId`. This Goal workflow keeps the Work Item system as the source of
truth and does not require a Notes-backed `.goal.md` mirror. The Work Item
execute dialog is also workflow-aware for saved local-only Work Items and Goals:
it exposes a per-run One-shot vs Ralph mode selector, defaults Work Items to
One-shot, defaults Goals to Ralph, and sends the selected execution mode through
the typed Work Items client. In Review, local-only Work Items/Goals expose an
explicit AI Review action that enqueues a `code-review` chat as a non-mutating
timeline entry, plus a Submit PR action only when the implementation change has
eligible commits and no recorded PR.

`features.ralphMultiAgentGrill` is a disabled-by-default runtime feature flag
surfaced to the SPA as `ralphMultiAgentGrillEnabled` from bootstrap config and
`GET /api/config/runtime`; use `isRalphMultiAgentGrillEnabled()` for UI gates.
The flag only enables the multi-agent Ralph grilling setup surfaces and prompt
contract. Notes direct goal launch remains separate because it skips grilling.

## Chat UI Architecture

`ConversationTurnBubble` renders:
- **Assistant turns:** Left-aligned with `C` avatar whose color tracks the
  chat's provider via `getProviderAvatarClasses` (`ProviderBadge.tsx`) —
  Copilot=green, Claude=coral/orange, Codex=indigo. Body is borderless,
  flowing content. The `provider` prop flows from `ChatDetail` →
  `ConversationArea` → `ConversationTurnBubble`; missing/unknown provider
  metadata falls back to the Copilot (green) palette.
- **User turns:** Right-aligned with `Y` avatar (blue), soft-gray rounded bubbles.
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

`QueuedFollowUps` renders pending messages as compact dashed-border cards with cancel buttons.

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
`effectivePlanPath`). It enqueues a new autopilot task that executes the plan,
and renders a status banner over the CTA when prior runs exist (live status of
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

`ChatHeader` exposes a `Thread | Agents` segmented toggle (`ChatViewToggle`,
under `features/chat/agent-canvas/`) via its `viewToggle` slot. `ChatDetail`
owns the `view` state and, in `agents` mode, swaps the `ConversationArea` inner
row for `AgentCanvas` — a pannable/zoomable spatial tree of the chat's
recursive sub-agent runs — while keeping the composer/scratchpad and hiding the
thread-only flow cards (Ralph start, Implement-plan). The toggle is hidden when
the chat has no sub-agents (`hasSubAgents = agentRoot.children.length > 0`), in
the `floating` variant, and while loading/pending. Rendering keys off
`effectiveView` (= `view` only when sub-agents exist, otherwise `thread`), so a
stale `?view=agents` deep-link can't strand the user on an empty canvas — it
"waits", revealing the canvas the moment the first sub-agent appears. In the
main inline context
the view is deep-linked: a `?view=agents` query param on the chat hash
(`#repos/<ws>/<tab>/<taskId>?view=agents`) is read on mount (so a
shared/bookmarked URL reopens straight into the canvas) and written via
`history.replaceState` on toggle (`chatViewHash.ts`). `parseActivityDeepLink`
strips the `?query` so the param never corrupts the taskId. `view` resets to
`thread` on chat switch (honoring a deep-linked view on first mount).

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
`[data-no-drag]` overlay — the toolbar, legend, and the open inspector — so
those scroll/click natively instead of zooming/panning the canvas behind them.
It renders curved SVG edges + node cards (role glyph, name, live elapsed,
spawn-count pill, status dot, progress bar) and a live 1s clock for running
nodes. Clicking a sub-agent node opens `AgentInspector` — a right-side panel
with the run's name/type/status/elapsed, a details list (model, mode, summary),
the task prompt, its result, and its children (clickable to drill in); clicking
the orchestrator root closes it.
`AgentCanvas` owns the inspector selection; the inspector's "Open sub-agent
detail" button calls `onOpenAgentDetail`, which `ChatDetail` routes through the
same `handleSelectAgent` path as the cascade menu so the read-only
`SubAgentDetailView` opens for that node.

**Cascading dropdown + in-place sub-agent detail.** Beside the toggle,
`AgentCascadeMenu` lists the tree's depth levels (`flattenAgentLevels` → L0…Ln,
only existing levels) in a left pane and that level's agents on the right;
picking an agent opens its conversation **in-place, read-only**
(`SubAgentDetailView`), picking the orchestrator (L0) returns to the main
thread (`handleSelectAgent` derives the view via `viewForAgentSelection`: a
sub-agent id → `agents` canvas, the orchestrator/null → `thread`). The selected sub-agent rides the hash as `?agent=<id>` alongside
`?view=agents` (`chatAgentHash.ts`), composed into one `replaceState`; a
stale/invalid id clears itself and resets on chat switch (parity with
`effectiveView`). `buildSubAgentTurns(turns, id)` reconstructs the sub-agent's
conversation as `[userTurn(prompt), assistantTurn(steps + result)]` by collecting
its full descendant subtree via `parentToolCallId`, then renders it through the
**same** `ConversationArea` / `ConversationTurnBubble` as the main thread —
identical tool-call rendering. The filtered steps keep their `parentToolCallId`:
the sub-agent's own Task id is absent from the synthetic turn, so the renderer
leaves its direct steps at top level and nests deeper descendants under their
parents (nested sub-agents render as Task cards), re-rooting the subtree. There
is no follow-up input in detail mode, and the sub-agent's status (not the
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
variants share one `ToolCallDetailSections` body. Whisper header parts and the
group's reconstructable tool calls come from `buildWhisperGroupModel` /
`collectGroupToolCalls` (`whisperGroupModel.ts`). The whisper summary spans
(skills/memories/files/commits/PRs/pushes) share the `useHoverPopover` /
`HoverSummarySpan` hover primitive (`hoverPopover.tsx`).

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
`AskUserInline`. Each live question card has a compact response-type dropdown
with Answer, Skip / not applicable, and Need more context choices; the deferred
choice marks that question complete for batch submission and reveals an optional
short note field. Unsubmitted live-batch drafts are saved in browser
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
whisper collapse. Generic `ToolCallView` still handles `ask_user` as a fallback
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
1. `RichTextInput` (contenteditable)
2. Toolbar reads as ownership zones separated by 1 px vertical dividers (`chat-toolbar-divider-*`):
    - **Initial chat (`NewChatArea` / `InitialChatComposer`)**: the Activity composer uses `settingsLayout="responsive"`: it renders the full toolbar at desktop-width container measurements (`AgentSelectorChip` → divider → primary `ModePillSelector` (Ask/Autopilot) plus a Workflow submenu for enabled workflow modes → divider → model picker → `EffortPillSelector` or `EffortTierSelector` → spacer → ctool buttons (`/`, `@`, attach) → divider → send) and switches to compact layout whenever its own measured container is below the `wide` tier (<700px via `useContainerWidth`), so the toolbar compacts before its full chip row would wrap onto a second line. `InitialChatComposer` also supports explicit `settingsLayout="compact"` for lens-sized surfaces. Compact layout replaces the visible provider/mode/workflow/model/effort controls with one AI settings chip labeled `provider · active mode/workflow · effort` (for example `Copilot · Ask · Auto` or `Copilot · Ralph · High`), omits the model from the chip label, keeps attach, `/`, and send visible, and does not render the separate top-level `@` button. The chip opens an AI settings editor that pairs the provider and effort controls on one row, mode/workflow on the next, and renders the model picker only when effort-tier mode is inactive — in effort-tier mode the selected tier supplies the model, so the standalone model control is hidden (matching the full-toolbar logic); the editor uses an anchored 360px popover when the measured composer width can fit it and falls back to fixed bottom-sheet positioning when the compact composer is too narrow. Commit, PR, and Work Item review-chat empty states reuse `InitialChatComposer` with compact layout, preserving slash commands, `/model`, prompt history, ghost-text autocomplete, file attachments, session-context attachments, and sends bound through `context.commitChat`, `context.pullRequestChat`, or `context.workItemChat`. Ralph is selected from the Workflow submenu; in the Activity tab the active Ralph send control is a split submit where the primary action is **Grill** and **Start from goal...** opens an editable direct-goal review dialog that posts the reviewed text to `/api/ralph-launch` without sending attachments. Review-chat initial composers use the same Ralph grilling send path but omit the direct-goal split action so every send remains bound to the review target. When `forEach.enabled` is true, initial chat exposes `For Each` through the Workflow submenu with the internal value `for-each`; when `mapReduce.enabled` is true, it exposes `Map Reduce` with the internal value `map-reduce`; neither workflow mode is shown in follow-up composers. Submitting For Each or Map Reduce creates a normal persisted Ask-mode generation chat, selects it in the Activity detail pane, and stores `payload.context.forEach.kind='generation'` or `payload.context.mapReduce.kind='generation'` metadata with workspace, generation ID, child mode, original request, status, latest valid structured plan, latest invalid-plan error, and eventual run linkage. The generation chat uses the normal provider/model/reasoning, slash-skill, prompt-history, session-context, and file/image attachment path; follow-ups remain locked to the matching plan-generation system context through persisted process metadata. `ChatDetail` passes `ForEachPlanReviewCard` and `MapReducePlanReviewCard` into `ConversationArea` as post-conversation content so generated-plan review cards stay inside the main `activity-chat-conversation` scroll region above the follow-up composer. `ForEachPlanReviewCard` renders the persisted latest valid item plan when available, falls back to transcript scanning for newer assistant turns, keeps the previous valid plan when a refinement emits invalid JSON or no Advanced JSON, shows that error inline, renders a structured editor plus Advanced JSON fallback, and approves through `client.forEach.create/updatePlan/approve` without calling child start/continue endpoints. `MapReducePlanReviewCard` mirrors that flow with editable `maxParallel` and `reduceInstructions`, validates the complete map/reduce JSON plan, and approves through `client.mapReduce.create/updatePlan/approve` without starting map or reduce work. `ChatListPane` renders these generation chats as normal chat-history rows with sky-blue **For Each** or indigo **Map Reduce** badges and generated-plan previews such as `3 proposed items - draft`, `1 proposed item - approved`, or `4 proposed map items, max 3 parallel - draft`.
   - **Follow-up (`FollowUpInputArea`)**: provider chip → divider → `ModePillSelector` → divider → model picker → `EffortPillSelector` (rendered only when the parent supplies `onEffortChange`) → flexible middle hosting `ComposerMetaStrip` right-aligned → ctool buttons → divider → `QueueFollowUpButton`. The flexible middle has `flex-basis: 0` + `min-w-0` + `container-type: inline-size`, so the meta strip can never push the toolbar onto a second row — it grows into free space, shrinks by truncating the cwd path, and because basis-0 makes the middle's width equal the toolbar's free space, container queries hide the strip's unshrinkable pieces instead of letting them overlap neighbours: the cwd group hides below 320px of free space and the whole strip below 160px. The toolbar measures its own width via `useContainerWidth` with a raised `wideThreshold` of 820px and sheds progressively as the pane narrows: below 820px it compacts labels (icon-only model chip, cwd basename, no `Effort:` prefix); below 500px (container-tight) it swaps in the mobile controls — the segmented mode pills become the tap-to-cycle button and slash/mention/attach fold into the "⋯" overflow menu — driven by the container signal, not just the `lg:` viewport gate; below 380px the provider chip and Send button go icon-only (`iconOnly` prop on `AgentSelectorChip` / `QueueFollowUpButton`, accessible names preserved). Only below ~300px does the `lg:flex-wrap` fallback wrap to a second row. Provider isn't switchable on a follow-up (locked to the session), so the provider chip is read-only. At widths below `lg` (≤1023px), the row stays `flex-nowrap`, the segmented mode selector collapses to a tap-to-cycle button, slash/mention/attach collapse into a single overflow menu, `ComposerMetaStrip` is hidden, and visible reachable controls use approximately 32px tap targets; `lg:` classes restore the compact desktop sizes and wrapping behavior. Stopped chats in `cancelled` status keep the composer disabled while the transient `cancelling` state is active, then re-enable only when a saved `sdkSessionId` is present; if no SDK session was saved, the composer remains disabled with a non-retryable inline error rather than showing "Session expired" or a retry/new-chat shortcut.
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

Modal job-submission dialogs use `shared/ModalJobAiControls.tsx` when they need New Chat-compatible provider/model/reasoning controls. Its `useModalJobAiSelection()` hook centralizes workspace-scoped `lastChatProvider` restore/persist, provider-scoped model catalogs, effort-tier mode, legacy model picker + `EffortPillSelector` fallback, optional initial AI selections for Resume-style flows, a dirty bit, and resolved payload values for queue/chat submissions. Concrete selections resolve to `{ provider, model?, reasoningEffort? }`; Auto resolves to `{ effortTier, autoProviderRouting: true }` with no provider/model override, and submitters translate that flag to `context.autoProviderRouting.requested` or route-level `autoProviderRouting: true` so scheduling routes can pick a concrete provider first and then expand that tier through the selected provider's configuration. `queue/EnqueueDialog.tsx` uses these compact controls in its Advanced area for Ask AI, ad hoc autopilot tasks, skill/context-file runs, bulk context-file submissions, and floating-chat launches. `tasks/GenerateTaskDialog.tsx` uses these compact controls in its configuration area and forwards the resolved values to `/api/workspaces/:id/queue/generate`; `shared/UpdateDocumentDialog.tsx` uses them in the existing configuration area and enqueues custom chat tasks; `features/work-items/WorkItemExecuteDialog.tsx` renders the same controls through `RunSkillPanel` and forwards them to `/api/workspaces/:id/work-items/:wid/execute`; `features/chat/SkillContextDialog.tsx` uses them for git commit, multi-commit, and branch-range skill runs. Ralph start surfaces also use `shared/RalphExecutionRepoSelector.tsx`: `features/chat/RalphStartPanel.tsx` drives `ModalJobAiControls` from the selected execution workspace, reuses `/api/processes/:id/ralph-start` only for same-workspace/server grilling starts, and posts cross-workspace starts to the selected target's `/api/ralph-launch`; `shared/RalphLaunchDialog.tsx` uses the same selector for direct goal-file launches from Notes and New Chat, can accept a caller-owned resolved AI selection for New Chat direct-goal launches, and posts to the selected target server's `/api/ralph-launch`. `features/chat/RalphWorkflowPane.tsx` uses `ModalJobAiControls` in both the stuck-session Resume confirmation and the completed-session Continue-loop confirmation, each initialized from transient session `resumeDefaults` when recoverable and disabled while that action is submitting. Classify-diff toolbars call `useModalJobAiSelection()` directly and render `features/git/diff/ClassifyDiffAiControls.tsx`, an inline toolbar variant that hides the provider chip when only one provider is selectable and shows either an effort-tier selector or the pickable-model command picker. Diff classification categories are `logic`, `mechanical`, `test`, `simple`, and `generated`; `simple` is labeled "Simple function" and remains low-attention by default. PR and commit popout file rails show compact category badges plus a critical marker, and their selected-file unified diff views render test fidelity comments, logic summaries, and critical usage/call-stack evidence inline near each classified hunk; branch-range popout diff UI stays on the compact classification-free path.

`EffortPillSelector` drives the per-turn `reasoningEffort` override (Low/Medium/High; `null` = no override, falls back to the persisted per-model effort then the SDK default). The chip is structurally a dropdown menu (`AgentSelectorChip` style): trigger button (bars icon + label + chevron) opens a popover listbox with `Auto`/`Low`/`Medium`/`High` entries. The `Auto` entry explicitly clears the override and is also what the currently-selected level toggles to when re-clicked. New chats persist the selection alongside the draft (`useDraftStore` → `Draft.effortOverride`). Follow-ups thread the choice through `useSendMessage → ProcessMessageRequest.reasoningEffort → POST /api/processes/:id/message` and into either `bridge.enqueue` (queued) or `bridge.executeFollowUp` (direct/buffered). The server mirrors the value into `task.config.reasoningEffort` via `queue-shared.validateAndParseTask`, so executors see it from a single canonical location.

Effort-tier mode is enabled by default through `effortLevels.enabled` and can be turned off live from Admin when users need the legacy separate model picker and reasoning-effort controls. `EffortTierSelector` lists `Very Low`, `Low`, `Medium`, and `High` in that order. For concrete providers, tooltips expose the concrete model and reasoning effort mapped to the selected tier and each configured menu option; empty reasoning effort displays as `Auto`, and unconfigured options remain disabled with an Admin configuration tooltip. For the Auto provider selection, all tier keys remain selectable and tooltips explain that the provider and model are resolved at scheduling time.

The Admin AI Provider page's Provider routing subtab exposes the single `features.autoAgentProviderRouting` toggle. When enabled, Auto becomes the default for omitted-provider chats, tasks, and API-created work; explicit provider selections and follow-ups keep their provider. The same subtab lets admins reorder provider rules, toggle each rule, edit normal minimum remaining quota percentages, toggle and edit weekly guard thresholds, choose a fallback provider, and preview the concrete provider selected by the shared Auto router using the current availability state plus cached quota response. The Default Provider buttons only select concrete providers (`copilot`, `codex`, `claude`) for the non-Auto fallback path. The Refresh quota button force-refreshes the provider quota cache and updates the preview. When Auto is disabled, the rule editor is hidden behind an Auto-disabled message.

The Admin AI Provider page's `ProviderEffortTiersSection` uses the same tier order (`Very Low`, `Low`, `Medium`, `High`) when editing provider defaults. Rows sourced from hardcoded provider defaults are prefilled and marked with a `Default` badge; saving persists only rows explicitly changed from those defaults, and clearing an override reverts that row to its provider default.

Quota UI math lives in `shared/quotaUtils.ts`. It formats quota-window labels,
clamps remaining and used percentages, maps remaining percentages to risk
classes, and selects the tightest finite quota across one provider or across
enabled providers. Known provider windows label `five_hour` as `5h` and
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

## Top Bar

Right-hand action cluster:
`[Connected pill | NotificationBell | AgentProviderQuotaIndicator | Admin | Theme]`.
The quota indicator is hidden below the `md` breakpoint; the mobile top bar does
not render the quota dropdown trigger. The mobile CoC/hostname link is a
shrinkable truncated flex item so optional My Work/My Life shortcuts and the
fixed right-hand action cluster stay reachable on narrow phones.

The legacy "Tools" popover has been migrated into the Admin page's left
sidebar, but there is no longer a generic Tools group. The Admin sidebar is
grouped by user task: Configure, Knowledge, Connections, Operations, and
Developer / Internals. Embedded tool rows keep stable ids (`memory-toggle`,
`skills-toggle`, `dreams-admin-toggle`, `logs-toggle`, `stats-toggle`,
`servers-toggle`) and `data-tab` still carries the matching dashboard route;
Servers is shown only when `isServersEnabled()` is true. The Knowledge group's
**Dreams** row (`dreams-admin-toggle`, route `#dreams-admin`) renders
`features/dreams/DreamsView.tsx` and is the admin home for global Dreams config:
the live `dreams.enabled` toggle, `dreams.idleCheckIntervalMs` edited in minutes
with a restart hint, idle-run defaults for provider, model, and timeout
(`dreams.provider`, `dreams.model`, `dreams.timeoutMs`), and the relocated
**Dreams provider activity** queue + history section
(`features/dreams/ProviderActivitySection.tsx`); that section no longer lives on
the AI Provider page. It is distinct from the per-workspace `DreamsPanel`.

Clicking an embedded tool row dispatches `SET_ACTIVE_TAB` and updates
`location.hash` to the corresponding top-level route (`#memory`, `#skills`,
`#dreams-admin`, `#logs`, `#stats`, `#servers`). The Router maps every embedded tool
tab plus `'admin'` itself to a single `<AdminPanel />` render, so the admin shell
(sidebar + breadcrumb + right pane) stays mounted across navigation.
`AdminPanel` switches on `state.activeTab` — when it matches an embedded tool
route, the right pane mounts the corresponding View embedded inside an
`.ar-tool-embed` flex column (instead of the standard `.ar-page` card grid).
The breadcrumb reads `<Group> / <Label>` while a view is embedded.

Clicking an admin/settings row resets the dashboard tab back to `'admin'`,
unmounts the embed, and renders the standard admin card content.
Each tool's internal sub-tab/hash scheme (e.g. `#skills/installed`,
`#logs?sessionId=…`) is unchanged.

### Skills Config panel & folder-source grouping

The Skills route's **Config** sub-tab (`features/skills/SkillsConfigPanel.tsx`)
renders five ordered sections: **Global Skills Directory** (read-only managed
install dir, falls back to `~/.coc/skills/` when the server omits
`globalSkillsDir`), **Global Extra Skill Folders** (chips with add/remove/Enter +
dedupe guard; persists `globalExtraFolders` via `skills.updateGlobalConfig`),
**Detected Skill Folders** (an auto-detect checkbox toggling
`autoDetectDefaultFolders`, the auto-detected entries from
`skills.getEffectivePaths()`, a concise "No OneDrive skill folders detected."
empty state, and skipped roots hidden in a collapsed `<details>` diagnostics
row), **Effective Search Order** (a read-only `<ol>` from
`getEffectivePaths()` called with NO workspaceId — global-only, with a "Showing
global paths only" note so repo-local/per-repo paths aren't claimed to apply
globally), and **Globally Disabled Skills** (unchanged; writes send only
`{ globalDisabledSkills }` so existing tests pass). Source badges: `managed-global
→ Managed`, `configured → Configured`, `auto-detected → Auto-detected`,
`repo`/`repo-extra → Repo`, `bundled → Bundled`. Status badges:
`available → Available`, `missing → Missing`, `no-skills → No skills`,
`skipped → Skipped`.

The skill-source taxonomy is duplicated across four shapes that must stay in
sync: server `SkillInfo.source` (`skill-handler.ts`), coc-client `SkillSource`
(`contracts/skills.ts`), SPA shared `SkillInfo.source` (`shared/SkillDetailPanel.tsx`),
and `SkillFolderGroup.source` + grouping logic in the Repo Settings → Agent
Skills tab (`features/skills/AgentSkillsPanel.tsx`). The `global-extra-folder`
source forms its own NON-removable group (`🌐 <folderPath>`) placed after
global/repo and before per-repo extras, since those folders are managed globally
in the Config tab, not per-repo.

### Remote-first shell

The remote-first navigation model is gated by `useRemoteShellEnabled()`
(`hooks/feature-flags/useRemoteShellEnabled.ts`), which reads the live
`features.remoteShell` admin flag (runtime flag `remoteShellEnabled`,
`isRemoteShellEnabled()` in `utils/config.ts`). It is a **global admin setting**
toggled in **Admin -> Configure -> Features -> Remote-first shell**
(`toggle-remote-shell-enabled`), defined once in `ADMIN_SETTING_DEFINITIONS`.
Enabled by default; desktop-only; takes effect on reload.

- **Single-row shell (`RemoteShellHeader`)** renders inside `TopBar` when
  `remoteShellEnabled`, the active tab is `repos`, a real repo is selected, and
  the viewport is not mobile. `RemoteScopeCluster` renders a boxed current-remote
  chip plus Work Items / Pull Requests pills; the chip opens a dropdown with
  recent remotes from global preference `recentRemotes` (MRU keys are
  `groupKey(group)`, capped at 8), default-group fallback before any MRU exists,
  search across all remotes, a Show all overflow, and add actions for Add
  workspace folder (`AddFolderDialog`), Add specific repository
  (`AddRepoDialog`), and Clone repository (`CloneRepoDialog`). Selecting a remote
  records it in the MRU and picks that remote's remembered clone when available,
  otherwise the first local-first clone. `WorkspaceTabsCluster` renders the
  existing clone switcher, clone popover, clone-scoped tabs, overflow menu, repo
  info/remove dialogs, and toast behavior in the same row. `TopBar` also renders
  `header-new-btn` as the first right-side action before the WebSocket status
  pill; it opens the enqueue dialog for the active clone. `ReposView` renders a
  `chromeless` `RepoDetail` for the active repo.
- **Virtual-workspace shell (`VirtualWorkspaceShellHeader`)** renders inside
  `TopBar` when `remoteShellEnabled`, desktop, the active tab is `repos`, and the
  selected workspace is a virtual one (`my_work` with My Work enabled, `my_life`
  with My Life enabled). Virtual workspaces have no real repo/git context, so they
  can't flow through `RemoteScopeCluster` / `WorkspaceTabsCluster`; instead they
  describe themselves with a `VirtualWorkspaceHeaderConfig` (`MY_WORK_HEADER_CONFIG`
  / `MY_LIFE_HEADER_CONFIG`, exported from `MyWorkView` / `MyLifeView`): identity
  chip + sub-tabs (Notes/Activity/Git/Schedules/Settings) + action buttons
  (Sync / Generate Summary). It mirrors `RemoteShellHeader`'s visual shell and
  reuses `useVirtualWorkspaceHeader` for sub-tab visibility, active-tab, tab
  navigation, and running the actions. The matching in-body variant
  (`VirtualWorkspaceInlineHeader`) renders inside `MyWorkView` / `MyLifeView`
  themselves in the classic shell and on mobile (where the TopBar header doesn't
  apply); the view gates it on `!(remoteShell && !isMobile)`.
- When `features.remoteShell` is on but neither a real repo nor a virtual
  workspace can back a header (a fresh desktop window with no selection, or any
  tab other than Repos such as Admin / Wiki), `TopBar` falls back to the classic
  `RepoTabStrip` so the top row stays consistent across every page and repository
  navigation is always visible. `RemoteShellHeader` (repos tab + real clone
  selected) and `VirtualWorkspaceShellHeader` (repos tab + virtual workspace)
  replace the strip; everywhere else the strip renders.
- **Shared shell behavior** comes from `shellModel.ts` and `repoGrouping.ts`.
  Aggregated remote checkouts fold into the matching local origin's tab (by
  normalized git URL); a remote-only repo gets its own group. Group clones are
  sorted **local-first** by `groupReposByRemote`, so the default clone is local
  when one exists. `partitionShellTabs` keeps Work Items and Pull Requests
  remote-scoped. `computeCloneStatusMap` and `cloneStatusColor` drive clone dots:
  local clones stay queue-derived; remote clones blend connection-first via
  `blendRemoteCloneStatus` (`offline`/`failed` -> grey offline,
  `connecting`/not-yet-online -> blue connecting, online -> remote queue state).
  Offline remote rows stay visible but disabled/greyed with `data-offline="true"`
  and `clone-offline-badge`; online and connecting rows stay interactive. Clone
  tabs use a hidden measurement mirror plus `ResizeObserver` feeding
  `computeVisibleTabKeys`, so as many tabs as fit stay inline and the tail
  collapses into the overflow menu while keeping the active tab visible.

**Remote workspace aggregation** (gated by `features.remoteShell`): when the flag
is ON, `ReposContext.fetchRepos` also calls `aggregateRemoteWorkspaces()`
(`repos/remoteWorkspaceAggregation.ts`) in parallel with the local
`listWorkspaces()` + git-info batch. For each registry server (`/api/servers`)
that is `online`, it fetches `/api/workspaces` + the git-info batch + the queue
(`queue.repos()`) DIRECTLY at the server's `effectiveUrl` via a self-contained
`CocClient` (it does NOT reuse `getSpaCocClient` routing). Each remote workspace
is tagged with a `remote` marker `{ baseUrl, serverId, serverLabel, offline,
connection, queue }` plus a top-level `baseUrl` (the routing key — no composite
IDs, no serverId namespace); local workspaces carry neither, so
`isRemoteWorkspace()` distinguishes them. `connection` mirrors the registry's
runtime status (`online`/`connecting`/`offline`/`failed`/`idle`) so the status
dot can tell connecting from offline; `queue` is this workspace's remote queue
state (`running`/`queued`/`paused`/`idle`, from `remoteQueueStatusFromRepo` keyed
by `repoId` = workspace id), `'idle'` when offline or the resilient queue fetch
fails (a queue failure never drops the server). Remote rows are merged into the
same `RepoData[]` as local ones (git-info pre-resolved from the per-server batch)
and are skipped by the local Phase-2 git-info update. Offline / unreachable
servers contribute their last-known list from a two-layer (in-memory +
`localStorage['coc-remote-workspace-cache']`) per-server cache
(`repos/remoteWorkspaceCache.ts`), each entry flagged `offline` (with the real
`connection` preserved). When the flag is
OFF, `aggregateRemoteWorkspaces()` returns empty and performs no remote fetch, so
the classic flow is unchanged.

**Per-clone request routing**: a remote clone's REST + WS can be routed to its
server's `baseUrl` via opt-in primitives; the default `getSpaCocClient()`
singleton and the repos-list/git-info aggregation stay on the page origin.
`getCocClientFor(baseUrl?)` (`api/cocClient.ts`) returns the default singleton
when `baseUrl` is omitted, else a per-`baseUrl`-cached `CocClient` whose REST
(`/api` base) and `events` WebSocket target that origin.
`resolveCloneBaseUrl(ref, repos)` (`repos/cloneRouting.ts`) maps a workspace
object, workspace id, or remote clone key to its remote `baseUrl` (or
`undefined` when local) using the AC-01 remote markers. WS URL construction goes
through `cloneWsUrl(path, baseUrl?)`
(`api/wsUrl.ts`): with a `baseUrl` it derives `ws(s)://{host:port}{path}`
(http→ws, https→wss) keeping the path+query verbatim; without one it reproduces
the legacy `window.location` behavior. The shared `/ws` process-event stream
(`useWebSocket` → `getSpaCocClient().events`) is already baseUrl-aware through the
SDK's `buildWebSocketUrl`.

**Clone→baseUrl lookup registry + per-tab wiring (AC-07)**: every in-scope tab
(Activity/Chats, Git, Terminal, Explorer, Schedules, Pull Requests, Work Items,
Notes) loads and writes against a selected remote clone's own server, never the
local one. The seam is `repos/cloneRegistry.ts` — a module-level
`cloneKey → baseUrl` map plus `workspaceId → cloneKeys` index (remote workspaces
only) that `aggregateRemoteWorkspaces` populates on every repo refresh via
`registerCloneBaseUrls` (full replace, covering online AND cached/offline rows;
cleared when the flag is OFF or the registry is unavailable). Remote markers
carry `remote.cloneKey = remote:${encodeURIComponent(serverId)}:${encodeURIComponent(workspaceId)}`;
`repos/cloneIdentity.ts` centralizes clone-key build/parse, selection ids, and
old path-only fallback resolution: `#repos/ws-*` links that no longer match a
registered workspace are matched by the legacy root-path hash to the migrated
local workspace, or to a single unambiguous remote clone key. Unique remote
workspace ids still resolve directly; when cached/legacy rows collide on
workspace id, `ReposContext` records the selected clone key with
`setActiveCloneForRouting(...)` so bare workspace-id service calls from the
selected `RepoDetail` resolve to the chosen server instead of the other clone.
The registry exposes `lookupCloneBaseUrl(workspaceIdOrCloneKey)`,
`getCocClientForWorkspace(workspaceIdOrCloneKey)` (= `getCocClientFor(lookupCloneBaseUrl(id))`,
falling back to `getSpaCocClient()` for a local/unknown id so local behavior is
byte-for-byte unchanged), `cloneApiBase(workspaceIdOrCloneKey)` (absolute remote
REST base for hand-built URLs like the `EventSource` process stream),
`cloneWsUrlForWorkspace(path, workspaceIdOrCloneKey)`, and
`requestForWorkspace(workspaceIdOrCloneKey, url, options?)` (clone-routed analog
of `requestSpaApi` that fetches a RELATIVE api path against the clone — same
`toSpaCocRequestOptions`/error-translation as `requestSpaApi`, used by the git
diff-viewing layer which builds a bare path and then fetches it). The routing hooks
(`useResolveCloneBaseUrl()`, `useCocClient(ref?)`, `useCloneWsUrl(ref?)`) resolve a
bare workspace id through this registry (no `ReposContext` dependency, so they are
safe in deep per-tab components and unit tests) and a workspace **object** from its
own marker.

Wiring is at the per-feature HOOK/SERVICE seam where a `workspaceId` is already
the input:
- React components/hooks call `useCocClient(workspaceId)` and use the returned
  client for all clone-scoped REST: `useGitInfo`, `TerminalView` (terminal
  list/pin), `ChatDetail` (every `processes`/`queue`/`notes`/`canvases`/`skills`
  call), `RepoSchedulesTab` (schedule CRUD + notes-git status),
  `WorkItemSection` + `WorkItemHierarchyTree` (list/tree/mutations),
  `WorkItemExecuteDialog` (skill-list load), and
  `PullRequestsTab` (list/suggestions/roster/classification).
- Non-React services that take a `workspaceId` resolve via
  `getCocClientForWorkspace(workspaceId)`: `explorerApi.*`, `notesApi.*`, and the
  recent-skills hook `useRecentSkills` (per-workspace preferences get/patch).
- Several React components route their workspace-scoped calls through the registry
  seams inline (not the hook) — `requestForWorkspace(id, url, opts?)` for raw
  fetches, `getCocClientForWorkspace(id)` for typed-client calls: `EnqueueDialog`
  (`/summary` + `/skills/all` loads, the `queue.enqueue` mutation, and
  `recordSkillUsage`), `RepoSettingsTab` (mcp-config, skills, instructions, repo
  prefs, processes, description PATCH), `RepoDetail` (work-items badge preview),
  `WorkItemsTab` (commit file list), and `BranchPickerModal` (branch list/switch).
  `EnqueueDialog`'s Workspace dropdown merges local `appState.workspaces` with the
  remote workspaces from `ReposContext.repos` (via `useReposOptional`, filtered by
  `isRemoteWorkspace`); remote rows are labeled `name [serverLabel]` and rendered
  `disabled` with an `(offline)` suffix when `remote.offline`. Selecting a remote
  workspace routes the enqueue to its server through the same
  `getCocClientForWorkspace` seam — no enqueue-path logic is remote-specific.
- `RalphStartPanel` reads goal files from the source clone through
  `cloneApiBase(workspaceId)` (`/fs/blob?path=...`) and routes the start POST via
  the selected Ralph execution target. Same-workspace/server grilling starts use
  that target's `processes/:id/ralph-start` endpoint so the grilling session is
  reused; cross-workspace or remote-target starts use the selected target's
  `ralph-launch` endpoint with the selected `workspaceId`. Remote target URLs are
  built from the selected server's effective URL, not from the local API base.
- The Ralph workflow pane routes its whole data flow to the clone: the per-session
  journal READ (`useRalphSessionView` -> `workspaces.ralphSession`) resolves its
  client via `getCocClientForWorkspace(workspaceId)`, and the continue/new-loop/
  resume mutations (`RalphWorkflowPaneContainer` / `RalphWorkflowPane`) go through
  `useCocClient(workspaceId)` -- so a remote clone's Ralph session is read and
  mutated on its own server (the bare local singleton 404s a remote-only session as
  "Ralph session not found").
- The Activity WRITE path `useSendMessage` routes `processes.sendMessage` /
  `promoteToRalph` through `getCocClientForWorkspace(workspaceId)`; the
  Activity events stream `useChatSSE` opens its `EventSource` at
  `cloneApiBase(workspaceId)`.
- The GLOBAL `/ws` event stream is mirrored per-clone by `RemoteCloneEventBridge`
  (`features/remote-shell/`, rendered inside `ReposProvider`): it opens one
  `getCocClientFor(baseUrl).events.connect(...)` socket per ONLINE remote clone
  (deduped by `baseUrl`, reconciled as clones connect/disconnect) and feeds every
  message into App's shared `onMessage`. Without it, `useWebSocket` only listens to
  the LOCAL `/ws`, so a remote task's `process-updated` lifecycle event never
  arrives and its sidebar row stays stuck "running" (the per-process SSE still
  shows the open conversation completing). This is the global-events counterpart to
  the per-process `useChatSSE` routing.
- The terminal PTY socket (`useTerminalWebSocket`) resolves the clone baseUrl
  from the registry and passes it into `cloneWsUrl`, so a remote clone's terminal
  targets its server. The `/ws` comment subscriptions (`useTaskComments` +
  `git/hooks/use*Comments`) already route through `cloneWsUrl`.
- The Git diff-viewing layer is routed too: `WorkingTree` /
  `WorkingTreeFileDiff` / `WorkingTreeAllComments` and the comment hooks
  (`useDiffComments`, `useAllCommitComments`, `useFileCommentCounts`,
  `useCommitCommentTotals`) use `useCocClient(workspaceId)` for their REST git
  calls (their `/ws` subscriptions stay on `cloneWsUrl` unchanged);
  `useClassification` / `useCommitClassificationStatus` route the
  PR classify-diff calls through `/api/origins/:originId/classify-diff*` with
  workspace/repo metadata and commit classify-diff calls through
  `/api/repos/:id/classify-diff*`, both via `useCocClient(workspaceId)`. The
  `DiffSource` factories (`createCommitDiffSource`/`createBranchRangeDiffSource`/
  `createPrDiffSource` in `git/diff/diffSource.ts`) resolve their path-builder
  client via `getCocClientForWorkspace(id)`, and `fetchDiffFromSource(workspaceId,
  url)` + `useCachedDiff` fetch the relative diff url via
  `requestForWorkspace(workspaceId, url)`. `useFileDiff(url, fullUrl?, workspaceId?)`
  threads the id from `FileDiffPanel`. Non-React `diffCommentApi`
  (`patchDiffComment`/`deleteDiffCommentById`) routes via
  `getCocClientForWorkspace(wsId)`.

No-local-fallthrough guarantee: a selected remote clone's clone key, or its bare
workspace id when unique / active-disambiguated, resolves to its `baseUrl`, so
its clone-scoped REST/WS never hit the default local client; an OFFLINE-selected
clone still resolves to its last-known `baseUrl` (degrades to empty/cached UI,
never a silent local call) because cached/offline rows are registered too.

The sub-tab taxonomy and feature-flag/git/layout gating live in
`features/repo-detail/repoSubTabs.ts` (`SUB_TABS`, `VISIBLE_SUB_TABS`,
`TAB_GROUP_INDEX`, `computeVisibleSubTabs`), shared by both `RepoDetail` and the
shell so the two stay behaviorally identical. Selection/routing reuse
`buildRepoSubTabSuffix` via `useShellNavigation`. `SHOW_WIKI_TAB` / `SHOW_MEMORY_TAB`
live in a dedicated lightweight `navFlags.ts` (read by `repoSubTabs.ts`; re-exported
from `TopBar` for `BottomNav`/`Router`) — kept out of the heavily-mocked
`featureFlags.ts` so partial test mocks of it don't break on the missing export.
When `features.splitWorkspacePanel` is enabled, both `RepoDetail` and the
remote-shell `WorkspaceTabsCluster` pass the flag into `computeVisibleSubTabs`,
so the clone-scoped standalone Git tab is hidden and the chat tab label becomes
Workspace while Git remains available inside `SplitWorkspacePanel`.

## Onboarding

- `WelcomeTour`: 5-step full-screen modal (Welcome/Modes/Queue/Multi-repo/Servers)
- `FirstStepsCard`: Guided checklist replacing empty repos state
- `FeatureTip`: Contextual dismissible tips
- State in `GlobalPreferences` (hasSeenWelcome, onboardingProgress, dismissedTips)

## Activity Tab

- Action bar: New chat + refresh + ALL/AP split pause pill
- Scope segmented control: Chats / Loops (when `loops.enabled`) / Automations / All
- Search box: hidden by default, gated behind `searchVisible`. Ctrl+F / ⌘F
  routes by which pane owns keyboard focus (never mouse hover) through the shared
  `useScopedFindShortcut(containerRef, onTrigger, opts)` hook
  (`react/hooks/useScopedFindShortcut.ts`). Every search-owning panel (chat list,
  git commit list, tasks, work items) uses it so none can fight over
  `preventDefault` or swallow native find. The hook: skips when its container is
  hidden (`offsetParent === null`, so a mounted-but-hidden keep-alive tab never
  intercepts); yields when focus is in the detail pane (`data-pane="detail"`, via
  the exported `isWithinDetailPane`) so native find-in-page (Electron overlay /
  browser find) takes over — it only opens when `defaultPrevented` stays false;
  handles when focus is inside the container; and, when focus is on
  `document.body`/nothing, handles only if `claimsBodyFocus` is set (default true;
  the git list passes `!isSplitWorkspace` so the chat list wins body focus in the
  split-workspace layout). Panels are tagged with `data-find-scope` while mounted
  so a sibling never steals Ctrl+F from a different focused panel. ✕ clears the
  query but leaves the box open; Escape clears the query and hides the box; a
  `workspaceId` change also resets `searchVisible`
- Selection persists in `localStorage['coc-activity-scope']`
- `ChatListPane` keeps the action/scope/search controls in a sticky
  `chat-list-fixed-header` block while the list rows scroll underneath. The
  header full-bleeds to the scroll container edges (`-mx-2 md:-mx-4`) and the
  `chat-list-pane` scroll container carries no top padding (`px-2 pb-2 md:px-4
  md:pb-4`, not `p-2 md:p-4`) so the `sticky top-0` header sits flush against the
  top — top padding there would show as a gap above the panel, which a negative
  header margin cannot cancel because sticky clamps to the padding edge.
- The desktop activity split (`RepoChatTab`) can collapse the left chat-list
  panel to a thin rail; collapsed state persists in
  `localStorage['activity-list-collapsed-{workspaceId}']`, the left-panel width
  persists in `localStorage['activity-left-panel-width-{workspaceId}']`, and the
  collapse affordance sits on the list/detail resize handle.
- The `SplitWorkspacePanel` chat/git divider is an explicit horizontal
  `role="separator"` resize handle with an expanded hit target; it persists the
  chat pane height per workspace under
  `split-workspace:{workspaceId}:chat-height`.
- Each `SplitWorkspacePanel` left half (chat top, git bottom) sits under a
  compact 22px VS Code-style section header. Clicking a header collapses that
  half to just its bar; the still-open half grows to fill (the chat/git divider
  renders only when both halves are open). Collapsed bodies stay mounted but
  `hidden` so scroll/selection survive. Collapsed state persists per workspace
  under `split-workspace:{workspaceId}:chat-collapsed` and
  `split-workspace:{workspaceId}:git-collapsed`, written only on an explicit
  user toggle (never on mount or workspace switch). The optional docked `footer`
  (the remote-first shell's status cluster) is pinned to the bottom-left of the
  column; when both halves are collapsed neither carries `flex-1`, so a `flex-1`
  spacer is rendered above the footer to keep it at the bottom instead of riding
  up under the headers.
- The git half uses a dense skin to save vertical space. `SplitWorkspacePanel`
  exposes a `gitHeaderExtra` slot on the git section header (rendered right of
  the chevron+label toggle; its clicks don't toggle; stays visible while
  collapsed, with the collapsed half switching to `overflow-visible` so
  dropdowns aren't clipped). `RepoDetail` fills the slot with a portal host div
  (`splitGitHeaderNode`, mirroring the `splitDetailNode` pattern) and passes it
  to `RepoGitTab` as `headerToolbarContainer`; `RepoGitTab` portals a
  `compact` `GitPanelHeader` (slim pills/buttons, timestamp without " ago")
  into it instead of rendering the 38px toolbar strip. The hoisted portal is a
  sibling OUTSIDE the git list's `onClickCapture` wrapper — portaled React
  events bubble through the React tree, so nesting it would make toolbar clicks
  (Pull/refresh) mark git last-clicked and steal the shared detail pane from
  the chat. In split layout the
  search bar also slims (placeholder `Search commits…`, full hint kept in
  `aria-label`), the `git-repo-sections` grid tightens, and `BranchChanges` /
  `WorkingTree` render their `compact` variant: flat left-accent rows instead
  of rounded cards, `Range`/`Local` tags, shortened summaries and `{n}f`
  file-count badges with the full text preserved in `title` tooltips.
- For Each parent run group rows render in Activity Chats and All, but not in
  Activity Automations or Loops; loop-linked child chats can still appear in
  Loops independently of the hidden parent group row.

Ralph activity deep-links mount `RalphWorkflowPane`, which shows a unified task timeline alongside a read-only session file browser. The timeline interleaves iteration nodes (the union of `record.iterations` and parsed `progress.md` sections) with final-check nodes built from `record.finalChecks`: each `RalphFinalCheckRecord` renders a distinct `RalphFinalCheckNode` labeled `Final check #<checkIndex>` immediately after the iteration it validates (`sourceIteration`), and therefore before the first iteration of any gap-fix loop it starts. Final-check nodes show status (`queued`/`running`/`completed`/`failed`) and a gap summary (`No gaps`, `1 gap`, `<N> gaps`, or an in-progress/unknown copy); a node with a recorded `processId` is clickable and opens that final-check chat process, while one without is rendered disabled. Gap-fix loops (a loop whose index matches a `finalCheck.gapLoopStarted`/`gapLoopIndex`) render a `Gap fix loop <N>` divider that is not gated behind `RALPH_MULTI_LOOP` since it follows final-check visibility; generic `Loop <N>` dividers keep their existing `RALPH_MULTI_LOOP`-gated behavior. Final-check visibility is display/navigation only — it reads already-persisted session data and adds no new persistence. The file browser lists the raw files returned by the Ralph session API, selects the first file by default, renders Markdown files through the shared markdown renderer, and formats JSON files as plain indented text. For stuck executing sessions with no running iteration, the pane's Resume confirmation renders `ModalJobAiControls`; unchanged recovered `resumeDefaults` are omitted so the resume route preserves prior AI settings, while changed selections are serialized to `workspaces.resumeRalphSession()`. The completed-session Continue-loop confirmation renders the same controls and serializes the extension to `workspaces.continueRalphSession()` (a `RalphContinueRequest` carrying `additionalIterations` plus the optional AI overrides) with the identical omit-when-unchanged behavior. The pane accepts an optional selected filename from the router and reports file selections back to the host so URL hash wiring can deep-link individual session files with `#repos/{workspaceId}/activity/ralph/{sessionId}/{filename}`; bare and trailing-slash session hashes have no pre-selected file and fall back to the first file.

## Dreams Route

The repo-scoped Dreams tab (`features/dreams/DreamsPanel.tsx`) is a dedicated review surface separate from Work Items. It is included in repo tab strips only when the global `dreams.enabled` feature flag is on, then requires the workspace `preferences.dreams.enabled` opt-in before calling Dreams routes. Once enabled, it lists visible cards by default, supports status filters for hidden lifecycle history, exposes a manual **Run dream now** action, shows run summaries/no-new-dreams states, links source process turn ranges back to the Activity conversation route, and offers card lifecycle actions: approve, dismiss, record conversion, and supersede. Approved cards also expose an explicit **Take next action** dialog: skill/prompt cards can queue an Ask-mode skill-hardening task, user-workflow cards can save to Notes or Memory V2, and product cards can create a new Work Item or append the recommendation to an existing Work Item. Each next action runs only after the dialog submit and then records the resulting artifact as a dream conversion.

## CLI Sessions Tab

The repo-scoped `CLI Sessions` tab (`features/native-copilot-sessions/NativeCopilotSessionsPanel.tsx`, exported as `NativeCliSessionsPanel`) is a read-only provider-switched view of native Copilot, Codex, and Claude Code CLI sessions for the active workspace. It is gated by `features.nativeCliSessions` / `nativeCliSessionsEnabled` (disabled by default; `useNativeCliSessionsEnabled()` tracks live runtime-config updates), reads through `coc-client`'s `nativeCliSessions` domain, and registers as the `cli-sessions` repo sub-tab while accepting the legacy hidden `copilot-sessions` key for old links. The panel renders a two-pane layout on wide screens (searchable session list left at a clamped ~42% width, selected-session detail right) and stacked single-pane navigation on narrow screens. A provider switcher defaults to Copilot for legacy compatibility and selects Copilot, Codex, or Claude; the header uses the shared `ProviderBadge` palette (Copilot green, Codex indigo, Claude coral), a provider-specific native-session label, and a read-only badge whose tooltip shows the selected provider's local store path.

The list supports text query, session-ID, branch, date-range filters, and pagination. Codex and Claude use on-demand substring search over JSONL transcripts and report `searchIndexAvailable: false`; when a query is active the panel explains that there is no native search index. Copilot delegates to the native SQLite provider and reports its native search-index availability. Each list row shows a short session-ID chip, updated timestamp, two-line summary preview, repository/cwd, optional match snippets, and right-aligned turn-count and branch pills; the selected row gets a left accent bar. The selected session is deep-linked through the URL hash (`#repos/{wsId}/cli-sessions/{provider}/{sessionId}`, parsed/built via `parseNativeCliSessionDeepLink`/`buildNativeCliSessionHash`) so selections survive refresh/back-forward and are shareable; `#repos/{wsId}/copilot-sessions/{sessionId}` is parsed as a legacy Copilot provider link.

The list route deduplicates against the Activity tab: native sessions whose provider session ID matches a CoC process `sdk_session_id` for the workspace (resolved via `ProcessStore.getSdkSessionIds(workspaceId)`) are hidden, and the response `deduplicatedCount` drives a `native-sessions-deduplicated` hint reading `N sessions hidden — already tracked in CoC Activity`. Automated Copilot background-job sessions whose first turn matches `BACKGROUND_JOB_PROMPT_PREFIXES` are hidden by default and counted in `backgroundJobCount`, which drives a `native-sessions-background-hidden` hint. The panel renders distinct disabled/unavailable (`store-missing`/`store-invalid`)/loading/empty/error states per provider.

The detail pane reconstructs the selected session as a rich CoC chat transcript rather than a plain text dump. The unified detail endpoint (`GET /api/workspaces/:id/native-cli-sessions/:sessionId?provider=...`) returns provider-tagged metadata, `storePath`, `searchIndexAvailable`, and an always-present `conversation: ReconstructedConversationTurn[]`. Copilot reconstruction prefers the native `session-state/<id>/events.jsonl` log and falls back to flat `session-store.db` turns; Codex and Claude reconstruction comes from defensive JSONL parsers that skip malformed or unknown records and preserve user/assistant messages, tool start/complete/failed timeline items, thinking/reasoning, data-URL images, and model metadata when present. Codex `event_msg` user-message image metadata is merged into the matching user turn; `local_images` paths are shown as read-only markdown references because the existing chat image gallery only renders data URLs. The SPA maps each turn to `ClientConversationTurn` via `nativeConversationTurns.ts` (`toClientConversationTurns`, folding assistant `thinking` into a leading markdown blockquote since `ClientConversationTurn` has no reasoning field) and renders one read-only `ConversationTurnBubble` per turn under a `native-session-conversation` card (`Conversation (N)`) with the selected provider passed through for avatar coloring. The whole feature is strictly read-only: no input box, streaming, resume, follow-up, archive, pin, delete, retry, or turn actions are exposed; stored HTML/scripts never execute.

## Memory Route

The top-level `#memory` route is embedded in the Admin shell's Knowledge group and renders `MemoryV2Panel` in the right pane. The panel root owns the stable `#view-memory` id. `MemorySubTab` values are `facts`, `review`, `episodes`, and `settings`; hash links such as `#memory/review` and `#memory/settings` select the matching V2 tab. The legacy memory-config panel is not rendered on the Memory route (the tool-call/explore cache has been removed). Repo settings still use `RepoMemorySection` for repo-scoped bounded memory and raw memory inspection.

`MemoryV2Panel` lists the global scope plus registered workspace scopes, lets users enable/disable the active scope from the Settings tab, exports JSON, and wipes the active scope after confirmation. The tab content is split into `MemoryV2FactsTab`, `MemoryV2ReviewTab`, `MemoryV2EpisodesTab`, and `MemoryV2SettingsTab`.

## Feature Flags

`featureFlags.ts` defines compile-time flags (e.g., `SHOW_WELCOME_TUTORIAL`). Runtime feature flags are exposed through `GET /api/config/runtime` and SPA helpers in `utils/config.ts`; `workItems.sync.enabled` only reports usable sync UI when both it and `workItems.hierarchy.enabled` are true. Most features gated by flags are disabled by default. Pull Requests Team auto-classification is gated by `pullRequests.autoClassifyTeam` / `pullRequestsAutoClassifyTeamEnabled` and is disabled by default. The Git tab's cross-clone cherry-pick UI is gated by `features.gitCrossCloneCherryPick` / `gitCrossCloneCherryPickEnabled` and is enabled by default. Isolated Git worktree execution for Work Item and Ralph launches is gated by `features.gitWorktreeExecution` / `gitWorktreeExecutionEnabled` (disabled by default); the SPA reads it through the typed `isGitWorktreeExecutionEnabled()` accessor in `utils/config.ts`, and remote-target dialogs additionally fetch the selected server's `/config/runtime` `gitWorktreeExecutionEnabled` as a per-target capability signal. Chat composer drag/drop session-context attachments are gated by `features.sessionContextAttachments` / `sessionContextAttachmentsEnabled`; when enabled, same-workspace chat rows, process cards, queue/history process rows, process search result cards, Ralph session group rows, Work Item rows/cards, Git commit rows, Git branch-range headers, and Pull Request rows become copy-drag sources using custom pointer-only MIME payloads, and desktop repo-header Ask/Queue Task buttons become copy drop targets that seed queue-dialog chips. Single-session payloads contain workspace ID, process ID, title/preview, status, and last-activity metadata; Ralph group payloads contain workspace ID, Ralph session ID, phase/status, title/display label, last activity, and ordered child process IDs. Work Item, commit, range, and PR payloads contain stable IDs/references plus safe display metadata only.

### Git worktree execution controls

When `features.gitWorktreeExecution` is enabled, the launch dialogs
(`shared/RalphLaunchDialog.tsx`, `features/chat/RalphStartPanel.tsx`,
`features/work-items/WorkItemExecuteDialog.tsx`) render the shared
`shared/WorktreeLaunchControls.tsx` — an "Use isolated Git worktree" checkbox and,
when checked, an optional "Base ref/SHA" field (empty defaults to current `HEAD`)
plus the uncommitted-source-changes-excluded warning. State lives in the
`useWorktreeLaunchControls({ open })` hook; per-target support is resolved by
`useWorktreeCapability(apiBase, { enabled })`, which fetches the target's
`/config/runtime` so a remote target that does not advertise support disables the
option with an explanatory message. The control renders nothing when the flag is
off, the target lacks capability, or the workspace is not a Git repo, and when
checked it adds `worktree: { enabled: true, baseRef? }` to the launch body.

Post-launch visibility uses the presentational `shared/WorktreeChip.tsx` (branch,
base, status, copyable path). It appears on the Ralph session detail
(`RalphWorkflowPane` header, reading `session.worktree`) and the Work Item
execution-history entry (`WorkItemDetail`, reading `execution.worktree`). The chip
has an opt-in cleanup affordance (`onCleanup`/`canCleanup`/`cleanupError` props,
shown only for `status === 'active'`, `window.confirm`-gated) driven by the shared
`shared/useWorktreeCleanup.ts` hook. A repo-scoped
`features/git/working-tree/WorktreeList.tsx` renders under the Git tab
(`RepoGitTab`) — workspace-scoped, collapsible, only when the flag is on and ≥1
record exists — listing each worktree with its linked task/session and a Cleanup
action. Cleanup calls `client.git.cleanupWorktree`; success flips the row to
`cleaned` locally, a `409` (dirty/running) surfaces the raw Git error inline and
leaves the record active. The branch is never deleted from the UI.

## Work Items

`WorkItemsTab` presents hierarchy mode as two top-level tracker tabs: **Local** and **Remote**. The selected tracker tab is stored in `localStorage` with a key scoped by `workspaceId`; valid saved values restore on mount, invalid or missing values fall back to Local, and work item/session/commit deep links keep using the existing hash shape while the list pane initializes from the saved tracker tab. The Local tab passes `tracker=local-only` to the tree endpoint and shows local creation actions for local-only Epic trees. The Remote tab calls `workItems.syncStatus(...)` without a provider override, uses the workspace repo remote-derived `remoteProvider` as the authoritative visible provider, and only requests the matching `tracker=github-backed` or `tracker=azure-boards-backed` tree. When one supported provider is detected, the Remote tab shows only that provider's icon, the provider chip header shows only that provider (no All chip), the title/subtitle/empty copy and import dialog are provider-specific, and unavailable/auth/setup warnings apply only to the detected provider. Available providers do not render a success/ready banner. Missing, unsupported, or unrecognized workspace remotes show a concise setup message and hide provider chips and import affordances. The Remote import action opens directly in the detected provider mode, then the SPA switches to Remote, persists Remote as the selected tracker tab, selects/highlights the imported root Epic row/card, and keeps the provider filter aligned with the imported provider.

The Work Items list, grouped list, hierarchy tree, and remote sync-status routes are backed by a server-side response cache that can be proactively warmed for the currently active workspace. Background warming refreshes the default local list/grouped responses, the Local tracker tree, the Remote sync status, and the detected Remote provider tree when hierarchy and sync are enabled. Failed background refreshes do not clear stale cached responses, and explicit GETs can pass `force=true` to bypass and replace the cached response.

`WorkItemDetail` is an always-editable inline form: title, description, priority, tags, status, parent, success criteria, and plan content remain editable without an Edit-mode toggle. Description and plan use per-field Source/Preview markdown controls. The view tracks a unified dirty draft; Ctrl+S/Cmd+S and the Save button send one origin-scoped `workItems.updateForOrigin` PATCH containing every dirty metadata field plus `plan.content` when changed. There is no instant status save and no standalone plan save from the detail screen. If a remote-backed save returns `WORK_ITEM_SYNC_CONFLICT`, the detail view renders an inline warning panel near the save/error area with per-field "Your draft" versus provider value cards and retries the same PATCH path with `syncConflictResolution` after the user applies choices. Dirty work-item detail pages show an unsaved-changes indicator, install a `beforeunload` warning, guard the local back breadcrumb, block dirty hash route changes when the user cancels, and intercept hash links before navigation. When `workItems.workflow.enabled` is on and the selected item is a local-only `work-item` or `goal`, legacy `aiDone` is presented as the user-facing **Review** state, Goal `drafting`/`planning` is presented as **Grilling**, and the execution history becomes a compact command-center timeline that shows the selected content version, execution mode, Ralph session ID, AI settings, selected skills, linked commits, PR linkage, errors, and the latest Review run summary. The Review section shows **Submit PR** only when the latest completed change has commits and no recorded PR; clicking it calls the explicit Work Items PR submission endpoint, and successful submission records branch/PR metadata before the item moves to Done. The plan version tabs load history through origin-scoped `workItems.planVersionsForOrigin`/`getPlanVersionForOrigin` calls and expose workflow-only **Compare to current** and **Restore as latest** actions for historical versions. Compare opens a diff modal backed by the origin immutable version compare API. Restore is disabled while the detail has unsaved edits and calls the origin restore API, which creates a new current version rather than overwriting the historical version or the current record in place.
Detail fetch and draft state are scoped to the current `workspaceId` + `workItemId`; stale responses from prior selections are ignored, and drafts initialize or save only when the loaded detail item matches the active selection.

With both `workItems.workflow.enabled` and `workItems.aiAuthoring.enabled` on,
saved local-only `work-item` details show **Draft with AI** for items without
plan content and **Revise with AI** for items with an existing plan. The action is
hidden for remote-backed items and non-`work-item` types, disabled while the
inline draft is dirty, opens `WorkItemAiDraftApplyDialog`, and auto-starts the
typed `workItems.applyAiDraftForOrigin(...)` call with `workspaceId`, the loaded
`updatedAt`, and current content-version guard. The dialog surfaces generating, clarification, retry,
failure, and cancel states; successful apply refreshes the detail and updates the
Work Items context with the returned immutable AI-authored version.

`WorkItemDetail` has a compact **Ask AI** action in the header. It opens `WorkItemChatPanel`, which restores the workspace-scoped remembered chat binding for the selected Work Item or starts a normal `chat` task through the same `InitialChatComposer` capabilities used by commit/PR chat. The composer frame is titled for the selected Work Item and displays the stable Work Item identifier plus saved title. If the inline form is dirty, the chat still uses the saved `item` state and shows an unsaved-edits warning until the Work Item is saved. The initial Work Item chat prompt uses pointer-only `<attached_pointer_context>` metadata plus safe Work Item labels/status/type/number; raw descriptions, plan content, provider payloads, file contents, diffs, credentials, and local paths are not inlined. With `features.commitChatLens` enabled, unpinned Work Item chat renders as a bottom-right lens inside the detail pane on desktop, tablet, and mobile; close/minimize/restore/pin/unpin state is localStorage-scoped by workspace and Work Item. With the flag disabled, the detail pane uses the non-lens embedded fallback and closes that fallback when selection changes.

With `workItems.workflow.enabled` on, saved local-only `goal` details show **Start grilling** or **Continue grilling** near the item actions. The action is hidden for remote-backed and non-Goal items, disabled while inline edits are dirty, starts a Work-Item-bound Ralph grilling chat in the lens, and records the chat process as `grillSessionId`. When the bound chat completes with a final `## Goal` block, the server saves that block as the next AI-authored immutable Goal content version and moves draft/planning Goals to Ready.

The split Local/Remote tracker views do not show the legacy per-item preview/import/export/sync toolbar, and remote-backed Epic roots do not expose manual provider pull actions. Initial import remains the user-facing Remote tracker seeding action; subsequent remote-to-local refreshes are owned by background provider polling. The Remote view surfaces provider status inline: Azure Boards missing setup says import requires either an Azure DevOps repo remote or configured ADO org/project, config-vs-remote mismatch text comes from the server, and Azure CLI auth failures keep the `az login` guidance without exposing tokens. Adding children under GitHub- or Azure-backed roots still uses the normal create flow, which pushes the new child to the backing provider before storing its mirror metadata. Tree rows and detail headers use provider-specific mirror badges that link to the GitHub issue or Azure Boards work item when the remote URL is available.

## coc-client Integration

The SPA consumes `@plusplusoneplusplus/coc-client` for typed REST transport. Domain clients: admin, processes, queue, schedules, tasks, notes, workflows, wiki, memory, memoryV2, skills, preferences, seen-state, work-items, agentProviders, git. The git domain includes commit/diff/branch helpers, operation history, patch-transfer export/apply methods used by cross-clone cherry-pick flows, and the worktree-execution `listWorktrees` / `cleanupWorktree` helpers. The Git tab treats async git operation responses with `jobId` as pending work, polling operation history until terminal status before refreshing; failed Drop Commit jobs render the tab-level action-error banner. Pull, rebase autosquash, drop commit, and reorder share the `useGitOperationPoller` hook (`features/git/hooks/`), which owns each poll's `setInterval` in a ref and clears it on unmount and repo switch, captures the workspace id plus a generation token per `start()` to drop stale ticks, and routes terminal jobs through per-operation `onSuccess`/`onFailure`/`onMissing`/`isComplete` callbacks (lifecycle in the hook, refresh/error semantics in the caller); pull additionally keeps its `pulling` flag and exposes the active job id to the WebSocket `git-changed` handler. The same-clone commit context menu opens `BranchPickerModal` as a local-branch selector for `Cherry-pick to branch…`, sends selected commit hashes oldest-first through `client.git.cherryPick(..., { hashes, targetBranch })`, shows server dirty/conflict errors in the tab action banner, refreshes on success, and keeps the user on the original branch after the server switches back. When enabled, both the single-commit and multi-commit Git context menus open `CrossCloneCherryPickModal` with a `commits[]` (multi-commit selections are ordered oldest-first via `orderOldestFirst`), which lists current-CoC registered workspaces plus online registered remote-CoC workspaces using typed workspace/git-info clients, groups targets by normalized remote URL, recommends same-remote clones, labels each target with its CoC server, requires explicit cross-remote confirmation, and requires explicit dirty-target stash opt-in. The modal exports the whole range as one concatenated `git am` mailbox and reports the applied count ("applied k of N", or a partial count with the conflicting commit on a mid-range conflict). Local targets call `git.exportCommitPatches` + `git.applyCommitPatch` directly; remote targets call the initiating server's `servers.cherryPickTransfer` orchestrator with `source.commitHashes`.

Local React hooks (`fetchApi`, `useWebSocket`, `seenStateApi`) wrap the client for React state management.

## Pull Requests Tab

The Pull Requests tab is enabled by default through `pullRequests.enabled`. Admin -> Configure -> Features exposes both `pullRequests.suggestions` and `pullRequests.autoClassifyTeam`; both are disabled by default and flow through runtime config helpers. PR list load/refresh and open-by-number validation use `client.pullRequests.listForOrigin` / `getForOrigin` against `/api/origins/:originId/pull-requests...`, passing the selected workspace/repo metadata so provider calls run against a concrete clone while cache identity remains the canonical origin. When Pull Requests, focused diff, and Team auto-classification are enabled, PR list load/refresh and active-workspace background warming ask the server to enqueue at most 10 missing low-priority classifications for loaded open Team PRs with `headSha`, skipping cached or running classifications through the origin-scoped classify-diff store/pending markers and reading the origin-scoped Team roster. PR file-list and pop-out classify controls build classification keys with the selected workspace, repo, and canonical origin, then trigger/poll `/api/origins/:originId/classify-diff` so on-demand PR classifications share state across same-origin clones. The Team toolbar reads `/api/origins/:originId/classify-diff/batch-status` for loaded Team PR identifiers, shows disabled/idle/queueing/running/ready status text plus cached/running/missing counts, and adds row-level AI classification badges without changing filters, grouping, ordering, or deterministic risk tiers. Its "Classify now" control posts to `/api/origins/:originId/pull-requests/team-auto-classification` with the selected workspace/repo metadata, so manual requests use the same server cap/skip logic instead of client-side POST loops while still selecting a concrete clone for queue routing. The left queue rail starts with the "Open PR by # or URL" input; successful opens from that input are validated through the origin PR detail API, recorded through the `/api/origins/:originId/pull-requests/recent-opened` API, and shown in a compact "Recently opened" list directly below the input. Recent entries stay hidden when empty or when the rail is collapsed, open through the same overview navigation path, and confirmed 404s remove the stale entry from the origin list. PR review pop-outs carry the selected workspace's resolved origin ID in the pop-out URL, load PR title/head metadata through the origin detail API, and hydrate/persist reviewed/visited file progress through `client.pullRequests.getReviewProgressForOrigin` / `saveReviewProgressForOrigin` against `/api/origins/:originId/pull-requests/:prId/review-progress`, while still passing workspaceId/repoId metadata for legacy migration only.

Queue filters include All, Mine, Team, Blocked, Ready, and the optional For You pill. Team reads the origin-scoped coworker roster through `coc-client`, requests the PR list with `scope=team`, and relies on the server to fetch provider `scope=all`, supplement with best-effort per-roster-member provider queries (`login` when present, otherwise provider id), filter by the origin-scoped roster before pagination, and return the filtered total. When Team is active, the rail shows roster chips that can be toggled for transient in-session narrowing, removed through the roster API, and extended with a debounced text combobox that searches repo PR authors through `/api/origins/:originId/pull-requests/coworker-candidates` using the selected workspace/repo metadata instead of only currently loaded rows. Its count badge reflects the server-filtered loaded PR set, so additional roster matches beyond the current page appear after Load more fetches them.

Queue rows use server-enriched provider/git diff stats for file count, review-minute estimates, and deterministic risk tiers: low below 200 changed lines, medium from 200 through 800, and high above 800. Missing diff stats render unavailable queue metadata instead of falling back to mock data.

The PR list route is backed by a server-side cache that can be proactively warmed
for the currently active workspace. Background warming uses the same provider
list and diff-stat enrichment path as the tab load, refreshes the default
`open`/`mine` list without clearing stale data on failure, and reads the
origin-scoped recently opened list, origin-scoped Team roster, and origin-scoped
cached suggestions when PR suggestions are enabled.

The PR detail overview renders a deterministic review-summary card from the PR description, parsed/provider diff stats, checks, reviewers, and comment threads. Findings are derived from failing checks and unresolved threads, and the former persona-lens grid is not rendered.

PR popout file views expose a Full context toggle that calls the PR per-file diff endpoint with `fullContext=true`. The server first tries a full-file-context git diff from PR `baseSha` to `headSha`, fetches missing PR commits into the requested repo checkout when possible, and only then returns the hunk-only diff with `fullContextUnavailable: true`; the banner is shown only for that fallback response.

PR review suggestions remain behind the separate `pullRequests.suggestions` config flag. The `For You` filter includes a `Generate suggestions`/`Refresh` action that first refreshes origin-scoped review history through `/api/origins/:originId/pull-requests/review-history/refresh`, then asks the server to rank open PRs through `/api/origins/:originId/pull-requests/suggestions/refresh` and cache the result under the same origin. The UI shows inline progress, empty-state guidance, and recovery messages for missing review history or provider errors.
