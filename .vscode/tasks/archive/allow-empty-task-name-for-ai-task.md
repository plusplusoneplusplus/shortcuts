# Allow Empty Task Name for AI Task

## Description

When creating an AI task from the dialog, allow the task name to be optional. If the user does not provide a task name, the system should ask the AI to generate a meaningful name following the format `feature-name.plan.md`.

## Acceptance Criteria

- [x] Task name field in the AI task creation dialog is optional (not required)
- [x] When task name is empty, AI generates a descriptive name based on the task content/prompt
- [x] Generated names follow the format: `feature-name.plan.md` (kebab-case, suffixed with `.plan.md`)
- [x] Generated names are concise but descriptive (max 50 characters before extension)
- [x] User can still manually provide a task name if desired (existing behavior preserved)
- [x] Validation ensures generated names are valid filenames (no special characters)
- [x] Error handling for AI name generation failures (fallback to timestamp-based name)

## Subtasks

- [x] **Update dialog validation** - Remove required constraint from task name field
- [x] **Create AI name generation prompt** - Design prompt that generates appropriate file names from task description
- [x] **Implement name generation service** - Add method to call AI for name generation
- [x] **Add fallback mechanism** - Implement timestamp-based fallback if AI generation fails
- [x] **Update task creation flow** - Integrate name generation into existing creation workflow
- [x] **Add filename sanitization** - Ensure generated names are valid filesystem names
- [x] **Write unit tests** - Cover empty name, generated name, and fallback scenarios
- [ ] **Update documentation** - Document the new optional name behavior

## Technical Notes

- The AI prompt should extract key concepts from the task description to form a concise name
- Consider caching or rate limiting AI calls to prevent excessive API usage
- Generated names should be unique within the target directory (append suffix if collision)
- Format pattern: `{feature-description}.plan.md` where feature-description is 2-4 words in kebab-case

## Example

**Input (task description):**
> "Implement user authentication with OAuth2 support for Google and GitHub providers"

**Generated name:**
> `oauth2-authentication.plan.md`

## Dependencies

- AI Service (`CopilotSDKService`) for name generation
- Task Manager for file creation and validation

## Priority

Medium

## Labels

`enhancement`, `tasks-viewer`, `ai-service`
