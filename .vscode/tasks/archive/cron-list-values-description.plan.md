# Plan: Support Comma-Separated Cron Values in `describeCron`

## Problem

`describeCron` in `packages/coc/src/server/schedule-manager.ts` only produces a
human-readable description when the `hour` (and other) fields are a single
integer. When a user enters a cron like `0 1,13 * * *` the function falls
through and returns the raw expression unchanged, so the UI shows no friendly
description.

**Expected:** `"0 1,13 * * *"` → `"Every day at 01:00, 13:00"`  
**Actual:** `"0 1,13 * * *"` (unchanged)

## Scope

- Extend `describeCron` to handle comma-separated values in the **hour** field
  (e.g. `1,13`, `0,6,12,18`).
- Keep existing behaviour for all currently-supported patterns.
- Add/extend unit tests in `packages/coc/test/schedule-manager.test.ts`.

## Approach

1. After the existing single-hour + single-minute branch, add a new branch that
   matches:
   - `min` is a single digit (`/^\d+$/`)
   - `hour` is a comma-separated list of one-or-more integers
     (`/^(\d+,)+\d+$/` or simply splits cleanly on `,` with each part passing
     `/^\d+$/`)
   - `dom === '*'`, `month === '*'`
2. Format: sort the hours numerically, pad each to 2 digits, join with `, `,
   and produce:
   - `dow === '*'`  → `"Every day at HH:MM, HH:MM"`
   - otherwise      → `"<dowNames> at HH:MM, HH:MM"`
3. This mirrors the existing single-hour branch structure, keeping the code
   minimal.

### Helper (inline, no new function)

```ts
const isCommaList = (s: string) => s.split(',').every(p => /^\d+$/.test(p));

if (isCommaList(hour) && hour.includes(',') && /^\d+$/.test(min) && dom === '*' && month === '*') {
    const pad = (n: string) => n.padStart(2, '0');
    const times = hour.split(',')
        .map(Number)
        .sort((a, b) => a - b)
        .map(h => `${pad(String(h))}:${pad(min)}`)
        .join(', ');
    if (dow === '*') return `Every day at ${times}`;
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dowNames = dow.split(',').map(d => days[parseInt(d, 10)] || d).join(', ');
    return `${dowNames} at ${times}`;
}
```

## Files to Change

| File | Change |
|------|--------|
| `packages/coc/src/server/schedule-manager.ts` | Add comma-list branch in `describeCron` |
| `packages/coc/test/schedule-manager.test.ts` | Add test cases for comma-separated hours |

## Test Cases to Add

| Input | Expected output |
|-------|-----------------|
| `"0 1,13 * * *"` | `"Every day at 01:00, 13:00"` |
| `"0 0,6,12,18 * * *"` | `"Every day at 00:00, 06:00, 12:00, 18:00"` |
| `"30 8,17 * * 1,5"` | `"Mon, Fri at 08:30, 17:30"` |
| `"0 13,1 * * *"` | `"Every day at 01:00, 13:00"` (sorted) |

## Out of Scope

- Comma-separated values in `min`, `dom`, `month`, or `dow` fields (separate
  feature).
- Range (`9-17`) or step (`*/2`) combined with lists.
