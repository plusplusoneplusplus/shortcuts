# Commit Range Review Feature

## Overview

The Commit Range Review feature provides a logical aggregation of multiple commits into a single reviewable unit in the Git tree view. This addresses the common workflow where developers push multiple commits to a feature branch and need to review all changes collectively against the base branch.

## Problem Statement

Currently, the Git view supports:
- Reviewing pending changes (staged/unstaged files)
- Reviewing individual commits and their diffs

**Missing capability:** Review all commits on a feature branch as a single logical unit, similar to how Pull Requests show "Files Changed" view.

### User Pain Points
1. Feature branches often contain multiple commits that need collective review
2. Reviewing commits one-by-one is tedious and loses context
3. Local main branch might be out of sync with remote, making local comparisons inaccurate
4. No easy way to see "what would be in my PR" before creating it

## Solution: Commit Range Item

Add a new tree item type in the Git view that represents a range of commits, displaying the cumulative diff across all commits in that range.

## UI Design

### Git Tree View Structure

```
▼ SHORTCUTS
  ▼ Changes (3)
    ▶ Staged (1)
    ▶ Unstaged (2)
  
  ▼ Branch Changes
    ▶ 📦 feature/auth-flow: 8 commits ahead of origin/main
       15 files changed • +450/-120
  
  ▼ Commits (5)
    ▶ abc1234 Latest commit message
    ▶ def5678 Previous commit
    ▶ ghi9012 Another commit
    ...
    
  ▼ Comments (2)
    ...
```

### Expanded Commit Range Item

When expanded, shows all files changed across the commit range:

```
▼ 📦 feature/auth-flow: 8 commits ahead of origin/main
   M src/auth/login.ts           (+120/-30)
   M src/auth/register.ts        (+80/-20)
   A src/auth/oauth.ts           (+200)
   D src/old-auth.ts             (-50)
   R src/utils.ts → utils2.ts    (+20/-20)
```

**File status prefixes:**
- `M` - Modified
- `A` - Added
- `D` - Deleted
- `R` - Renamed

### Range Item Display Format

**General format:** `{branch-name}: {count} commits ahead of {remote-default-branch}`

**Examples:**
- `feature/auth-flow: 8 commits ahead of origin/main`
- `bugfix/login: 3 commits ahead of origin/master`
- `main: 2 commits ahead of origin/main` (unpushed commits on main)
- `HEAD: 5 commits ahead of origin/main` (detached HEAD state)

### When Section Appears

The **"Branch Changes"** section is **automatically shown** when:
1. Current branch has commits not in the remote default branch
2. Comparison: `origin/main..HEAD` (or `origin/master..HEAD`)
3. Commit count > 0

**Section hidden when:**
- On default branch with no unpushed commits
- Current branch is up-to-date with remote default branch
- No remote tracking branch exists and no difference from local default branch

**Note:** The entire section (including header) is hidden when there are no branch changes to show, keeping the tree view clean.

## Comparison Logic

### Key Principle: Always Compare Against Remote

**Why `origin/main` instead of local `main`?**
- Local main branch may be behind remote
- Users want to see "what's in my PR" - which compares against remote
- More accurate representation of divergence

### Git Commands

**Find merge base:**
```bash
git merge-base HEAD origin/main
```

**Count commits ahead:**
```bash
git rev-list --count origin/main..HEAD
```

**Get changed files with stats:**
```bash
git diff --name-status origin/main...HEAD
git diff --stat origin/main...HEAD
```

**Get cumulative diff for a file:**
```bash
git diff origin/main...HEAD -- path/to/file
```

### Branch Detection

1. Detect current branch: `git rev-parse --abbrev-ref HEAD`
2. Detect default branch: Check for `origin/main` or `origin/master`
3. Calculate commits ahead: `git rev-list --count origin/{default}..HEAD`
4. If count > 0, show range item

## User Interactions

### Context Menu on Range Item

Right-click on range item:
```
📦 feature/auth-flow: 8 commits ahead of origin/main
  ├─ Review Against Rules          # Send all commits to AI code review
  ├─ Copy Commit Range             # Copy "origin/main...HEAD"
  ├─ Refresh Range                 # Recalculate stats
  └─ Copy Range Summary            # Copy summary text
```

### Context Menu on File Within Range

Right-click on file (e.g., `M src/auth/login.ts`):
```
M src/auth/login.ts
  ├─ Open with Diff Review         # Opens combined diff across all commits
  ├─ Open File                     # Opens current version in editor
  ├─ Copy Relative Path
  └─ Reveal in Explorer
```

### Clicking on File

Single-click on file → Opens **Diff Review Editor** showing:
- Combined diff from all commits in the range
- URI scheme: `git-range://{repoRoot}/{base}...{head}/{filePath}`
- Supports inline commenting with Ctrl+Shift+M (Cmd+Shift+M)

## Diff Review Editor

### Editor Header
```
┌─────────────────────────────────────────────────┐
│ Combined diff: origin/main...HEAD               │
│ src/auth/login.ts                               │
│                                                 │
│ 8 commits (abc1234...xyz7890) • +120/-30       │
└─────────────────────────────────────────────────┘
```

### Diff Content
- Shows unified diff of all changes across commits
- Uses `git diff origin/main...HEAD -- path/to/file`
- Syntax highlighting based on file type
- Line numbers shown for both old and new content

### Comments
- Comments anchored to line numbers in combined diff
- Stored with scope: `range:{base}:{head}:{filePath}`
- Comments persist across new commits (as long as range ref is valid)
- Displayed in "Comments" section of Git tree view

## Technical Implementation

### New Files

```
src/shortcuts/git/
├── git-commit-range-item.ts          # Tree item for commit range
├── git-range-diff-provider.ts        # Custom text document provider for range diffs
├── git-range-service.ts              # Service for range calculations
└── branch-changes-section-item.ts    # Section header for "Branch Changes"
```

### Modified Files

```
src/shortcuts/git/
├── tree-data-provider.ts             # Add "Branch Changes" section
├── git-log-service.ts                # Add range detection methods
└── types.ts                          # Add range-related types

src/shortcuts/git-diff-comments/
├── diff-comments-manager.ts          # Support range-scoped comments
└── diff-review-editor-provider.ts    # Handle range diff URIs
```

### Core Types

```typescript
/**
 * Represents a range of commits
 */
interface GitCommitRange {
    // Base reference (usually origin/main or origin/master)
    baseRef: string;
    
    // Head reference (usually HEAD or branch name)
    headRef: string;
    
    // Number of commits in range
    commitCount: number;
    
    // Files changed in range
    files: GitCommitRangeFile[];
    
    // Total line changes
    additions: number;
    deletions: number;
    
    // Merge base commit hash
    mergeBase: string;
    
    // Current branch name (if any)
    branchName?: string;
}

/**
 * File within a commit range
 */
interface GitCommitRangeFile {
    // File path relative to repository root
    path: string;
    
    // Change status
    status: GitChangeStatus;
    
    // Line changes for this file
    additions: number;
    deletions: number;
    
    // Old path (for renames)
    oldPath?: string;
}
```

### URI Scheme

Custom URI scheme for range diffs: `git-range://`

**Format:** `git-range://{repoRoot}/{baseRef}...{headRef}/{filePath}`

**Example:** `git-range:///Users/dev/project/origin/main...HEAD/src/auth/login.ts`

### Range Detection Algorithm

```typescript
async function detectCommitRange(repoRoot: string): Promise<GitCommitRange | null> {
    // 1. Get current branch
    const currentBranch = await getCurrentBranch(repoRoot);
    
    // 2. Detect default remote branch
    const defaultBranch = await getDefaultRemoteBranch(repoRoot); // origin/main or origin/master
    
    // 3. Find merge base
    const mergeBase = await getMergeBase(repoRoot, 'HEAD', defaultBranch);
    
    // 4. Count commits ahead
    const commitCount = await countCommitsAhead(repoRoot, defaultBranch, 'HEAD');
    
    // 5. If no commits ahead, return null (don't show range)
    if (commitCount === 0) {
        return null;
    }
    
    // 6. Get changed files
    const files = await getChangedFiles(repoRoot, defaultBranch, 'HEAD');
    
    // 7. Calculate total additions/deletions
    const { additions, deletions } = await getDiffStats(repoRoot, defaultBranch, 'HEAD');
    
    return {
        baseRef: defaultBranch,
        headRef: 'HEAD',
        commitCount,
        files,
        additions,
        deletions,
        mergeBase,
        branchName: currentBranch
    };
}
```

## Comment Storage

### Comment Scope

Range comments use a special scope format:
```
range:{baseRef}:{headRef}:{filePath}
```

**Example:** `range:origin/main:HEAD:src/auth/login.ts`

### Storage Location

Comments stored in: `.vscode/comments/range/{hash}.json`

**Hash calculation:** SHA256 of scope string

### Comment Structure

```typescript
interface RangeComment {
    // Comment ID
    id: string;
    
    // Comment scope
    scope: string; // "range:origin/main:HEAD:src/auth/login.ts"
    
    // Comment text
    text: string;
    
    // Line number in combined diff
    lineNumber: number;
    
    // Selected text
    selectedText: string;
    
    // Comment category
    category: CommentCategory;
    
    // Timestamps
    createdAt: string;
    updatedAt?: string;
    
    // Resolution status
    resolved: boolean;
}
```

## Settings

```typescript
{
    // Enable/disable commit range feature
    "workspaceShortcuts.git.commitRange.enabled": true,
    
    // Auto-detect and show range item
    "workspaceShortcuts.git.commitRange.autoDetect": true,
    
    // Default base branch name (fallback if remote not found)
    "workspaceShortcuts.git.commitRange.defaultBaseBranch": "main",
    
    // Maximum number of files to show in range
    "workspaceShortcuts.git.commitRange.maxFiles": 100,
    
    // Show range item even when on default branch
    "workspaceShortcuts.git.commitRange.showOnDefaultBranch": true
}
```

## Commands

### New Commands

```typescript
// Refresh range calculation
shortcuts.git.refreshCommitRange

// Copy range reference (e.g., "origin/main...HEAD")
shortcuts.git.copyRangeRef

// Copy range summary text
shortcuts.git.copyRangeSummary

// Review range against rules
shortcuts.git.reviewRangeAgainstRules
```

## Integration with Existing Features

### AI Code Review

When "Review Against Rules" is invoked on a range item:
1. Collect all commits in range
2. Generate combined diff for each file
3. Build review prompt with all changes
4. Submit to AI service with context: "Reviewing {count} commits on {branch}"

### Diff Comments Tree View

Range comments appear in the existing "Comments" section:
```
▼ Comments (5)
  ▼ Range: feature/auth-flow → origin/main (3)
    ▶ src/auth/login.ts (2)
    ▶ src/auth/oauth.ts (1)
  ▼ Commit abc1234 (2)
    ...
```

## Edge Cases

### No Remote Tracking Branch

**Scenario:** Repository has no remote or no tracking branch

**Behavior:**
- Fall back to comparing against local default branch (main/master)
- Range label: `feature/auth-flow: 8 commits ahead of main` (no "origin/")

### Detached HEAD

**Scenario:** HEAD is not on any branch

**Behavior:**
- Show range item with label: `HEAD: 5 commits ahead of origin/main`
- All functionality works the same

### Unpushed Commits on Main

**Scenario:** User is on main branch with unpushed commits

**Behavior:**
- Show range item: `main: 2 commits ahead of origin/main`
- Useful for reviewing local changes before pushing to main

### Remote is Ahead

**Scenario:** Remote has new commits not in local branch

**Behavior:**
- Still show local commits ahead of remote
- Range shows what would be unique in a PR
- User should pull/rebase to see conflicts

### Large Ranges

**Scenario:** Range contains 100+ commits or 500+ files

**Behavior:**
- Show warning in range item description
- Limit file list to configured max (default 100)
- Add "Show all files..." action to load more

### Binary Files

**Scenario:** Range includes binary file changes

**Behavior:**
- Show in file list with appropriate icon
- Diff editor shows "Binary file changed" message
- No commenting support for binary diffs

## Future Enhancements

### Phase 2 Features

1. **Multiple Range Items**
   - Allow manual creation of custom ranges
   - Pin important ranges to tree view
   - Compare different branches side-by-side

2. **Range Templates**
   - Save frequently used range configurations
   - Quick actions: "Last week's commits", "Unpushed work", etc.

3. **Range Comparison**
   - Compare current range against previous state
   - "Show what changed since last review"

4. **AI Summaries**
   - Auto-generate commit range summary
   - Suggest PR description based on changes

5. **Conflict Detection**
   - Highlight potential merge conflicts in range
   - Preview what would happen on merge

## Testing Strategy

### Unit Tests

- `GitRangeService.detectCommitRange()` - Range detection logic
- `GitRangeService.getChangedFiles()` - File list generation
- `GitRangeService.getDiffForFile()` - Cumulative diff generation
- Range comment storage and retrieval

### Integration Tests

- Range item appears when on feature branch
- Range item hidden when on default branch (no ahead commits)
- File list updates when new commits added
- Diff editor opens with correct combined diff
- Comments persist across range updates

### Manual Testing Scenarios

1. **Feature branch workflow**
   - Create feature branch
   - Make multiple commits
   - Verify range item appears with correct count
   - Review files and add comments

2. **Main branch workflow**
   - Switch to main
   - Make local commits without pushing
   - Verify range shows unpushed commits

3. **Complex history**
   - Merge commits in range
   - Renamed files across commits
   - Deleted and re-added files

## Success Metrics

- Range item correctly appears/disappears based on branch state
- Cumulative diff matches `git diff origin/main...HEAD`
- Comments persist and display correctly
- Performance acceptable for ranges up to 100 commits
- No false positives/negatives in range detection

## References

- Git Documentation: [git-diff](https://git-scm.com/docs/git-diff)
- Git Documentation: [git-rev-list](https://git-scm.com/docs/git-rev-list)
- Existing implementation: `src/shortcuts/git-diff-comments/`
- Related feature: AI Code Review (`docs/designs/ai-code-review-map-reduce.md`)
