# Plan: Reduce Mobile Row Heights in CoC SPA

## Problem

On mobile, two rows in the CoC SPA are taller than necessary, wasting vertical screen space:

1. **TopBar** — the header row with hamburger menu, "CoC" title, status dot, and theme/settings icons.
2. **RepoDetail header** — the workspace row with the workspace name/color dot, `+`/`▼` buttons, and `…` menu.

## Proposed Approach

Apply responsive Tailwind classes to shrink height/padding for these rows only on mobile (`< 768px`), without affecting tablet or desktop layouts.

---

## Files to Change

### 1. `packages/coc/src/server/spa/client/react/layout/TopBar.tsx`

| Element | Current | Mobile target |
|---------|---------|---------------|
| Container `className` | `h-12` (48px) | `h-10 md:h-12` (40px on mobile) |
| Hamburger / icon buttons | `h-8 w-8` | `h-7 w-7 md:h-8 md:w-8` |

### 2. `packages/coc/src/server/spa/client/react/repos/RepoDetail.tsx`

| Element | Current | Mobile target |
|---------|---------|---------------|
| Header container padding | `py-2 md:py-3` | `py-1 md:py-2` (reduce by one step) |
| Color dot | `w-3.5 h-3.5` | `w-3 h-3 md:w-3.5 md:h-3.5` |

### 3. `packages/coc/src/server/spa/client/react/repos/ReposView.tsx`

The content area height is calculated as `h-[calc(100vh-48px-56px)]` on mobile.
If the TopBar shrinks from 48px → 40px, update to `h-[calc(100vh-40px-56px)]`.

---

## Notes

- Tailwind `md:` prefix targets `min-width: 768px`, so changes prefixed with `md:` only apply to tablet/desktop — leaving mobile at the smaller value.
- All three files are co-located in the same SPA source tree; no build config changes are needed.
- After changes, do a visual check at `< 768px` viewport width in browser devtools to confirm both rows are visibly shorter without clipping content.
