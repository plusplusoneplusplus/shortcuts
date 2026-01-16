# Change Log

All notable changes to the "Shortcuts" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- Markdown Comments panel is now hidden by default. Enable with `workspaceShortcuts.markdownComments.panelEnabled` setting.

## [3.0.0] - 2026-01-11

### Added
- YAML Pipeline Framework for map-reduce style AI workflows

### Changed
- Multiple improvements and bug fixes

## [2.16.5] - 2026-01-07

### Fixed
- Bug fixes

## [2.16.2] - 2026-01-04

### Added
- Tasks viewer now supports grouping (Active/Archived sections) with drag-and-drop reordering

### Changed
- Markdown comments editor improved indentation handling and save behavior
- Discovery process now handles existing group snapshots for better conflict resolution

## [2.16.1] - 2026-01-04

### Added
- AI-powered discovery engine to find related docs, files, and commits for features
- Discovery preview panel with target group selection and warning messages
- Code block theme customization for Markdown Review Editor (`workspaceShortcuts.markdownComments.codeBlockTheme`)
- Commit items in groups now show file diffs with expand/collapse support
- "View Discovery Results" command for completed discovery processes

### Changed
- AI process management now handles raw stdout with read-only document provider

## [2.16.0] - 2026-01-03

### Added
- Toggle setting for Global Notes panel visibility (`workspaceShortcuts.globalNotes.enabled`)
- Multi-line comments now show full first 2 lines in source preview

### Fixed
- Tasks now open in Markdown Review Editor instead of plain text editor
- Windows filename validation now checks filename only, not full path

## [2.15.0] - 2025-12-31

### Added
- **Tasks Viewer**: New panel for managing markdown task files in `.vscode/tasks/`
  - Create, rename, delete, and archive tasks
  - Filter by name, sort by name or modified date
  - Auto-refresh on file changes
- **Language Model Tool**: Resolve comments via Copilot Chat using `@resolveComments`

### Fixed
- Source mode now properly escapes HTML for consistent empty line handling
- Keyword extraction preserves casing and improves word splitting

## [2.14.1] - 2025-12-29

### Changed
- Renamed extension to "Markdown Review & Workspace Shortcuts" to better reflect core functionality
- Updated description and keywords to highlight markdown review capabilities

## [2.14.0] - 2025-12-28

### Added
- **Auto AI Discovery**: Find related docs, files, and commits for a feature with relevance scoring
- **Code Review Feature**: Review code against customizable rules with structured results viewer
- **Drag-and-Drop in Git View**: Reorder and organize items in the Git tree view

### Changed
- **AI Process Persistence**: Processes now persist across VSCode restarts with detailed view support

## [2.13.0] - 2025-12-25

### Added
- **Configurable AI Commands**: Define custom AI actions with personalized prompts via settings
- **Git Staging Commands**: Stage/unstage individual files or all changes directly from Git view
- **Visual Stage Sections**: Staged and unstaged changes displayed in separate sections

### Changed
- **Enhanced Comment Bubbles**: Improved drag, resize, and interaction behavior for diff comments
- **Consolidated AI Handling**: Unified AI clarification handlers across markdown and diff views
- **Shared Components**: Refactored common webview and anchor utilities for better maintainability

### Removed
- Azure Blob Storage sync provider (simplified to VSCode Settings Sync only)

## [2.12.1] - 2025-12-23

### Fixed
- **Cross-Platform Shell Escaping**: Improved Copilot CLI argument escaping for Windows compatibility

## [2.12.0] - 2025-12-23

### Added
- **Editable Diff View**: Edit uncommitted changes directly in the diff review editor
- **Dirty State Indicator**: Visual (•) indicator in title when diff has unsaved changes
- **Ask AI in Diff View**: AI clarification features (clarify, go deeper, custom) for diff content
- **Whitespace Toggle**: Show/hide whitespace changes in diff view
- **Review/Source Mode Toggle**: Switch between formatted review and raw source views
- **Diff Refresh**: Manual refresh button to reload diff content

## [2.11.0] - 2025-12-21

### Added
- **Context Menu for Git Diff Comments**: Select text in diff view and right-click to add comments directly

### Fixed
- **Windows Compatibility**: Git commands now work correctly on Windows by avoiding caret notation

## [2.10.1] - 2025-12-21

### Fixed
- **Windows CRLF Support**: Diff view now correctly handles CRLF line endings on Windows, showing only actual content changes instead of entire file as modified

## [2.10.0] - 2025-12-21

### Added
- **Git Diff Comments**: New feature for inline commenting on git diff views
  - Add comments to specific diff lines with category-based grouping (issues, suggestions, questions)
  - Context menu commands for comment management (copy prompt, resolve all, delete all)
  - Cleanup command for removing obsolete comments
  - Draggable comment panels with scroll-to-comment functionality
- **Commit Lookup**: Search and display specific commits by hash in Git view
- **Diff Indicator Bar**: Visual indicators showing change density in diff views

### Changed
- Unified Git view combining changes and commits in one panel
- Enhanced diff webview with file path interactions and syntax highlighting
- Shared webview utilities for consistent panel behavior

## [2.9.2] - 2025-12-18

### Changed
- Mermaid diagrams now render responsively with better space utilization
- Line numbers for large code blocks (>20 lines) are truncated to prevent overflow

## [2.9.1] - 2025-12-18

### Fixed
- Mermaid diagrams now scale to 80% width for better fit in review editor

## [2.9.0] - 2025-12-18

### Added
- **AI Comment Types**: Support for different AI comment types (clarification, suggestion, question) with distinct colors
- **Ask AI Submenu**: Multiple AI instruction types for context-aware clarification requests
- **AI Processes Panel**: Sidebar panel to track ongoing AI clarification processes
- **Markdown in Comment Bubbles**: Rich markdown rendering within comment popup bubbles
- **Smart Bubble Positioning**: Auto-adjust comment bubble position and width based on content

### Changed
- AI comments now excluded from copy prompt to keep prompts clean
- Increased Copilot CLI timeout to 20 minutes for longer operations
- Enhanced AI model configuration and command building options

## [2.8.6] - 2025-12-14

### Fixed
- Handle Windows CRLF line endings in markdown renderer
- Fix heading display issues in review editor

### Changed
- Update README to reflect current project features (Global Notes, Markdown Review Editor, nested groups)
- Condense README documentation for better readability

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