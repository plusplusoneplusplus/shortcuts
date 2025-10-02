# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
}

interface LogicalGroup {
    name: string;           // Group identifier
    description?: string;   // Optional description
    items: LogicalGroupItem[];  // Folder/file items
    icon?: string;         // Optional group icon
}

interface LogicalGroupItem {
    path: string;      // Relative, absolute, or alias path (e.g., @myrepo/src)
    name: string;      // Display name
    type: 'folder' | 'file';  // Item type
}

interface ShortcutsConfig {
    basePaths?: BasePath[];         // Optional base path aliases
    logicalGroups: LogicalGroup[];  // All groups
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
  - alias: "@backend"
    path: "/path/to/backend/repo"
  - alias: "@shared"
    path: "../shared-libs"

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

Use base path aliases in your item paths like: `@frontend/src/components/Button.tsx`

**Benefits of Base Paths:**
- Work with multiple git repositories in a single shortcuts configuration
- Use meaningful aliases instead of long absolute paths
- Easily relocate projects by updating just the base path
- Share configurations across team members with different directory structures

**Note**: Old configurations with a `shortcuts` array are automatically migrated to `logicalGroups` format on first load.

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