# Commit-Level Diff Syntax Highlighting

## Problem

When viewing a commit-level diff in the CoC Git tab (clicking a commit in the history), the right panel shows the full diff for all files in the commit **without syntax highlighting**. However, clicking a specific file within the commit shows the file-level diff **with syntax highlighting**.

The root cause is in `UnifiedDiffViewer.tsx`: syntax highlighting depends on the `fileName` prop to detect the language. For commit-level diffs, `CommitDetail.tsx` passes `fileName=undefined` (since the diff spans multiple files), so `getLanguageFromFileName(undefined)` returns `null` and all code lines fall through to plain `escapeHtml`.

## Proposed Approach

Modify `UnifiedDiffViewer` to parse `diff --git a/<path> b/<path>` header lines and dynamically switch the highlight language per file section. This keeps the fix self-contained in the diff viewer — no changes needed to `CommitDetail` or the API.

**Key files:**
- `packages/coc/src/server/spa/client/react/repos/UnifiedDiffViewer.tsx` — main change
- `packages/coc/src/server/spa/client/react/repos/useSyntaxHighlight.ts` — already has `getLanguageFromFileName`
- `packages/coc/test/spa/react/repos/UnifiedDiffViewer.test.tsx` — add/update tests

## Acceptance Criteria

1. Commit-level diffs render with per-file syntax highlighting (language switches at each `diff --git` boundary)
2. File-level diffs continue to work exactly as before (no regression)
3. Files with unrecognized extensions gracefully fall back to plain text (current `escapeHtml` behavior)
4. Meta lines (`diff --git`, `index`, `---`, `+++`) remain unstyled (current behavior preserved)
5. Performance is acceptable for large commits (many files)
6. Existing tests pass; new tests cover the multi-file highlight switching

## Subtasks

### 1. ~~Parse file path from `diff --git` headers in `UnifiedDiffViewer`~~ ✅
When `fileName` is not provided (commit-level diff), parse lines matching `diff --git a/<path> b/<path>` to extract the file path. Use `getLanguageFromFileName` on the extracted path to determine the language for subsequent lines until the next `diff --git` header.

**Implementation detail:** Instead of computing `language` once via `useMemo`, process lines in a single pass that tracks the "current file" and switches language at each `diff --git` boundary. This can be done by pre-computing a `languagePerLine` array or by grouping lines into file sections.

### 2. ~~Update tests~~ ✅
Add test cases in the existing test file for:
- Multi-file diff with different languages (e.g., `.ts` + `.py` sections) — verify each section gets correct highlighting
- Multi-file diff where one file has an unrecognized extension — verify graceful fallback
- Single-file diff without `fileName` prop — verify it still extracts language from the `diff --git` header
- Ensure existing tests for file-level diffs (with explicit `fileName`) still pass

## Notes

- The `diff --git` line format is: `diff --git a/<path> b/<path>`. The `b/` path is preferred for language detection (it's the "after" path, relevant for renames).
- `highlightLine` already handles `language=null` gracefully (returns `escapeHtml`), so sections with unknown file types will simply not be highlighted — no risk of errors.
- hljs `ignoreIllegals: true` is already set, so partial lines in diffs won't cause issues.
- Performance: `getLanguageFromFileName` is a simple map lookup, called once per `diff --git` header (not per line), so negligible cost.
