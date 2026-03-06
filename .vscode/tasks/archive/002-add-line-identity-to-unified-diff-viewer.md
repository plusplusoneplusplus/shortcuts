---
status: pending
---

# 002: Add line identity to UnifiedDiffViewer

## Summary
Parse `@@ -old,count +new,count @@` hunk headers to compute old/new line numbers for every rendered line. Add `data-diff-line-index`, `data-old-line`, `data-new-line`, and `data-line-type` attributes to each line `<div>` when `enableComments` is true. Add an optional line-number gutter when `showLineNumbers` is true. Export a `DiffLine` interface and an `onLinesReady` callback prop. All changes are purely additive — existing rendering is unchanged when neither new prop is set.

## Motivation
Downstream commits (selection detection, comment anchor highlights) need a stable per-line identity that maps DOM nodes to logical diff positions. The `data-*` attributes provide that anchor without coupling the DOM to React state, and the `onLinesReady` callback lets parent components receive the fully-parsed line array once per render.

## Changes

### Files to Create
_None._

### Files to Modify

#### `packages/coc/src/server/spa/client/react/repos/UnifiedDiffViewer.tsx`

1. **Export `DiffLine` interface** (new, placed just below the `LineType` type alias):
   ```ts
   export interface DiffLine {
       index: number;          // 0-based position in the split lines array
       type: LineType;
       oldLine?: number;       // undefined for added lines and non-code lines
       newLine?: number;       // undefined for removed lines and non-code lines
       content: string;        // raw line text including leading +/-/ prefix
   }
   ```

2. **Export `parseHunkHeader` helper** (new, pure function, testable in isolation):
   ```ts
   export function parseHunkHeader(line: string): { oldStart: number; newStart: number } | null {
       const m = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
       return m ? { oldStart: parseInt(m[1], 10), newStart: parseInt(m[2], 10) } : null;
   }
   ```

3. **Export `computeDiffLines` helper** (new, pure function, encapsulates all hunk-cursor logic):
   ```ts
   export function computeDiffLines(lines: string[]): DiffLine[] {
       let oldLine: number | undefined;
       let newLine: number | undefined;
       return lines.map((raw, index) => {
           const type = classifyLine(raw);
           if (type === 'hunk-header') {
               const parsed = parseHunkHeader(raw);
               if (parsed) { oldLine = parsed.oldStart; newLine = parsed.newStart; }
               return { index, type, content: raw };
           }
           if (type === 'context') {
               const result: DiffLine = { index, type, oldLine, newLine, content: raw };
               if (oldLine !== undefined) oldLine++;
               if (newLine !== undefined) newLine++;
               return result;
           }
           if (type === 'removed') {
               const result: DiffLine = { index, type, oldLine, content: raw };
               if (oldLine !== undefined) oldLine++;
               return result;
           }
           if (type === 'added') {
               const result: DiffLine = { index, type, newLine, content: raw };
               if (newLine !== undefined) newLine++;
               return result;
           }
           // meta
           return { index, type, content: raw };
       });
   }
   ```
   Cursor rules:
   - `hunk-header` → reset `oldLine = oldStart`, `newLine = newStart`; no increment.
   - `context` → assign both `oldLine` and `newLine`; increment both after.
   - `removed` → assign `oldLine` only; increment `oldLine` after.
   - `added` → assign `newLine` only; increment `newLine` after.
   - `meta` → assign neither; no increment.
   - Before the first `@@` hunk header, both cursors are `undefined`.

4. **Extend `UnifiedDiffViewerProps`** with three optional props:
   ```ts
   export interface UnifiedDiffViewerProps {
       diff: string;
       fileName?: string;
       'data-testid'?: string;
       enableComments?: boolean;
       showLineNumbers?: boolean;
       onLinesReady?: (lines: DiffLine[]) => void;
   }
   ```

5. **Add `useEffect` import** alongside the existing `useMemo` import from `'react'`.

6. **Inside `UnifiedDiffViewer`**, add two new `useMemo` calls after the existing ones:
   ```ts
   const diffLines = useMemo(() => computeDiffLines(lines), [lines]);
   ```
   And fire the callback via `useEffect`:
   ```ts
   useEffect(() => {
       onLinesReady?.(diffLines);
   }, [diffLines, onLinesReady]);
   ```
   `diffLines` is computed unconditionally so `onLinesReady` always receives data when provided.

7. **Update line rendering** inside `lines.map((line, i) => { ... })`:
   - Replace `const type = classifyLine(line)` with `const { type, oldLine, newLine } = diffLines[i]`.
   - When `enableComments` is true, spread `data-*` attributes onto every line `<div>`:
     ```tsx
     data-diff-line-index={enableComments ? i : undefined}
     data-old-line={enableComments ? (oldLine ?? '') : undefined}
     data-new-line={enableComments ? (newLine ?? '') : undefined}
     data-line-type={enableComments ? type : undefined}
     ```
   - When `showLineNumbers` is true, insert the two gutter spans as the first children inside each line `<div>`, before the existing `<span>{prefix}</span>` or raw text:
     ```tsx
     {showLineNumbers && (
         <>
             <span className="select-none text-right w-10 inline-block text-[#6e7681] pr-1">
                 {oldLine ?? ''}
             </span>
             <span className="select-none text-right w-10 inline-block text-[#6e7681] pr-1">
                 {newLine ?? ''}
             </span>
         </>
     )}
     ```
   - The two line branches (code content and raw/meta) both receive the gutter and the `data-*` attributes.

#### `packages/coc/src/server/spa/client/react/repos/index.ts`
Add exports for the new public surface:
```ts
export type { DiffLine } from './UnifiedDiffViewer';
export { computeDiffLines, parseHunkHeader } from './UnifiedDiffViewer';
```

### Files to Delete
_None._

## Implementation Notes

- `computeDiffLines` iterates once and mutates two local cursor variables (`oldLine`, `newLine`). This is intentional — it mirrors how `git diff` defines line numbers and keeps the function O(n).
- `parseHunkHeader` uses `(?:,\d+)?` to handle single-line hunks like `@@ -1 +1 @@` (no comma/count).
- Passing `data-old-line=""` (empty string) for non-numbered lines (added/removed/meta/hunk-header) is preferred over omitting the attribute, to allow CSS attribute selectors to match all line divs uniformly.
- The `onLinesReady` `useEffect` depends on `[diffLines, onLinesReady]`. Because `diffLines` is a new array reference each render when `diff` changes, the callback fires exactly once per diff update. Consumers should wrap the callback in `useCallback` to avoid spurious firings.
- `showLineNumbers` gutter uses Tailwind utility classes identical to those already used for `text-[#6e7681]` in the existing `LINE_CLASSES.meta` entry — no new color tokens are introduced.
- No changes to `classifyLine`, `extractFilePathFromDiffHeader`, `getLanguagesForLines`, or `LINE_CLASSES` — all existing behavior is preserved.

## Tests

### New test file: `packages/coc/test/spa/react/UnifiedDiffViewerLineIdentity.test.ts`
Source-text tests (structural, no React renderer):

1. **`parseHunkHeader`**
   - Returns `{ oldStart, newStart }` for `@@ -10,6 +12,8 @@`.
   - Returns `{ oldStart, newStart }` for single-line hunk `@@ -1 +1 @@`.
   - Returns `null` for non-hunk lines.

2. **`computeDiffLines` — basic structure**
   - Returns same number of entries as input lines.
   - Each entry has `index` equal to its position in the array.
   - Each entry has `content` equal to the original line string.

3. **`computeDiffLines` — line number assignment**
   - Before first `@@` header, `oldLine` and `newLine` are `undefined` for all lines.
   - `hunk-header` line itself has `oldLine === undefined` and `newLine === undefined`.
   - First `context` line after `@@ -10,6 +12,8 @@` gets `oldLine=10`, `newLine=12`.
   - Second `context` line gets `oldLine=11`, `newLine=13`.
   - `removed` line gets `oldLine=N`, `newLine === undefined`; next `context` gets `oldLine=N+1`.
   - `added` line gets `newLine=M`, `oldLine === undefined`; next `context` gets `newLine=M+1`.
   - `meta` lines have no `oldLine`/`newLine` regardless of cursor state.
   - Multi-hunk diff resets cursors correctly at the second `@@` header.

4. **`DiffLine` type export**
   - Source file exports `DiffLine` interface.
   - `index.ts` exports `DiffLine` type.

5. **New props structural tests (added to existing `UnifiedDiffViewer.test.ts`)**
   - Source contains `enableComments?: boolean`.
   - Source contains `showLineNumbers?: boolean`.
   - Source contains `onLinesReady?`.
   - Source contains `data-diff-line-index`.
   - Source contains `data-old-line`.
   - Source contains `data-new-line`.
   - Source contains `data-line-type`.
   - Source contains `select-none text-right w-10 inline-block` (gutter class).
   - Source imports `useEffect` from `'react'`.
   - Source exports `computeDiffLines`.
   - Source exports `parseHunkHeader`.

## Acceptance Criteria

- [ ] `parseHunkHeader('@@ -10,6 +12,8 @@')` returns `{ oldStart: 10, newStart: 12 }`.
- [ ] `computeDiffLines` on a 3-line hunk (`context`, `removed`, `added`) starting at `@@ -5,3 +5,3 @@` assigns `oldLine=5, newLine=5` to context; `oldLine=6` to removed; `newLine=6` to added; `oldLine=7, newLine=7` to next context.
- [ ] Rendering `<UnifiedDiffViewer diff={…} enableComments />` produces `<div data-diff-line-index="0" data-line-type="meta" …>` for the first line.
- [ ] `showLineNumbers` gutter spans appear before existing prefix span.
- [ ] `onLinesReady` is called with an array whose length equals `diff.split('\n').length`.
- [ ] When neither `enableComments` nor `showLineNumbers` is set, rendered output is byte-for-byte identical to pre-commit output (no extra attributes or spans).
- [ ] All existing tests in `UnifiedDiffViewer.test.ts` and `UnifiedDiffViewer.behavior.test.ts` continue to pass.
- [ ] New tests in `UnifiedDiffViewerLineIdentity.test.ts` pass.

## Dependencies

- **001** — `DiffCommentSelection`, `DiffCommentContext`, `DiffComment` types defined in `pipeline-core/src/editor/types.ts` and `coc/src/server/spa/client/diff-comment-types.ts`. This commit does not import those types but establishes the per-line identity that commit 003 will use to build `DiffCommentContext` values.

## Assumed Prior State

- `UnifiedDiffViewer.tsx` is exactly as shown above: exports `UnifiedDiffViewerProps`, `extractFilePathFromDiffHeader`, `getLanguagesForLines`; internal `classifyLine` and `LINE_CLASSES`.
- `repos/index.ts` already re-exports `UnifiedDiffViewer` and `UnifiedDiffViewerProps`.
- Both existing test files (`UnifiedDiffViewer.test.ts`, `UnifiedDiffViewer.behavior.test.ts`) pass on the current codebase.
- Commit 001 types exist but are not yet imported by the component.
