---
status: done
---

# 003: Bake Comment Highlights into Rendering Pipeline

## Summary

Replace the SPA's post-render DOM-mutation highlighting (`CommentHighlight.tsx` using naive `indexOf`) with build-time highlight injection inside `renderMarkdownToHtml`, reusing the same `groupCommentsByAllCoveredLines` → `getHighlightColumnsForLine` → `applyCommentHighlightToRange` pipeline that the VS Code extension already uses from `pipeline-core/src/editor/rendering/`.

## Motivation

The current `CommentHighlight` component (`packages/coc/src/server/spa/client/react/tasks/comments/CommentHighlight.tsx`) uses `buildTextRange(container, comment.selectedText)` which does a naive `indexOf` on the container's `textContent`. This has two problems: (1) it matches the *first* occurrence of the text, not the correct position when duplicate text exists, and (2) it ignores the `selection` field's line/column data entirely. By injecting highlights at render time — when we already have a per-line loop with `data-line` attributes — we can use the precise `selection` coordinates that commits 001 and 002 guarantee are correct.

## Changes

### Files to Modify

- **`packages/coc/src/server/spa/client/markdown-renderer.ts`** — Extend `RenderOptions` with a `comments` field and inject highlights in the per-line loop.
- **`packages/coc/src/server/spa/client/react/hooks/useMarkdownPreview.ts`** — Thread `comments` through to `renderMarkdownToHtml` via `RenderOptions`.
- **`packages/coc/src/server/spa/client/react/shared/MarkdownReviewEditor.tsx`** — Pass `comments` into `useMarkdownPreview` and remove the `<CommentHighlight>` component usage.

### Files Potentially Removed (Dead Code)

- **`packages/coc/src/server/spa/client/react/tasks/comments/CommentHighlight.tsx`** — Entire component becomes dead code. Remove after confirming no other consumers.

## Implementation Notes

### 1. Extend `RenderOptions` (markdown-renderer.ts, line 37-40)

Add an optional `comments` field using a minimal shape that avoids importing the full `TaskComment` type (keep the renderer decoupled):

```typescript
import type { CommentSelection } from '@plusplusoneplusplus/pipeline-core/editor/types';

export interface RenderCommentInfo {
    id: string;
    selection: CommentSelection;
    status: 'open' | 'resolved';
}

export interface RenderOptions {
    stripFrontmatter?: boolean;
    comments?: RenderCommentInfo[];
}
```

### 2. Pre-compute comment line map (markdown-renderer.ts, before line 111)

Before the per-line loop, build the line→comments map. The `groupCommentsByAllCoveredLines` function expects `MarkdownComment[]` but we only have `RenderCommentInfo[]`. Since the function only accesses `.selection.startLine` and `.selection.endLine`, we can cast or create a thin adapter. Preferred approach — inline a minimal grouping loop that mirrors `groupCommentsByAllCoveredLines` but operates on `RenderCommentInfo[]`:

```typescript
import {
    applyMarkdownHighlighting,
    applySourceModeHighlighting,
    getHighlightColumnsForLine,
    applyCommentHighlightToRange,
    sortCommentsByColumnDescending,
} from '@plusplusoneplusplus/pipeline-core/editor/rendering';
```

Build the map right after `const htmlParts: string[] = [];` (line 107):

```typescript
const commentsByLine = new Map<number, RenderCommentInfo[]>();
if (options?.comments) {
    for (const c of options.comments) {
        for (let ln = c.selection.startLine; ln <= c.selection.endLine; ln++) {
            const arr = commentsByLine.get(ln) || [];
            arr.push(c);
            commentsByLine.set(ln, arr);
        }
    }
}
```

### 3. Inject highlights into per-line HTML (markdown-renderer.ts, lines 145-155)

After `applyMarkdownHighlighting` produces `result.html` (line 145) and before wrapping in the `<div class="md-line">` (line 150), apply comment highlights:

```typescript
let lineContent = result.html;
const lineComments = commentsByLine.get(lineNum);
if (lineComments) {
    const plainLine = lines[i];
    // Apply in reverse column order so indices remain valid
    const sorted = [...lineComments].sort(
        (a, b) => b.selection.startColumn - a.selection.startColumn
    );
    for (const c of sorted) {
        const { startCol, endCol } = getHighlightColumnsForLine(
            c.selection, lineNum, plainLine.length
        );
        const statusClass = c.status === 'resolved' ? 'resolved' : '';
        lineContent = applyCommentHighlightToRange(
            lineContent, plainLine, startCol, endCol, c.id, statusClass
        );
    }
}
```

Then use `lineContent` instead of `result.html` in the div wrapper (line 154):

```typescript
lineHtml += '>' + lineContent + '</div>';
```

### 4. Handle code blocks and tables

For **code blocks** (line 76-87): Code blocks are rendered by `renderCodeBlock` which produces self-contained HTML with `.code-line` spans. Highlights inside code blocks require post-processing the rendered HTML or extending `renderCodeBlock`. **Defer to a follow-up** — code block commenting is an edge case and the existing `data-line` approach on `.code-line` spans can be enhanced separately.

For **tables** (line 94-103): Tables are rendered by `renderTable` and contain `<td>` cells without per-line `data-line` attributes. Comments spanning table lines will fall through to the `commentsByLine` map but won't match any regular line div. **Defer to a follow-up** — same rationale.

For **mermaid blocks**: Mermaid diagrams have their own comment context (`MermaidContext`). No change needed — these are handled via a separate system.

### 5. Thread comments through the hook (useMarkdownPreview.ts)

Extend `UseMarkdownPreviewOptions` (line 14) — it already `extends RenderOptions`, so once `RenderOptions` gains `comments`, it flows through automatically. The spread `...renderOptions` on line 42 already passes extra fields to `renderMarkdownToHtml`. **No code change needed in this file** — the type extension propagates.

### 6. Pass comments from MarkdownReviewEditor (MarkdownReviewEditor.tsx)

At line 131, add `comments` to the `useMarkdownPreview` call. Need to map `TaskComment[]` → `RenderCommentInfo[]`:

```typescript
import type { RenderCommentInfo } from '../../markdown-renderer';

// Inside the component, before the useMarkdownPreview call:
const renderComments: RenderCommentInfo[] = useMemo(
    () => comments.map(c => ({
        id: c.id,
        selection: c.selection,
        status: c.status,
    })),
    [comments]
);

const { html } = useMarkdownPreview({
    content: rawContent,
    containerRef: previewRef,
    loading,
    stripFrontmatter: true,
    viewMode,
    comments: renderComments,
});
```

### 7. Remove `CommentHighlight` usage (MarkdownReviewEditor.tsx, line 522-526)

Delete the `<CommentHighlight comments={comments} containerRef={previewRef} onCommentClick={handleCommentClick} />` JSX and its import (line 17). The click handler for comment highlights now needs to work via event delegation on `data-comment-id` spans — add a click handler on the preview div:

```typescript
const handleHighlightClick = useCallback((e: React.MouseEvent) => {
    const span = (e.target as HTMLElement).closest('[data-comment-id]');
    if (!span) return;
    const id = span.getAttribute('data-comment-id');
    const comment = comments.find(c => c.id === id);
    if (comment) handleCommentClick(comment);
}, [comments, handleCommentClick]);
```

Add `onClick={handleHighlightClick}` to the preview `<div>` at line 514.

### 8. CSS compatibility

The `applyCommentHighlightToRange` function wraps text in `<span class="commented-text {statusClass}" data-comment-id="{id}">`. The SPA's existing CSS for `.commented-text` (from the VS Code webview styles) may not be loaded. Verify that the SPA's stylesheet includes `.commented-text` styling, or add it. The existing `CommentHighlight` used Tailwind classes (`bg-yellow-200 dark:bg-yellow-800/50`); the new approach uses semantic classes. Ensure the SPA's CSS or Tailwind config covers:

```css
.commented-text {
    background-color: rgba(255, 235, 59, 0.3);
    cursor: pointer;
    border-radius: 2px;
}
.commented-text.resolved {
    background-color: rgba(76, 175, 80, 0.2);
}
```

## Tests

- **Unit: `renderMarkdownToHtml` with comments** — Pass a 3-line markdown string and a comment spanning lines 1-2. Assert the output contains `<span class="commented-text" data-comment-id="...">` wrapping the correct text range.
- **Unit: single-line partial highlight** — Comment on columns 5-10 of line 3. Assert only that substring is wrapped.
- **Unit: overlapping comments** — Two comments on the same line with non-overlapping columns. Assert both produce separate spans.
- **Unit: resolved comment styling** — Pass a comment with `status: 'resolved'`. Assert the span has class `commented-text resolved`.
- **Unit: no comments** — Call without `comments` option. Assert output is unchanged from current behavior (backward compat).
- **Unit: comment on frontmatter-stripped content** — Verify line numbers align correctly after frontmatter stripping.
- **Integration: MarkdownReviewEditor renders highlights** — Mount with mock comments, assert `[data-comment-id]` spans are present in the DOM.
- **Integration: click on highlight triggers callback** — Click a `[data-comment-id]` span, assert `handleCommentClick` is called with the correct comment.

## Acceptance Criteria

- [ ] `renderMarkdownToHtml` accepts `comments` in `RenderOptions` and produces `<span class="commented-text" data-comment-id="...">` elements at correct positions
- [ ] Highlights use line/column coordinates from `selection`, not text matching
- [ ] Multi-line comments highlight all covered lines
- [ ] Resolved comments get the `resolved` CSS class
- [ ] `useMarkdownPreview` passes `comments` through without additional code changes (type inheritance)
- [ ] `MarkdownReviewEditor` no longer uses `CommentHighlight` DOM mutation
- [ ] Click on a highlight span triggers the existing comment-click flow
- [ ] All existing `markdown-renderer` tests pass unchanged (no-comments path is default)
- [ ] `npm run build` succeeds
- [ ] New unit tests cover single-line, multi-line, overlapping, resolved, and no-comment cases

## Dependencies

- Depends on: 001 (correct source positions in anchors), 002 (server-side anchor relocation so `selection` fields are current)

## Assumed Prior State

Anchors have correct source positions (commit 001). Server returns comments with relocated `selection` fields (commit 002).
