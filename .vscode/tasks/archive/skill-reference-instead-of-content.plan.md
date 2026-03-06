# Plan: Use Skill Reference Instead of Full Content in Queue Tasks

## Problem

When a queue task is created with a `skillName` (e.g., "Follow: impl on ..."), the current code resolves the full skill file content from `.github/skills/{skillName}/SKILL.md` and injects it verbatim into the AI prompt:

```typescript
// queue-executor-bridge.ts
private applySkillContent(prompt: string, task: QueuedTask): string {
    const skillContent = resolveSkillSync(payload.skillName, workspaceRoot);
    return `[Skill Guidance: ${payload.skillName}]\n${skillContent}\n\n[Task]\n${prompt}`;
}
```

This bloats the prompt with hundreds of lines of skill instructions that the AI model already has access to via the skill tool mechanism.

## Proposed Solution

Instead of resolving and embedding the full skill content, emit a short directive:

```
Use impl skill when available
```

This is sufficient because the AI agent already has access to the `skill` tool and knows how to invoke skills by name.

## Scope

- **In:** Change `applySkillContent` in `queue-executor-bridge.ts` to emit a reference string instead of full content.
- **Out:** No changes to skill resolution logic in `pipeline-core` (keep `resolveSkill*` functions as-is for other callers). No changes to the `/api/queue/:id/resolved-prompt` endpoint behavior.

## Key File

| File | Change |
|------|--------|
| `packages/coc/src/server/queue-executor-bridge.ts` | Replace skill content injection with `Use {skillName} skill when available` |

## Implementation Notes

- The `applySkillContent` method currently calls `resolveSkillSync()` and prepends a `[Skill Guidance: ...]` block. Replace the body so it returns:
  ```
  Use {skillName} skill when available\n\n[Task]\n{prompt}
  ```
- No need to import or call `resolveSkillSync` in this path anymore (can remove that import if it's only used here).
- The resolved-prompt API endpoint (`queue-handler.ts`) may still show the old full content in its preview — decide whether to update the preview too (likely yes, for consistency).
- Existing tests that assert on the `[Skill Guidance: ...]` prefix or full skill content in the assembled prompt will need to be updated.

## Tasks

1. Update `applySkillContent` in `queue-executor-bridge.ts` to emit `Use {skillName} skill when available` instead of full content.
2. Check if `resolveSkillSync` import becomes unused in that file and remove if so.
3. Update the resolved-prompt preview in `queue-handler.ts` to reflect the same short reference.
4. Update/fix affected tests.
5. Build and verify tests pass.
