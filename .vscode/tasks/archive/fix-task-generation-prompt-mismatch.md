---
status: pending
---

# Fix: Task-Generation Prompt Mismatch Between Queue UI and Copilot

## Problem

When "Generate Task with AI" runs, two different prompts exist:

1. **Queue UI prompt** — the raw user text (e.g., "can you allow click/double-click on the image..."), stored via `extractPrompt()` in `ProcessStore` at task start
2. **Actual AI prompt** — enriched by `buildDeepModePrompt()` / `buildCreateFromFeaturePrompt()`, includes feature context, output path directives, and `"Use go-deep skill when available"` prefix. This is what Copilot actually receives.

The user sees prompt (1) in the queue but Copilot executes prompt (2). The enriched prompt is never written back to the process store.

### Root Cause

In `queue-executor-bridge.ts`:
- `executeTask()` (line 138) calls `extractPrompt()` which returns `task.payload.prompt` (raw text) and stores it in the `AIProcess`
- `executeTaskGeneration()` (line 673) builds a new `aiPrompt` via prompt builders and passes it to `executeWithAI(task, aiPrompt)`
- The `AIProcess` created in step 1 still has the raw prompt — it's never updated with the enriched one

### Secondary Issue

The dialog hardcodes `depth: 'deep'` (line 119 in `GenerateTaskDialog.tsx`) with no UI toggle, so go-deep is always triggered.

## Approach

Two surgical fixes in `queue-executor-bridge.ts`:

1. **Update the process store with the actual prompt** after `executeTaskGeneration` builds it
2. **Add a depth toggle** to `GenerateTaskDialog.tsx` so users can opt out of deep mode

## Tasks

### Task 1: Store the actual AI prompt in the process store

**File:** `packages/coc/src/server/queue-executor-bridge.ts`

In `executeTaskGeneration()`, after building `aiPrompt` and before calling `executeWithAI()`:
- Update the process store entry (`queue_${task.id}`) with the enriched prompt
- Update both `fullPrompt` and the initial conversation turn content

Concrete change (around line 700):
```typescript
private async executeTaskGeneration(task: QueuedTask): Promise<unknown> {
    const payload = task.payload as TaskGenerationPayload;
    // ... existing prompt building logic ...

    // Update process store with the actual enriched prompt
    const processId = `queue_${task.id}`;
    this.store.updateProcess(processId, {
        fullPrompt: aiPrompt,
    });
    // Also update the initial user turn to show the real prompt
    const existing = this.store.getProcess(processId);
    if (existing?.conversationTurns?.[0]) {
        existing.conversationTurns[0].content = aiPrompt;
        this.store.updateProcess(processId, {
            conversationTurns: existing.conversationTurns,
        });
    }

    return this.executeWithAI(task, aiPrompt);
}
```

**Verify:** Check `ProcessStore` interface to confirm `updateProcess` supports partial updates to `fullPrompt` and `conversationTurns`. Check if `getProcess` is synchronous or async.

### Task 2: Add depth toggle to GenerateTaskDialog

**File:** `packages/coc/src/server/spa/client/react/tasks/GenerateTaskDialog.tsx`

- Add a `depth` state variable defaulting to `'deep'`
- Add a select/toggle control between "Deep (uses go-deep skill)" and "Normal"
- Pass `depth` to `enqueue()` instead of hardcoded `'deep'`

```tsx
const [depth, setDepth] = useState<'deep' | 'normal'>('deep');

// In handleGenerate:
enqueue({
    ...
    depth,  // was: depth: 'deep'
});

// In JSX, add a toggle near the Priority selector:
<div className="flex flex-col gap-1">
    <label className="text-xs text-[#616161] dark:text-[#999]">
        Depth <span className="text-[#848484]">(optional)</span>
    </label>
    <select value={depth} onChange={e => setDepth(e.target.value as 'deep' | 'normal')}>
        <option value="deep">Deep (uses go-deep skill)</option>
        <option value="normal">Normal</option>
    </select>
</div>
```

## Acceptance Criteria

- [ ] Queue UI shows the enriched prompt (with feature context, output path, go-deep prefix) — not the raw user text
- [ ] The initial conversation turn in the process detail view reflects the actual prompt sent to Copilot
- [ ] GenerateTaskDialog has a Depth selector defaulting to "Deep"
- [ ] Selecting "Normal" depth does NOT prepend "Use go-deep skill" to the prompt
- [ ] Existing tests pass (`npm run test` in `packages/coc/`)
