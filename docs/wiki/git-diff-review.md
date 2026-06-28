# Git Diff Review UX Specification

## 1. User Story

As a developer, I want to annotate git changes with inline comments while reading a diff, so I can record observations, questions, and action items that persist across sessions and can be sent into AI-assisted review workflows.

Secondary personas:

- Code reviewers who want structured, categorized feedback organized by file and review source.
- AI-assisted reviewers who want to generate prompts from their annotations.
- Team leads who want review notes to remain attached to a workspace and diff context.

## 2. Supported Review Sources

The review surface uses the shared diff provider abstraction, which supports:

| Source | Description |
|--------|-------------|
| Working tree | Staged, unstaged, or combined local changes. |
| Commit | A single commit compared with its parent. |
| Branch range | A feature branch compared with a base ref such as `origin/main`. |
| Pull request | Latest remote provider diff. |
| Pull-request iteration | A specific remote provider revision or iteration. |

## 3. Entry Points

Dashboard entry points:

- Repository Git tab changed-file list.
- Commit detail file list.
- Branch range overview and file list.
- Pull request detail diff/file list.
- Diff comment list grouped by workspace, source, and file.

Programmatic entry points:

- CoC REST routes for git branch-range data and diff comments.
- Forge diff provider factories for package consumers.
- AI tools that pre-bind commit, range, or file context.

## 4. User Flow

### 4.1 Opening a Diff

1. User selects a changed file, commit file, branch-range file, or pull-request file in the dashboard.
2. The right pane or pop-out review window opens a unified diff view.
3. Existing comments load for the workspace and diff context.
4. Open comments render with an attention highlight; resolved comments render with a muted resolved style.
5. The comments list groups notes by source and file.

### 4.2 Adding a Comment

1. User selects a range of diff text.
2. The comment action appears near the selection.
3. User chooses a category and enters a comment.
4. The dashboard posts the comment to the workspace-scoped diff-comments API.
5. The selected range is highlighted and the comments list updates.

### 4.3 Editing, Replying, and Deleting

- Edit updates comment text and `updatedAt`.
- Reply adds threaded context under the original comment.
- Delete removes the selected comment after confirmation.
- Bulk delete applies only to the selected source/file scope.

### 4.4 Resolving Comments

1. User resolves one comment, all comments for a file, or all comments in a selected source.
2. Resolved comments move to the resolved visual style.
3. The action remains reversible while the local UI still has undo context.
4. Resolved comments can be shown or hidden through review settings.

### 4.5 Sending Comments to AI

1. User selects a comment, file, or source group.
2. User chooses an AI action such as ask, resolve, or summarize.
3. CoC builds a prompt containing file paths, diff refs, selected text, surrounding context, and comments.
4. The prompt is submitted through the selected workspace's AI route or queue.
5. AI output is linked back to the process/chat history and review context.

## 5. Edge Cases and Error Handling

| Scenario | Behavior |
|----------|----------|
| File no longer exists | Show a warning and keep comments visible in the comments list. |
| Anchor becomes stale | Relocate by fingerprint and surrounding context; otherwise show nearest valid line with an approximate-position indicator. |
| Empty comment text | Block save and show inline validation. |
| AI provider unavailable | Keep comments saved and offer prompt copy or retry once AI is configured. |
| Diff has no changes | Show a no-changes placeholder. |
| Binary file | Show file metadata and disable line-anchored commenting. |
| Workspace changes | Reload comments through the selected workspace client. |

## 6. Visual Design

### Comment Categories

| Category | Use |
|----------|-----|
| Bug | Potential defect or regression. |
| Question | Needs clarification. |
| Suggestion | Improvement idea. |
| Praise | Positive note. |
| Nitpick | Minor style or cleanup. |
| General | Default note. |

### Comments List

```text
Diff Comments
  Branch range: feature/auth-flow -> origin/main
    src/auth/login.ts
      [bug] This logic might miss the refresh case
      [question] Why not use the existing helper?
  Commit abc1234
    src/api/users.ts
      [resolved] Naming looks good
```

### Diff View

- Unified diff with line numbers and hunk headers.
- File header with path, status, additions, deletions, and source metadata.
- Inline highlighted ranges for comments.
- Comment cards attached to the relevant hunk or shown in a side panel on narrow layouts.
- Toolbar actions for copy path, ask AI, resolve comments, and open pop-out.

### Notifications

- Inline validation for save failures.
- Toast for undoable resolve actions.
- Error banner for unrecoverable anchor loss or API failures.

## 7. Settings and Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `diffReview.showResolved` | `true` | Show resolved comments in list and diff view. |
| `diffReview.askAIEnabled` | `true` | Show AI actions for comments and files. |
| `diffReview.predefinedComments` | `[]` | Quick comment templates. |
| `diffReview.maxDiffLines` | `500` | Initial diff line cap before expansion. |

Repository-level shared review configuration or exports can use:

```text
.vscode/comments/
```

Runtime comment persistence remains workspace scoped under the CoC data directory.

## 8. API Contracts

| Route | Purpose |
|-------|---------|
| `GET /api/diff-comments/:wsId` | List all workspace diff comments. |
| `POST /api/diff-comments/:wsId` | Create a comment. |
| `GET /api/diff-comments/:wsId/:key` | List comments for one diff context. |
| `PATCH /api/diff-comments/:wsId/:key/:id` | Update a comment. |
| `DELETE /api/diff-comments/:wsId/:key/:id` | Delete a comment. |
| `POST /api/diff-comments/:wsId/:key/:id/replies` | Add a reply. |
| `POST /api/diff-comments/:wsId/:key/:id/ask-ai` | Ask AI about one comment. |
| `POST /api/diff-comments/:wsId/resolve-with-ai` | Resolve selected comments with AI. |

All routes include a workspace ID so multi-repo sessions stay correctly scoped.

## 9. Discoverability

- Repository Git tab empty states explain how to open a diff and start commenting.
- Branch range and pull request views show comment counts next to files.
- Comment lists show category and status filters.
- AI actions are grouped with other review actions, not hidden behind developer-only controls.
- Keyboard shortcuts are optional accelerators; all actions are reachable from visible controls.
