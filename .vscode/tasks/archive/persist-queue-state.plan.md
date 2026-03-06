# Plan: Persist Task Queue State Across Server Restarts

## Problem Statement

When the CoC server restarts, the in-memory task queue state is lost. Queued tasks that were waiting to execute, per-repo pause state, and running tasks are all reset. While a partial persistence layer (`MultiRepoQueuePersistence`) already exists in `packages/coc/`, it has several gaps and the VS Code extension's own `AIQueueService` has no persistence at all.

This plan covers auditing the current persistence coverage, closing the identified gaps, and ensuring a reliable restore experience after server or extension restart.

---

## Current State Audit

### What Already Exists

`MultiRepoQueuePersistence` (`packages/coc/src/server/multi-repo-queue-persistence.ts`) is wired up in `packages/coc/src/server/index.ts` and:
- Saves **pending** (queued) tasks and **history** (completed/failed/cancelled, capped at 100) per repo to `~/.coc/queues/repo-<hash>.json`
- Saves global `isPaused` flag per repo
- On restore: re-enqueues queued tasks, demotes running tasks to `failed`, restores history and pause state
- Uses debounced (300 ms) atomic writes (temp-file rename) to avoid data corruption
- Handles large `payload.images[]` via `ImageBlobStore` (externalizes blobs)
- Legacy `QueuePersistence` handles one-time v1→v3 format migration (single-repo → per-repo files)

### Identified Gaps

| # | Gap | Location | Impact |
|---|-----|----------|--------|
| G1 | `pausedRepos: Set<string>` (per-repo pause state inside `TaskQueueManager`) is not included in `PersistedQueueState`; only the global `isPaused` boolean is saved | `task-queue-manager.ts` vs `queue-persistence.ts` | A paused repo is auto-resumed after restart |
| G2 | Running tasks are always demoted to `failed` on restore; no retry on restart | `multi-repo-queue-persistence.ts` `restore()` | Tasks that were mid-execution must be manually re-submitted |
| G3 | `MultiRepoQueuePersistence` has no v1→v3 migration logic; only the now-superseded `QueuePersistence` class does | `multi-repo-queue-persistence.ts` | Users upgrading from old installations may lose queued tasks |
| G4 | `ScheduleManager` and `AdminRouteOptions` are not yet updated to use `MultiRepoQueueExecutorBridge` (TODO(004) in `index.ts` lines 183, 229) | `packages/coc/src/server/index.ts` | Schedule restore may route through the wrong executor |
| G5 | VS Code extension's `AIQueueService` (`src/shortcuts/ai-service/`) has no persistence layer — queue resets on every extension reload | `src/shortcuts/ai-service/` | Tasks submitted via VS Code UI are lost on reload |
| G6 | History is hard-capped at 100 items with no configuration | `queue-persistence.ts` | Long-running servers lose history; no way to tune the cap |

---

## Proposed Approach

### Phase 1 – Fix Per-Repo Pause State Persistence (G1)

Extend `PersistedQueueState` to include `pausedRepos: string[]` (list of repo root paths that are paused). Update both `QueuePersistence.save()` and `MultiRepoQueuePersistence.save()` to write this field, and update `restore()` to call `queueManager.pauseRepo(path)` for each entry.

**Files to change:**
- `packages/pipeline-core/src/queue/types.ts` — add `pausedRepos?` to `PersistedQueueState`
- `packages/coc/src/server/queue-persistence.ts` — write + restore `pausedRepos`
- `packages/coc/src/server/multi-repo-queue-persistence.ts` — write + restore `pausedRepos`

---

### Phase 2 – Configurable Restart Behavior for Running Tasks (G2)

Currently all running tasks are unconditionally failed on restore. Add a `restartPolicy` option to `MultiRepoQueuePersistence`:

```ts
type RestartPolicy = 'fail' | 'requeue' | 'requeue-if-retriable';
```

- `fail` (default, current behavior) — mark running as failed
- `requeue` — push running tasks back to the front of the queue with status `queued`
- `requeue-if-retriable` — requeue only if `task.retryCount < task.config.maxRetries`

Expose this as a server config option (e.g., `~/.coc/config.yaml` key `queue.restartPolicy`).

**Files to change:**
- `packages/coc/src/server/multi-repo-queue-persistence.ts` — add `RestartPolicy` type and option handling in `restore()`
- `packages/coc/src/server/queue-persistence.ts` — same
- `packages/coc/src/commands/serve.ts` — expose CLI flag `--queue-restart-policy`
- `~/.coc/config.yaml` schema (document the new key)

---

### Phase 3 – Migration Logic in MultiRepoQueuePersistence (G3)

Port the v1→v3 `migrateFromOldFormat()` logic from `QueuePersistence` into `MultiRepoQueuePersistence.restore()` so that upgrades from old installations correctly pick up any leftover `queue.json` and `queue.json.migrated` files.

**Files to change:**
- `packages/coc/src/server/multi-repo-queue-persistence.ts` — add `migrateFromOldFormat()` call at start of `restore()`

---

### Phase 4 – Resolve TODO(004): ScheduleManager + AdminRouteOptions (G4)

Update `ScheduleManager` and `AdminRouteOptions` to accept `MultiRepoQueueExecutorBridge` instead of the single-repo bridge. This ensures schedule restore correctly maps to the right per-repo executor after a restart.

**Files to change:**
- `packages/coc/src/server/index.ts` — pass `bridge` (MultiRepo) to `ScheduleManager` and `AdminRouteOptions`
- `packages/coc-server/src/` — update `ScheduleManager` constructor/interface
- `packages/coc-server/src/` — update `AdminRouteOptions` type

---

### Phase 5 – VS Code Extension Queue Persistence (G5)

Add a lightweight persistence layer to `AIQueueService` using VS Code's `Memento` API (already used in `AIProcessManager`). On extension deactivate, serialize the queue to `context.globalState`. On activate, restore pending tasks.

Scope: persist only `queued` tasks (not `running`, since those can't be resumed); discard `running` and mark them `failed` on restore (mirrors CoC server behavior).

**Files to change:**
- `src/shortcuts/ai-service/ai-queue-service.ts` — add `persist(memento)` and `restore(memento)` methods
- `src/shortcuts/ai-service/index.ts` or extension activation — call `restore()` on activate, `persist()` on deactivate
- Add unit tests for the save/restore cycle

---

### Phase 6 – Configurable History Cap (G6)

Make the history cap configurable via server config (`queue.historyLimit`, default 100). Thread the value through `TaskQueueManager` constructor and `QueuePersistence`.

**Files to change:**
- `packages/pipeline-core/src/queue/task-queue-manager.ts` — accept `historyLimit` in constructor options
- `packages/coc/src/server/queue-persistence.ts` — pass `historyLimit` when trimming
- `packages/coc/src/commands/serve.ts` — read from config

---

## Implementation Order & Dependencies

```
Phase 1 (G1: pause state)
    └── Phase 3 (G3: migration)   ← can be done in parallel with Phase 1
Phase 2 (G2: restart policy)      ← depends on Phase 1 (same restore() method)
Phase 4 (G4: TODO(004))           ← independent, but benefits from Phase 2
Phase 5 (G5: VS Code extension)   ← fully independent
Phase 6 (G6: history cap)         ← fully independent
```

---

## Test Plan

For each phase:
- **Phase 1**: Unit test that pause state survives a save→restore round-trip; regression for the "auto-resume on restart" scenario.
- **Phase 2**: Unit tests for each `RestartPolicy` value; integration test that tasks are requeued at front of queue with correct status.
- **Phase 3**: Smoke test that an old `queue.json` is correctly migrated when `MultiRepoQueuePersistence.restore()` is called.
- **Phase 4**: Integration test that schedule restore targets the correct per-repo executor.
- **Phase 5**: VS Code extension test that pending tasks are serialized to `globalState` and restored after simulated reload.
- **Phase 6**: Unit test that history is trimmed to the configured limit.

Existing test files to extend:
- `packages/coc/test/server/queue-persistence.test.ts`
- `packages/coc/test/server/multi-repo-queue-persistence.test.ts`
- `src/test/` (extension tests)

---

## Key Files Reference

| File | Role |
|------|------|
| `packages/pipeline-core/src/queue/task-queue-manager.ts` | In-memory queue state |
| `packages/pipeline-core/src/queue/types.ts` | `QueuedTask`, `PersistedQueueState` types |
| `packages/coc/src/server/queue-persistence.ts` | Single-repo persistence (legacy) |
| `packages/coc/src/server/multi-repo-queue-persistence.ts` | Active multi-repo persistence |
| `packages/coc/src/server/index.ts` | Server wiring (TODO(004) markers) |
| `packages/coc/src/commands/serve.ts` | CLI flags for server |
| `src/shortcuts/ai-service/ai-queue-service.ts` | VS Code extension queue (no persistence yet) |
