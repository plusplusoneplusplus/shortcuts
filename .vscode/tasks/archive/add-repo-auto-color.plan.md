# Add Repo: Auto Color Selection (Dedup)

## Problem
When adding a repository, users must manually pick a color from the 7-color palette. There's no safeguard against choosing a color already used by another repo, making it hard to visually distinguish repositories at a glance.

## Proposed Approach
Add an **"Auto"** option as the first/default choice in the color picker. When selected, the system picks the least-used (or first unused) color from `COLOR_PALETTE`, ensuring no two repos share the same color where avoidable.

**Key files:**
- `packages/coc/src/server/spa/client/react/repos/AddRepoDialog.tsx` — UI + default color state
- `packages/coc-server/src/api-handler.ts` — POST `/api/workspaces` (stores color)

---

## Acceptance Criteria

- [ ] An **"Auto"** option appears first in the color picker (visually distinct — e.g., rainbow/gradient icon or "A" label).
- [ ] When "Auto" is selected (default for new repos), the submitted color is resolved to the least-used palette color among existing repos at save time.
- [ ] If all palette colors are taken, fall back to the least-used color (round-robin over palette).
- [ ] When editing an existing repo, the current color is pre-selected (not "Auto"), preserving the user's previous explicit choice.
- [ ] The resolved color is saved to the workspace and shown in the repo list immediately.
- [ ] Selecting a specific color manually still works as before.

---

## Subtasks

### 1. Define auto-color resolution utility
- File: `AddRepoDialog.tsx` (or a new `colorUtils.ts` beside it)
- Function: `resolveAutoColor(existingRepos: RepoInfo[], palette: ColorOption[]): string`
  - Count usage of each palette color across `existingRepos`
  - Return the color with the lowest count (tie-break by palette order)

### 2. Update `COLOR_PALETTE` and state
- Add `{ label: 'Auto', value: 'auto' }` as the first entry
- Change default `useState` from `'#0078d4'` to `'auto'`
- Guard the color picker: only show a colored swatch for non-auto entries; show a special "Auto" indicator for the auto entry

### 3. Update color picker UI
- Render "Auto" as a distinct button (e.g., dashed border + "A" text, or a multi-color split circle)
- Selected "auto" shows a tooltip/label like "Auto (picks least-used color)"

### 4. Resolve color before submission
- In the `handleAdd` / form submit handler, before calling the API:
  - If `color === 'auto'`, call `resolveAutoColor(repos, COLOR_PALETTE.filter(c => c.value !== 'auto'))`
  - Pass the resolved hex to the API (never send `'auto'` to the backend)

### 5. Edit mode: no auto default
- When opening the dialog in **edit mode**, pre-select the repo's stored color (unchanged behavior)
- Do not default to "auto" for edits

### 6. Tests
- Unit test `resolveAutoColor`: empty repos → first color, partial usage → fills gaps, all used → picks least-used

---

## Notes
- The backend (`api-handler.ts`) does not need changes — it only stores whatever hex color it receives.
- "Auto" is a frontend-only concept; the stored value is always a resolved hex.
- Consider showing the resolved color in a preview beside the "Auto" button so users can see what color will be assigned before confirming.
- Future: could persist `"auto"` as a mode and re-resolve on each render so the color shifts as repos are added/removed — but that's out of scope for this task.
