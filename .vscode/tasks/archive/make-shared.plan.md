# Plan: Change Update Document to Shared Task Type

## Change

Add `'update-document'` to `SHARED_TASK_TYPES` in both the VS Code extension and coc-server
so that Update Document jobs run in the shared (concurrent) pool instead of the exclusive
(serialised) pool.

## Rationale

Update Document always operates on files inside `.vscode/tasks/` or `~/.copilot/session-state/`,
which are never git-tracked. It does not touch source code, so it does not need the exclusive
write lock that `follow-prompt` and `custom` tasks require.

## Files to Change

### 1. `src/shortcuts/ai-service/ai-queue-service.ts`

```diff
 export const SHARED_TASK_TYPES: ReadonlySet<string> = new Set([
     'task-generation',
     'ai-clarification',
     'code-review',
+    'update-document',
 ]);
```

### 2. `packages/coc/src/server/queue-executor-bridge.ts`

```diff
 const SHARED_TASK_TYPES: ReadonlySet<string> = new Set([
     'task-generation',
     'ai-clarification',
     'code-review',
     'resolve-comments',
+    'update-document',
 ]);
```

## Notes

- `isExclusive` in both files is derived from `SHARED_TASK_TYPES` — no other changes needed.
- The `handleUpdateDocument` path in `editor-message-router.ts` uses `startSession`
  (interactive terminal) and bypasses the queue entirely; it is unaffected by this change.
