# Bug: Queue Task "Skill: impl" does not load the skill

## Problem

When a user creates a queue task via "+ Queue Task" in the CoC SPA and selects a skill (e.g., "impl"), the task title shows "Skill: impl" but the skill content (from `.github/skills/impl/SKILL.md`) is **never loaded or injected** into the prompt. The AI receives a bare prompt like `"Use the impl skill."` without any actual skill guidance.

## Root Cause

The `EnqueueDialog.tsx` correctly sends `payload.skillName` to the backend:
```json
{
  "type": "follow-prompt",
  "displayName": "Skill: impl",
  "payload": { "skillName": "impl", "promptContent": "...", "workingDirectory": "..." }
}
```

However, in `packages/coc/src/server/queue-executor-bridge.ts`:
1. **`extractPrompt()`** (line 498) ignores `payload.skillName` entirely — it only uses `promptContent`, `promptFilePath`, and `planFilePath`
2. **`executeWithAI()`** (line 617) sends the raw prompt without any skill content
3. `payload.skillName` is defined in `FollowPromptPayload` and `AIClarificationPayload` (task-types.ts) but is **never read** during execution

The skill resolution infrastructure exists in `pipeline-core`:
- `resolveSkill()` / `resolveSkillSync()` — reads `.github/skills/{name}/SKILL.md`
- `buildPromptWithSkill()` — prepends `[Skill Guidance: {name}]\n{content}\n\n[Task]\n{prompt}`

But these are only called from the YAML **pipeline executor** (`pipeline-core/src/pipeline/executor.ts`), never from the queue executor bridge.

## Affected Files

| File | Role |
|------|------|
| `packages/coc/src/server/queue-executor-bridge.ts` | Main fix — needs to resolve skill and inject into prompt |
| `packages/pipeline-core/src/pipeline/executor.ts` | `buildPromptWithSkill()` is module-private; needs exporting |
| `packages/pipeline-core/src/index.ts` | Export `buildPromptWithSkill` |

## Approach

### Option A: Resolve skill in `extractPrompt()` using sync API (Recommended)

Use `resolveSkillSync()` (already exported from pipeline-core) within `extractPrompt()` to load the skill content and prepend it. This keeps prompt construction self-contained.

### Option B: Resolve skill in async execution path

Add skill resolution after `extractPrompt()` returns, in the `execute()` method. Cleaner async-wise but splits prompt construction across two locations.

**Recommendation:** Option A — `resolveSkillSync` is available and `extractPrompt()` is already doing file I/O (`fs.existsSync`).

## Todos

### 1. ~~Export `buildPromptWithSkill` from pipeline-core~~
- [x] Inlined the trivial 5-line function in the queue bridge's `applySkillContent` method to avoid coupling

### 2. ~~Add skill resolution to `extractPrompt()` in queue-executor-bridge.ts~~
- [x] Imported `resolveSkillSync` from `@plusplusoneplusplus/pipeline-core`
- [x] Added `applySkillContent()` method that wraps prompt with skill content for any payload with `skillName`
- [x] Applied after `extractPrompt()` in `execute()` — covers all task types uniformly
- [x] Graceful degradation: logs warning and returns original prompt on resolution failure

### 3. ~~Add tests~~
- [x] Unit test: follow-prompt with `skillName` returns prompt wrapped with skill content
- [x] Unit test: ai-clarification with `skillName` returns prompt wrapped with skill content
- [x] Unit test: `skillName` set but skill file missing returns prompt without skill (graceful degradation)
- [x] Unit test: without `skillName` — prompt unchanged, `resolveSkillSync` not called (regression check)
- [x] Unit test: skill-wrapped prompt stored as `fullPrompt` in process

### 4. ~~Verify end-to-end~~
- [x] Build succeeded (`npm run build`)
- [x] All 5418 tests pass across 226 test files

## Notes

- `resolveSkillSync` reads from `{workspaceRoot}/.github/skills/{name}/SKILL.md`
- The `workingDirectory` from the payload can serve as `workspaceRoot` for skill resolution
- Both `FollowPromptPayload` and `AIClarificationPayload` have `skillName` field — both paths in `extractPrompt()` need the fix
- `buildPromptWithSkill` is trivial: `[Skill Guidance: ${name}]\n${content}\n\n[Task]\n${prompt}` — could be inlined instead of exported
