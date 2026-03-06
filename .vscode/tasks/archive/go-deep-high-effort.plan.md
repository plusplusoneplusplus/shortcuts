# Fix: High effort "Generate Task" should instruct AI to use go-deep skill

## Problem

When the user selects **High** effort in the Generate Task dialog (which says "Opus-class model, deep analysis"), the generated prompt does NOT include the `go-deep` skill instruction unless the "Include folder context" checkbox is also checked.

### Root Cause

The go-deep instruction (`"Use go-deep skill when available.\n\n..."`) is only injected via `buildDeepModePrompt()`, which is exclusively called when `mode === 'from-feature'`. The `mode` is only set to `'from-feature'` when the "Include folder context" checkbox is checked.

**Affected code paths:**

| Flow | File | Issue |
|------|------|-------|
| CoC SPA executor | `packages/coc/src/server/queue-executor-bridge.ts` L1128–1145 | `depth` is only checked inside `if (payload.mode === 'from-feature')` block; the else branches (`buildCreateTaskPromptWithName`, `buildCreateTaskPrompt`) ignore `depth` entirely |
| VS Code extension | `src/shortcuts/tasks-viewer/ai-task-commands.ts` L289–315 | `depth` only exists on `fromFeatureOptions`; the `createOptions` path has no depth field at all |
| VS Code dialog | `src/shortcuts/tasks-viewer/ai-task-dialog.ts` L174–191 | `depth` is only placed in `fromFeatureOptions`, never in `createOptions` |

## Proposed Fix

### Approach: Apply go-deep instruction as a post-step on any prompt when depth='deep'

Rather than coupling go-deep to `buildDeepModePrompt()` (which requires feature context), apply the go-deep prefix after any prompt builder when `depth === 'deep'`.

### Changes

#### 1. `packages/pipeline-core/src/tasks/task-prompt-builder.ts`
- Export a new helper: `applyDeepModePrefix(prompt: string): string` that prepends `"Use go-deep skill when available.\n\n"` to any prompt.
- Refactor `buildDeepModePrompt()` to use it (optional cleanup).

#### 2. `packages/coc/src/server/queue-executor-bridge.ts` (L1127–1145)
- After the if/else chain that builds `aiPrompt`, add:
  ```typescript
  if (payload.depth === 'deep') {
      aiPrompt = applyDeepModePrefix(aiPrompt);
  }
  ```
- This ensures go-deep is applied regardless of mode.

#### 3. `src/shortcuts/tasks-viewer/ai-task-commands.ts` (L289–315)
- Pass `depth` through `createOptions` as well.
- After the if/else chain that builds `prompt`, add the same depth check.

#### 4. `src/shortcuts/tasks-viewer/ai-task-dialog.ts` (L174–191)
- Include `depth` in `createOptions` so the VS Code "create" mode path also receives depth.

#### 5. Types update
- Add `depth?: 'deep' | 'normal'` to `CreateTaskOptions` interface (wherever it's defined).

### Tests to add/update
- Unit test for `applyDeepModePrefix()` in pipeline-core.
- Unit test in queue-executor-bridge verifying go-deep prefix is applied when `depth='deep'` and mode is NOT `'from-feature'`.
- Verify existing tests still pass (no regression for from-feature + deep path).

## Notes
- The fix is backward-compatible: the `from-feature` + `deep` path will still work (it may get a double prefix which should be deduped or the old `buildDeepModePrompt` wrapper removed in favor of the post-step approach).
- The VS Code extension dialog has a different UI (Simple/Deep radio) but the same underlying issue if depth is passed without `from-feature` mode.
