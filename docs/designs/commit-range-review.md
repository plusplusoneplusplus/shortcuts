# Branch Range Review Feature

## Overview

Branch Range Review presents all commits on the active branch as one reviewable unit. The feature answers the same question a pull request file list answers: what changes are unique to this branch compared with the repository's default base?

The implementation boundary is split between:

- `@plusplusoneplusplus/forge/git`: pure git range detection, file lists, diff stats, and per-file diff loading.
- `packages/coc/`: REST routes and dashboard surfaces for branch-range overview, file diffs, comments, and AI review actions.
- `@plusplusoneplusplus/forge/diff`: shared diff provider abstractions for commit, range, working-tree, pull request, and pull-request iteration sources.

## Problem Statement

Developers commonly create several commits before opening or updating a pull request. Reviewing each commit independently loses the cumulative context and makes it harder to spot what the branch contributes as a whole.

Key needs:

1. Show all branch-only commits as a single review target.
2. Compare against the remote default branch when available.
3. Load file-level diffs on demand for large ranges.
4. Preserve review comments and AI follow-up context across sessions.

## User Surface

### Branch Range Overview

The CoC dashboard Git tab shows a Branch Range area when the selected workspace has commits ahead of the default base.

Example summary:

```text
feature/auth-flow
8 commits ahead of origin/main
15 files changed, +450/-120
```

The range is hidden when there are no branch-only commits unless a caller explicitly asks for an empty range through the API.

### File List

Files in the range are displayed with status and line counts:

```text
M src/auth/login.ts           +120/-30
M src/auth/register.ts        +80/-20
A src/auth/oauth.ts           +200/-0
D src/old-auth.ts             +0/-50
R src/utils.ts -> src/utils2.ts +20/-20
```

Status codes:

| Code | Meaning |
|------|---------|
| `M` | Modified |
| `A` | Added |
| `D` | Deleted |
| `R` | Renamed |
| `C` | Copied |
| `U` | Conflict |

### Actions

Range-level actions:

- Refresh branch range.
- Copy range ref, such as `origin/main...HEAD`.
- Copy range summary.
- Run an AI review against the full range.
- Open all comments for the range.

File-level actions:

- Open the combined diff for that file.
- Copy the repository-relative path.
- Send the file diff to AI with branch-range context.
- Add, reply to, resolve, update, or delete diff comments.

## Comparison Logic

### Base Selection

Prefer the remote default branch:

1. `origin/main`
2. `origin/master`
3. `refs/remotes/origin/HEAD`
4. local `main`
5. local `master`

Remote refs are preferred because they match the pull-request comparison users usually care about. Local defaults are fallbacks for repositories without a remote.

### Git Commands

Find merge base:

```bash
git merge-base HEAD origin/main
```

Count commits ahead:

```bash
git rev-list --count origin/main..HEAD
```

Get changed files and stats:

```bash
git diff --name-status -M -C origin/main...HEAD
git diff --numstat origin/main...HEAD
git diff --shortstat origin/main...HEAD
```

Get a file diff:

```bash
git diff origin/main...HEAD -- path/to/file
```

Get the full range diff:

```bash
git diff origin/main...HEAD
```

## Core Types

```typescript
interface GitCommitRange {
  baseRef: string;
  headRef: string;
  commitCount: number;
  files: GitCommitRangeFile[];
  additions: number;
  deletions: number;
  mergeBase: string;
  branchName?: string;
  repositoryRoot: string;
  repositoryName: string;
}

interface GitCommitRangeFile {
  path: string;
  status: GitChangeStatus;
  additions: number;
  deletions: number;
  oldPath?: string;
  repositoryRoot: string;
}
```

## Detection Algorithm

```typescript
async function detectCommitRange(repoRoot: string): Promise<GitCommitRange | null> {
  const currentBranch = await getCurrentBranch(repoRoot);
  const defaultBranch = getDefaultRemoteBranch(repoRoot);
  if (!defaultBranch) return null;

  const mergeBase = getMergeBase(repoRoot, 'HEAD', defaultBranch);
  if (!mergeBase) return null;

  const commitCount = countCommitsAhead(repoRoot, defaultBranch, 'HEAD');
  if (commitCount === 0) return null;

  const files = getChangedFiles(repoRoot, defaultBranch, 'HEAD');
  const { additions, deletions } = getDiffStats(repoRoot, defaultBranch, 'HEAD');

  return {
    baseRef: defaultBranch,
    headRef: 'HEAD',
    commitCount,
    files,
    additions,
    deletions,
    mergeBase,
    branchName: currentBranch !== 'HEAD' ? currentBranch : undefined,
    repositoryRoot: repoRoot,
    repositoryName: path.basename(repoRoot),
  };
}
```

## Diff Loading

Branch range review uses the shared diff provider contract:

- `listFiles()` eagerly returns file metadata.
- `getFileDiff(filePath)` lazily returns one file diff.
- `prefetchAll()` loads all file diffs for AI review.
- `getFullDiff()` returns the combined range diff.
- `getSummary()` returns aggregate counts.

This hybrid loading strategy keeps the dashboard responsive for large ranges while still supporting whole-range AI review.

## Comment Storage

Diff comments are workspace scoped. Server-side storage lives under the CoC data directory for the selected workspace:

```text
~/.coc/repos/<workspaceId>/diff-comments/<storageKey>.json
```

Range comments use a context that includes repository identity, base ref, head ref, and file path. The storage key is a stable hash of that context.

Repository-local exports or shared review artifacts may use the existing configuration directory:

```text
.vscode/comments/
```

That path is a CoC configuration/artifact directory, not an application package.

## Comment Shape

```typescript
interface DiffComment {
  id: string;
  text: string;
  category: 'bug' | 'question' | 'suggestion' | 'praise' | 'nitpick' | 'general';
  status: 'open' | 'resolved';
  context: {
    repoId: string;
    oldRef: string;
    newRef: string;
    filePath: string;
    side: 'old' | 'new';
  };
  anchor: {
    startLine: number;
    endLine: number;
    selectedText: string;
    contextBefore?: string;
    contextAfter?: string;
    fingerprint: string;
  };
  createdAt: string;
  updatedAt?: string;
}
```

## REST Surface

The dashboard reads branch range data through workspace-scoped routes:

| Route | Purpose |
|-------|---------|
| `GET /api/workspaces/:id/git/branch-range` | Branch overview |
| `GET /api/workspaces/:id/git/branch-range/files` | File list |
| `GET /api/workspaces/:id/git/branch-range/diff` | Full range diff |
| `GET /api/workspaces/:id/git/branch-range/files/*/diff` | File diff |
| `GET /api/diff-comments/:wsId` | List workspace diff comments |
| `POST /api/diff-comments/:wsId` | Add a diff comment |
| `POST /api/diff-comments/:wsId/resolve-with-ai` | Resolve selected comments with AI |

Every route must remain workspace scoped so multi-repo dashboard sessions route to the selected repository.

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| No remote default branch | Fall back to local `main` or `master`; otherwise hide the range. |
| Detached HEAD | Use `HEAD` as the head label and keep all range operations available. |
| Default branch has unpushed commits | Show the range when commits are ahead of the remote default. |
| Remote is ahead | Still show local branch-only commits; conflict detection is a separate concern. |
| Large ranges | Limit file list to the configured max, show truncation state, and load diffs on demand. |
| Binary files | Include the file metadata; diff view shows binary-file messaging and disables line comments. |

## AI Review Integration

When a user starts AI review for a branch range:

1. Resolve the current workspace and branch range.
2. Prefetch diffs through the shared diff provider.
3. Build a prompt that references file paths and range metadata.
4. Enqueue the review through CoC so progress and results appear in chat/process history.
5. Keep generated findings tied to the workspace and diff context.

## Testing Strategy

Unit tests:

- Default branch detection.
- Commit count and merge-base handling.
- File list parsing for modified, added, deleted, renamed, copied, and conflict statuses.
- Diff stat parsing.
- Storage-key stability for diff comments.

Integration tests:

- Branch range appears for a feature branch with commits ahead.
- Branch range is hidden when no commits are ahead.
- File list refreshes after new commits.
- Per-file diff loading uses the correct `base...head` comparison.
- Comments persist and relocate across range refreshes.

Dashboard tests:

- Overview renders summary counts.
- Large diffs show truncation affordances.
- All-comments view lists open and resolved comments.
- AI review actions route through the selected workspace.

## Success Metrics

- Range summary matches `git diff <base>...HEAD`.
- File counts and line stats match git output.
- Comments stay scoped to the correct workspace and file context.
- Large ranges remain usable without loading every diff eagerly.
- AI review receives the complete range context without breaking multi-repo routing.

## References

- Git Documentation: [git-diff](https://git-scm.com/docs/git-diff)
- Git Documentation: [git-rev-list](https://git-scm.com/docs/git-rev-list)
- Diff provider architecture: `packages/forge/src/diff/README.md`
- Git range service: `packages/forge/src/git/git-range-service.ts`
- Dashboard Git tab spec: `packages/coc/specs/repo-git-tab.spec.md`
