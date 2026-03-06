---
status: done
commit: "002"
title: "Smart-append consecutive content items in browser chunk handler"
depends_on: ["001"]
files:
  - packages/coc/src/server/spa/client/react/queue/QueueTaskDetail.tsx
  - packages/coc/test/spa/react/QueueTaskDetail.test.ts
---

# 002 — Smart-append consecutive content items in browser chunk handler

## Summary

Modify the SSE `chunk` event handler in `QueueTaskDetail.tsx` to merge consecutive
`type: 'content'` timeline items instead of always appending a new entry. This mirrors
the server-side fix from commit 001 and eliminates the one-word-per-line rendering
artifact during live streaming.

## Motivation

During live streaming the browser builds its own timeline from SSE chunk events
(independent of the server-side timeline). Line 385 of `QueueTaskDetail.tsx`
unconditionally spreads a new `{ type: 'content' }` item for every chunk:

```typescript
// QueueTaskDetail.tsx:385 — current (broken)
timeline: [...(last.timeline || []), { type: 'content' as const, timestamp: new Date().toISOString(), content: chunk }],
```

Each chunk becomes a separate `<div>` in the rendered timeline, so every token
appears on its own line. Commit 001 fixed the equivalent logic on the server side
in `appendTimelineItem()`; this commit applies the same merge pattern to the
browser-side handler.

## Prior State (after commit 001)

- Server-side `appendTimelineItem()` already merges consecutive content items.
- Browser chunk handler at line 385 still always pushes a new timeline entry.

## Implementation

### 1. Modify SSE chunk handler — `QueueTaskDetail.tsx`

**File:** `packages/coc/src/server/spa/client/react/queue/QueueTaskDetail.tsx`
**Lines:** 378–388 (the `setTurnsAndCache` callback inside the `chunk` listener)

Replace the current timeline spread on **line 385**:

```typescript
// BEFORE (line 385)
timeline: [...(last.timeline || []), { type: 'content' as const, timestamp: new Date().toISOString(), content: chunk }],
```

With a smart-append that checks the last timeline item:

```typescript
// AFTER
timeline: (() => {
    const prev = last.timeline || [];
    const lastItem = prev[prev.length - 1];
    if (lastItem && lastItem.type === 'content') {
        return [...prev.slice(0, -1), { ...lastItem, content: (lastItem.content || '') + chunk }];
    }
    return [...prev, { type: 'content' as const, timestamp: new Date().toISOString(), content: chunk }];
})(),
```

**What stays unchanged:**
- `content` accumulation on line 383 (`(last.content || '') + chunk`) — this is the
  full concatenated assistant message and is already correct.
- `ensureAssistantTurn` (lines 359–363) — no changes.
- `handleToolSSE` (lines 392–415) — tool events always push a new timeline item
  with their own `type`, which naturally breaks the content merge chain.

### 2. Add tests — `QueueTaskDetail.test.ts`

**File:** `packages/coc/test/spa/react/QueueTaskDetail.test.ts`
**Location:** Inside the top-level `describe('QueueTaskDetail', ...)` block, after
the existing `describe('no-session follow-up guard', ...)` block (after line 128).

Add a new `describe('SSE chunk timeline merging', ...)` block with source-inspection
tests (matching the existing test pattern of reading the source file as a string):

#### Test A — consecutive content chunks merge

Verify that the chunk handler contains the smart-append IIFE pattern:

```typescript
it('merges consecutive content chunks into a single timeline item', () => {
    const chunkHandler = source.substring(
        source.indexOf("es.addEventListener('chunk'"),
        source.indexOf("es.addEventListener('tool-start'"),
    );
    // Should check last timeline item type before appending
    expect(chunkHandler).toContain("lastItem.type === 'content'");
    // Should merge content by concatenation
    expect(chunkHandler).toContain("(lastItem.content || '') + chunk");
    // Should slice off the last item when merging
    expect(chunkHandler).toContain('prev.slice(0, -1)');
});
```

#### Test B — new item when timeline is empty or last item is non-content

Verify the fallback path still creates a new timeline entry:

```typescript
it('creates a new timeline item when last item is not content', () => {
    const chunkHandler = source.substring(
        source.indexOf("es.addEventListener('chunk'"),
        source.indexOf("es.addEventListener('tool-start'"),
    );
    // Fallback: push new content item (for empty timeline or after tool events)
    expect(chunkHandler).toContain("type: 'content' as const");
    expect(chunkHandler).toContain('timestamp: new Date().toISOString()');
});
```

#### Test C — tool events are unaffected (boundary check)

Verify tool events still always push (they are the natural merge boundary):

```typescript
it('tool events always push a new timeline item (merge boundary)', () => {
    const toolHandler = source.substring(
        source.indexOf('const handleToolSSE'),
        source.indexOf("es.addEventListener('tool-start'"),
    );
    // Tool handler spreads unconditionally
    expect(toolHandler).toContain('...( last.timeline || [])');
    expect(toolHandler).toContain('type: eventType');
});
```

## Acceptance Criteria

- [ ] Browser-side SSE chunk handler merges consecutive `type: 'content'` timeline
      items (concatenates `content`, keeps first item's `timestamp`).
- [ ] A tool event (`tool-start`, `tool-complete`, `tool-failed`) breaks the merge
      chain — the next content chunk starts a new timeline item.
- [ ] The top-level `content` field (line 383) still accumulates the full message
      per-token (typing effect preserved).
- [ ] All new tests pass: `npm run test` succeeds.
- [ ] No changes to `ensureAssistantTurn` or `handleToolSSE`.

## Commit Message

```
fix(dashboard): smart-append consecutive content in browser chunk handler

The SSE chunk handler in QueueTaskDetail.tsx unconditionally pushed a new
timeline entry for every streaming chunk, rendering each word on its own
line. Mirror the server-side fix (001): check if the last timeline item
is type:'content' and merge by concatenation, otherwise push a new item.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```
