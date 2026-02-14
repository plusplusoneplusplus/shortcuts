# Display Empty Folders in Task Panel

## Overview
Currently, the Tasks Viewer only shows folders that contain markdown files. Empty folders should also be displayed to allow users to organize their tasks into folders before adding content.

## Requirements
- Display folders even if they have no markdown files or subfolders with files
- Maintain consistent sorting behavior for empty folders
- Support nested empty folders

## Implementation Notes
- The `TaskManager.getTaskFolderHierarchy()` method builds folder structure from documents only
- Need to also scan directories directly to discover empty folders
- The `TaskFolderItem` already supports displaying folders
