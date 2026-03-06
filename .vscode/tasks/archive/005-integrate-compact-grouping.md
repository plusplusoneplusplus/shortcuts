---
status: pending
---

# 005: Wire compact tool grouping into ConversationTurnBubble

## Summary

This is the activation commit that wires the compact tool-grouping infrastructure
(built in commits 001–004) into the live render path inside `ConversationTurnBubble`.
When `toolCompactness >= 1` the flat `assistantRender.chunks` array is replaced (via
`useMemo`) by a grouped version produced by `groupConsecutiveToolChunks`.  A new
branch in the top-level chunk render loop handles `chunk.kind === 'tool-group'` by
delegating to `<ToolCallGroupView>`.  Additional CSS in `tailwind.css` handles the
Minimal (compactness === 2) collapsed header animation.

## Motivation

Without this commit the two previously wired pieces — the grouping utility
(`toolGroupUtils.ts`, commit 001) and the view component (`ToolCallGroupView.tsx`,
commit 004) — are completely unused.  This commit is the only place that queries
the user's `toolCompactness` preference (commit 002) and conditionally activates
grouped rendering.

## Changes

### Files to Create
*(none)*

### Files to Modify

#### 1. `packages/coc/src/server/spa/client/react/processes/ConversationTurnBubble.tsx`

**a) Add `useMemo` to the React import (line 4)**

```diff
-import React, { useState } from 'react';
+import React, { useState, useMemo } from 'react';
```

**b) Add two new imports after the existing local imports (after line 14)**

Current state (lines 7–15):
```typescript
import { MarkdownView } from './MarkdownView';
import { ToolCallView } from './ToolCallView';
import { mergeConsecutiveContentItems } from './timeline-utils';
import { Marked } from 'marked';
import { useDisplaySettings } from '../hooks/useDisplaySettings';
import { fetchApi } from '../hooks/useApi';
import { copyToClipboard } from '../utils/format';
import { linkifyFilePaths } from '../shared/file-path-utils';
import { toForwardSlashes } from '@plusplusoneplusplus/pipeline-core/utils/path-utils';
```

After change:
```diff
 import { MarkdownView } from './MarkdownView';
 import { ToolCallView } from './ToolCallView';
 import { mergeConsecutiveContentItems } from './timeline-utils';
 import { Marked } from 'marked';
 import { useDisplaySettings } from '../hooks/useDisplaySettings';
 import { fetchApi } from '../hooks/useApi';
 import { copyToClipboard } from '../utils/format';
 import { linkifyFilePaths } from '../shared/file-path-utils';
 import { toForwardSlashes } from '@plusplusoneplusplus/pipeline-core/utils/path-utils';
+import { groupConsecutiveToolChunks } from './toolGroupUtils';
+import { ToolCallGroupView } from './ToolCallGroupView';
```

**c) Destructure `toolCompactness` from `useDisplaySettings` (line 496)**

Current (line 496):
```typescript
    const { showReportIntent } = useDisplaySettings();
```

After change:
```diff
-    const { showReportIntent } = useDisplaySettings();
+    const { showReportIntent, toolCompactness } = useDisplaySettings();
```

**d) Add `useMemo` to compute grouped chunks (insert after line 496, before the image-loading state)**

Insert after the `useDisplaySettings` line:

```typescript
    const displayChunks = useMemo(() => {
        if (!assistantRender) return [];
        if (toolCompactness < 1) return assistantRender.chunks;
        return groupConsecutiveToolChunks(
            assistantRender.chunks,
            new Set(assistantRender.toolParentById.keys()),
        );
    }, [assistantRender, toolCompactness]);
```

> **Why these deps?**  `assistantRender` is rebuilt whenever `turn` changes (it is
> computed at the top of the component from `turn`).  `toolCompactness` controls
> whether grouping is active.  `assistantRender.toolParentById` and
> `assistantRender.toolById` are already included transitively through
> `assistantRender`.

**e) Replace `assistantRender.chunks` with `displayChunks` in the top-level render loop (line 700)**

Current (lines 689–718, the outer IIFE):
```typescript
                    {!isUser && !showRaw && assistantRender && (() => {
                        const nodes: React.ReactNode[] = [];
                        let accHtml = '';
                        let accKey = '';
                        const flushContent = () => {
                            if (accKey && accHtml) {
                                nodes.push(<MarkdownView key={accKey} html={accHtml} />);
                                accHtml = '';
                                accKey = '';
                            }
                        };
                        for (const chunk of assistantRender.chunks) {
                            if (chunk.kind === 'content' && chunk.html) {
                                // Content emitted while a sub-task is active should render under that task.
                                if (chunk.parentToolId && assistantRender.toolById.has(chunk.parentToolId)) continue;
                                if (!accKey) accKey = chunk.key;
                                accHtml += chunk.html;
                            } else if (chunk.kind === 'tool' && chunk.toolId) {
                                // Skip children — they are rendered inside their parent's .tool-call-children
                                if (assistantRender.toolParentById.has(chunk.toolId)) continue;
                                const toolNode = renderToolTree(chunk.toolId, 0);
                                if (toolNode !== null) {
                                    flushContent();
                                    nodes.push(toolNode);
                                }
                            }
                        }
                        flushContent();
                        return nodes;
                    })()}
```

After change — three edits:
1. Change the loop source from `assistantRender.chunks` → `displayChunks`.
2. Add a new `else if` branch before the closing brace of the loop for `'tool-group'` chunks.

```diff
-                        for (const chunk of assistantRender.chunks) {
+                        for (const chunk of displayChunks) {
                             if (chunk.kind === 'content' && chunk.html) {
                                 // Content emitted while a sub-task is active should render under that task.
                                 if (chunk.parentToolId && assistantRender.toolById.has(chunk.parentToolId)) continue;
                                 if (!accKey) accKey = chunk.key;
                                 accHtml += chunk.html;
                             } else if (chunk.kind === 'tool' && chunk.toolId) {
                                 // Skip children — they are rendered inside their parent's .tool-call-children
                                 if (assistantRender.toolParentById.has(chunk.toolId)) continue;
                                 const toolNode = renderToolTree(chunk.toolId, 0);
                                 if (toolNode !== null) {
                                     flushContent();
                                     nodes.push(toolNode);
                                 }
+                            } else if (chunk.kind === 'tool-group' && chunk.toolIds) {
+                                flushContent();
+                                nodes.push(
+                                    <ToolCallGroupView
+                                        key={chunk.key}
+                                        chunk={chunk}
+                                        toolById={assistantRender.toolById}
+                                        isStreaming={!!turn.streaming}
+                                        compactness={toolCompactness}
+                                        renderToolTree={renderToolTree}
+                                    />
+                                );
                             }
                         }
```

**Streaming detection note:** `turn.streaming` is the existing boolean already used at
line 595 (`turn.streaming && 'streaming'`).  Pass it as `!!turn.streaming` to
ensure a proper boolean.

**`renderToolTree` reference note:** The function is declared as a regular
`function` expression (lines 517–589) inside the component body, so it is in
scope at the point where `<ToolCallGroupView>` is rendered.  No hoisting issues.

**`useMemo` guard note:** `displayChunks` defaults to `[]` when `assistantRender`
is `null` (user turn).  The outer condition `!isUser && !showRaw && assistantRender`
already guards the IIFE, so `displayChunks` will always be the grouped array when
the loop actually executes.

---

#### 2. `packages/coc/src/server/spa/client/tailwind.css`

**Add Minimal-mode CSS after the existing `.tool-call-children.subtree-collapsed` rule (after line 18)**

Current (lines 15–18):
```css
/* Subtree collapse: hide nested tool-call children when parent is collapsed */
.tool-call-children.subtree-collapsed {
    display: none;
}
```

After change — append the new rules immediately below:

```diff
 /* Subtree collapse: hide nested tool-call children when parent is collapsed */
 .tool-call-children.subtree-collapsed {
     display: none;
 }
+
+/* Compact tool group header — Minimal mode (compactness === 2) */
+.tool-group-header--minimal {
+    max-height: 1.5rem;
+    overflow: hidden;
+    transition: max-height 0.2s ease;
+}
+
+.tool-group-header--minimal:hover,
+.tool-group-header--minimal:focus-within {
+    max-height: 8rem;
+}
+
+.dark .tool-group-header--minimal {
+    /* inherits same geometry; dark palette is handled by Tailwind utility classes
+       on the element itself inside ToolCallGroupView */
+}
```

### Files to Delete
*(none)*

## Implementation Notes

### `displayChunks` placement
`displayChunks` must be declared **after** `assistantRender` (line 491) and
**after** `toolCompactness` is extracted (line 496).  It must be declared **before**
the `renderToolTree` function and the returned JSX.  The recommended insertion point
is immediately after the `useDisplaySettings` destructure, before the image-loading
state hooks (lines 499–500).

### `groupConsecutiveToolChunks` contract (from commit 001)
```typescript
function groupConsecutiveToolChunks(
    chunks: RenderChunk[],
    parentToolIds: Set<string>,
): RenderChunk[]
```
- Returns a new array where consecutive top-level `'tool'` chunks (i.e. those whose
  `toolId` is **not** in `parentToolIds`) are collapsed into a single `'tool-group'`
  chunk.
- Non-tool chunks and parent-tool chunks are passed through unchanged.
- When there are zero or one consecutive tool-only chunks the group is still created
  (single-item group) so that `ToolCallGroupView` can render a uniform header.
- The returned `RenderChunk` for a group has `kind: 'tool-group'` and a `toolIds`
  field (`string[]`).

### Why `parentToolIds` filters which tools to group
Only _leaf_ tool calls (those that are not themselves parents of other tool calls)
should be aggregated into a compact group row.  Parent tool calls (`task`, etc.) keep
their individual expanded `ToolCallView` rendering so the hierarchy is preserved.

### `ToolCallGroupView` prop surface (from commit 004)
```typescript
interface ToolCallGroupViewProps {
    chunk: RenderChunk;            // kind === 'tool-group', toolIds: string[]
    toolById: Map<string, RenderToolCall>;
    isStreaming: boolean;
    compactness: 0 | 1 | 2;
    renderToolTree: (toolId: string, depth: number) => React.ReactNode;
}
```

### CSS Minimal-mode behaviour
`toolCompactness === 2` → Minimal.  `ToolCallGroupView` applies the CSS class
`tool-group-header--minimal` on its header element.  The `max-height` animation
lets the header expand on hover so users can read tool names without permanently
expanding the group.  The `:focus-within` selector ensures keyboard accessibility
(tabbing into the header also reveals the content).

## Tests

### Existing tests to verify remain green
- All tests in `packages/coc/src/server/spa/client/**/__tests__/ConversationTurnBubble.test.tsx`
  (or equivalent) should continue to pass because when `toolCompactness === 0`
  (the default returned by the current `useDisplaySettings` mock), `displayChunks`
  is identical to `assistantRender.chunks` — no behavioural change.

### New test cases to add to the ConversationTurnBubble test suite

| Test | Description |
|------|-------------|
| `renders tool-group chunk when toolCompactness >= 1` | Mock `useDisplaySettings` to return `toolCompactness: 1`. Build a turn with 3 consecutive leaf tool calls. Assert that a `ToolCallGroupView` is rendered (by data-testid or component type), and that individual `ToolCallView` nodes for those 3 calls are **not** rendered at top level. |
| `passes isStreaming correctly` | Set `turn.streaming = true`, assert `ToolCallGroupView` receives `isStreaming={true}`. |
| `does not group when toolCompactness === 0` | Default setting. Assert individual `ToolCallView` elements appear at top level (no `ToolCallGroupView`). |
| `does not group parent tool calls` | Turn has a `task` tool call that contains children. Assert the `task` call renders as its own `ToolCallView` (not absorbed into a group). |
| `Minimal mode applies css class` | `toolCompactness: 2` + snapshot/class assertion on `.tool-group-header--minimal`. |

## Acceptance Criteria

1. **Grouped mode (compactness 1 or 2):** Consecutive leaf tool calls in an assistant
   turn are visually grouped under a single collapsible header.  The individual tool
   details are accessible by expanding the group.
2. **Flat mode (compactness 0):** Rendering is byte-for-byte identical to the
   pre-005 behaviour.  No regressions.
3. **Streaming turns:** `isStreaming={true}` is correctly forwarded to
   `ToolCallGroupView` when `turn.streaming` is truthy.
4. **Parent (task) tool calls:** Still render as independent `ToolCallView` trees
   with their children nested inside, regardless of compactness setting.
5. **Minimal CSS:** Header elements with `.tool-group-header--minimal` collapse to
   `1.5rem` height and smoothly expand on hover/focus.
6. **TypeScript:** No new type errors.  `chunk.kind === 'tool-group'` and
   `chunk.toolIds` are recognised by the TypeScript compiler (type guard comes from
   the `RenderChunk` union updated in commit 001).

## Dependencies

| Commit | Provides |
|--------|----------|
| **001** | `toolGroupUtils.ts` (`groupConsecutiveToolChunks`) + `'tool-group'` variant on `RenderChunk` |
| **002** | `useDisplaySettings` returning `toolCompactness: 0\|1\|2` + server config |
| **003** | Settings UI (no code impact on this commit) |
| **004** | `ToolCallGroupView.tsx` component |

## Assumed Prior State

- `RenderChunk` (line 61–67) already has the `'tool-group'` union member added by
  commit 001:
  ```typescript
  interface RenderChunk {
      kind: 'content' | 'tool' | 'tool-group';
      key: string;
      html?: string;
      toolId?: string;
      toolIds?: string[];        // populated for kind === 'tool-group'
      parentToolId?: string;
      category?: ToolGroupCategory; // populated for kind === 'tool-group'
  }
  ```
- `useDisplaySettings` (line 496) already returns `toolCompactness` (commit 002):
  ```typescript
  const { showReportIntent, toolCompactness } = useDisplaySettings();
  //                         ^^^^^^^^^^^^^^^ added by commit 002
  ```
- `toolGroupUtils.ts` exists at
  `packages/coc/src/server/spa/client/react/processes/toolGroupUtils.ts` (commit 001).
- `ToolCallGroupView.tsx` exists at
  `packages/coc/src/server/spa/client/react/processes/ToolCallGroupView.tsx` (commit 004).
- All existing tests pass on the state produced by commits 001–004.
