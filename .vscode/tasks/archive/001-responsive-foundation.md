---
status: done
---

# 001: Responsive Foundation — Tailwind Config, Breakpoint Hook, Test Utilities

## Summary

Establish the responsive infrastructure for the CoC SPA dashboard. Replace the single custom Tailwind breakpoint (`md-split: 900px`) with three standard mobile-first breakpoints, create a `useBreakpoint` React hook that tracks viewport size via `matchMedia`, and add test utilities for both Vitest/jsdom unit tests and Playwright E2E tests.

## Motivation

The SPA dashboard currently has no responsive design system. The lone `md-split` breakpoint in `tailwind.config.js` is used only by `RepoGitTab.tsx` for a stacked/split layout. To make the entire dashboard mobile-friendly across 8 commits, we need:

1. **Standard breakpoints** — a consistent set of breakpoints (sm/md/lg) that all components can reference via Tailwind classes.
2. **Runtime breakpoint detection** — a React hook for components that need JS-level conditional rendering (not just CSS class switching).
3. **Test infrastructure** — reliable viewport mocking for unit tests and preset dimensions for E2E tests, so all subsequent commits can test responsive behavior without reinventing mocks.

## Changes

### Files to Create

- **`packages/coc/src/server/spa/client/react/hooks/useBreakpoint.ts`**
  The core responsive hook. Implementation details:

  ```ts
  export type Breakpoint = 'mobile' | 'tablet' | 'desktop';

  export interface BreakpointState {
      isMobile: boolean;   // width < 768px
      isTablet: boolean;   // 768px <= width < 1024px
      isDesktop: boolean;  // width >= 1024px
      breakpoint: Breakpoint;
  }

  export function useBreakpoint(): BreakpointState;
  ```

  Implementation notes:
  - Use two `window.matchMedia` queries: `(max-width: 767px)` for mobile, `(min-width: 768px) and (max-width: 1023px)` for tablet. Desktop is the else case.
  - Register `change` event listeners on both `MediaQueryList` objects; call `setState` on change.
  - Wrap initial `matchMedia` calls in a `typeof window !== 'undefined'` guard; default to `{ isMobile: false, isTablet: false, isDesktop: true, breakpoint: 'desktop' }` when SSR or when `matchMedia` is unavailable.
  - Return cleanup function in `useEffect` that calls `removeEventListener('change', ...)` on both queries.
  - Compute `breakpoint` string from booleans: if `isMobile` → `'mobile'`, if `isTablet` → `'tablet'`, else `'desktop'`.

- **`packages/coc/test/spa/helpers/viewport-mock.ts`**
  Vitest/jsdom helper that mocks `window.matchMedia` to simulate a given viewport width.

  ```ts
  /**
   * Mock window.matchMedia for jsdom tests. Call in beforeEach/beforeAll.
   * Returns a cleanup function that restores the original matchMedia.
   *
   * @param width - The simulated viewport width in pixels.
   */
  export function mockViewport(width: number): () => void;
  ```

  Implementation notes:
  - Save original `window.matchMedia`.
  - Replace `window.matchMedia` with a function that parses the media query string for numeric px values (extract `max-width` / `min-width` using regex), evaluates them against `width`, and returns a `MediaQueryList`-like object: `{ matches, media, addEventListener, removeEventListener, addListener, removeListener, onchange, dispatchEvent }`.
  - Track registered `change` listeners so tests can optionally trigger them.
  - The cleanup function restores the original `window.matchMedia`.

- **`packages/coc/test/e2e/helpers/viewports.ts`**
  Playwright viewport dimension presets.

  ```ts
  /** Standard viewport presets for E2E responsive testing. */
  export const VIEWPORTS = {
      mobile:  { width: 375,  height: 812  },  // iPhone 12/13
      tablet:  { width: 768,  height: 1024 },  // iPad portrait
      desktop: { width: 1280, height: 800  },  // Standard laptop
  } as const;

  export type ViewportName = keyof typeof VIEWPORTS;
  ```

- **`packages/coc/test/spa/react/hooks/useBreakpoint.test.ts`**
  Unit tests for the `useBreakpoint` hook. Test scenarios listed in the [Tests](#tests) section below.

- **`packages/coc/test/e2e/spa-responsive-smoke.spec.ts`**
  Playwright smoke test at desktop viewport that loads the SPA root page and asserts it renders without error. Establishes the E2E regression baseline.

### Files to Modify

- **`packages/coc/tailwind.config.js`**
  Replace the `screens` block inside `theme.extend`:

  Before:
  ```js
  screens: {
    'md-split': '900px',
  },
  ```

  After:
  ```js
  screens: {
    'sm': '640px',
    'md': '768px',
    'lg': '1024px',
  },
  ```

- **`packages/coc/src/server/spa/client/react/repos/RepoGitTab.tsx`**
  Replace the two occurrences of `md-split:` Tailwind classes with `lg:` equivalents. The `md-split` breakpoint was `900px`; `lg` at `1024px` is the closest standard breakpoint for a sidebar split layout:
  - `md-split:flex-row` → `lg:flex-row`
  - `md-split:w-[320px]` → `lg:w-[320px]`
  - `md-split:shrink-0` → `lg:shrink-0`
  - `md-split:border-b-0` → `lg:border-b-0`
  - `md-split:border-r` → `lg:border-r`

- **`packages/coc/test/spa/react/RepoGitTab.test.ts`**
  Update the two assertions that check for `md-split:` to check for `lg:` instead:
  - `expect(source).toContain('md-split:')` → `expect(source).toContain('lg:')`
  - `expect(source).toContain('md-split:w-[320px]')` → `expect(source).toContain('lg:w-[320px]')`

### Files to Delete

- (none)

## Implementation Notes

1. **Breakpoint values align across Tailwind and JS.** The Tailwind `md: 768px` and `lg: 1024px` thresholds match the `useBreakpoint` hook's `767px` max-width / `768px` min-width and `1023px` max-width / `1024px` min-width queries exactly. This means `md:hidden` in a Tailwind class hides at the same pixel boundary where `isMobile` flips to false.

2. **`md-split` → `lg` migration.** The old `md-split: 900px` breakpoint was used only in `RepoGitTab.tsx`. Switching to `lg: 1024px` moves the split threshold slightly higher, which is acceptable — on 900–1023px screens the layout stacks vertically (mobile/tablet) instead of splitting, giving more room for content. This is the intended responsive direction.

3. **matchMedia listener API.** Use the modern `addEventListener('change', fn)` / `removeEventListener('change', fn)` API, not the deprecated `addListener`/`removeListener`. The SPA targets ES2020+ browsers (per `build-client.mjs`).

4. **Viewport mock design.** The mock parses `(max-width: Npx)` and `(min-width: Npx)` patterns from the query string. It does NOT need to handle `and` combinators — simply extract all `min-width` and `max-width` values and evaluate them against the provided width. This covers all queries produced by `useBreakpoint`. The mock returns `matches` synchronously and stores `change` listeners for future test-driven viewport resize simulation (though this commit doesn't exercise resize simulation — that can be added later).

5. **E2E smoke test.** The test starts the CoC server via the existing Playwright fixture pattern (if available) or launches a test server inline, navigates to `/`, and asserts the page contains the expected root React mount point. Uses `VIEWPORTS.desktop` dimensions. This is intentionally minimal — subsequent commits will add mobile/tablet E2E tests.

6. **No Tailwind `xl` or `2xl` breakpoints.** We deliberately omit larger breakpoints since the dashboard is not a widescreen app. Three breakpoints (sm, md, lg) provide sufficient coverage.

## Tests

- **`packages/coc/test/spa/react/hooks/useBreakpoint.test.ts`** — Unit tests using `renderHook` from `@testing-library/react` and `mockViewport` helper:
  - `returns isMobile=true for viewport width 375px` — mock 375px, assert `{ isMobile: true, isTablet: false, isDesktop: false, breakpoint: 'mobile' }`
  - `returns isTablet=true for viewport width 768px` — mock 768px, assert `{ isMobile: false, isTablet: true, isDesktop: false, breakpoint: 'tablet' }`
  - `returns isDesktop=true for viewport width 1280px` — mock 1280px, assert `{ isMobile: false, isTablet: false, isDesktop: true, breakpoint: 'desktop' }`
  - `returns isDesktop=true at exact boundary 1024px` — mock 1024px, assert `isDesktop: true`
  - `returns isMobile=true at 767px (just below tablet)` — mock 767px, assert `isMobile: true`
  - `cleans up matchMedia listeners on unmount` — render hook, unmount, verify `removeEventListener` was called on both media query lists
  - `defaults to desktop when window.matchMedia is undefined` — delete `window.matchMedia`, render hook, assert `isDesktop: true`, restore

- **`packages/coc/test/spa/react/RepoGitTab.test.ts`** — Two existing assertions updated (see Files to Modify) to check for `lg:` instead of `md-split:`.

- **`packages/coc/test/e2e/spa-responsive-smoke.spec.ts`** — Playwright test:
  - `loads SPA at desktop viewport without errors` — set viewport to `VIEWPORTS.desktop` (1280×800), navigate to `/`, assert page has the React root element, assert no console errors of severity `error`.

## Acceptance Criteria

- [ ] `tailwind.config.js` has `sm: 640px`, `md: 768px`, `lg: 1024px` under `theme.extend.screens` and no `md-split` entry
- [ ] `RepoGitTab.tsx` uses `lg:` prefix where it previously used `md-split:` (5 class replacements)
- [ ] `RepoGitTab.test.ts` passes with updated `lg:` assertions
- [ ] `useBreakpoint` hook exists at the specified path and exports `useBreakpoint`, `Breakpoint`, `BreakpointState`
- [ ] `useBreakpoint` returns correct state for mobile (<768), tablet (768–1023), desktop (≥1024) viewports
- [ ] `useBreakpoint` is SSR-safe (no crash when `window` is undefined, defaults to desktop)
- [ ] `useBreakpoint` cleans up `matchMedia` listeners on component unmount
- [ ] `mockViewport` helper exists and can mock `window.matchMedia` for any pixel width
- [ ] `VIEWPORTS` constant exports mobile/tablet/desktop presets with correct dimensions
- [ ] All 7 `useBreakpoint` unit tests pass (`npm run test:run` in `packages/coc`)
- [ ] Playwright smoke test passes at desktop viewport
- [ ] Existing tests still pass — `md-split` references are fully migrated to `lg`
- [ ] SPA builds successfully (`npm run build` from repo root)

## Dependencies

- Depends on: None

## Assumed Prior State

None — first commit.
