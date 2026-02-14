# UX Specification: Plan File Review Status Tracking

## 1. User Story

As a developer managing multiple plan files in the Tasks Viewer,
I want to easily see which plan files I've reviewed and which still need attention,
So that I can track my progress and ensure nothing falls through the cracks.

---

## 2. Proposed Solution: Review Status Indicator

Add a visual status indicator to plan files (and optionally other task documents) showing whether they've been reviewed.

### Status States

| Status | Icon | Description |
|--------|------|-------------|
| Unreviewed | ○ (empty circle) or subtle/dim appearance | File has not been marked as reviewed |
| Reviewed | ✓ (checkmark) with accent color | File has been explicitly marked as reviewed |
| Needs Re-review | ↻ (refresh) or ! indicator | File was modified after being marked reviewed |

---

## 3. Entry Points

### Context Menu (Right-Click)

On any plan/spec/task document:
- "Mark as Reviewed" (when unreviewed)
- "Mark as Unreviewed" (when reviewed)
- "Mark All in Folder as Reviewed"

---

## 4. Implementation Tasks

### 4.1 Data Storage Design

**Storage Options Comparison:**

| Option | Pros | Cons |
|--------|------|------|
| Workspace State (Memento) | Simple API, auto-sync with VS Code settings | Not visible/editable by user, tied to workspace |
| Config File (`.vscode/task-review-status.json`) | Portable, git-trackable, user-editable | Requires file I/O, manual sync |

**Recommended Approach:** Use workspace state (Memento) via `context.workspaceState`

**Data Structure:**
```typescript
interface ReviewStatusStore {
  // Key: relative path from tasks root (e.g., "TaskPanel/review-status-tracking.plan.md")
  // Value: review status record
  [relativePath: string]: ReviewStatusRecord;
}

interface ReviewStatusRecord {
  status: 'reviewed' | 'unreviewed';
  reviewedAt: string;           // ISO timestamp when marked reviewed
  fileHashAtReview: string;     // MD5/SHA hash of file content when reviewed
  reviewedBy?: string;          // Optional: user identifier
}
```

**Hash-based Change Detection:**
- Store file content hash when marking as reviewed
- On tree refresh, compare current hash with stored hash
- If hashes differ → status becomes "needs-re-review"

- [x] Design data storage for review status (workspace state or config file)
  - **Decision:** Use workspace state (Memento) via `context.workspaceState`
  - **Storage key:** `taskReviewStatus` containing `ReviewStatusStore` object
  - **Data structure:** Map of relative file paths → `ReviewStatusRecord` (status, reviewedAt, fileHashAtReview)
  - **Change detection:** Compare MD5 hash of current file content with `fileHashAtReview` to detect modifications
- [x] Add review status types and interfaces
  - Added `ReviewStatus`, `ReviewStatusRecord`, `ReviewStatusStore` types to `types.ts`
- [x] Implement status persistence layer
  - Created `ReviewStatusManager` class with workspace state persistence
  - Supports marking files/folders as reviewed/unreviewed
  - Emits events on status changes for tree refresh
- [x] Add status icons to tree items
  - `TaskItem`: Shows pass (✓) for reviewed, sync (↻) for needs-re-review, file-text for unreviewed
  - `TaskDocumentItem`: Same icons, overrides doc-type icon when reviewed
  - `TaskDocumentGroupItem`: Shows aggregate status (all-reviewed, some-reviewed, has-re-review, none-reviewed)
- [x] Implement context menu commands
  - `tasksViewer.markAsReviewed` - Mark single task/document as reviewed
  - `tasksViewer.markAsUnreviewed` - Mark single task/document as unreviewed
  - `tasksViewer.markGroupAsReviewed` - Mark all documents in group as reviewed
  - `tasksViewer.markGroupAsUnreviewed` - Mark all documents in group as unreviewed
  - `tasksViewer.markFolderAsReviewed` - Mark all files in folder as reviewed (recursive)
- [x] Add file modification detection for "Needs Re-review" state
  - MD5 hash comparison detects file changes since last review
  - `getFilesNeedingReReview()` returns list of modified reviewed files
- [x] Write unit tests
  - 50+ tests in `tasks-review-status.test.ts` covering:
    - Initialization and persistence
    - Status operations (mark reviewed/unreviewed)
    - File modification detection
    - Folder operations
    - Cleanup operations
    - Statistics
    - Event emission
    - Cross-platform path handling
    - Tree item status updates
- [x] Update documentation

---

## 5. Open Questions

- [ ] Should status be stored in workspace state (Memento) or in a config file?
- [ ] Should we track review status for all task documents or only `.plan.md` files?
- [ ] Should "Mark All in Folder as Reviewed" include nested subfolders?
