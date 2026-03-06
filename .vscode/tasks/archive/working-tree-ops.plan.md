# Plan: Working Tree Operations for pipeline-core Git Module

## Problem

`pipeline-core`'s git module has no working-tree mutation operations. The VS Code extension
currently relies on VS Code's Git API for staging/unstaging/discarding. To make these
operations available to CoC pipelines (and decouple from VS Code), pipeline-core needs
equivalent pure-Node.js implementations.

## Scope

Implement the following five functions (commit is **excluded** per user request):

| Function | Git command |
|---|---|
| `stageFile(repoRoot, filePath)` | `git add -- <file>` |
| `unstageFile(repoRoot, filePath)` | `git reset HEAD -- <file>` |
| `discardChanges(repoRoot, filePath)` | `git checkout -- <file>` |
| `deleteUntrackedFile(repoRoot, filePath)` | `fs.unlinkSync` (filesystem delete, not git) |
| `getAllChanges(repoRoot)` | `git status --porcelain` → `GitChange[]` |

## Approach

### New file: `packages/pipeline-core/src/git/working-tree-service.ts`

Create a `WorkingTreeService` class following the same pattern as `BranchService`:
- Use `execGit(args, repoRoot)` from `exec.ts` for all git commands.
- Use Node's `fs.unlinkSync` for `deleteUntrackedFile`.
- Return `GitOperationResult` (`{ success, error? }`) for mutation operations.
- Return `GitChange[]` for `getAllChanges`.

### `getAllChanges` parsing

Parse `git status --porcelain` output:
- Each line is `XY filename` (or `XY oldname -> newname` for renames).
- `X` = staged status, `Y` = unstaged status.
- Map to existing `GitChange` type (already has `filePath`, `status`, `stage`, `repositoryRoot`, `repositoryName`).
- Emit two `GitChange` entries for a file that appears in both staged and unstaged columns.
- `repositoryName` = `path.basename(repoRoot)`.

Porcelain status code mapping (reuse existing `GitChangeStatus` from `types.ts`):
```
M → 'modified', A → 'added', D → 'deleted', R → 'renamed',
C → 'copied', U → 'conflict', ? → 'untracked'
```

### Update `index.ts`

Export `WorkingTreeService` from `packages/pipeline-core/src/git/index.ts`.

## Files to Change

| File | Change |
|---|---|
| `packages/pipeline-core/src/git/working-tree-service.ts` | **Create** — new service class |
| `packages/pipeline-core/src/git/index.ts` | **Edit** — add export for `WorkingTreeService` |

## Implementation Notes

- `unstageFile` uses `git reset HEAD -- <file>`. For repos with no commits yet, this
  command fails; consider falling back to `git rm --cached -- <file>` in that case.
- `discardChanges` is destructive and irreversible; no extra guard needed (callers decide).
- `deleteUntrackedFile` should verify the file exists before deleting and surface a clear
  error if not.
- All file paths passed to git commands should be relative to `repoRoot` (or absolute — git
  handles both, but relative is safer cross-platform).
- Follow the existing async pattern used in `BranchService` where operations that may block
  are wrapped with `execAsync`.

## Test Coverage

Add Vitest tests in `packages/pipeline-core/src/git/working-tree-service.test.ts`:
- Unit-test `getAllChanges` parser with mocked `execGit` output strings covering all
  status codes, renames, and mixed staged/unstaged scenarios.
- Integration-style tests for mutation functions using a temp git repo (init → add file →
  call service method → verify with `git status`).

## Out of Scope

- `commit()` — excluded per user request.
- Push / pull / fetch — separate concern.
- Conflict resolution — out of scope.
