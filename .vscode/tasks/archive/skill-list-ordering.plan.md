# Plan: Skill List Ordering in CoC Dashboard Skill Dropdowns

## Problem

In the CoC dashboard, skill dropdowns in `EnqueueDialog` and `FollowPromptDialog` are
rendered in raw filesystem order. There is no alphabetical default and no usage-based
promotion. Users who repeatedly invoke the same skill must hunt through an unsorted list.

## Proposed Behaviour

- **Default (no prior usage):** skills sorted A→Z by `name`.
- **After first use:** the most-recently-used skill floats to the top; remaining skills
  stay A→Z below it.
- If multiple skills have been used, they are ordered most-recent-first, followed by
  all unused skills A→Z.

## Affected Files

| File | Change |
|------|--------|
| `packages/coc-server/src/skill-handler.ts` | Add `sortSkillsByUsage()` helper; apply sorting in `GET /api/workspaces/:id/skills` using per-repo `skillUsageMap` from preferences |
| `packages/coc/src/server/preferences-handler.ts` | Extend `PerRepoPreferences` with `skillUsageMap?: Record<string, string>` (name → ISO timestamp); add `PATCH /api/workspaces/:id/preferences/skill-usage` endpoint |
| `packages/coc/src/server/spa/client/react/queue/EnqueueDialog.tsx` | Call skill-usage PATCH on skill submit |
| `packages/coc/src/server/spa/client/react/shared/FollowPromptDialog.tsx` | Call skill-usage PATCH on skill submit |
| Tests | Unit tests for `sortSkillsByUsage()` in `packages/coc-server/` |

## Implementation Notes

### 1. Extend `PerRepoPreferences` in `preferences-handler.ts`
```ts
interface PerRepoPreferences {
  lastSkill?: string;
  lastQueueTaskSkill?: string;
  skillUsageMap?: Record<string, string>;  // skillName → ISO timestamp
}
```

Add a dedicated endpoint (or extend the existing preferences PATCH) so the client can
record a skill usage without a full preferences overwrite:
```
PATCH /api/workspaces/:id/preferences/skill-usage
Body: { skillName: string }
```
The handler reads the current `PerRepoPreferences`, updates `skillUsageMap[skillName]`
to `new Date().toISOString()`, and writes back.

### 2. `sortSkillsByUsage(skills, usageMap)` in `skill-handler.ts`
```ts
function sortSkillsByUsage(
  skills: SkillInfo[],
  usageMap: Record<string, string>  // name → ISO timestamp
): SkillInfo[] {
  return [...skills].sort((a, b) => {
    const ta = usageMap[a.name];
    const tb = usageMap[b.name];
    if (ta && tb) return tb.localeCompare(ta);   // both used: most-recent first
    if (ta) return -1;                            // only a used: a goes first
    if (tb) return 1;                             // only b used: b goes first
    return a.name.localeCompare(b.name);          // neither used: A→Z
  });
}
```

### 3. Apply sorting in the skills GET route
In `registerSkillRoutes()`, before returning the skill list:
```ts
const prefs = getPerRepoPreferences(workspaceId);   // read from ~/.coc/preferences.json
const usageMap = prefs?.skillUsageMap ?? {};
const sorted = sortSkillsByUsage(skills, usageMap);
res.json(sorted);
```

### 4. Record usage from React dialogs
In `EnqueueDialog.tsx` and `FollowPromptDialog.tsx`, on confirmed skill submission:
```ts
await fetch(`/api/workspaces/${workspaceId}/preferences/skill-usage`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ skillName: selectedSkill }),
});
```

## Tasks

1. ~~**pref-skill-usage-map**~~ — Extend `PerRepoPreferences` in `preferences-handler.ts`
   with `skillUsageMap` and add `PATCH .../skill-usage` endpoint. ✅
2. ~~**skill-sort-logic**~~ — Add `sortSkillsByUsage()` to `skill-handler.ts`. ✅
3. ~~**skill-sort-in-api**~~ — Apply `sortSkillsByUsage()` in the `GET /skills` route using
   the workspace's `skillUsageMap` from preferences. ✅
4. ~~**skill-usage-enqueue**~~ — In `EnqueueDialog.tsx`, call the skill-usage PATCH on submit. ✅
5. ~~**skill-usage-follow-prompt**~~ — In `FollowPromptDialog.tsx`, call the skill-usage
   PATCH on submit. ✅
6. ~~**skill-tests**~~ — Unit tests for `sortSkillsByUsage()`: empty, all-new, one-used,
   multi-used. ✅

## Out of Scope
- Showing a visual "last used" badge in the dropdown.
- Persisting usage counts (only last-used timestamp is needed for ordering).
- Ordering prompt files (`.github/prompts/`) — separate feature.
- VS Code extension skill menus — separate codebase (`src/shortcuts/`).
