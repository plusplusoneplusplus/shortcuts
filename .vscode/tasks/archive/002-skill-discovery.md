---
status: done
---

# Skill and Prompt File Discovery

**No new code needed** — discovery utilities already exist and can be reused directly.

## Existing Utilities

### Prompt Files
- **File:** `src/shortcuts/shared/prompt-files-utils.ts`
- **Function:** `getPromptFiles(workspaceRoot?, configOverride?): Promise<PromptFile[]>`
- Returns `{ absolutePath, relativePath, name, sourceFolder }[]`
- Reads locations from VS Code setting `chat.promptFilesLocations`, defaults to `.github/prompts`
- Also: `getPromptFileNames()`, `getPromptFilePaths()`

### Skills
- **File:** `src/shortcuts/shared/skill-files-utils.ts`
- **Function:** `getSkills(workspaceRoot?): Promise<Skill[]>`
- Returns `{ absolutePath, relativePath, name, sourceFolder }[]`
- Fixed location: `.github/skills/` (each subdirectory = one skill)
- Also: `getSkillNames()`, `getSkillPaths()`

### Combined Discovery (Reference Pattern)
- **File:** `src/shortcuts/markdown-comments/review-editor-view-provider.ts`
- **Function:** `handleRequestPromptFiles()` (line ~1476)
- Calls both `getPromptFiles()` + `getSkills()`, builds unified list with descriptions and recent items

## Usage in Queue Dialog

The `QueueJobDialogService` should call `getPromptFiles()` and `getSkills()` to populate the Skill tab dropdown, following the same pattern as `handleRequestPromptFiles()`.
