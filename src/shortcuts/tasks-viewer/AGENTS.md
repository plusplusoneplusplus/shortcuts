# Tasks Viewer Module - Developer Reference

This module provides a tree view for managing markdown task files. It parses tasks from markdown files and displays them in an organized tree structure.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    VSCode Tree View                             │
│              (Tasks Panel in Side Bar)                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Renders
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Tasks Viewer Module                           │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │              TasksTreeDataProvider                          ││
│  │  - Provides tree structure for tasks                        ││
│  │  - Groups tasks by file and status                          ││
│  │  - Supports filtering and search                            ││
│  └─────────────────────────────────────────────────────────────┘│
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │   TaskManager   │  │  TaskItem       │  │ TaskGroupItem   │ │
│  │ (Parse & track) │  │ (Tree items)    │  │ (Group items)   │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │           TasksDragDropController                           ││
│  │  - Drag tasks between groups                                ││
│  │  - Reorder tasks                                            ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Parses
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│         Markdown Files with Task Lists                          │
│         (- [ ] TODO, - [x] Done, etc.)                         │
└─────────────────────────────────────────────────────────────────┘
```

## Key Components

### TasksTreeDataProvider

The main tree data provider for tasks.

```typescript
import { TasksTreeDataProvider } from '../tasks-viewer';

// Create provider
const provider = new TasksTreeDataProvider(taskManager);

// Register with VSCode
const treeView = vscode.window.createTreeView('workspaceShortcuts.tasks', {
    treeDataProvider: provider,
    dragAndDropController: new TasksDragDropController(provider)
});

// Refresh the tree
provider.refresh();

// Set filter
provider.setFilter('incomplete');

// Set search
provider.setSearch('implement');
```

### TaskManager

Manages task parsing and tracking.

```typescript
import { TaskManager } from '../tasks-viewer';

const manager = new TaskManager();

// Parse tasks from a markdown file
const tasks = await manager.parseFile(document.uri);

// Get all tasks
const allTasks = manager.getAllTasks();

// Get tasks by status
const incomplete = manager.getTasksByStatus('incomplete');
const complete = manager.getTasksByStatus('complete');

// Toggle task completion
await manager.toggleTask(taskId);

// Update task text
await manager.updateTaskText(taskId, 'New task text');

// Watch for file changes
manager.watchFiles(workspaceFolder);

// Listen for changes
manager.onDidChangeTasks((e) => {
    console.log('Tasks changed in:', e.documentUri);
});
```

### TaskItem

Tree item representing a single task.

```typescript
import { TaskItem } from '../tasks-viewer';

// Create task item
const item = new TaskItem(task, {
    showFile: true,
    showLine: true
});

// Task item properties
item.label;        // Task text
item.complete;     // Completion status
item.line;         // Line number in file
item.documentUri;  // Source file
```

### TaskGroupItem

Tree item representing a group of tasks.

```typescript
import { TaskGroupItem } from '../tasks-viewer';

// Create group item
const group = new TaskGroupItem('Documentation Tasks', tasks, {
    icon: 'book',
    collapsibleState: vscode.TreeItemCollapsibleState.Expanded
});
```

### TasksDragDropController

Handles drag and drop for task reordering.

```typescript
import { TasksDragDropController } from '../tasks-viewer';

const controller = new TasksDragDropController(treeProvider);

// The controller handles:
// - Dragging tasks between groups
// - Reordering tasks within a file
// - Dropping files into task groups
```

## Task Format

Tasks are parsed from markdown checkbox syntax:

```markdown
# Project Tasks

## Features
- [ ] Implement user authentication
- [x] Set up database connection
- [ ] Add API endpoints

## Bugs
- [ ] Fix login timeout issue
- [x] Resolve memory leak

## Documentation
- [ ] Write API documentation
- [ ] Update README
```

## Usage Examples

### Example 1: Setting Up Tasks View

```typescript
import { TaskManager, TasksTreeDataProvider, TasksDragDropController } from '../tasks-viewer';

function setupTasksView(context: vscode.ExtensionContext) {
    const taskManager = new TaskManager();
    const treeProvider = new TasksTreeDataProvider(taskManager);
    
    const treeView = vscode.window.createTreeView('workspaceShortcuts.tasks', {
        treeDataProvider: treeProvider,
        dragAndDropController: new TasksDragDropController(treeProvider),
        showCollapseAll: true
    });
    
    // Watch workspace for task files
    if (vscode.workspace.workspaceFolders) {
        taskManager.watchFiles(vscode.workspace.workspaceFolders[0]);
    }
    
    // Refresh on file changes
    taskManager.onDidChangeTasks(() => {
        treeProvider.refresh();
    });
    
    context.subscriptions.push(treeView);
    
    return { taskManager, treeProvider };
}
```

### Example 2: Parsing Tasks from Content

```typescript
import { TaskManager, Task } from '../tasks-viewer';

function parseMarkdownTasks(content: string): Task[] {
    const tasks: Task[] = [];
    const lines = content.split('\n');
    
    const taskRegex = /^(\s*)-\s+\[([ xX])\]\s+(.+)$/;
    
    lines.forEach((line, index) => {
        const match = line.match(taskRegex);
        if (match) {
            const [, indent, status, text] = match;
            tasks.push({
                id: `task-${index}`,
                text: text.trim(),
                complete: status.toLowerCase() === 'x',
                line: index + 1,
                indent: indent.length
            });
        }
    });
    
    return tasks;
}
```

### Example 3: Toggling Task Completion

```typescript
import { TaskManager } from '../tasks-viewer';

async function toggleTaskCompletion(
    manager: TaskManager,
    taskId: string
) {
    const task = manager.getTask(taskId);
    if (!task) return;
    
    // Toggle in memory
    await manager.toggleTask(taskId);
    
    // Update file
    const document = await vscode.workspace.openTextDocument(task.documentUri);
    const edit = new vscode.WorkspaceEdit();
    
    const line = document.lineAt(task.line - 1);
    const newText = task.complete
        ? line.text.replace('[x]', '[ ]').replace('[X]', '[ ]')
        : line.text.replace('[ ]', '[x]');
    
    edit.replace(task.documentUri, line.range, newText);
    await vscode.workspace.applyEdit(edit);
}
```

### Example 4: Filtering Tasks

```typescript
// Filter by status
treeProvider.setFilter('incomplete');  // Only incomplete tasks
treeProvider.setFilter('complete');    // Only complete tasks
treeProvider.setFilter('all');         // All tasks

// Search by text
treeProvider.setSearch('authentication');  // Tasks containing text

// Combined filtering
treeProvider.setFilter('incomplete');
treeProvider.setSearch('bug');  // Incomplete tasks containing 'bug'
```

## Types

### Task

```typescript
interface Task {
    /** Unique task identifier */
    id: string;
    /** Task text content */
    text: string;
    /** Whether task is complete */
    complete: boolean;
    /** Line number in source file */
    line: number;
    /** Source document URI */
    documentUri: vscode.Uri;
    /** Indentation level */
    indent: number;
    /** Parent task ID (for subtasks) */
    parentId?: string;
    /** Due date (if parsed) */
    dueDate?: Date;
    /** Priority (if parsed) */
    priority?: 'high' | 'medium' | 'low';
    /** Tags (if parsed) */
    tags?: string[];
}
```

### TaskGroup

```typescript
interface TaskGroup {
    /** Group identifier */
    id: string;
    /** Group name (heading text) */
    name: string;
    /** Tasks in this group */
    tasks: Task[];
    /** Source file */
    documentUri: vscode.Uri;
    /** Line number of group heading */
    line: number;
}
```

### TaskFilter

```typescript
type TaskFilter = 'all' | 'incomplete' | 'complete';
```

### TaskDocument

```typescript
interface TaskDocument {
    /** Base name without doc type suffix (e.g., "task1" from "task1.plan.md") */
    baseName: string;
    /** Document type suffix (e.g., "plan" from "task1.plan.md") */
    docType?: string;
    /** Full filename (e.g., "task1.plan.md") */
    fileName: string;
    /** Absolute path to the .md file */
    filePath: string;
    /** Last modified time for sorting */
    modifiedTime: Date;
    /** Whether document is in archive folder */
    isArchived: boolean;
}
```

### TaskDocumentGroup

```typescript
interface TaskDocumentGroup {
    /** Base name shared by all documents in the group */
    baseName: string;
    /** All documents in this group */
    documents: TaskDocument[];
    /** Whether this group is archived */
    isArchived: boolean;
    /** Most recent modified time among all documents */
    latestModifiedTime: Date;
}
```

## Commands

| Command | Description |
|---------|-------------|
| `shortcuts.tasks.refresh` | Refresh task list |
| `shortcuts.tasks.toggle` | Toggle task completion |
| `shortcuts.tasks.edit` | Edit task text |
| `shortcuts.tasks.goto` | Go to task in file |
| `shortcuts.tasks.filter` | Set task filter |
| `shortcuts.tasks.search` | Search tasks |

## Tree View Structure

### Standard View (flat list of tasks)

```
Tasks
├── 📄 TODO.md
├── 📄 BUGS.md
└── 📄 docs/TASKS.md
```

### Document Grouping (when enabled)

When `groupRelatedDocuments` setting is enabled (default: true), related task documents are grouped under a parent node. Files are grouped if they share the same base name with different document type suffixes.

**Example:** Files `task1.md`, `task1.plan.md`, `task1.test.md` are grouped under `task1`:

```
Tasks
├── 📁 task1 (3 docs: md, plan, test)
│   ├── 📄 task1 (base document)
│   ├── 📋 plan
│   └── 🧪 test
├── 📄 standalone.md (single doc, no grouping)
└── 📁 feature-auth (2 docs: spec, design)
    ├── 📝 spec
    └── 💡 design
```

**Recognized Document Type Suffixes:**
- `plan`, `spec`, `test`, `notes`, `todo`, `readme`
- `design`, `impl`, `implementation`, `review`, `checklist`
- `requirements`, `analysis`, `research`, `summary`, `log`
- `draft`, `final`, `v1`, `v2`, `v3`, `old`, `new`, `backup`

### Key Components for Document Grouping

- `TaskDocumentGroupItem` - Tree item for grouped documents
- `TaskDocumentItem` - Tree item for individual documents within a group
- `TaskDocument` - Interface representing a parsed document
- `TaskDocumentGroup` - Interface for a group of related documents

## Best Practices

1. **Watch efficiently**: Only watch relevant markdown files.

2. **Cache tasks**: Parse files once and update incrementally.

3. **Handle large files**: Limit parsing for very large files.

4. **Preserve formatting**: Maintain original formatting when editing.

5. **Support nesting**: Handle subtasks with proper indentation.

6. **Sync with file**: Keep tree in sync with file changes.

## Events

```typescript
// Task changes
taskManager.onDidChangeTasks((e) => {
    console.log('Changed:', e.documentUri);
    console.log('Added:', e.added);
    console.log('Removed:', e.removed);
    console.log('Updated:', e.updated);
});

// Selection changes
treeView.onDidChangeSelection((e) => {
    const task = e.selection[0];
    if (task instanceof TaskItem) {
        console.log('Selected task:', task.label);
    }
});
```

## See Also

- `src/shortcuts/markdown-comments/AGENTS.md` - Markdown parsing utilities
- VSCode TreeView API documentation
