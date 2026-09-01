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

### Chat folders

Behind `features.chatFolders` (default off), a **Folders** section renders after
Running/Queued/Pinned and before the date buckets, on every list surface — Activity,
Chats, Tasks and a repo group's Workspace tab all go through `ChatListPane`, so
`ChatFolderSection.tsx` is one renderer rather than four copies of the JSX. The section
is declared as the `folders` `SectionVariant` in `list-mode-config.ts`.

`chat-folder-tree.ts` holds all the bucketing rules as pure functions: `folderId` is read
off the process-summary index that `AppContext` already carries (AC-02 stamps it onto every
`ProcessIndexEntry`), never joined client-side against a members endpoint. A filed row
leaves its date bucket but keeps its Running/Queued row, where it gains a truncated
folder-name chip. A folder whose members all fall outside the current tab's scope is hidden
there, so the count badge always matches what expanding reveals; a folder that is empty
everywhere still renders, dimmed at count 0. Archived members do not count towards
"empty everywhere", so a folder whose chats have all been archived stays on screen at
count 0 instead of being hidden. Only individual process rows are filable — a
for-each / map-reduce / ralph / spawned-tree group entry never resolves to a folder. Pinned
wins over filed: a pinned row renders in Pinned and is excluded from its folder's count.

Members reuse the existing nested-row treatment (`isGroupChild`: indent guide, muted mode
pill, `data-group-child`) rather than a second nesting style. Collapse state is client-side
in `chat-folder-view-state.ts`, keyed per workspace (`coc-chat-folder-collapsed:{workspaceId}`),
default expanded. The folder list itself comes from `useChatFolders`, which only fetches
when the flag is on and resolves its client with
`getCocClientForWorkspace(workspaceId)` — as do `useChatFolderMutations` and
`useChatFolderAssignment`, so folders work on a remote clone
(see [clone-routing.md](clone-routing.md)).

**Managing folders.** The ＋folder / collapse-all pair (`chat-list-new-folder-btn`,
`chat-list-collapse-all-folders-btn`) lives on the FOLDERS section header itself, left of
the count — explorer-style hover actions (always visible on touch, revealed on hover or
keyboard focus on pointer devices). The header is a flex row, not a button: the ▼ Folders
toggle is a nested button so the actions are not inside it. Because the actions live there,
the section keeps its header with an empty body when the workspace has no folders
(`showWhenEmpty`, off while searching, where an empty tree means "no folder matched").
＋folder opens an inline create row at the top of the
section — six colour swatches then a focused input; the same `ChatFolderNameEditor` serves
rename (F2 or double-click on the name), minus the swatches. Commit rules are identical for
both: Enter commits, Esc cancels, blur with text commits, blur while empty cancels, and
renaming to the identical string is a no-op. Names are validated by
`src/server/processes/chat-folder-validation.ts`, which the REST handler imports too, so the
client can never send a name the server would reject; duplicate names are allowed and only
raise a soft hint. The folder ⋯ menu (rename, colour submenu, collapse all, delete) is a
second `ContextMenu` instance, separate from the chat-row menu.

Deleting a folder that has members opens `ChatFolderDeleteDialog` — the app's own dialog,
never `window.confirm`, because the point of the copy is to say that no conversations are
deleted. An empty folder deletes with no prompt. Either way `ChatFolderUndoToast` offers a
single-level undo; since the original `group_id` is gone, undo re-creates the folder and
re-files the ids it snapshotted before the delete, dispatching `PROCESS_UPDATED` so the
summary index agrees. All of it goes through `useChatFolderMutations`, whose list arithmetic
lives in the pure `chat-folder-mutations.ts`.

**Filing rows.** The chat-row context menu gains **Move to folder ▸** between Pin and
Archive, plus **Remove from folder** when any selected row is filed. Both are built by
`buildMoveToFolderItems` in `ChatListPane` from the pure rules in
`chat-folder-assignment.ts` (label pluralization, the past-10 filter threshold, and the
diff that skips rows already sitting in the target so a no-op issues no request). The write
itself goes through `useChatFolderAssignment`, which uses `setProcessFolder` for one row and
`setProcessFolderBatch` for several, patches the summary index optimistically with
`PROCESS_UPDATED`, and rolls each row back individually if the request fails. The submenu's
**+ New folder…** reuses AC-05's inline create row and files the selection once it commits,
so a cancelled create moves nothing.

`ContextMenu` grew three optional item fields for this: `filterable` (render a filter input
at the top of a submenu), `filterPlaceholder`, and `keepOnFilter` (an item that survives any
query — the "+ New folder…" escape hatch). It also gained arrow-key navigation: Up/Down walk
the focused panel, ArrowRight opens a submenu and focuses its first control, ArrowLeft closes
it and returns focus to the parent row, and Enter/Space activates the focused item.

**Search.** While a query is active the tree flattens. `buildSearchChatFolderRows` replaces
`buildChatFolderRows` and keeps only folders whose *name* matches, rendered expanded with
every member beneath them — folder names are matched by shaping the folder as a `{ title }`
task and running it through the list's own `taskMatchesSearch`, so there is no second
matcher. Because the pane derives its visible-folder-id set from those rows, every other
folder dissolves for free: `partitionFiledEntries` leaves its matching members in the flat
date buckets, where they pick up a folder-name chip (unfiled results get none rather than
one reading "Unfiled"). A row that matches *and* sits in a matching folder therefore renders
once, under the folder. A name-matched folder shows all of its contents, not just the rows
whose own text matched, so the search path reads its members from
`searchFolderMembersByFolder` — the unfiltered candidate list, grouped by
`groupEntriesByFolder`, with the type filter and pin/archive precedence still applied.
Collapse state is read but never written on this path, so clearing the query restores exactly
the prior expansion.

**Archiving.** Archiving is a chat *preference* (`archivedChats` on the workspace
preferences), not a process mutation, so a membership row is never touched: an archived chat
keeps its folder, drops out of the folder's tab-filtered count, and comes straight back on
unarchive. The folder ⋯ menu's **Archive all chats** batch-archives every member through the
same `archiveChats` the row menu uses; `chat-folder-archive.ts` decides which members that
is — already-archived rows are ignored and pinned rows are skipped, because pinning
auto-unarchives a chat and archiving one would immediately undo itself. The item is disabled
rather than hidden when nothing is left to archive. `ChatFolderArchiveDialog` names the count
("Archive 12 chats?") and says the folder survives; afterwards `ChatFolderUndoToast` (reused
with a `message` and a `testIdPrefix`) offers a one-click unarchive and reports the pinned
skips. The folder itself is never deleted by this — it is a container you keep reusing.

**Drag and drop.** Filing by drag adds no new gesture: chat rows were already draggable for
session-context attachment, so `chat-folder-drag.ts` writes a *second* MIME
(`CHAT_FOLDER_MOVE_MIME`) onto the same drag and widens `effectAllowed` to `copyMove`. A
composer keeps reading the session-context MIME and is untouched; folder targets read only
the folder MIME. Dragging a folder row is a distinct gesture with its own
`CHAT_FOLDER_REORDER_MIME`, since a folder may be dropped between folders but never into
one (nesting is v2). Queued rows deliberately carry no folder payload — their gesture
belongs to the queue's reorder drag, the same reason AC-06 left them out of the
"Move to folder" menu.

Four targets, all wired by `useChatFolderDragDrop`: a folder row files there (accent tint,
dashed outline, a "Move into <name>" hint; a collapsed folder stays collapsed), an expanded
folder's body files there, the gap between folder rows reorders with a 2px insertion line,
and the date-bucket / Completed region unfiles. Every handler declines — by simply not
calling `preventDefault`, which is what stops the browser firing a `drop` at all — unless
the drag advertises a folder MIME, so a queue reorder drag can never highlight a folder row.
The queue's own handlers already require `QUEUE_DRAG_MIME` and ignore a folder payload in
turn. Note that `dataTransfer.getData()` is blocked during `dragover`: highlighting is
decided from `types` plus this list's own dragstart bookkeeping, and the payload is parsed
only on `drop`, where it is also re-checked against the current workspace and the *current*
`processId -> folderId` map — a drop resolves by row id, never by index, so a list refreshing
mid-drag is harmless. Reordering is optimistic (`reorderChatFolders` renumbers contiguously,
`diffFolderSortIndexes` narrows the writes to the folders that actually moved) and persisted
one PATCH per changed `sortIndex`.

`useChatListDragAutoScroll` scrolls the list when the pointer nears its top or bottom edge.
Its listeners are capture-phase, because the rows being dragged across call
`stopPropagation`. The timer is cleared on `drop`, on `dragend` at the *document* level (an
Esc-cancelled drag fires `dragend` on the source, which may be outside the container), and
on unmount — a scroll timer outliving teardown surfaces as a Vitest "Unhandled Errors"
section even when every test passes.

**Store backend.** Folders need a SQLite process store — the product default
(`createProcessStore` in `src/config.ts`). Only `SqliteProcessStore.getProcessSummaries`
denormalizes `folderId` onto index entries, and under the legacy `file` backend the
task-group registry is a *separate* in-memory database (`TaskGroupService.fromProcessStore`),
so the join has nothing to join against: folders still list and still accept writes, but no
row ever renders inside one. The E2E fixture boots the file store by default, so the folder
specs opt in with `test.use({ processStoreBackend: 'sqlite' })`.

**E2E coverage.** `test/e2e/chat-folder-tree.spec.ts` walks the tree, inline create/rename
and delete-with-undo, and filing from the row menu; `chat-folder-drag.spec.ts` covers the
real HTML5 drag. Shared seeding lives in `test/e2e/fixtures/chat-folders-seed.ts`. Its
`reloadActivity` helper exists because `page.goto` to the URL the page is already on is a
same-document hash navigation that preserves React state — a persistence assertion written
that way passes without ever reloading.

### Row pin/archive routing

Pin and archive state come from process summaries (`pinnedAt`, `archived`) and synchronize
through `ChatPreferencesProvider` / `ChatPrefsSync`. Mutating actions call `pinArchiveApi`
with the provider's `workspaceId`; `ChatDetail` uses its workspace-routed
`useCocClient(workspaceId)` for reads, refreshes, and per-turn delete/pin/archive, treating
persisted `pinnedAt`/`archived`/`deletedAt` from the process detail response as the source
of truth. Chat pop-out URLs carry `cloneBaseUrl` and `PopOutChatShell` seeds the clone
registry before rendering `ChatDetail`, so standalone windows keep clone-aware actions
(routing seam: [clone-routing.md](clone-routing.md)).
