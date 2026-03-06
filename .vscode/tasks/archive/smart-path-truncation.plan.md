# Smart File Path Truncation in Git Commit View

## Problem

In the COC SPA git history/commit view, file paths are truncated at the **end** using CSS `text-overflow: ellipsis` (Tailwind `truncate`). This removes the most important part — the **file name** — making it hard to identify which file changed.

**Current behavior:**
```
M  packages/coc/src/server/spa/client/r…
A  packages/coc/test/spa/react/repos/Re…
```

**Desired behavior — show the filename, truncate the middle:**
```
M  packages/coc/…/client/reactComponent.tsx
A  packages/coc/…/repos/RepoView.test.tsx
```

## Approach

Create a smart path display that always preserves the **filename** (last segment) and uses **middle truncation** for the directory path when space is limited.

### Strategy: CSS `direction: rtl` + `text-overflow: ellipsis`

The simplest approach: render the full path in a `<span>` with `direction: rtl` and `text-overflow: ellipsis`. This makes the browser truncate from the **left** (which is the start of the path), keeping the filename visible. A nested `<bdi>` or `unicode-bidi: plaintext` restores LTR reading order for the actual text.

**Pros:** Pure CSS, no JS measurement, responsive.  
**Cons:** Ellipsis appears on the left side; slash separators may render oddly with RTL — needs testing.

### Alternative: JS-based middle ellipsis component

A `<TruncatedPath>` React component that:
1. Splits the path into `dirPrefix` and `fileName`.
2. Renders `<span class="truncate">{dirPrefix}/</span><span class="flex-shrink-0">{fileName}</span>` in a flex row.
3. The prefix gets CSS truncation; the filename never truncates.

**Pros:** Clean middle-ellipsis look, filename always fully visible.  
**Cons:** Slightly more markup.

### Recommendation

**Use the JS-based flex approach** (Alternative above). It's straightforward, gives the best UX, and avoids RTL quirks. The component can be shared across all git views.

## Acceptance Criteria

- [x] File names (last path segment) are always fully visible in the commit file list
- [x] Directory prefix is truncated with `…` when the path overflows
- [x] Full path is available on hover (title tooltip)
- [x] Works in both CommitList and BranchChanges views
- [x] No layout shifts or visual regressions
- [x] Existing tests pass; new unit test for the truncation component

## Subtasks

1. **Create `<TruncatedPath>` component** in `packages/coc/src/server/spa/client/react/shared/`
   - Props: `path: string`, `className?: string`
   - Split path into directory prefix + filename
   - Render as flex row: prefix (truncatable) + filename (flex-shrink-0)
   - Set `title={fullPath}` for tooltip
2. **Update `CommitList.tsx`** — Replace line 252's raw `{f.path}` with `<TruncatedPath path={f.path} />`
3. **Update `BranchChanges.tsx`** — Replace line 242-244's raw path rendering with `<TruncatedPath>`; handle rename (`oldPath → path`) display
4. **Update `BranchFileDiff.tsx`** — Replace truncated file path span if applicable
5. **Add tests** — Unit test for `TruncatedPath` component (renders filename, truncates prefix, shows tooltip)

## Affected Files

- `packages/coc/src/server/spa/client/react/shared/TruncatedPath.tsx` (new)
- `packages/coc/src/server/spa/client/react/repos/CommitList.tsx`
- `packages/coc/src/server/spa/client/react/repos/BranchChanges.tsx`
- `packages/coc/src/server/spa/client/react/repos/BranchFileDiff.tsx`
- `packages/coc/test/spa/react/shared/TruncatedPath.test.tsx` (new)

## Notes

- The `shortenFilePath()` utility in `file-path-utils.ts` already strips common home-directory prefixes — the new component should work with pre-shortened paths too.
- The `FilePathLink` component in `shared/` is for interactive path links with preview popups — different concern, no conflict.
