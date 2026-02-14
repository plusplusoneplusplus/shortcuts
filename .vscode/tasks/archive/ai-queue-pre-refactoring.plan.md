# Pre-Queue Refactoring: Add 'queued' Status to AIProcess

## Motivation

The queue system plan creates a separate `QueuedTask` type with its own status tracking, then links to `AIProcess` only when execution starts. This means two parallel tracking systems for the same task.

If `AIProcessStatus` natively supports `'queued'`, the queue implementation simplifies:
- Register a process immediately as `'queued'` when enqueued
- Transition to `'running'` when execution starts
- Existing tree provider, events, and process manager handle it naturally
- No separate `QueuedTask` tracking needed — `AIProcess` is the single source of truth

## Scope

### 1. Add `'queued'` to `AIProcessStatus`

**File:** `packages/pipeline-core/src/ai/process-types.ts:18`

```
Before: type AIProcessStatus = 'running' | 'completed' | 'failed' | 'cancelled';
After:  type AIProcessStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
```

### 2. Add `queued` to `ProcessCounts`

**File:** `packages/pipeline-core/src/ai/process-types.ts:358`

```typescript
export interface ProcessCounts {
    queued: number;    // NEW
    running: number;
    completed: number;
    failed: number;
    cancelled: number;
}
```

### 3. Add optional `initialStatus` to `TypedProcessOptions`

**File:** `packages/pipeline-core/src/ai/process-types.ts:50`

```typescript
export interface TypedProcessOptions {
    type: AIProcessType;
    idPrefix?: string;
    metadata?: GenericProcessMetadata;
    parentProcessId?: string;
    initialStatus?: 'queued' | 'running';  // NEW, default 'running'
}
```

### 4. Update `AIProcessManager.registerTypedProcess` to use `initialStatus`

**File:** `src/shortcuts/ai-service/ai-process-manager.ts:225`

```
Before: status: 'running',
After:  status: options.initialStatus ?? 'running',
```

### 5. Update `AIProcessManager` status guards

Several methods check `status === 'running'` or `status !== 'running'`. Each needs review:

| Location | Current Check | Change Needed |
|----------|--------------|---------------|
| `loadFromStorage` (:103) | `status === 'running'` skip | Also skip `'queued'` — don't restore ephemeral states |
| `saveToStorage` (:137) | `status !== 'running'` keep | Also exclude `'queued'` — don't persist ephemeral states |
| `attachRawStdout` (:710) | `status !== 'running'` save | Also save if `'queued'` transitions — no change needed (queued won't have stdout) |
| `cancelProcess` (:843) | `status !== 'running'` bail | Allow cancelling `'queued'` processes too |
| `clearCompletedProcesses` (:917) | `status !== 'running'` remove | Also keep `'queued'` (they're active) |
| `clearAllProcesses` (:939) | `status === 'running'` kill child | No change — queued processes have no child process |
| `getRunningProcesses` (:984) | `status === 'running'` | No change — queued is a separate concept |
| `hasRunningProcesses` (:1026) | `status === 'running'` | No change — queued doesn't count as running |
| `getProcessCounts` (:1037) | `counts[process.status]++` | Works automatically once ProcessCounts has `queued` |

Summary of actual code changes needed:
- `:103` — add `|| process.status === 'queued'` to skip
- `:137` — change to `p.status !== 'running' && p.status !== 'queued'`
- `:843` — change to allow cancelling queued processes (skip child process kill)
- `:917` — change to `p.status !== 'running' && p.status !== 'queued'`

### 6. Update tree provider `getStatusIcon`

**File:** `src/shortcuts/ai-service/ai-process-tree-provider.ts:142`

Add `'queued'` case to each process-type switch block. Use a "clock" icon to distinguish from running (spinner):

```typescript
case 'queued':
    return new vscode.ThemeIcon('watch', new vscode.ThemeColor('charts.yellow'));
```

This needs to be added in 4 places (code-review-group, code-review, discovery, default).

### 7. Update tree provider sorting

**File:** `src/shortcuts/ai-service/ai-process-tree-provider.ts:603,637`

Queued processes should sort after running but before completed. Current sort: running first, then by time. Add queued as second tier:

```typescript
// Running first
if (a.status === 'running' && b.status !== 'running') return -1;
if (a.status !== 'running' && b.status === 'running') return 1;
// Queued second
if (a.status === 'queued' && b.status !== 'queued') return -1;
if (a.status !== 'queued' && b.status === 'queued') return 1;
```

### 8. Update tree provider status emoji

**File:** `src/shortcuts/ai-service/ai-process-tree-provider.ts:484`

```typescript
case 'queued': return '⏳';
```

### 9. Update `MockAIProcessManager`

**File:** `src/shortcuts/ai-service/mock-ai-process-manager.ts`

- Support `initialStatus` in `registerTypedProcess`
- Update status guards (same pattern as real manager at :528, :561, :611)
- Update `getProcessCounts` initialization to include `queued: 0`

### 10. Update `getProcessCounts` initialization

**File:** `src/shortcuts/ai-service/ai-process-manager.ts:1037`

```
Before: const counts: ProcessCounts = { running: 0, completed: 0, failed: 0, cancelled: 0 };
After:  const counts: ProcessCounts = { queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0 };
```

---

## What This Enables

After this refactoring, the queue implementation becomes:

1. `enqueue()` → calls `processManager.registerTypedProcess(prompt, { ...opts, initialStatus: 'queued' })`
2. `executeNext()` → calls `processManager.updateProcess(id, 'running')`, then runs the AI task
3. On completion → `processManager.completeProcess(id, result)` (unchanged)

No separate `QueuedTask` type, no separate storage, no separate event system. The existing `onDidChangeProcesses` event drives tree updates for queued→running→completed transitions automatically.

---

## Testing

- Existing tests should pass unchanged (default `initialStatus` is `'running'`)
- Add tests for: register with `initialStatus: 'queued'`, cancel queued process, `getProcessCounts` includes queued, persistence excludes queued
