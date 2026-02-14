# Add Task Name Field to Feature Dialog

## Description

Enhance the "create from feature" dialog to include an optional task name field. When a user specifies a task name, use it as the filename instead of auto-generating one from the feature description.

## Context

Currently, when creating tasks from the feature dialog, the filename is auto-generated based on the feature description or other default logic. Users should have the option to explicitly specify the task name/filename if they prefer a specific naming convention.

## Acceptance Criteria

- [x] Feature dialog displays a new optional "Task Name" input field
- [x] Field includes placeholder text or tooltip explaining it's used for the filename
- [x] If user provides a task name, use it as the base filename
- [x] If user leaves it empty, fall back to current auto-generation logic
- [x] Task name input should be sanitized (convert to kebab-case, remove invalid characters)
- [x] Dialog validation prevents invalid filenames (e.g., empty string, special characters)
- [x] File extension (.plan.md or appropriate) is automatically appended
- [x] UI/UX is clear and intuitive - users understand the purpose of the field

## Subtasks

### 1. Update Dialog UI
- [x] Add task name input field to the feature dialog
- [x] Position it appropriately in the dialog layout
- [x] Add label and placeholder text (e.g., "Task Name (optional)")
- [x] Add helpful tooltip or description text

### 2. Implement Filename Logic
- [x] Create utility function to sanitize task name input
- [x] Convert input to kebab-case format
- [x] Handle edge cases (spaces, special characters, etc.)
- [x] Implement fallback to auto-generation when field is empty
- [x] Ensure proper file extension is appended

### 3. Add Validation
- [x] Validate task name doesn't contain forbidden characters
- [x] Check for filename conflicts in target directory
- [x] Provide clear error messages for invalid input
- [x] Disable create button until validation passes (if applicable)

### 4. Testing
- [x] Test with various input formats (spaces, mixed case, special chars)
- [x] Test empty field behavior (should use auto-generation)
- [x] Test duplicate filename detection
- [x] Test on different operating systems (path handling)
- [x] Verify UI displays correctly in light/dark themes

## Technical Notes

- Consider using existing filename sanitization utilities if available in the codebase
- Ensure consistency with existing task naming conventions
- May need to update TypeScript interfaces for dialog input
- Check if there's an existing pattern for optional fields in other dialogs

## Files Likely Affected

- Feature dialog component/view (UI definition)
- Dialog handler/controller (logic for processing input)
- File creation utilities (filename generation/sanitization)
- Type definitions for dialog inputs

## Edge Cases to Consider

- User enters task name with file extension (should we strip/preserve it?)
- Very long task names (should we truncate?)
- Unicode characters in task name
- Task name that conflicts with existing file
- Empty string vs. undefined/null for optional field

## Related Features

- This should work consistently with other task creation methods
- Consider if this pattern should be applied to other dialogs (create note, create file, etc.)

## Implementation Summary

**Completed on:** 2026-01-30

**Changes made:**
1. **types.ts**: Added optional `name` field to `AITaskFromFeatureOptions` interface
2. **ai-task-dialog.ts**: 
   - Added Task Name input field to "From Feature" mode in the webview HTML
   - Added validation logic for task name (reuses existing `validateName` function)
   - Updated message handler to pass task name to options
   - Added event listener for input validation
3. **ai-task-commands.ts**:
   - Updated `buildCreateFromFeaturePrompt` function to accept optional name parameter
   - Updated `buildDeepModePrompt` function to accept optional name parameter
   - When name is provided, uses explicit filename path; otherwise instructs AI to generate
4. **Tests added**:
   - Type tests for optional `name` field in `AITaskFromFeatureOptions`
   - Dialog result tests with task name
   - Prompt builder tests with/without name parameter
