# Markdown Review & Workspace Shortcuts - VSCode Extension

[![Version](https://img.shields.io/visual-studio-marketplace/v/yihengtao.workspace-shortcuts.svg)](https://marketplace.visualstudio.com/items?itemName=yihengtao.workspace-shortcuts)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/yihengtao.workspace-shortcuts.svg)](https://marketplace.visualstudio.com/items?itemName=yihengtao.workspace-shortcuts)
[![Rating](https://img.shields.io/visual-studio-marketplace/r/yihengtao.workspace-shortcuts.svg)](https://marketplace.visualstudio.com/items?itemName=yihengtao.workspace-shortcuts)

Add inline comments to markdown files with a powerful review editor. Also organize your workspace with customizable shortcuts and groups.

## Features

### Markdown Review Editor

Add inline comments and annotations to any markdown file directly in VSCode.

**How to use:**
1. Right-click any `.md` file and select "Open with Markdown Review Editor"
2. Select text in the rendered markdown
3. Press `Ctrl+Shift+M` (or `Cmd+Shift+M` on Mac) to add a comment
4. View all comments in the **Markdown Comments** panel

**Features:**
- Visual highlighting of commented text
- Comment resolution workflow (open/resolved states)
- Generate AI prompts from your comments
- Comments persist across sessions
- Mermaid diagram and code syntax highlighting support

### Git Diff Review

Review git changes with inline comments:
- Open any changed file with "Open with Diff Review"
- Add comments to specific lines in the diff
- Organize comments by category (bug, suggestion, question, etc.)
- Generate prompts from comments for AI-assisted code review
- Review commits against custom coding rules

### Code Review Against Rules

Define custom coding rules and review commits or pending changes:
1. Create rule files in `.github/cr-rules/*.md`
2. Right-click a commit or use "Review Pending Changes Against Rules"
3. Get AI-powered feedback on rule violations

### Shortcut Groups

Organize files and folders into custom groups for quick access:
- Create logical groups to organize related files
- Supports nested subgroups and drag-and-drop
- Add VSCode commands and tasks to groups
- Split-view navigation with keyboard shortcuts

### Global Notes

Quick notes accessible from any workspace:
- Auto-saved markdown notes
- Available everywhere without group assignment
- Perfect for quick ideas and reminders

### Cloud Sync

Sync your configuration across devices via VSCode Settings Sync.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Ctrl+Shift+M | Add comment (in Review Editor) |
| Enter | Open item |
| Space | Open in split view |
| F2 | Rename |
| Delete | Remove |
| Ctrl+Z | Undo move |

## Quick Start

1. Click the Shortcuts icon in the Activity Bar
2. Views available: **Git**, **Global Notes**, **Groups**, **Markdown Comments**, **AI Processes**
3. Right-click any `.md` file → "Open with Markdown Review Editor"
4. Select text and press `Ctrl+Shift+M` to add comments

## Configuration

### Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `workspaceShortcuts.alwaysOpenMarkdownInReviewEditor` | `false` | Always open markdown in Review Editor |
| `workspaceShortcuts.markdownComments.panelEnabled` | `false` | Enable the Markdown Comments panel |
| `workspaceShortcuts.markdownComments.showResolved` | `true` | Show resolved comments |
| `workspaceShortcuts.markdownComments.highlightColor` | `rgba(255, 235, 59, 0.3)` | Comment highlight color |
| `workspaceShortcuts.aiService.enabled` | `false` | Enable AI features |
| `workspaceShortcuts.codeReview.rulesFolder` | `.github/cr-rules` | Code review rules folder |
| `workspaceShortcuts.sync.enabled` | `false` | Enable cloud sync |

### Shortcuts Configuration

Stored in `.vscode/shortcuts.yaml` (workspace) or `~/.vscode-shortcuts/.vscode/shortcuts.yaml` (global).

## Requirements

- VSCode 1.95.0+

## Release Notes

See [CHANGELOG.md](CHANGELOG.md) for details.

- **2.14.0**: Auto AI Discovery for enhanced documentation retrieval
- **2.12.0**: Code review with custom rules
- **2.11.0**: Git diff review with inline comments
- **2.8.0**: Markdown Review Editor with inline comments
- **2.7.0**: Global Notes and nested groups
- **2.0.0**: Unified interface with logical groups

## Links

- [GitHub Repository](https://github.com/plusplusoneplusplus/shortcuts)
- [Report Issues](https://github.com/plusplusoneplusplus/shortcuts/issues)
- [MIT License](LICENSE)
