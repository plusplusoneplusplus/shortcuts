# AI Action: Refresh Plan Feature

## Description

Add a "Refresh Plan" action to the AI action menu that allows users to ask AI to rewrite/regenerate an existing plan based on the latest codebase state and data. This feature should be similar to the existing "Update" action, with an optional input popup for users to provide additional context or background information.

## Acceptance Criteria

- [x] Add "Refresh Plan" option to the AI action menu/context menu
- [x] When triggered, display an optional input dialog for user to provide additional background/context
- [x] Send request to AI with:
  - The current plan content
  - Latest relevant codebase context
  - User-provided additional background (if any)
- [x] AI should analyze the current state and rewrite the plan accordingly
- [x] Replace/update the existing plan with the refreshed version
- [x] Handle loading states and error scenarios gracefully
- [x] Maintain consistency with existing "Update" action UX patterns

## Subtasks

### 1. UI Implementation
- [x] Add "Refresh Plan" menu item to AI action context menu
- [x] Implement optional input dialog (similar to Update action)
- [x] Add appropriate icon for the action

### 2. Backend/Service Implementation
- [x] Create prompt template for plan refresh operation
- [x] Implement service method to gather current codebase context
- [x] Handle AI response and plan replacement logic

### 3. Integration
- [x] Wire up command registration in `commands.ts`
- [x] Connect UI action to service layer
- [x] Add progress indicator during AI processing

### 4. Testing
- [x] Add unit tests for the refresh plan functionality
- [x] Test with various plan formats and sizes
- [x] Verify optional input handling (with and without user input)

## Notes

- Reference the existing "Update" action implementation for UX consistency
- Consider whether to preserve any user-added sections/comments during refresh
- The refresh should be intelligent about what changed in the codebase vs. what's still relevant
- May want to show a diff or preview before applying changes (future enhancement)
