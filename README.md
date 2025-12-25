# Workspace Shortcuts - VSCode Extension

[![Version](https://img.shields.io/visual-studio-marketplace/v/yihengtao.workspace-shortcuts.svg)](https://marketplace.visualstudio.com/items?itemName=yihengtao.workspace-shortcuts)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/yihengtao.workspace-shortcuts.svg)](https://marketplace.visualstudio.com/items?itemName=yihengtao.workspace-shortcuts)
[![Rating](https://img.shields.io/visual-studio-marketplace/r/yihengtao.workspace-shortcuts.svg)](https://marketplace.visualstudio.com/items?itemName=yihengtao.workspace-shortcuts)

Organize your workspace with customizable groups of shortcuts, global notes, and markdown review tools.

## Features

### Shortcut Groups
Create custom groups to organize files and folders. Supports nested subgroups, drag-and-drop, split-view navigation, and VSCode commands/tasks.

### Global Notes
Quick notes accessible from any workspace. Auto-saved and available everywhere.

### Markdown Review Editor
Add inline comments to markdown files. Right-click any `.md` file and select "Open with Review Editor", then select text and press `Ctrl+Shift+M` to add comments. View all comments in the Markdown Comments panel.

### Cloud Sync
Sync shortcuts across devices via VSCode Settings Sync. Automatic sync with last-write-wins conflict resolution.

### Keyboard Shortcuts
| Key | Action |
|-----|--------|
| Enter | Open item |
| Space | Open in split view |
| F2 | Rename |
| Delete | Remove |
| Ctrl+Z | Undo move |

## Quick Start

1. Click the Shortcuts icon in the Activity Bar
2. Three views available: **Global Notes**, **Groups**, **Markdown Comments**
3. Click "+" to create a group or note
4. Right-click groups to add files/folders or create subgroups

## Configuration

Shortcuts are stored in `.vscode/shortcuts.yaml` (workspace) or `~/.vscode-shortcuts/.vscode/shortcuts.yaml` (global).

### Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `workspaceShortcuts.alwaysOpenMarkdownInReviewEditor` | `false` | Always open markdown in Review Editor View |
| `workspaceShortcuts.sync.enabled` | `false` | Enable cloud sync |
| `workspaceShortcuts.sync.provider` | `"vscode"` | Sync provider (VSCode Settings Sync) |
| `workspaceShortcuts.sync.autoSync` | `true` | Auto-sync on changes |
| `workspaceShortcuts.markdownComments.showResolved` | `true` | Show resolved comments |

## Requirements

- VSCode 1.95.0+

## Platform Notes

Windows: Use "Add Files to Group" or "Add Folders to Group" separately (native dialog limitation).

## Release Notes

See [CHANGELOG.md](CHANGELOG.md) for details.

- **2.8.0**: Markdown Review Editor with inline comments
- **2.7.0**: Global Notes and nested groups
- **2.0.0**: Unified interface with logical groups

## Links

- [GitHub Repository](https://github.com/plusplusoneplusplus/shortcuts)
- [Report Issues](https://github.com/plusplusoneplusplus/shortcuts/issues)
- [MIT License](LICENSE)
