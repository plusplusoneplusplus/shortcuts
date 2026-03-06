# Git Feature Gap: CoC vs VS Code Extension

## Context

`pipeline-core/src/git/` is the shared pure-Node.js git layer with three services:
- **BranchService** — Full branch lifecycle (CRUD, push/pull/fetch, stash, merge)
- **GitLogService** — Commit history, diffs, file content at revisions
- **GitRangeService** — Commit range analysis, merge base, feature branch detection

The VS Code extension consumes all three plus a VS Code-specific `GitService` for staging.
CoC barely touches this layer.

---

## What CoC Currently Uses

| Capability | How |
|---|---|
| Repo root discovery | `git rev-parse --show-toplevel` (raw exec, not pipeline-core) |
| Current branch name | `git rev-parse --abbrev-ref HEAD` (raw exec) |
| Dirty status | `git status --porcelain` (raw exec) |
| Ahead/behind counts | `git rev-list --left-right --count` (raw exec) |
| Remote URL | `git remote get-url origin` (raw exec) |

**Key observation:** CoC doesn't import `BranchService`, `GitLogService`, or `GitRangeService` from pipeline-core at all. It uses raw `git` commands for basic metadata.

---

## Feature Gap Matrix

### 🔴 Not Available in CoC (available in VS Code extension)

| Feature | VS Code Extension | pipeline-core Support |
|---|---|---|
| **File staging** | `stageFile()` | ❌ Not in pipeline-core (VS Code API) |
| **File unstaging** | `unstageFile()` | ❌ Not in pipeline-core (VS Code API) |
| **Discard changes** | `discardChanges()` | ❌ Not in pipeline-core (VS Code API) |
| **Delete untracked files** | `deleteUntrackedFile()` | ❌ Not in pipeline-core (VS Code API) |
| **View commit history** | Paginated tree view | ✅ `GitLogService.getCommits()` |
| **View commit details** | Click to expand | ✅ `GitLogService.getCommit()` |
| **View commit diffs** | Inline diff viewer | ✅ `GitLogService.getCommitDiff()` |
| **View file at revision** | Read-only document | ✅ `GitLogService.getFileContentAtCommit()` |
| **View pending changes diff** | Tree section | ✅ `GitLogService.getPendingChangesDiff()` |
| **View staged changes diff** | Tree section | ✅ `GitLogService.getStagedChangesDiff()` |
| **Lookup commit by ref** | Quick pick UI | ✅ `GitLogService.validateRef()` |
| **List branches** | Branch items | ✅ `BranchService.getAllBranches()` |
| **Switch branch** | Context menu | ✅ `BranchService.switchBranch()` |
| **Create branch** | Context menu | ✅ `BranchService.createBranch()` |
| **Delete branch** | Context menu | ✅ `BranchService.deleteBranch()` |
| **Rename branch** | Context menu | ✅ `BranchService.renameBranch()` |
| **Merge branch** | Context menu | ✅ `BranchService.mergeBranch()` |
| **Push** | Context menu | ✅ `BranchService.push()` |
| **Pull** | Context menu | ✅ `BranchService.pull()` |
| **Fetch** | Context menu | ✅ `BranchService.fetch()` |
| **Stash/Pop** | Auto-stash on switch | ✅ `BranchService.stashChanges()/popStash()` |
| **Feature branch range detection** | Auto-detect vs default | ✅ `GitRangeService.detectCommitRange()` |
| **Range diff / changed files** | Branch changes section | ✅ `GitRangeService.getChangedFiles()` |
| **Diff comments integration** | Code review comments | N/A (VS Code-specific) |
| **Drag files to Copilot Chat** | Drag & drop controller | N/A (VS Code-specific) |
| **Multi-repo support** | All open repos | Partial (repo discovery exists) |

### ✅ Available in Both (but CoC uses raw git, not pipeline-core)

| Feature | CoC Implementation | pipeline-core Alternative |
|---|---|---|
| Current branch | Raw `git rev-parse` | `GitRangeService.getCurrentBranch()` |
| Ahead/behind | Raw `git rev-list` | `BranchService.getBranchStatus()` |
| Dirty status | Raw `git status` | `BranchService.hasUncommittedChanges()` |
| Remote URL | Raw `git remote` | _(not in pipeline-core)_ |

---

## Categorized Gaps

### Gap 1: Commit History & Diffs (High Value, Ready to Use)
pipeline-core already has full support. CoC just needs to wire up API endpoints.
- View paginated commit history
- View commit details and file changes
- View diffs (commit, pending, staged)
- View file content at any revision
- Lookup commits by hash/branch/tag/ref

### Gap 2: Branch Management (High Value, Ready to Use)
pipeline-core has complete BranchService. CoC needs API endpoints + dashboard UI.
- List local/remote branches (with pagination & search)
- Switch, create, delete, rename branches
- Merge, push, pull, fetch
- Stash management

### Gap 3: Working Tree Operations (Requires New Code)
VS Code extension uses VS Code's Git API for staging. pipeline-core has NO equivalent.
To close this gap, pipeline-core needs:
- `stageFile(repoRoot, filePath)` — `git add <file>`
- `unstageFile(repoRoot, filePath)` — `git reset HEAD <file>`
- `discardChanges(repoRoot, filePath)` — `git checkout -- <file>`
- `deleteUntrackedFile(repoRoot, filePath)` — filesystem delete
- `getAllChanges(repoRoot)` — `git status --porcelain` parsed into structured data
- `commit(repoRoot, message)` — `git commit -m <message>`

### Gap 4: Feature Branch Analysis (Medium Value, Ready to Use)
pipeline-core has GitRangeService. CoC can expose:
- Auto-detect feature branch vs default branch
- Show all changed files in the branch
- Aggregate diff stats (additions/deletions)
- Per-file diffs in the range

### Gap 5: CoC Should Migrate to pipeline-core APIs
Current raw git commands in coc-server should be replaced with pipeline-core services:
- `git rev-parse --abbrev-ref HEAD` → `GitRangeService.getCurrentBranch()`
- `git status --porcelain` → `BranchService.hasUncommittedChanges()`
- `git rev-list --left-right --count` → `BranchService.getBranchStatus()`

---

## Recommended Priority

1. **Migrate CoC to use pipeline-core git services** (low effort, reduces duplication)
2. **Add commit history & diff APIs to coc-server** (high value, pipeline-core ready)
3. **Add branch management APIs to coc-server** (high value, pipeline-core ready)
4. **Add working tree service to pipeline-core** (stage/unstage/discard/commit — new code needed)
5. **Add feature branch analysis APIs** (medium value, pipeline-core ready)
