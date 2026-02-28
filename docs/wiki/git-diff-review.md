# Git Diff Review Editor — UX Specification

## 1. User Story

**As a developer**, I want to annotate git changes (staged, unstaged, or committed) with inline comments while reading a diff, so I can record observations, questions, and action items that persist across sessions and can be fed into AI-powered code review workflows.

Secondary personas:
- **Code reviewers** who want structured, categorized feedback organized per-file and per-commit.
- **AI-assisted reviewers** who want to generate prompts from their annotations for deeper Copilot analysis.

---

## 2. Entry Points

### Context Menus
| Location | Action |
|---|---|
| Git panel → changed file (right-click) | **Open with Diff Review** |
| Source Control file list (right-click) | **Open with Diff Review** |
| Commit node in Git History / Log (right-click) | **Open with Diff Review** |

### Command Palette
- `Open with Git Diff Review Editor` — opens the current `.git-diff-review` virtual file

### Tree View (Shortcuts Panel → Git Diff Comments)
- Clicking a **DiffCommentFileItem** re-opens the corresponding diff in the review editor
- Clicking a **DiffCommentItem** scrolls to the annotated region

### File Association
- Files with the `.git-diff-review` extension automatically open in this editor (default handler)

---

## 3. User Flow

### 3.1 Opening a Diff for Review

1. User right-clicks a changed file in the Git panel or Source Control view.
2. Selects **Open with Diff Review**.
3. A side-by-side diff editor opens:
   - **Left pane**: old version (red deletions)
   - **Right pane**: new version (green additions)
   - Syntax highlighting applied based on file language.
4. Existing comments appear as highlighted inline annotations:
   - **Yellow highlight** = open comment
   - **Green highlight** = resolved comment
5. The **Git Diff Comments** tree view populates, organizing entries under a category for the diff's origin (e.g., *Pending Changes* for unstaged, *Commit abc1234* for committed).

### 3.2 Adding a Comment

1. User selects a text range in either the old or new pane.
2. A floating action panel appears offering **Add Comment**.
3. User types their comment and confirms.
4. The selected range is highlighted (yellow). The comment appears:
   - As an inline annotation in the editor.
   - As a new **DiffCommentItem** in the tree view.

### 3.3 Editing / Deleting a Comment

- **Edit**: Right-click comment in tree → **Edit Comment** → inline input box pre-filled with existing text → confirm.
- **Delete**: Right-click comment → **Delete** → confirmation dialog → removed from editor and tree.
- **Bulk delete**: Right-click a file or category node → **Delete All** → confirmation.

### 3.4 Resolving a Comment

1. Right-click a comment in the tree or use the inline action in the editor.
2. Comment highlight changes to green; it is marked *resolved*.
3. An **Undo** toast appears for ~30 seconds to reverse the action.
4. Resolved comments can be shown/hidden via the `showResolved` setting.

### 3.5 Generating an AI Prompt

1. Right-click a comment, file, or category node in the tree.
2. Choose **Copy Prompt** (copies to clipboard) or **Show Prompt** (opens in a new editor tab).
3. The prompt includes: selected text, file path, diff side, surrounding context, and comment text.
4. Optionally choose **Ask AI** in the webview to send directly to Copilot CLI (terminal mode) or clipboard.

### 3.6 Resolving / Clearing All

- **Resolve All** at category or file level: marks all open comments resolved.
- **Delete All Resolved**: bulk-removes resolved comments at any scope level.
- **Global Undo Resolve**: restores the last resolved batch within the undo window.

---

## 4. Edge Cases & Error Handling

| Scenario | Behavior |
|---|---|
| File no longer exists (deleted since diff was captured) | Tree item shows a warning badge; opening the editor shows a "File not found" message. |
| Comment anchor becomes stale after file edits | Anchor is re-located by content fingerprint; if unrecoverable, comment is shown at the nearest valid line with a "position approximate" indicator. |
| Empty comment text on save | Validation prevents saving; an inline error message prompts for non-empty content. |
| AI not available (Copilot CLI missing) | Falls back to **Copy to Clipboard** mode; user is notified via info notification. |
| Diff has no changes | Editor shows "No changes to display" placeholder. |
| Unsaved changes in editable diff | Standard VS Code dirty-file indicator; "Save" action available in the webview toolbar. |

---

## 5. Visual Design Considerations

### Icons
| Element | Icon |
|---|---|
| Diff Comments tree view container | `$(git-pull-request)` or `$(diff)` |
| Category node (Pending Changes) | `$(source-control)` |
| Category node (Commit) | `$(git-commit)` |
| File node | File-type icon from VS Code theme |
| Open comment | `$(comment)` with yellow accent |
| Resolved comment | `$(check)` with green accent |

### Tree View Layout
```
▼ Git Diff Comments
  ▼ Pending Changes  (3 open, 1 resolved)
    ▼ src/auth/login.ts  (lines 12–18)
        "This logic might miss the refresh…"
        "Why not use the existing helper?"
  ▼ Commit abc1234
    ▼ src/api/users.ts  (lines 44–50)
        "✓ Resolved: naming looks good"
```

### Editor Webview
- Two-column layout with synchronized scrolling.
- Gutter line numbers on both sides.
- Highlighted annotation bands span the full column width.
- Floating comment panel docks to the bottom of the selection range.
- Toolbar at the top: breadcrumb path, copy/open actions, AI button (if enabled).

### Notifications
- Toast for undo after resolve (timed, dismissible).
- Info bar for AI fallback to clipboard.
- Error notification for unrecoverable anchor loss.

---

## 6. Settings & Configuration

| Setting | Default | Description |
|---|---|---|
| `workspaceShortcuts.diffReview.showResolved` | `true` | Show resolved comments in tree and editor |
| `workspaceShortcuts.diffReview.highlightColor` | Yellow (rgba) | Highlight color for open comments |
| `workspaceShortcuts.diffReview.resolvedHighlightColor` | Green (rgba) | Highlight color for resolved comments |
| `workspaceShortcuts.diffReview.askAIEnabled` | `true` | Show AI actions in context menus and webview |
| `workspaceShortcuts.diffReview.aiMenuConfig` | (built-in) | AI command menu entries (comment & interactive modes) |
| `workspaceShortcuts.diffReview.predefinedComments` | `[]` | Quick-pick comment templates for faster annotation |

---

## 7. Discoverability

- **Welcome walkthrough**: A VS Code walkthrough step titled *"Review git changes inline"* demonstrates opening the diff editor and adding a first comment.
- **Context menu prominence**: The **Open with Diff Review** action appears at the top of the right-click menu for changed files in the Source Control panel.
- **Tree view empty state**: When no comments exist, the *Git Diff Comments* panel shows a placeholder with a button: *"Open a changed file with Diff Review to start annotating."*
- **README / extension marketplace page**: Feature section with a GIF showing comment annotation and AI prompt generation.
- **Keyboard shortcut hint**: The floating annotation panel shows the shortcut key (e.g., `Ctrl+Shift+M`) on first use.
