# Fix: Repo Group Collapse/Expand Bug in Dashboard

## Problem

In the AI Execution Dashboard's "Repos" sidebar, collapsing a repo group works, but expanding it back does **not**. The group stays collapsed permanently after the first collapse.

## Root Cause

`ReposGrid.tsx` line 28 — the `toggleGroup` function has a broken boolean expression:

```typescript
const toggleGroup = (url: string) => {
    setExpandedState(prev => ({ ...prev, [url]: !prev[url] !== false ? false : true }));
};
```

**Operator precedence issue:** `!prev[url] !== false` is parsed as `(!prev[url]) !== false`.

Trace:
| `prev[url]` | `!prev[url]` | `… !== false` | Ternary result | Expected |
|---|---|---|---|---|
| `undefined` (initial, expanded) | `true` | `true` | `false` ✅ collapses | collapse |
| `false` (collapsed) | `true` | `true` | `false` ❌ stays collapsed | expand |
| `true` (expanded) | `false` | `false` | `true` ✅ | collapse (unreachable after first collapse) |

The `false → true` transition never works because `!false !== false` evaluates to `true`, producing `false` again.

## Fix

Replace with a correct toggle that respects the `!== false` convention used in `groupReposByRemote`:

```typescript
const toggleGroup = (url: string) => {
    setExpandedState(prev => ({ ...prev, [url]: prev[url] === false }));
};
```

Logic:
- `undefined === false` → `false` → collapses ✓
- `false === false` → `true` → expands ✓  
- `true === false` → `false` → collapses ✓

## Files to Change

1. **`packages/coc/src/server/spa/client/react/repos/ReposGrid.tsx`** — Fix `toggleGroup` (line 28)

## Validation

- Build: `npm run build`
- Existing tests: check if ReposGrid has tests, run them
