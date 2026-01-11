# Design Document: Pipeline Panel for YAML-Based Pipeline Management

**Status**: Draft  
**Created**: 2026-01-10  
**Author**: AI Assistant  
**Version**: 1.1

## Overview

A new tree view panel that displays YAML-based pipeline files located in `.vscode/pipelines/` directory. The panel will show a list of available pipelines with metadata, and allow users to quickly open and view pipeline configurations.

## Goals

1. **Discovery**: Make YAML pipeline files easily discoverable in the workspace
2. **Quick Access**: Provide one-click opening of pipeline YAML files
3. **Context**: Show pipeline metadata (name, description, status) in the tree view
4. **Consistency**: Follow the existing extension's architecture and patterns

## Architecture

### Module Structure

Add UI components to the existing `yaml-pipeline` module:

```
src/shortcuts/yaml-pipeline/
├── AGENTS.md                   # Existing: Module documentation
├── csv-reader.ts               # Existing: CSV parsing utilities
├── executor.ts                 # Existing: Pipeline executor
├── template.ts                 # Existing: Template engine
├── types.ts                    # Existing: Core pipeline types
├── index.ts                    # Existing: Public exports
├── ui/                         # NEW: UI components for VSCode panel
│   ├── index.ts                # Public exports for UI
│   ├── pipeline-manager.ts     # Pipeline file management
│   ├── pipeline-item.ts        # TreeItem for individual pipelines
│   ├── tree-data-provider.ts   # Tree view data provider
│   ├── commands.ts             # Command handlers
│   └── types.ts                # UI-specific types
└── README.md                   # NEW: User-facing documentation
```

**Rationale**: Keep all pipeline-related code together in one module. The `ui/` subdirectory contains VSCode-specific UI components, while the root level contains the core pipeline execution logic.

### Component Details

#### 1. **PipelineManager** (`ui/pipeline-manager.ts`)

**Responsibilities:**
- Scan `.vscode/pipelines/` directory for YAML files
- Parse pipeline metadata (name, description) from YAML
- Watch for file system changes (add/remove/modify pipelines)
- Validate pipeline file structure

**Key Methods:**
```typescript
class PipelineManager {
  constructor(workspaceRoot: string)
  
  // Get all pipeline files
  async getPipelines(): Promise<PipelineInfo[]>
  
  // Get pipeline by file name
  async getPipeline(fileName: string): Promise<PipelineInfo | undefined>
  
  // Watch for file changes
  watchPipelinesFolder(callback: () => void): vscode.Disposable
  
  // Create pipelines folder if not exists
  ensurePipelinesFolderExists(): void
  
  // Validate pipeline YAML
  async validatePipeline(filePath: string): Promise<ValidationResult>
}
```

**PipelineInfo Type:**
```typescript
interface PipelineInfo {
  // File metadata
  fileName: string;          // e.g., "code-review.yaml"
  filePath: string;          // Absolute path
  relativePath: string;      // Relative to workspace
  
  // Pipeline config metadata
  name: string;              // From YAML: name field
  description?: string;      // From YAML: description field
  
  // File stats
  lastModified: Date;
  size: number;
  
  // Validation
  isValid: boolean;
  validationErrors?: string[];
}
```

#### 2. **PipelineItem** (`ui/pipeline-item.ts`)

**Responsibilities:**
- Represent a single pipeline as a TreeItem
- Provide appropriate icons, labels, tooltips
- Handle click behavior (open YAML file)

```typescript
class PipelineItem extends vscode.TreeItem {
  constructor(public readonly pipeline: PipelineInfo)
  
  // Properties:
  // - label: Display name from pipeline config
  // - description: File name (e.g., "code-review.yaml")
  // - tooltip: Rich tooltip with pipeline details
  // - iconPath: Appropriate icon
  // - contextValue: 'pipeline' for context menu
  // - command: Open file on click
}
```

**Visual Design:**
```
📋 Code Review Pipeline             [code-review.yaml]
   Review code against standards
   Last modified: 2 hours ago

📋 Data Processing Pipeline         [data-pipeline.yaml]
   Process CSV data with AI
   Last modified: Yesterday

⚠️ Invalid Pipeline                 [broken.yaml]
   Validation errors: Missing 'input' field
```

#### 3. **PipelinesTreeDataProvider** (`ui/tree-data-provider.ts`)

**Responsibilities:**
- Implement `vscode.TreeDataProvider<PipelineItem>`
- Fetch pipelines from PipelineManager
- Sort pipelines (by name or last modified)
- Handle refresh on file changes
- Provide search/filter capability (optional for v1)

```typescript
class PipelinesTreeDataProvider 
  implements vscode.TreeDataProvider<PipelineItem> {
  
  constructor(private pipelineManager: PipelineManager)
  
  // Standard TreeDataProvider methods
  getTreeItem(element: PipelineItem): vscode.TreeItem
  async getChildren(element?: PipelineItem): Promise<PipelineItem[]>
  
  // Extension methods
  refresh(): void
  setFilter(text: string): void
  clearFilter(): void
}
```

#### 4. **Commands Handler** (`ui/commands.ts`)

**Responsibilities:**
- Register and handle all pipeline-related commands
- Coordinate between UI components and core pipeline logic
- Handle user interactions (create, delete, execute, etc.)

```typescript
class PipelineCommands {
  constructor(
    private pipelineManager: PipelineManager,
    private treeDataProvider: PipelinesTreeDataProvider,
    private context: vscode.ExtensionContext
  )
  
  registerCommands(context: vscode.ExtensionContext): vscode.Disposable[]
  
  // Command implementations:
  // - createPipeline()
  // - openPipeline()
  // - executePipeline()
  // - renamePipeline()
  // - deletePipeline()
  // - validatePipeline()
  // - openPipelinesFolder()
  // - refreshPipelines()
}
```

#### 5. **Integration Points**

**Extension Activation** (`src/extension.ts`):

```typescript
// Import from yaml-pipeline module
import { 
  PipelineManager, 
  PipelinesTreeDataProvider,
  PipelineCommands 
} from './shortcuts/yaml-pipeline/ui';

// Around line 186 (after tasks viewer initialization)
const pipelinesViewerEnabled = vscode.workspace.getConfiguration('workspaceShortcuts.pipelinesViewer').get<boolean>('enabled', true);
let pipelinesTreeView: vscode.TreeView<vscode.TreeItem> | undefined;
let pipelineManager: PipelineManager | undefined;
let pipelinesTreeDataProvider: PipelinesTreeDataProvider | undefined;
let pipelinesCommands: PipelineCommands | undefined;
let pipelinesCommandDisposables: vscode.Disposable[] = [];

if (pipelinesViewerEnabled && workspaceFolder) {
    pipelineManager = new PipelineManager(workspaceRoot);
    pipelineManager.ensurePipelinesFolderExists();
    
    pipelinesTreeDataProvider = new PipelinesTreeDataProvider(pipelineManager);
    
    // Watch for file changes
    pipelineManager.watchPipelinesFolder(() => {
        pipelinesTreeDataProvider?.refresh();
    });
    
    pipelinesTreeView = vscode.window.createTreeView('pipelinesView', {
        treeDataProvider: pipelinesTreeDataProvider,
        showCollapseAll: false
    });
    
    // Update view description with count
    const updatePipelinesViewDescription = async () => {
        if (pipelineManager && pipelinesTreeView) {
            const pipelines = await pipelineManager.getPipelines();
            const count = pipelines.length;
            pipelinesTreeView.description = `${count} pipeline${count !== 1 ? 's' : ''}`;
        }
    };
    pipelinesTreeDataProvider.onDidChangeTreeData(updatePipelinesViewDescription);
    updatePipelinesViewDescription();
    
    // Register commands
    pipelinesCommands = new PipelineCommands(
        pipelineManager,
        pipelinesTreeDataProvider,
        context
    );
    pipelinesCommandDisposables = pipelinesCommands.registerCommands(context);
}
```

### Package.json Changes

#### 1. **View Container Registration**

Add to `contributes.views.shortcuts` (around line 68):

```json
{
  "id": "pipelinesView",
  "name": "Pipelines",
  "when": "config.workspaceShortcuts.pipelinesViewer.enabled"
}
```

#### 2. **Configuration Settings**

Add to `contributes.configuration.properties`:

```json
"workspaceShortcuts.pipelinesViewer.enabled": {
  "type": "boolean",
  "default": true,
  "description": "Enable the Pipelines Viewer panel"
},
"workspaceShortcuts.pipelinesViewer.folderPath": {
  "type": "string",
  "default": ".vscode/pipelines",
  "description": "Path to pipelines folder relative to workspace root"
},
"workspaceShortcuts.pipelinesViewer.sortBy": {
  "type": "string",
  "enum": ["name", "modifiedDate"],
  "enumDescriptions": [
    "Sort pipelines alphabetically by name",
    "Sort pipelines by last modified date (newest first)"
  ],
  "default": "name",
  "description": "How to sort pipelines in the Pipelines Viewer"
}
```

#### 3. **Commands**

Add to `contributes.commands`:

```json
{
  "command": "pipelinesViewer.create",
  "title": "Create Pipeline",
  "category": "Pipelines",
  "icon": "$(add)"
},
{
  "command": "pipelinesViewer.open",
  "title": "Open Pipeline",
  "category": "Pipelines",
  "icon": "$(go-to-file)"
},
{
  "command": "pipelinesViewer.execute",
  "title": "Execute Pipeline",
  "category": "Pipelines",
  "icon": "$(run)"
},
{
  "command": "pipelinesViewer.rename",
  "title": "Rename Pipeline",
  "category": "Pipelines",
  "icon": "$(edit)"
},
{
  "command": "pipelinesViewer.delete",
  "title": "Delete Pipeline",
  "category": "Pipelines",
  "icon": "$(trash)"
},
{
  "command": "pipelinesViewer.refresh",
  "title": "Refresh Pipelines",
  "category": "Pipelines",
  "icon": "$(refresh)"
},
{
  "command": "pipelinesViewer.openFolder",
  "title": "Open Pipelines Folder",
  "category": "Pipelines",
  "icon": "$(folder-opened)"
},
{
  "command": "pipelinesViewer.validate",
  "title": "Validate Pipeline",
  "category": "Pipelines",
  "icon": "$(check)"
}
```

#### 4. **Menus**

Add to `contributes.menus`:

```json
"view/title": [
  {
    "command": "pipelinesViewer.create",
    "when": "view == pipelinesView",
    "group": "navigation"
  },
  {
    "command": "pipelinesViewer.refresh",
    "when": "view == pipelinesView",
    "group": "navigation"
  },
  {
    "command": "pipelinesViewer.openFolder",
    "when": "view == pipelinesView",
    "group": "navigation"
  }
],
"view/item/context": [
  {
    "command": "pipelinesViewer.execute",
    "when": "view == pipelinesView && viewItem == pipeline",
    "group": "pipeline@1"
  },
  {
    "command": "pipelinesViewer.open",
    "when": "view == pipelinesView && viewItem == pipeline",
    "group": "pipeline@2"
  },
  {
    "command": "pipelinesViewer.validate",
    "when": "view == pipelinesView && viewItem == pipeline",
    "group": "pipeline@3"
  },
  {
    "command": "pipelinesViewer.rename",
    "when": "view == pipelinesView && viewItem == pipeline",
    "group": "pipeline@4"
  },
  {
    "command": "pipelinesViewer.delete",
    "when": "view == pipelinesView && viewItem == pipeline",
    "group": "pipeline@5"
  }
]
```

#### 5. **Views Welcome**

Add to `contributes.viewsWelcome`:

```json
{
  "view": "pipelinesView",
  "contents": "📋 **Pipelines**\n\n[Create First Pipeline](command:pipelinesViewer.create)\n\nManage YAML-based AI pipelines.\n\n**Features:**\n• Pipelines stored in `.vscode/pipelines/`\n• One-click execution\n• Validation and error checking\n• Template-based AI processing"
}
```

### Panel Ordering

The panel should appear in this order within the Shortcuts container (modify `package.json` order):

1. **Git** (existing)
2. **Pipelines** (new)
3. **Global Notes** (existing)
4. **Tasks** (existing)
5. **Groups** (existing)
6. **Markdown Comments** (existing)
7. **AI Processes** (existing)
8. **Debug Commands** (existing)

## User Experience

### Opening a Pipeline (v1 - Simple)

When a user clicks on a pipeline item:
1. The YAML file opens in the default text editor
2. User can view/edit the pipeline configuration
3. File changes are automatically detected and panel refreshes

### Future Enhancements (v2+)

1. **Execute Pipeline**: Right-click → "Execute Pipeline" → Shows progress in AI Processes panel
2. **Pipeline Preview**: Hover tooltip shows first few lines of pipeline config
3. **Validation Indicators**: Icons showing validation status (✓ valid, ⚠️ warning, ✗ invalid)
4. **Quick Actions**: "Duplicate Pipeline", "Create from Template"
5. **Execution History**: Track when pipelines were last run
6. **Pipeline Templates**: Built-in templates for common use cases

## Implementation Plan

### Phase 1: Basic Panel (v1)
1. Create `ui/` subdirectory in `yaml-pipeline` module
2. Implement `PipelineManager` (scan, parse, watch)
3. Implement `PipelineItem` (tree item representation)
4. Implement `PipelinesTreeDataProvider`
5. Implement `PipelineCommands` (command handlers)
6. Update `yaml-pipeline/index.ts` to export UI components
7. Register view in `extension.ts`
8. Add package.json configurations
9. Basic commands: create, open, delete, refresh

### Phase 2: Enhanced Features (v2)
1. Pipeline validation with error reporting
2. Execute pipeline command (integrate with existing executor)
3. Pipeline templates
4. Search/filter capability
5. Execution history tracking

### Phase 3: Advanced Features (v3)
1. Pipeline editor assistance (YAML autocomplete)
2. Visual pipeline builder
3. Pipeline debugging/dry-run mode
4. Pipeline sharing/export

## Testing Strategy

1. **Unit Tests**: 
   - PipelineManager: file scanning, parsing, validation
   - Tree data provider: sorting, filtering
   
2. **Integration Tests**:
   - File watcher functionality
   - Extension activation with pipelines panel
   - Command execution

3. **Manual Testing**:
   - Create/delete pipeline files manually
   - Edit pipelines and observe refresh
   - Test with various workspace configurations

## Open Questions

1. **Icon Choice**: What icon should represent pipelines? Options:
   - `$(symbol-method)` - workflow symbol
   - `$(play-circle)` - execution symbol
   - `$(list-tree)` - hierarchical symbol
   - `$(circuit-board)` - pipeline symbol

2. **Grouping**: Should pipelines be grouped by any criteria? (type, tags, execution history)

3. **Execution Integration**: Should executing a pipeline:
   - Open a new terminal with command
   - Show in AI Processes panel
   - Open a new webview panel with results

4. **Error Handling**: How to display validation errors:
   - In tree item description
   - In hover tooltip
   - In dedicated problems panel

## Dependencies

- Existing `yaml-pipeline` module for parsing/validation
- VSCode file system APIs for watching
- Existing tree view patterns (tasks-viewer, global-notes)

## Success Criteria

1. Users can see all pipeline files in `.vscode/pipelines/`
2. Clicking a pipeline opens the YAML file
3. Panel updates automatically when files are added/removed/modified
4. Pipeline metadata (name, description) displays correctly
5. Configuration options work as expected
6. Follows existing extension patterns and conventions

## References

- [YAML Pipeline Framework Documentation](../../src/shortcuts/yaml-pipeline/AGENTS.md)
- [Map-Reduce Framework Design](./map-reduce-framework.md)
- [Tasks Viewer Implementation](../../src/shortcuts/tasks-viewer/)
- [Global Notes Implementation](../../src/shortcuts/global-notes/)

---

## Summary

This design provides a **minimal, focused v1** implementation that:
- ✅ Discovers pipelines in `.vscode/pipelines/`
- ✅ Shows them in a tree view with metadata
- ✅ Opens YAML files on click
- ✅ Auto-refreshes on file changes
- ✅ Follows existing extension architecture
- ✅ Provides foundation for future enhancements

The implementation reuses existing patterns from `tasks-viewer` and `global-notes`, ensuring consistency with the rest of the extension.
