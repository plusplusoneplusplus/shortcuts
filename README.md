# Workspace Shortcuts - VSCode Extension

[![Version](https://img.shields.io/visual-studio-marketplace/v/yihengtao.workspace-shortcuts.svg)](https://marketplace.visualstudio.com/items?itemName=yihengtao.workspace-shortcuts)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/yihengtao.workspace-shortcuts.svg)](https://marketplace.visualstudio.com/items?itemName=yihengtao.workspace-shortcuts)
[![Rating](https://img.shields.io/visual-studio-marketplace/r/yihengtao.workspace-shortcuts.svg)](https://marketplace.visualstudio.com/items?itemName=yihengtao.workspace-shortcuts)

Organize your workspace with customizable groups of shortcuts. Quick access to frequently used directories and files with intuitive organization and split-view navigation.

## Features

### 📁 Shortcut Groups
- **Custom Organization**: Create custom groups to organize files and folders by project, type, or workflow
- **Flexible Management**: Add any files and folders to groups, organizing them however makes sense for you
- **Quick Access**: Instant access to frequently used locations from a single, unified view
- **Auto-Refresh**: Automatically refreshes tree view when files/folders in watched directories change
- **Split View Navigation**: Open files and folders in a split pane or replace current view
- **Drag and Drop**: Move files and folders by dragging them to different locations
- **Group Operations**: Create, rename, delete groups and manage their contents
- **Tree View**: Hierarchical display of groups and their items
- **Context Menu Actions**: Right-click for quick actions on groups and items

### ☁️ Cloud Sync (New!)
- **Multi-Device Sync**: Keep your shortcuts synchronized across all your devices
- **Multiple Providers**: Choose from VSCode Settings Sync or Azure Blob Storage
- **Automatic Sync**: Changes automatically sync to cloud (configurable)
- **Conflict Resolution**: Last-write-wins strategy ensures consistency
- **Secure Storage**: Credentials encrypted via VSCode's SecretStorage API
- **Manual Control**: Trigger sync manually or configure automatic intervals

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
2. Click on it to open the Shortcuts panel
3. Create groups to organize your files and folders

### Creating Groups

1. Click the "+" button in the Shortcuts panel
2. Enter a name for your group (and optional description)
3. Right-click on the group to add folders or files
4. Organize your shortcuts however makes sense for your workflow

### Adding Files and Folders to Groups

1. Right-click on any group
2. Select "Add to Group" 
3. Choose files and/or folders to add (multi-select supported)
4. Your items will appear in the group for quick access

### Navigation Options

- **Single Click**: Navigate to the folder/file
- **Space Bar**: Open in split view (when focused)
- **Right Click**: Access context menu for rename, remove, etc.

### Moving Files and Folders with Drag and Drop

1. **Drag**: Click and hold on any file or folder
2. **Drop**: Drag it to a folder where you want to move it
3. **Confirm**: If a file with the same name exists, you'll be prompted to overwrite or skip
4. **Result**: The file/folder is moved to the new location on your filesystem
5. **Undo**: Press `Ctrl+Z` (or `Cmd+Z` on Mac) to undo the last move within 1 minute

**Note**: Drag and drop performs an actual file system move. Undo is available for the last move operation within 1 minute.

### Setting Up Cloud Sync

1. **Configure Sync Provider**:
   - Open Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
   - Run "Shortcuts: Configure Cloud Sync"
   - Select one or more providers (VSCode Sync or Azure)

2. **Provider-Specific Setup**:

   **VSCode Settings Sync** (Easiest):
   - Choose scope (Global or Workspace)
   - Automatically syncs with your Microsoft/GitHub account
   - No additional credentials needed

   **Azure Blob Storage**:
   - Enter container name and storage account name
   - Provide connection string or SAS token
   - Ensure container exists or has create permissions

3. **Enable Sync**:
   - Run "Shortcuts: Enable Cloud Sync" or enable during configuration
   - Your configuration will automatically sync on changes

4. **Monitor Sync**:
   - Use "Shortcuts: Show Sync Status" to check sync status
   - Use "Shortcuts: Sync Now" to manually trigger sync
   - Toolbar buttons visible when sync is enabled

### Sync Behavior

- **Automatic Sync**: Configuration changes are automatically uploaded (debounced by 2 seconds)
- **Conflict Resolution**: Last-write-wins - the newest configuration is always used
- **Multi-Provider**: Can sync to multiple providers simultaneously
- **Device Tracking**: Each device has a unique ID for tracking changes
- **Periodic Check**: Optional background checks for cloud updates (configurable interval)

## Configuration

### YAML Configuration File

The extension stores its shortcuts configuration in a YAML file (`.vscode/shortcuts.yaml` for workspace or `~/.vscode-shortcuts/.vscode/shortcuts.yaml` for global). You can access the configuration file through the gear icon in the Shortcuts panel.

### VS Code Settings

The extension provides the following VS Code settings (accessible via Settings UI or `settings.json`):

- **`workspaceShortcuts.openMarkdownInPreview`** (default: `false`): When enabled, Markdown (.md) files will automatically open in preview mode instead of edit mode when created or opened from shortcuts.

#### Cloud Sync Settings

- **`workspaceShortcuts.sync.enabled`** (default: `false`): Enable cloud synchronization of shortcuts configuration
- **`workspaceShortcuts.sync.autoSync`** (default: `true`): Automatically sync configuration changes to cloud
- **`workspaceShortcuts.sync.providers`** (default: `["vscode"]`): Enabled sync providers (options: "vscode", "azure")
- **`workspaceShortcuts.sync.syncInterval`** (default: `300`): Periodic sync interval in seconds (0 to disable)

## Requirements

- VSCode version 1.74.0 or higher
- Node.js (for development)

## Platform Notes

- Windows: Due to OS limitations in native file dialogs, selecting both files and folders simultaneously in a single dialog is not supported. On Windows, right‑click a group and use "Add Files to Group" or "Add Folders to Group". On macOS/Linux, the single "Add to Group" entry allows selecting both in one dialog.

If you encounter any issues, please file them on the [GitHub repository](https://github.com/plusplusoneplusplus/shortcuts/issues).

## Release Notes

See [CHANGELOG.md](CHANGELOG.md) for detailed release notes.

### 2.0.0

Major update:
- **Simplified Interface**: Unified view with logical groups only
- **Automatic Migration**: Old physical shortcuts automatically converted to groups
- **Same Flexibility**: All previous features maintained with cleaner UX
- Group-based organization for all shortcuts
- Split-view navigation
- Keyboard navigation support
- Context menu actions

## Contributing

Contributions are welcome! Please see the [GitHub repository](https://github.com/plusplusoneplusplus/shortcuts) for guidelines.

## License

[MIT License](LICENSE)

---

**Enjoy organizing your workspace with Shortcuts! ⚡**
