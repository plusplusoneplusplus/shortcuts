# UX Spec: Git Tab — Left/Right Split Layout

## User Story

As a developer using the CoC dashboard, I want the Git tab to use a **master-detail (left/right) layout** so I can browse commits on the left while viewing commit details and diffs on the right — without losing my place in the commit list.

**Problem today:** The Git tab is fully vertical. Expanding a commit pushes the rest of the list off-screen, making it hard to compare commits or quickly scan through history while reading diffs.

---

## Layout Design

### Overall Structure

```
┌─────────────────────────────────────────────────────────────────┐
│  Info │ Git │ Pipelines │ Tasks │ Queue │ Schedules │ Chat      │
├──────────────────────┬──────────────────────────────────────────┤
│  COMMIT LIST (left)  │  COMMIT DETAIL (right)                  │
│  ≈320px, fixed       │  flex-1, fills remaining width          │
│                      │                                          │
│  ┌────────────────┐  │  ┌────────────────────────────────────┐  │
│  │ UNPUSHED (3)   │  │  │ Author: Yiheng Tao                 │  │
│  │                │  │  │ Date: 3/1/2026, 1:04:52 AM         │  │
│  │  ● 91a21a3b    │  │  │ Parents: 53fc491    [Copy Hash]    │  │
│  │    feat(tasks)…│◄─┤  │                                    │  │
│  │  ○ 53fc4916    │  │  │ 3 files changed                    │  │
│  │    feat(coc)…  │  │  │  M  TaskSearchResults.tsx           │  │
│  │  ○ 8b714478    │  │  │  M  TasksPanel.tsx                  │  │
│  │    feat(tasks)…│  │  │  M  TasksPanel.test.tsx             │  │
│  │                │  │  │                                    │  │
│  │ HISTORY (47)   │  │  │ ──── Diff ──────────────────────── │  │
│  │                │  │  │ diff --git a/…/TaskSearchResults…  │  │
│  │  ○ baf2f118    │  │  │  @@ -3,10 +3,26 @@                │  │
│  │    feat(coc)…  │  │  │  +import type { ReactNode }…      │  │
│  │  ○ bc79c470    │  │  │  +export function highlight…      │  │
│  │    feat: per…  │  │  │  …                                │  │
│  │  ○ d2f60e46    │  │  │                                    │  │
│  │    feat(coc)…  │  │  └────────────────────────────────────┘  │
│  │  …             │  │                                          │
│  └────────────────┘  │                                          │
├──────────────────────┴──────────────────────────────────────────┤
```

### Left Panel — Commit List

- **Width:** Fixed ~320px (matching existing `ReposGrid` sidebar pattern)
- **Full height** of the tab area, independently scrollable
- **Sections:** "UNPUSHED (N)" and "HISTORY (N)" as sticky section headers
- **Each row shows:**
  - Status indicator (filled dot = selected, hollow = unselected)
  - Short hash (monospace, blue link color)
  - Commit subject (truncated)
  - Relative time + author on a second sub-line (smaller, muted text)
- **Single-select behavior:** Clicking a commit selects it and populates the right panel. No expand/collapse accordion — the list stays compact.
- **Keyboard:** `↑`/`↓` to navigate, `Enter` to select. Focus ring on active row.

### Right Panel — Commit Detail

- **Fills remaining width** (`flex-1`)
- **Full height**, independently scrollable
- **Sections (top to bottom):**
  1. **Header bar:** Commit subject as title, short hash badge, [Copy Hash] button
  2. **Metadata:** Author, date, parent hashes — single line, compact
  3. **Changed files list:** File status badges (A/M/D) + file paths. Clicking a file scrolls the diff to that file's hunk.
  4. **Diff view:** Always visible for the selected commit (no toggle needed). Full unified diff with syntax-highlighted `+`/`-` lines. Scrollable with max-height uncapped (panel itself scrolls).
- **Empty state:** When no commit is selected, show a centered message: "Select a commit to view details" with a muted git icon.

---

## User Flow

### Primary Flow — Browse Commits

1. User navigates to the **Git** tab
2. Commit list loads on the left; the **most recent commit is auto-selected**
3. Right panel shows that commit's details and diff
4. User clicks another commit → right panel updates instantly (files list re-fetches, diff re-fetches)
5. User scrolls the commit list independently of the detail panel

### Secondary Flow — Quick Scan

1. User uses `↑`/`↓` keys to move through commits rapidly
2. Right panel updates on each selection (with loading skeleton for diff)
3. User finds the commit they're looking for, reads the full diff

### Secondary Flow — Copy & Navigate

1. User clicks **Copy Hash** → hash copied to clipboard, brief toast/flash
2. User clicks a **file path** in the changed files list → diff scrolls to that file's section

---

## Edge Cases & Error Handling

| Scenario | Behavior |
|----------|----------|
| **No commits** (empty repo) | Left panel: "No commits found" centered. Right panel: empty state. |
| **Commit list loading** | Left panel: skeleton rows. Right panel: empty state. |
| **Diff loading** | Right panel: file list appears first (fast), diff section shows spinner/skeleton below. |
| **Diff fetch error** | Show inline error in diff section with "Retry" button. File list stays visible. |
| **Very long diff** | Diff scrolls within the right panel. No max-height cap. Consider adding a "N files changed, +X −Y lines" summary at the top. |
| **Narrow viewport (<900px)** | Fall back to **stacked vertical layout** (current behavior) for small screens. |
| **Commit with no file changes** | File list: "No files changed". Diff section: hidden. |

---

## Visual Design Considerations

### Colors & Theming

- Follow existing dark/light theme tokens (`bg-[#fafafa]` / `dark:bg-[#1e1e1e]`)
- Selected commit row: subtle highlight background (`bg-blue-50 dark:bg-blue-900/20`)
- Diff additions: green background (`bg-[#dafbe1] dark:bg-[#1a3a2a]`)
- Diff deletions: red background (`bg-[#ffebe9] dark:bg-[#3a1a1a]`)
- File status badges: existing colors — A=green, M=blue, D=red

### Panel Separator

- 1px vertical border between panels (`border-r` on left panel)
- No resizable splitter (matches existing codebase patterns — ReposView and TasksPanel both use fixed widths)

### Transitions

- Commit selection: instant panel swap, no animation
- Diff loading: skeleton placeholder matching diff line height

### Icons

- No new icons needed. Reuse existing chevron, copy, file-status indicators.

---

## Settings & Configuration

No new settings required. The layout change is a direct replacement of the current vertical view.

**Future consideration:** A user preference to toggle between "split" and "stacked" layout could be added later, but is not in scope for this iteration.

---

## Discoverability

This is a **layout improvement**, not a new feature. Users will see the change immediately when opening the Git tab. No onboarding or documentation needed.

---

## Implementation Notes (non-code)

- **Follows existing patterns:** The `ReposView` component already implements a left/right split (`aside w-[280px]` + `main flex-1`). The Git tab layout should mirror this approach.
- **Removes accordion expand/collapse** in the commit list — replaces it with single-select highlighting.
- **Diff is always shown** for the selected commit (no "View Full Diff" toggle). This reduces clicks and matches the mental model of a detail panel.
- **File click → scroll-to-hunk** is a nice-to-have for the first iteration; can be deferred.

---

## Comparison: Before → After

| Aspect | Before (Current) | After (Proposed) |
|--------|-------------------|------------------|
| Layout | Single vertical scroll | Left/right split |
| Commit browsing | Accordion expand/collapse | Single-select in persistent list |
| Diff visibility | On-demand toggle button | Always visible for selected commit |
| Context retention | Expanding pushes list off-screen | List stays in view at all times |
| Keyboard nav | None | ↑/↓ to move, Enter to select |
