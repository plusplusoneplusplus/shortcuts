# Plan: Truncate Skill Description in `/` Slash Command Picker

## Problem

When the user types `/` in CoC's chat input, a dropdown appears listing available skills. Each row shows the skill name and its full description. The description text overflows the dropdown horizontally because:

1. The container has a `minWidth` but **no `maxWidth`**, so it expands to fit any content.
2. The description `<span>` has the Tailwind `truncate` class (`overflow:hidden; text-overflow:ellipsis; white-space:nowrap`), but **without `min-w-0`** on a flex child, the element never shrinks below its intrinsic content size — so `truncate` never activates.

**Screenshot evidence:** Description text extends beyond the visible panel boundary and gets clipped by the browser viewport rather than by the element itself.

## Affected File

`packages/coc/src/server/spa/client/react/repos/SlashCommandMenu.tsx`

## Root Cause (code)

```tsx
// line 66-71 — container has no maxWidth
className="… max-h-48 overflow-y-auto text-sm"
style={{ bottom: …, left: …, minWidth: 220 }}   // ← no maxWidth

// line 78 — flex row has no overflow guard
className={`px-3 py-1.5 cursor-pointer flex items-center gap-2 …`}

// line 88 — truncate never fires because min-w-0 is missing on flex child
<span className="text-xs text-[#848484] truncate">— {skill.description}</span>
```

## Proposed Fix

### 1. Cap the dropdown width
Add `maxWidth` (e.g. `480px`) to the container `style` so the dropdown cannot grow wider than the chat panel.

```diff
- style={{ bottom: …, left: …, minWidth: 220 }}
+ style={{ bottom: …, left: …, minWidth: 220, maxWidth: 480 }}
```

### 2. Allow the description span to shrink (flex child fix)
Add `min-w-0` to the description `<span>` so Tailwind's `truncate` can actually activate:

```diff
- <span className="text-xs text-[#848484] truncate">— {skill.description}</span>
+ <span className="text-xs text-[#848484] truncate min-w-0">— {skill.description}</span>
```

### 3. (Optional / defence-in-depth) Hard-cap via JS
If CSS truncation is still insufficient, slice the description string to ~100 characters before rendering:

```tsx
const MAX_DESC = 100;
const desc = skill.description.length > MAX_DESC
    ? skill.description.slice(0, MAX_DESC) + '…'
    : skill.description;
<span className="text-xs text-[#848484] truncate min-w-0">— {desc}</span>
```

## Todos

1. Apply `maxWidth: 480` to the container `style` in `SlashCommandMenu.tsx`.
2. Add `min-w-0` class to the description `<span>` so `truncate` activates correctly.
3. Rebuild the CoC SPA (`npm run build` in `packages/coc`) and visually verify the dropdown no longer overflows.
4. Confirm existing Vitest tests still pass (`npm run test:run` in `packages/coc`).

## Out of Scope

- Changing the skill description content itself.
- Any other chat UI changes beyond this dropdown.
