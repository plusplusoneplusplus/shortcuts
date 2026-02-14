# UX Design: Create AI-Generated Task

## Overview

Design the user experience for creating a new AI-generated task via popup dialog in the Tasks Panel. Users can create tasks at root level or under a specific feature folder.

---

## Current State

### Existing Task Creation Flow
1. User clicks **"+"** button in Tasks Panel toolbar
2. Enters task name in Quick Pick input
3. Task markdown file created in tasks folder

### Limitations
- No AI assistance for task generation
- Manual content creation required
- No structured templates or intelligent scaffolding

---

## Proposed UX Design

### Goal
Allow users to:
1. **Create AI-generated tasks** with intelligent content scaffolding
2. **Specify target location**: Root level or under a feature folder
3. **Choose task type/template**: Bug, feature, refactor, research, etc.
4. **Provide context**: Brief description for AI to expand

---

## Modal Dialog with Options

After clicking "Create AI Task" or context menu on a feature folder:

```
┌─────────────────────────────────────────────────────────┐
│  🤖 Create AI-Generated Task                            │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Task Name                                              │
│  ┌───────────────────────────────────────────────────┐  │
│  │ implement-user-authentication                     │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  Location                                               │
│  ┌─────────────────────────────────────────────────┐    │
│  │ 📁 feature1/backlog1                        ▾ │    │
│  └─────────────────────────────────────────────────┘    │
│  └ 📁 (Root)                                            │
│  └ 📁 feature1                                          │
│  └ 📁 feature1/backlog1                                 │
│  └ 📁 feature2                                          │
│                                                         │
│  Brief Description                                      │
│  ┌───────────────────────────────────────────────────┐  │
│  │ Add JWT-based authentication with refresh        │  │
│  │ tokens for the REST API endpoints...             │  │
│  │                                                   │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  ─────────────────────────────────────────────────────  │
│                                                         │
│  AI Model                                               │
│  ┌─────────────────────────────────────────────────┐    │
│  │ Claude Sonnet 4 (Recommended)              ▾ │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │

│                                                         │
│              [Cancel]            [Create Task]          │
└─────────────────────────────────────────────────────────┘
```

### Pros
- All options in one place
- Clear visual hierarchy
- User sees all choices before executing

### Cons
- More complex than current flow
- Requires webview dialog implementation

**Note:** AI model selection follows the same pattern as AI Action prompts, using the existing model configuration.

---

## Context Menu Integration

Right-click on folder or empty space in Tasks Panel:

```
Tasks Panel
├── feature1/
│   └── [Right-click here]
│       ├── 🤖 Create AI Task Here
│       │   └── (Opens modal dialog with folder pre-selected)
│       ├── 📄 Create Task (Manual)
│       └── 📁 Create Subfolder
└── feature2/
```

### Pros
- Contextual and intuitive
- Location pre-selected from click target
- Combines well with modal dialog

### Cons
- Requires right-click discovery
- Less visible than toolbar button

---

## ✅ Selected Approach: Modal + Context Menu

**Decision**: Implement Modal Dialog accessible from:
1. Toolbar button: "Create AI Task" (creates at root or asks for location)
2. Context menu on folder: "Create AI Task Here" (pre-selects folder)

---

## Implementation Plan

### Phase 1: Type Definitions & Configuration

#### 1.1 Files to Modify
| File | Changes |
|------|---------|
| `src/shortcuts/tasks/types.ts` | Add `AITaskCreationOptions`, `TaskType` |
| `src/shortcuts/tasks/task-manager.ts` | Add `createAITask()` method |
| `package.json` | Add commands |

#### 1.2 New Types
```typescript
interface AITaskCreationOptions {
    /** Task name (used as filename) */
    name: string;
    /** Target folder path relative to tasks root (empty = root) */
    location: string;
    /** Brief description for AI to expand */
    description: string;
    /** AI model to use (follows AI Action prompt pattern) */
    model: string;
}
```

**Note:** Commands already exist in the current implementation (`tasksViewer.createWithAI`, `tasksViewer.createFromFeature`).

### Phase 2: Dialog Component

#### 2.1 Create Dialog Service
File: `src/shortcuts/tasks/ai-task-dialog.ts`

```typescript
import * as vscode from 'vscode';

export interface AITaskDialogResult {
    options: AITaskCreationOptions;
    cancelled: boolean;
}

export class AITaskDialogService {
    private context: vscode.ExtensionContext;
    
    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }
    
    /**
     * Show the AI Task creation dialog
     * @param preselectedFolder Optional folder path to pre-select
     */
    async showDialog(preselectedFolder?: string): Promise<AITaskDialogResult> {
        // Implementation using Quick Picks (Option B) or Webview (Option A)
    }
    
    /**
     * Get available folders for task creation
     */
    async getAvailableFolders(): Promise<string[]> {
        // Scan tasks directory for subfolders
    }
}
```

#### 2.2 Quick Pick Implementation (Initial)
```typescript
async showDialogQuickPick(preselectedFolder?: string): Promise<AITaskDialogResult> {
    // Step 1: Location (skip if preselectedFolder provided)
    const location = preselectedFolder ?? await this.selectLocation();
    if (location === undefined) return { cancelled: true, options: null };
    
    // Step 2: Task Name
    const name = await vscode.window.showInputBox({
        prompt: 'Enter task name (will be used as filename)',
        placeHolder: 'implement-user-authentication',
        validateInput: this.validateTaskName
    });
    if (!name) return { cancelled: true, options: null };
    
    // Step 3: Description
    const description = await vscode.window.showInputBox({
        prompt: 'Describe the task briefly (AI will expand this)',
        placeHolder: 'Add JWT-based authentication with refresh tokens'
    });
    if (!description) return { cancelled: true, options: null };
    
    // Step 4: Return options (model follows AI Action prompt pattern)
    return {
        cancelled: false,
        options: {
            name,
            location,
            description,
            model: this.getModelFromAIActionConfig()  // Same model as AI Action prompts
        }
    };
}
```

### Phase 3: AI Task Generation

**Note:** This phase follows the existing AI task creation implementation in `ai-task-commands.ts`. The key differences from the current implementation are **the prompt content** and **model selection**.

#### 3.1 Current Implementation Reference

The existing implementation uses:
- **`createAIInvoker()`** factory from `ai-invoker-factory.ts` for unified AI invocation
- **Automatic fallback chain**: SDK → CLI → clipboard
- **Session pooling** for parallel requests
- **Permission approval** for file writes

#### 3.2 Prompt Building

Reuse the existing prompt building pattern from `buildCreateTaskPrompt()`:

```typescript
// In src/shortcuts/tasks/ai-task-commands.ts (existing pattern)

function buildCreateTaskPrompt(taskName: string, description: string): string {
    return `Create a task document for: ${taskName}
    
Description: ${description}

Generate a comprehensive markdown task document.
Save the file to the tasks folder.`;
}
```

**For this feature**, the prompt will be customized based on the modal dialog inputs (name, location, description).

#### 3.3 AI Invocation

Use the existing `createAIInvoker()` pattern:

```typescript
// Follow existing pattern from ai-task-commands.ts

const invoker = createAIInvoker({
    prompt: buildCreateTaskPrompt(options.name, options.description),
    model: options.model,  // Model selected from dialog
    workingDirectory: tasksFolder,
    onPermissionRequest: approveAllPermissions
});

const result = await invoker.invoke();
```

#### 3.4 File Creation Flow

Follows the existing implementation:
1. AI generates task content with frontmatter
2. Parse created file path from AI response
3. Refresh tree view
4. Open file in Review Editor

```typescript
// Existing pattern from ai-task-commands.ts
if (result.success) {
    const filePath = parseCreatedFilePath(result.response);
    if (filePath) {
        taskManager.refresh();
        await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(filePath));
    }
}
```

#### 3.5 Fallback Handling

Follows the existing fallback pattern:
- If AI backend is "clipboard" mode → prompt user to create empty task
- If AI fails → offer to create empty task or retry

### Phase 5: Command Registration

#### 5.1 Register Commands
```typescript
// In src/shortcuts/commands.ts or src/shortcuts/tasks/task-commands.ts

export function registerTaskCommands(context: vscode.ExtensionContext) {
    const dialogService = new AITaskDialogService(context);
    const taskManager = getTaskManager();
    
    // Create AI Task (from toolbar)
    context.subscriptions.push(
        vscode.commands.registerCommand('shortcuts.tasks.createAITask', async () => {
            const result = await dialogService.showDialog();
            if (!result.cancelled) {
                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: 'Creating AI Task...',
                    cancellable: false
                }, async () => {
                    await taskManager.createAITask(result.options);
                });
            }
        })
    );
    
    // Create AI Task in Folder (from context menu)
    context.subscriptions.push(
        vscode.commands.registerCommand('shortcuts.tasks.createAITaskInFolder', 
            async (folderItem: TaskFolderItem) => {
                const result = await dialogService.showDialog(folderItem.relativePath);
                if (!result.cancelled) {
                    await vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: 'Creating AI Task...',
                        cancellable: false
                    }, async () => {
                        await taskManager.createAITask(result.options);
                    });
                }
            }
        )
    );
}
```

#### 5.2 Add to package.json Menus
```json
{
    "menus": {
        "view/title": [
            {
                "command": "shortcuts.tasks.createAITask",
                "when": "view == shortcutsTasksView",
                "group": "navigation"
            }
        ],
        "view/item/context": [
            {
                "command": "shortcuts.tasks.createAITaskInFolder",
                "when": "view == shortcutsTasksView && viewItem == taskFolder",
                "group": "1_create@1"
            }
        ]
    }
}
```

### Phase 6: Progress & Error Handling

#### 6.1 Progress Notification
```typescript
async createAITaskWithProgress(options: AITaskCreationOptions): Promise<void> {
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Creating AI Task',
        cancellable: true
    }, async (progress, token) => {
        progress.report({ message: 'Generating task content...' });
        
        if (token.isCancellationRequested) return;
        
        try {
            const task = await this.taskManager.createAITask(options);
            
            vscode.window.showInformationMessage(
                `✅ Created task: ${task.name}`,
                'Open Task'
            ).then(action => {
                if (action === 'Open Task') {
                    vscode.commands.executeCommand('vscode.open', vscode.Uri.file(task.path));
                }
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create AI task: ${error}`);
        }
    });
}
```

---

## User Flow Summary

```
┌─────────────────────────┐
│  Click "Create AI Task" │
│  or Right-click folder  │
└───────────┬─────────────┘
            ▼
┌─────────────────────────┐
│  Show Creation Dialog   │
│  - Location (folder)    │
│  - Task type            │
│  - Name                 │
│  - Description          │
└───────────┬─────────────┘
            ▼
      ┌─────┴─────┐
      │ Cancelled?│
      └─────┬─────┘
        No  │  Yes
      ┌─────┴─────┐
      ▼           ▼
┌───────────┐  ┌────────┐
│ Generate  │  │ Done   │
│ Task via  │  └────────┘
│ AI        │
└─────┬─────┘
      ▼
┌───────────────────────────┐
│ Create task file          │
└───────────┬───────────────┘
            ▼
┌───────────────────────────┐
│ Refresh tree view         │
│ Open created task         │
│ Show success notification │
└───────────────────────────┘
```

---

## Implementation Checklist

### Phase 1: Type Definitions & Configuration
- [x] Add `AITaskCreationOptions` interface to `types.ts`
- [x] Reuse existing commands (`tasksViewer.createWithAI`, `tasksViewer.createFromFeature`)

### Phase 2: Dialog Component
- [x] Create `ai-task-dialog.ts` with `AITaskDialogService` class
- [x] Implement Quick Pick dialog flow (initial implementation)
- [x] Add location selection with folder scanning
- [x] Add name input with validation
- [x] Add description input

### Phase 3: AI Task Generation
- [x] Customize prompts for modal dialog inputs
- [x] Use existing `createAIInvoker()` pattern from `ai-task-commands.ts`
- [x] Follow existing file creation and fallback handling

### Phase 4: Task Manager Integration
- [x] Integrate dialog with existing task creation flow
- [x] Handle file creation in correct location
- [x] Ensure directory creation for nested paths
- [x] Trigger tree view refresh

### Phase 5: Command Registration
- [x] Update existing commands to use dialog when appropriate
- [x] Add toolbar button to Tasks view (if not already present)
- [x] Add context menu item for folders

### Phase 6: Progress & Error Handling
- [x] Reuse existing progress notification pattern
- [x] Reuse existing fallback handling (clipboard mode, retry)
- [x] Show success notification with "Open Task" action

### Phase 7: Testing
- [x] Unit tests for dialog service
- [x] Integration tests for full flow

---

## Future Enhancements

1. **Webview Dialog**: Upgrade from Quick Pick to rich webview dialog (Option A)
2. **Task Templates Library**: User-defined custom task templates
3. **Batch Task Creation**: Create multiple related tasks at once
4. **Task Refinement**: AI-assisted editing of existing tasks
5. **Integration with GitHub Issues**: Import/export tasks to/from GitHub
6. **Duplicate Detection**: Warn if similar task already exists
