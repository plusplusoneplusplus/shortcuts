# Context: E2E Playwright Test Gap Coverage

## User Story
Find and fix gaps in Playwright e2e testing for new CoC SPA dashboard features. Focus on high-value, high-impact areas to prevent regression. Cap at 5 atomic commits.

## Goal
Add Playwright e2e tests for the 5 highest-impact untested feature areas in the CoC SPA dashboard: inline comment creation, comment lifecycle (resolve/edit/AI), git sub-tab, chat sub-tab, and workflow DAG + markdown review dialog.

## Commit Sequence
1. Comment e2e fixtures & inline comment creation tests
2. Comment lifecycle e2e tests (resolve, edit, delete, AI)
3. Git sub-tab e2e tests
4. Chat sub-tab e2e tests
5. Workflow DAG & MarkdownReviewDialog e2e tests

## Key Decisions
- Commits 1→2 are dependent (shared comment fixtures); commits 3, 4, 5 are independent of each other and of 1-2
- All tests use existing fixture patterns: server-fixture.ts, seed.ts, mock-ai.ts, repo-fixtures.ts
- Comment creation flow uses right-click context menu path (not SelectionToolbar), matching actual desktop UX
- Git tests require real git repos with multiple commits/branches — extend createRepoFixture
- Chat tests mock AI via existing mockAI fixture + page.route() for model/skills endpoints
- Workflow DAG tests seed pipeline process data; no real AI needed (pure visualization)
- MarkdownReviewDialog triggered via file-path links in process conversation

## Conventions
- Test files: `packages/coc/test/e2e/<feature>.spec.ts`
- Fixture files: `packages/coc/test/e2e/fixtures/<feature>-fixtures.ts`
- Each test uses `fs.mkdtempSync` for isolation, `safeRmSync` in finally block
- Selectors prefer `[data-testid="..."]` over CSS classes
- All tests must pass on Linux, macOS, and Windows
