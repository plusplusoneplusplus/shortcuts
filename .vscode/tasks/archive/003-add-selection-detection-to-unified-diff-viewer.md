---
status: pending
---

# 003: Add selection detection to UnifiedDiffViewer

## Summary
Add a `mouseup` listener to the `UnifiedDiffViewer` container that detects text selections spanning diff lines, reads `data-*` attributes stamped by commit 002, builds a `DiffCommentSelection`, and shows a floating `<SelectionToolbar>` whose "Add comment" click fires `onAddComment` with the selection, selected text, and toolbar position.

## Motivation
The selection-to-comment bridge is self-contained logic that touches only `UnifiedDiffViewer`. It must come after line identity (commit 002, which stamps `data-diff-line-index`, `data-old-line`, `data-new-line`, `data-line-type` on every `<div>`) but before highlight rendering (004) and full integration (007). Isolating it here keeps the diff between commits small and reviewable.

## Changes

### Files to Create
_None._

### Files to Modify

#### `packages/coc/src/server/spa/client/react/repos/UnifiedDiffViewer.tsx`

1. **Add imports**
   - `useState`, `useCallback`, `useRef` from `'react'`
   - `SelectionToolbar` from `'../tasks/comments/SelectionToolbar'`
   - `DiffCommentSelection`, `DiffComment` from `'../../diff-comment-types'`

2. **Extend `UnifiedDiffViewerProps`** with four new optional props:
   ```ts
   enableComments?: boolean;
   comments?: DiffComment[];
   onAddComment?: (
     selection: DiffCommentSelection,
     selectedText: string,
     position: { top: number; left: number }
   ) => void;
   onCommentClick?: (comment: DiffComment) => void;
   ```

3. **Add toolbar state** inside the component function:
   ```ts
   const [toolbar, setToolbar] = useState<{
     visible: boolean;
     position: { top: number; left: number };
     selection: DiffCommentSelection | null;
     selectedText: string;
   }>({ visible: false, position: { top: 0, left: 0 }, selection: null, selectedText: '' });

   const containerRef = useRef<HTMLDivElement>(null);
   ```

4. **Implement `findLineElement(node: Node): Element | null`** helper (file-scope or inside component):
   - Walk `node` and its `parentElement` ancestors until an element with `data-diff-line-index` is found, or until `containerRef.current` boundary is crossed.
   - Return `null` if not found.

5. **Implement `handleMouseUp` callback** (wrapped in `useCallback`):
   ```ts
   const handleMouseUp = useCallback(() => {
     if (!enableComments) return;
     const sel = window.getSelection();
     if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
       setToolbar(t => ({ ...t, visible: false }));
       return;
     }
     const range = sel.getRangeAt(0);
     const startEl = findLineElement(range.startContainer);
     const endEl   = findLineElement(range.endContainer);
     if (!startEl || !endEl) {
       setToolbar(t => ({ ...t, visible: false }));
       return;
     }

     // Parse data-* attributes
     const startIdx = parseInt(startEl.getAttribute('data-diff-line-index') ?? '-1', 10);
     const endIdx   = parseInt(endEl.getAttribute('data-diff-line-index')   ?? '-1', 10);
     if (startIdx < 0 || endIdx < 0) {
       setToolbar(t => ({ ...t, visible: false }));
       return;
     }

     // Reject hunk-header lines at either endpoint
     const startType = startEl.getAttribute('data-line-type');
     const endType   = endEl.getAttribute('data-line-type');
     if (startType === 'hunk-header' || endType === 'hunk-header') {
       setToolbar(t => ({ ...t, visible: false }));
       return;
     }

     // Enforce single-file-section: walk lines between start and end; if any
     // has data-line-type="meta" and the text begins with "diff --git", reject.
     const minIdx = Math.min(startIdx, endIdx);
     const maxIdx = Math.max(startIdx, endIdx);
     const lineEls = containerRef.current?.querySelectorAll<HTMLElement>('[data-diff-line-index]') ?? [];
     for (const el of Array.from(lineEls)) {
       const idx = parseInt(el.getAttribute('data-diff-line-index') ?? '-1', 10);
       if (idx >= minIdx && idx <= maxIdx && el.getAttribute('data-line-type') === 'meta') {
         const text = el.textContent ?? '';
         if (text.startsWith('diff --git') || text.startsWith('diff ')) {
           setToolbar(t => ({ ...t, visible: false }));
           return;
         }
       }
     }

     // Build DiffCommentSelection
     const [firstEl, lastEl] = startIdx <= endIdx ? [startEl, endEl] : [endEl, startEl];
     const selection: DiffCommentSelection = {
       diffLineStart: minIdx,
       diffLineEnd:   maxIdx,
       side: (firstEl.getAttribute('data-line-type') as 'added' | 'removed' | 'context') ?? 'context',
       oldLineStart: parseInt(firstEl.getAttribute('data-old-line') ?? '0', 10),
       oldLineEnd:   parseInt(lastEl.getAttribute('data-old-line')  ?? '0', 10),
       newLineStart: parseInt(firstEl.getAttribute('data-new-line') ?? '0', 10),
       newLineEnd:   parseInt(lastEl.getAttribute('data-new-line')  ?? '0', 10),
       startColumn: range.startOffset,
       endColumn:   range.endOffset,
     };

     // Toolbar position: above the selection midpoint
     const rect = range.getBoundingClientRect();
     const position = { top: rect.top - 40, left: rect.left + rect.width / 2 };

     setToolbar({
       visible: true,
       position,
       selection,
       selectedText: sel.toString(),
     });
   }, [enableComments]);
   ```

6. **Implement `handleMouseDown` callback** to dismiss the toolbar when clicking outside it:
   ```ts
   const handleMouseDown = useCallback((e: React.MouseEvent) => {
     // The toolbar is portal-rendered; check via data-testid on the target chain
     if (!(e.target as Element).closest('[data-testid="selection-toolbar"]')) {
       setToolbar(t => ({ ...t, visible: false }));
     }
   }, []);
   ```

7. **Wire callbacks onto the container `<div>`**:
   ```tsx
   <div
     ref={containerRef}
     onMouseUp={enableComments ? handleMouseUp : undefined}
     onMouseDown={enableComments ? handleMouseDown : undefined}
     className="overflow-x-auto font-mono text-xs ..."
     data-testid={testId}
   >
   ```

8. **Render `<SelectionToolbar>`** after the lines map, inside the component's return:
   ```tsx
   {enableComments && (
     <SelectionToolbar
       visible={toolbar.visible}
       position={toolbar.position}
       onAddComment={() => {
         if (toolbar.selection) {
           onAddComment?.(toolbar.selection, toolbar.selectedText, toolbar.position);
         }
         setToolbar(t => ({ ...t, visible: false }));
       }}
     />
   )}
   ```

### Files to Delete
_None._

## Implementation Notes

- `findLineElement` must stop at `containerRef.current` to avoid escaping the diff container when walking ancestors. Return `null` if the boundary is reached without finding a `data-diff-line-index` element.
- The `mousedown` dismiss handler fires before `mouseup`, so clicking *inside* the toolbar (which is portal-rendered outside the container) will not suppress the `mouseup` because `closest('[data-testid="selection-toolbar"]')` will match. However, a `mousedown` on the toolbar itself triggers before the `click` handler on `SelectionToolbar`; the portal div's `onClick` with `stopPropagation` ensures the dismiss is not triggered for toolbar-internal clicks. Verify this in tests.
- `getBoundingClientRect()` returns viewport-relative coordinates. The toolbar uses `position: fixed`, which also uses viewport coordinates, so no scroll offset adjustment is needed.
- When `enableComments` is `false`, the `mouseup`/`mousedown` handlers are not attached, keeping the component's behavior identical to the pre-002 baseline.
- The `comments` and `onCommentClick` props are declared here but intentionally left unused (no rendering) — they will be consumed by commit 004 (highlight rendering). Declaring them now avoids a prop-shape change later.
- `DiffCommentSelection.side` is set from the **start** line of the selection. If the selection spans mixed line types (e.g., `added` + `context`), the side reflects the first line encountered; callers may refine this in later commits.

## Tests

File: `packages/coc/src/server/spa/client/react/repos/UnifiedDiffViewer.test.tsx`

Add the following test cases (using `@testing-library/react` + `jsdom`):

1. **No toolbar when `enableComments` is false**
   - Render with a two-line diff, fire `mouseup`, assert `[data-testid="selection-toolbar"]` is absent.

2. **No toolbar when selection is collapsed**
   - Render with `enableComments`, mock `window.getSelection()` to return `isCollapsed: true`, fire `mouseup`, assert toolbar absent.

3. **No toolbar when selection anchors outside `data-diff-line-index` elements**
   - Mock selection whose `startContainer` has no ancestor with `data-diff-line-index`, fire `mouseup`, assert toolbar absent.

4. **No toolbar when either endpoint is a `hunk-header` line**
   - Mock selection anchored on a `hunk-header` div, fire `mouseup`, assert toolbar absent.

5. **No toolbar when selection crosses a `diff --git` meta line**
   - Provide a multi-file diff; mock selection spanning two file sections; assert toolbar absent.

6. **Toolbar appears with correct position on valid selection**
   - Provide a single-file diff with two `added` lines; mock `window.getSelection()` returning a range with known `getBoundingClientRect()` values; fire `mouseup`; assert toolbar visible at `{ top: rect.top - 40, left: rect.left + rect.width / 2 }`.

7. **`onAddComment` fires with correct `DiffCommentSelection`**
   - Build on test 6; click the toolbar button; assert `onAddComment` called once with the expected `DiffCommentSelection` shape and `selectedText`.

8. **Toolbar dismisses on `mousedown` outside**
   - Show toolbar (via test 6 setup); fire `mousedown` on the container div (not the toolbar); assert toolbar hidden.

9. **Toolbar stays visible on `mousedown` inside the toolbar portal**
   - Show toolbar; fire `mousedown` on the toolbar element itself; assert toolbar still visible.

## Acceptance Criteria

- [ ] `UnifiedDiffViewer` accepts `enableComments`, `comments`, `onAddComment`, `onCommentClick` props without TypeScript errors.
- [ ] When `enableComments` is `false` (or omitted), component behavior is identical to post-002 baseline — no extra DOM nodes, no event listeners.
- [ ] Selecting text across valid diff lines shows the `<SelectionToolbar>` floating above the selection.
- [ ] Clicking "💬 Add comment" in the toolbar fires `onAddComment` with a correctly-shaped `DiffCommentSelection`, the selected text string, and the position object.
- [ ] Selections crossing a `diff --git` meta boundary do not show the toolbar.
- [ ] Selections anchored on `hunk-header` lines do not show the toolbar.
- [ ] Toolbar dismisses when `mousedown` fires outside it.
- [ ] All new test cases pass (`npm run test:run` in `packages/coc`).
- [ ] No regressions in existing `UnifiedDiffViewer` tests.

## Dependencies

- **Commit 002** must be merged: `data-diff-line-index`, `data-old-line`, `data-new-line`, `data-line-type` must exist on every line `<div>`.
- `SelectionToolbar` at `packages/coc/src/server/spa/client/react/tasks/comments/SelectionToolbar.tsx` — already present, no changes needed.
- `DiffCommentSelection`, `DiffComment` types from `packages/coc/src/server/spa/client/diff-comment-types.ts` — already present (commit 001).

## Assumed Prior State

- `UnifiedDiffViewerProps` currently has only `diff`, `fileName`, and `data-testid` fields.
- Every line `<div>` rendered by `UnifiedDiffViewer` carries `data-diff-line-index` (0-based integer), `data-old-line` (1-based or `"0"` when absent), `data-new-line` (1-based or `"0"` when absent), and `data-line-type` (`added|removed|context|hunk-header|meta`).
- `SelectionToolbar` is portal-rendered to `document.body` and uses `data-testid="selection-toolbar"`.
- `DiffCommentSelection` shape (from commit 001): `{ diffLineStart, diffLineEnd, side, oldLineStart, oldLineEnd, newLineStart, newLineEnd, startColumn, endColumn }`.
