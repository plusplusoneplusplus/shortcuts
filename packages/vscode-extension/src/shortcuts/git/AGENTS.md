# Git Module - Developer Reference

This module provides Git integration for the extension, including status monitoring, commit history, staging operations, and tree view rendering. It serves as the foundation for Git-related features like diff review and code review.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      VSCode Tree View                           │
│              (Git Changes Panel in Side Bar)                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Provides data
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Git Module                                │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │              TreeDataProvider                               ││
│  │  - Staged/Unstaged/Untracked sections                       ││
│  │  - Commit history with file changes                         ││
│  │  - Search and filter support                                ││
│  └─────────────────────────────────────────────────────────────┘│
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │   GitService    │  │ GitLogService   │  │  Tree Items     │ │
│  │  (Git status)   │  │ (Commit history)│  │  (UI elements)  │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Uses VSCode Git API
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    VSCode Git Extension                         │
└─────────────────────────────────────────────────────────────────┘
```

## Key Components

### GitService

Core service for interacting with Git through VSCode's Git extension API.

```typescript
import { GitService } from '../git';

// Get the singleton instance
const gitService = GitService.getInstance();

// Get repository for a workspace
const repo = gitService.getRepository(workspacePath);

// Get current status
const status = await gitService.getStatus(repo);

// Get staged files
const staged = status.indexChanges;

// Get unstaged files
const unstaged = status.workingTreeChanges;

// Stage a file
await gitService.stage(repo, filePath);

// Unstage a file
await gitService.unstage(repo, filePath);
```

### GitLogService

Service for retrieving and parsing commit history.

```typescript
import { GitLogService } from '../git';

const logService = new GitLogService();

// Get recent commits
const commits = await logService.getCommits(repoPath, {
    maxCount: 50,
    skip: 0
});

// Get commit details
const commit = await logService.getCommit(repoPath, commitHash);

// Get files changed in a commit
const files = await logService.getCommitFiles(repoPath, commitHash);

// Get diff for a specific file in a commit
const diff = await logService.getFileDiff(repoPath, commitHash, filePath);
```

### BranchService

Service for branch operations: list, search, switch, create, delete, rename branches; stash/pop; fetch/pull/push.

```typescript
import { BranchService } from '../git';

const branchService = new BranchService(gitService);

// List all branches
const branches = await branchService.listBranches(repoPath);

// Search branches by name
const matching = await branchService.searchBranches(repoPath, 'feature');

// Switch to a branch
await branchService.switchBranch(repoPath, 'feature/new-feature');

// Create a new branch
await branchService.createBranch(repoPath, 'feature/new-feature', 'main');

// Delete a branch
await branchService.deleteBranch(repoPath, 'old-branch', true); // force delete

// Rename a branch
await branchService.renameBranch(repoPath, 'old-name', 'new-name');

// Stash changes
await branchService.stash(repoPath, 'Stash message');

// Pop stash
await branchService.popStash(repoPath, 0); // index 0

// Fetch from remote
await branchService.fetch(repoPath, 'origin');

// Pull from remote
await branchService.pull(repoPath, 'origin', 'main');

// Push to remote
await branchService.push(repoPath, 'origin', 'main');
```

### GitRangeService

Service for commit range analysis: default remote branch detection, changed files in range, diff statistics.

```typescript
import { GitRangeService } from '../git';

const rangeService = new GitRangeService(gitService);

// Get default remote branch
const defaultBranch = await rangeService.getDefaultRemoteBranch(repoPath);
// Returns: 'origin/main' or 'origin/master'

// Get changed files in commit range
const files = await rangeService.getChangedFilesInRange(
    repoPath,
    'abc123',  // from commit
    'def456'   // to commit
);

// Get diff statistics for range
const stats = await rangeService.getDiffStatistics(
    repoPath,
    'abc123',
    'def456'
);
// Returns: { additions: 100, deletions: 50, files: 5 }

// Analyze commit range
const analysis = await rangeService.analyzeRange(
    repoPath,
    { from: 'abc123', to: 'def456' }
);
```

### TreeDataProvider

The main tree data provider for the Git changes panel.

```typescript
import { GitTreeDataProvider } from '../git';

// Create provider
const provider = new GitTreeDataProvider(gitService, logService);

// Register with VSCode
vscode.window.createTreeView('workspaceShortcuts.gitChanges', {
    treeDataProvider: provider,
    dragAndDropController: new GitDragDropController()
});

// Refresh the tree
provider.refresh();

// Set search filter
provider.setSearchFilter('auth');
```

### Tree Items

Various tree item classes for different Git entities:

```typescript
import {
    GitChangeItem,              // Individual file change
    GitCommitItem,              // Commit entry
    GitCommitFileItem,          // File within a commit
    BranchItem,                 // Branch entry
    BranchChangesSectionItem,   // Section for branch changes
    GitRangeFileItem,           // File within a commit range
    GitCommitRangeItem,         // Commit range entry
    LookedUpCommitItem,         // Searched/looked-up commit
    LookedUpCommitsSectionItem, // Section for looked-up commits
    SectionHeaderItem,          // Section headers (Staged, Unstaged, etc.)
    StageSectionItem,           // Staging sections
    LoadMoreItem                // Pagination item
} from '../git';
```

### GitShowTextDocumentProvider

Virtual document provider for viewing file contents at specific commits.

```typescript
import { GitShowTextDocumentProvider } from '../git';

// Register the provider
const provider = new GitShowTextDocumentProvider();
vscode.workspace.registerTextDocumentContentProvider('git-show', provider);

// Open file at specific commit
const uri = vscode.Uri.parse(`git-show:${commitHash}/${filePath}`);
await vscode.commands.executeCommand('vscode.open', uri);
```

## Usage Examples

### Example 1: Getting Pending Changes

```typescript
import { GitService } from '../git';

async function getPendingChanges(workspacePath: string) {
    const gitService = GitService.getInstance();
    const repo = gitService.getRepository(workspacePath);
    
    if (!repo) {
        throw new Error('No Git repository found');
    }
    
    const status = await gitService.getStatus(repo);
    
    return {
        staged: status.indexChanges.map(c => ({
            path: c.uri.fsPath,
            status: c.status
        })),
        unstaged: status.workingTreeChanges.map(c => ({
            path: c.uri.fsPath,
            status: c.status
        })),
        untracked: status.untrackedChanges.map(c => ({
            path: c.uri.fsPath
        }))
    };
}
```

### Example 2: Getting Commit Diff

```typescript
import { GitLogService } from '../git';

async function getCommitDiff(repoPath: string, commitHash: string) {
    const logService = new GitLogService();
    
    // Get full diff
    const diff = await logService.getCommitDiff(repoPath, commitHash);
    
    // Or get diff for specific file
    const fileDiff = await logService.getFileDiff(
        repoPath,
        commitHash,
        'src/auth/login.ts'
    );
    
    return { fullDiff: diff, fileDiff };
}
```

### Example 3: Implementing Drag and Drop

```typescript
import { GitDragDropController } from '../git';

const controller = new GitDragDropController();

// Handle drop from Git tree to Shortcuts tree
controller.handleDrop = async (target, sources, token) => {
    for (const source of sources) {
        if (source instanceof GitChangeItem) {
            // Add file to shortcuts group
            await addToGroup(target, source.resourceUri);
        } else if (source instanceof GitCommitItem) {
            // Add commit reference to group
            await addCommitToGroup(target, source.commit);
        }
    }
};
```

### Example 4: Custom Commit Search

```typescript
import { GitLogService } from '../git';

async function searchCommits(repoPath: string, query: string) {
    const logService = new GitLogService();
    
    // Search by message
    const byMessage = await logService.searchCommits(repoPath, {
        grep: query,
        maxCount: 20
    });
    
    // Search by author
    const byAuthor = await logService.searchCommits(repoPath, {
        author: query,
        maxCount: 20
    });
    
    // Look up specific commit hash
    const byHash = await logService.getCommit(repoPath, query);
    
    return { byMessage, byAuthor, byHash };
}
```

## Types

### GitStatus

```typescript
interface GitStatus {
    /** Staged changes */
    indexChanges: Change[];
    /** Unstaged changes */
    workingTreeChanges: Change[];
    /** Untracked files */
    untrackedChanges: Change[];
    /** Current HEAD */
    HEAD?: Ref;
    /** Number of commits ahead */
    ahead?: number;
    /** Number of commits behind */
    behind?: number;
}
```

### GitCommit

```typescript
interface GitCommit {
    /** Full commit hash */
    hash: string;
    /** Short hash (7 chars) */
    shortHash: string;
    /** Commit message subject */
    subject: string;
    /** Full commit message */
    message: string;
    /** Author name */
    authorName: string;
    /** Author email */
    authorEmail: string;
    /** Commit date */
    date: Date;
    /** Parent commit hashes */
    parents: string[];
}
```

### GitFileChange

```typescript
interface GitFileChange {
    /** File path relative to repo root */
    path: string;
    /** Change status: A (added), M (modified), D (deleted), R (renamed) */
    status: string;
    /** Original path (for renames) */
    originalPath?: string;
    /** Number of additions */
    additions?: number;
    /** Number of deletions */
    deletions?: number;
}
```

## Tree View Structure

```
Git Changes
├── 📁 Staged Changes (2)
│   ├── 📄 src/auth/login.ts [M]
│   └── 📄 src/auth/logout.ts [A]
├── 📁 Unstaged Changes (1)
│   └── 📄 src/config.ts [M]
├── 📁 Untracked Files (1)
│   └── 📄 test/new-test.ts
└── 📜 Recent Commits
    ├── abc1234 - Add authentication (2 hours ago)
    │   ├── 📄 src/auth/login.ts
    │   └── 📄 src/auth/logout.ts
    ├── def5678 - Fix bug (1 day ago)
    └── ⋯ Load more commits
```

## Best Practices

1. **Use the singleton**: Access `GitService` through `getInstance()` to share state.

2. **Handle missing repos**: Always check if a repository exists before operations.

3. **Refresh efficiently**: Use targeted refresh rather than full tree refresh when possible.

4. **Cache appropriately**: Cache commit data but invalidate on repository changes.

5. **Handle large histories**: Use pagination (`LoadMoreItem`) for commit history.

6. **Cross-platform paths**: Use `path.posix` for Git paths to ensure consistency.

## Events

```typescript
// Listen for Git status changes
gitService.onDidChangeStatus((repo) => {
    console.log('Git status changed');
    treeProvider.refresh();
});

// Listen for repository changes
gitService.onDidChangeRepository((repo) => {
    console.log('Repository changed:', repo.rootUri.fsPath);
});
```

## Module Files

| File | Purpose |
|------|---------|
| `git-service.ts` | `GitService` singleton: VS Code Git extension abstraction, status, stage/unstage |
| `git-log-service.ts` | `GitLogService`: commit history, search, filtering, commit details/files/diff |
| `git-range-service.ts` | `GitRangeService`: commit range analysis, default remote branch, changed files, diff stats |
| `branch-service.ts` | `BranchService`: list/search/switch/create/delete/rename branches; stash/pop; fetch/pull/push |
| `tree-data-provider.ts` | `GitTreeDataProvider`: staged/unstaged/untracked, commit history (paginated), branch status |
| `git-show-text-document-provider.ts` | Read-only file content from commits via `ReadOnlyDocumentProvider` with `GitContentStrategy` |
| `types.ts` | Git types: `GitChange`, `GitCommit`, `GitCommitFile`, `GitCommitRange`, `GitRepository`, etc. |
| `index.ts` | Module exports |

### Additional Tree Items

| Item | Purpose |
|------|---------|
| `BranchItem` | Current branch display |
| `BranchChangesSectionItem` | Branch changes section header |
| `GitCommitRangeItem` | Commit range display |
| `GitRangeFileItem` | File within a commit range |
| `LookedUpCommitItem` | Searched/looked-up commit |
| `LookedUpCommitsSectionItem` | Section for looked-up commits |
| `SectionHeaderItem` | Generic section headers |
| `StageSectionItem` | Staging section items |
| `LoadMoreItem` | Pagination for commit history |
| `GitDragDropController` | Drag and drop for git tree view items |

## See Also

- `src/shortcuts/git-diff-comments/AGENTS.md` - Diff commenting feature
- `src/shortcuts/code-review/AGENTS.md` - Code review against rules
- VSCode Git Extension API documentation
