---
status: done
---

# 003: Git Sub-Tab E2E Tests

## Summary

End-to-end Playwright tests for the Git sub-tab of the repos detail panel, covering CommitList (history display, row expand/collapse, file list lazy-load), WorkingTree (staged/unstaged/untracked sections, stage/unstage/discard actions), and BranchChanges (branch-range summary, file list, inline diff). A new `git-fixtures.ts` helper creates repos with multiple commits, dirty working trees, and feature branches.

## Motivation

The Git sub-tab is the most interactive panel in the repo detail view — it has three complex sub-components (CommitList, WorkingTree, BranchChanges), each with lazy-loaded API data, expand/collapse state, and mutation endpoints (stage/unstage/discard). Currently there are ZERO e2e tests covering any of these. A single regression in the git API routes or React rendering would go completely undetected. These tests provide high-impact regression prevention for:
- Commit list rendering and lazy file-list loading (`GET /workspaces/:id/git/commits/:hash/files`)
- Working tree mutation round-trips (stage → unstage → discard via POST endpoints)
- Branch-range detection and file-list display on feature branches
- Navigation flow: repos tab → repo item → git sub-tab

## Changes

### Files to Create

- **`packages/coc/test/e2e/git-subtab.spec.ts`** — Main test file with `test.describe` blocks for CommitList, WorkingTree, and BranchChanges. Each block creates a purpose-built git fixture via helpers from `git-fixtures.ts`, seeds the workspace, navigates to the git sub-tab, and asserts on data-testid selectors. ~8-10 test cases total.

- **`packages/coc/test/e2e/fixtures/git-fixtures.ts`** — Git-specific fixture helpers that extend the pattern from `repo-fixtures.ts`. Exports:
  - `createMultiCommitRepo(tmpDir)` — repo with 3+ commits for CommitList tests
  - `createDirtyWorkingTreeRepo(tmpDir)` — repo with staged, unstaged, and untracked files for WorkingTree tests
  - `createFeatureBranchRepo(tmpDir)` — repo on a feature branch with commits ahead of main for BranchChanges tests

### Files to Modify

- None

### Files to Delete

- None

## Implementation Notes

### Navigation to Git Sub-Tab

Every test must navigate to the git sub-tab before assertions. The canonical flow:

```typescript
// 1. Seed workspace pointing at real git repo
await seedWorkspace(serverUrl, 'ws-git', 'git-repo', repoDir);

// 2. Navigate to SPA and click repos tab
await page.goto(serverUrl);
await page.click('[data-tab="repos"]');

// 3. Wait for repo to appear and click it
await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });
await page.locator('.repo-item').first().click();
await expect(page.locator('#repo-detail-content')).toBeVisible();

// 4. Click the Git sub-tab
await page.click('[data-subtab="git"]');
```

Extract this as a `navigateToGitTab(page, serverUrl, wsId, wsName, repoDir)` helper within `git-fixtures.ts`.

### Fixture: Multi-Commit Repo (`createMultiCommitRepo`)

Creates a repo with 3 commits so CommitList has data to display and expand:

```typescript
export function createMultiCommitRepo(tmpDir: string): string {
    const repoDir = path.join(tmpDir, 'test-repo');
    fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });

    execSync('git init', { cwd: repoDir, stdio: 'ignore' });
    execSync('git config user.name "test"', { cwd: repoDir, stdio: 'ignore' });
    execSync('git config user.email "test@test"', { cwd: repoDir, stdio: 'ignore' });

    // Commit 1: initial file
    fs.writeFileSync(path.join(repoDir, 'src', 'index.ts'), 'export default {};\n');
    execSync('git add -A && git commit -m "feat: initial setup"', {
        cwd: repoDir, stdio: 'ignore', shell: 'true' // shell: true for && on Windows
    });

    // Commit 2: add a second file
    fs.writeFileSync(path.join(repoDir, 'src', 'utils.ts'), 'export function helper() {}\n');
    execSync('git add -A && git commit -m "feat: add utils"', {
        cwd: repoDir, stdio: 'ignore', shell: 'true'
    });

    // Commit 3: modify existing file
    fs.writeFileSync(path.join(repoDir, 'src', 'index.ts'), 'export default { version: 2 };\n');
    execSync('git add -A && git commit -m "fix: update index"', {
        cwd: repoDir, stdio: 'ignore', shell: 'true'
    });

    return repoDir;
}
```

**Important:** Use `git config` per-repo (not `-c` flags) so all subsequent commands pick up the config. Use `shell: true` for `&&` chaining on Windows. On Windows `execSync` defaults to `cmd.exe` which supports `&&`.

### Fixture: Dirty Working Tree (`createDirtyWorkingTreeRepo`)

Creates a repo with staged, unstaged, and untracked changes:

```typescript
export function createDirtyWorkingTreeRepo(tmpDir: string): string {
    const repoDir = createMultiCommitRepo(tmpDir);

    // Unstaged change: modify a tracked file without staging
    fs.writeFileSync(path.join(repoDir, 'src', 'index.ts'), 'export default { dirty: true };\n');

    // Staged change: add a new file and stage it
    fs.writeFileSync(path.join(repoDir, 'src', 'staged.ts'), 'export const staged = true;\n');
    execSync('git add src/staged.ts', { cwd: repoDir, stdio: 'ignore' });

    // Untracked file: create but don't add
    fs.writeFileSync(path.join(repoDir, 'src', 'untracked.ts'), '// new file\n');

    return repoDir;
}
```

### Fixture: Feature Branch Repo (`createFeatureBranchRepo`)

Creates a repo on a feature branch with commits ahead of main/master, so BranchChanges renders:

```typescript
export function createFeatureBranchRepo(tmpDir: string): string {
    const repoDir = createMultiCommitRepo(tmpDir);

    // Detect default branch name (could be 'main' or 'master')
    const defaultBranch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: repoDir, encoding: 'utf-8'
    }).trim();

    // Create and switch to feature branch
    execSync('git checkout -b feature/test-branch', { cwd: repoDir, stdio: 'ignore' });

    // Add commits on the feature branch
    fs.writeFileSync(path.join(repoDir, 'src', 'feature.ts'), 'export const feature = true;\n');
    execSync('git add -A && git commit -m "feat: add feature module"', {
        cwd: repoDir, stdio: 'ignore', shell: 'true'
    });

    fs.writeFileSync(path.join(repoDir, 'src', 'feature-utils.ts'), 'export function fHelper() {}\n');
    execSync('git add -A && git commit -m "feat: add feature utils"', {
        cwd: repoDir, stdio: 'ignore', shell: 'true'
    });

    return repoDir;
}
```

**Note:** The `BranchChanges` component renders `null` when `onDefaultBranch` is true (line 178 of BranchChanges.tsx). The server's `/git/branch-range` endpoint calls `rangeService.detectCommitRange()` which returns `null` (→ `{ onDefaultBranch: true }`) when on the default branch. So the feature branch fixture is essential.

### Race Conditions & Waiting Strategy

1. **Commit list loading:** The `CommitList` shows `data-testid="commit-list-loading"` while fetching. Wait for it to disappear:
   ```typescript
   await expect(page.getByTestId('commit-list-loading')).toBeHidden({ timeout: 10000 });
   ```

2. **File list lazy loading:** Clicking a commit row triggers a fetch to `/git/commits/:hash/files`. The expand area shows `data-testid="commit-files-loading"` during load. After clicking a commit row, wait for the file list:
   ```typescript
   await page.getByTestId(`commit-row-${shortHash}`).click();
   await expect(page.getByTestId(`commit-files-${shortHash}`)).toBeVisible({ timeout: 5000 });
   await expect(page.getByTestId('commit-files-loading')).toBeHidden({ timeout: 5000 });
   ```

3. **Working tree loading:** Shows `data-testid="working-tree-loading"` during initial fetch. Wait for the main container:
   ```typescript
   await expect(page.getByTestId('working-tree')).toBeVisible({ timeout: 10000 });
   ```

4. **Branch changes file loading:** Expanding the header triggers file fetch. `data-testid="branch-changes-files-loading"` appears during load.

5. **Mutation round-trips (stage/unstage/discard):** After clicking an action button, the working tree re-fetches changes. Use `waitForResponse` to ensure the POST completes:
   ```typescript
   const [response] = await Promise.all([
       page.waitForResponse(resp => resp.url().includes('/git/changes/stage') && resp.status() === 200),
       page.getByTestId(`stage-btn-src/untracked.ts`).click(),
   ]);
   ```

### Key Selectors Reference

| Component | TestID Pattern | Notes |
|-----------|---------------|-------|
| CommitList container | `commit-list-{title-slug}` | title is lowercased, non-alnum → `-` |
| CommitList toggle | `commit-list-{title-slug}-toggle` | Collapse/expand header |
| Commit row | `commit-row-{shortHash}` | 7-char short hash |
| Commit files area | `commit-files-{shortHash}` | Visible when row expanded |
| File in commit | `commit-file-{index}` | 0-based index |
| Working tree root | `working-tree` | |
| Staged section | `working-tree-staged` | |
| Unstaged section | `working-tree-unstaged` | |
| Untracked section | `working-tree-untracked` | Collapsed by default |
| File row | `working-tree-file-row-{filePath}` | Full relative path |
| Stage button | `stage-btn-{filePath}` | On unstaged/untracked rows |
| Unstage button | `unstage-btn-{filePath}` | On staged rows |
| Discard button | `discard-btn-{filePath}` | On unstaged rows |
| Stage all | `working-tree-unstaged-stage-all` | |
| Unstage all | `working-tree-staged-unstage-all` | |
| Branch changes root | `branch-changes` | Renders null on default branch |
| Branch summary | `branch-changes-summary` | Shows "N commits ahead of..." |
| Branch files | `branch-changes-files` | Visible when header expanded |
| Branch file row | `branch-file-row-{filePath}` | |

### Getting Short Hashes for Selectors

The commit row test IDs use `shortHash` (first 7 chars). To get predictable selectors in tests, retrieve short hashes from the git log:

```typescript
const log = execSync('git log --oneline --format="%h %s"', {
    cwd: repoDir, encoding: 'utf-8'
}).trim().split('\n');
// log[0] = "abc1234 fix: update index" (most recent)
const shortHash = log[0].split(' ')[0];
```

Alternatively, just use `page.locator('[data-testid^="commit-row-"]').first()` to click the first commit row without hardcoding hashes.

### WorkingTree Section Headers

The `working-tree-untracked` section is collapsed by default (`defaultExpanded={false}` on line 508 of WorkingTree.tsx). Tests that assert on untracked files must first expand this section:

```typescript
await page.getByTestId('working-tree-untracked-header').click();
```

But note: the section auto-expands when `count > 0` goes from false to true (the `useEffect` on line 239). Since the data loads async, by the time the UI renders, if there are untracked files, the section should already be expanded. However, to be safe, check visibility first.

### Stage/Unstage Action Buttons Visibility

Action buttons (stage, unstage, discard) are hidden by default and shown on hover via CSS (`opacity-0 group-hover:opacity-100`). In Playwright, use `{ force: true }` to click hidden elements, or hover the row first:

```typescript
// Option A: hover first
await page.getByTestId('working-tree-file-row-src/index.ts').hover();
await page.getByTestId('stage-btn-src/index.ts').click();

// Option B: force click (simpler, recommended)
await page.getByTestId('stage-btn-src/index.ts').click({ force: true });
```

## Tests

### CommitList Tests

1. **`displays commit history after navigating to git tab`** — Create multi-commit repo, navigate to git tab, verify commit rows appear. Assert `[data-testid^="commit-row-"]` count ≥ 3. Verify commit subjects ("fix: update index", "feat: add utils", "feat: initial setup") are visible in the list.

2. **`expanding a commit row shows changed files`** — Click the first commit row (`commit-row-{hash}`). Wait for `commit-files-{hash}` to be visible and `commit-files-loading` to disappear. Assert `commit-file-list` is visible and contains at least one `commit-file-{i}` element.

3. **`collapsing an expanded commit row hides files`** — Expand a commit row, verify files visible. Click the same row again. Assert `commit-files-{hash}` is hidden.

### WorkingTree Tests

4. **`shows staged, unstaged, and untracked changes`** — Create dirty working tree repo, navigate to git tab. Assert `working-tree` is visible. Assert `working-tree-staged`, `working-tree-unstaged` sections are visible. Verify `working-tree-file-row-src/staged.ts` exists in staged section. Verify `working-tree-file-row-src/index.ts` exists in unstaged section. Verify `working-tree-file-row-src/untracked.ts` exists (may need to expand untracked section).

5. **`stage action moves file from unstaged to staged`** — Start with dirty repo. Hover `working-tree-file-row-src/index.ts` (unstaged). Click `stage-btn-src/index.ts` (force: true). Wait for `/git/changes/stage` response. Assert `working-tree-file-row-src/index.ts` now appears under `working-tree-staged` section (or simply assert the staged section count increased).

6. **`unstage action moves file from staged to unstaged`** — Start with dirty repo. Click `unstage-btn-src/staged.ts` (force: true). Wait for `/git/changes/unstage` response. Assert `src/staged.ts` now appears in the unstaged section.

7. **`discard action removes unstaged change`** — Start with dirty repo. Click `discard-btn-src/index.ts` (force: true). Wait for `/git/changes/discard` response. Assert `working-tree-file-row-src/index.ts` is no longer visible in the unstaged section (the file reverts to its committed content, so no change to show).

### BranchChanges Tests

8. **`branch changes section appears on feature branch`** — Create feature branch repo, navigate to git tab. Assert `branch-changes` is visible. Assert `branch-changes-summary` contains text matching "2 commits ahead" (since we added 2 commits on the feature branch).

9. **`branch changes section hidden on default branch`** — Create multi-commit repo (stays on default branch), navigate to git tab. Assert `branch-changes` is not visible (component returns null).

10. **`expanding branch changes shows changed files`** — Create feature branch repo, navigate to git tab. Click `branch-changes-header` to expand. Wait for `branch-changes-files` to be visible. Assert `branch-file-row-src/feature.ts` and `branch-file-row-src/feature-utils.ts` are present.

## Acceptance Criteria

- [x] `git-fixtures.ts` exports `createMultiCommitRepo`, `createDirtyWorkingTreeRepo`, `createFeatureBranchRepo` with proper cross-platform git commands
- [x] All fixture helpers use `execSync` with `shell: true` for `&&` chaining on Windows
- [x] All fixture helpers set `user.name` and `user.email` via `git config` (not `-c` flags) for reliability
- [x] `navigateToGitTab` helper encapsulates the 4-step navigation flow
- [x] CommitList tests verify row rendering, expand/collapse, and lazy file-list loading
- [x] WorkingTree tests verify staged/unstaged/untracked sections and stage/unstage/discard mutations
- [x] BranchChanges tests verify visibility on feature vs default branch and file-list display
- [x] All tests use `tmpDir` pattern from existing tests (`fs.mkdtempSync` + `safeRmSync` in finally block)
- [x] All tests pass on Windows, macOS, and Linux (no path separator assumptions)
- [x] No hardcoded short hashes — use dynamic selectors or git log parsing
- [x] Race conditions handled: wait for loading indicators to disappear before asserting content

## Dependencies

- Depends on: None (independent of 001-002)

## Assumed Prior State

None — uses only existing `repo-fixtures.ts` patterns, `server-fixture.ts` test harness, and `seed.ts` helpers. All git operations use `execSync` against real git repos in temp directories.
