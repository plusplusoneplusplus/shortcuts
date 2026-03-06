---
status: pending
---

# 001: Add tool grouping types, classification, and algorithm

## Summary
Introduces the foundational types, category map, and pure grouping algorithm that will let the SPA collapse runs of same-category sibling tool chunks into a single compact `tool-group` row. This commit is data-only — no React rendering yet.

## Motivation
This is the first commit in the `coc-compact-tools` feature. All subsequent rendering commits (GroupChunk badge, collapsed row component, expand/collapse wiring) depend on the stable types and algorithm introduced here. Keeping it separate ensures each follow-on commit has a narrow, testable diff.

## Changes

### Files to Create
- `packages/coc/src/server/spa/client/react/processes/toolGroupUtils.ts` — category types, constants, classification helpers, and the `groupConsecutiveToolChunks` algorithm
- `packages/coc/test/spa/processes/toolGroupUtils.test.ts` — Vitest unit tests (needs `test/spa/processes/` directory)

### Files to Modify
- `packages/coc/src/server/spa/client/react/processes/ConversationTurnBubble.tsx` — extend the `RenderChunk` union type with the `tool-group` variant; no logic changes yet

### Files to Delete
(none)

---

## Implementation Notes

### 1. Category type and map

```ts
// toolGroupUtils.ts

export type ToolGroupCategory = 'read' | 'write' | 'shell';

/**
 * Maps each known tool name to its grouping category.
 * Tools not listed here return null from getToolGroupCategory and are never grouped.
 */
export const CATEGORY_MAP: Record<string, ToolGroupCategory> = {
    view:       'read',
    glob:       'read',
    grep:       'read',
    edit:       'write',
    create:     'write',
    powershell: 'shell',
    shell:      'shell',
};
```

### 2. Category classifier

```ts
export function getToolGroupCategory(toolName: string): ToolGroupCategory | null {
    return CATEGORY_MAP[toolName] ?? null;
}
```

### 3. Category icons

Match the emoji patterns used in `ToolCallView.tsx` (status indicators use emoji; file paths show 📁):

```ts
export const CATEGORY_ICONS: Record<ToolGroupCategory, string> = {
    read:  '📖',
    write: '✏️',
    shell: '🖥️',
};
```

### 4. getCategoryLabel

Produces a human-readable summary string, e.g. `"4 read operations (glob×1, view×3)"`.

```ts
/**
 * @param category  - the group category
 * @param counts    - map of toolName → occurrence count within the group
 */
export function getCategoryLabel(
    category: ToolGroupCategory,
    counts: Record<string, number>
): string {
    const total = Object.values(counts).reduce((s, n) => s + n, 0);
    const detail = Object.entries(counts)
        .sort(([a], [b]) => a.localeCompare(b))       // stable alphabetical order
        .map(([name, n]) => `${name}×${n}`)
        .join(', ');
    const noun = category === 'shell' ? 'shell operations' : `${category} operations`;
    return detail ? `${total} ${noun} (${detail})` : `${total} ${noun}`;
}
```

### 5. RenderChunk extension in ConversationTurnBubble.tsx

The current `RenderChunk` (lines 61-67) is a plain interface:

```ts
interface RenderChunk {
    kind: 'content' | 'tool';
    key: string;
    html?: string;
    toolId?: string;
    parentToolId?: string;
}
```

Extend it to a discriminated union by adding the `tool-group` variant. The existing fields become optional members of the other variants rather than the group variant:

```ts
type RenderChunk =
    | { kind: 'content';    key: string; html?: string; toolId?: string; parentToolId?: string }
    | { kind: 'tool';       key: string; html?: string; toolId?: string; parentToolId?: string }
    | {
        kind:         'tool-group';
        key:          string;
        category:     ToolGroupCategory;
        /** Ordered list of RenderToolCall IDs that are collapsed into this group. */
        toolIds:      string[];
        /** Epoch ms of the earliest startTime among grouped tools (undefined if none have timing). */
        startTime?:   number;
        /** Epoch ms of the latest endTime among grouped tools (undefined if any are still running). */
        endTime?:     number;
        /** true only when every tool in the group has status === 'completed'. */
        allSucceeded: boolean;
        parentToolId?: string;
      };
```

**Surgical change:** Replace the `interface RenderChunk` block (lines 61-67) with the union `type RenderChunk`. Import `ToolGroupCategory` from `./toolGroupUtils`. The rest of `ConversationTurnBubble.tsx` is untouched — type narrowing on `chunk.kind` will still work because `'content'` and `'tool'` variants are preserved.

### 6. groupConsecutiveToolChunks algorithm

This is a pure function — takes the flat chunk array and the tool lookup map; returns a new array where eligible runs are collapsed.

**Grouping rules:**
- Only `kind === 'tool'` chunks are candidates for grouping.
- A tool chunk is eligible if: its `toolId` resolves in `toolById`, the resolved tool's `toolName` maps to a non-null category via `getToolGroupCategory`, and the tool's ID is **not** in `parentToolIds` (i.e. it has no children/subtools — grouping a parent would hide nested sub-calls).
- Two adjacent eligible chunks belong to the same run if they share the same category **and** the same `parentToolId` (sibling constraint — do not group across task boundaries).
- A run must have **length ≥ 2** to become a group; a run of 1 is emitted as-is.

**Pseudocode:**

```
function groupConsecutiveToolChunks(chunks, toolById, parentToolIds):
    result = []
    i = 0
    while i < chunks.length:
        chunk = chunks[i]

        // Only consider plain tool chunks for grouping
        if chunk.kind !== 'tool' or not chunk.toolId:
            result.push(chunk)
            i++
            continue

        tool = toolById.get(chunk.toolId)
        if not tool or parentToolIds.has(chunk.toolId):
            result.push(chunk)
            i++
            continue

        category = getToolGroupCategory(tool.toolName)
        if not category:
            result.push(chunk)
            i++
            continue

        // Start a run
        run = [chunk]
        j = i + 1
        while j < chunks.length:
            next = chunks[j]
            if next.kind !== 'tool' or not next.toolId:
                break
            nextTool = toolById.get(next.toolId)
            if not nextTool or parentToolIds.has(next.toolId):
                break
            nextCat = getToolGroupCategory(nextTool.toolName)
            if nextCat !== category:
                break
            // Same parent check (sibling constraint)
            if next.parentToolId !== chunk.parentToolId:
                break
            run.push(next)
            j++

        if run.length < 2:
            result.push(chunk)
            i++
            continue

        // Build group chunk
        toolIds = run.map(c => c.toolId)
        tools   = toolIds.map(id => toolById.get(id))

        startTimes = tools.flatMap(t => t.startTime ? [parseMs(t.startTime)] : [])
        endTimes   = tools.flatMap(t => t.endTime   ? [parseMs(t.endTime)]   : [])
        allEnded   = tools.every(t => t.endTime)

        result.push({
            kind:         'tool-group',
            key:          `group-${run[0].key}`,
            category,
            toolIds,
            startTime:    startTimes.length ? Math.min(...startTimes)  : undefined,
            endTime:      allEnded && endTimes.length ? Math.max(...endTimes) : undefined,
            allSucceeded: tools.every(t => t.status === 'completed'),
            parentToolId: chunk.parentToolId,
        })
        i = j

    return result
```

**Where `parseMs` is:**
```ts
function parseMs(iso: string): number {
    return new Date(iso).getTime();
}
```

---

## Tests

Test file location: `packages/coc/test/spa/processes/toolGroupUtils.test.ts`
(matches `vitest.config.ts` `include` glob `test/**/*.test.ts`; since it lives under `test/spa/` it will run in `jsdom` environment per the `environmentMatchGlobs` rule — that's fine for pure utility tests.)

Test cases:

### `getToolGroupCategory`
- Returns `'read'` for `'view'`, `'glob'`, `'grep'`
- Returns `'write'` for `'edit'`, `'create'`
- Returns `'shell'` for `'powershell'`, `'shell'`
- Returns `null` for `'task'`, `'skill'`, `'unknown'`, empty string

### `getCategoryLabel`
- Single tool type: `getCategoryLabel('read', { view: 3 })` → `"3 read operations (view×3)"`
- Mixed tools, stable sort: `getCategoryLabel('read', { view: 3, glob: 1 })` → `"4 read operations (glob×1, view×3)"`
- Shell category: `getCategoryLabel('shell', { powershell: 2 })` → `"2 shell operations (powershell×2)"`
- Empty counts: `getCategoryLabel('write', {})` → `"0 write operations"`

### `groupConsecutiveToolChunks — no grouping`
- Empty array → `[]`
- Single tool chunk → unchanged
- Two tool chunks of different categories (e.g. `view` then `edit`) → both unchanged
- Two `read` chunks where one tool has children (in `parentToolIds`) → no group formed
- Two `read` chunks where tool name is unmapped (e.g. `task`) → no group formed
- Two `read` chunks with different `parentToolId` (cross-task-boundary) → no group formed

### `groupConsecutiveToolChunks — grouping`
- Two consecutive `view` chunks → collapsed to one `tool-group` chunk with `category: 'read'`, `toolIds` length 2
- Three consecutive `glob` chunks → collapsed to one group with `toolIds` length 3
- Mixed run: `view, view, edit, edit` → two separate groups (`read` group of 2, then `write` group of 2)
- Group interleaved with content chunk: `view, content, view` → two separate view chunks (content breaks the run)
- Group with timing: group's `startTime` = min of tool startTimes, `endTime` = max of tool endTimes when all have ended
- Group `allSucceeded`: true only when every tool in group has `status === 'completed'`; false if any has `'failed'` or `'running'`
- Verify `key` on resulting group chunk starts with `"group-"`
- Verify original non-grouped chunks before/after a group are preserved

---

## Acceptance Criteria
- [ ] `toolGroupUtils.ts` exports `ToolGroupCategory`, `CATEGORY_MAP`, `CATEGORY_ICONS`, `getToolGroupCategory`, `getCategoryLabel`, `groupConsecutiveToolChunks`
- [ ] `RenderChunk` in `ConversationTurnBubble.tsx` is a discriminated union type with `'tool-group'` variant including all specified fields
- [ ] TypeScript compilation succeeds (`npm run build` or `tsc --noEmit`)
- [ ] All unit tests in `toolGroupUtils.test.ts` pass (`npm run test:run` in `packages/coc/`)
- [ ] No regressions in existing renders — the `'content'` and `'tool'` variants of `RenderChunk` still satisfy all existing usages in `ConversationTurnBubble.tsx` and `ProcessDetail.tsx`

## Dependencies
- Depends on: None (first commit)

## Assumed Prior State
None — this is the first commit. The only assumption is that `ConversationTurnBubble.tsx` exists with the `RenderChunk` interface and `RenderToolCall` interface as they appear in the current codebase (lines 48-67), and that `vitest.config.ts` is already configured with `environmentMatchGlobs` mapping `test/spa/**` to `jsdom`.
