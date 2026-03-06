# Fix `read_agent` Memory Capture in Tool Call Cache

## Problem

When the AI uses the native Copilot SDK `task` tool in **background mode** (`mode: "background"`), the tool returns immediately with a placeholder like:

> *"Agent started in background with agent_id: agent-2. You can use read_agent tool with this agent_id to check status and retrieve results."*

The AI then calls the native `read_agent` tool to retrieve the actual agent output. However, the **`ToolCallCapture`** system only captures tool calls matching `TASK_FILTER`, which is hardcoded to `toolName === 'task'`. The `read_agent` tool-complete event is silently discarded, meaning:

- The **placeholder** is stored as the `answer` in `explore-cache/raw/<timestamp>-task.json`
- The **actual agent result** (from `read_agent`) is never persisted
- Downstream memory aggregation consolidates garbage data

This affects both code paths that construct `ToolCallCapture`:
1. **Queue executor bridge** — `packages/coc/src/server/queue-executor-bridge.ts:981`
2. **AI invoker wrapper** — `packages/coc/src/ai-invoker.ts:144`

## Proposed Approach

Expand the `TASK_FILTER` to also match `read_agent`, add a `normalizeToolArgs` case for it, and update tests.

## Files to Change

| File | Change |
|------|--------|
| `packages/pipeline-core/src/memory/tool-call-cache-presets.ts` | Expand `TASK_FILTER` to match both `task` and `read_agent` |
| `packages/pipeline-core/src/memory/tool-call-capture.ts` | Add `case 'read_agent':` to `normalizeToolArgs` |
| `packages/pipeline-core/test/memory/tool-call-cache-presets.test.ts` | Add test that `TASK_FILTER` matches `read_agent` |
| `packages/pipeline-core/test/memory/tool-call-capture.test.ts` | Add `normalizeToolArgs` test for `read_agent`; add integration test for full capture flow |

## Todos

### 1. ~~Expand `TASK_FILTER` to include `read_agent`~~ ✅

**File:** `packages/pipeline-core/src/memory/tool-call-cache-presets.ts`

**Current (L16-21):**
```typescript
export const TASK_FILTER: ToolCallFilter = (
    toolName: string,
    _args: Record<string, unknown>,
): boolean => {
    return toolName === 'task';
};
```

**Proposed:**
```typescript
export const TASK_FILTER: ToolCallFilter = (
    toolName: string,
    _args: Record<string, unknown>,
): boolean => {
    return toolName === 'task' || toolName === 'read_agent';
};
```

**Why not `createToolNameFilter`?** The `TASK_FILTER` is exported as a named constant used in multiple places. Replacing it with a `createToolNameFilter` call changes the identity but not behavior — either approach works, but the inline change is smaller.

**Update JSDoc** (L12-14) to mention `read_agent`:
```typescript
/**
 * Matches task and read_agent tool invocations.
 * Read-only tools like grep, glob, view, etc. are intentionally excluded.
 */
```

### 2. ~~Add `read_agent` case to `normalizeToolArgs`~~ ✅

**File:** `packages/pipeline-core/src/memory/tool-call-capture.ts`

Insert between the `task` case (L97-102) and `web_search` case (L103):

```typescript
case 'read_agent': {
    const agentId = String(args.agent_id ?? '');
    const wait = args.wait ? ' (wait)' : '';
    return `Read agent result: ${agentId}${wait}`;
}
```

**Rationale:** The `read_agent` tool's primary args are `agent_id` (required), `wait` (boolean), and `timeout` (number). The `agent_id` is the most meaningful field for the question string.

### 3. ~~Add preset test for `read_agent`~~ ✅

**File:** `packages/pipeline-core/test/memory/tool-call-cache-presets.test.ts`

Inside the existing `describe('TASK_FILTER')` block, add:

```typescript
it('matches read_agent', () => {
    expect(TASK_FILTER('read_agent', {})).toBe(true);
});
```

### 4. ~~Add capture test for `read_agent` normalization~~ ✅

**File:** `packages/pipeline-core/test/memory/tool-call-capture.test.ts`

Inside the existing `describe('normalizeToolArgs')` block, add:

```typescript
it('normalizes read_agent args', () => {
    const capture = new ToolCallCapture(store, () => true);
    const result = capture.normalizeToolArgs('read_agent', {
        agent_id: 'agent-2',
        wait: true,
        timeout: 30,
    });
    expect(result).toBe('Read agent result: agent-2 (wait)');
});
```

### 5. ~~Add integration test: background task → read_agent capture~~ ✅

**File:** `packages/pipeline-core/test/memory/tool-call-capture.test.ts`

Add a new `describe` block:

```typescript
describe('background task + read_agent flow', () => {
    it('captures both task and read_agent tool-complete events', () => {
        const entries: ToolCallQAEntry[] = [];
        const mockStore = {
            writeRaw: vi.fn(async (entry: ToolCallQAEntry) => { entries.push(entry); }),
        } as unknown as FileToolCallCacheStore;

        const capture = new ToolCallCapture(mockStore, TASK_FILTER);
        const handler = capture.createToolEventHandler();

        // task tool-start
        handler({ type: 'tool-start', toolCallId: 'tc-1', toolName: 'task',
                  args: { prompt: 'Explore auth flow', agent_type: 'explore', mode: 'background' } });
        // task tool-complete (placeholder)
        handler({ type: 'tool-complete', toolCallId: 'tc-1', toolName: 'task',
                  result: 'Agent started in background with agent_id: agent-2' });

        // read_agent tool-start
        handler({ type: 'tool-start', toolCallId: 'tc-2', toolName: 'read_agent',
                  args: { agent_id: 'agent-2', wait: true } });
        // read_agent tool-complete (actual result)
        handler({ type: 'tool-complete', toolCallId: 'tc-2', toolName: 'read_agent',
                  result: 'The auth flow uses JWT tokens with refresh...' });

        expect(mockStore.writeRaw).toHaveBeenCalledTimes(2);
        expect(entries[0].toolName).toBe('task');
        expect(entries[0].answer).toBe('Agent started in background with agent_id: agent-2');
        expect(entries[1].toolName).toBe('read_agent');
        expect(entries[1].answer).toBe('The auth flow uses JWT tokens with refresh...');
    });
});
```

## Considerations

### No changes needed in consumers
Both `queue-executor-bridge.ts:981` and `ai-invoker.ts:144` reference `TASK_FILTER` by import — expanding it automatically propagates to both call sites.

### Aggregation quality
After this fix, the explore-cache will contain two entries per background task:
1. `task` entry with placeholder answer (low value)
2. `read_agent` entry with actual result (high value)

The `ToolCallCacheAggregator` consolidates via AI, which should naturally prefer the substantive `read_agent` answer. However, consider a follow-up to either:
- Skip writing the `task` entry when `args.mode === 'background'` (since the placeholder is useless)
- Or add a `parentToolCallId` linkage so aggregation can associate the `read_agent` result with the original `task` prompt

### `list_agents` tool
There's also a `list_agents` native SDK tool. It returns metadata (status, not results), so capturing it is low priority. Can be added later if needed.

### Naming: `TASK_FILTER` vs `AGENT_FILTER`
After adding `read_agent`, the name `TASK_FILTER` is slightly misleading. Renaming to `AGENT_TASK_FILTER` would be more accurate but requires updating all import sites. This is optional and cosmetic.
