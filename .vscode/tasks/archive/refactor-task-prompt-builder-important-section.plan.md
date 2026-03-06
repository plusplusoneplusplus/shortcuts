# Refactor: Extract Common IMPORTANT Section in task-prompt-builder.ts

## Problem

`packages/pipeline-core/src/tasks/task-prompt-builder.ts` contains three prompt-building functions that each independently inline a variant of an **IMPORTANT** block:

| Function | IMPORTANT header | Filename instruction | Extra lines |
|---|---|---|---|
| `buildCreateTaskPrompt` | `**IMPORTANT:**` (numbered list) | "Create a single .plan.md file" | "You MUST NOT implement..." |
| `buildCreateTaskPromptWithName` | `**IMPORTANT: Output Location Requirement**` | exact path or auto-name hint | — |
| `buildCreateFromFeaturePrompt` | `**IMPORTANT: Output Location Requirement**` | `filenameInstruction` variable | — |

All share the same core lines:
```
You MUST save the file to this EXACT directory: {targetPath}
- Do NOT save to any other location
- Do NOT use your session state or any other directory
```

Duplicating this text makes it hard to keep the wording consistent and to add new standard lines in one place.

## Proposed Approach

Extract a private helper `buildImportantSection` that owns the canonical wording (modelled after `buildCreateTaskPrompt`), then rewrite each public function to call it.

### Helper signature

```ts
/**
 * Returns the IMPORTANT block shared by all task-prompt functions.
 *
 * @param targetPath     - Forward-slash path already normalised by caller.
 * @param filenameLines  - Zero or more bullet lines describing the expected filename.
 * @param extraLines     - Additional numbered items appended after the location block.
 */
function buildImportantSection(
    targetPath: string,
    filenameLines: string[],
    extraLines?: string[]
): string
```

Canonical output (mirrors `buildCreateTaskPrompt`):

```
**IMPORTANT:**
1. You MUST save the file to this EXACT directory: {targetPath}
{filenameLines joined with newline}
- Do NOT save to any other location
- Do NOT use your session state or any other directory
{extraLines as numbered items, starting at 2}
```

### Per-function changes

#### `buildCreateTaskPrompt`
- Call `buildImportantSection(targetPath, ['- Create a single .plan.md file'], ['You MUST NOT implement the task, you are only responsible for creating the plan file.'])`.

#### `buildCreateTaskPromptWithName`
- Build `filenameLines` from the existing `name`/no-name branches (same text, just moved).
- Call `buildImportantSection(targetPath, filenameLines)`.

#### `buildCreateFromFeaturePrompt`
- Build `filenameLines` from the existing `filenameInstruction` variable (same text, split into array).
- Call `buildImportantSection(targetPath, filenameLines)`.

#### `buildDeepModePrompt`
- No change — it delegates to `buildCreateFromFeaturePrompt` and only prepends a skill line.

## Files to Change

- `packages/pipeline-core/src/tasks/task-prompt-builder.ts` — only file modified.

## Testing

- Existing tests in `packages/pipeline-core/` (run with `npm run test:run`) must continue to pass.
- If snapshot/string-equality tests exist for these prompts, update expected strings to match the new unified wording (the actual user-visible text must not change).
- Add unit tests that assert each public function still contains:
  - `You MUST save the file to this EXACT directory:`
  - `Do NOT save to any other location`
  - `Do NOT use your session state or any other directory`

## Out of Scope

- No changes to callers outside this file.
- No behaviour or wording changes visible to end users / AI agents.
- No changes to other pipeline-core modules.
