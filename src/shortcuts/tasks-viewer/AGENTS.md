# Tasks Viewer Module - Developer Reference

This module provides a tree view for managing markdown task files. It parses tasks from markdown files and displays them in an organized tree structure with support for hierarchical folders, document grouping, task status tracking, review status management, AI-powered task creation, and discovery integration.

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
│  │  - Integrates with ReviewStatusManager                      ││
│  └─────────────────────────────────────────────────────────────┘│
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │   TaskManager   │  │  TaskItem       │  │ TaskFolderItem  │ │
│  │ (Parse & track) │  │ (Tree items)    │  │ (Folder items)  │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │TaskDocumentItem │  │TaskDocumentGroup│  │ReviewStatusMgr  │ │
│  │ (Doc items)     │  │Item (Groups)     │  │ (MD5 tracking)  │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │           TasksDragDropController                           ││
│  │  - Drag tasks between groups                                ││
│  │  - Reorder tasks                                            ││
│  └─────────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────────┐│
│  │              AI Task Commands                               ││
│  │  - ai-task-commands.ts: Create & From Feature modes        ││
│  │  - ai-task-dialog.ts: Webview dialog for options           ││
│  └─────────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────────┐│
│  │              Discovery Commands                              ││
│  │  - discovery-commands.ts: AI Discovery integration          ││
│  │  - related-items-loader.ts: YAML management                 ││
│  │  - related-items-tree-items.ts: Tree display                ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Parses
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│         Markdown Files with Task Lists                          │
│         (- [ ] TODO, - [x] Done, etc.)                         │
│         Frontmatter: status, created, type                      │
│         related.yaml: Discovery results                         │
└─────────────────────────────────────────────────────────────────┘
```

## Key Components

### TasksTreeDataProvider

The main tree data provider for tasks. **Extends `FilterableTreeDataProvider`** (as of 2026-01 refactoring) for built-in filtering, search capabilities, EventEmitter, refresh, dispose, and error handling.

```typescript
import { TasksTreeDataProvider } from '../tasks-viewer';

// The provider extends FilterableTreeDataProvider (refactored in 2026-01)
// Inherits from BaseTreeDataProvider → FilterableTreeDataProvider
// All common tree provider functionality built-in
const provider = new TasksTreeDataProvider(taskManager);

// Set review status manager for status tracking
provider.setReviewStatusManager(reviewStatusManager);

// Register with VSCode
const treeView = vscode.window.createTreeView('workspaceShortcuts.tasks', {
    treeDataProvider: provider,
    dragAndDropController: new TasksDragDropController(provider)
});

// Refresh the tree (inherited from base class)
provider.refresh();

// Set filter (inherited from FilterableTreeDataProvider)
provider.setFilter('incomplete');

// Set search
provider.setSearch('implement');
```

### TaskManager

Manages task parsing and tracking with recursive directory scanning and document grouping support.

```typescript
import { TaskManager } from '../tasks-viewer';

const manager = new TaskManager();

// Scan tasks recursively from tasks folder
const folders = await manager.scanTasksRecursively(tasksFolder);

// Get all tasks
const allTasks = manager.getAllTasks();

// Get tasks by status
const incomplete = manager.getTasksByStatus('incomplete');
const complete = manager.getTasksByStatus('complete');

// Watch for file changes (recursive)
manager.watchTasksFolder(() => {
    treeProvider.refresh();
});

// Listen for changes
manager.onDidChangeTasks((e) => {
    console.log('Tasks changed in:', e.documentUri);
});
```

### TaskItem

Tree item representing a single task file.

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
item.status;       // TaskStatus: 'pending' | 'in-progress' | 'done' | 'future'
```

### TaskFolderItem

Tree item representing a folder containing task files.

```typescript
import { TaskFolderItem } from '../tasks-viewer';

// Create folder item
const folderItem = new TaskFolderItem(folder, workspaceRoot);

// Folder item properties
folderItem.folder;        // TaskFolder object
folderItem.relativePath;   // Relative path from tasks root
folderItem.resourceUri;    // URI to folder
```

### TaskDocumentItem

Tree item representing an individual document within a document group.

```typescript
import { TaskDocumentItem } from '../tasks-viewer';

// Create document item
const docItem = new TaskDocumentItem(document, workspaceRoot, reviewStatusManager);

// Document item properties
docItem.document;          // TaskDocument object
docItem.baseName;          // Base name (e.g., "task1")
docItem.docType;           // Document type (e.g., "plan")
docItem.reviewStatus;      // ReviewStatus: 'reviewed' | 'unreviewed' | 'needs-re-review'
```

### TaskDocumentGroupItem

Tree item representing a group of related task documents (e.g., `task1.plan.md`, `task1.test.md`).

```typescript
import { TaskDocumentGroupItem } from '../tasks-viewer';

// Create document group item
const groupItem = new TaskDocumentGroupItem(group, workspaceRoot, reviewStatusManager);

// Group item properties
groupItem.group;           // TaskDocumentGroup object
groupItem.baseName;        // Shared base name
groupItem.reviewStatus;    // Aggregate review status
```

### ReviewStatusManager

Manages review status tracking using MD5 hash-based change detection.

```typescript
import { ReviewStatusManager } from '../tasks-viewer';

const reviewManager = new ReviewStatusManager(tasksRoot);
await reviewManager.initialize(context);

// Get review status for a file (considers file modifications)
const status = reviewManager.getStatus(filePath);
// Returns: 'reviewed' | 'unreviewed' | 'needs-re-review'

// Mark file as reviewed
await reviewManager.markAsReviewed(filePath);

// Mark file as unreviewed
await reviewManager.markAsUnreviewed(filePath);

// Mark all files in a folder as reviewed
await reviewManager.markFolderAsReviewed(folderPath);

// Listen for status changes
reviewManager.onDidChangeStatus((changedPaths) => {
    console.log('Status changed for:', changedPaths);
    treeProvider.refresh();
});
```

**Key Features:**
- MD5 hash-based change detection (automatically detects when reviewed files are modified)
- Workspace state persistence (survives extension restarts)
- Individual and folder-level marking
- Event emission for tree refresh integration

### AI Task Commands (`ai-task-commands.ts`)

Provides AI-powered task creation with two modes: "Create" and "From Feature".

```typescript
import { registerTasksAICommands } from '../tasks-viewer/ai-task-commands';

// Register AI task creation commands
const disposables = registerTasksAICommands(
    context,
    taskManager,
    treeDataProvider,
    aiProcessManager
);

// Commands registered:
// - tasksViewer.createWithAI: Create task from description
// - tasksViewer.createFromFeature: Create task from feature folder context
```

**Two Creation Modes:**

1. **Create Mode** (`tasksViewer.createWithAI`):
   - User provides task name and description
   - AI generates task content with structure
   - Can specify target folder location

2. **From Feature Mode** (`tasksViewer.createFromFeature`):
   - Uses feature folder context (related.yaml, existing tasks, source files)
   - Two depth options:
     - **Simple**: Single-pass AI generation
     - **Deep**: Multi-phase generation using go-deep skill (if available)
   - User provides focus/description for what aspect to work on

**AI Task Dialog (`ai-task-dialog.ts`):**

Webview-based dialog service for unified task creation interface.

```typescript
import { AITaskDialogService } from '../tasks-viewer/ai-task-dialog';

const dialogService = new AITaskDialogService(taskManager, extensionUri, context);

// Show dialog with options
const result = await dialogService.showDialog({
    preselectedFolder: 'feature-auth',
    initialMode: 'create' // or 'from-feature'
});

if (!result.cancelled && result.options) {
    // Execute creation with result.options
}
```

### Discovery Commands (`discovery-commands.ts`)

AI Discovery integration for feature folders.

```typescript
import { registerTasksDiscoveryCommands } from '../tasks-viewer/discovery-commands';

// Register discovery commands
const disposables = registerTasksDiscoveryCommands(
    context,
    taskManager,
    treeDataProvider,
    discoveryEngine,
    aiProcessManager,
    configManager
);

// Commands registered:
// - tasksViewer.discoverRelated: Discover related items for a feature folder
// - tasksViewer.rediscoverRelated: Re-discover with merge/replace options
// - tasksViewer.clearRelated: Clear related items from a folder
```

**Discovery Flow:**
1. User selects a feature folder
2. Discovery engine analyzes folder context (tasks, related.yaml, source files)
3. AI discovers related source files, tests, docs, configs, and commits
4. Results shown in Discovery Preview Panel
5. User can add items to feature folder's `related.yaml`
6. Related items appear in tree view under feature folder

### Related Items Loader (`related-items-loader.ts`)

Manages `related.yaml` files alongside feature folders.

```typescript
import {
    loadRelatedItems,
    saveRelatedItems,
    deleteRelatedItems,
    mergeRelatedItems,
    categorizeItem
} from '../tasks-viewer/related-items-loader';

// Load related items from a feature folder
const config = await loadRelatedItems(folderPath);

// Save related items
await saveRelatedItems(folderPath, {
    description: 'Feature description',
    items: [
        {
            name: 'auth.ts',
            path: 'src/auth/auth.ts',
            type: 'file',
            category: 'source',
            relevance: 95,
            reason: 'Core authentication logic'
        }
    ]
});

// Merge new items with existing (deduplicates)
const merged = mergeRelatedItems(existingConfig, newItems);

// Categorize an item automatically
const category = categorizeItem(filePath);
// Returns: 'source' | 'test' | 'doc' | 'config' | 'commit'
```

**Related Items Categories:**
- `source`: Source code files
- `test`: Test files
- `doc`: Documentation files
- `config`: Configuration files
- `commit`: Git commits

### Related Items Tree Items (`related-items-tree-items.ts`)

Tree items for displaying related items in the tree view.

```typescript
import {
    RelatedItemsSectionItem,
    RelatedCategoryItem,
    RelatedFileItem,
    RelatedCommitItem
} from '../tasks-viewer/related-items-tree-items';

// Section item (collapsible "Related Items (N)" header)
const sectionItem = new RelatedItemsSectionItem(folderPath, config);

// Category item (e.g., "Source (5)")
const categoryItem = new RelatedCategoryItem('source', items, folderPath);

// File item (individual related file)
const fileItem = new RelatedFileItem(item, folderPath, workspaceRoot);

// Commit item (individual related commit)
const commitItem = new RelatedCommitItem(item, folderPath, repositoryRoot);
```

## Task Status

Tasks support a frontmatter-based status system for workflow management.

### Status Types

```typescript
type TaskStatus = 'pending' | 'in-progress' | 'done' | 'future';
```

- **`pending`**: Task is ready to be worked on (default for new tasks)
- **`in-progress`**: Task is currently being worked on
- **`done`**: Task is completed
- **`future`**: Task is captured but not ready to work on (backlog/someday)

### Status Parsing

Status is parsed from YAML frontmatter in task markdown files:

```markdown
---
status: in-progress
created: 2026-02-08
type: feature
---

# Task Title

## Description
...
```

If no status is specified in frontmatter, tasks default to `pending`.

### Future Tasks

Tasks marked as `future` are hidden from the main view by default (controlled by `workspaceShortcuts.tasksViewer.showFuture` setting). This allows capturing ideas without cluttering the active task list.

### Status Commands

- `tasksViewer.markAsFuture` - Mark task as future
- `tasksViewer.markAsPending` - Mark task as pending
- `tasksViewer.markAsInProgress` - Mark task as in-progress
- `tasksViewer.markAsDone` - Mark task as done

## Review Status

Review status tracking provides MD5 hash-based change detection for task documents.

### Status States

```typescript
type ReviewStatus = 'reviewed' | 'unreviewed' | 'needs-re-review';
```

- **`reviewed`**: File has been reviewed and hasn't changed since review
- **`unreviewed`**: File has not been reviewed
- **`needs-re-review`**: File was reviewed but has been modified since (detected via MD5 hash comparison)

### MD5 Hash-Based Change Detection

The `ReviewStatusManager` computes MD5 hashes of file content when marking as reviewed. On subsequent status checks, it compares the current file hash with the stored hash:

- If hashes match → status is `reviewed`
- If hashes differ → status is `needs-re-review`
- If no review record exists → status is `unreviewed`

### Workspace State Persistence

Review status is stored in VS Code's workspace state (Memento API), keyed by relative path from tasks root:

```typescript
interface ReviewStatusStore {
    [relativePath: string]: ReviewStatusRecord;
}

interface ReviewStatusRecord {
    status: 'reviewed' | 'unreviewed';
    reviewedAt: string;           // ISO timestamp
    fileHashAtReview: string;     // MD5 hash at time of review
    reviewedBy?: string;          // Optional user identifier
}
```

Status persists across extension restarts and is isolated per workspace.

### Individual and Folder-Level Marking

- **Individual**: Mark a single task document as reviewed/unreviewed
- **Folder-level**: Mark all documents in a feature folder as reviewed/unreviewed
- **Group-level**: Mark all documents in a document group as reviewed/unreviewed

### Review Status Commands

- `tasksViewer.markAsReviewed` - Mark task/document as reviewed
- `tasksViewer.markAsUnreviewed` - Mark task/document as unreviewed
- `tasksViewer.markGroupAsReviewed` - Mark all documents in group as reviewed
- `tasksViewer.markGroupAsUnreviewed` - Mark all documents in group as unreviewed
- `tasksViewer.markFolderAsReviewed` - Mark all documents in folder as reviewed

## AI Task Creation

AI-powered task creation provides two modes for generating task content.

### Create Mode

Generate a task from a description:

1. User opens dialog (`tasksViewer.createWithAI`)
2. Provides:
   - Task name (optional, AI can generate)
   - Description (what the task should accomplish)
   - Target folder location
   - AI model selection
3. AI generates structured task content:
   - Description section
   - Acceptance criteria
   - Subtasks
   - Notes

### From Feature Mode

Bootstrap a task from feature folder context:

1. User selects a feature folder and opens dialog (`tasksViewer.createFromFeature`)
2. System gathers feature context:
   - Description from `related.yaml` or folder name
   - Existing task documents in folder
   - Related source files
   - Related config files
   - Related commits (if available)
3. User provides:
   - Task focus/description (what specific aspect to work on)
   - Generation depth:
     - **Simple**: Single-pass AI generation
     - **Deep**: Multi-phase generation using go-deep skill (if available)
   - AI model selection
4. AI generates task content informed by feature context

### Deep Mode Support

When "Deep" mode is selected and the `go-deep` skill is available, the system:

1. Performs structural scan of the feature area
2. Identifies key files and relationships
3. Generates comprehensive task content with:
   - Detailed context understanding
   - Cross-file dependencies
   - Implementation considerations

### Webview Dialog

The `AITaskDialogService` provides a unified webview-based dialog for both modes:

- Mode selection (Create vs From Feature)
- Folder selection (with folder tree)
- Options specific to each mode
- Model selection
- Validation and error handling

## Related Items

Related items provide discovery integration for feature folders, linking tasks to relevant source files, tests, documentation, configs, and commits.

### Discovery Integration

Feature folders can have a `related.yaml` file that stores discovered related items:

```yaml
description: "User authentication feature"
items:
  - name: "auth.ts"
    path: "src/auth/auth.ts"
    type: "file"
    category: "source"
    relevance: 95
    reason: "Core authentication logic"
  - name: "auth.test.ts"
    path: "src/auth/auth.test.ts"
    type: "file"
    category: "test"
    relevance: 90
    reason: "Authentication tests"
  - name: "abc123"
    type: "commit"
    category: "commit"
    hash: "abc123def456..."
    relevance: 85
    reason: "Initial auth implementation"
lastUpdated: "2026-02-08T10:30:00Z"
```

### Categories

Related items are categorized automatically:

- **`source`**: Source code files (`.ts`, `.js`, `.py`, etc.)
- **`test`**: Test files (`.test.ts`, `.spec.ts`, etc.)
- **`doc`**: Documentation files (`.md`, `.txt`, etc.)
- **`config`**: Configuration files (`.json`, `.yaml`, `.toml`, etc.)
- **`commit`**: Git commits related to the feature

### Merge/Replace Options

When re-discovering related items:

- **Merge**: Add new items, keep existing (deduplicates by path/hash)
- **Replace**: Overwrite `related.yaml` with new results

### Discovery Commands

- `tasksViewer.discoverRelated` - Discover related items for a feature folder
- `tasksViewer.rediscoverRelated` - Re-discover with merge/replace options
- `tasksViewer.clearRelated` - Clear related items from a folder

### Tree Display

Related items appear in the tree view under feature folders:

```
📁 feature-auth
  ├── 📄 auth.plan.md
  ├── 📄 auth.spec.md
  └── 🔗 Related Items (5)
      ├── 📁 Source (2)
      │   ├── 📄 auth.ts
      │   └── 📄 auth-utils.ts
      ├── 🧪 Tests (1)
      │   └── 📄 auth.test.ts
      └── 📝 Documentation (1)
          └── 📄 auth.md
```

## Task Format

Tasks are parsed from markdown checkbox syntax with optional YAML frontmatter:

```markdown
---
status: in-progress
created: 2026-02-08
type: feature
ai_generated: true
---

# Task Title

## Description
Brief description of what needs to be done.

## Acceptance Criteria
- [ ] Criterion 1
- [ ] Criterion 2

## Subtasks
- [ ] Subtask 1
- [ ] Subtask 2

## Notes
Additional notes and context.
```

## Usage Examples

### Example 1: Setting Up Tasks View

```typescript
import { TaskManager, TasksTreeDataProvider, TasksDragDropController, ReviewStatusManager } from '../tasks-viewer';

function setupTasksView(context: vscode.ExtensionContext) {
    const taskManager = new TaskManager();
    const treeProvider = new TasksTreeDataProvider(taskManager);
    const reviewManager = new ReviewStatusManager(tasksFolder);
    
    // Initialize review status manager
    await reviewManager.initialize(context);
    
    // Connect review manager to tree provider
    treeProvider.setReviewStatusManager(reviewManager);
    
    const treeView = vscode.window.createTreeView('workspaceShortcuts.tasks', {
        treeDataProvider: treeProvider,
        dragAndDropController: new TasksDragDropController(treeProvider),
        showCollapseAll: true
    });
    
    // Watch workspace for task files (recursive)
    if (vscode.workspace.workspaceFolders) {
        taskManager.watchTasksFolder(() => {
            treeProvider.refresh();
        });
    }
    
    // Register AI and discovery commands
    const aiCommands = registerTasksAICommands(context, taskManager, treeProvider, aiProcessManager);
    const discoveryCommands = registerTasksDiscoveryCommands(
        context,
        taskManager,
        treeProvider,
        discoveryEngine,
        aiProcessManager,
        configManager
    );
    
    context.subscriptions.push(
        treeView,
        ...aiCommands,
        ...discoveryCommands,
        reviewManager
    );
    
    return { taskManager, treeProvider, reviewManager };
}
```

### Example 2: Creating a Task with AI

```typescript
import { AITaskDialogService } from '../tasks-viewer/ai-task-dialog';

async function createAITask(
    taskManager: TaskManager,
    treeProvider: TasksTreeDataProvider,
    dialogService: AITaskDialogService
) {
    const result = await dialogService.showDialog({
        preselectedFolder: 'feature-auth',
        initialMode: 'create'
    });
    
    if (result.cancelled || !result.options) {
        return;
    }
    
    // Execute creation with options
    await executeAITaskCreation(
        taskManager,
        treeProvider,
        dialogService,
        result.options,
        aiProcessManager
    );
}
```

### Example 3: Discovering Related Items

```typescript
import { discoverRelatedItems } from '../tasks-viewer/discovery-commands';

async function discoverForFeature(
    folderItem: TaskFolderItem,
    discoveryEngine: DiscoveryEngine
) {
    await discoverRelatedItems(
        context,
        taskManager,
        treeDataProvider,
        discoveryEngine,
        aiProcessManager,
        configManager,
        folderItem
    );
    
    // Discovery results appear in Discovery Preview Panel
    // User can add items to feature folder's related.yaml
    // Related items then appear in tree view
}
```

### Example 4: Managing Review Status

```typescript
import { ReviewStatusManager } from '../tasks-viewer/review-status-manager';

async function reviewWorkflow(
    reviewManager: ReviewStatusManager,
    filePath: string
) {
    // Check current status
    const status = reviewManager.getStatus(filePath);
    console.log('Current status:', status); // 'unreviewed' | 'reviewed' | 'needs-re-review'
    
    // Mark as reviewed
    await reviewManager.markAsReviewed(filePath);
    
    // Later, if file is modified, status automatically becomes 'needs-re-review'
    // (detected via MD5 hash comparison)
    
    // Mark folder as reviewed (all documents)
    await reviewManager.markFolderAsReviewed(folderPath);
}
```

### Example 5: Filtering Tasks

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
    /** Filename without .md extension */
    name: string;
    /** Absolute path to the .md file */
    filePath: string;
    /** Last modified time for sorting */
    modifiedTime: Date;
    /** Whether task is in archive folder */
    isArchived: boolean;
    /** Relative path from tasks root folder */
    relativePath?: string;
    /** Task workflow status parsed from frontmatter (defaults to 'pending') */
    status?: TaskStatus;
}
```

### TaskStatus

```typescript
type TaskStatus = 'pending' | 'in-progress' | 'done' | 'future';
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

### TaskFolder

```typescript
interface TaskFolder {
    /** Folder name */
    name: string;
    /** Absolute path to folder */
    folderPath: string;
    /** Relative path from tasks root */
    relativePath?: string;
    /** Child folders (nested structure) */
    children: TaskFolder[];
    /** Document groups in this folder */
    documentGroups: TaskDocumentGroup[];
    /** Single documents (not grouped) */
    singleDocuments: TaskDocument[];
    /** Related items configuration (if feature folder) */
    relatedItems?: RelatedItemsConfig;
}
```

### ReviewStatus

```typescript
type ReviewStatus = 'reviewed' | 'unreviewed' | 'needs-re-review';
```

### ReviewStatusRecord

```typescript
interface ReviewStatusRecord {
    /** Current review status */
    status: 'reviewed' | 'unreviewed';
    /** ISO timestamp when marked as reviewed */
    reviewedAt: string;
    /** MD5 hash of file content when reviewed (for change detection) */
    fileHashAtReview: string;
    /** Optional user identifier who performed the review */
    reviewedBy?: string;
}
```

### ReviewStatusStore

```typescript
interface ReviewStatusStore {
    [relativePath: string]: ReviewStatusRecord;
}
```

### RelatedItem

```typescript
interface RelatedItem {
    /** Display name */
    name: string;
    /** File path relative to workspace (for file type) */
    path?: string;
    /** Item type */
    type: 'file' | 'commit';
    /** Category for grouping */
    category: 'source' | 'test' | 'doc' | 'config' | 'commit';
    /** Relevance score (0-100) */
    relevance: number;
    /** Human-readable reason for relevance */
    reason: string;
    /** Commit hash (for commit type) */
    hash?: string;
}
```

### RelatedItemsConfig

```typescript
interface RelatedItemsConfig {
    /** Feature description used for discovery */
    description: string;
    /** Related items */
    items: RelatedItem[];
    /** Timestamp of last update (ISO string) */
    lastUpdated?: string;
}
```

### AITaskCreationOptions

```typescript
interface AITaskCreationOptions {
    /** Creation mode */
    mode: 'create' | 'from-feature';
    /** Options for 'create' mode */
    createOptions?: AITaskCreateOptions;
    /** Options for 'from-feature' mode */
    fromFeatureOptions?: AITaskFromFeatureOptions;
}
```

## Commands

### Task Management Commands

| Command | Description |
|---------|-------------|
| `tasksViewer.create` | Create a new task file |
| `tasksViewer.createFeature` | Create a new feature folder |
| `tasksViewer.createSubfolder` | Create a subfolder in a feature folder |
| `tasksViewer.rename` | Rename a task file |
| `tasksViewer.renameFolder` | Rename a feature folder |
| `tasksViewer.renameDocumentGroup` | Rename a document group |
| `tasksViewer.renameDocument` | Rename a task document |
| `tasksViewer.delete` | Delete a task file |
| `tasksViewer.deleteFolder` | Delete a feature folder |
| `tasksViewer.archive` | Archive a task |
| `tasksViewer.unarchive` | Unarchive a task |
| `tasksViewer.archiveDocument` | Archive a task document |
| `tasksViewer.unarchiveDocument` | Unarchive a task document |
| `tasksViewer.archiveDocumentGroup` | Archive a document group |
| `tasksViewer.unarchiveDocumentGroup` | Unarchive a document group |
| `tasksViewer.refresh` | Refresh task list |
| `tasksViewer.openFolder` | Open tasks folder in explorer |

### Task Status Commands

| Command | Description |
|---------|-------------|
| `tasksViewer.markAsFuture` | Mark task as future (backlog) |
| `tasksViewer.markAsPending` | Mark task as pending |
| `tasksViewer.markAsInProgress` | Mark task as in-progress |
| `tasksViewer.markAsDone` | Mark task as done |

### Review Status Commands

| Command | Description |
|---------|-------------|
| `tasksViewer.markAsReviewed` | Mark task/document as reviewed |
| `tasksViewer.markAsUnreviewed` | Mark task/document as unreviewed |
| `tasksViewer.markGroupAsReviewed` | Mark all documents in group as reviewed |
| `tasksViewer.markGroupAsUnreviewed` | Mark all documents in group as unreviewed |
| `tasksViewer.markFolderAsReviewed` | Mark all documents in folder as reviewed |

### Feature Folder Commands

| Command | Description |
|---------|-------------|
| `tasksViewer.createFeature` | Create a new feature folder |
| `tasksViewer.createSubfolder` | Create a subfolder in a feature folder |

### AI Task Creation Commands

| Command | Description |
|---------|-------------|
| `tasksViewer.createWithAI` | Create task with AI (from description) |
| `tasksViewer.createFromFeature` | Create task from feature context |

### Discovery Commands

| Command | Description |
|---------|-------------|
| `tasksViewer.discoverRelated` | Discover related items for a feature folder |
| `tasksViewer.rediscoverRelated` | Re-discover related items (merge/replace) |
| `tasksViewer.clearRelated` | Clear related items from a feature folder |

### Path Copy Commands

| Command | Description | Multi-Selection |
|---------|-------------|----------------|
| `tasksViewer.copyRelativePath` | Copy relative path(s) to clipboard | Yes |
| `tasksViewer.copyFullPath` | Copy absolute path(s) to clipboard | Yes |

Path copy commands support multi-selection: when multiple items are selected in the tree view, all paths are copied (one per line).

## Tree View Structure

### Standard View (flat list of tasks)

```
Tasks
├── 📄 TODO.md
├── 📄 BUGS.md
└── 📄 docs/TASKS.md
```

### Hierarchical Folders View

```
Tasks
├── 📁 feature-auth
│   ├── 📄 auth.plan.md
│   ├── 📄 auth.spec.md
│   └── 📁 subfolder
│       └── 📄 subtask.md
├── 📁 feature-payment
│   └── 📄 payment.md
└── 📁 archive
    └── 📁 old-feature
        └── 📄 old-task.md
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

### Feature Folders with Related Items

```
Tasks
├── 📁 feature-auth
│   ├── 📄 auth.plan.md
│   ├── 📄 auth.spec.md
│   └── 🔗 Related Items (5)
│       ├── 📁 Source (2)
│       │   ├── 📄 auth.ts
│       │   └── 📄 auth-utils.ts
│       ├── 🧪 Tests (1)
│       │   └── 📄 auth.test.ts
│       ├── 📝 Documentation (1)
│       │   └── 📄 auth.md
│       └── ⚙️ Config (1)
│           └── 📄 auth.config.json
```

### Key Components for Document Grouping

- `TaskDocumentGroupItem` - Tree item for grouped documents
- `TaskDocumentItem` - Tree item for individual documents within a group
- `TaskDocument` - Interface representing a parsed document
- `TaskDocumentGroup` - Interface for a group of related documents
- `TaskFolderItem` - Tree item for feature folders

## Best Practices

1. **Watch efficiently**: Only watch relevant markdown files with recursive patterns.

2. **Cache tasks**: Parse files once and update incrementally.

3. **Handle large files**: Limit parsing for very large files.

4. **Preserve formatting**: Maintain original formatting when editing frontmatter.

5. **Support nesting**: Handle nested folders with proper path tracking.

6. **Sync with file**: Keep tree in sync with file changes via file watchers.

7. **Review status**: Use MD5 hash tracking for accurate change detection.

8. **Related items**: Keep `related.yaml` files updated via discovery commands.

9. **AI generation**: Use appropriate mode (Create vs From Feature) based on context.

10. **Status management**: Use status commands to track task workflow.

## Events

```typescript
// Task changes
taskManager.onDidChangeTasks((e) => {
    console.log('Changed:', e.documentUri);
    console.log('Added:', e.added);
    console.log('Removed:', e.removed);
    console.log('Updated:', e.updated);
});

// Review status changes
reviewStatusManager.onDidChangeStatus((changedPaths) => {
    console.log('Review status changed for:', changedPaths);
    treeProvider.refresh();
});

// Selection changes
treeView.onDidChangeSelection((e) => {
    const item = e.selection[0];
    if (item instanceof TaskItem) {
        console.log('Selected task:', item.label);
    } else if (item instanceof TaskFolderItem) {
        console.log('Selected folder:', item.folder.name);
    }
});
```

## Settings

| Setting | Description | Default |
|---------|-------------|---------|
| `workspaceShortcuts.tasksViewer.enabled` | Enable/disable tasks viewer | `true` |
| `workspaceShortcuts.tasksViewer.folderPath` | Path to tasks folder | `.vscode/tasks` |
| `workspaceShortcuts.tasksViewer.showArchived` | Show/hide archived tasks | `false` |
| `workspaceShortcuts.tasksViewer.showFuture` | Show/hide future tasks | `false` |
| `workspaceShortcuts.tasksViewer.sortBy` | Sort by name or modified date | `name` |
| `workspaceShortcuts.tasksViewer.groupRelatedDocuments` | Enable document grouping | `true` |

## See Also

- `src/shortcuts/markdown-comments/AGENTS.md` - Markdown parsing utilities
- `src/shortcuts/discovery/AGENTS.md` - AI Discovery engine
- `src/shortcuts/ai-service/AGENTS.md` - AI process management
- VSCode TreeView API documentation
