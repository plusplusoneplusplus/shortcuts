# Working Tree: File Clipboard Copy & Right-Panel Diff

## Problem

In the CoC Git tab's **Working Changes** section (Staged / Changes / Untracked), two features are missing:

1. **No clipboard copy** — file path cannot be copied from a file row.
2. **No right-panel diff** — clicking a file does nothing; the right panel stays empty. The `BranchChanges` and commit list both show diffs on file click, but `WorkingTree` has no such wiring.

Root causes:
- `WorkingTree` has no `onFileSelect` prop and `FileRow` has no `onClick`.
- No backend endpoint exists for working-tree file diffs (`git diff --staged` / `git diff`).
- `RepoGitTab` never passes a file-select handler to `WorkingTree`.

---

## Acceptance Criteria

- [ ] Clicking a staged or unstaged file in **Working Changes** opens its diff in the right panel.
- [ ] The diff correctly shows `git diff --staged -- <file>` for staged files and `git diff -- <file>` for unstaged files.
- [ ] Untracked files show the full file content as a pure-addition diff (or a clear "untracked – no diff" message).
- [ ] Each file row in **Working Changes** shows a **Copy Path** button on hover (consistent with the copy-hash pattern used in commit rows).
- [ ] Clicking **Copy Path** copies the relative file path to the clipboard and briefly shows "Copied!".
- [ ] The right panel diff viewer is the existing `UnifiedDiffViewer` (no new viewer needed).
- [ ] No regressions to existing staging / unstaging / discard actions.

---

## Subtasks

### 1 — `pipeline-core`: Add working-tree file diff helpers

**File:** `packages/pipeline-core/src/git/working-tree-service.ts`

- Add `getFileDiff(repoRoot, filePath, staged: boolean): string`
  - staged → `git -C <root> diff --staged -- <file>`
  - unstaged → `git -C <root> diff -- <file>`
- Export the new method from the barrel (`packages/pipeline-core/src/git/index.ts`).

### 2 — `coc-server`: Add diff API endpoint

**File:** `packages/coc-server/src/api-handler.ts`

- Register new route:
  ```
  GET /api/workspaces/:id/git/changes/files/*/diff?stage=staged|unstaged
  ```
- Call `workingTreeService.getFileDiff(ws.rootPath, filePath, staged)`.
- Return `{ diff: string, path: string }` (same shape as branch-range diff endpoint).

### 3 — `WorkingTree`: Make `FileRow` clickable + add Copy Path

**File:** `packages/coc/src/server/spa/client/react/repos/WorkingTree.tsx`

- Add `onFileSelect?: (path: string, stage: 'staged' | 'unstaged' | 'untracked') => void` prop.
- In `FileRow`, add `onClick` that calls `onFileSelect(file.path, file.stage)` when prop is present.
- Add a **Copy Path** hover button (reuse `copyToClipboard` from `utils/format.ts`) with "Copied!" feedback state — same UX as the copy-hash button in `CommitTooltip`.
- Style: file row becomes visually selectable (cursor pointer, hover background) when `onFileSelect` is provided.

### 4 — `RepoGitTab`: Wire up right-panel view for working-tree files

**File:** `packages/coc/src/server/spa/client/react/repos/RepoGitTab.tsx`

- Add new `rightPanelView` variant: `{ type: 'working-tree-file'; filePath: string; stage: 'staged' | 'unstaged' | 'untracked' }`.
- Add `handleWorkingTreeFileSelect(path, stage)` handler that sets this view.
- Pass `onFileSelect={handleWorkingTreeFileSelect}` to `<WorkingTree>`.
- In right-panel render, delegate to new `WorkingTreeFileDiff` component (subtask 5).

### 5 — New component: `WorkingTreeFileDiff`

**File:** `packages/coc/src/server/spa/client/react/repos/WorkingTreeFileDiff.tsx`

- Props: `workspaceId`, `filePath`, `stage`.
- Fetches `GET /api/workspaces/:id/git/changes/files/<path>/diff?stage=<stage>`.
- Renders result in `<UnifiedDiffViewer>` (same as `BranchFileDiff`).
- For `untracked` stage, show a placeholder message ("Untracked file – no diff available") or fetch raw content if feasible.
- Shows loading spinner and error state.

---

## Notes

- The `stage` query param distinguishes staged (`--staged`) vs unstaged (working-tree HEAD) diffs. Untracked files have no meaningful diff; a message is acceptable.
- `copyToClipboard` utility already handles the `navigator.clipboard` + `execCommand` fallback — no new utility needed.
- Keep the diff endpoint consistent with the existing `branch-range/files/*/diff` shape so the same `UnifiedDiffViewer` can be reused unchanged.
- Test with: staged modification, unstaged modification, renamed file, binary file (expect empty diff or graceful message).
