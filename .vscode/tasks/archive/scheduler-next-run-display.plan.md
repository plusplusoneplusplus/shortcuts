# Bug: Scheduler "next: just now" After Recent Run

## Problem

A scheduled pipeline ran 5 minutes ago (cron: `0 */1 * * *` — every hour).  
The dashboard shows **"next: just now"** instead of "next: in ~55m".

### Root Cause

`formatRelativeTime(dateStr)` in `packages/coc/src/server/spa/client/react/utils/format.ts` computes:

```ts
const diff = now - d.getTime();   // negative for future dates
if (diff < 60000) return 'just now';  // ← negative < 60000 → always true for future
```

`RepoSchedulesTab.tsx` line 185 strips `" ago"` for next-run display:

```tsx
next: {formatRelativeTime(schedule.nextRun).replace(' ago', '') || ...}
```

For a future `nextRun`, `diff` is e.g. `-3,300,000` which satisfies `diff < 60000`, so the function returns `"just now"`. The fallback `new Date(...).toLocaleString()` never fires because `"just now"` is truthy.

## Acceptance Criteria

- [ ] When `nextRun` is in the future, the scheduler row shows **"in Xm"** / **"in Xh"** / **"in Xd"** instead of "just now".
- [ ] Past-time display ("Xm ago", "just now", etc.) is unchanged across all other usages of `formatRelativeTime`.
- [ ] The fix also applies to the vanilla `utils.ts` counterpart if it exists (check `packages/coc/src/server/spa/vanilla/`).
- [ ] Existing tests for `formatRelativeTime` still pass; new tests cover future-date cases.

## Approach

Extend `formatRelativeTime` to handle **future dates** (negative diff):

```ts
export function formatRelativeTime(dateStr: string | null | undefined): string {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const now = Date.now();
    const diff = now - d.getTime();

    // Future dates
    if (diff < 0) {
        const absMins = Math.floor(-diff / 60000);
        if (absMins < 1) return 'just now';
        if (absMins < 60) return 'in ' + absMins + 'm';
        const absHours = Math.floor(absMins / 60);
        if (absHours < 24) return 'in ' + absHours + 'h';
        return 'in ' + Math.floor(absHours / 24) + 'd';
    }

    // Past dates (existing logic)
    if (diff < 60000) return 'just now';
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return mins + 'm ago';
    const hours = Math.floor(mins / 60);
    if (hours < 24) return hours + 'h ago';
    const days = Math.floor(hours / 24);
    if (days === 1) return 'yesterday';
    if (days < 7) return days + 'd ago';
    return d.toLocaleDateString();
}
```

With this fix the `.replace(' ago', '')` in `RepoSchedulesTab` line 185 becomes a no-op for future times (already clean), so no change needed there.

## Subtasks

1. **Fix `formatRelativeTime`** in `packages/coc/src/server/spa/client/react/utils/format.ts` — add future-date branch.
2. **Check for vanilla counterpart** — search `packages/coc/src/server/` for another `formatRelativeTime` definition and apply the same fix.
3. **Update/add tests** — add test cases for future dates (e.g., +5m, +2h, +3d).

## Files

- `packages/coc/src/server/spa/client/react/utils/format.ts` (primary fix)
- `packages/coc/src/server/spa/client/react/repos/RepoSchedulesTab.tsx` (consumer — line 185; verify no extra fix needed)
- Any vanilla counterpart of `utils.ts`

## Notes

- The `.replace(' ago', '')` pattern on line 185 of `RepoSchedulesTab.tsx` was a workaround for the missing future-time support. After the fix it still works correctly (no regression).
- No server-side changes needed — `nextRun` ISO string from `serializeSchedule()` is correct.
