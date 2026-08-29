# Process Store

Abstract `ProcessStore` interface with two implementations: `SqliteProcessStore` (default)
and `FileProcessStore`. Location: `packages/forge/src/` (`process-store.ts`,
`sqlite-process-store.ts`, `file-process-store.ts`).

```typescript
import { createProcessStore } from 'packages/coc/src/config';
const store = createProcessStore(dataDir, backend?); // 'sqlite' | 'file'
```

## SqliteProcessStore

Single `processes.db` at `~/.coc/processes.db`. Schema version 22.

### Tables

| Table | Purpose |
|-------|---------|
| `processes` | Process metadata, config, status, context-window totals/breakdown, `pinned_at`, `archived`, `last_event_at`, `seen_at` |
| `conversation_turns` | Per-turn content, role, tool calls, `pinned_at`, `archived`, `deleted_at` |
| `conversation_search` | FTS5 index on `conversation_turns.content` with sync triggers |
| `queue_tasks` | Queue task persistence |
| `schedule_runs` | Schedule execution history |
| `commit_chat_bindings` | commitHash → taskId |
| `pull_request_chat_bindings` | prId → bare taskId (one chat per PR per canonical origin; the `workspace_id` column stores the origin key). Two writers: the dashboard on live detection, and `bind-detected-pull-requests.ts` when a task finishes |
| `work_item_chat_bindings` | workItemId → taskId (one chat per Work Item per canonical origin; `workspace_id` stores the origin key) |
| `task_groups` | Parent/child task-group registry: one row per hierarchical run/session or chat folder (type, title, normalized status, hidden flag, origin process, `parent_group_id`, extra JSON) |
| `task_group_members` | Child links per group: role (`generation`/`item`/`reduce`/`iteration`/`final-check`/`analyzer`/`critic`), task/process IDs, `itemKey`, `memberIndex` |

### Commit chat bindings

`commit_chat_bindings` is the routing source of truth; each commit chat also carries a
denormalized `metadata.commitChat = { commitHash, commitMessage? }` on its process row, written
from the validated `ChatPayload.context.commitChat` at creation. It survives HEAD moves,
restarts, forks, and archived bindings, and feeds the conversation metadata popover. A rebind
after amend/rebase updates `metadata.commitChat.commitHash`, keeps any saved message, and rolls
the binding back if that update fails, so routing and the displayed commit cannot disagree.

`storage/startup-commit-chat-metadata-backfill.ts` idempotently joins bindings to processes —
accepting bare or `queue_`-prefixed task IDs, scoped by workspace — adding the hash only where
missing, never overwriting an existing object or recording a commit message. No-op for
file-backed stores.

The commit, PR, and Work Item fresh-chat routes archive the bound process and clear only that
target's binding — nothing is forked and no turns are copied, so the next lens send creates an
empty chat. See [rest-api.md](rest-api.md).

### Key Features

- **Column semantics** — `pinned_at TEXT` / `archived INTEGER` back pin and archive (per
  process and per turn); `seen_at TEXT` backs read/unread; `lastEventAt` is set on `addProcess`
  (= `startTime`) and updated on `appendConversationTurn`.
- **Context window tracking** — `tokenLimit`, `currentTokens`, and optional `systemTokens` /
  `toolDefinitionsTokens` / `conversationTokens` persist on the process record for snapshot
  replay.
- **Pending messages** — `pendingMessages` in process metadata; append atomically with
  `appendPendingMessage(processId, message)` (read-append-persist under the store write lock).
  Never read-modify-write the array through `updateProcess` — concurrent follow-ups lose
  updates.
- **Prompt autocomplete** — `getBestPromptCompletion` and `getPromptAutocompleteContext` supply
  ghost text.
- **Workspace ID re-keying** — `renameWorkspaceId(oldId, newId)` atomically rewrites physical
  workspace IDs across workspace records, process rows and metadata, seen-state-bearing history,
  workspace-scoped bindings, task groups, loop/container routing references, and
  queued/scheduled repo IDs. Origin-scoped IDs stay keyed by their origin values unless a row
  still uses the physical workspace ID directly.
- **Conversation cost read model** — process detail derives `conversationCostEstimate` from
  turn-level token usage without persisting it. Pricing model resolution starts at
  `metadata.model`, falls back to `config.model`, and is overridable by a later user turn with a
  `model` field. `token-usage` events may carry live `cumulativeTokenUsage` plus a derived
  estimate for running-chat UI; final process reads are authoritative.
- **Dream internals** — analyzer and critic steps persist as read-only internal process records
  (`dream-analyzer` / `dream-critic`) whose `metadata.dreamStep` carries workspace ID, Dream run
  ID, purpose, read-only/no-tools policy, parent Dream process ID, and analyzer-to-critic
  linkage. Completed outer `dream-run` metadata stores both IDs under `metadata.dream`, so queue
  history and task-detail fallbacks link them without loading full results. An outer run
  aborting mid-step finalizes the internal process `cancelled`.

### Convenience Methods

`pinProcess`/`unpinProcess`, `archiveProcess`/`unarchiveProcess`,
`archiveProcesses`/`unarchiveProcesses`, `getPinnedProcesses`.

`softDeleteTurn` / `restoreTurn` / `hardDeleteTurn` and the `deleted_at` column exist on
`SqliteProcessStore`, but no REST route deletes a message; read paths hide turns with
`deleted_at` set. Seen-state, pin, and archive HTTP surfaces are catalogued in
[rest-api.md](rest-api.md).

### Task Group Registry

`SqliteTaskGroupStore` (forge) owns `task_groups`/`task_group_members` over the shared database
handle; `TaskGroupService` (`packages/coc/src/server/task-groups/`) wraps it. Feature change
hooks — `onRunChanged` on the For Each/Map Reduce/Dream stores, a dataDir-keyed module listener
on `RalphSessionStore` — project run/session records into the registry via `feature-sync.ts`.

Group statuses normalize to `draft | running | completed | failed | cancelled`; feature states
like `reducing`, `approved`, or `grilling` ride in `extra.detailStatus`. Child tasks carry
`payload.context.taskGroup = { groupId, groupType, role, itemKey?, workspaceId }`, mirrored into
`AIProcess.metadata.taskGroup` and forwarded on history items. Dream groups are `hidden`
(linkage-only). `backfillTaskGroups` idempotently projects existing runs on server start.
Registry writes are best-effort: failures log and never break orchestration. With the file
backend the registry is in-memory only.

`parent_group_id` (schema v29) lets a group name a containing group; it is `NULL` for every
run-style group and for flat chat folders. Membership helpers: `unlinkChild(workspaceId,
groupId, processId)` drops one process's links in a group, `findMembership(workspaceId,
processId, { type })` resolves a process to its group, and `listMembershipsByProcess(
workspaceId, { type })` returns a `processId -> groupId` map in one query. Both lookups join
`task_groups`, so a member row whose group is gone resolves to nothing. `removeGroup` deletes
the group and its member rows in one transaction. `findGroupAnywhere(groupId, { type })`
locates a group without knowing its workspace, so a caller can tell "no such group" apart from
"that group lives in another workspace".

### Chat Folders

User-created chat folders reuse the registry as `task_groups` rows of type `chat-folder`
(`CHAT_FOLDER_GROUP_TYPE`), one `task_group_members` row per filed process, with `color` and
`sortIndex` in the `extra` blob. They deliberately register no client task-group descriptor —
a folder has no run lifecycle and must never render as a run header. `getProcessSummaries`
stamps `folderId` onto each `ProcessIndexEntry` from a single membership query, so list views
never join themselves. REST lives in `packages/coc/src/server/processes/chat-folder-handler.ts`
under a dedicated `/chat-folders` namespace — generic task-group mutation is never exposed over
HTTP, so a client cannot touch a live for-each run's group record. UI is gated by the
`features.chatFolders` flag; the routes and schema are not.

## FileProcessStore

Per-repo directory layout under `~/.coc/repos/<workspaceId>/processes/`, selected by
`store.backend: file` in config. 500-process cap.

## Process Lifecycle

States: `queued → running → completed | failed | cancelled`.

**Restart recovery:** `sweepOrphanedRunningProcesses` runs on startup *after* the queue
persistence layer's `restore()`, finalizing processes left by an unclean shutdown
(`running → failed`, `cancelling → cancelled`). Exception: a `running` process whose ID a
re-enqueued chat follow-up points back at via `payload.processId` is revived to `queued` to
match the task still in the queue. `cancelling` processes are never revived. Dangling streaming
assistant turns are finalized `interrupted` either way.

Key persisted metadata:
- `type` — task type (chat, workflow, script, …)
- `config` — model, mode, workspace, tools
- `pendingMessages` — buffered follow-ups
- `pendingAskUser` — pending interactive question
- `stoppedChatResume` — stopped-chat resume state; `{ resumable: false, reason:
  'strict-resume-failed' }` marks a conversation that cannot continue after provider
  strict-resume failure

## Conversation Turns

Each turn carries `role` (user/assistant/system), `content`, `toolCalls`, and `metadata` (model,
token usage, timing). `interrupted` / `interruptionReason` mark assistant turns kept after a
mid-stream failure or timeout for display and audit only — prompt-history builders skip them, so
partial output is never replayed.

## Storage Migration

On startup, in order — all idempotent and non-destructive:

1. `migrateWorkspaceRegistryIfNeeded()` — workspace/wiki registries from JSON to SQLite
2. `migrateProcessHistoryIfNeeded()` — file-based processes to SQLite
3. `migrateWorkspaceIdsToV2IfNeeded()` — physical `ws-*` workspace IDs to machine-scoped
   `ws-v2-*` IDs, moving `~/.coc/repos/<oldId>/` to `<newId>/` when safe and surfacing
   conflicts without overwrites
