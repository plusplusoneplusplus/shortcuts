# Support Drag Task MD File to Move Into/Out of Features

## Problem Statement
Currently, the Tasks panel supports drag-and-drop for:
- Dragging task files **out** to external targets (e.g., Copilot Chat) via `text/uri-list`
- Dropping **external** .md files **into** the Active Tasks group

However, users cannot drag task files **within** the tree view to move them between:
- Root level → Feature folder (moving into a feature)
- Feature folder → Root level (moving out of a feature)
- Feature folder → Different feature folder

## Proposed Approach
Extend `TasksDragDropController` to support internal tree rearrangement (move operations).

## Workplan

- [x] **1. Add move method to TaskManager**
  - Add `moveTask(sourcePath: string, targetFolder: string): Promise<string>` method
  - Handle collision detection and naming conflicts
  - Return new file path after move

- [x] **2. Update TasksDragDropController drag MIME types**
  - Add custom MIME type `application/vnd.code.tree.tasksView` for internal drag
  - Continue supporting `text/uri-list` for external drag compatibility

- [x] **3. Update handleDrag to include internal drag data**
  - Serialize task item info (filePath, relativePath) to custom MIME type
  - Keep existing `text/uri-list` for external compatibility

- [x] **4. Update handleDrop to support internal moves**
  - Detect internal drag via custom MIME type
  - Accept drops on:
    - `TaskFolderItem` (feature folders) - move into folder
    - `TaskGroupItem` with `groupType === 'active'` - move to root
  - Skip if source === target location
  - Call `taskManager.moveTask()` to perform the move

- [x] **5. Handle document groups during drag**
  - When dragging `TaskDocumentGroupItem`, move all related documents together
  - Keep document grouping intact after move

- [x] **6. Add tests for move functionality**
  - Test moving single file into feature
  - Test moving single file out of feature
  - Test moving document group into feature
  - Test collision handling
  - Test move between different features

- [x] **7. Update tree view registration**
  - Ensure `dragAndDropController` is registered with proper MIME types
  - Verify tree view supports internal drag-and-drop

## Technical Notes

### Current Implementation Review
- `TasksDragDropController` already has basic drag/drop infrastructure
- `TaskManager` has `renameTask` and `archiveTask` methods that do file moves
- `TaskFolderItem` has `contextValue: 'taskFolder'` for command targeting

### Key Files to Modify
1. `src/shortcuts/tasks-viewer/task-manager.ts` - Add `moveTask()` method
2. `src/shortcuts/tasks-viewer/tasks-drag-drop-controller.ts` - Extend drag/drop logic
3. `src/test/suite/tasks-viewer.test.ts` - Add move tests

### MIME Type Strategy
```typescript
// Internal drag (for tree rearrangement)
readonly dragMimeTypes = ['text/uri-list', 'application/vnd.code.tree.shortcutsTasksView'];
readonly dropMimeTypes = ['text/uri-list', 'application/vnd.code.tree.shortcutsTasksView'];
```

### Drop Target Acceptance
| Target | Action |
|--------|--------|
| `TaskFolderItem` (non-archived) | Move files into feature folder |
| `TaskGroupItem` (active) | Move files to tasks root |
| `TaskFolderItem` (archived) | Reject (archive via command instead) |
| Other items | Reject |

## Considerations
- Moving a file that's part of a document group should ask user: move single doc or entire group?
- Collision handling: rename with suffix if target name exists
- Preserve related.yaml links if moving entire feature (out of scope for this task)
