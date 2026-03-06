---
status: pending
---

# 008: Implement anchor relocation for changed diffs

## Summary
When a diff is re-fetched (e.g. new commits pushed to a branch), re-match each comment's `CommentAnchor` against the new `DiffLine[]` to update `diffLineStart`/`diffLineEnd`. Mark comments as `'orphaned'` if no match is found. Persist updated positions via `PATCH /api/diff-comments/{wsId}/{id}` and reflect orphan status in the UI without a server round-trip for status-only changes.

## Motivation
Without relocation, comments lose their visual anchor whenever the underlying diff changes — the gutter badge and sidebar entry point to the wrong line (or a line that no longer exists). Adding resilience here makes the commenting system reliable across force-pushes, rebases, and incremental commits.

## Changes

### Files to Create
- `packages/coc/src/server/spa/client/react/utils/relocateDiffAnchor.ts`
  — Pure utility: `relocateDiffAnchor(comment, newLines) → number | null`

### Files to Modify
- `packages/coc/src/server/spa/client/react/hooks/useDiffComments.ts`
  — Add `runRelocation(lines: DiffLine[])` triggered from `onLinesReady`
- `packages/coc/src/server/spa/client/react/components/CommentSidebar.tsx`
  — Render orphaned comments with `⚠️ Location lost` badge and greyed-out style
- `packages/coc/src/server/spa/client/react/components/UnifiedDiffViewer.tsx`
  — Skip gutter badge rendering for orphaned comments
- `packages/coc/src/server/api/diff-comments/types.ts` (or wherever `DiffComment` is defined)
  — Extend status union: `'open' | 'resolved' | 'orphaned'`

### Files to Delete
_None_

## Implementation Notes

### `relocateDiffAnchor` utility
```ts
// packages/.../utils/relocateDiffAnchor.ts
import { hashText } from '@plusplusoneplusplus/pipeline-core/utils/text-matching';

export function relocateDiffAnchor(
    comment: DiffComment,
    newLines: DiffLine[]
): number | null {
    const anchor = comment.anchor;
    if (!anchor) return comment.selection.diffLineStart; // unchanged

    // Strategy 1 – exact hash match
    const byHash = newLines.findIndex(
        (l) => hashText(l.content) === anchor.textHash
    );
    if (byHash !== -1) return byHash;

    // Strategy 2 – substring match (first occurrence of selectedText)
    const byText = newLines.findIndex((l) =>
        l.content.includes(anchor.selectedText)
    );
    if (byText !== -1) return byText;

    // Strategy 3 – context match (contextBefore on preceding line AND contextAfter on following line)
    for (let i = 1; i < newLines.length - 1; i++) {
        const prevMatch = newLines[i - 1].content.includes(anchor.contextBefore);
        const nextMatch = newLines[i + 1].content.includes(anchor.contextAfter);
        if (prevMatch && nextMatch) return i;
    }

    // No match → orphaned
    return null;
}
```

> **Note:** `pipeline-core` already exposes `relocateAnchorPosition` (5-strategy pipeline with fuzzy/Levenshtein matching) in `packages/pipeline-core/src/editor/anchor.ts`. That function operates on a flat string with line/column positions. Because `DiffLine[]` has discrete entries, the simpler index-based approach above is preferred here; callers can upgrade to `batchRelocateAnchors` later if higher confidence scoring is needed.

### `useDiffComments` — relocation on `onLinesReady`
```ts
// Inside useDiffComments hook
const runRelocation = useCallback(async (lines: DiffLine[]) => {
    for (const comment of commentsRef.current) {
        if (!comment.anchor) continue;

        const newIndex = relocateDiffAnchor(comment, lines);

        if (newIndex === null) {
            // Mark orphaned locally — no server round-trip needed for status
            setComments((prev) =>
                prev.map((c) =>
                    c.id === comment.id ? { ...c, status: 'orphaned' } : c
                )
            );
        } else if (newIndex !== comment.selection.diffLineStart) {
            // Persist updated position
            await api.patch(`/api/diff-comments/${wsId}/${comment.id}`, {
                selection: {
                    diffLineStart: newIndex,
                    diffLineEnd: newIndex + (comment.selection.diffLineEnd - comment.selection.diffLineStart),
                },
            });
            setComments((prev) =>
                prev.map((c) =>
                    c.id === comment.id
                        ? { ...c, selection: { ...c.selection, diffLineStart: newIndex } }
                        : c
                )
            );
        }
    }
}, [wsId]);
```

Wire up: pass `runRelocation` as the `onLinesReady` prop to `UnifiedDiffViewer`.

### DiffComment type extension
```ts
// In types.ts
export type DiffCommentStatus = 'open' | 'resolved' | 'orphaned';

export interface DiffComment {
    // ...existing fields...
    status: DiffCommentStatus;
}
```

### `CommentSidebar` — orphan rendering
```tsx
{comment.status === 'orphaned' && (
    <span className="comment-badge comment-badge--orphaned">
        ⚠️ Location lost
    </span>
)}
// Apply CSS class to grey out: opacity 0.5, italic body text
```

### `UnifiedDiffViewer` — skip orphaned gutter badge
```tsx
// In gutter badge rendering logic:
if (comment.status !== 'orphaned') {
    // render badge at diffLineStart
}
```

## Tests

- **`relocateDiffAnchor.test.ts`** (unit):
  - Hash match returns correct index
  - Substring match returns first matching index when hash differs
  - Context match succeeds when adjacent lines contain contextBefore/contextAfter
  - Returns `null` when none of the strategies match → orphaned
  - Returns unchanged `diffLineStart` when `comment.anchor` is absent

- **`useDiffComments.test.ts`** (hook / integration):
  - `runRelocation` updates `diffLineStart` in state and fires PATCH when line moves
  - `runRelocation` sets `status: 'orphaned'` locally and does NOT fire PATCH when `null` returned
  - No-op when new index equals existing `diffLineStart`
  - Runs for all comments in a single `onLinesReady` call

- **`CommentSidebar.test.tsx`** (component):
  - Renders `⚠️ Location lost` badge for orphaned comments
  - Does not render badge for `'open'` or `'resolved'` comments

- **`UnifiedDiffViewer.test.tsx`** (component):
  - Gutter badge absent for orphaned comment
  - Gutter badge present for open comment at correct line

## Acceptance Criteria
1. When `onLinesReady` fires with a new `DiffLine[]`, every comment with an anchor is re-evaluated.
2. If the anchor matches a different line, `diffLineStart`/`diffLineEnd` are updated via PATCH and the badge moves to the new line in the gutter.
3. If the anchor matches no line, `comment.status` becomes `'orphaned'`; the gutter badge is removed; the sidebar entry shows `⚠️ Location lost` in a greyed-out style.
4. Comments without an `anchor` field are left unchanged.
5. No PATCH is issued when the computed index equals the stored `diffLineStart`.
6. All new unit tests pass.

## Dependencies
- **001** — `DiffComment.anchor: CommentAnchor` and `DiffCommentSelection.diffLineStart/diffLineEnd` exist
- **002** — `UnifiedDiffViewer` exposes `DiffLine[]` via `onLinesReady`
- **006** — `useDiffComments` has `comments` state and `editComment`/PATCH wiring

## Assumed Prior State
- `DiffComment.status` is `'open' | 'resolved'` (no `'orphaned'` yet)
- `CommentAnchor` fields match the interface from commit 001: `selectedText`, `contextBefore`, `contextAfter`, `originalLine`, `textHash`
- `pipeline-core` `relocateAnchorPosition` and `batchRelocateAnchors` exist but are not yet consumed by the diff-commenting feature
- `PATCH /api/diff-comments/{wsId}/{id}` accepts a partial `selection` body (established in earlier commits)
