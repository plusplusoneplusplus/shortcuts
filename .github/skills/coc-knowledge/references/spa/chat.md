# Dashboard SPA — Chat shell & list

Composer gating, the review chat lens, and the chat list. Conversation and tool-call
rendering live in [chat-conversation.md](chat-conversation.md); the composer in
[chat-composer.md](chat-composer.md); the canvas side panel in [canvas.md](canvas.md).

## Composer gating

`ChatDetail` drives composer availability from persisted process state, not local UI
state. A `cancelled` chat is continuable only when the process has a saved
`sdkSessionId`. With no saved session, or with
`metadata.stoppedChatResume.resumable === false` after a strict stopped-chat resume
failure, `FollowUpInputArea` stays disabled behind a non-retryable inline error; there is
no fresh-session fallback.

A terminal **failed** chat exposes `onRetryTask` (`retry-task-button`), gated by
`ChatDetail.canRetryFailedTask`, re-running the original payload as a new conversation
through `client.queue.retry`; a `cancelled` chat without a session has no retry path.

## Review chat lens

`features.commitChatLens` (on by default; a bootstrap-conservative `absentFallback` makes
partial configs read it off) is the single source of truth for how review chat is
presented. `useReviewChatPresentation()` / `useCommitChatPresentation()` render unpinned
targets — commit detail, commit-backed file diff, commit review pop-outs, PR detail Ask AI,
PR review pop-outs, Work Item detail Ask AI, and Notes — as bottom-right lenses. With the
flag off, commit review uses the `coc.commitChat.open` visibility key and
`coc.commitChatPanel.width` resizing instead.

Commit and PR targets fall back to their side-panel or drawer layout on mobile/tablet;
Work Item chat keeps the lens on every viewport. Pinned desktop targets render in the shared
side-panel frame, pinned Work Item chat in a resizable column whose width persists under a
workspace- and item-scoped `coc.workItemChatPanel.width.*` key.

### Persisted lens state

Open, pin, and minimized states are client-local `localStorage`, scoped by workspace plus
review target (`commit` hash, a PR repo/id/head discriminator, or Work Item ID). Lens size
is separate and **global**, under `coc.commitChatLens.size`, clamped to viewport bounds on
restore. Minimizing affects presentation only — the chat tree stays mounted so drafts and
attachments survive.

An active lens chat offers a new-chat-with-same-context action: it archives and clears the
workspace-scoped target binding through the domain client, leaves the previous process
recoverable in history, and returns the panel to the empty composer for the same target.

### Dormancy

`features.commitChatLensDormantMode` (`'ghost'` | `'pill'`, default `'ghost'`) controls
what an open lens does after the cursor leaves: ghost-fade (click-through) or collapse to a
status pill. Either way the full card stays mounted but inert and the outer shell drops
pointer hit-testing, so only the pill covers page content underneath.

Hit detection is `useLensDormantState`, backed by **document-level** `mousemove` and
`dragover` listeners tested against the card or pill bounding rect; element-level
`mouseenter`/`mouseleave` is unreliable because children toggle `pointerEvents` and the
hit-target shape changes between card and pill. `dragover` is load-bearing: no `mousemove`
fires during an HTML5 drag, so without it a ghosted lens stays `pointer-events: none` and
drops fall through. While a drag is in flight the card, not the pill, is the hit target and
the ghost→pill collapse is suppressed.

### ReviewChatPlacementFrame

Two opt-in props extend the shared frame:

- `hideHeader` — Notes passes it; commits, PRs, and Work Items keep the generic
  lens/side-panel header. `ChatDetail` takes the same prop to suppress a nested
  `ChatHeader`.
- `onDropExistingChat` + `dropWorkspaceId` — turns the frame into a drop target for a chat
  row dragged out of the chat list. A `coc.session-context` payload drop calls back with
  `sourceProcessId` after `stopPropagation()`, so the composer's attach-as-context path
  underneath does not also fire. Cross-workspace drops are rejected.

`CommitChatPlacementFrame` is the only wired consumer: it gates the props on
`isSessionContextAttachmentsEnabled()` and forwards to
`useCommitChatBinding.bindExistingChat`, which optimistically swaps `taskId` (rolling back
on failure) and persists through `POST /commit-chat-bindings`.

## Chat list

### Task-group engine

Hierarchy grouping is one shared engine with per-feature adapters:

- `features/chat/task-group-grouping.ts` — generic matching and aggregation: the
  `payload.context.taskGroup` tag reader, activity/end timestamp chains, seeded grouping.
- `features/chat/task-group-descriptors.ts` — per-type presentation and behavior (label,
  badge, accent, pin type, `matchesTask`, `groupable`; Dreams sets `groupable: false`).
- `features/chat/TaskGroupRunRow.tsx` — shared parent-row chrome, with
  `ForEachRunRow`/`MapReduceRunRow`/`RalphSessionRow` as thin wrappers; Ralph supplies its
  phase dot, badge, and session-context drag payload through the row's optional
  display/behavior hooks.

`for-each-run-grouping.ts`, `map-reduce-run-grouping.ts`, and `ralph-session-grouping.ts`
adapt the engine while also matching on feature contexts and `generationProcessId`, so
historical chats group without data migration.

The wrapper-over-generic pattern extends past rows: `TaskGroupRunPane.tsx` is the shared
run-detail pane (run metadata, start/continue, cancel-remaining, refresh, items table with
per-item retry/skip and child links) and `TaskGroupPlanReviewCard.tsx` the shared
plan-review card (transcript-vs-persisted scan merge, structured and raw-JSON item editors,
validation, approve flow). Map Reduce adds its reduce step, max-parallel input, and
reduce-instructions editor through config render slots. `task-group-expansion.ts` owns
workspace-scoped expand/collapse state behind `useTaskGroupExpansion` (pure helpers;
resets on workspace switch), and `task-group-copy-info.ts` holds the pure copy-run-info
text builders.

### ChatListPane

Grouped expansion state is local to the mounted view; Ralph sessions, For Each runs, Map
Reduce runs, and plan-file/history groups start collapsed on mount and on workspace switch.

Workspace-scoped group pins come from `client.processes.listGroupPins(workspaceId)` and
render non-running group parents in the Pinned section, interleaved with individually
pinned chats by pin time. A pinned parent leaves its recency bucket without mutating child
`pinnedAt`/`archived`, while running For Each / Map Reduce parents stay in the Running
section. Parent pin actions call the workspace group-pin API, never child process state.

Multi-select ranges follow *rendered* rows: a collapsed group counts as one row and
expands to its real child process IDs when selected; an expanded group ranges over visible
children. Shift-click on a parent uses it as a range endpoint without opening the detail
pane.

For Each and Map Reduce groups are backed by `client.forEach.list(workspaceId)` /
`client.mapReduce.list(workspaceId)` summaries and nest linked generation/child chats by
`payload.context.forEach` / `payload.context.mapReduce`, persisted metadata, or
`generationProcessId`, so children never duplicate as standalone rows.

Queue pause insert zones open the shared pause-duration menu: until-resumed, hour presets,
or a custom float in (0, 24]. `durationHours` is sent only for timed markers, which render
a duration suffix until the executor consumes them.

`RepoChatTab` persists the Activity chat-list collapsed state and left-panel width under
`activity-list-collapsed-{workspaceId}` and `activity-left-panel-width-{workspaceId}`.

### Row pin/archive routing

Pin and archive state come from process summaries (`pinnedAt`, `archived`) and synchronize
through `ChatPreferencesProvider` / `ChatPrefsSync`. Mutating actions call `pinArchiveApi`
with the provider's `workspaceId`; `ChatDetail` uses its workspace-routed
`useCocClient(workspaceId)` for reads, refreshes, and per-turn delete/pin/archive, treating
persisted `pinnedAt`/`archived`/`deletedAt` from the process detail response as the source
of truth. Chat pop-out URLs carry `cloneBaseUrl` and `PopOutChatShell` seeds the clone
registry before rendering `ChatDetail`, so standalone windows keep clone-aware actions
(routing seam: [clone-routing.md](clone-routing.md)).
