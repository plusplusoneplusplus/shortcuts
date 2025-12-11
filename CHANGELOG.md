# Change Log

All notable changes to the "Shortcuts" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.8.0] - 2025-12-11

### Added
- **Markdown Review Editor**: New custom editor for reviewing and annotating Markdown files
  - Open any `.md` file with "Open with Review Editor" from context menu
  - Select text and press `Ctrl+Shift+M` (or `Cmd+Shift+M` on Mac) to add inline comments
  - Visual highlighting for commented sections with configurable colors
  - Comment bubbles appear on click for easy viewing
  - Resolve/reopen comments to track review progress
  - Generate AI prompts from comments for workflow integration
- **Markdown Comments Panel**: New sidebar view to manage all comments
  - View all comments organized by file
  - Navigate directly to comment locations
  - Bulk resolve comments per file
  - Toggle visibility of resolved comments
  - Refresh and configuration options
- **Rich Markdown Rendering**: Enhanced markdown preview in review editor
  - Syntax highlighting for code blocks
  - Mermaid diagram support for flowcharts and diagrams
  - Proper table rendering with 0-based and 1-based indexing compatibility
  - Image handling improvements
- **Comment Configuration**: Customizable comment appearance
  - `workspaceShortcuts.markdownComments.showResolved`: Toggle resolved comment visibility
  - `workspaceShortcuts.markdownComments.highlightColor`: Customize open comment highlight color
  - `workspaceShortcuts.markdownComments.resolvedHighlightColor`: Customize resolved comment highlight color

## [2.7.5] - 2025-10-17

### Fixed
- Fixed drag-drop regression where files were being copied instead of moved when dragging between physical folders
  - Issue was introduced in commit ef186a5 when additional MIME types were added to dragMimeTypes
  - Internal drags now correctly trigger physical file moves instead of external file copies
  - Updated handleDrop() to prioritize internal data over text/uri-list

### Added
- Comprehensive drag-drop behavior documentation (docs/DRAG_DROP_BEHAVIOR.md)
  - Documents all 7 drag-drop scenarios with detailed examples
  - Includes decision logic flowcharts and edge case warnings
  - Covers both physical file moves and logical configuration changes
- 6 new test cases achieving 100% coverage for all drag-drop scenarios
  - Scenario 1: File movement between folders in same logical group
  - Scenario 2: File movement between folders in different logical groups
  - Scenario 3a: LogicalGroupChildItem to physical folder (stale config warning)
  - Scenario 3b: Physical folder contents to logical subgroup (config-only add)
  - Scenario 5: Moving items between sibling subgroups
  - Scenario 7: Moving notes between groups

## [2.7.3] - 2025-10-15

### Fixed
- Fixed issue where notes would show errors when VSCode restarts with open note editors
  - Added `noteExists()` method to properly verify note existence in configuration
  - File system provider now throws proper `FileNotFound` errors for deleted notes
  - VSCode now handles missing notes gracefully instead of showing confusing errors

### Removed
- Removed search functionality entirely from the extension
  - Removed search webview panel
  - Removed all search-related commands and UI elements
- Removed "Show Active Configuration Source" button from toolbar
  - Configuration source is still visible in the tree view description

### Added
- Comprehensive test suite for note reopening after VSCode restart
  - 8 new tests covering note existence verification, restart scenarios, and error handling
  - Tests simulate VSCode restart by disposing and recreating file system providers

## [1.3.5] - 2025-09-29

### Fixed
- Fixed logical group items not appearing after enabling multi-selection
- Simplified group and item name display for better reliability

### Added
- Display common path prefix in logical group descriptions (with • separator)
- Show relative paths from common prefix in item descriptions
- Show parent directory for single-item groups

## [1.3.2] - 2025-09-29

### Added
- Multi-selection support for batch operations in both Physical and Logical views
  - Select multiple items using Ctrl/Cmd+Click or Shift+Click
  - Batch remove shortcuts from Physical Folders view
  - Batch remove items from logical groups
  - Batch delete logical groups
  - Batch copy paths (joined with newlines)
  - Batch add files and folders to logical groups
  - Smart confirmation messages for batch operations with item counts

## [1.3.1] - 2025-09-29

### Fixed
- Automatically refresh both Physical and Logical views after drag-drop move operations
- Automatically refresh both views after undo operations

## [1.3.0] - 2025-09-29

### Added
- **Drag and Drop Support**: Move files and folders by dragging them to different locations
  - Works in both Physical Folders and Logical Groups views
  - Supports dragging files and folders to any folder
  - Prompts for confirmation when overwriting existing files
  - Prevents moving folders into themselves
  - Uses VS Code's file system API for safe operations
  - Automatically refreshes both views after move operations
- **Undo Last Move**: Press Ctrl+Z (Cmd+Z on Mac) to undo the last drag-and-drop move
  - Works in both Physical and Logical views
  - Available for 1 minute after the move operation
  - Safely restores files to their original location
  - Shows helpful notifications with undo hints
  - Automatically refreshes both views after undo operations

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