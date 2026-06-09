# Process Store

Abstract `ProcessStore` interface with two implementations: `SqliteProcessStore` (default) and `FileProcessStore` (legacy).

Location: `packages/forge/src/` (`process-store.ts`, `sqlite-process-store.ts`, `file-process-store.ts`)

## SqliteProcessStore

Default backend. Single `processes.db` file at `~/.coc/processes.db`. Schema version 20.

### Tables

| Table | Purpose |
|-------|---------|
| `processes` | Process metadata, config, status, context-window totals/breakdown, pinned_at, archived, last_event_at, seen_at |
| `conversation_turns` | Per-turn content, role, tool calls, pinned_at, archived, deleted_at |
| `conversation_search` | FTS5 index on `conversation_turns.content` with sync triggers |
| `queue_tasks` | Queue task persistence |
| `schedule_runs` | Schedule execution history |
| `commit_chat_bindings` | commitHash → taskId mappings |
| `pull_request_chat_bindings` | prId → taskId mappings (one persistent chat per PR per workspace) |
| `work_item_chat_bindings` | workItemId → taskId mappings (one persistent chat per Work Item per workspace) |

### Key Features

- **FTS5 search:** Full-text search on conversation content via `conversation_search` index
- **Pin/archive:** `pinned_at TEXT`, `archived INTEGER` on processes table
- **Per-turn actions:** `deleted_at`, `pinned_at`, `archived` on conversation_turns
- **Last event tracking:** `lastEventAt` set on `addProcess` (= startTime), updated on `appendConversationTurn`
- **Context window tracking:** `tokenLimit`, `currentTokens`, and optional `systemTokens` / `toolDefinitionsTokens` / `conversationTokens` are persisted on the process record for snapshot replay.
- **Seen state:** `seen_at TEXT` column for read/unread tracking
- **Pending messages:** `pendingMessages` persisted in process metadata
- **Prompt autocomplete:** `getBestPromptCompletion` and `getPromptAutocompleteContext` for ghost text
- **Conversation cost read model:** Process detail reads derive `conversationCostEstimate` from turn-level token usage without persisting it. Pricing model resolution starts with `metadata.model`, falls back to `config.model`, and can be overridden by later user turns with a `model` field. `token-usage` process events can also carry the live `cumulativeTokenUsage` and derived `conversationCostEstimate` snapshot for running-chat UI updates; final process reads remain authoritative.

### Convenience Methods

```typescript
pinProcess(id)
unpinProcess(id)
archiveProcess(id)
unarchiveProcess(id)
archiveProcesses(ids)
unarchiveProcesses(ids)
getPinnedProcesses()
```

## FileProcessStore (Legacy)

Per-repo directory layout under `~/.coc/repos/<workspaceId>/processes/`. Used only when `store.backend: file` in config. 500-process cap.

## Process Lifecycle

Processes flow through states: `queued → running → completed | failed | cancelled`

Key metadata persisted:
- `type` — task type (chat, workflow, script, etc.)
- `config` — model, mode, workspace, tools
- `pendingMessages` — buffered follow-ups
- `pendingAskUser` — pending interactive question

## Conversation Turns

Each turn contains:
- `role` — user/assistant/system
- `content` — message text
- `toolCalls` — array of tool invocations
- `metadata` — model, token usage, timing
- `interrupted` / `interruptionReason` — assistant turns preserved after a
  mid-stream failure/timeout for display and audit only; prompt-history builders
  skip these turns so partial output is not replayed automatically.

## Seen State

Per-process read/unread tracking:
- `GET/PATCH /api/workspaces/:id/seen-state`
- `DELETE /api/workspaces/:id/seen-state/:processId`
- `GET /api/workspaces/:id/seen-state/count`
- Backed by `seen_at TEXT` column

## Turn Actions

Per-message operations:
- `DELETE /api/processes/:id/turns/:turnIndex` (soft-delete via `deleted_at`)
- `PATCH .../restore`
- `PATCH .../pin`
- `PATCH .../archive`
- `GET /api/processes/:id/turns/pinned`

## Storage Migration

On startup:
1. `migrateWorkspaceRegistryIfNeeded()` — workspace/wiki registries from JSON to SQLite
2. `migrateProcessHistoryIfNeeded()` — file-based processes to SQLite

Both idempotent, non-destructive (rename source to `.migrated`).

## Instantiation

```typescript
import { createProcessStore } from 'packages/coc/src/config';
const store = createProcessStore(dataDir, backend?); // 'sqlite' or 'file'
```
