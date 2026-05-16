# Repository Git Tab — UI/UX Specification

**Document type:** Formal UX Specification  
**Scope:** CoC Dashboard → Repository Detail → Git Tab  
**Purpose:** Authoritative reference for validating any future UI/UX changes to the Git tab.  
**Version:** 2.0.0

---

## 1. Overview

The **Repository Git Tab** provides a full-featured git interface for browsing commit history, inspecting diffs, managing branches, staging/unstaging files, interacting with working-tree changes, resolving merge/rebase conflicts, reordering unpushed commits, and chatting with AI about individual commits. It uses a resizable split-panel layout with a scrollable left sidebar (commit list, branch changes, working tree) and a right detail pane (diffs, comments, commit chat, file content).

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
| **Power user** | Advanced git users performing branch operations | Cherry-pick, reset, rebase, amend, reorder, merge, stash |

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

**US-06b — Toggle flat/tree view for file lists**
> As a developer, I want to switch between flat and tree views for file lists so I can browse files the way I prefer.

- **Given** a file list is visible (commit files, branch changes, or working tree)
- **When** the user clicks the flat/tree view toggle
- **Then** the file list switches between a flat sorted list and a hierarchical folder tree with compact folding
- **And** the preference is persisted per workspace and shared across all file list sections

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

**US-07b — Create a branch**
> As a developer, I want to create a new branch from the current HEAD.

- **Given** the branch picker or header is visible
- **When** the user creates a branch
- **Then** `POST .../git/branches` is called with `{ name, checkout? }` and the branch list refreshes

---

**US-07c — Rename a branch**
> As a developer, I want to rename an existing branch.

- **Given** a branch is visible
- **When** the user renames it
- **Then** `POST .../git/branches/rename` is called with `{ oldName, newName }`

---

**US-07d — Delete a branch**
> As a developer, I want to delete a branch I no longer need.

- **Given** a branch is visible
- **When** the user deletes it (with confirmation)
- **Then** `DELETE .../git/branches/:name` is called (optionally with `?force=true`)

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

**US-09b — Merge a branch**
> As a developer, I want to merge another branch into my current branch.

- **Given** the Git tab is open
- **When** the user initiates a merge
- **Then** `POST .../git/merge` is called with `{ branch }`; on conflict the conflict banner appears

---

**US-09c — Stash and pop changes**
> As a developer, I want to stash my working-tree changes temporarily.

- **Given** uncommitted changes exist
- **When** the user stashes changes
- **Then** `POST .../git/stash` is called (optionally with `{ message }`)
- **When** the user pops the stash
- **Then** `POST .../git/stash/pop` is called and the working tree refreshes

---

**US-10 — Amend the last commit**
> As a developer, I want to amend the last commit message.

- **Given** the HEAD commit is visible
- **When** the user selects "Amend Message…" from the context menu
- **Then** an `AmendMessageModal` opens with title and body fields
- **When** the user confirms
- **Then** `POST .../git/amend` is called with the new message

---

**US-10b — Reword an older commit**
> As a power user, I want to edit the title of a non-HEAD commit.

- **Given** a non-HEAD commit is visible
- **When** the user selects "Amend Title…" from the context menu
- **Then** an inline editor or modal opens for the commit title
- **When** the user confirms
- **Then** `POST .../git/reword` is called with `{ hash, title }` (async background job via interactive rebase)

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

**US-15b — Manage diff comments**
> As a reviewer, I want to read, update, reply to, and delete diff comments.

- **Given** comments exist for a diff context
- **When** the user views a comment
- **Then** they can reply (`POST .../diff-comments/:wsId/:key/:id/replies`), update (`PATCH`), or delete (`DELETE`) it
- **When** the user right-clicks selected text in a diff
- **Then** context menu options include "Add comment" and "Ask AI"

---

**US-15c — AI-assisted comment resolution**
> As a reviewer, I want AI to help resolve diff comments.

- **Given** diff comments exist
- **When** the user selects "Resolve with AI"
- **Then** `POST .../diff-comments/:wsId/resolve-with-ai` is called with affected files, comment IDs, and context

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
- **Then** `POST .../git/cherry-pick` is called; on conflict (409), the conflict banner appears

---

**US-18b — Reorder unpushed commits**
> As a power user, I want to reorder my unpushed commits via drag-and-drop.

- **Given** the commit list has more than one unpushed commit and no search query is active
- **When** the user drags an unpushed commit to a new position using the drag handle (⠿)
- **Then** the commit list reorders visually with drag feedback (40% opacity source, blue top-border target)
- **And** a confirmation banner appears with "Apply" and "Cancel" buttons
- **When** the user clicks "Apply"
- **Then** `POST .../git/rebase-reorder` is called with the new commit order (oldest-first)
- **When** the user clicks "Cancel"
- **Then** the original order is restored

---

**US-18c — Squash multiple commits**
> As a power user, I want to squash selected commits into one.

- **Given** 2 or more commits are selected
- **When** the user selects "Squash N Commits" from the context menu
- **Then** an AI-powered squash task is enqueued

---

### 3.6 Conflict Resolution

**US-20 — View conflict state**
> As a developer, I want to see when a merge, rebase, or cherry-pick has conflicts so I can resolve them.

- **Given** a git operation results in conflicts
- **When** `repoState.operation` is not `'none'` (values: `merge`, `rebase`, `cherry-pick`)
- **Then** a conflict banner appears below the header showing the operation type and number of conflicting files

---

**US-21 — Continue or abort a conflicted operation**
> As a developer, I want to continue after resolving conflicts or abort the operation.

- **Given** the conflict banner is visible
- **When** the user clicks "Continue"
- **Then** `POST .../git/merge-continue` or `POST .../git/rebase-continue` is called (async job)
- **When** the user clicks "Abort" and confirms
- **Then** `POST .../git/merge-abort` or `POST .../git/rebase-abort` is called

---

**US-22 — AI-assisted conflict resolution**
> As a developer, I want AI to automatically resolve merge/rebase conflicts.

- **Given** the conflict banner is visible
- **When** the user clicks "Resolve with AI ⚡"
- **Then** an autopilot task is enqueued that receives the list of conflicted files and the appropriate `git <op> --continue` command
- **And** the AI resolves conflict markers, stages files, and runs the continue command

---

### 3.7 AI Integration

**US-19 — Ask AI about a commit or branch**
> As a developer, I want to ask AI about a commit diff or branch changes.

- **Given** a commit or branch range is selected
- **When** the user selects "Ask AI" or "Use Skill" from the context menu
- **Then** a task is enqueued with the diff context (truncated to 3000 lines) and the selected skill applied

---

**US-23 — Chat about a commit**
> As a developer, I want to have an AI conversation about a specific commit that persists across sessions.

- **Given** a commit is selected and the commit detail pane is visible
- **When** the user clicks the chat toggle button (🤖)
- **Then** a resizable `CommitChatPanel` opens on the right side of the detail pane
- **When** no chat exists for this commit
- **Then** the panel shows an empty state with "Chat about this commit" and an input field
- **When** the user types a message and sends (Enter or Send button)
- **Then** a queue task is created, a commit-chat binding is saved, and the panel transitions to an active conversation view (`ActivityChatDetail`)

---

**US-24 — Commit chat follows amend/rebase**
> As a developer, I want my commit conversations to follow commits when they are amended or rebased.

- **Given** a commit has a chat binding
- **When** the commit is amended or rebased (hash changes)
- **Then** the `git-changed` WebSocket event triggers identity-based matching (subject + author + email + date)
- **And** matched bindings are automatically rebound to the new hash via `POST .../commit-chat-bindings/rebind`
- **And** ambiguous matches (multiple commits with same identity) are skipped to avoid incorrect rebinding

---

## 4. Feature Inventory & Acceptance Criteria

### 4.1 Left Pane — Sidebar

| Feature | Acceptance Criteria |
|---|---|
| Branch pill | Shows current branch name; click opens `BranchPickerModal` |
| Ahead/behind badge | Shows count when non-zero; warning styling when behind > 0 |
| Sync controls | Primary: Pull (rebase); dropdown: Fetch, Pull, Push, Rebase (autosquash); spinner during action |
| Refresh button | Spinner while refreshing; keyboard shortcut `R` (when not in input) |
| Last-refreshed timestamp | Relative time display (e.g., "2 minutes ago") right of refresh button; hover shows full date; re-renders every 30s; hidden on mobile |
| Commit search | 300ms debounce; supports message grep and hash prefix (7–40 hex); clear button when non-empty |
| Branch Changes section | Collapsible; shows file list with status, path, +/- stats; click opens branch file diff; right-click opens context menu; flat/tree view toggle |
| Working Tree section | Collapsible; subsections: Staged, Changes, Untracked; per-file stage/unstage/discard/delete; batch stage/unstage all; flat/tree view toggle |
| Commit list | Collapsible; unpushed separator; multi-select (Ctrl+click, Shift+click); inline file tree on click; hover tooltip (1s delay); per-commit comment count; drag-to-reorder for unpushed commits; flat/tree view toggle for file lists |
| Conflict banner | Yellow warning bar when `repoState.operation !== 'none'`; shows operation type + conflict file count; buttons: Resolve with AI ⚡, Continue, Abort |
| Reorder confirmation banner | Blue bar after drag-reorder; "Reorder N unpushed commits?"; Apply and Cancel buttons |
| Load more | Appends next page when `hasMore` |

### 4.2 Right Pane — Detail

| Feature | Acceptance Criteria |
|---|---|
| Commit detail | Collapsible header (subject, author, date, hash copy, parents, body); auto-collapses on scroll; hunk navigation; unified/split toggle; DiffMiniMap; chat toggle button (🤖) |
| Commit chat panel | Resizable panel (200–600px, default 360px); width persisted in `localStorage` (`coc.commitChatPanel.width`); open state persisted (`coc.commitChat.open`); empty state → active chat transition; `RichTextInput` with Enter to send, Shift+Enter for newline |
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
| Commit chat panel resize | Vertical drag handle (desktop only, ≥1024px); width range 200–600px; default 360px; persisted as `coc.commitChatPanel.width` |
| Mobile layout | Single column; detail replaces list with "← Back to list" bar; commit chat panel hidden on mobile |

---

## 5. Behavioral Invariants

| ID | Invariant |
|---|---|
| INV-01 | The sidebar resize width is always between 160px and 600px |
| INV-02 | Commit search debounce is exactly 300ms; resets pagination on each search |
| INV-03 | Multi-select only applies to the commit list; working tree and branch changes do not support multi-select |
| INV-04 | Unpushed commits always appear above the separator in the commit list |
| INV-05 | Pull, rebase, reword, reorder, merge-continue, and rebase-continue operations use job polling (3s interval) and show action errors on failure |
| INV-06 | Shift+right-click always opens the native browser context menu, not the custom one |
| INV-07 | Branch changes section is hidden when on the default branch |
| INV-08 | Working tree comment context uses synthetic refs (`HEAD`/`INDEX` vs `working-tree`) |
| INV-09 | Branch diff comment context uses synthetic refs (`branch-base` / `branch-head`) |
| INV-10 | WebSocket `git-changed` events trigger a debounced (500ms) refresh of commits and working changes |
| INV-11 | Drag-to-reorder is only enabled for unpushed commits when no search query is active and `unpushedCount > 1` |
| INV-12 | Commit chat identity matching requires 1:1 correspondence (subject + author + email + date); ambiguous matches are skipped |
| INV-13 | Commit chat rebinding is best-effort (fire-and-forget); failures are silently ignored |
| INV-14 | Flat/tree view mode is persisted per workspace and shared across commit files, branch changes, and working tree sections |
| INV-15 | The conflict banner appears whenever `repoState.operation` is not `'none'` |
| INV-16 | The commit chat panel width is always between 200px and 600px |

---

## 6. Context Menu Specification

### Commit Row — HEAD commit

| Action | Description |
|---|---|
| Amend Message… | Opens AmendMessageModal with title + body fields; `POST .../git/amend` |
| Hard Reset to Here | Confirmation required; `POST .../git/reset` |
| Cherry Pick | Confirmation required; `POST .../git/cherry-pick` |
| Ask AI | Opens floating chat with commit hash + subject context |
| Queue Task | Enqueues task with commit context |
| Use Skill | Submenu showing top 5 most-recently-used skills (from `commitSkillUsageMap`), then a "More…" sub-submenu with remaining skills sorted alphabetically. When ≤5 skills installed, shows a flat recency-sorted list. |

### Commit Row — Non-HEAD commit

| Action | Description |
|---|---|
| Copy Hash | Copies full commit hash to clipboard |
| View Diff | Opens commit diff in right pane |
| Amend Title… | Opens reword editor for title only; `POST .../git/reword` (async via interactive rebase) |
| Hard Reset to Here | Confirmation required; `POST .../git/reset` |
| Cherry Pick | Confirmation required; `POST .../git/cherry-pick` |
| Ask AI | Opens floating chat with commit hash + subject context |
| Queue Task | Enqueues task with commit context |
| Use Skill | Submenu showing top 5 most-recently-used skills (from `commitSkillUsageMap`), then a "More…" sub-submenu with remaining skills sorted alphabetically. When ≤5 skills installed, shows a flat recency-sorted list. |

### Multi-commit (2+ selected)

| Action | Description |
|---|---|
| Copy Commits Info | Copies list of `shortHash — subject` for all selected commits |
| Squash N Commits | AI-powered squash task (shown when ≥2 selected) |
| Ask AI | Enqueues AI task with combined diff context |
| Queue Task | Enqueues task with combined context |
| Use Skill | Submenu showing top 5 most-recently-used skills (from `commitSkillUsageMap`), then a "More…" sub-submenu with remaining skills sorted alphabetically. When ≤5 skills installed, shows a flat recency-sorted list. |

### Branch Header

| Action | Description |
|---|---|
| Ask AI | Enqueues AI task with branch range context (diff if under 50KB, stat-only otherwise) |
| Queue Task | Enqueues task with branch context |
| Use Skill | Submenu showing top 5 most-recently-used skills (from `commitSkillUsageMap`), then a "More…" sub-submenu with remaining skills sorted alphabetically. When ≤5 skills installed, shows a flat recency-sorted list. |

### Diff Viewer (right-click on selected text)

| Action | Description |
|---|---|
| Add comment | Opens comment input anchored to selected diff lines |
| Ask AI | Opens floating chat with selected text as context |

### Working Tree File Items

| Section | Actions |
|---|---|
| Unstaged files | Stage, Discard changes, Copy path |
| Staged files | Unstage, Copy path |
| Untracked files | Copy path |

---

## 7. UI Layout Specification

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  [Repo Name]   Activity │ Git* │ Wiki │ Schedules │ ...                         │
├────────────────────────┬────────────────────────────────────────┬───────────────┤
│                        │                                        │               │
│  [🌿 main ▼] [↕ 0/2]  │  [Commit Subject]              [🤖]   │  💬 Commit    │
│  [⟳ Pull ▼] [↻ 2m ago]│  Author · Date · abc1234 📋           │  Chat         │
│                        │  ─────────────────────────────         │  [abc1234]    │
│  ⚠️ Rebase in progress │  --- a/file.ts                        │               │
│  [AI ⚡] [Continue]    │  +++ b/file.ts                        │  Chat about   │
│  [Abort]               │  @@ -10,5 +10,7 @@                   │  this commit  │
│                        │   unchanged line                      │               │
│  [🔍 Search commits…]  │  -old line                            │  [Ask about   │
│                        │  +new line                            │   this commit…]│
│  ▶ BRANCH CHANGES (N)  │                                        │  [Send]       │
│  [🌲⊟] 📁/📄 toggle   │  [← prev hunk] [next hunk →]          │               │
│  ┌──────────────────┐  │  [Unified ○ Split]                    │               │
│  │ M src/app.ts  +5 │  │                                        │               │
│  │ A src/new.ts  +20│  │                                        │               │
│  └──────────────────┘  │                                        │               │
│                        │                                        │               │
│  ▶ WORKING CHANGES (N) │                                        │               │
│  [🌲⊟] 📁/📄 toggle   │                                        │               │
│  ┌ Staged (2)          │                                        │               │
│  │  M file1.ts  [−]   │                                        │               │
│  ├ Changes (3)         │                                        │               │
│  │  M file2.ts  [+]   │                                        │               │
│  ├ Untracked (1)       │                                        │               │
│  │  ? file3.ts  [🗑]  │                                        │               │
│  └──────────────────┘  │                                        │               │
│                        │                                        │               │
│  ▶ HISTORY (N)         │                                        │               │
│  ┌──────────────────┐  │                                        │               │
│  │ ⠿● abc1234 Fix…  │  │                                        │               │
│  │ ⠿○ def5678 Add…  │  │                                        │               │
│  │ ─── pushed ───   │  │                                        │               │
│  │  ○ ghi9012 Old…  │  │                                        │               │
│  └──────────────────┘  │                                        │               │
│  [Load more]           │                                        │               │
├────────────────────────┴────────────────────────────────────────┴───────────────┤
│  Reorder 2 unpushed commits?                        [Apply] [Cancel]           │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**Legend:**
- `⠿` = Drag handle for unpushed commits (visible on hover)
- `🤖` = Commit chat toggle button
- `[🌲⊟]` = Flat/tree view toggle
- Conflict banner and reorder banner appear conditionally

---

## 8. Error Handling Specification

| Error Scenario | Expected Behavior |
|---|---|
| Initial git load failure | Full-page red error message |
| Refresh failure | `refreshError` strip below header |
| Git action failure (fetch/pull/push/reset/cherry-pick/amend/rebase/merge/stash/reword/reorder) | `actionError` strip below header |
| Cherry-pick conflicts | Conflict banner appears with AI Resolve, Continue, and Abort buttons |
| Merge conflicts | Conflict banner appears with AI Resolve, Continue, and Abort buttons |
| Rebase conflicts | Conflict banner appears with AI Resolve, Continue, and Abort buttons |
| Pull/rebase/reword/reorder job failure | Error from polled job status shown in action error strip |
| Working tree action failure | Section-level error display |
| Branch file list failure | `filesError` in branch changes section |
| Diff load failure | Error text with Retry button |
| Commit chat binding fetch failure | Red error message in chat panel |
| Commit chat rebind failure | Silent (best-effort); binding remains at old hash |
| Commit chat task creation failure | Error message in chat panel; user can retry |

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
| Commit chat — no chat yet | Icon + "Chat about this commit" + input field with "Ask about this commit…" placeholder |

---

## 10. Keyboard Shortcuts

| Key | Context | Action |
|---|---|---|
| `R` / `r` | Left pane (not in input/textarea) | Refresh commits and working tree |
| `↑` / `↓` | Commit list | Move selection |
| `Shift+↑` / `Shift+↓` | Commit list | Extend multi-select |
| `↑` / `↓` / `Enter` / `Escape` | Branch picker modal | Navigate, select, close |
| `Escape` | Amend modal | Cancel |
| `Enter` | Commit chat input (not empty) | Send message |
| `Shift+Enter` | Commit chat input | Insert line break |

---

## 11. API Dependencies

### 11.1 Commit Routes

| Endpoint | Used by | Critical for |
|---|---|---|
| `GET /api/workspaces/:id/git/commits` | Commit list | US-01, US-02 |
| `GET /api/workspaces/:id/git/commits/:hash` | Commit detail | US-04 |
| `GET /api/workspaces/:id/git/commits/:hash/files` | Commit file list | US-04, US-05 |
| `GET /api/workspaces/:id/git/commits/:hash/diff` | Full commit diff | US-04 |
| `GET /api/workspaces/:id/git/commits/:hash/files/*/diff` | Single file diff | US-05 |
| `GET /api/workspaces/:id/git/commits/:hash/files/*/content` | File content (max 2MB) | US-05 |

### 11.2 Branch Routes

| Endpoint | Used by | Critical for |
|---|---|---|
| `GET /api/workspaces/:id/git/branches` | Branch picker | US-07 |
| `GET /api/workspaces/:id/git/branch-status` | Ahead/behind badge | US-07 |
| `POST /api/workspaces/:id/git/branches` | Create branch | US-07b |
| `POST /api/workspaces/:id/git/branches/switch` | Branch switch | US-07 |
| `POST /api/workspaces/:id/git/branches/rename` | Rename branch | US-07c |
| `DELETE /api/workspaces/:id/git/branches/:name` | Delete branch | US-07d |

### 11.3 Branch Range Routes

| Endpoint | Used by | Critical for |
|---|---|---|
| `GET /api/workspaces/:id/git/branch-range` | Branch overview | US-08 |
| `GET /api/workspaces/:id/git/branch-range/files` | Branch file list | US-08 |
| `GET /api/workspaces/:id/git/branch-range/diff` | Full branch range diff | US-08 |
| `GET /api/workspaces/:id/git/branch-range/files/*/diff` | Branch file diff | US-08 |

### 11.4 Sync & Git Operations

| Endpoint | Used by | Critical for |
|---|---|---|
| `POST /api/workspaces/:id/git/fetch` | Fetch | US-09 |
| `POST /api/workspaces/:id/git/pull` | Pull (202 + jobId) | US-09 |
| `POST /api/workspaces/:id/git/push` | Push | US-09 |
| `POST /api/workspaces/:id/git/rebase-autosquash` | Rebase (202 + jobId) | US-09 |
| `POST /api/workspaces/:id/git/merge` | Merge branch | US-09b |
| `POST /api/workspaces/:id/git/stash` | Stash changes | US-09c |
| `POST /api/workspaces/:id/git/stash/pop` | Pop stash | US-09c |
| `POST /api/workspaces/:id/git/amend` | Amend HEAD commit | US-10 |
| `POST /api/workspaces/:id/git/reword` | Reword non-HEAD commit (202 + jobId) | US-10b |
| `POST /api/workspaces/:id/git/reset` | Hard reset | US-17 |
| `POST /api/workspaces/:id/git/cherry-pick` | Cherry-pick | US-18 |
| `POST /api/workspaces/:id/git/rebase-reorder` | Reorder commits (202 + jobId) | US-18b |

### 11.5 Conflict Resolution

| Endpoint | Used by | Critical for |
|---|---|---|
| `GET /api/workspaces/:id/git/repo-state` | Conflict detection | US-20 |
| `POST /api/workspaces/:id/git/rebase-continue` | Continue rebase (202 + jobId) | US-21 |
| `POST /api/workspaces/:id/git/rebase-abort` | Abort rebase | US-21 |
| `POST /api/workspaces/:id/git/merge-continue` | Continue merge (202 + jobId) | US-21 |
| `POST /api/workspaces/:id/git/merge-abort` | Abort merge | US-21 |

### 11.6 Working Tree Routes

| Endpoint | Used by | Critical for |
|---|---|---|
| `GET /api/workspaces/:id/git/changes` | Working tree + repo state | US-11, US-20 |
| `POST /api/workspaces/:id/git/changes/stage` | Stage file | US-12 |
| `POST /api/workspaces/:id/git/changes/unstage` | Unstage file | US-12 |
| `POST /api/workspaces/:id/git/changes/stage-batch` | Stage all | US-12 |
| `POST /api/workspaces/:id/git/changes/unstage-batch` | Unstage all | US-12 |
| `POST /api/workspaces/:id/git/changes/discard` | Discard changes | US-13 |
| `DELETE /api/workspaces/:id/git/changes/untracked` | Delete untracked | US-13 |
| `GET /api/workspaces/:id/git/changes/files/*/diff` | Working tree file diff | US-14 |

### 11.7 Background Job Tracking

| Endpoint | Used by | Critical for |
|---|---|---|
| `GET /api/workspaces/:id/git/ops/latest` | Resume running operation | Background ops |
| `GET /api/workspaces/:id/git/ops/:jobId` | Poll job status | Background ops |

### 11.8 Diff Comments

| Endpoint | Used by | Critical for |
|---|---|---|
| `GET /api/diff-comment-counts/:wsId` | Comment counts per storage key | US-15, US-16 |
| `GET /api/diff-comment-totals/:wsId` | Comment totals per commit | US-16 |
| `GET /api/diff-comments/:wsId` | List all comments in workspace | US-16 |
| `POST /api/diff-comments/:wsId` | Create comment | US-15 |
| `GET /api/diff-comments/:wsId/:key` | List comments for storage key | US-16 |
| `GET /api/diff-comments/:wsId/:key/:id` | Get single comment | US-15b |
| `PATCH /api/diff-comments/:wsId/:key/:id` | Update comment | US-15b |
| `DELETE /api/diff-comments/:wsId/:key/:id` | Delete comment | US-15b |
| `POST /api/diff-comments/:wsId/:key/:id/replies` | Add reply | US-15b |
| `POST /api/diff-comments/:wsId/:key/:id/ask-ai` | AI clarification on single comment | US-15c |
| `POST /api/diff-comments/:wsId/resolve-with-ai` | Unified multi-file AI resolution | US-15c |

### 11.9 Commit Chat Bindings

| Endpoint | Used by | Critical for |
|---|---|---|
| `GET /api/workspaces/:id/commit-chat-bindings` | List all bindings | US-23 |
| `GET /api/workspaces/:id/commit-chat-bindings/:hash` | Get binding for commit | US-23 |
| `POST /api/workspaces/:id/commit-chat-bindings` | Create binding | US-23 |
| `POST /api/workspaces/:id/commit-chat-bindings/rebind` | Move binding after amend/rebase | US-24 |
| `DELETE /api/workspaces/:id/commit-chat-bindings/:hash` | Remove binding | US-23 |

### 11.10 Skills & Queue

| Endpoint | Used by | Critical for |
|---|---|---|
| `GET /api/workspaces/:id/skills` | Skill list for context menu | US-19 |
| `POST /api/queue` | Task enqueue (AI, chat, skill, squash) | US-19, US-22, US-23 |
| `GET /api/workspaces/:id/preferences/commit-skill-usage` | Commit-scoped skill MRU ordering | US-19 |
| `PATCH /api/workspaces/:id/preferences/commit-skill-usage` | Record commit-scoped skill usage | US-19 |

---

## Revision History

| Version | Date | Summary |
|---|---|---|
| 1.0.0 | 2026-03-25 | Initial specification |
| 2.0.0 | 2026-04-05 | Major update: added branch CRUD (US-07b/c/d), merge (US-09b), stash (US-09c), commit reword (US-10b), commit drag-to-reorder (US-18b), squash (US-18c), conflict resolution with AI (US-20/21/22), commit chat panel (US-23/24), diff comment management (US-15b/c), flat/tree view toggle (US-06b), last-refreshed timestamp, 33+ new API routes, updated context menus, 6 new behavioral invariants |
