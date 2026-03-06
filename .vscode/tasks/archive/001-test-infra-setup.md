---
status: pending
---

# 001: Test infra: jsdom setup & jest-dom matchers

## Summary

Wire up `@testing-library/jest-dom` matchers globally for jsdom tests, extend the environment glob to cover `.ts` test files in `test/spa/react/`, and create a shared `test-utils.tsx` with context-provider wrappers and a mock-fetch factory so every future component/hook test starts from a consistent foundation.

## Motivation

This is the first commit in the SPA test-migration series and must land before any component tests are added. Three gaps exist today:

1. **`@testing-library/jest-dom` is installed (`^6.9.1` in devDeps) but never imported in setup** — matchers like `toBeInTheDocument()` are unavailable, forcing tests to use weaker assertions or ad-hoc imports.
2. **`environmentMatchGlobs` only matches `*.test.tsx`** — the glob `['test/spa/**/*.test.tsx', 'jsdom']` means `.ts` files such as `AppContext.test.ts`, `QueueContext.test.ts`, `Router.test.ts`, and ~20 others run under Node instead of jsdom. Any test that later needs `document` or DOM APIs will fail silently or require per-file `@vitest-environment jsdom` annotations.
3. **No shared test utilities** — every `.tsx` test that renders components must manually compose `<AppProvider>`, `<QueueProvider>`, `<TaskProvider>`, and `<ToastContext.Provider>`. There is also no reusable `fetch` mock pattern; each test that touches API calls re-invents its own stub.

## Changes

### Files to Create

- `packages/coc/test/spa/react/test-utils.tsx` — Shared test utilities:
  - **`renderWithProviders(ui, options?)`** — Wraps the component under test in `AppProvider → QueueProvider → TaskProvider → ToastContext.Provider` with sensible defaults. Accepts optional `{ appState?, queueState?, taskState?, toasts? }` overrides that are merged into context values. Returns the `render()` result plus `{ appDispatch, queueDispatch, taskDispatch }` spy refs for assertion.
  - **`createMockAppContext(overrides?)`** — Returns a `{ state: AppContextState; dispatch: vi.Mock }` pair seeded from the real `initialState` exported by `AppContext.tsx`, with overrides deep-merged.
  - **`createMockQueueContext(overrides?)`** — Same pattern for `QueueContextState`.
  - **`createMockTaskContext(overrides?)`** — Same pattern for `TaskContextState`.
  - **`createMockToastContext(overrides?)`** — Returns a `ToastContextValue` with `vi.fn()` stubs for `addToast` / `removeToast` and an empty `toasts` array.
  - **`createMockFetch(handlers?)`** — Returns a `vi.fn()` typed as `typeof globalThis.fetch` that can be configured with route→response mappings. Unmatched routes return 404. Automatically sets/restores `globalThis.fetch` via `beforeEach`/`afterEach` when called inside a describe block if desired, but also works standalone.

### Files to Modify

- `packages/coc/vitest.config.ts` — **Extend `environmentMatchGlobs`** to also match `.ts` files:
  ```ts
  environmentMatchGlobs: [
      ['test/spa/**/*.test.tsx', 'jsdom'],
      ['test/spa/**/*.test.ts', 'jsdom'],
  ],
  ```
  This ensures all tests under `test/spa/` run with jsdom regardless of extension. Pure-logic `.ts` tests (like `AppContext.test.ts` that only test a reducer) are unaffected — jsdom is a superset of Node for these purposes and the extra overhead is negligible.

- `packages/coc/test/setup.ts` — **Add `@testing-library/jest-dom` import** at the top (after the existing `vi.mock` block):
  ```ts
  import '@testing-library/jest-dom/vitest';
  ```
  This registers the custom matchers globally for all test environments. The `/vitest` entry point is the recommended approach for Vitest ≥1.0 and avoids the `expect.extend()` boilerplate. It is safe to import in Node-environment tests too — the matchers simply won't be used.

### Files to Delete

(none)

## Implementation Notes

### Context provider shape
All three main contexts (`AppContext`, `QueueContext`, `TaskContext`) follow the same pattern: `createContext<{ state: S; dispatch: Dispatch<A> } | null>(null)` with a Provider component that uses `useReducer`. The `renderWithProviders` wrapper should **not** use the real `useReducer`-based providers (e.g. `<AppProvider>`); instead it should create the context value directly using the mock factory functions. This gives tests full control over initial state and lets them assert on dispatch calls without triggering reducer logic.

### ToastContext
`ToastContext` is different — it uses a simple value interface (`{ addToast, removeToast, toasts }`) rather than `state + dispatch`. The wrapper should provide a stub implementation by default.

### Import paths for context internals
The context modules export both the Provider component and the raw context object (the `const XxxContext = createContext(...)` is not exported — only the Provider and hook are). To inject custom values in tests, the wrapper must either:
- (a) Re-create the context providers by calling React.createElement on the Provider with a `value` prop — but the raw `createContext` result is not exported.
- (b) Use the exported Provider components and intercept dispatch via a wrapper reducer.
- (c) **Best approach:** Use `vi.mock` to make the hooks (`useApp`, `useQueue`, `useTaskContext`) return the mock values directly, or create thin wrapper components that set context via the exported Provider's children.

The cleanest option for `test-utils.tsx` is to create lightweight wrapper components that render the real Providers and then use an effect or state injection to override. However, since the Providers use `useReducer` internally with a fixed `initialState`, the simplest approach is to **render the real Provider and dispatch initial actions**, or to mock the hooks. The plan recommends **directly mocking the context values via React context** by creating a test-only context provider that bypasses `useReducer`. Since the raw `createContext` constants are module-private, the test-utils should import the reducers and create the context providers manually using the same `createContext` pattern but with controlled initial values.

**Decision:** Use the real `createContext` pattern in test-utils — create fresh context objects that mirror the production ones, and have `renderWithProviders` wrap with these test contexts. Then mock the `useApp`/`useQueue`/`useTaskContext` hooks to read from the test contexts. This keeps tests decoupled from reducer implementation while allowing state overrides. Alternatively, the simpler approach: render the real Providers but dispatch actions to seed state. Given the complexity of this decision, the implementation should start with the simplest viable approach — rendering real Providers and optionally dispatching seed actions — and refine if needed.

### `createMockFetch` design
- Should return `vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()`.
- Default behavior: return `Response` with status 404 and JSON `{ error: 'Not Found' }`.
- Accepts a map of `{ [urlPattern: string]: Response | object }` for route matching.
- The `urlPattern` is matched via `string.includes()` for simplicity (not regex).

### jest-dom version compatibility
`@testing-library/jest-dom@^6.9.1` ships with the `/vitest` entry point that auto-extends `expect` for Vitest. No manual `expect.extend()` call is needed. The import `'@testing-library/jest-dom/vitest'` is sufficient.

### Existing `.ts` tests under `test/spa/react/`
These tests (e.g., `AppContext.test.ts`, `QueueContext.test.ts`, `workspace-utils.test.ts`) are pure reducer/utility tests that don't touch the DOM. Running them under jsdom instead of Node adds ~50ms overhead per file but has no functional impact. This is acceptable for consistency.

## Tests

- The `test-utils.tsx` file is a test utility, not a test itself. Its correctness is validated by:
  1. Importing it in subsequent commit test files (commits #2+)
  2. A trivial smoke test can be added in this commit to verify the import works: a test that calls `createMockAppContext()` and asserts the returned state has expected defaults
- Existing tests must continue to pass with no regressions after the `vitest.config.ts` and `setup.ts` changes

## Acceptance Criteria

- [ ] `@testing-library/jest-dom` matchers (e.g., `toBeInTheDocument`, `toHaveTextContent`) are available globally in jsdom test files without per-file imports
- [ ] `.ts` files in `test/spa/react/` run under the jsdom environment (verified by `environmentMatchGlobs` config)
- [ ] `renderWithProviders()` wraps components in all required context providers and accepts optional state overrides
- [ ] `createMockFetch()` returns a `vi.fn()`-typed mock configurable with route→response mappings
- [ ] `createMockAppContext()`, `createMockQueueContext()`, `createMockTaskContext()` return properly typed mock objects with sensible defaults
- [ ] All existing tests in `packages/coc/` pass (`npm run test:run` in `packages/coc/`)
- [ ] No new runtime dependencies added (all additions are devDependencies or test-only code)

## Dependencies

- Depends on: None

## Assumed Prior State

None — this is the first commit.
