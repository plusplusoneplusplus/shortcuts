# Workspace Shortcuts - VSCode Extension

[![Version](https://img.shields.io/visual-studio-marketplace/v/yihengtao.workspace-shortcuts.svg)](https://marketplace.visualstudio.com/items?itemName=yihengtao.workspace-shortcuts)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/yihengtao.workspace-shortcuts.svg)](https://marketplace.visualstudio.com/items?itemName=yihengtao.workspace-shortcuts)
[![Rating](https://img.shields.io/visual-studio-marketplace/r/yihengtao.workspace-shortcuts.svg)](https://marketplace.visualstudio.com/items?itemName=yihengtao.workspace-shortcuts)

Organize your workspace with customizable folder shortcuts and logical groups. Quick access to frequently used directories and files with split-view navigation.

## Features

### 📁 Physical Folders
- **Quick Access**: Add shortcuts to frequently used folders on your filesystem
- **Split View Navigation**: Open folders in a split pane or replace current view
- **Drag and Drop**: Move files and folders by dragging them to different locations
- **Context Menu Actions**: Right-click for rename, remove, and other actions
- **Keyboard Navigation**: Full keyboard support with Enter, Space, Arrow keys, F2, Delete

### 🏷️ Logical Groups
- **Custom Organization**: Create custom groups to organize shortcuts by project, type, or workflow
- **Flexible Management**: Add files and folders to groups regardless of their physical location
- **Drag and Drop**: Move files and folders by dragging them to different locations
- **Group Operations**: Create, rename, delete groups and manage their contents
- **Tree View**: Hierarchical display of groups and their items

### ⌨️ Keyboard Navigation
- **Enter**: Open item in current view
- **Space**: Open item in split view
- **F2**: Rename selected item
- **Delete**: Remove selected item
- **Ctrl+Z / Cmd+Z**: Undo last move operation
- **Arrow Keys**: Navigate and expand/collapse groups
- **Home/End**: Jump to first/last item

## Installation

1. Open VSCode
2. Go to Extensions (`Ctrl+Shift+X` / `Cmd+Shift+X`)
3. Search for "Workspace Shortcuts"
4. Click Install on the extension by yihengtao

## Usage

### Getting Started

1. After installation, you'll see the Shortcuts icon in the Activity Bar
2. Click on it to open the Shortcuts panel with two sections:
   - **Physical Folders**: Direct access to filesystem folders
   - **Logical Groups**: Custom organization of shortcuts

### Adding Physical Folder Shortcuts

1. Click the "+" button in the Physical Folders section
2. Select a folder from your filesystem
3. The folder will appear as a shortcut in the tree view
4. Click to navigate, right-click for more options

### Creating Logical Groups

1. Click the "+" button in the Logical Groups section
2. Enter a name for your group
3. Right-click on the group to add folders or files
4. Organize your shortcuts however makes sense for your workflow

### Navigation Options

- **Single Click**: Navigate to the folder/file
- **Space Bar**: Open in split view (when focused)
- **Right Click**: Access context menu for rename, remove, etc.

### Moving Files and Folders with Drag and Drop

1. **Drag**: Click and hold on any file or folder in either view
2. **Drop**: Drag it to a folder where you want to move it
3. **Confirm**: If a file with the same name exists, you'll be prompted to overwrite or skip
4. **Result**: The file/folder is moved to the new location on your filesystem
5. **Undo**: Press `Ctrl+Z` (or `Cmd+Z` on Mac) to undo the last move within 1 minute

**Note**: You can drag items between any folders in both Physical and Logical views. The drag and drop operation performs an actual file system move. Undo is available for the last move operation within 1 minute.

## Configuration

The extension stores its configuration in your workspace or global settings. You can access the configuration file through the gear icon in the Shortcuts panel.

## Requirements

- VSCode version 1.74.0 or higher
- Node.js (for development)

## Known Issues

None currently reported. Please file issues on the [GitHub repository](https://github.com/plusplusoneplusplus/shortcuts/issues).

## Release Notes

See [CHANGELOG.md](CHANGELOG.md) for detailed release notes.

### 1.0.0

Initial release with:
- Physical folder shortcuts
- Logical group organization
- Split-view navigation
- Keyboard navigation support
- Context menu actions

## Contributing

Contributions are welcome! Please see the [GitHub repository](https://github.com/plusplusoneplusplus/shortcuts) for guidelines.

## License

[MIT License](LICENSE)

---

**Enjoy organizing your workspace with Shortcuts! ⚡**