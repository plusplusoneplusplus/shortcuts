# Plan: Change all gpt-5.2 references to gpt-5.4

## Problem
All references to the model ID `gpt-5.2` need to be updated to `gpt-5.4` across the entire monorepo.

## Scope

25 occurrences across 10 files:

| File | Lines | Type |
|------|-------|------|
| `packages/pipeline-core/src/copilot-sdk-wrapper/model-registry.ts` | 68, 106 | Model definition & list |
| `packages/pipeline-core/test/ai/model-registry.test.ts` | 119, 160, 180, 207 | Tests |
| `package.json` | 383, 545 | VS Code extension model config |
| `src/shortcuts/ai-service/ai-config-helpers.ts` | 134 | Default model logic |
| `src/test/suite/model-registry.test.ts` | 193 | VS Code extension test |
| `packages/coc/src/server/spa/client/react/tasks/GenerateTaskDialog.tsx` | 51 | UI model picker preference |
| `packages/coc/test/server/preferences-handler.test.ts` | 156–565 (10 occurrences) | Preference validation tests |
| `.github/skills/go-deep/references/deep-verify.prompt.md` | 33 | Skill reference doc |
| `packages/pipeline-core/resources/bundled-skills/go-deep/references/deep-verify.prompt.md` | 33 | Bundled skill reference doc |
| `docs/follow-prompt-consistency-audit.md` | 71 | Documentation |

## Approach
Simple global find-and-replace of `gpt-5.2` → `gpt-5.4` across all files. Also update any display labels like `GPT-5.2` → `GPT-5.4`.

## Tasks

1. Update `packages/pipeline-core/src/copilot-sdk-wrapper/model-registry.ts` — change model `id` and list entry
2. Update `packages/pipeline-core/test/ai/model-registry.test.ts` — update test expectations and label assertion (`GPT-5.2` → `GPT-5.4`)
3. Update `package.json` — update both model list entries
4. Update `src/shortcuts/ai-service/ai-config-helpers.ts` — update default model fallback
5. Update `src/test/suite/model-registry.test.ts` — update test value
6. Update `packages/coc/src/server/spa/client/react/tasks/GenerateTaskDialog.tsx` — update picker preference
7. Update `packages/coc/test/server/preferences-handler.test.ts` — update all test data strings
8. Update `.github/skills/go-deep/references/deep-verify.prompt.md` — update doc reference
9. Update `packages/pipeline-core/resources/bundled-skills/go-deep/references/deep-verify.prompt.md` — update bundled doc
10. Update `docs/follow-prompt-consistency-audit.md` — update audit doc
11. Build and run tests to verify no regressions

## Notes
- The label `GPT-5.2` in `model-registry.test.ts` line 160 must also change to `GPT-5.4`
- No API behavior changes — this is purely a model ID string update
