# Plan: Fix Streaming Chat Word-per-Line Rendering

## Problem

In the AI Execution Dashboard chat, streaming LLM responses render each word/phrase on its own line instead of flowing as continuous paragraphs. The root cause: each SDK token delta (1-3 words) becomes a separate `TimelineItem`, rendered as an independent block-level `<div>`. The issue persists after page reload because the per-chunk timeline is persisted to disk unchanged.

## Approach: Two-Layer Fix

Fix at **both** the render layer (immediate, fixes all display) and the persistence layer (reduces disk bloat, cleans stored data).

### Why two layers?
- **Render layer alone** fixes display but leaves bloated per-token timelines on disk (hundreds of items per turn)
- **Persistence layer alone** fixes reload but not live streaming (browser builds its own timeline from SSE chunks)
- **Both together** give correct display everywhere and clean storage

---

## Task 1: Create `mergeConsecutiveContentItems()` utility

- [x] Done

**File:** `packages/coc/src/server/spa/client/react/processes/timeline-utils.ts` (new file)

Create a pure function that merges runs of consecutive `content` timeline items into single items, preserving tool events as boundaries:

```
Input:  [content:"Let "] [content:"me "] [tool-start:grep] [tool-complete:grep] [content:"Found "] [content:"it"]
Output: [content:"Let me "]              [tool-start:grep] [tool-complete:grep] [content:"Found it"]
```

**Rules:**
- Walk the array linearly
- While current and next items are both `type: 'content'`, concatenate `.content` strings, keep the **first** item's timestamp
- Any non-content item (tool-start, tool-complete, tool-failed) breaks the run and is emitted as-is
- Return a new array (no mutation)

**Types:** Takes `ClientTimelineItem[]`, returns `ClientTimelineItem[]`

**Dependency:** None

---

## Task 2: Create server-side `mergeConsecutiveContentItems()` utility

- [x] Done

**File:** `packages/pipeline-core/src/ai/timeline-utils.ts` (new file)

Same algorithm as Task 1, but operating on the server-side `TimelineItem` type (with `Date` timestamps instead of strings).

**Types:** Takes `TimelineItem[]`, returns `TimelineItem[]`

**Dependency:** None (parallel with Task 1)

---

## Task 3: Apply merge in `buildAssistantRender()` (render layer)

- [x] Done

**File:** `packages/coc/src/server/spa/client/react/processes/ConversationTurnBubble.tsx`

**Location:** Inside `buildAssistantRender()` (~line 235), before the timeline iteration loop.

**Change:** Merge the timeline before iterating:

```typescript
import { mergeConsecutiveContentItems } from './timeline-utils';

// Inside buildAssistantRender(), before the for loop:
const mergedTimeline = mergeConsecutiveContentItems(timeline);
for (let i = 0; i < mergedTimeline.length; i++) {
    const item = mergedTimeline[i];
    // ... existing logic unchanged
}
```

**What this fixes:**
- Live streaming display (browser accumulates per-chunk timeline, but rendering sees merged)
- Reload/snapshot display (persisted timeline rendered correctly)
- ProcessesQueue detail view (same component)

**Dependency:** Task 1

---

## Task 4: Apply merge in `flushConversationTurn()` (persistence layer)

- [x] Done

**File:** `packages/coc/src/server/queue-executor-bridge.ts`

**Location:** Line 927, inside `flushConversationTurn()`

**Change:**
```typescript
import { mergeConsecutiveContentItems } from '@anthropic/pipeline-core/ai/timeline-utils';

// Line 927: replace raw snapshot with merged version
const rawTimeline = this.timelineBuffers.get(processId) || [];
const timelineSnapshot = mergeConsecutiveContentItems([...rawTimeline]);
```

**What this fixes:**
- Reduces timeline item count on disk from hundreds to ~5-20 per turn
- Conversation snapshots sent on SSE reconnect carry clean data
- Persisted JSON files are significantly smaller

**What it does NOT affect:**
- Live SSE `emitProcessOutput()` — called before flush, still delivers per-token chunks for typing effect
- In-memory `timelineBuffers` — stays granular until next flush

**Dependency:** Task 2

---

## Task 5: Add tests for `mergeConsecutiveContentItems()`

- [x] Done

**Test file (client):** `packages/coc/test/spa/react/timeline-utils.test.ts` (new file)

Test cases:
1. Empty array → empty array
2. Single content item → unchanged
3. Multiple consecutive content items → merged into one, first timestamp kept
4. Content items separated by tool events → two content groups, tools preserved
5. Tool event at start/end → preserved correctly
6. Mixed: content → tool-start → tool-complete → content → content → merged correctly
7. Only tool events (no content) → unchanged
8. Content with empty/undefined `.content` → handled gracefully

**Test file (server):** `packages/pipeline-core/test/ai/timeline-utils.test.ts` (new file)

Same test cases adapted for server-side `TimelineItem` type (Date timestamps).

**Dependency:** Tasks 1, 2

---

## Task 6: Add integration test for merged rendering

- [x] Done

**File:** `packages/coc/test/spa/react/ConversationTurnBubble.test.tsx` (existing)

Add test case:
- Create a turn with timeline containing 10 consecutive content items
- Render `ConversationTurnBubble`
- Assert only 1 `<MarkdownView>` is rendered (not 10)
- Assert the merged content is correct

**Dependency:** Tasks 1, 3

---

## Task 7: Add test for persistence-layer merge

- [x] Done

**File:** `packages/coc/test/server/queue-executor-bridge.test.ts` (existing)

Add test case:
- Simulate streaming multiple chunks
- Trigger flush
- Verify the persisted timeline has merged consecutive content items
- Verify tool events are preserved as boundaries

**Dependency:** Tasks 2, 4

---

## Files Changed Summary

| File | Action | Task |
|------|--------|------|
| `packages/coc/src/server/spa/client/react/processes/timeline-utils.ts` | Create | 1 |
| `packages/pipeline-core/src/ai/timeline-utils.ts` | Create | 2 |
| `packages/coc/src/server/spa/client/react/processes/ConversationTurnBubble.tsx` | Edit (~2 lines) | 3 |
| `packages/coc/src/server/queue-executor-bridge.ts` | Edit (~2 lines) | 4 |
| `packages/coc/test/spa/react/timeline-utils.test.ts` | Create | 5 |
| `packages/pipeline-core/test/ai/timeline-utils.test.ts` | Create | 5 |
| `packages/coc/test/spa/react/ConversationTurnBubble.test.tsx` | Edit | 6 |
| `packages/coc/test/server/queue-executor-bridge.test.ts` | Edit | 7 |

## Dependency Graph

```
Task 1 (client util) ──┬──→ Task 3 (render layer) ──→ Task 6 (render test)
                        └──→ Task 5 (client util test)
Task 2 (server util) ──┬──→ Task 4 (persistence layer) ──→ Task 7 (persistence test)
                        └──→ Task 5 (server util test)
```

## Risks & Considerations

1. **Markdown spanning chunks**: Merging content strings helps here — `**bold**` split across `"**bol"` + `"d**"` will now be parsed as one string
2. **Key stability during streaming**: The merged render chunks will have different keys than before; React will re-render more during streaming, but this is negligible
3. **Backward compatibility**: Old persisted timelines (pre-fix) still render correctly — the render-layer merge handles them
4. **No SDK changes needed**: The SDK's token-level streaming is correct by design; we fix downstream
