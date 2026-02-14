# Upgrade Claude Opus 4.5 to Claude Opus 4.6

## Description

Upgrade all references to `claude-opus-4.5` to `claude-opus-4.6` throughout the entire codebase. This includes configuration files, source code, tests, documentation, and bundled pipeline resources.

## Acceptance Criteria

- [x] All instances of `claude-opus-4.5` are replaced with `claude-opus-4.6`
- [x] Extension compiles without errors (`npm run compile`)
- [x] All tests pass (`npm test`)
- [x] Linting passes (`npm run lint`)
- [x] Model appears correctly in VS Code settings UI
- [x] AI service correctly uses the new model identifier

## Subtasks

### Configuration Files
- [x] Update `package.json` enum definitions (2 locations: lines 376, 518)

### Source Code
- [x] Update `src/shortcuts/ai-service/ai-config-helpers.ts` model label mapping (line 80)
- [x] Update `packages/pipeline-core/src/ai/types.ts` model type definition (line 22)

### Bundled Pipelines
- [x] Update `resources/bundled-pipelines/multi-agent-research/pipeline.yaml` (lines 88, 279)

### Tests
- [x] Update `src/test/suite/follow-prompt-dialog.test.ts` (lines 70, 228)
- [x] Update `src/test/suite/follow-prompt-background.test.ts` (line 89)
- [x] Update `src/test/suite/follow-prompt-consistency.test.ts` (line 220)
- [x] Update `src/test/suite/ai-task-dialog.test.ts` (lines 620, 651, 665)
- [x] Update `src/test/suite/ai-clarification.test.ts` (line 948)
- [x] Update `src/test/suite/diff-ai-clarification.test.ts` (line 501)

### Documentation
- [x] Update `docs/follow-prompt-consistency-audit.md` (line 71)

## Notes

- Total files to modify: **10 files**
- Total occurrences: **16 references**
- The model name follows the pattern `claude-opus-{version}` - ensure consistency
- Consider updating CLAUDE.md if model version is mentioned there
- May need to verify the new model identifier is supported by the Copilot SDK
