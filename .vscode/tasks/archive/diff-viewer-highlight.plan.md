# Plan: Git Diff Syntax Highlighting in CoC SPA

## Problem

The right panel of the CoC SPA **Git tab** renders diffs as raw plain text in a `<pre>` block. Lines beginning with `+` or `-` are not visually distinguished, making it hard to read what changed at a glance.

The goal is to render diffs the same way a typical diff view does:
- **Added lines** (`+`) → green background
- **Removed lines** (`-`) → red background
- **Hunk headers** (`@@`) → blue/gray accent
- **Diff metadata** (`diff --git`, `index`, `---`, `+++`) → muted/dim
- **Context lines** → no background (same as before)

## Affected Files

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/repos/UnifiedDiffViewer.tsx` | **New** — shared diff rendering component |
| `packages/coc/src/server/spa/client/react/repos/BranchFileDiff.tsx` | Replace `<pre>` raw block with `<UnifiedDiffViewer>` |
| `packages/coc/src/server/spa/client/react/repos/CommitDetail.tsx` | Replace `<pre>` raw block with `<UnifiedDiffViewer>` |
| `packages/coc/src/server/spa/client/react/repos/index.ts` | Export `UnifiedDiffViewer` and its props type |
| `packages/coc/test/spa/react/BranchFileDiff.test.ts` | Update assertions that check for raw `<pre>` styling |
| `packages/coc/test/spa/react/CommitDetail.test.ts` | Update assertions that check for raw `<pre>` styling |
| `packages/coc/test/spa/react/UnifiedDiffViewer.test.ts` | **New** — tests for the new component |

## Approach

### 1. Create `UnifiedDiffViewer` component

**Location:** `packages/coc/src/server/spa/client/react/repos/UnifiedDiffViewer.tsx`

**Props:**
```ts
export interface UnifiedDiffViewerProps {
    diff: string;
    'data-testid'?: string;
}
```

**Rendering logic:**
- Split the raw unified diff string by `\n`
- For each line, classify it:
  - Starts with `+` and not `+++` → `added`
  - Starts with `-` and not `---` → `removed`
  - Starts with `@@` → `hunk-header`
  - Starts with `diff `, `index `, `--- `, `+++ `, `new file`, `deleted file`, `rename` → `meta`
  - Everything else → `context`
- Render a wrapping `<div>` with `overflow-x-auto font-mono text-xs` and a border/rounded styling
- Each line is a `<div>` (not `<span>`) to fill full width for background color
- Use Tailwind utility classes (not inline styles) for colors:
  - `added`: `bg-[#e6ffed] dark:bg-[#1a3d2b] text-[#22863a] dark:text-[#3fb950]`
  - `removed`: `bg-[#ffeef0] dark:bg-[#3d1a1a] text-[#b31d28] dark:text-[#f85149]`
  - `hunk-header`: `bg-[#dbedff] dark:bg-[#1d3251] text-[#0550ae] dark:text-[#79c0ff]`
  - `meta`: `text-[#6e7681] dark:text-[#8b949e]` (no background)
  - `context`: inherits container background
- Preserve `whitespace-pre` on each line row so indentation is kept
- Add a line-number gutter: show actual line numbers for `+`/`-`/context lines, blank for meta/hunk
- Keep the outer container background consistent with existing design: `bg-[#f5f5f5] dark:bg-[#2d2d2d] border border-[#e0e0e0] dark:border-[#3c3c3c] rounded`
- Include `data-testid` passthrough

### 2. Update `BranchFileDiff.tsx`

- Import `UnifiedDiffViewer` from `./UnifiedDiffViewer`
- Replace the `<pre>` block (lines 65–67) with:
  ```tsx
  <UnifiedDiffViewer diff={diff} data-testid="branch-file-diff-content" />
  ```
- Keep all other markup, states, and `data-testid` attributes unchanged

### 3. Update `CommitDetail.tsx`

- Import `UnifiedDiffViewer` from `./UnifiedDiffViewer`
- Replace the `<pre>` block (lines 155–157) with:
  ```tsx
  <UnifiedDiffViewer diff={diff} data-testid="diff-content" />
  ```
- Keep all other markup unchanged

### 4. Update `repos/index.ts`

Add:
```ts
export { UnifiedDiffViewer } from './UnifiedDiffViewer';
export type { UnifiedDiffViewerProps } from './UnifiedDiffViewer';
```

### 5. Update existing tests

**`BranchFileDiff.test.ts`** — "diff rendering" section:
- Remove assertion: `expect(source).toContain('<pre')`
- Remove assertion: `expect(source).toContain('p-3 text-xs font-mono bg-[#f5f5f5] dark:bg-[#2d2d2d]')`
- Remove assertion: `expect(source).toContain('whitespace-pre')`
- Add assertion: `expect(source).toContain('<UnifiedDiffViewer')`
- Add assertion: `expect(source).toContain('data-testid="branch-file-diff-content"')`

**`CommitDetail.test.ts`** — "diff API integration" section:
- Remove assertion: raw `<pre` / styling checks if any
- Add assertion: `expect(source).toContain('<UnifiedDiffViewer')`
- Add assertion: `expect(source).toContain('data-testid="diff-content"')`

### 6. Create `UnifiedDiffViewer.test.ts`

**Location:** `packages/coc/test/spa/react/UnifiedDiffViewer.test.ts`

Tests (static source analysis pattern, consistent with other tests in the project):
- Exports `UnifiedDiffViewer` function
- Exports `UnifiedDiffViewerProps` interface
- Accepts `diff: string` prop
- Accepts optional `data-testid` prop
- Source contains added-line color class (`bg-[#e6ffed]` or similar)
- Source contains removed-line color class (`bg-[#ffeef0]` or similar)
- Source contains hunk-header color class
- Source contains `whitespace-pre` (on line rows)
- Splits diff by newline
- Uses `data-testid` passthrough

## Implementation Notes

- **No external diff library** — the unified diff format is simple enough to parse with a `startsWith` check per line. No LCS needed (the diff is already pre-computed by git).
- The existing `diff-utils.ts` LCS utility is NOT used here; it computes diffs from two strings. Here we receive a pre-rendered unified diff from the API.
- Line numbers: Parse `@@` hunk headers (e.g., `@@ -2,41 +2,44 @@`) to track the current old/new line numbers. Show `old | new` in a fixed-width gutter column. This is optional — if scope creep is a concern, omit the gutter and just apply background colors.
- All color tokens follow the existing VSCode-style dark/light theming pattern used in this codebase (Tailwind arbitrary values).
- Keep `overflow-x-auto` on the container so long lines scroll horizontally rather than wrapping.
