# Display Task Queue in AI Processes Panel

## Problem Statement

When using the task queueing feature, queued tasks are only visible through the status bar (`AIQueueStatusBarItem`), which shows a brief summary like "2 running, 5 queued". Users have no way to see details about individual queued tasks, their order, or manage them directly from the AI Processes panel.

**Current Visibility:**
- Status bar: Shows aggregate counts only
- Commands: `shortcuts.queue.cancelTask` etc. use quick-pick UI
- No tree view integration

**Desired Visibility:**
- AI Processes panel should display a "Queued Tasks" section
- Each queued task shown as a tree item with name, type, priority, position
- Context menu actions for cancel, move up/down, move to top
- Real-time updates as queue changes

## Proposed Approach

Integrate `AIQueueService` with `AIProcessTreeDataProvider` to display queued tasks as a collapsible section in the AI Processes panel. This mirrors the existing "Interactive Sessions" section pattern.

### Architecture

```
AI Processes Panel (Tree View)
├── Interactive Sessions (2 active)          ← Existing
│   ├── Session 1
│   └── Session 2
├── Queued Tasks (5 pending)                 ← NEW SECTION
│   ├── #1 Follow Prompt: feature.prompt.md  ← QueuedTaskItem
│   ├── #2 Code Review: staged changes
│   ├── #3 AI Clarification: explain this
│   └── ... (priority indicators, context menus)
├── [Running Process]                        ← Existing AIProcessItem
├── [Completed Process]
└── ...
```

## Acceptance Criteria

- [x] Queued tasks section appears in AI Processes panel when queue has items
- [x] Each queued task displays: position, type, display name, priority badge
- [x] Section header shows count (e.g., "Queued Tasks (3)")
- [x] Tasks sorted by queue position (respecting priority ordering)
- [x] Context menu: Cancel, Move to Top, Move Up, Move Down
- [x] Real-time updates when queue changes (add, remove, reorder)
- [x] Click on task shows details (display name, type, created time, priority)
- [x] Section collapses/expands like Interactive Sessions
- [x] Section hidden when queue is empty
- [x] Paused state indicated in section header
- [x] Works with existing "clear history" command (only clears completed, not queued)

## Subtasks

### Phase 1: Tree Items & Section
- [x] Create `QueuedTaskItem` class extending `vscode.TreeItem`
  - Properties: contextValue, icon based on priority, description with position
  - Tooltip with full task details
  - Command to view task details (future enhancement)
- [x] Create `QueuedTasksSectionItem` class for section header
  - Collapsible state: Expanded by default
  - Label: "Queued Tasks (N)" or "Queued Tasks (N, paused)"
  - Icon: list-ordered or debug-pause when paused

### Phase 2: Tree Data Provider Integration
- [x] Add `AIQueueService` as optional dependency to `AIProcessTreeDataProvider`
- [x] Add `setQueueService(queueService: AIQueueService)` method
- [x] Modify `getChildren()` to include queued tasks section
- [x] Subscribe to `onDidChangeQueue` and `onDidChangeStats` events for refresh
- [x] Add `getQueuedTaskItems()` private method

### Phase 3: Context Menu & Commands
- [x] Register context menu contributions in `package.json`
  - `viewItem == queuedTask`: Cancel, Move to Top, Move Up, Move Down
  - `viewItem == queuedTasksSection`: Clear Queue, Pause/Resume
- [x] Wire existing queue commands to tree item context
- [ ] Add `when` clauses for move commands (not first/last item) (deferred)

### Phase 4: Extension Wiring
- [x] Update `extension.ts` to pass `aiQueueService` to tree data provider
- [x] Call `setQueueService()` after both are initialized
- [x] Ensure proper disposal order

### Phase 5: Testing
- [x] Add unit tests for `QueuedTaskItem` tree item generation
- [x] Add unit tests for `QueuedTasksSectionItem`
- [x] Add integration tests for tree data provider with queue service
- [x] Test context menu visibility conditions
- [x] Test real-time updates on queue changes

## Technical Notes

### Files to Modify

1. **`src/shortcuts/ai-service/ai-process-tree-provider.ts`**
   - Add `QueuedTaskItem` class
   - Add `QueuedTasksSectionItem` class
   - Add `queueService?: AIQueueService` field
   - Add `setQueueService()` method
   - Modify `getChildren()` for section
   - Add event subscriptions

2. **`src/extension.ts`**
   - Wire queue service to tree provider after initialization

3. **`package.json`**
   - Add context menu contributions for `queuedTask` and `queuedTasksSection`
   - Add `when` clauses for conditional menu items

4. **`src/test/suite/ai-process-tree-provider.test.ts`**
   - Add tests for queue integration

### Type Exports

Export new types from `ai-service/index.ts`:
- `QueuedTaskItem`
- `QueuedTasksSectionItem`

### Context Values

```
queuedTasksSection             - Section header
queuedTask_high                - High priority task
queuedTask_normal              - Normal priority task  
queuedTask_low                 - Low priority task
```

### Icon Choices

| Element | Icon |
|---------|------|
| Section header | `$(list-ordered)` |
| Section paused | `$(debug-pause)` |
| High priority | `$(arrow-up)` or `$(flame)` |
| Normal priority | `$(circle-outline)` |
| Low priority | `$(arrow-down)` |

### Event Flow

```
AIQueueService
  └─onDidChangeQueue──▶ AIProcessTreeDataProvider.refresh()
  └─onDidChangeStats──▶ AIProcessTreeDataProvider.refresh()
```

## Related Files

- `src/shortcuts/ai-service/ai-process-tree-provider.ts` - Main tree provider
- `src/shortcuts/ai-service/ai-queue-service.ts` - Queue service
- `src/shortcuts/ai-service/ai-queue-status-bar.ts` - Reference for stats display
- `src/shortcuts/ai-service/ai-queue-commands.ts` - Existing queue commands
- `src/shortcuts/ai-service/interactive-session-tree-item.ts` - Pattern for section items
- `src/extension.ts` - Wiring and initialization
- `package.json` - Menu contributions

## Notes

- Follow the existing `InteractiveSessionItem` / `InteractiveSessionSectionItem` pattern
- The `QueuedTask.processId` links to `AIProcess` when task starts running - at that point it transitions from queue section to main process list
- Consider adding "View in Queue" reveal functionality for running processes that came from queue
- Status bar can remain for quick glance; panel provides detailed management
- This enables future enhancements like drag-drop reordering in tree view
