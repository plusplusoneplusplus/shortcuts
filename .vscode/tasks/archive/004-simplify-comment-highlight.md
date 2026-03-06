---
status: done
---

# 004: Simplify CommentHighlight to Event-Only Component

## Summary

Strip the DOM-mutation logic (`buildTextRange`, `wrapRangeInMark`, mark injection/cleanup) from `CommentHighlight` and keep only the click-event delegation `useEffect`, retargeted at the `span.commented-text[data-comment-id]` elements that commit 003 already bakes into the rendered HTML. Also update `MarkdownReviewEditor.handleCommentClick` which queries `mark[data-comment-id]` to scroll-to/popover a highlight.

## Motivation

Commit 003 moved highlight rendering into the HTML pipeline (`applyCommentHighlightToRange` produces `<span class="commented-text" data-comment-id="...">`). The old DOM-mutation path in `CommentHighlight` is now dead code that can never produce visible marks — leaving it in creates confusion, a double-highlight risk if both paths ever fire, and unnecessary DOM work. Splitting removal into its own commit keeps the diff reviewable and makes it easy to revert the cleanup independently of the rendering change.

## Changes

### Files to Modify

- **`packages/coc/src/server/spa/client/react/tasks/comments/CommentHighlight.tsx`**
  1. **Remove** the exported `buildTextRange` function (lines 18-44).
  2. **Remove** the exported `wrapRangeInMark` function (lines 51-70).
  3. **Remove** the `MARK_CLASS` constant (line 72).
  4. **Remove** the first half of the `useEffect` body: the "clear existing highlights" `querySelectorAll('mark[data-comment-id]')` loop (lines 80-86) and the "inject marks" `for` loop (lines 88-100).
  5. **Update** the click-handler selector from `mark[data-comment-id]` to `span.commented-text[data-comment-id]` (line 104).
  6. **Update** the module-level JSDoc to reflect the new event-only role.

- **`packages/coc/src/server/spa/client/react/shared/MarkdownReviewEditor.tsx`**
  1. **Update** `handleCommentClick` (line 339): change the querySelector from `mark[data-comment-id="${comment.id}"]` to `span.commented-text[data-comment-id="${comment.id}"]` so sidebar-click-to-scroll still works with the new span-based highlights.

### Files to Check (no changes expected)

- **`CommentHighlight.test.tsx`** (if it exists) — tests for `buildTextRange`/`wrapRangeInMark` should be removed or relocated if those utilities are still tested elsewhere.
- **CSS / Tailwind styles** — `span.commented-text` styling is applied inline by `applyCommentHighlightToRange` in commit 003; no new CSS needed.

## Implementation Notes

- After removal, `CommentHighlight` becomes a pure side-effect component (returns `null`, attaches one click listener). Its props stay the same (`comments`, `containerRef`, `onCommentClick`), keeping the call site in `MarkdownReviewEditor` unchanged.
- The `comments` prop is still needed in the click handler to look up the `TaskComment` by id.
- The `containerRef` prop is still needed to scope the event listener.
- The `useEffect` dependency array shrinks: `containerRef` and `onCommentClick` remain; `comments` remains because the click handler closure captures it. No functional change to reactivity.
- If any tests import `buildTextRange` or `wrapRangeInMark` directly, those imports will break. Search for imports before finalizing.

## Tests

- **Unit test**: Render `CommentHighlight` with a container that already contains `<span class="commented-text" data-comment-id="c1">text</span>`, simulate a click on it, assert `onCommentClick` is called with the matching comment.
- **Unit test**: Render with no matching spans, simulate click elsewhere, assert `onCommentClick` is NOT called.
- **Unit test**: Verify the component returns `null` (no DOM output of its own).
- **Integration check**: In `MarkdownReviewEditor`, clicking a comment in the sidebar should scroll to the `span.commented-text` element and open the popover.

## Acceptance Criteria

- [ ] `buildTextRange` and `wrapRangeInMark` are no longer exported from `CommentHighlight.tsx`
- [ ] No `<mark>` elements are created or queried anywhere in `CommentHighlight.tsx`
- [ ] Click on `span.commented-text[data-comment-id]` inside the preview container fires `onCommentClick` with the correct comment
- [ ] `handleCommentClick` in `MarkdownReviewEditor` queries `span.commented-text[data-comment-id]` (not `mark`)
- [ ] Existing tests pass (`npm run test` in `packages/coc`)
- [ ] No regressions in the SPA task preview: highlights visible, clickable, sidebar scroll-to works

## Dependencies

- Depends on: 003 (bake highlights into HTML at render time)

## Assumed Prior State

Comment highlights are baked into the HTML at render time (commit 003). `<span class="commented-text" data-comment-id="...">` elements exist in the rendered output. The old `<mark>` injection path in `CommentHighlight` is dead code that no longer produces visible highlights.
