# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the "Workspace Shortcuts" VSCode extension that provides customizable folder shortcuts and logical groups for improved workspace navigation. The extension creates a sidebar panel with two main views:

1. **Physical Folders** - Direct shortcuts to filesystem folders
2. **Logical Groups** - Custom organization of files and folders into thematic groups
3. **Unified Search** - Cross-view search functionality via webview

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
- Activates extension and registers all tree views
- Initializes configuration management with workspace root detection
- Sets up keyboard navigation handlers for both views
- Registers webview search provider and connects to tree data providers

**Tree Data Providers**
- `ShortcutsTreeDataProvider` (`src/shortcuts/tree-data-provider.ts`) - Handles physical folder shortcuts
- `LogicalTreeDataProvider` (`src/shortcuts/logical-tree-data-provider.ts`) - Manages logical groups and their contents
- Both implement VSCode's `TreeDataProvider<T>` interface and support search filtering

**Configuration Management (`src/shortcuts/configuration-manager.ts`)**
- Manages YAML configuration files (`.vscode/shortcuts.yaml`)
- Supports both workspace-specific and global configurations
- Handles file watching for live configuration updates
- Uses js-yaml for parsing/serializing configuration

**Search and Navigation**
- `InlineSearchProvider` (`src/shortcuts/inline-search-provider.ts`) - Webview-based unified search
- `KeyboardNavigationHandler` (`src/shortcuts/keyboard-navigation.ts`) - Keyboard shortcuts (Enter, Space, F2, Delete, arrows)
- Search filters both physical and logical views simultaneously

**Command System (`src/shortcuts/commands.ts`)**
- Centralized command registration and handling
- Supports folder/group operations (add, remove, rename)
- File operations (copy paths, add to groups)
- Search management commands

### Data Flow

1. **Configuration Loading**: Extension reads `.vscode/shortcuts.yaml` or creates default config
2. **Tree Population**: Tree data providers parse config and generate tree items
3. **User Interaction**: Commands modify configuration and trigger tree refresh
4. **Search Integration**: Search provider filters tree views via shared search state
5. **Persistence**: Changes are automatically saved to YAML configuration

### Key Types (`src/shortcuts/types.ts`)

```typescript
interface ShortcutConfig {
    path: string;    // Relative or absolute path
    name?: string;   // Optional display name
}

interface LogicalGroup {
    name: string;           // Group identifier
    description?: string;   // Optional description
    items: LogicalGroupItem[];  // Folder/file items
    icon?: string;         // Optional group icon
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
shortcuts:
  - path: "src"
    name: "Source Code"
  - path: "/absolute/path/to/folder"

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
```

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
- Configuration management
- Theming system
- Extension activation

Run tests with `npm test` which handles compilation and setup automatically.