# Plan: Click on File Shows Diff in Right Panel

## Problem

In the Git tab's **Branch Changes** section (left panel), clicking a file currently
inline-expands a `<pre>` diff accordion beneath the file row — inside the left panel.
The right panel always shows a full commit diff (`CommitDetail`).

The desired behavior: clicking a file in **Branch Changes** should display that file's
diff in the **right panel**, consistent with how commit diffs are shown.

## Current Architecture

```
RepoGitTab
 ├── <aside> (left, w-320px)
 │    ├── GitPanelHeader
 │    ├── BranchChanges          ← toggleFileDiff() → inline <pre> expansion
 │    ├── CommitList (Unpushed)
 │    └── CommitList (History)
 └── <main> (right, flex-1)
      └── CommitDetail           ← always shows selected commit diff
```

**Relevant files:**
- `packages/coc/src/server/spa/client/react/repos/RepoGitTab.tsx` — layout, state
- `packages/coc/src/server/spa/client/react/repos/BranchChanges.tsx` — file list + inline diff
- `packages/coc/src/server/spa/client/react/repos/CommitDetail.tsx` — right panel commit diff

**Existing API endpoint for per-file branch diff:**
```
GET /workspaces/:workspaceId/git/branch-range/files/:filePath/diff
```

## Proposed Approach

Introduce a **discriminated union** for the right panel view in `RepoGitTab`, and
create a new `BranchFileDiff` component that renders a single file's diff in the
right panel using the existing API.

### Right-panel view state

```ts
type RightPanelView =
  | { type: 'commit'; commit: Commit }
  | { type: 'branch-file'; filePath: string };
```

`selectedCommit` becomes the initial value; clicking a branch file switches to
`{ type: 'branch-file', filePath }`. Clicking a commit switches back to
`{ type: 'commit', commit }`.

### Changes

#### 1. New `BranchFileDiff.tsx`

A focused right-panel component (mirrors `CommitDetail` structure):
- **Props:** `workspaceId: string`, `filePath: string`
- **Fetches:** `GET /workspaces/:wid/git/branch-range/files/:filePath/diff` on mount
- **Renders:** file path header → unified diff `<pre>` with loading/error/retry states
- **No line-limit truncation** (show full diff; keep consistent with `CommitDetail`)

#### 2. `BranchChanges.tsx`

- Add optional prop: `onFileSelect?: (filePath: string) => void`
- When `onFileSelect` is provided, clicking a file **calls `onFileSelect(filePath)`**
  instead of `toggleFileDiff` (remove inline diff expansion when a parent handler exists)
- Add visual **selected-file highlight** (e.g. `bg-accent` ring) matching the
  selected-commit highlight in `CommitList`
- Remove inline diff `<pre>` expansion logic when `onFileSelect` is in use
  (keep the old toggle path for backward-compatibility if `onFileSelect` is absent)

#### 3. `RepoGitTab.tsx`

- Replace `selectedCommit` state with a `rightPanelView: RightPanelView | null` state
- On data load / refresh: set `rightPanelView = { type: 'commit', commit: commits[0] }`
  (preserves existing auto-select behavior)
- Pass `onFileSelect` to `BranchChanges`:
  ```ts
  onFileSelect={(filePath) =>
    setRightPanelView({ type: 'branch-file', filePath })
  }
  ```
- Pass `onSelect` to `CommitList`:
  ```ts
  onSelect={(commit) =>
    setRightPanelView({ type: 'commit', commit })
  }
  ```
- Right panel render:
  ```tsx
  {rightPanelView?.type === 'commit' && (
    <CommitDetail key={rightPanelView.commit.hash} ... />
  )}
  {rightPanelView?.type === 'branch-file' && (
    <BranchFileDiff
      key={rightPanelView.filePath}
      workspaceId={workspaceId}
      filePath={rightPanelView.filePath}
    />
  )}
  ```

## Out of Scope

- Changes to `CommitDetail` or `CommitList`
- Backend API changes (endpoint already exists)
- Syntax highlighting for the diff view

## Files to Create / Modify

| Action | File |
|--------|------|
| **Create** | `packages/coc/src/server/spa/client/react/repos/BranchFileDiff.tsx` |
| **Modify** | `packages/coc/src/server/spa/client/react/repos/BranchChanges.tsx` |
| **Modify** | `packages/coc/src/server/spa/client/react/repos/RepoGitTab.tsx` |

## Tasks

1. ~~Create `BranchFileDiff.tsx` with fetch + render logic~~
2. ~~Add `onFileSelect` prop to `BranchChanges`; wire click → prop call; add selected highlight; keep inline expand as fallback~~
3. ~~Refactor `RepoGitTab` state to `rightPanelView` discriminated union~~
4. ~~Wire `onFileSelect` and updated `onSelect` in `RepoGitTab`; render right panel conditionally~~
5. ~~Smoke-test: clicking branch file shows diff in right panel; clicking commit switches back~~
