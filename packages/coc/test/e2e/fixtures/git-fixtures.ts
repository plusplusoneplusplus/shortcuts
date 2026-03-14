/**
 * Git-specific Fixture Helpers for E2E Tests
 *
 * Creates repos with multiple commits, dirty working trees, and feature
 * branches so the Git sub-tab components have realistic data to render.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { seedWorkspace } from './seed';

/**
 * Create a repo with 3 commits for CommitList tests.
 *
 * Commits (newest→oldest):
 *  1. "fix: update index"   — modifies src/index.ts
 *  2. "feat: add utils"     — adds src/utils.ts
 *  3. "feat: initial setup" — adds src/index.ts
 */
export function createMultiCommitRepo(tmpDir: string): string {
    const repoDir = path.join(tmpDir, 'test-repo');
    fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });

    execSync('git init', { cwd: repoDir, stdio: 'ignore' });
    execSync('git config user.name "test"', { cwd: repoDir, stdio: 'ignore' });
    execSync('git config user.email "test@test"', { cwd: repoDir, stdio: 'ignore' });

    // Commit 1: initial file
    fs.writeFileSync(path.join(repoDir, 'src', 'index.ts'), 'export default {};\n');
    execSync('git add -A && git commit -m "feat: initial setup"', {
        cwd: repoDir, stdio: 'ignore', shell: true as any,
    });

    // Commit 2: add a second file
    fs.writeFileSync(path.join(repoDir, 'src', 'utils.ts'), 'export function helper() {}\n');
    execSync('git add -A && git commit -m "feat: add utils"', {
        cwd: repoDir, stdio: 'ignore', shell: true as any,
    });

    // Commit 3: modify existing file
    fs.writeFileSync(path.join(repoDir, 'src', 'index.ts'), 'export default { version: 2 };\n');
    execSync('git add -A && git commit -m "fix: update index"', {
        cwd: repoDir, stdio: 'ignore', shell: true as any,
    });

    return repoDir;
}

/**
 * Create a repo with staged, unstaged, and untracked changes for WorkingTree tests.
 *
 * Based on createMultiCommitRepo, then adds:
 *  - Unstaged: modifies src/index.ts without staging
 *  - Staged: adds src/staged.ts and stages it
 *  - Untracked: creates src/untracked.ts without adding
 */
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

/**
 * Create a repo on a feature branch with 2 commits ahead of the default branch.
 *
 * Based on createMultiCommitRepo, then:
 *  - Creates and checks out `feature/test-branch`
 *  - Adds 2 commits: src/feature.ts, src/feature-utils.ts
 */
export function createFeatureBranchRepo(tmpDir: string): string {
    const repoDir = createMultiCommitRepo(tmpDir);

    // Create and switch to feature branch
    execSync('git checkout -b feature/test-branch', { cwd: repoDir, stdio: 'ignore' });

    // Add commits on the feature branch
    fs.writeFileSync(path.join(repoDir, 'src', 'feature.ts'), 'export const feature = true;\n');
    execSync('git add -A && git commit -m "feat: add feature module"', {
        cwd: repoDir, stdio: 'ignore', shell: true as any,
    });

    fs.writeFileSync(path.join(repoDir, 'src', 'feature-utils.ts'), 'export function fHelper() {}\n');
    execSync('git add -A && git commit -m "feat: add feature utils"', {
        cwd: repoDir, stdio: 'ignore', shell: true as any,
    });

    return repoDir;
}

/**
 * Create a repo with multiple unstaged files for Stage All tests.
 *
 * Based on createMultiCommitRepo, then adds:
 *  - Unstaged: modifies src/index.ts and src/utils.ts without staging
 *  - Staged: adds src/staged.ts and stages it
 *  - Untracked: creates src/untracked1.ts and src/untracked2.ts without adding
 */
export function createDirtyWorkingTreeRepoMultiple(tmpDir: string): string {
    const repoDir = createMultiCommitRepo(tmpDir);

    // Unstaged changes: modify tracked files
    fs.writeFileSync(path.join(repoDir, 'src', 'index.ts'), 'export default { dirty: true };\n');
    fs.writeFileSync(path.join(repoDir, 'src', 'utils.ts'), 'export function helper() { return 1; }\n');

    // Staged change
    fs.writeFileSync(path.join(repoDir, 'src', 'staged.ts'), 'export const staged = true;\n');
    execSync('git add src/staged.ts', { cwd: repoDir, stdio: 'ignore' });

    // Untracked files
    fs.writeFileSync(path.join(repoDir, 'src', 'untracked1.ts'), '// new file 1\n');
    fs.writeFileSync(path.join(repoDir, 'src', 'untracked2.ts'), '// new file 2\n');

    return repoDir;
}

/**
 * Create a repo with a local remote and unpushed commits.
 *
 * Creates a bare remote, clones it, pushes initial commits, then adds
 * one more commit without pushing — so the API returns unpushedCount > 0.
 */
export function createRepoWithUnpushedCommits(tmpDir: string): string {
    const bareDir = path.join(tmpDir, 'bare-remote.git');
    const repoDir = path.join(tmpDir, 'work-repo');

    // Create a bare remote
    fs.mkdirSync(bareDir, { recursive: true });
    execSync('git init --bare', { cwd: bareDir, stdio: 'ignore' });

    // Clone the bare remote
    execSync(`git clone "${bareDir}" "${repoDir}"`, { stdio: 'ignore' });
    execSync('git config user.name "test"', { cwd: repoDir, stdio: 'ignore' });
    execSync('git config user.email "test@test"', { cwd: repoDir, stdio: 'ignore' });

    // Initial commits pushed to remote
    fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(repoDir, 'src', 'index.ts'), 'export default {};\n');
    execSync('git add -A && git commit -m "feat: initial setup"', {
        cwd: repoDir, stdio: 'ignore', shell: true as any,
    });
    fs.writeFileSync(path.join(repoDir, 'src', 'utils.ts'), 'export function helper() {}\n');
    execSync('git add -A && git commit -m "feat: add utils"', {
        cwd: repoDir, stdio: 'ignore', shell: true as any,
    });
    execSync('git push origin HEAD', { cwd: repoDir, stdio: 'ignore' });

    // Unpushed commit (not pushed to remote)
    fs.writeFileSync(path.join(repoDir, 'src', 'index.ts'), 'export default { v: 2 };\n');
    execSync('git add -A && git commit -m "fix: local-only change"', {
        cwd: repoDir, stdio: 'ignore', shell: true as any,
    });

    return repoDir;
}

/**
 * Navigate from the SPA root to the Git sub-tab for a given workspace.
 *
 * Steps:
 *  1. Seed the workspace pointing at a real repo directory
 *  2. Open the SPA and click the repos tab
 *  3. Wait for the repo to appear and click it
 *  4. Click the Git sub-tab
 */
export async function navigateToGitTab(
    page: Page,
    serverUrl: string,
    wsId: string,
    wsName: string,
    repoDir: string,
): Promise<void> {
    await seedWorkspace(serverUrl, wsId, wsName, repoDir);

    await page.goto(serverUrl);
    // Repos is the default view — select repo via RepoTabStrip in TopBar
    await expect(page.locator('[data-testid="repo-tab"]')).toHaveCount(1, { timeout: 10_000 });
    await page.locator('[data-testid="repo-tab"]').first().click();
    await expect(page.locator('#repo-detail-content')).toBeVisible();

    await page.click('.repo-sub-tab[data-subtab="git"]');
    await expect(page.locator('.repo-sub-tab[data-subtab="git"]')).toHaveClass(/active/);
}
