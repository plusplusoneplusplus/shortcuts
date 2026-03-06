# Context: SPA Test Migration

## User Story
The SPA dashboard in `packages/coc/src/server/spa/` has ~120 source files but only ~13% test coverage. Most existing "tests" scan the compiled bundle.js or raw .tsx source for string substrings — they prove a symbol exists but don't test behavior. The goal is to replace these with real React component and hook unit tests using `@testing-library/react`.

## Goal
Migrate SPA string-scanning tests to proper behavioral tests (component rendering, hook logic, fetch mocking) while keeping the bundle safety test that legitimately uses string scanning for Node-builtin leak detection.

## Commit Sequence
1. Test infra: jsdom setup & jest-dom matchers
2. Pure function unit tests
3. Props-only component tests (TaskTreeItem, FileMoveDialog)
4. Hook unit tests — fetch-based (useFileActions, useTaskTree)
5. Hook & component tests — context-based (useQueueActivity, TaskTree, TaskActions)
6. Remove superseded string-scanning tests

## Key Decisions
- Keep `spa-browser-bundle-safety.test.ts` — string scanning is correct for detecting Node builtin leaks in browser bundles
- Keep `spa-html.test.ts` and `spa-helpers.test.ts` — they already test behavior properly
- Use `@testing-library/react` (already in devDeps) with jsdom (already in devDeps)
- Create shared `test-utils.tsx` with context wrapper factories to avoid boilerplate in every test
- Mock at the `fetchApi` level (not raw `fetch`) where possible for cleaner tests

## Conventions
- Test files: `packages/coc/test/spa/react/<name>.test.tsx` for component/hook tests, `.test.ts` for pure logic
- Use `renderWithProviders()` from `test-utils.tsx` for any test needing React context
- Follow existing workspace-utils.test.ts patterns for pure function tests
