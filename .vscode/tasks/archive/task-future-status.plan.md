---
status: done
---

# Task Future Status - Implementation Plan

## Problem Statement

Currently, tasks in the Task Panel support statuses like `pending`, `in-progress`, `done`, and `archived`. Users need the ability to mark tasks as "future" — indicating tasks they've captured but won't pick up immediately. This allows better task triage by separating actionable items from backlog/someday tasks.

---

## Acceptance Criteria

1. **New "future" status**: Tasks can be marked with `status: future` in frontmatter
2. **Visual distinction**: Future tasks display with a distinct icon/style in the tree view
3. **Context menu action**: "Mark as Future" option available for tasks
4. **Status transition**: Future tasks can be moved to `pending` or `in-progress` when ready
5. **Filter support**: Option to show/hide future tasks in the Tasks Viewer
6. **Backward compatible**: Existing tasks without the status continue to work

---

## Subtasks

### Phase 1: Core Status Support

- [x] **1.1 Update TaskStatus type**
  - Add `'future'` to the `TaskStatus` union type
  - Update type definitions in task-related files

- [x] **1.2 Update frontmatter parsing**
  - Ensure `status: future` is recognized and parsed correctly
  - Update `TaskDocument` interface if needed

- [x] **1.3 Add future status icon**
  - Choose appropriate icon (e.g., `calendar`, `clock`, `hourglass`)
  - Register icon in `tree-icon-utils.ts` or task tree items

### Phase 2: Tree View Integration

- [x] **2.1 Update TasksTreeDataProvider**
  - Handle `future` status in tree item generation
  - Apply visual styling (grayed out, distinct icon)

- [x] **2.2 Add filter for future tasks**
  - Add setting: `workspaceShortcuts.tasksViewer.showFuture`
  - Implement filter logic in tree data provider

- [x] **2.3 Add "Future" section grouping (optional)**
  - Consider grouping future tasks separately in tree view
  - Or sort them after pending/in-progress tasks

### Phase 3: Commands

- [x] **3.1 Add "Mark as Future" command**
  - Command: `tasksViewer.markAsFuture`
  - Available in task context menu
  - Updates frontmatter status field

- [x] **3.2 Add "Mark as Pending" command**
  - Command: `tasksViewer.markAsPending`
  - Allows promoting future tasks back to actionable

- [x] **3.3 Update status cycle commands**
  - Ensure existing status toggle commands account for `future`
  - Define transition flow: `future` → `pending` → `in-progress` → `done`

### Phase 4: Polish

- [x] **4.1 Add keyboard shortcut**
  - Consider shortcut for quick future marking

- [x] **4.2 Update documentation**
  - Document the new status in CLAUDE.md
  - Update any user-facing help text

- [x] **4.3 Add tests**
  - Unit tests for status parsing
  - Integration tests for tree view display

---

## Implementation Details

### Frontmatter Format

```yaml
---
title: Research new authentication library
status: future
created: 2026-01-31
tags: [research, auth]
---
```

### Status Transitions

```
                    ┌──────────┐
                    │  future  │
                    └────┬─────┘
                         │ (when ready to work on)
                         ▼
┌─────────┐       ┌──────────┐       ┌─────────────┐       ┌──────┐
│  (new)  │──────▶│ pending  │──────▶│ in-progress │──────▶│ done │
└─────────┘       └──────────┘       └─────────────┘       └──────┘
                         │                                      │
                         └──────────────────────────────────────┘
                                    (can also skip to done)
```

### Suggested Icon

- **Primary choice**: `$(calendar)` - indicates scheduled/future timing
- **Alternative**: `$(clock)` or `$(watch)` - indicates deferred

### Configuration

```json
{
    "workspaceShortcuts.tasksViewer.showFuture": {
        "type": "boolean",
        "default": true,
        "description": "Show tasks marked as 'future' in the Tasks Viewer"
    }
}
```

---

## Notes

- The `future` status is conceptually similar to "backlog" or "someday/maybe" in GTD methodology
- Consider whether `future` tasks should be excluded from task counts in status bar
- Future tasks might benefit from an optional `scheduledFor` date field in future iterations
- Keep the implementation minimal — just the status first, additional features (like scheduled dates) can come later

---

## Related Files

- `src/shortcuts/tasks-viewer/task-manager.ts` - Task management logic
- `src/shortcuts/tasks-viewer/tasks-tree-data-provider.ts` - Tree view rendering
- `src/shortcuts/tasks-viewer/types.ts` - Task type definitions
- `src/shortcuts/commands.ts` - Command registration

---

## Open Questions

1. **Icon choice**: Which icon best represents "future" tasks?
   - Recommendation: `$(calendar)` for clarity

2. **Default visibility**: Should future tasks be shown by default?
   - Recommendation: Yes, show by default with visual distinction

3. **Sort order**: Where should future tasks appear in the list?
   - Recommendation: After in-progress, before done (or in separate section)
