---
status: pending
---

# 003: Add compactness level toggle to display settings UI

## Summary
Adds a 3-level segmented control (Full / Compact / Minimal) to the existing **Display** card in `AdminPanel.tsx`. On change it `PUT`s `{ toolCompactness: value }` to `/api/admin/config` and calls `invalidateDisplaySettings()`, following the identical optimistic-update pattern already used for `showReportIntent`.

## Motivation
Commit 002 wired `toolCompactness` through the config schema, server handler, and `useDisplaySettings` hook, but left the admin UI untouched. This commit completes the user-facing surface so operators can actually change the setting from the dashboard.

## Changes

### Files to Create
_(none)_

### Files to Modify

- `packages/coc/src/server/spa/client/react/admin/AdminPanel.tsx` — add `toolCompactness` state, load it from config, add `handleChangeToolCompactness` handler, and render the segmented control inside the existing Display card.

### Files to Delete
_(none)_

## Implementation Notes

### Where to insert in `AdminPanel.tsx`

**1. State (near line 44, alongside `showReportIntent`)**

```tsx
// Display settings
const [showReportIntent, setShowReportIntent] = useState(false);
const [toolCompactness, setToolCompactness] = useState<0 | 1 | 2>(0);   // ← add
const [displaySaving, setDisplaySaving] = useState(false);
```

**2. Load from config (near line 104, inside `loadConfig`)**

```ts
setShowReportIntent(resolved.showReportIntent ?? false);
setToolCompactness((resolved.toolCompactness ?? 0) as 0 | 1 | 2);   // ← add
```

**3. New handler (insert after `handleToggleShowReportIntent`, ~line 187)**

The handler mirrors `handleToggleShowReportIntent` exactly — optimistic update, PUT, rollback on error, `invalidateDisplaySettings()` on success, shared `displaySaving` flag:

```tsx
const handleChangeToolCompactness = useCallback(async (newValue: 0 | 1 | 2) => {
    const prevValue = toolCompactness;
    setToolCompactness(newValue);
    setDisplaySaving(true);
    try {
        const res = await fetch(getApiBase() + '/admin/config', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ toolCompactness: newValue }),
        });
        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error || 'Save failed');
        }
        addToast('Settings saved', 'success');
        invalidateDisplaySettings();
    } catch (err: any) {
        setToolCompactness(prevValue);
        addToast(err.message || 'Could not persist setting. Config may be read-only.', 'error');
    } finally {
        setDisplaySaving(false);
    }
}, [toolCompactness, addToast]);
```

Note: `displaySaving` is shared between the two display-setting controls, so both the checkbox and the segmented control are disabled while either save is in flight. This is intentional — it matches the existing single `displaySaving` state var.

**4. Segmented control inside the Display card (after the `showReportIntent` row, before the closing `</Card>` ~line 529)**

Build the segmented control inline using Tailwind and the existing `Button` component for consistent focus/disabled styling. Each segment is a `<button>` that reads as a radio group. The active segment gets the `primary` variant and the inactive ones get `secondary`.

```tsx
{/* Tool call compactness */}
<div className="flex items-center justify-between mt-3 pt-3 border-t border-[#e0e0e0] dark:border-[#3c3c3c]">
    <div>
        <div className="text-sm text-[#1e1e1e] dark:text-[#cccccc]">Tool call verbosity</div>
        <div className="text-xs text-[#616161] dark:text-[#999]">
            How much detail to show for tool calls in the conversation view.
        </div>
    </div>
    <div
        className="flex rounded-md overflow-hidden border border-[#e0e0e0] dark:border-[#3c3c3c] ml-4 shrink-0"
        role="group"
        aria-label="Tool call verbosity"
    >
        {([
            [0, 'Full'],
            [1, 'Compact'],
            [2, 'Minimal'],
        ] as const).map(([level, label]) => (
            <button
                key={level}
                type="button"
                disabled={displaySaving}
                onClick={() => void handleChangeToolCompactness(level)}
                data-testid={`tool-compactness-${label.toLowerCase()}`}
                className={[
                    'px-3 py-1 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0078d4] disabled:opacity-50 disabled:cursor-not-allowed',
                    'border-r last:border-r-0 border-[#e0e0e0] dark:border-[#3c3c3c]',
                    toolCompactness === level
                        ? 'bg-[#0078d4] text-white'
                        : 'bg-transparent text-[#1e1e1e] dark:text-[#cccccc] hover:bg-black/[0.04] dark:hover:bg-white/[0.04]',
                ].join(' ')}
                aria-pressed={toolCompactness === level}
            >
                {label}
            </button>
        ))}
    </div>
</div>
<div className="mt-1">
    <SourceBadge source={sources['toolCompactness']} />
</div>
```

### Why inline buttons rather than the shared `Button` component

The segmented control needs flush borders between segments (no gap) and a shared outer border radius. The `Button` component renders independent buttons with individual rounded corners; wiring it for a flush "pill group" would require overriding `rounded`, `border`, and focus styles, which is more invasive than a short inline implementation. Reuse `Button` only for standalone actions (see `PreferencesSection` pattern).

### Where the `sources` object comes from

`sources` is already defined at the top of the `AdminPanel` render function (line 390):
```ts
const sources: Record<string, string> = config?.sources ?? {};
```
`sources['toolCompactness']` will be populated by commit 002's backend changes (the key is included in `CONFIG_SOURCE_KEYS`). No change needed here.

### Touch-target sizing

The segmented control segments use `py-1 text-xs`. On mobile (below `md:` breakpoint) this might be tight. Add `min-h-[44px] md:min-h-0` to each button's class list to match the same mobile affordance used throughout the codebase (see `Button.tsx` `sizeMap`).

Revised segment classes with mobile affordance:
```
'px-3 py-1 text-xs font-medium min-h-[44px] md:min-h-0 transition-colors ...'
```

## Tests

- **Renders segmented control** — mount `AdminPanel`, mock `GET /api/admin/config` returning `{ resolved: { toolCompactness: 1 }, sources: {} }`, confirm the "Compact" button has `aria-pressed="true"` and the others have `aria-pressed="false"`.
- **Clicking a segment persists the value** — mock `PUT /api/admin/config`, click "Minimal" button, assert PUT body contains `{ toolCompactness: 2 }`, assert "Minimal" button has `aria-pressed="true"` after success.
- **Optimistic rollback on server error** — mock PUT returning 500, click "Full" when current is `1`; assert `toolCompactness` reverts to `1` after error.
- **Disabled while saving** — assert all three buttons have `disabled` attribute while PUT is in-flight.
- **SourceBadge renders** — when config has `sources.toolCompactness = 'file'`, the badge with text "file" is present.

## Acceptance Criteria

- [ ] The Display card in Admin shows a "Tool call verbosity" row with Full / Compact / Minimal buttons
- [ ] The active level is visually distinct (blue background) and `aria-pressed="true"`
- [ ] Clicking a different level immediately updates the active button (optimistic) and fires `PUT /api/admin/config { toolCompactness: N }`
- [ ] On PUT success, a "Settings saved" toast appears and `invalidateDisplaySettings()` is called
- [ ] On PUT failure, the selection reverts to the previous value and an error toast appears
- [ ] All three buttons are disabled (visually and functionally) while a save is in-flight
- [ ] `SourceBadge` appears below the control showing `'default'` or `'file'` from `sources['toolCompactness']`
- [ ] All existing tests continue to pass

## Dependencies
- Depends on: 002 (toolCompactness setting in hook + server)

## Assumed Prior State
Commit 002 has already:
- Added `toolCompactness: 0 | 1 | 2` to `DisplaySettings` and `DEFAULT_SETTINGS` in `useDisplaySettings.ts`
- Extended `fetchDisplaySettings` to read `data?.resolved?.toolCompactness`
- Added `toolCompactness` to `CONFIG_SOURCE_KEYS` so `sources['toolCompactness']` is populated by `GET /api/admin/config`
- Added validation and persistence for `toolCompactness` in `PUT /api/admin/config`

Therefore `AdminPanel.tsx` can safely read `resolved.toolCompactness` from the config load response, call `PUT /api/admin/config { toolCompactness: N }`, and `invalidateDisplaySettings()` without any additional server-side work.
