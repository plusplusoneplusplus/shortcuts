# Comments Dropdown Menu Refactoring Plan

## Overview

Refactor the markdown review editor toolbar to consolidate "Resolve All" and "Sign Off" actions into a unified "Comments" dropdown menu. The dropdown will also display active (unresolved) comments with hover preview functionality for quick navigation and comment management.

## Current State Analysis

### Existing Toolbar Structure (`webview-content.ts`, lines 119-196)
- **Resolve All** button (`#resolveAllBtn`): Resolves all open comments
- **Sign Off** button (`#deleteAllBtn`): Deletes all comments (sign-off workflow)
- Both buttons are in `toolbar-group toolbar-review-only` container
- AI Action dropdown already exists as a reference implementation pattern

### Existing Event Handlers (`dom-handlers.ts`)
- `setupToolbarEventListeners()` at line 447: Handles click events for both buttons
- `setupToolbarInteractions()` at line 1886: Re-attaches listeners after re-render
- `requestResolveAll()` and `requestDeleteAll()` functions send messages to extension

### Comments Data Structure (`types.ts`)
- `MarkdownComment` interface with `id`, `status`, `comment`, `selectedText`, `selection`, etc.
- Status can be `'open' | 'resolved' | 'pending'`
- Comments available via `state.comments` in webview

---

## Implementation Tasks

### Phase 1: HTML Structure

- [x] **1.1** Update `webview-content.ts` to replace Resolve All and Sign Off buttons with a Comments dropdown
  - Create new dropdown structure similar to existing AI Action dropdown
  - Include "Resolve All" and "Sign Off" as menu items
  - Add separator and "Active Comments" section header
  - Add placeholder for dynamic comment list

### Phase 2: CSS Styling

- [x] **2.1** Add/update CSS in `media/styles/components.css` or create new styles
  - Style the Comments dropdown menu container
  - Style menu items (Resolve All, Sign Off)
  - Style the active comments list section
  - Style comment preview items with truncation
  - Add hover preview tooltip styling (similar to `predefinedPreview` pattern)

### Phase 3: JavaScript Event Handlers

- [x] **3.1** Update `dom-handlers.ts` to add Comments dropdown functionality
  - Create `setupCommentsDropdown()` function
  - Handle dropdown open/close toggle
  - Maintain Resolve All and Sign Off click handlers (redirect to existing functions)

- [x] **3.2** Implement dynamic comment list population
  - Filter `state.comments` for unresolved (`status === 'open'`) comments
  - Generate list items with comment preview (truncated text)
  - Add click handler to navigate to comment location

- [x] **3.3** Implement hover preview functionality
  - Show tooltip with full comment text on hover
  - Position tooltip appropriately (avoid overflow)
  - Hide tooltip on mouse leave

- [x] **3.4** Update `setupToolbarInteractions()` to handle Comments dropdown after re-render

### Phase 4: Comment Navigation

- [x] **4.1** Implement "go to comment" from dropdown
  - Scroll to the comment's line in the editor
  - Highlight or focus the commented text
  - Optionally show the comment bubble

### Phase 5: State Updates

- [x] **5.1** Update dropdown badge/count when comments change
  - Show count of active comments on dropdown button
  - Refresh comment list when comments are added/resolved/deleted

### Phase 6: Testing & Polish

- [x] **6.1** Test dropdown behavior in Review mode
- [x] **6.2** Verify dropdown is hidden in Source mode (respects `toolbar-review-only`)
- [x] **6.3** Test keyboard accessibility
- [x] **6.4** Test with many comments (scrollable list if needed)
- [x] **6.5** Test hover preview positioning edge cases

---

## UI Design Specification

### Dropdown Button
```
[💬 Comments (3) ▼]
```
- Icon: 💬 (speech bubble)
- Label: "Comments"
- Badge: Active comment count in parentheses
- Arrow: Dropdown indicator

### Dropdown Menu Structure
```
┌─────────────────────────────────┐
│ ✅ Resolve All                  │
│ 🗑️ Sign Off                     │
├─────────────────────────────────┤
│ Active Comments                 │  ← Section header
├─────────────────────────────────┤
│ 💬 "Fix the typo in this..."   │  ← Comment item (hover shows full text)
│ 💬 "Consider using async..."   │
│ 💬 "This section needs..."     │
└─────────────────────────────────┘
```

### Hover Preview Tooltip
- Shows full comment text (up to 200 chars)
- Shows selected text excerpt
- Shows line number
- Positioned to the right or left of the menu item

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/shortcuts/markdown-comments/webview-content.ts` | Replace toolbar buttons with dropdown HTML |
| `src/shortcuts/markdown-comments/webview-scripts/dom-handlers.ts` | Add dropdown handlers, comment list, hover preview |
| `media/styles/components.css` | Add dropdown and hover preview styles |
| `src/shortcuts/markdown-comments/webview-scripts/render.ts` | Update stats display integration (optional) |

---

## Notes

- Leverage existing AI Action dropdown as implementation reference
- The `predefinedPreview` tooltip pattern can be reused for hover previews
- Comments are already available in `state.comments` array
- Existing `showCommentBubble()` function can be used for navigation highlight
- Consider max height with scroll for comment list (when many comments)
