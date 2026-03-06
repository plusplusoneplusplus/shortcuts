---
status: pending
---

# 003: Hunk grouping types and algorithm

## Summary

Introduce a `Hunk` interface and `groupIntoHunks()` pure function that partitions an `AlignedLine[]` into discrete hunks with configurable context boundaries. This is the core algorithmic building block for hunk-based rendering; no rendering code is changed.

## Motivation

The current `renderSplitDiff()` and `renderInlineDiff()` iterate **every** `AlignedLine` from `backtrackLCS()`, so a large file with a small change renders hundreds of context lines — the change is effectively invisible. This commit adds the grouping algorithm as a standalone, easily-tested pure function. Rendering integration happens in later commits (005/006), keeping this commit focused and reviewable.

## Changes

### Files to Create

- `src/test/suite/diff-hunk-grouping.test.ts` — Unit tests for `groupIntoHunks()`, `generateHunkHeader()`, and the `Hunk` type. Tests exercise edge cases: empty input, all-context, all-changed, merge/split, boundary, and parameterised context sizes.

### Files to Modify

- `src/shortcuts/git-diff-comments/webview-scripts/diff-renderer.ts` — Add the `Hunk` interface, `generateHunkHeader()` helper, and `groupIntoHunks()` function. Export all three for use by renderers and tests. No changes to existing render functions.

### Files to Delete

- (none)

## Implementation Notes

### `Hunk` interface

Add immediately after the existing `AlignedLine` interface (currently at line 297):

```typescript
interface Hunk {
    /** Unified diff header, e.g. "@@ -10,7 +12,9 @@" */
    headerText: string;
    /** The AlignedLine entries belonging to this hunk (context + changes) */
    lines: AlignedLine[];
    /** First old-side line number in this hunk (from first line with oldLineNum) */
    startOldLine: number;
    /** First new-side line number in this hunk (from first line with newLineNum) */
    startNewLine: number;
    /** Last old-side line number in this hunk */
    endOldLine: number;
    /** Last new-side line number in this hunk */
    endNewLine: number;
    /**
     * Number of aligned lines collapsed (not shown) between the previous hunk
     * and this one. 0 for the first hunk if it starts at the top of the file.
     */
    precedingCollapsedCount: number;
}
```

### `generateHunkHeader()` helper

```typescript
function generateHunkHeader(
    startOld: number,
    countOld: number,
    startNew: number,
    countNew: number
): string {
    return `@@ -${startOld},${countOld} +${startNew},${countNew} @@`;
}
```

Export this so tests can call it directly.

### `groupIntoHunks()` algorithm — pseudocode

```
function groupIntoHunks(aligned: AlignedLine[], contextLines = 3): Hunk[]
    if aligned is empty → return []

    // Step 1: find indices of all non-context ("changed") lines
    changedIndices = []
    for i in 0..aligned.length-1:
        if aligned[i].type !== 'context':
            changedIndices.push(i)

    // No changes at all → return empty (entire file is context)
    if changedIndices is empty → return []

    // Step 2: build raw ranges — each changed index expanded by contextLines
    // A range is [start, end] inclusive into aligned[]
    ranges = []
    for idx of changedIndices:
        start = max(0, idx - contextLines)
        end   = min(aligned.length - 1, idx + contextLines)
        ranges.push([start, end])

    // Step 3: merge overlapping/adjacent ranges
    merged = [ranges[0]]
    for i in 1..ranges.length-1:
        prev = merged[merged.length - 1]
        cur  = ranges[i]
        if cur[0] <= prev[1] + 1:       // overlapping or directly adjacent
            prev[1] = max(prev[1], cur[1])
        else:
            merged.push(cur)

    // Step 4: convert merged ranges into Hunk objects
    hunks = []
    prevEnd = -1       // end index of previous hunk in aligned[]
    for [start, end] of merged:
        lines = aligned.slice(start, end + 1)

        // Compute line-number bounds from the slice
        startOld = first non-null oldLineNum in lines  (fallback: 1)
        startNew = first non-null newLineNum in lines  (fallback: 1)
        endOld   = last  non-null oldLineNum in lines  (fallback: startOld)
        endNew   = last  non-null newLineNum in lines  (fallback: startNew)

        countOld = endOld - startOld + 1   // lines covered on old side
        countNew = endNew - startNew + 1   // lines covered on new side

        // But countOld/countNew must account for additions (no old) / deletions (no new)
        // Correct approach: count lines where oldLineNum is non-null → countOld
        //                   count lines where newLineNum is non-null → countNew
        countOld = lines.filter(l => l.oldLineNum !== null).length
        countNew = lines.filter(l => l.newLineNum !== null).length

        headerText = generateHunkHeader(startOld, countOld, startNew, countNew)

        precedingCollapsedCount = start - (prevEnd + 1)
        // For the first hunk, this equals `start` (lines before first hunk)

        hunks.push({
            headerText,
            lines,
            startOldLine: startOld,
            startNewLine: startNew,
            endOldLine: endOld,
            endNewLine: endNew,
            precedingCollapsedCount
        })

        prevEnd = end

    return hunks
```

### Key decisions

1. **`contextLines` default = 3** — matches `git diff` convention and GitHub/ADO rendering.
2. **Merging threshold** — two ranges merge when they overlap *or* are directly adjacent (`cur[0] <= prev[1] + 1`). This avoids a 1-line gap between hunks which would look odd.
3. **`countOld` / `countNew` in header** — counted by non-null `oldLineNum` / `newLineNum` in the slice rather than arithmetic on start/end numbers. This is accurate even when additions (no old line) or deletions (no new line) are interspersed.
4. **`precedingCollapsedCount`** — computed from indices into the `aligned[]` array, not from line numbers. This tells the future renderer exactly how many context lines are hidden before each hunk.
5. **All-context input** — returns `[]` (no hunks). The renderer will decide whether to show "no changes" or the raw file.
6. **Placement** — add the new code right after `backtrackLCS()` (after line 351) since it logically follows LCS output. Export `Hunk`, `generateHunkHeader`, and `groupIntoHunks`.

### Export pattern

The file currently uses `export function` for public API (e.g., `renderDiff`, `renderSplitDiff`). Follow the same pattern:

```typescript
export interface Hunk { ... }
export function generateHunkHeader(...): string { ... }
export function groupIntoHunks(...): Hunk[] { ... }
```

## Tests

Test file: `src/test/suite/diff-hunk-grouping.test.ts`

Follow the pattern in `diff-indicator-bar.test.ts`: mirror the interfaces locally, define pure helper functions, and test with `assert`. The test file should import nothing from the webview (webview code runs in browser context, not Node). Instead, **re-declare `AlignedLine` and `Hunk` locally** and copy-paste the pure functions (`generateHunkHeader`, `groupIntoHunks`) into the test file — same approach the indicator-bar tests use (they re-declare `DiffLineInfo`, `MarkInfo`, etc.).

### Helper: `mkLine()` factory

```typescript
function mkLine(type: AlignedLine['type'], oldNum: number | null, newNum: number | null): AlignedLine {
    return {
        oldLine: oldNum !== null ? `old line ${oldNum}` : null,
        newLine: newNum !== null ? `new line ${newNum}` : null,
        oldLineNum: oldNum,
        newLineNum: newNum,
        type
    };
}
function ctx(old: number, new_: number) { return mkLine('context', old, new_); }
function add(new_: number)              { return mkLine('addition', null, new_); }
function del(old: number)               { return mkLine('deletion', old, null); }
```

### Test cases

1. **Empty input → no hunks**
   - Input: `[]`
   - Expected: `groupIntoHunks([], 3)` returns `[]`

2. **All context (no changes) → no hunks**
   - Input: 10 context lines
   - Expected: `[]`

3. **Single change in middle of file → one hunk with context**
   - Input: 20 context lines, line 10 is a deletion
   - Expected: 1 hunk, lines 7–13 (3 before + change + 3 after), `precedingCollapsedCount = 7`
   - Header: `@@ -8,6 +8,6 @@` (adjusted for actual line nums — 6 old lines, 6 new lines since deletion removes one from new side: actually 7 old, 6 new; work out exact counts in implementation)

4. **Two changes close together → merged into one hunk**
   - Input: 20 context, changes at indices 5 and 9 (gap < 2×contextLines)
   - Expected: 1 hunk covering indices 2–12

5. **Two changes far apart → two separate hunks**
   - Input: 30 context, changes at indices 5 and 25 (gap > 2×contextLines+1)
   - Expected: 2 hunks, each with own header and context
   - Second hunk's `precedingCollapsedCount` > 0

6. **Change at start of file → no preceding context**
   - Input: change at index 0, then 10 context
   - Expected: 1 hunk starting at index 0, `precedingCollapsedCount = 0`

7. **Change at end of file → no trailing context**
   - Input: 10 context, then change at last index
   - Expected: 1 hunk ending at last index

8. **All lines changed → single hunk, no collapsed regions**
   - Input: all additions/deletions, no context
   - Expected: 1 hunk containing everything, `precedingCollapsedCount = 0`

9. **`contextLines = 0` → hunks contain only changed lines**
   - Input: 10 context, 1 change, 10 context
   - Expected: 1 hunk with exactly 1 line

10. **`contextLines = 1` → narrow context**
    - Input: 10 context, 1 change at idx 5, 10 context
    - Expected: 1 hunk with 3 lines (1 before + change + 1 after)

11. **`contextLines = 5` → wider context**
    - Same layout as test 3 but with contextLines=5
    - Expected: wider hunk, fewer collapsed lines

12. **`generateHunkHeader` formatting**
    - `generateHunkHeader(1, 5, 1, 7)` → `"@@ -1,5 +1,7 @@"`
    - `generateHunkHeader(10, 0, 12, 3)` → `"@@ -10,0 +12,3 @@"`

13. **Adjacent additions and deletions (modified region)**
    - Input: context, 2 deletions, 2 additions, context
    - Expected: 1 hunk, all 4 change lines plus context; `countOld` counts only the 2 deletions + context old-side lines; `countNew` counts only the 2 additions + context new-side lines

14. **Hunk line-number bounds**
    - Verify `startOldLine`, `endOldLine`, `startNewLine`, `endNewLine` on each hunk match the first/last non-null line numbers in the slice

## Acceptance Criteria

- [ ] `Hunk` interface exported from `diff-renderer.ts`
- [ ] `generateHunkHeader()` exported and produces correct `@@ -X,Y +A,B @@` strings
- [ ] `groupIntoHunks()` exported and correctly partitions `AlignedLine[]` into hunks
- [ ] Context lines before/after changes are included (default 3)
- [ ] Overlapping/adjacent context regions between nearby changes are merged
- [ ] `precedingCollapsedCount` is accurate for every hunk
- [ ] Edge cases handled: empty input, all-context, all-changed, file start/end boundaries
- [ ] All 14 test cases pass
- [ ] Existing rendering behaviour is **unchanged** (no modifications to `renderSplitDiff` / `renderInlineDiff`)
- [ ] `npm run build` succeeds
- [ ] `npm run test` passes (existing + new tests)

## Dependencies

- Depends on: None (independent of CSS commits 001, 002; pure algorithmic addition)

## Assumed Prior State

`AlignedLine` interface exists at line 297 of `diff-renderer.ts`. `backtrackLCS()` produces `AlignedLine[]` at line 305–351. No hunk-related types or functions exist. Test files in `src/test/suite/` follow the pattern of re-declaring webview interfaces locally and testing pure logic with `assert` (see `diff-indicator-bar.test.ts`).
