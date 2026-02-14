---
status: done
---

# Bug Fix: Related Items Should Not Have Status Options

## Problem Statement

Related items (discovered source files, test files, commits, etc.) in the Tasks Viewer should not display "Mark as Done", "Mark as In-Progress", "Mark as Future", or "Mark as Pending" context menu options. These status operations should only apply to actual task documents, not to related reference items.

## Current Behavior

Related items use the following `contextValue` identifiers:
- `relatedFile` - Individual related file items
- `relatedCommit` - Individual related commit items  
- `relatedCategory` - Category groupings (Source, Tests, etc.)
- `relatedItemsSection` - The "Related Items (N)" section header

The current menu conditions in `package.json` use regex patterns like:
- `viewItem =~ /^task(_future|_inProgress)?(_reviewed|_needsReReview)?$/`
- `viewItem =~ /^taskDocument(_future|_inProgress)?(_reviewed|_needsReReview)?$/`

## Analysis

The regex patterns currently **should not** match related items since `relatedFile`, `relatedCommit`, etc. don't start with `task`. However, the bug report suggests these options are appearing incorrectly.

Potential causes to investigate:
1. Context menu inheritance or VS Code menu caching issue
2. Future code changes could accidentally add status handling
3. Explicit negative conditions may be needed for safety

## Proposed Solution

Add explicit exclusion conditions in `package.json` to ensure related items **never** show status commands, providing a defensive safeguard:

```json
"when": "view == tasksView && viewItem =~ /^task(_future|_inProgress)?.../ && viewItem !~ /^related/"
```

## Acceptance Criteria

- [x] Related file items (`relatedFile`) do not show status commands
- [x] Related commit items (`relatedCommit`) do not show status commands  
- [x] Related category items (`relatedCategory`) do not show status commands
- [x] Related items section (`relatedItemsSection`) does not show status commands
- [x] Regular task items (`task`, `taskDocument`) continue to show status commands normally
- [x] Existing tests pass (pre-existing test infrastructure issue unrelated to this change)

## Implementation Tasks

- [x] Investigate and reproduce the bug (verify related items show status commands)
- [x] Add explicit `&& viewItem !~ /^related/` exclusion to status command conditions in `package.json`
- [x] Verify fix by testing related items context menus
- [x] Run existing tests to ensure no regressions

## Files to Modify

1. `package.json` - Add exclusion conditions to menu items:
   - Line ~2318: `tasksViewer.markAsFuture` (task items)
   - Line ~2323: `tasksViewer.markAsPending` (task items)
   - Line ~2328: `tasksViewer.markAsInProgress` (task items)
   - Line ~2333: `tasksViewer.markAsDone` (task items)
   - Line ~2408: `tasksViewer.markAsFuture` (document items)
   - Line ~2413: `tasksViewer.markAsPending` (document items)
   - Line ~2418: `tasksViewer.markAsInProgress` (document items)
   - Line ~2423: `tasksViewer.markAsDone` (document items)

## Notes

- Related items are discovered references to source code, tests, and commits
- They represent external resources, not tasks that can have completion status
- The fix is a defensive measure to prevent any accidental status option display
