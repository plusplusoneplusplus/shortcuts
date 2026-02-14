# Create Subfolder in Feature - Task Panel Enhancement

## Overview
Add the ability to create subfolders inside existing feature folders in the Tasks Viewer panel.

## Requirements
- Right-click on any feature folder should show "Create Subfolder" option
- User enters folder name via input box
- New folder appears nested under the parent feature
- Supports arbitrary nesting depth

## Implementation
See plan at session workspace for detailed workplan.

## Acceptance Criteria
- [x] "Create Subfolder" appears in context menu for `taskFolder` items
- [x] Subfolder is created with `meta.md` file inside
- [x] Tree view refreshes and shows new folder
- [x] Validation prevents duplicate names and invalid characters
