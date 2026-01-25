# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.
NEVER create document file unless user's explicit ask.

## Recent Refactoring (2026-01)

**Tree Data Provider Base Classes** - A refactoring was completed to eliminate code duplication across tree data providers:

- **Created 5 new shared modules:**
  - `base-tree-data-provider.ts` - Foundation class with EventEmitter, refresh, dispose, error handling
  - `filterable-tree-data-provider.ts` - Adds filtering capabilities
  - `tree-filter-utils.ts` - Reusable filter matching utilities
  - `tree-icon-utils.ts` - Centralized icon constants and helpers
  - `tree-error-handler.ts` - Consistent error handling

- **Migrated 4 providers:**
  - `GlobalNotesTreeDataProvider` → extends `BaseTreeDataProvider`
  - `TasksTreeDataProvider` → extends `FilterableTreeDataProvider`
  - `PipelinesTreeDataProvider` → extends `FilterableTreeDataProvider`
  - `LogicalTreeDataProvider` → extends `FilterableTreeDataProvider`

- **Result:** Eliminated ~210 lines of duplication, all 5690 tests passing, 100% backward compatible

When creating new tree data providers, prefer extending these base classes over implementing from scratch.

## Project Overview

This is the "Markdown Review & Workspace Shortcuts" VSCode extension that provides:

1. **Markdown Review Editor** - Add inline comments and annotations to markdown files
2. **Git Diff Review** - Review git changes with inline comments and AI integration
3. **Code Review Against Rules** - Review commits against custom coding standards
4. **Shortcut Groups** - Custom organization of files and folders into thematic groups
5. **Global Notes** - Quick-access notes available from any workspace
6. **Tasks Viewer** - Hierarchical task management with support for nested directories and document grouping

## Development Commands

### Build and Compilation
- `npm run compile` - Compile TypeScript to JavaScript using webpack
- `npm run watch` - Watch mode for development (webpack watch)
- `npm run package` - Production build with optimizations

### Testing and Quality
- `npm run lint` - Run ESLint on source files
- `npm run pretest` - Runs compile-tests, compile, and lint in sequence
- `npm run test` - Run all tests (depends on pretest)
- `npm run compile-tests` - Compile test files only

### Running Individual Tests
After running `npm run compile-tests`, you can run specific test files:
```bash
# Run a single test file
node ./out/test/runTest.js --grep "test description pattern"
```
Test files are in `src/test/suite/` and include:
- `markdown-comments.test.ts` - Comments functionality
- `config-migrations.test.ts` - Configuration migration tests (38 tests)
- `sync.test.ts` - Cloud sync tests
- `nested-groups.test.ts` - Nested group behavior
- `drag-drop.test.ts` - Drag and drop functionality

### Publishing
- `npm run vsce:package` - Create .vsix package for distribution
- `npm run vsce:publish` - Publish extension to marketplace

## Architecture Overview

### Core Components

**Markdown Comments (`src/shortcuts/markdown-comments/`)**
- `ReviewEditorViewProvider` - Custom editor for markdown files with inline commenting
- `CommentsManager` - Stores and manages comment state per file
- `MarkdownCommentsTreeDataProvider` - Shows all comments in tree view
- `PromptGenerator` - Generates AI prompts from comments

**Git Diff Comments (`src/shortcuts/git-diff-comments/`)**
- `GitDiffReviewEditorProvider` - Custom editor for git diff review
- `DiffCommentsManager` - Manages comments on git diffs
- `DiffCommentsTreeDataProvider` - Shows diff comments organized by category/file

**AI Service (`src/shortcuts/ai-service/`)**
- `AIProcessManager` - Manages running AI clarification requests with persistence
- `AIProcessTreeDataProvider` - Shows running/completed AI processes
- `CopilotCLIInvoker` - Invokes GitHub Copilot CLI or copies to clipboard
- `CopilotSDKService` - Wrapper around @github/copilot-sdk for structured AI interactions
- Working directory defaults to `{workspaceFolder}/src` if the src directory exists, otherwise falls back to workspace root
- AI processes are persisted using VSCode's Memento API (workspaceState) and restored on extension restart, keeping history isolated per workspace
- Supports viewing full process details, removing individual processes, and clearing all history

**MCP Control & Permission Handling API**

The `SendMessageOptions` interface exposes SDK capabilities for session-level tool filtering and permission handling:

```typescript
interface SendMessageOptions {
    prompt: string;
    model?: string;
    workingDirectory?: string;
    timeoutMs?: number;
    usePool?: boolean;
    streaming?: boolean;
    
    // MCP Control Options (Tool Filtering)
    availableTools?: string[];  // Whitelist (takes precedence)
    excludedTools?: string[];   // Blacklist
    mcpServers?: Record<string, MCPServerConfig>;  // Custom MCP servers
    
    // Permission Handling
    onPermissionRequest?: PermissionHandler;  // Handler for file/shell/URL permissions
}
```

**Tool Filtering:**
- `availableTools`: Whitelist mode - only specified tools are available
- `excludedTools`: Blacklist mode - specified tools are disabled
- `availableTools` takes precedence over `excludedTools` if both specified
- If neither specified, SDK uses default behavior (all tools available)

**Permission Handling:**
- Without `onPermissionRequest`, all file/shell/URL operations are **denied by default**
- Use `approveAllPermissions` helper to allow all operations (use cautiously)
- Use `denyAllPermissions` or omit handler to restrict AI to read-only operations
- Permission types: `'shell'`, `'write'`, `'mcp'`, `'read'`, `'url'`

**Important:** MCP and permission options only apply to direct sessions (`usePool: false`). Session pool sessions use default configuration since pool sessions are created without per-request options.

**Example Usage:**
```typescript
import { approveAllPermissions } from './ai-service';

// Allow AI to read/write files and execute commands
const result = await service.sendMessage({
    prompt: 'List files and create a summary',
    onPermissionRequest: approveAllPermissions  // ⚠️ Allows everything
});

// Restrict to specific tools only
const result = await service.sendMessage({
    prompt: 'Review this file',
    availableTools: ['view', 'grep'],  // Read-only tools
    // No permission handler = deny file writes and shell commands
});

// Selective permission approval
const result = await service.sendMessage({
    prompt: 'Analyze code',
    onPermissionRequest: (request) => {
        if (request.kind === 'read') return { kind: 'approved' };
        return { kind: 'denied-by-rules' };  // Deny writes, shell, etc.
    }
});
```

**Code Review (`src/shortcuts/code-review/`)**
- `CodeReviewService` - Orchestrates code review against custom rules
- `RulesLoader` - Loads markdown rule files from `.github/cr-rules/`
- `PromptBuilder` - Builds review prompts with rules and diff content

**YAML Pipeline (`src/shortcuts/yaml-pipeline/`)**
- `PipelineManager` - Manages pipeline packages (discovery, CRUD, validation)
- `PipelinesTreeDataProvider` - Tree view for pipeline packages and resources
- `executePipeline` - Executes pipeline from YAML configuration
- Pipelines are organized as **packages**: directories containing `pipeline.yaml`
- CSV paths are resolved relative to the pipeline package directory

**Main Entry Point (`src/extension.ts`)**
- Activates extension and registers the tree view
- Initializes configuration management with workspace root detection
- Sets up keyboard navigation handlers
- Registers webview search provider and connects to tree data provider

**Tree Data Provider**
- `LogicalTreeDataProvider` (`src/shortcuts/logical-tree-data-provider.ts`) - Manages logical groups and their contents
- Implements VSCode's `TreeDataProvider<T>` interface and supports search filtering
- Handles all shortcut organization through groups

**Configuration Management (`src/shortcuts/configuration-manager.ts`)**
- Manages YAML configuration files (`.vscode/shortcuts.yaml`)
- Supports both workspace-specific and global configurations
- Handles file watching for live configuration updates
- Uses js-yaml for parsing/serializing configuration

**Global Notes (`src/shortcuts/global-notes/`)**
- `GlobalNotesTreeDataProvider` - Manages global notes view separate from shortcuts groups
- `NoteDocumentProvider` - Virtual document provider for note content
- Notes stored in `globalNotes` array in config, accessible from any workspace

**Command System (`src/shortcuts/commands.ts`)**
- Centralized command registration and handling
- Supports group operations (create, rename, delete)
- Item operations (add to group, remove from group, copy paths)
- Create new files and folders directly in logical groups
- Search management commands

### Data Flow

1. **Configuration Loading**: Extension reads `.vscode/shortcuts.yaml` or creates default config
2. **Migration**: Old physical shortcuts automatically converted to logical groups on first load
3. **Tree Population**: Tree data provider parses config and generates tree items
4. **User Interaction**: Commands modify configuration and trigger tree refresh
5. **Search Integration**: Search provider filters tree view
6. **Persistence**: Changes are automatically saved to YAML configuration

## Markdown Review Editor

A custom editor for adding inline comments to markdown files.

**How to use:**
1. Right-click any `.md` file → "Open with Markdown Review Editor"
2. Select text and press `Ctrl+Shift+M` (or `Cmd+Shift+M`)
3. Enter your comment in the floating panel
4. Comments appear in the "Markdown Comments" tree view

**Architecture:**
- Uses VSCode's Custom Editor API (`CustomTextEditorProvider`)
- Comments stored in file-specific JSON files (`.vscode/comments/<hash>.json`)
- Webview renders markdown with highlight.js and mermaid.js support
- Comment anchoring uses content fingerprinting for resilience to file edits

**Key Components:**
- `ReviewEditorViewProvider` - Custom editor provider
- `CommentsManager` - CRUD operations for comments
- `CommentAnchor` - Locates comment positions after file changes
- `PromptGenerator` - Creates AI prompts from comment text

**AI Integration (Preview):**
- Enable via `workspaceShortcuts.aiService.enabled` setting
- "Ask AI" submenu in review editor context menu
- Supports Copilot CLI or clipboard modes
- Processes tracked in "AI Processes" tree view

## Git Diff Review

Review git changes with inline comments.

**How to use:**
1. Open the Git view in the Shortcuts panel
2. Right-click any changed file → "Open with Diff Review"
3. Select text in the diff and press `Ctrl+Shift+M` to add a comment
4. Comments are organized by category (bug, suggestion, question, etc.)

**Features:**
- Comment categories for organizing feedback
- Generate prompts from comments for AI-assisted review
- Resolve/reopen workflow
- Comments persist until manually deleted

## Code Review Against Rules

Review commits or pending changes against custom coding rules.

**Setup:**
1. Create rule files in `.github/cr-rules/*.md`
2. Each file describes coding standards (naming, patterns, etc.)
3. Files are loaded alphabetically (prefix with numbers to control order)

**Usage:**
- Right-click a commit → "Review Against Rules"
- Or use "Review Pending/Staged Changes Against Rules" for current work
- Results appear in the AI Processes panel

**Settings:**
- `workspaceShortcuts.codeReview.rulesFolder` - Path to rules folder
- `workspaceShortcuts.codeReview.rulesPattern` - Glob pattern for rule files

## YAML Pipeline Framework

Define and execute AI-powered data processing pipelines via YAML configuration.

## Tasks Viewer (With Nested Directory Support)

The Tasks Viewer provides hierarchical task management with support for nested directories and document grouping.

**Directory Structure Support:**
```
.vscode/tasks/
├── root-task.md                           # Root-level task
├── feature1/                              # Feature folder
│   ├── task1.plan.md                      # Grouped documents
│   ├── task1.spec.md                      # (task1.plan + task1.spec)
│   ├── task2.md                           # Single document
│   └── backlog1/                          # Nested subfolder
│       ├── task3.plan.md
│       └── task3.test.md
├── feature2/
│   └── backlog2/
│       ├── task4.md
│       └── task5.md
└── archive/                               # Archive folder
    ├── archived-task.md
    └── feature1/
        └── old-task.md
```

**Key Features:**

1. **Recursive Directory Scanning** - Automatically discovers tasks in nested subdirectories at any depth
2. **Hierarchical Display** - Shows folders as expandable tree items with tasks nested inside
3. **Document Grouping** - Groups related documents (e.g., `task1.plan.md`, `task1.spec.md`) under a single parent
4. **Cross-Platform Support** - Works correctly on Linux, macOS, and Windows with proper path handling
5. **Archive Support** - Maintains nested structure in archive folder
6. **Smart Grouping** - Only groups documents in the same directory (different directories keep tasks separate)

**Architecture:**

- `TaskManager` - Handles recursive directory scanning with `scanTasksRecursively()` and `scanDocumentsRecursively()`
- `TaskFolder` type - Represents hierarchical folder structure with children, documentGroups, and singleDocuments
- `TaskFolderItem` - Tree item for displaying folders in the tree view
- `relativePath` property - Tracks file location relative to tasks root (e.g., `feature1/backlog1`)
- File watchers use glob pattern `**/*.md` for recursive monitoring

**Settings:**
- `workspaceShortcuts.tasksViewer.enabled` - Enable/disable tasks viewer
- `workspaceShortcuts.tasksViewer.folderPath` - Path to tasks folder (default: `.vscode/tasks`)
- `workspaceShortcuts.tasksViewer.showArchived` - Show/hide archived tasks
- `workspaceShortcuts.tasksViewer.sortBy` - Sort by name or modified date
- `workspaceShortcuts.tasksViewer.groupRelatedDocuments` - Enable document grouping (default: true)

**Document Grouping Logic:**
- Files like `task1.plan.md`, `task1.spec.md`, `task1.test.md` in the same directory are grouped under "task1"
- Documents in different directories remain separate even with the same base name
- Common doc type suffixes: plan, spec, test, notes, todo, design, impl, review, checklist, requirements, analysis

**Testing:**
- 23 comprehensive tests covering nested directories (`tasks-nested-directories.test.ts`)
- Tests include: single/multi-level nesting, cross-platform paths, document grouping, hierarchy construction, tree display
- All tests pass on macOS, Linux, and Windows (via cross-platform path handling)

## YAML Pipeline Framework

Define and execute AI-powered data processing pipelines via YAML configuration.

**Pipeline Package Structure:**
```
.vscode/pipelines/
├── run-tests/                  # Pipeline package (directory)
│   ├── pipeline.yaml           # Required entry point
│   ├── input.csv               # Resource files
│   └── data/
│       └── test-cases.csv      # Nested resources supported
├── analyze-code/               # Another pipeline package
│   ├── pipeline.yaml
│   └── rules.csv
└── shared/                     # Shared resources (not a pipeline)
    └── common-mappings.csv
```

**Key Concepts:**
- Each subdirectory in `.vscode/pipelines/` containing `pipeline.yaml` is a pipeline package
- All paths in `pipeline.yaml` are resolved relative to the package directory
- Use `../shared/file.csv` to reference shared resources across packages

**Pipeline YAML Format:**
```yaml
name: "Bug Triage"
description: "Analyze and categorize bugs"

input:
  type: csv
  path: "input.csv"  # Relative to package directory

# Optional: Filter phase to reduce items before map
filter:
  type: rule  # Options: rule, ai, hybrid
  rule:
    rules:
      - field: severity
        operator: in
        values: [critical, high]
      - field: status
        operator: equals
        value: open
    mode: all  # Options: all (AND), any (OR)

map:
  prompt: |
    Analyze: {{title}}
    Description: {{description}}
    
    Return JSON with severity and category.
  output:
    - severity
    - category
  parallel: 5
  # batchSize: 10  # Optional: Items per AI call (default: 1)
                   # When > 1, use {{ITEMS}} in prompt for batch processing
  # timeoutMs: 600000  # Optional: Default is 10 minutes (600000ms)
                        # On timeout, retries once with doubled timeout (20 minutes)

reduce:
  type: json  # Options: list, table, json, csv, ai
```

**Batch Mapping (Optional):**

For efficiency, group items into batches instead of one AI call per item:

```yaml
map:
  prompt: |
    Analyze these items:
    {{ITEMS}}
    
    Return JSON array with results for each.
  batchSize: 10  # Process 10 items per AI call
  output:
    - severity
    - category
```

- Default: 1 (current behavior, backward compatible)
- `{{ITEMS}}`: JSON array of all items in the batch
- AI must return array with one result per input item
- On wrong count, batch is marked as failed

**Filter Phase (Optional):**

The optional filter phase reduces the number of items before the expensive map phase. Three filter types are supported:

**1. Rule-Based Filter** (fast, synchronous):
```yaml
filter:
  type: rule
  rule:
    rules:
      - field: priority
        operator: gte
        value: 5
      - field: category
        operator: in
        values: [bug, security]
    mode: all  # Both rules must match (AND)
```

Supported operators:
- `equals`, `not_equals` - Exact match
- `in`, `not_in` - Value in array
- `contains`, `not_contains` - Substring match (case-insensitive)
- `greater_than`, `less_than`, `gte`, `lte` - Numeric comparison
- `matches` - Regex pattern matching

**2. AI-Based Filter** (intelligent, uses AI):
```yaml
filter:
  type: ai
  ai:
    prompt: |
      Ticket: {{title}}
      Description: {{description}}
      
      Is this actionable for engineering?
      Return JSON: {"include": true/false, "reason": "explanation"}
    output:
      - include  # Required boolean field
      - reason
    parallel: 10
    timeoutMs: 30000  # Default: 30 seconds
```

**3. Hybrid Filter** (combines both):
```yaml
filter:
  type: hybrid
  rule:
    rules:
      - field: status
        operator: equals
        value: open
  ai:
    prompt: |
      Review ticket {{id}}: {{title}}
      Should this be prioritized?
      Return JSON: {"include": true/false}
    output:
      - include
  combineMode: and  # Options: and (default), or
```

- `combineMode: and` - Item must pass BOTH rule and AI filters
- `combineMode: or` - Item passes if EITHER rule OR AI filter accepts it

**AI-Powered Reduce:**
Use AI to synthesize, deduplicate, or prioritize map results.

```yaml
reduce:
  type: ai
  prompt: |
    You analyzed {{COUNT}} bugs:
    {{RESULTS}}
    
    Create executive summary with top priorities.
  output:
    - summary
    - priorities
  model: gpt-4  # Optional
```

Available template variables in reduce.prompt:
- `{{RESULTS}}` - All successful map outputs as JSON
- `{{COUNT}}` - Total results count
- `{{SUCCESS_COUNT}}` - Successful items
- `{{FAILURE_COUNT}}` - Failed items
- `{{paramName}}` - Any parameter defined in `input.parameters` (e.g., `{{projectName}}`, `{{reviewer}}`)

**Commands:**
- Create pipeline: Opens wizard to create new pipeline package
- Execute pipeline: Run the pipeline (placeholder for future)
- Validate pipeline: Check YAML structure and resource files

**Settings:**
- `workspaceShortcuts.pipelinesViewer.enabled` - Enable/disable pipelines viewer
- `workspaceShortcuts.pipelinesViewer.folderPath` - Path to pipelines folder
- `workspaceShortcuts.pipelinesViewer.sortBy` - Sort by name or modified date
- `workspaceShortcuts.codeReview.outputMode` - Where to show results

## Global Notes

The extension provides a separate "Global Notes" view for quick-access notes not tied to any group.

**Architecture:**
- Stored in `globalNotes` array in `shortcuts.yaml`
- Notes use virtual document provider (`shortcuts-note:` URI scheme)
- Content stored via VSCode's Memento storage API
- Available from any workspace (stored globally)

**Commands:**
- `shortcuts.createGlobalNote` - Create a new global note
- `shortcuts.editGlobalNote` - Edit note content
- `shortcuts.renameGlobalNote` - Rename note
- `shortcuts.deleteGlobalNote` - Delete note

## Shortcut Groups Configuration

The extension uses YAML configuration files stored at `.vscode/shortcuts.yaml` with this structure:

```yaml
# Optional: Define base paths for multiple git roots or common directories
basePaths:
  - alias: "@frontend"
    path: "/path/to/frontend/repo"
    type: "git"
    description: "Git repository: frontend"
  - alias: "@backend"
    path: "/path/to/backend/repo"
    type: "git"
    description: "Git repository: backend"

logicalGroups:
  - name: "Project Files"
    description: "Core project components"
    items:
      - path: "package.json"
        name: "Package Config"
        type: "file"
      - path: "src"
        name: "Source"
        type: "folder"
  - name: "Quick Access"
    description: "Frequently used folders"
    items:
      - path: "@frontend/src/components"
        name: "Frontend Components"
        type: "folder"
```

### Base Paths Configuration

The `basePaths` section allows you to define aliases for multiple git roots or common directories:

- **alias**: A name starting with `@` that you can use to reference the base path (e.g., `@myrepo`)
- **path**: The actual filesystem path (absolute or relative to workspace root)
- **type** (optional): `git`, `workspace`, `docs`, `build`, `config`, or `custom`
- **description** (optional): Human-readable description

### Key Types (`src/shortcuts/types.ts`)

```typescript
interface BasePath {
    alias: string;     // Alias name (e.g., @myrepo)
    path: string;      // Actual filesystem path
    type?: BasePathType;  // 'git' | 'workspace' | 'docs' | 'build' | 'config' | 'custom'
    description?: string;
}

interface LogicalGroup {
    name: string;           // Group identifier
    description?: string;   // Optional description
    items: LogicalGroupItem[];  // Folder/file/command/task/note items
    groups?: LogicalGroup[];   // Nested subgroups
    icon?: string;         // Optional group icon
}

interface LogicalGroupItem {
    path?: string;     // Relative, absolute, or alias path (for file/folder items)
    name: string;      // Display name
    type: 'folder' | 'file' | 'command' | 'task' | 'note';  // Item type
    command?: string;  // Command ID (for command items)
    task?: string;     // Task name (for task items)
    noteId?: string;   // Note storage reference (for note items)
    args?: any[];      // Optional command arguments
    icon?: string;     // Optional icon override
}

interface ShortcutsConfig {
    basePaths?: BasePath[];         // Optional base path aliases
    logicalGroups: LogicalGroup[];  // All groups
    globalNotes?: GlobalNote[];     // Global notes (not tied to groups)
}
```

### Tree Item Hierarchy (`src/shortcuts/tree-items.ts`)

- `ShortcutItem` (base class) - Common tree item functionality
- `FolderShortcutItem` - Represents filesystem folders
- `FileShortcutItem` - Represents individual files
- `LogicalGroupItem` - Represents logical group containers
- `LogicalGroupChildItem` - Items within logical groups

## Development Notes

- Uses webpack for bundling with TypeScript compilation
- VSCode API minimum version: 1.74.0
- Format on save and import organization enabled
- Test files use Mocha framework
- Extension activates on view container or command usage
- Supports both workspace and global configuration modes
- Theme-aware icons via `ThemeManager`
- Error handling via `ErrorHandler` with user-friendly notifications

## Testing

Tests are located in `src/test/suite/` and cover:
- Comment functionality (markdown and git diff)
- Command functionality
- Tree data provider behavior
- Configuration management (including migration)
- Theming system
- Extension activation

Run tests with `npm test` which handles compilation and setup automatically.

## Configuration Migration System

The extension includes a comprehensive versioned configuration system for backward compatibility:

**Version History:**
- **v1**: Original `shortcuts` array format (pre-2.0)
- **v2**: Logical groups without nesting (2.0-2.4)
- **v3**: Logical groups with nested groups support (2.5)
- **v4**: Auto-detected git roots as base paths (2.6+)

### Key Features

1. **Automatic Detection**: Detects configuration version from structure
2. **Sequential Migration**: Applies migrations in order (v1→v2→v3→v4)
3. **Non-Destructive**: Preserves data, skips invalid entries with warnings
4. **Git Root Detection**: Automatically detects git repositories and creates base path aliases

### Adding New Versions

To add a new configuration version:
1. Increment `CURRENT_CONFIG_VERSION` in `config-migrations.ts`
2. Create migration function: `migrateVxToVy(config, context)`
3. Register: `registerMigration(x, migrateVxToVy)`
4. Add comprehensive tests in `config-migrations.test.ts`
5. Update this documentation

## Cloud Sync

The extension supports cloud synchronization of shortcuts configuration across devices via VSCode Settings Sync:

**Configuration** (in VSCode settings):
```json
{
  "workspaceShortcuts.sync.enabled": true,
  "workspaceShortcuts.sync.autoSync": true,
  "workspaceShortcuts.sync.syncInterval": 300,
  "workspaceShortcuts.sync.provider": "vscode",
  "workspaceShortcuts.sync.vscode.scope": "global"
}
```

### Sync Commands

- `shortcuts.sync.configure` - Interactive sync provider configuration wizard
- `shortcuts.sync.enable` - Enable cloud synchronization
- `shortcuts.sync.disable` - Disable cloud synchronization
- `shortcuts.sync.now` - Manually trigger immediate sync
- `shortcuts.sync.status` - Show sync status for all providers

## Create File and Folder Support

The extension supports creating new files and folders at multiple levels:

### Commands
- `shortcuts.createFileInLogicalGroup` - Create file at group level
- `shortcuts.createFolderInLogicalGroup` - Create folder at group level
- `shortcuts.createFileInFolder` - Create file in a subfolder
- `shortcuts.createFolderInFolder` - Create folder in a subfolder

### Menu Context
- Group level: `viewItem == logicalGroup`
- Folder within group: `viewItem == logicalGroupItem_folder`
- Nested folder: `viewItem == folder`

All commands are registered in `src/shortcuts/commands.ts` and use native VSCode dialogs for input validation.
