# Change Log

All notable changes to the "Shortcuts" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Drag and Drop Support**: Move files and folders by dragging them to different locations
  - Works in both Physical Folders and Logical Groups views
  - Supports dragging files and folders to any folder
  - Prompts for confirmation when overwriting existing files
  - Prevents moving folders into themselves
  - Uses VS Code's file system API for safe operations
- **Undo Last Move**: Press Ctrl+Z (Cmd+Z on Mac) to undo the last drag-and-drop move
  - Works in both Physical and Logical views
  - Available for 1 minute after the move operation
  - Safely restores files to their original location
  - Shows helpful notifications with undo hints

## [1.0.1] - 2025-09-25

### Changed
- Convert extension icon from SVG to PNG format for better marketplace compatibility
- Update package.json to reference PNG icon instead of SVG

## [1.0.0] - 2025-09-24

### Added
- Initial release of Shortcuts extension
- **Physical Folders** view for direct filesystem folder access
  - Add folder shortcuts from anywhere on your filesystem
  - Split-view navigation support
  - Context menu actions (rename, remove)
  - Full keyboard navigation support
- **Logical Groups** view for custom organization
  - Create custom groups to organize shortcuts
  - Add files and folders to groups regardless of physical location
  - Group management (create, rename, delete)
  - Tree view with expandable groups
- **Keyboard Navigation** throughout the extension
  - Enter: Open item in current view
  - Space: Open item in split view
  - F2: Rename selected item
  - Delete: Remove selected item
  - Arrow keys: Navigate and expand/collapse
  - Home/End: Jump to first/last item
- **Configuration Management**
  - Persistent storage of shortcuts and groups
  - Workspace and global configuration support
  - Configuration file access through UI
- **Activity Bar Integration**
  - Dedicated Shortcuts icon in Activity Bar
  - Split-panel view with Physical and Logical sections
  - Welcome views with quick action buttons
- **Context Menus** for all operations
  - Right-click actions on all items
  - Contextual commands based on item type
  - Integration with VSCode command palette

### Features Overview
- Organize workspace with customizable folder shortcuts
- Create logical groups for project-based organization
- Split-view navigation for efficient workflow
- Complete keyboard accessibility
- Persistent configuration across sessions
- Seamless integration with VSCode interface

---

## Template for Future Releases

```markdown
## [X.Y.Z] - YYYY-MM-DD

### Added
- New features

### Changed
- Changes in existing functionality

### Deprecated
- Soon-to-be removed features

### Removed
- Removed features

### Fixed
- Bug fixes

### Security
- Security improvements
```