# Plan: Preference View/Update in Admin Panel (#admin)

## Problem

The `#admin` panel at `http://localhost:4000/#admin` has sections for storage stats, config editing, display settings, export/import, and data wipe — but it has **no UI for viewing or editing user preferences** (`~/.coc/preferences.json`).

The REST API already exists (`GET /api/preferences`, `PUT /api/preferences`, `PATCH /api/preferences`), so only a frontend panel is needed.

## Proposed Approach

Add a **Preferences** section inside `AdminPanel.tsx` that:
1. Loads current preferences via `GET /api/preferences` on mount.
2. Renders each preference field as an appropriate input control.
3. Saves changes via `PATCH /api/preferences` (partial updates).
4. Shows success/error feedback inline.

---

## Preference Schema (current)

| Field | Type | Control |
|-------|------|---------|
| `theme` | `'light' \| 'dark' \| 'auto'` | Select / Radio |
| `lastModel` | `string` | Text input (read-only or editable) |
| `lastDepth` | `'deep' \| 'normal'` | Select |
| `lastEffort` | `'low' \| 'medium' \| 'high'` | Select |
| `lastSkill` | `string` | Text input |
| `reposSidebarCollapsed` | `boolean` | Toggle/Checkbox |
| `pinnedChats` | `Record<string, string[]>` | Read-only JSON viewer (complex shape; no inline edit) |

---

## Key Files

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/admin/AdminPanel.tsx` | Add `<PreferencesSection>` component inline or as import |
| *(optional)* `packages/coc/src/server/spa/client/react/admin/PreferencesSection.tsx` | New component for the preferences form |
| `packages/coc/src/server/spa/client/hooks/usePreferences.ts` | Already exists; reuse `loadPreferences` / `updatePreference` |

---

## Implementation Tasks

### 1. Create `PreferencesSection` component
- File: `packages/coc/src/server/spa/client/react/admin/PreferencesSection.tsx`
- On mount: call `GET /api/preferences`, store in local state.
- Render a form with controls per field (see table above).
- On change of any field: call `PATCH /api/preferences` with `{ [field]: newValue }`.
- Show saving spinner / "Saved ✓" / error message inline per field or globally.
- `pinnedChats`: render as a collapsed `<pre>` JSON block (read-only) with a "Clear all pins" button that PATCHes `{ pinnedChats: {} }`.

### 2. Integrate into `AdminPanel.tsx`
- Import `PreferencesSection` and render it as a new accordion/card section after existing sections.
- Section title: **"Preferences"** with a gear or sliders icon.

### 3. Style consistency
- Follow the same card/section pattern already used for Config and Display settings in `AdminPanel.tsx`.
- No new CSS files; use existing Tailwind or inline style classes.

### 4. Rebuild SPA bundle
- Run `npm run build` (or the SPA-specific build step) to regenerate the inlined HTML bundle.
- Verify the admin panel renders the new section correctly.

---

## Out of Scope
- Adding new preference fields (schema change).
- Server-side changes (API already exists).
- Mobile-specific layout adjustments.

---

## Notes
- `usePreferences.ts` hook already abstracts `PATCH /api/preferences`; reuse it directly to avoid duplicating fetch logic.
- The SPA is compiled into an inlined bundle (`html-template.ts`), so a full `npm run build` is required to reflect changes — no hot-reload in production.
- Keep `pinnedChats` read-only in admin to avoid complex per-workspace editing; provide only a bulk-clear action.
