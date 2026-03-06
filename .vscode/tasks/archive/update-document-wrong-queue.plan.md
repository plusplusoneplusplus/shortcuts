# Bug: Update Document Task Queued to Wrong Repository

## Problem

When a user clicks **Update Document** in the markdown review editor while viewing a file from **shortcuts2** (e.g. `D:\projects\shortcuts2`), the resulting task appears in the **shortcuts** repository's queue instead of shortcuts2's queue.

**Evidence from screenshot:**
- Task is visible in the *shortcuts* dashboard queue
- But `workingDirectory` in the payload is `D:\\projects\\shortcuts2`
- And `planFilePath` points to a file inside `D:/projects/shortcuts2/...`

---

## Root Cause

The bug is a **nesting mismatch** between what `UpdateDocumentDialog.tsx` sends and what the server's `resolveRootPath` reads.

### What `UpdateDocumentDialog.tsx` sends (wrong nesting)

```json
{
  "type": "custom",
  "payload": {
    "data": {
      "prompt": "...",
      "workingDirectory": "D:\\projects\\shortcuts2",   ← nested under payload.DATA
      "planFilePath": "D:/projects/shortcuts2/..."
    }
  }
}
```

### What `resolveRootPath` in `queue-handler.ts` expects

```typescript
async function resolveRootPath(payload: any): Promise<string | undefined> {
    if (typeof payload?.workingDirectory === 'string' ...) {
        return payload.workingDirectory;   // reads payload.workingDirectory  ← one level up
    }
    if (typeof payload?.workspaceId === 'string' ...) { ... }
    return undefined;   // ← always returns undefined for UpdateDocument tasks
}
```

`resolveRootPath` receives the `payload` object (`{ data: { workingDirectory: ... } }`), but reads `payload.workingDirectory` — which is `undefined` because it is nested one level deeper at `payload.data.workingDirectory`.

### Cascade failure

| Step | Expected | Actual |
|------|----------|--------|
| `resolveRootPath(payload)` | returns `"D:\\projects\\shortcuts2"` | returns `undefined` |
| `enqueueViaBridge` | routes to shortcuts2 queue | falls back to `process.cwd()` = shortcuts dir |
| `getQueueForRepo(rootPath)` | returns shortcuts2's `TaskQueueManager` | returns shortcuts's `TaskQueueManager` |

---

## Relevant Files

| File | Role |
|------|------|
| `packages/coc/src/server/spa/client/react/shared/UpdateDocumentDialog.tsx` | Builds & POSTs the task body — **where the bug is introduced** |
| `packages/coc/src/server/queue-handler.ts` | `resolveRootPath`, `enqueueViaBridge`, `validateAndParseTask` |
| `packages/coc/src/server/multi-repo-executor-bridge.ts` | Multi-workspace queue registry |

---

## Fix Options

### Option A — Hoist `workingDirectory` to `payload` level (minimal, targeted)

In `UpdateDocumentDialog.tsx`, add `workingDirectory` at the `payload` top level so `resolveRootPath` can find it:

```typescript
const body: any = {
    type: 'custom',
    priority: 'normal',
    displayName: `Update: ${taskName}`,
    payload: {
        workingDirectory,          // ← ADD THIS at payload level
        data: {
            prompt,
            workingDirectory,      // keep for executor to use
            planFilePath,
        },
    },
};
```

**Pros:** One-line change, no server-side changes needed, consistent with how `resolveRootPath` already works.  
**Cons:** `workingDirectory` is duplicated in two places within `payload`.

### Option B — Add `workspaceId` to `payload` level

```typescript
payload: {
    workspaceId: selectedWsId,    // ← ADD THIS
    data: { prompt, workingDirectory, planFilePath },
},
```

`resolveRootPath` already handles `payload.workspaceId` and will resolve `rootPath` via the store. This avoids duplication.

**Pros:** No path duplication; uses the existing `workspaceId` fallback path.  
**Cons:** Depends on the store having the correct workspace entry; slightly less direct than Option A.

### Option C — Fix `resolveRootPath` to check nested path (server-side)

```typescript
async function resolveRootPath(payload: any): Promise<string | undefined> {
    // existing checks...
    // Add fallback for custom task payloads:
    if (typeof payload?.data?.workingDirectory === 'string' && payload.data.workingDirectory.trim()) {
        return payload.data.workingDirectory.trim();
    }
    return undefined;
}
```

**Pros:** Fixes the server generically for any caller that nests `workingDirectory` under `data`.  
**Cons:** Makes `resolveRootPath` more permissive; might mask other caller bugs.

---

## Recommended Fix

**Option A** — hoist `workingDirectory` to `payload` level in `UpdateDocumentDialog.tsx`. It is the smallest targeted change, requires no server modification, and makes the intent explicit. Optionally combine with **Option B** (add `workspaceId`) so there are two routing signals.

---

## Tasks

1. Read current `UpdateDocumentDialog.tsx` to confirm exact lines
2. Add `workingDirectory` (and optionally `workspaceId: selectedWsId`) at `payload` top level
3. Verify the fix by checking `resolveRootPath` logic handles the new field correctly
4. Build and run relevant tests
