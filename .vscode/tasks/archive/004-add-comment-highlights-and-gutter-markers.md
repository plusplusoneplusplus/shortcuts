---
status: pending
---

# 004: Add comment highlights and gutter markers to UnifiedDiffViewer

## Summary
Pre-compute a `Map<number, DiffComment[]>` from the `comments` prop, keyed by every diff-line index covered by each comment's `selection.diffLineStart..diffLineEnd` range. Use that map to (a) overlay a highlight colour on each covered line and (b) render a clickable comment-count badge in the gutter column beside the line numbers.

## Motivation
Users need a visual affordance indicating which diff lines already carry comments before the full sidebar (commit 007) is wired up. Highlights make coverage obvious at a glance; the gutter badge shows the count and provides a click target. All changes are isolated to `UnifiedDiffViewer` rendering logic and do not touch data-fetching or state management.

## Changes

### Files to Create
_None._

### Files to Modify

#### `packages/coc/src/server/spa/client/react/repos/UnifiedDiffViewer.tsx`

1. **`buildLineCommentMap` helper** (pure function, export for tests):
   ```ts
   export function buildLineCommentMap(comments: DiffComment[]): Map<number, DiffComment[]> {
       const map = new Map<number, DiffComment[]>();
       for (const c of comments) {
           const { diffLineStart, diffLineEnd } = c.selection;
           for (let i = diffLineStart; i <= diffLineEnd; i++) {
               const existing = map.get(i);
               if (existing) existing.push(c);
               else map.set(i, [c]);
           }
       }
       return map;
   }
   ```

2. **`getLineHighlightClass` helper** (pure function, export for tests):
   ```ts
   export function getLineHighlightClass(lineComments: DiffComment[] | undefined): string {
       if (!lineComments || lineComments.length === 0) return '';
       const hasOpen = lineComments.some(c => c.status !== 'resolved');
       if (hasOpen) return 'bg-[#fff9c4] dark:bg-[#3d3a00]';
       return 'bg-[#e6ffed] dark:bg-[#1a3d2b] opacity-80';
   }
   ```
   The highlight class **replaces** (not appends to) the `LINE_CLASSES[type]` background so the two do not fight. Concatenate it with the non-background parts of `LINE_CLASSES[type]` (i.e. text-colour tokens only), or simply layer the highlight class after `LINE_CLASSES[type]` — later Tailwind utility wins via last-write-wins for same property. Using `cn()` (already imported or use template literal) is fine; the highlight bg must come last to win.

3. **`useMemo` for the comment map** inside `UnifiedDiffViewer`:
   ```ts
   const lineCommentMap = useMemo(
       () => (comments ? buildLineCommentMap(comments) : new Map<number, DiffComment[]>()),
       [comments]
   );
   ```

4. **Props signature update** — `UnifiedDiffViewerProps` gains (already added in commit 003; confirm present before touching):
   ```ts
   comments?: DiffComment[];
   onCommentClick?: (comment: DiffComment) => void;
   enableComments?: boolean;
   ```
   If `enableComments` was not added in commit 003, add it here.

5. **Gutter badge column** — inside the `lines.map` render loop, after the existing old/new line-number columns and before the `+/-/ ` prefix span, conditionally render:
   ```tsx
   {enableComments && (
       <span className="inline-flex w-5 shrink-0 items-center justify-center">
           {(() => {
               const lc = lineCommentMap.get(i);
               if (!lc || lc.length === 0) return <span className="w-4 h-4" />;
               return (
                   <button
                       className="w-4 h-4 rounded-full text-[10px] flex items-center justify-center bg-yellow-400 text-white leading-none"
                       onClick={e => { e.stopPropagation(); onCommentClick?.(lc[0]); }}
                       title={`${lc.length} comment${lc.length > 1 ? 's' : ''}`}
                       data-testid="comment-badge"
                   >
                       {lc.length}
                   </button>
               );
           })()}
       </span>
   )}
   ```
   The badge uses `bg-yellow-400` for open comments. If all comments on that line are resolved, swap to `bg-green-500`.

6. **Resolved-badge colour logic** — extract into a helper:
   ```ts
   function getBadgeClass(lineComments: DiffComment[]): string {
       const hasOpen = lineComments.some(c => c.status !== 'resolved');
       return hasOpen
           ? 'bg-yellow-400 text-white'
           : 'bg-green-500 text-white';
   }
   ```
   Replace the hard-coded `bg-yellow-400 text-white` in the badge with `{getBadgeClass(lc)}`.

7. **Line `className` assembly** — both line-rendering branches (highlighted content and plain fallback) must incorporate the highlight class:
   ```tsx
   // highlighted content lines (added/removed/context with length > 0):
   <div
       key={i}
       data-diff-line-index={i}
       className={`whitespace-pre flex ${LINE_CLASSES[type]} ${getLineHighlightClass(lineCommentMap.get(i))}`}
   >
   // plain lines (hunk-header, meta, empty):
   <div
       key={i}
       data-diff-line-index={i}
       className={`whitespace-pre flex ${LINE_CLASSES[type]} ${getLineHighlightClass(lineCommentMap.get(i))}`}
   >
   ```
   Switch from `px-3` to `flex` + padding on the inner content span so that the gutter badge column slots in correctly.

### Files to Delete
_None._

## Implementation Notes

- **`cn()` / class merging:** If the project already imports a `cn` utility (e.g. `clsx` + `tailwind-merge`), prefer `cn(LINE_CLASSES[type], getLineHighlightClass(...))` to avoid duplicate background tokens. If not available, ordering the highlight class last in a template literal is sufficient — Tailwind's JIT generates distinct rules and last-in-source wins for the same CSS property.
- **`DiffComment` import:** Import from the type declaration established in commit 001; do not redeclare.
- **`enableComments` default:** Default to `false` so existing usages without the prop are unaffected.
- **`onCommentClick` safety:** Guard with optional chaining (`onCommentClick?.(...)`) in case the prop is absent.
- **Flex layout:** The existing line `<div>` uses `whitespace-pre px-3`. Adding `flex` lets the badge column and text content sit side-by-side. Move `px-3` to the text content span (`<span className="px-3 flex-1 min-w-0">`), or add `pl-1 pr-3` around the badge column.
- **Badge fires first comment:** Per the spec, `onCommentClick(lc[0])`. If multi-comment popover is desired, that is deferred to a later commit.
- **No new dependencies** required — Tailwind colour tokens `yellow-400` and `green-500` are already present in the project.

## Tests

File: `packages/coc/src/server/spa/client/react/repos/UnifiedDiffViewer.test.tsx` (create or extend)

| Test | Description |
|------|-------------|
| `buildLineCommentMap – single-line comment` | A comment with `diffLineStart=2, diffLineEnd=2` produces `map.get(2)` = `[comment]`. |
| `buildLineCommentMap – multi-line comment` | `diffLineStart=1, diffLineEnd=3` populates keys 1, 2, 3. |
| `buildLineCommentMap – multiple comments overlapping` | Two comments sharing line 5 both appear in `map.get(5)`. |
| `getLineHighlightClass – undefined` | Returns `''`. |
| `getLineHighlightClass – open comment` | Returns `'bg-[#fff9c4] dark:bg-[#3d3a00]'`. |
| `getLineHighlightClass – resolved-only comments` | Returns `'bg-[#e6ffed] dark:bg-[#1a3d2b] opacity-80'`. |
| `getLineHighlightClass – mixed open+resolved` | Open takes priority → yellow. |
| `UnifiedDiffViewer – no comments prop` | No `data-testid="comment-badge"` elements rendered. |
| `UnifiedDiffViewer – enableComments=false` | Comments prop populated but badges not rendered. |
| `UnifiedDiffViewer – badge shown on commented line` | Line index covered by a comment → badge with correct count rendered. |
| `UnifiedDiffViewer – badge not shown on uncovered line` | Line index outside comment ranges → no badge. |
| `UnifiedDiffViewer – badge click fires onCommentClick` | Clicking badge calls `onCommentClick` with `comments[0]` for that line. |
| `UnifiedDiffViewer – yellow badge for open comment` | Badge element has `bg-yellow-400` class when comment is open. |
| `UnifiedDiffViewer – green badge for resolved comment` | Badge element has `bg-green-500` class when all comments resolved. |
| `UnifiedDiffViewer – yellow line highlight for open` | Line div includes `bg-[#fff9c4]` when covered by an open comment. |
| `UnifiedDiffViewer – green line highlight for resolved` | Line div includes `bg-[#e6ffed]` and `opacity-80` when only resolved. |

## Acceptance Criteria

- [ ] Lines covered by at least one open comment render with `bg-[#fff9c4] dark:bg-[#3d3a00]` background.
- [ ] Lines covered only by resolved comments render with `bg-[#e6ffed] dark:bg-[#1a3d2b] opacity-80`.
- [ ] Lines with no comments are visually unchanged from pre-commit behaviour.
- [ ] A comment-count badge appears in the gutter for every line that has ≥ 1 comment, when `enableComments=true`.
- [ ] The badge is `bg-yellow-400` for lines with any open comment, `bg-green-500` for fully-resolved lines.
- [ ] Clicking the badge calls `onCommentClick` with the first comment covering that line.
- [ ] When `enableComments=false` (default), no badges are rendered regardless of `comments` content.
- [ ] All 16 unit tests listed above pass.
- [ ] No TypeScript compilation errors (`npm run build` clean).
- [ ] Snapshot / visual diff for the component is updated if snapshots are tracked.

## Dependencies

| Commit | Requirement |
|--------|-------------|
| 001 | `DiffComment` type with `selection.diffLineStart`, `selection.diffLineEnd`, `status` |
| 002 | `data-diff-line-index={i}` on each line `<div>`; gutter column structure present |
| 003 | `comments?: DiffComment[]`, `onCommentClick?: (c: DiffComment) => void` props on `UnifiedDiffViewerProps` |

## Assumed Prior State

- `UnifiedDiffViewer.tsx` has the exact structure shown in the codebase context: `classifyLine`, `LINE_CLASSES`, `getLanguagesForLines`, `highlightLine` import, and a `lines.map` render loop.
- Each line `<div>` already carries `data-diff-line-index={i}` (commit 002).
- The component already accepts `comments` and `onCommentClick` in its props interface (commit 003), even if they are not yet consumed.
- `DiffComment` is importable from a shared types file established in commit 001.
- The Tailwind config includes `yellow-400`, `green-500`, and arbitrary value support for `bg-[#...]` (already in use in `LINE_CLASSES`).
