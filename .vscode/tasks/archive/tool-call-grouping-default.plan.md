# Tool Call Grouping Disabled by Default

## Problem

Consecutive tool calls of the same category (e.g., 2 `glob` + 4 `view` = 6 "read" operations) are displayed individually instead of being collapsed into a single grouped row like "6 read operations (glob×2, view×4)".

**Root cause:** The `toolCompactness` display setting defaults to `0`. In `ConversationTurnBubble.tsx` line 513, when `toolCompactness < 1`, the grouping algorithm (`groupConsecutiveToolChunks`) is bypassed entirely — chunks are returned as-is.

The grouping algorithm itself (`toolGroupUtils.ts`) is correct and well-implemented. The issue is purely that the feature is opt-in via an admin config endpoint (`/admin/config → resolved.toolCompactness`) and the default is off.

## Acceptance Criteria

- [ ] Consecutive same-category tool calls are grouped by default in the process/queue detail view
- [ ] The default `toolCompactness` value is `1` (grouped, collapsible) instead of `0`
- [ ] Existing admin config override still works (users can set `toolCompactness: 0` to disable, or `2` for max compactness)
- [ ] No visual regression for turns with a single tool call or mixed non-groupable tools

## Proposed Fix

Change the default value of `toolCompactness` from `0` to `1` in `useDisplaySettings.ts`:

```typescript
// Before
const DEFAULT_SETTINGS: DisplaySettings = { showReportIntent: false, toolCompactness: 0 };

// After
const DEFAULT_SETTINGS: DisplaySettings = { showReportIntent: false, toolCompactness: 1 };
```

And similarly in the API fallback at line 26:
```typescript
toolCompactness: (data?.resolved?.toolCompactness ?? 1) as 0 | 1 | 2,
```

## Subtasks

1. **Change default** — Update `DEFAULT_SETTINGS` in `useDisplaySettings.ts` to `toolCompactness: 1`
2. **Update API fallback** — Change the `?? 0` fallback to `?? 1` in `fetchDisplaySettings()`
3. **Verify** — Confirm grouping works on the queue/process detail page with the new default

## Key Files

| File | Role |
|------|------|
| `packages/coc/src/server/spa/client/react/hooks/useDisplaySettings.ts` | Default settings & API fetch |
| `packages/coc/src/server/spa/client/react/processes/ConversationTurnBubble.tsx` | Grouping gate (line 513) |
| `packages/coc/src/server/spa/client/react/processes/toolGroupUtils.ts` | Grouping algorithm (working correctly) |
| `packages/coc/src/server/spa/client/react/processes/ToolCallGroupView.tsx` | Grouped tool rendering component |

## Notes

- `toolCompactness` levels: `0` = no grouping, `1` = grouped with expand/collapse, `2` = maximally compact
- The grouping algorithm only collapses runs of ≥2 consecutive same-category tools, so single tool calls are unaffected
- Tool categories: `read` (view/glob/grep), `write` (edit/create), `shell` (powershell/shell)
- Tools not in `CATEGORY_MAP` (e.g., `report_intent`, `sql`, `task`) are never grouped and break consecutive runs — this is expected behavior
- A secondary improvement could add `report_intent` as a "meta" category that doesn't break runs, but that's a separate concern
