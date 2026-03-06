# Move Skills Section Before Prompts in Follow Prompt Dialog

## Problem

In the **Follow Prompt** dialog (both single-file and bulk variants), the section order is currently:

1. Last Used
2. **Prompts**
3. **Skills**

The user wants **Skills** to appear before **Prompts** so the more frequently used items are easier to reach.

## Approach

Swap the render order of the Skills and Prompts blocks in both React dialog components. No logic changes needed — purely a JSX reorder.

## Files to Change

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/shared/FollowPromptDialog.tsx` | Swap Skills block (lines 225-244) before Prompts block (lines 208-224) |
| `packages/coc/src/server/spa/client/react/shared/BulkFollowPromptDialog.tsx` | Swap Skills block (lines 277-296) before Prompts block (lines 260-276) |

## Tests

Existing tests (`FollowPromptDialog.test.tsx`, `BulkFollowPromptDialog.test.tsx`) do **not** assert section ordering, so no test changes are needed. Build verification (`npm run build`) is sufficient.

## Todos

- [x] Reorder sections in `FollowPromptDialog.tsx`
- [x] Reorder sections in `BulkFollowPromptDialog.tsx`
- [x] Verify build passes
