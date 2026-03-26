# Repository Git Tab — UI/UX Specification

**Document type:** Formal UX Specification  
**Scope:** CoC Dashboard → Repository Detail → Git Tab  
**Purpose:** Authoritative reference for validating any future UI/UX changes to the Git tab.  
**Version:** 1.0.0

---

## 1. Overview

The **Repository Git Tab** provides a full-featured git interface for browsing commit history, inspecting diffs, managing branches, staging/unstaging files, and interacting with working-tree changes. It uses a resizable split-panel layout with a scrollable left sidebar (commit list, branch changes, working tree) and a right detail pane (diffs, comments, file content).

### 1.1 Tab Identity

| Property | Value |
|---|---|
| Tab label | `Git` |
| Tab position | Second tab in `RepoDetail` |
| Default tab | No |
| URL fragment | `#repos/<workspaceId>/git` |
| Deep-link URL | `#repos/<workspaceId>/git/<commitHash>` or `#repos/<workspaceId>/git/<commitHash>/<filePath>` |

---

## 2. User Personas

| Persona | Description | Primary Goal |
|---|---|---|
| **Developer** | Engineers working on code in a repository | Review diffs, stage changes, manage branches |
| **Reviewer** | Team members reviewing commit history and diffs | Browse commits, add diff comments, audit changes |
| **Power user** | Advanced git users performing branch operations | Cherry-pick, reset, rebase, amend commits |

---

## 3. User Stories

### 3.1 Commit Browsing

**US-01 — Browse commit history**
> As a developer, I want to browse the commit history so I can understand recent changes.

- **Given** the Git tab is open
- **When** commits exist in the repository
- **Then** a "History" section lists commits in reverse-chronological order with hash, subject, author, and relative time

---

**US-02 — Search commits**
> As a reviewer, I want to search commits by message or hash so I can find specific changes.

- **Given** the Git tab is open
- **When** the user types in the search input
- **Then** after a 300ms debounce, the commit list filters to show only commits matching the search query (case-insensitive grep or exact hash prefix 7–40 hex characters)

---

**US-03 — Multi-select commits**
> As a reviewer, I want to select multiple commits so I can review them together.

- **Given** the commit list is visible
- **When** the user Ctrl/Cmd+clicks commits
- **Then** each clicked commit toggles in/out of the selection
- **When** the user Shift+clicks a commit
- **Then** all commits between the anchor and the clicked commit are selected

---

**US-04 — View commit diff**
> As a developer, I want to view the full diff for a commit so I can understand what changed.

- **Given** a commit is selected
- **When** the user clicks the commit
- **Then** the right pane shows the full commit diff with file list, metadata (author, date, hash, parents, body), and unified diff view

---

**US-05 — View single file diff in a commit**
> As a reviewer, I want to view the diff for a specific file within a commit.

- **Given** a commit is expanded in the left pane showing its file list
- **When** the user clicks a file
- **Then** the right pane shows the diff for that specific file with navigation controls (file index, hunk prev/next)

---

**US-06 — Deep-link to a commit**
> As a reviewer sharing a link, I want a URL that opens a specific commit.

- **Given** a URL of the form `#repos/<workspaceId>/git/<commitHash>`
- **When** the user navigates to that URL
- **Then** the Git tab opens with the specified commit selected and its diff shown in the detail pane

---

### 3.2 Branch Operations

**US-07 — Switch branches**
> As a developer, I want to switch branches so I can work on different features.

- **Given** the branch pill is visible in the header
- **When** the user clicks the branch pill
- **Then** a `BranchPickerModal` opens with a searchable, paginated list of local branches
- **When** the user selects a branch
- **Then** `POST .../git/branches/switch` is called and the commit list refreshes

---

**US-08 — View branch changes**
> As a developer, I want to see all changes on my branch compared to the base so I can review before merging.

- **Given** the current branch is not the default branch
- **When** a branch range exists
- **Then** a "Branch Changes" section appears showing files changed on the branch with status, path, and +/- stats

---

**US-09 — Pull, push, fetch, and rebase**
> As a developer, I want to sync my branch with the remote.

- **Given** the Git tab header is visible
- **When** the user clicks the primary sync button
- **Then** a pull with rebase is initiated (`POST .../git/pull` with `{ rebase: true }`)
- **When** the user opens the sync dropdown
- **Then** options for Fetch, Pull, Push, and Rebase (autosquash) are available

---

**US-10 — Amend the last commit**
> As a developer, I want to amend the last commit message.

- **Given** the HEAD commit is visible
- **When** the user selects "Amend Message…" from the context menu
- **Then** an `AmendMessageModal` opens with title and body fields
- **When** the user confirms
- **Then** `POST .../git/amend` is called with the new message

---

### 3.3 Working Tree

**US-11 — View working-tree changes**
> As a developer, I want to see my uncommitted changes organized by stage.

- **Given** the Git tab is open
- **When** uncommitted changes exist
- **Then** a "Working Changes" section shows three subsections: Staged, Changes (unstaged), and Untracked

---

**US-12 — Stage and unstage files**
> As a developer, I want to stage and unstage individual files or all files at once.

- **Given** working-tree changes exist
- **When** the user clicks the stage button on a file
- **Then** `POST .../git/changes/stage` is called for that file
- **When** the user clicks "Stage All"
- **Then** `POST .../git/changes/stage-batch` is called with all unstaged file paths

---

**US-13 — Discard changes**
> As a developer, I want to discard changes to a file.

- **Given** an unstaged file is visible
- **When** the user clicks the discard button
- **Then** `POST .../git/changes/discard` is called and the file is removed from the changes list

---

**US-14 — View working-tree file diff**
> As a developer, I want to view the diff for a working-tree file.

- **Given** a working-tree file is listed
- **When** the user clicks the file
- **Then** the right pane shows the diff for that file (staged or unstaged as appropriate)

---

### 3.4 Diff Comments

**US-15 — Add a comment on a diff line**
> As a reviewer, I want to add comments on specific diff lines.

- **Given** a diff is displayed in the right pane
- **When** the user selects text or clicks a diff line
- **Then** a comment input appears allowing the user to create a comment with a category

---

**US-16 — View all comments for a context**
> As a reviewer, I want to see all diff comments for a branch range or working tree.

- **Given** the branch changes or working tree section is visible
- **When** the user clicks the comments button (💬)
- **Then** a `CommentSidebar` opens showing all comments for that context with filter and copy-as-prompt options

---

### 3.5 Advanced Git Operations

**US-17 — Hard reset to a commit**
> As a power user, I want to hard reset to a specific commit.

- **Given** a commit is visible in the list
- **When** the user selects "Hard reset" from the context menu and confirms
- **Then** `POST .../git/reset` is called with `{ hash, mode: 'hard' }`

---

**US-18 — Cherry-pick a commit**
> As a power user, I want to cherry-pick a commit onto my current branch.

- **Given** a commit is visible in the list
- **When** the user selects "Cherry pick" from the context menu and confirms
- **Then** `POST .../git/cherry-pick` is called; on conflict (409), a message instructs the user to resolve manually

---

### 3.6 AI Integration

**US-19 — Ask AI about a commit or branch**
> As a developer, I want to ask AI about a commit diff or branch changes.

- **Given** a commit or branch range is selected
- **When** the user selects "Ask AI" or "Use Skill" from the context menu
- **Then** a task is enqueued with the diff context (truncated to 3000 lines) and the selected skill applied

---

## 4. Feature Inventory & Acceptance Criteria

### 4.1 Left Pane — Sidebar

| Feature | Acceptance Criteria |
|---|---|
| Branch pill | Shows current branch name; click opens `BranchPickerModal` |
| Ahead/behind badge | Shows count when non-zero; warning styling when behind > 0 |
| Sync controls | Primary: Pull (rebase); dropdown: Fetch, Pull, Push, Rebase (autosquash); spinner during action |
| Refresh button | Spinner while refreshing; keyboard shortcut `R` (when not in input) |
| Commit search | 300ms debounce; supports message grep and hash prefix (7–40 hex); clear button when non-empty |
| Branch Changes section | Collapsible; shows file list with status, path, +/- stats; click opens branch file diff; right-click opens context menu |
| Working Tree section | Collapsible; subsections: Staged, Changes, Untracked; per-file stage/unstage/discard/delete; batch stage/unstage all |
| Commit list | Collapsible; unpushed separator; multi-select (Ctrl+click, Shift+click); inline file tree on click; hover tooltip (1s delay); per-commit comment count |
| Load more | Appends next page when `hasMore` |

### 4.2 Right Pane — Detail

| Feature | Acceptance Criteria |
|---|---|
| Commit detail | Collapsible header (subject, author, date, hash copy, parents, body); auto-collapses on scroll; hunk navigation; unified/split toggle; DiffMiniMap |
| Single file diff | Sticky bar with path, file index, hunk nav, view toggle, comment count; cross-file navigation |
| Branch range overview | Draggable horizontal split: upper = commit strip summary; lower = per-file diffs with 200-line truncation and "show full" / "Open →" |
| Branch file diff | Header with path, hunk nav, view toggle, "Branch diff" label, comment sidebar toggle |
| Working tree file diff | Header with path, hunk nav, view toggle, stage label, comment sidebar toggle; untracked files show placeholder |
| Multi-commit summary | List of selected commits when multiple are selected |
| Empty state | "Select a commit to view details" when no selection |

### 4.3 Resize Behavior

| Feature | Acceptance Criteria |
|---|---|
| Sidebar resize | Vertical drag handle; width range 160–600px; default 320px; persisted as `git-sidebar-width` |
| Branch range split | Horizontal drag handle; upper height persisted in `localStorage` (`coc.branchRangeOverview.upperHeight`) |
| Mobile layout | Single column; detail replaces list with "← Back to list" bar |

---

## 5. Behavioral Invariants

| ID | Invariant |
|---|---|
| INV-01 | The sidebar resize width is always between 160px and 600px |
| INV-02 | Commit search debounce is exactly 300ms; resets pagination on each search |
| INV-03 | Multi-select only applies to the commit list; working tree and branch changes do not support multi-select |
| INV-04 | Unpushed commits always appear above the separator in the commit list |
| INV-05 | Pull and rebase operations use job polling (3s interval) and show action errors on failure |
| INV-06 | Shift+right-click always opens the native browser context menu, not the custom one |
| INV-07 | Branch changes section is hidden when on the default branch |
| INV-08 | Working tree comment context uses synthetic refs (`HEAD`/`INDEX` vs `working-tree`) |
| INV-09 | Branch diff comment context uses synthetic refs (`branch-base` / `branch-head`) |
| INV-10 | WebSocket `git-changed` events trigger a debounced (500ms) refresh of commits and working changes |

---

## 6. Context Menu Specification

### Commit Row (single)

| Action | Description |
|---|---|
| Copy hash | Copies full commit hash to clipboard |
| View diff | Opens commit diff in right pane |
| Amend Message… | Only for HEAD commit; opens AmendMessageModal |
| Hard reset | Confirmation required; `POST .../git/reset` |
| Cherry pick | Confirmation required; `POST .../git/cherry-pick` |
| Ask AI | Enqueues AI task with commit diff context |
| Queue Task | Enqueues task with commit context |
| Use Skill | Submenu of available skills |

### Multi-commit

| Action | Description |
|---|---|
| Ask AI | Enqueues AI task with combined diff context |
| Queue Task | Enqueues task with combined context |
| Use Skill | Submenu of available skills |

### Branch Header

| Action | Description |
|---|---|
| Ask AI | Enqueues AI task with branch range context |
| Queue Task | Enqueues task with branch context |
| Use Skill | Submenu of available skills |

---

## 7. UI Layout Specification

```
┌─────────────────────────────────────────────────────────────────────┐
│  [Repo Name]   Activity │ Git* │ Wiki │ Schedules │ ...             │
├────────────────────────┬────────────────────────────────────────────┤
│                        │                                            │
│  [🌿 main ▼] [↕ 0/2]  │  [Commit Subject]                         │
│  [⟳ Pull ▼] [↻]       │  Author · Date · abc1234 📋               │
│                        │  ─────────────────────────────────────     │
│  [🔍 Search commits…]  │  --- a/file.ts                            │
│                        │  +++ b/file.ts                             │
│  ▶ BRANCH CHANGES (N)  │  @@ -10,5 +10,7 @@                       │
│  ┌──────────────────┐  │   unchanged line                          │
│  │ M src/app.ts  +5 │  │  -old line                                │
│  │ A src/new.ts  +20│  │  +new line                                │
│  └──────────────────┘  │                                            │
│                        │  [← prev hunk] [next hunk →]              │
│  ▶ WORKING CHANGES (N) │  [Unified ○ Split]                        │
│  ┌ Staged (2)          │                                            │
│  │  M file1.ts  [−]   │                                            │
│  ├ Changes (3)         │                                            │
│  │  M file2.ts  [+]   │                                            │
│  ├ Untracked (1)       │                                            │
│  │  ? file3.ts  [🗑]  │                                            │
│  └──────────────────┘  │                                            │
│                        │                                            │
│  ▶ HISTORY (N)         │                                            │
│  ┌──────────────────┐  │                                            │
│  │ ● abc1234 Fix…   │  │                                            │
│  │ ○ def5678 Add…   │  │                                            │
│  └──────────────────┘  │                                            │
│  [Load more]           │                                            │
└────────────────────────┴────────────────────────────────────────────┘
```

---

## 8. Error Handling Specification

| Error Scenario | Expected Behavior |
|---|---|
| Initial git load failure | Full-page red error message |
| Refresh failure | `refreshError` strip below header |
| Git action failure (fetch/pull/push/reset/cherry-pick/amend/rebase) | `actionError` strip below header |
| Cherry-pick conflicts | 409 response; message to resolve manually and run `git cherry-pick --continue` |
| Pull/rebase job failure | Error from polled job status shown in action error strip |
| Working tree action failure | Section-level error display |
| Branch file list failure | `filesError` in branch changes section |
| Diff load failure | Error text with Retry button |

---

## 9. Empty State Specification

| State | Display |
|---|---|
| Initial load | Spinner (`git-tab-loading`) |
| Search with no results | "No commits match …" (`git-search-empty`) |
| No commits | "No commits" in commit list |
| Expanded commit with no files | "No files changed" |
| Branch strip with no ahead commits | "No commits ahead of base" |
| Working tree sections when empty | "No changes" per section |
| No selection | "Select a commit to view details" in right pane |
| Branch picker with no results | "No branches found" |
| Empty diff | "(empty diff)" or "(no changes)" |

---

## 10. Keyboard Shortcuts

| Key | Context | Action |
|---|---|---|
| `R` / `r` | Left pane (not in input/textarea) | Refresh commits and working tree |
| `↑` / `↓` | Commit list | Move selection |
| `Shift+↑` / `Shift+↓` | Commit list | Extend multi-select |
| `↑` / `↓` / `Enter` / `Escape` | Branch picker modal | Navigate, select, close |
| `Escape` | Amend modal | Cancel |

---

## 11. API Dependencies

| Endpoint | Used by | Critical for |
|---|---|---|
| `GET /api/workspaces/:id/git/commits` | Commit list | US-01, US-02 |
| `GET /api/workspaces/:id/git/commits/:hash` | Commit detail | US-04 |
| `GET /api/workspaces/:id/git/commits/:hash/diff` | Full commit diff | US-04 |
| `GET /api/workspaces/:id/git/commits/:hash/files/:path/diff` | Single file diff | US-05 |
| `GET /api/workspaces/:id/git/commits/:hash/files/:path/content` | File content (max 2MB) | US-05 |
| `GET /api/workspaces/:id/git/branches` | Branch picker | US-07 |
| `POST /api/workspaces/:id/git/branches/switch` | Branch switch | US-07 |
| `GET /api/workspaces/:id/git/branch-range` | Branch overview | US-08 |
| `GET /api/workspaces/:id/git/branch-range/files` | Branch file list | US-08 |
| `GET /api/workspaces/:id/git/branch-range/files/:path/diff` | Branch file diff | US-08 |
| `POST /api/workspaces/:id/git/fetch` | Fetch | US-09 |
| `POST /api/workspaces/:id/git/pull` | Pull (202 + jobId) | US-09 |
| `POST /api/workspaces/:id/git/push` | Push | US-09 |
| `POST /api/workspaces/:id/git/rebase-autosquash` | Rebase (202 + jobId) | US-09 |
| `POST /api/workspaces/:id/git/amend` | Amend commit | US-10 |
| `GET /api/workspaces/:id/git/changes` | Working tree | US-11 |
| `POST /api/workspaces/:id/git/changes/stage` | Stage file | US-12 |
| `POST /api/workspaces/:id/git/changes/unstage` | Unstage file | US-12 |
| `POST /api/workspaces/:id/git/changes/stage-batch` | Stage all | US-12 |
| `POST /api/workspaces/:id/git/changes/unstage-batch` | Unstage all | US-12 |
| `POST /api/workspaces/:id/git/changes/discard` | Discard changes | US-13 |
| `DELETE /api/workspaces/:id/git/changes/untracked` | Delete untracked | US-13 |
| `GET /api/workspaces/:id/git/changes/files/:path/diff` | Working tree file diff | US-14 |
| `POST /api/workspaces/:id/git/reset` | Hard reset | US-17 |
| `POST /api/workspaces/:id/git/cherry-pick` | Cherry-pick | US-18 |
| `GET /api/diff-comment-counts/:wsId` | Comment counts | US-15, US-16 |
| `GET /api/diff-comment-totals/:wsId` | Comment totals | US-16 |
| `POST /api/diff-comments/:wsId` | Create comment | US-15 |
| `GET /api/workspaces/:id/skills` | Skill list for context menu | US-19 |
| `POST /api/queue/tasks` | Skill enqueue | US-19 |
| `GET /api/workspaces/:id/git/ops/latest` | Resume running pull | Background ops |
| `GET /api/workspaces/:id/git/ops/:jobId` | Poll job status | Background ops |

---

## Revision History

| Version | Date | Summary |
|---|---|---|
| 1.0.0 | 2026-03-25 | Initial specification |
