# Fix: Tool grouping not visible in UI

## Problem

Even though the CSS class name mismatch (plan `fix-tool-group-minimal-css.plan.md`) is resolved,
grouping still doesn't appear. Two bugs remain.

---

## Bug 1 — AdminPanel default is 0 ("Full") but hook default is 1 ("Compact")

**File:** `packages/coc/src/server/spa/client/react/admin/AdminPanel.tsx`  
**Line:** 106

```ts
// Current (wrong)
setToolCompactness((resolved.toolCompactness ?? 0) as 0 | 1 | 2);

// Fixed
setToolCompactness((resolved.toolCompactness ?? 1) as 0 | 1 | 2);
```

**Impact:** When `toolCompactness` has never been saved to the server, the AdminPanel
shows the "Full" button as selected (value `0`). If the user opens Display settings and
clicks the already-highlighted "Full" button (thinking it's confirming the current state),
it **saves 0 to the server**, disabling grouping permanently.
`useDisplaySettings` defaults to `1` when the server returns nothing — so the two sides
disagree on what the unsaved default is.

---

## Bug 2 — Wrong set passed to groupConsecutiveToolChunks

**File:** `packages/coc/src/server/spa/client/react/processes/ConversationTurnBubble.tsx`  
**Line:** 519

```ts
// Current (wrong) — passes child IDs (tools that HAVE a parent)
new Set(assistantRender.toolParentById.keys()),

// Fixed — passes parent IDs (tools that HAVE children), which is what the algorithm needs
assistantRender.toolsWithChildren,
```

**Impact:** `groupConsecutiveToolChunks` uses the set to **exclude tools that have children**
from being grouped (they are rendered as expandable parents, not leaf tool calls).
`toolParentById.keys()` is the **child** side — the map is `childId → parentId`.
`toolsWithChildren` is the **parent** side — the set of IDs that have at least one child.

Concretely:
- Any leaf tool call whose ID happens to be a key in `toolParentById` is wrongly excluded from
  grouping (never happens — leaf tools have no parent entry as a key, only as a value).
- Parent tools (e.g. `task` agent calls) are **not** excluded as they should be, so they can
  get grouped into a read/write/shell box incorrectly.

The grouping algorithm already contains the guard:
```ts
if (!tool || parentToolIds.has(chunk.toolId)) { result.push(chunk); ... }
```
…but it only works correctly when `parentToolIds` is actually the set of IDs that are parents.

---

## Files to change

| File | Line | Change |
|---|---|---|
| `packages/coc/src/server/spa/client/react/admin/AdminPanel.tsx` | 106 | `?? 0` → `?? 1` |
| `packages/coc/src/server/spa/client/react/processes/ConversationTurnBubble.tsx` | 519 | `new Set(assistantRender.toolParentById.keys())` → `assistantRender.toolsWithChildren` |

---

## Verification

1. Build: `npm run build` — no errors.
2. Open Display settings, confirm "Compact" is the selected default when nothing is saved.
3. In a conversation turn with ≥2 consecutive `glob`/`view`/`grep` calls, they should render
   inside a single collapsible "read operations" box.
4. `task` agent tool calls (which have children) should **not** be collapsed into a group box.
5. `npm run test:run` in `packages/coc` — all tests pass.
