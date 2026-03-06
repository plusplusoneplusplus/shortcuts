---
status: pending
---

# 006: Remove superseded string-scanning tests

## Summary
Delete the 6 SPA test files whose string-scanning approach (fs.readFileSync source checks and getClientBundle() substring matches) has been fully replaced by real React component/hook unit tests in commits 002–005. Clean up `spa-test-helpers.ts` by removing dead exports.

## Motivation
Keeping string-scanning tests alongside the new behavioral tests creates a dual-maintenance burden: they break on harmless renames, add no coverage beyond what the real tests provide, and slow CI. This commit removes the redundant layer while preserving the 3 test files that *are* appropriate (bundle safety, HTML generation, escapeHtml).

## Changes

### Files to Create
(none)

### Files to Modify
- `packages/coc/test/server/spa-test-helpers.ts` — Remove the `getClientCssBundle` function and the `getAllModels` re-export. Both are dead code: no test file imports them (confirmed via grep). Keep `getClientBundle` (used by `spa-browser-bundle-safety.test.ts`), `generateDashboardHtml` (used by `spa-html.test.ts`), and `escapeHtml` (used by `spa-helpers.test.ts`).

### Files to Delete
- `packages/coc/test/server/spa-tasks-miller-nav.test.ts` — 4 describe blocks (React TaskTree Miller columns, TaskTreeItem file/folder rendering, useQueueActivity hook, TaskTree queue activity integration) all use `fs.readFileSync` to check that source files contain specific strings. Superseded by commit 003 (TaskTreeItem props-only rendering tests) and commit 005 (TaskTree Miller-columns navigation context tests with simulated column state).
- `packages/coc/test/server/spa-tasks-copy-path.test.ts` — 1 describe block scanning TaskActions.tsx source for "Copy path", "clipboard", "/open-file" strings. Superseded by commit 004 (useFileActions and copy-path fetch-based hook tests that verify actual fetch calls and clipboard interaction).
- `packages/coc/test/server/spa-tasks-context-file-filtering.test.ts` — 3 describe blocks scanning the esbuild bundle (`getClientBundle()`) for `isContextFile`, `CONTEXT_FILES`, and individual filenames. Superseded by commit 002 (pure function tests that import `isContextFile` and `CONTEXT_FILES` directly and assert real return values).
- `packages/coc/test/server/spa-file-context-menu.test.ts` — 5 describe blocks scanning source files (useFileActions.ts, FileMoveDialog.tsx, TaskTreeItem.tsx, TaskTree.tsx, TasksPanel.tsx) for string markers. Superseded by commit 003 (FileMoveDialog props-only rendering tests) and commit 004 (useFileActions fetch-based tests verifying rename/archive/delete/move fetch calls).
- `packages/coc/test/server/spa-pending-task-info.test.ts` — 1 describe block scanning the bundle for PendingTaskInfoPanel strings ("Task ID", "Cancel Task", "promptContent", etc.). Superseded by commit 005 (PendingTaskInfo context-based rendering tests that mount the component with React context and assert DOM output).
- `packages/coc/test/server/spa-repo-queue-history.test.ts` — 1 describe block scanning the bundle for "/queue/history?repoId=" endpoint string. Superseded by commit 005 (RepoQueueTab fetch-based tests that verify the hook actually calls the history endpoint via mocked fetch).

## Implementation Notes
- **Order matters:** Run the full test suite *before* deleting anything to confirm baseline. Then delete files, modify helpers, and re-run.
- **getClientBundle stays:** `spa-browser-bundle-safety.test.ts` still uses it to verify no Node built-in `__require()` calls leak into the browser bundle. This is a legitimate bundle-level test that can't be replaced by component tests.
- **getClientCssBundle is dead:** Defined in helpers but never imported by any test file. Remove it.
- **getAllModels is dead:** Re-exported from helpers but never imported by any test file. Remove it.
- **No import changes needed in kept files:** `spa-html.test.ts`, `spa-helpers.test.ts`, and `spa-browser-bundle-safety.test.ts` only import `generateDashboardHtml`, `escapeHtml`, and `getClientBundle` respectively — all of which remain in the trimmed helpers file.

## Tests
- Run `npm run test` from repo root (or `npx vitest run` in `packages/coc/`) before and after changes
- Verify the 3 kept SPA test files still pass: `spa-browser-bundle-safety.test.ts`, `spa-html.test.ts`, `spa-helpers.test.ts`
- Verify no other test file has a broken import referencing deleted files (grep for deleted filenames in import statements)
- Confirm test count decreases but no new failures appear

## Acceptance Criteria
- [ ] All 6 superseded test files are deleted
- [ ] `spa-test-helpers.ts` retains only `getClientBundle`, `generateDashboardHtml`, and `escapeHtml` exports
- [ ] `getClientCssBundle` function and `getAllModels` re-export are removed from helpers
- [ ] `spa-browser-bundle-safety.test.ts` passes (still imports `getClientBundle`)
- [ ] `spa-html.test.ts` passes (still imports `generateDashboardHtml`)
- [ ] `spa-helpers.test.ts` passes (still imports `escapeHtml`)
- [ ] No broken imports across the entire test suite
- [ ] Full test suite passes with no new failures

## Dependencies
- Depends on: 002, 003, 004, 005

## Assumed Prior State
All replacement tests from commits 002–005 are in place and passing. The string-scanning tests are now redundant.
