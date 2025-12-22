# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.
NEVER create document file unless user's explicit ask.

## Project Overview

This is the "Workspace Shortcuts" VSCode extension that provides customizable groups for organizing files and folders in your workspace. The extension creates a sidebar panel with:

1. **Shortcut Groups** - Custom organization of files and folders into thematic groups
2. **Unified Search** - Search functionality via webview
3. **Flexible Organization** - Group any files and folders regardless of their physical location

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
- `config-migrations.test.ts` - Configuration migration tests (38 tests)
- `markdown-comments.test.ts` - Comments functionality
- `sync.test.ts` - Cloud sync tests
- `nested-groups.test.ts` - Nested group behavior
- `drag-drop.test.ts` - Drag and drop functionality

### Publishing
- `npm run vsce:package` - Create .vsix package for distribution
- `npm run vsce:publish` - Publish extension to marketplace

## Architecture Overview

### Core Components

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

**Search and Navigation**
- `InlineSearchProvider` (`src/shortcuts/inline-search-provider.ts`) - Webview-based unified search
- `KeyboardNavigationHandler` (`src/shortcuts/keyboard-navigation.ts`) - Keyboard shortcuts (Enter, Space, F2, Delete, arrows)
- Search filters the group view

**Command System (`src/shortcuts/commands.ts`)**
- Centralized command registration and handling
- Supports group operations (create, rename, delete)
- Item operations (add to group, remove from group, copy paths)
- Create new files and folders directly in logical groups
- Search management commands

**Global Notes (`src/shortcuts/global-notes/`)**
- `GlobalNotesTreeDataProvider` - Manages global notes view separate from shortcuts groups
- `NoteDocumentProvider` - Virtual document provider for note content
- Notes stored in `globalNotes` array in config, accessible from any workspace

**Markdown Comments (`src/shortcuts/markdown-comments/`)**
- `ReviewEditorViewProvider` - Custom editor for markdown files with inline commenting
- `CommentsManager` - Stores and manages comment state per file
- `MarkdownCommentsTreeDataProvider` - Shows all comments in tree view
- `PromptGenerator` - Generates AI prompts from comments

**AI Service (`src/shortcuts/ai-service/`)**
- `AIProcessManager` - Manages running AI clarification requests
- `AIProcessTreeDataProvider` - Shows running/completed AI processes
- `CopilotCLIInvoker` - Invokes GitHub Copilot CLI or copies to clipboard
- Working directory defaults to `{workspaceFolder}/src` if the src directory exists, otherwise falls back to workspace root

### Data Flow

1. **Configuration Loading**: Extension reads `.vscode/shortcuts.yaml` or creates default config
2. **Migration**: Old physical shortcuts automatically converted to logical groups on first load
3. **Tree Population**: Tree data provider parses config and generates tree items
4. **User Interaction**: Commands modify configuration and trigger tree refresh
5. **Search Integration**: Search provider filters tree view
6. **Persistence**: Changes are automatically saved to YAML configuration

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

interface GlobalNote {
    name: string;      // Display name
    noteId: string;    // Storage reference
    icon?: string;     // Optional icon
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

## Configuration

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
  - alias: "@shared"
    path: "../shared-libs"
    type: "custom"
    description: "Shared libraries"

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
      - path: "/absolute/path/to/folder"
        name: "External Folder"
        type: "folder"
      - path: "@frontend/src/components"
        name: "Frontend Components"
        type: "folder"
      - path: "@backend/api/routes"
        name: "API Routes"
        type: "folder"
```

### Base Paths Configuration

The `basePaths` section allows you to define aliases for multiple git roots or common directories:

- **alias**: A name starting with `@` that you can use to reference the base path (e.g., `@myrepo`)
- **path**: The actual filesystem path, can be:
  - Absolute path (e.g., `/Users/name/projects/myrepo`)
  - Relative to workspace root (e.g., `../sibling-repo` or `subproject`)
- **type** (optional): The type of base path, one of:
  - `git` - Git repository root (auto-detected during migration)
  - `workspace` - VS Code workspace folder
  - `docs` - Documentation directories
  - `build` - Build output directories
  - `config` - Configuration directories
  - `custom` - User-defined paths (default)
- **description** (optional): Human-readable description of what this base path represents

Use base path aliases in your item paths like: `@frontend/src/components/Button.tsx`

**Benefits of Base Paths:**
- Work with multiple git repositories in a single shortcuts configuration
- Use meaningful aliases instead of long absolute paths
- Easily relocate projects by updating just the base path
- Share configurations across team members with different directory structures

**Automatic Alias Detection:**
When adding files or folders to a group, the extension automatically:
1. Checks if the file is within a path that has a defined base path alias
2. If found, uses the alias in the stored path (e.g., `@frontend/src/file.ts`)
3. Detects git repository roots and uses their aliases if available
4. Falls back to relative or absolute paths if no alias matches

This means you can define your base paths once, and the extension will automatically use them when you add items!

**Note**: Old configurations with a `shortcuts` array are automatically migrated to `logicalGroups` format on first load.

### Configuration Source Visibility

The extension provides transparency about which configuration is currently active:

**Visual Indicators:**
- The tree view description shows the active config source:
  - 📁 Workspace - Using `.vscode/shortcuts.yaml` in the workspace
  - 🌐 Global - Using `~/.vscode-shortcuts/.vscode/shortcuts.yaml`
  - ⚙️ Default - No config file exists, using built-in defaults

**Configuration Source Command:**
- Command: `shortcuts.showConfigSource` - "Show Active Configuration Source"
- Accessible via toolbar icon (ℹ️) in the Shortcuts panel
- Shows detailed information about the active configuration:
  - Source type (workspace/global/default)
  - Full file path
  - Actions: Open Configuration, Copy Path

**Configuration Priority:**
1. **Workspace config** (highest): If `.vscode/shortcuts.yaml` exists, it's used exclusively
2. **Global config** (fallback): Used only if workspace config doesn't exist
3. **Default config** (fallback): Built-in defaults when no files exist

**Implementation:**
- `ConfigurationManager.getActiveConfigSource()` - Returns current config source info
- Tree view description updates automatically when config changes
- Visual feedback helps users understand which configuration is in effect

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
- Command functionality
- Tree data provider behavior
- Configuration management (including migration)
- Theming system
- Extension activation

Run tests with `npm test` which handles compilation and setup automatically.

## Version 2.0 Changes

The extension has been simplified to use a single unified view with logical groups:
- Removed the separate "Physical Folders" view
- All shortcuts now organized through logical groups
- Old physical shortcuts automatically migrate to single-item groups
- Cleaner, more intuitive interface
- Same functionality with better organization

## Configuration Migration System

The extension includes a comprehensive versioned configuration system for backward compatibility:

### Architecture

**Migration Module (`src/shortcuts/config-migrations.ts`)**
- Centralized migration logic with version detection
- Sequential migration chain (v1→v2→v3)
- Pure functions for each migration step
- Comprehensive error handling and warnings

**Version History:**
- **v1**: Original `shortcuts` array format (pre-2.0)
- **v2**: Logical groups without nesting (2.0-2.4)
- **v3**: Logical groups with nested groups support (2.5)
- **v4**: Auto-detected git roots as base paths (2.6+)

### Key Features

1. **Automatic Detection**: Detects configuration version from structure
2. **Sequential Migration**: Applies migrations in order (v1→v2→v3→v4)
3. **Non-Destructive**: Preserves data, skips invalid entries with warnings
4. **Validation**: Checks paths exist, validates types, handles edge cases
5. **Verbose Mode**: Optional detailed logging for debugging
6. **Git Root Detection**: Automatically detects git repositories and creates base path aliases
7. **Test Coverage**: 37 comprehensive tests covering all scenarios including git detection

### API

```typescript
// Detect version
const version = detectConfigVersion(config);

// Migrate configuration
const result = migrateConfig(config, {
    workspaceRoot: '/path',
    verbose: true
});

// Check if migration is possible
const canMigrate = canMigrate(config);

// Get supported versions
const versions = getSupportedVersions(); // [1, 2, 3, 4]
```

### V4 Migration: Auto Git Root Detection

Version 4 introduces automatic git root detection and conversion to base paths:

**What it does:**
1. Scans all file/folder paths in your configuration
2. Detects git repositories for each path
3. Automatically creates base path aliases (e.g., `@myrepo`)
4. Converts absolute paths to use the new aliases

**Example:**
```yaml
# Before (v3)
version: 3
logicalGroups:
  - name: Frontend
    items:
      - path: /Users/name/projects/myapp/src
        name: Source
        type: folder

# After (v4)
version: 4
basePaths:
  - alias: "@myapp"
    path: /Users/name/projects/myapp
    type: git
    description: "Git repository: myapp"
logicalGroups:
  - name: Frontend
    items:
      - path: "@myapp/src"
        name: Source
        type: folder
```

**Benefits:**
- Makes configurations portable across machines
- Cleaner, more maintainable paths
- Automatic detection - no manual work required
- Handles multiple git repositories
- Preserves existing base paths
- Automatically adds type metadata ('git') and descriptions

### Integration

The `ConfigurationManager` automatically:
1. Detects configuration version on load
2. Applies necessary migrations (including git root detection)
3. Shows warnings if any issues occur
4. Saves migrated config with version number and detected base paths

### Adding New Versions

To add a new configuration version:
1. Increment `CURRENT_CONFIG_VERSION` in `config-migrations.ts`
2. Create migration function: `migrateVxToVy(config, context)`
3. Register: `registerMigration(x, migrateVxToVy)`
4. Add comprehensive tests in `config-migrations.test.ts`
5. Update this documentation

### Migration Test Coverage

The migration system has 38 tests covering:
- **Version Detection** (5 tests): Detecting v1, v2, v3, v4 configs
- **V1→V2 Migration** (8 tests): Physical shortcuts to logical groups
- **V2→V3 Migration** (2 tests): Adding nested group support
- **V3→V4 Migration** (13 tests): Git root detection and path conversion
  - Single and multiple paths in same repo
  - Nested groups with git paths
  - Preserving existing base paths
  - Handling paths already using aliases
  - Non-git paths
  - Relative paths in git repos
  - Duplicate repo names
  - Command/task items
  - Non-existent paths
  - Git root at exact item path
  - Type and description metadata
- **Multi-Version** (2 tests): End-to-end migrations (v1→v4)
- **Validation** (3 tests): Migration validation and supported versions
- **Edge Cases** (4 tests): Empty configs, absolute paths, base paths
- **Verbose Mode** (1 test): Logging functionality

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

## Markdown Review Editor

A custom editor for adding inline comments to markdown files.

**How to use:**
1. Right-click any `.md` file → "Open with Review Editor"
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

## Create File and Folder Support

The extension now supports creating new files and folders at multiple levels:

### Features

#### Create at Group Level
- Right-click on any logical group to access "Create File" or "Create Folder" options
- Interactive workflow guides you through:
  1. Entering the file/folder name (with validation)
  2. Choosing location (workspace root or custom location)
  3. Automatic creation and addition to the group

#### Create in Subfolders (New!)
- Right-click on **any folder** within a logical group to create files/folders inside it
- Works with both:
  - Folders that are direct members of logical groups
  - Nested folders expanded from the file tree
- Creates files/folders directly in the selected folder location
- Automatically adds new items to the parent logical group (if applicable)

#### Common Features
- For files: automatically opens the newly created file in the editor
- Handles existing files/folders gracefully with confirmation prompts
- Input validation prevents invalid file/folder names
- Integrates seamlessly with the existing configuration system

### Implementation Details

#### Commands
- `shortcuts.createFileInLogicalGroup` - Create file at group level
- `shortcuts.createFolderInLogicalGroup` - Create folder at group level
- `shortcuts.createFileInFolder` - Create file in a subfolder
- `shortcuts.createFolderInFolder` - Create folder in a subfolder

#### Menu Context
- Group level: `viewItem == logicalGroup`
- Folder within group: `viewItem == logicalGroupItem_folder`
- Nested folder: `viewItem == folder`

All commands are registered in `src/shortcuts/commands.ts` and use native VSCode dialogs for input validation.

## Cloud Sync

The extension supports cloud synchronization of shortcuts configuration across devices via multiple providers:

### Sync Providers

**1. VSCode Settings Sync (Built-in)**
- Leverages VSCode's native sync infrastructure
- Automatically syncs with your Microsoft/GitHub account
- No additional configuration required
- Supports both global and workspace scope
- Simplest option for basic sync needs

**2. Azure Blob Storage**
- Store configuration in Azure Blob container
- Requires connection string or SAS token
- Configuration: container name, storage account name
- Credentials stored securely via SecretStorage API

### Sync Architecture

**Core Components:**

`src/shortcuts/sync/sync-provider.ts`
- `ISyncProvider` interface defining sync operations
- `SyncResult` and `SyncMetadata` types
- Status tracking and error handling

`src/shortcuts/sync/cloud-sync-provider.ts`
- Base class for cloud providers
- Retry logic with exponential backoff
- Authentication error detection
- Checksum validation for data integrity

`src/shortcuts/sync/vscode-sync-provider.ts`
- VSCode Settings Sync implementation
- Uses `context.globalState` or `context.workspaceState`
- Device ID generation and tracking

`src/shortcuts/sync/providers/`
- `azure-blob-provider.ts` - Azure Blob Storage implementation

`src/shortcuts/sync/sync-manager.ts`
- Orchestrates sync across multiple providers
- Last-write-wins conflict resolution
- Debounced auto-sync
- Periodic sync checking
- Device ID management

### Configuration

**IMPORTANT: Sync configuration is now stored entirely in VSCode settings, not in the shortcuts.yaml file.**

Sync configuration is managed through VSCode settings (in `settings.json` or via Settings UI):

```json
{
  "workspaceShortcuts.sync.enabled": true,
  "workspaceShortcuts.sync.autoSync": true,
  "workspaceShortcuts.sync.syncInterval": 300,
  "workspaceShortcuts.sync.provider": "vscode",  // or "azure"

  // VSCode Sync Provider Settings
  "workspaceShortcuts.sync.vscode.scope": "global",  // or "workspace"

  // Azure Blob Storage Provider Settings
  "workspaceShortcuts.sync.azure.container": "shortcuts-container",
  "workspaceShortcuts.sync.azure.accountName": "mystorageaccount"
  // Note: Azure SAS token is stored securely in VSCode SecretStorage, not in settings
}
```

**Settings UI:**
- Open VSCode Settings (Ctrl+, or Cmd+,)
- Search for "Workspace Shortcuts Sync"
- Use the dropdown to select your preferred sync provider
- Configure provider-specific settings
- Azure credentials (SAS token) are prompted during configuration and stored securely

**Benefits of settings-based configuration:**
- Sync settings are separate from your shortcuts data
- Provider credentials never appear in YAML files
- Easy to configure via Settings UI with dropdowns
- Can be synced via VSCode Settings Sync independently
- Better security for sensitive information

### Sync Commands

- `shortcuts.sync.configure` - Interactive sync provider configuration wizard
- `shortcuts.sync.enable` - Enable cloud synchronization
- `shortcuts.sync.disable` - Disable cloud synchronization
- `shortcuts.sync.now` - Manually trigger immediate sync (upload and download)
- `shortcuts.sync.status` - Show sync status for all providers

### Conflict Resolution

**Last-Write-Wins Strategy:**
1. Each configuration stores metadata with timestamp and device ID
2. On load, fetches all provider configs and compares timestamps
3. Uses the configuration with the newest timestamp
4. On save, uploads to all enabled providers with current timestamp
5. Notifications inform user when cloud config is newer

### Security

**Credential Storage:**
- All cloud provider credentials stored via VSCode's SecretStorage API
- Never stored in configuration files or workspace settings
- Encrypted at rest by VSCode
- Per-workspace or global storage options

**Data Integrity:**
- Checksums calculated for all uploaded configs
- Verification on download
- Corruption detection and warnings

**Network Security:**
- All cloud communications use HTTPS
- Provider SDK handles authentication
- Retry logic with exponential backoff
- Authentication error detection

### Usage Flow

**Initial Setup:**
1. Run command `Shortcuts: Configure Cloud Sync`
2. Select one or more providers
3. Enter provider-specific configuration
4. Store credentials securely (prompted separately for security)
5. Enable sync when prompted

**Automatic Sync:**
- Configuration changes automatically trigger upload (debounced)
- On load, checks cloud for newer configuration
- Downloads and applies if cloud is newer
- Periodic background checks (configurable interval)

**Manual Sync:**
- Use `Shortcuts: Sync Now` to force immediate sync
- Useful for testing or recovering from errors
- Shows progress notification

**Status Monitoring:**
- Use `Shortcuts: Show Sync Status` to view provider status
- Shows connection status, last sync time, errors
- Indicates if cloud has newer configuration

### Integration Points

**ConfigurationManager:**
- `initializeSyncManager()` - Initialize sync on activation (reads from VSCode settings)
- `reinitializeSyncManager()` - Reinitialize when settings change
- `getSyncConfigFromSettings()` - Build SyncConfig from VSCode settings
- `loadConfiguration()` - Check cloud for updates
- `saveConfiguration()` - Trigger auto-sync on save
- `syncToCloud()` / `syncFromCloud()` - Manual sync methods
- `getSyncStatus()` - Query sync provider status

**Extension Activation:**
- Passes `ExtensionContext` to ConfigurationManager
- Initializes sync manager with context.secrets
- Registers sync commands

### Testing

**Note:** Sync tests need to be updated to work with the new settings-based configuration approach.

Sync functionality includes:
- **Unit Tests** (`src/test/suite/sync.test.ts`):
  - Provider interface tests
  - Conflict resolution tests
  - Sync configuration structure validation
  - Device ID management
  - Checksum validation
  - **TODO:** Update tests to use VSCode settings instead of config.sync

- **Integration Tests** (`src/test/suite/sync-integration.test.ts`):
  - Provider switching with real VSCode context
  - Configure and switch between VSCode and Azure providers
  - Enable both providers simultaneously
  - Test sync operations after provider switch
  - Error handling and edge cases
  - Auto-sync toggle testing
  - **TODO:** Update tests to use VSCode settings API

See [SYNC_INTEGRATION_TESTING.md](docs/SYNC_INTEGRATION_TESTING.md) for detailed testing guide (needs update).

### Troubleshooting

**Common Issues:**

1. **Credentials not configured:**
   - Run configuration wizard (`Shortcuts: Configure Cloud Sync`) again
   - Check VSCode SecretStorage has necessary permissions
   - For Azure, verify SAS token is valid and has appropriate permissions

2. **Sync not triggering:**
   - Verify `workspaceShortcuts.sync.enabled: true` in VSCode settings
   - Check `workspaceShortcuts.sync.autoSync` setting
   - Review console for errors
   - Ensure a provider is selected in `workspaceShortcuts.sync.provider`

3. **Conflicts:**
   - Last-write-wins automatically resolves
   - Check sync status to see which device last modified
   - Manual sync can force update

4. **Provider connection errors:**
   - Verify network connectivity
   - Check provider credentials validity
   - Review provider-specific permissions (Azure container access, etc.)
   - For Azure, verify account name and container name are correct in settings

5. **Settings not taking effect:**
   - After changing settings, use `Shortcuts: Enable Cloud Sync` to reinitialize
   - Or reload VSCode window to apply changes

### Future Enhancements

Potential improvements:
- Manual conflict resolution UI
- Sync history/audit log
- Configuration encryption
- Differential sync (only changed groups)
- Webhook notifications
- Additional providers (AWS S3, Google Cloud Storage, Dropbox, OneDrive)