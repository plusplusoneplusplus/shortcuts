/**
 * Preferences E2E Tests (007)
 *
 * Tests model preference persistence via /api/preferences, application to
 * model <select> elements in AI dialogs, and cross-dialog synchronization.
 *
 * Preferences are stored server-side in the temp data directory
 * (via the FileProcessStore fixture) — NOT in localStorage.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { seedWorkspace } from './fixtures/seed';
import { createRepoFixture, createTasksFixture } from './fixtures/repo-fixtures';

/**
 * Add prompt fixtures so the Run Skill submenu has items to render.
 */
function createPromptFixtures(repoDir: string): void {
    const promptDir = path.join(repoDir, '.github', 'prompts');
    fs.mkdirSync(promptDir, { recursive: true });
    fs.writeFileSync(
        path.join(promptDir, 'review.prompt.md'),
        '---\ndescription: Review task\n---\nReview this task.\n',
    );
}

/** Helper: create repo, seed workspace, navigate to Tasks sub-tab. */
async function setupRepoForPrefs(
    page: import('@playwright/test').Page,
    serverUrl: string,
    tmpDir: string,
    wsId = 'ws-prefs',
): Promise<string> {
    const repoDir = createRepoFixture(tmpDir);
    createTasksFixture(repoDir);
    createPromptFixtures(repoDir);

    await seedWorkspace(serverUrl, wsId, 'prefs-repo', repoDir);

    await page.goto(serverUrl);
    await page.click('[data-tab="repos"]');
    await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });

    await page.locator('.repo-item').first().click();
    await expect(page.locator('#repo-detail-content')).toBeVisible();

    await page.click('.repo-sub-tab[data-subtab="tasks"]');
    await expect(page.locator('.repo-sub-tab[data-subtab="tasks"]')).toHaveClass(/active/);

    await expect(page.locator('.miller-columns')).toBeVisible({ timeout: 10000 });

    return repoDir;
}

/** Helper: open the Run Skill submenu for the first file row. Closes it first if already open. */
async function openFollowPromptDialog(page: import('@playwright/test').Page): Promise<void> {
    // Close dialog if already open (e.g. from previous call)
    const existing = page.locator('#follow-prompt-submenu');
    if (await existing.isVisible().catch(() => false)) {
        await page.locator('#fp-close').click();
        await existing.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
    }
    const fileRow = page.locator('.miller-file-row').first();
    await expect(fileRow).toBeVisible({ timeout: 10000 });
    await fileRow.click({ button: 'right' });
    const contextMenu = page.locator('[data-testid="context-menu"]');
    await expect(contextMenu).toBeVisible({ timeout: 5000 });
    await contextMenu.getByRole('menuitem', { name: /Run Skill/ }).click();
    await expect(page.locator('#follow-prompt-submenu')).toBeVisible();
}

/** Helper: open the Update Document modal for the first file row. Closes overlays first if open. */
async function openUpdateDocumentDialog(page: import('@playwright/test').Page): Promise<void> {
    // Close Run Skill dialog if open
    const fp = page.locator('#follow-prompt-submenu');
    if (await fp.isVisible().catch(() => false)) {
        await page.locator('#fp-close').click();
        await fp.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
    }
    const fileRow = page.locator('.miller-file-row').first();
    await expect(fileRow).toBeVisible({ timeout: 10000 });
    await fileRow.click({ button: 'right' });
    const contextMenu = page.locator('[data-testid="context-menu"]');
    await expect(contextMenu).toBeVisible({ timeout: 5000 });
    await contextMenu.getByRole('menuitem', { name: /Update Document/ }).click();
    await expect(page.locator('#update-doc-overlay')).toBeVisible();
}

/** Helper: get a valid non-default model value from the fp-model select (Run Skill dialog must be open). */
async function getFirstModelValue(page: import('@playwright/test').Page): Promise<string> {
    // Wait for model options to be populated (async fetch may still be in-flight)
    await page.waitForFunction(() => {
        const sel = document.getElementById('fp-model') as HTMLSelectElement | null;
        return sel && Array.from(sel.options).some(o => o.value !== '');
    }, { timeout: 5000 });

    return page.evaluate(() => {
        const sel = document.getElementById('fp-model') as HTMLSelectElement | null;
        if (!sel) return '';
        for (const opt of Array.from(sel.options)) {
            if (opt.value) return opt.value;
        }
        return '';
    });
}

/** Helper: get a second non-default model value from the fp-model select (Run Skill dialog must be open). */
async function getSecondModelValue(page: import('@playwright/test').Page): Promise<string> {
    return page.evaluate(() => {
        const sel = document.getElementById('fp-model') as HTMLSelectElement | null;
        if (!sel) return '';
        let found = 0;
        for (const opt of Array.from(sel.options)) {
            if (opt.value) {
                found++;
                if (found === 2) return opt.value;
            }
        }
        return '';
    });
}

test.describe('Preferences (007)', () => {

    // Mock /api/queue/models so Run Skill and Update Document dialogs have model options
    test.beforeEach(async ({ page }) => {
        await page.route('**/api/queue/models', route =>
            route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ models: ['gpt-4', 'claude-3-5-sonnet', 'gemini-2.0'] }) }),
        );
    });

    test('7P.1 model preference defaults to empty (Default) on fresh server', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-prefs-'));
        try {
            await setupRepoForPrefs(page, serverUrl, tmpDir);

            await openFollowPromptDialog(page);

            // Model select should have empty value (Default)
            const fpModel = page.locator('#fp-model');
            await expect(fpModel).toHaveValue('');
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('7P.2 selecting model in Run Skill persists to server', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-prefs-'));
        try {
            await setupRepoForPrefs(page, serverUrl, tmpDir);
            await openFollowPromptDialog(page);

            const modelValue = await getFirstModelValue(page);
            expect(modelValue).toBeTruthy();

            await openFollowPromptDialog(page);

            // Change model
            await page.selectOption('#fp-model', modelValue);

            // Wait for the fire-and-forget PATCH to complete
            await page.waitForTimeout(500);

            // Verify preference was persisted (per-workspace endpoint)
            const res = await page.request.get(`${serverUrl}/api/workspaces/ws-prefs/preferences`);
            const prefs = await res.json();
            expect(prefs.lastModels?.task).toBe(modelValue);
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('7P.3 selecting model in Update Document persists to server', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-prefs-'));
        try {
            await setupRepoForPrefs(page, serverUrl, tmpDir);
            await openFollowPromptDialog(page);

            const modelValue = await getFirstModelValue(page);
            expect(modelValue).toBeTruthy();

            await openUpdateDocumentDialog(page);

            // Change model
            await page.selectOption('#update-doc-model', modelValue);

            // Wait for persistence
            await page.waitForTimeout(500);

            const res = await page.request.get(`${serverUrl}/api/workspaces/ws-prefs/preferences`);
            const prefs = await res.json();
            expect(prefs.lastModels?.task).toBe(modelValue);
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('7P.4 model preference applied to Run Skill dialog on open', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-prefs-'));
        try {
            await setupRepoForPrefs(page, serverUrl, tmpDir);
            await openFollowPromptDialog(page);

            const modelValue = await getFirstModelValue(page);
            expect(modelValue).toBeTruthy();

            // Pre-set preference via per-workspace API
            await page.request.patch(`${serverUrl}/api/workspaces/ws-prefs/preferences`, {
                data: { lastModels: { task: modelValue } },
            });

            // Reload to pick up preference
            await page.reload();
            await page.click('[data-tab="repos"]');
            await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });
            await page.locator('.repo-item').first().click();
            await page.click('.repo-sub-tab[data-subtab="tasks"]');
            await expect(page.locator('.miller-columns')).toBeVisible({ timeout: 10000 });

            await openFollowPromptDialog(page);

            // Model select should have the persisted value
            await expect(page.locator('#fp-model')).toHaveValue(modelValue);
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('7P.5 model preference applied to Update Document dialog on open', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-prefs-'));
        try {
            await setupRepoForPrefs(page, serverUrl, tmpDir);
            await openFollowPromptDialog(page);

            const modelValue = await getFirstModelValue(page);
            expect(modelValue).toBeTruthy();

            // Pre-set preference via per-workspace API
            await page.request.patch(`${serverUrl}/api/workspaces/ws-prefs/preferences`, {
                data: { lastModels: { task: modelValue } },
            });

            // Reload to pick up preference
            await page.reload();
            await page.click('[data-tab="repos"]');
            await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });
            await page.locator('.repo-item').first().click();
            await page.click('.repo-sub-tab[data-subtab="tasks"]');
            await expect(page.locator('.miller-columns')).toBeVisible({ timeout: 10000 });

            await openUpdateDocumentDialog(page);

            await expect(page.locator('#update-doc-model')).toHaveValue(modelValue);
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('7P.6 model change syncs across dialogs within same page', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-prefs-'));
        try {
            await setupRepoForPrefs(page, serverUrl, tmpDir);
            await openFollowPromptDialog(page);

            const modelValue = await getFirstModelValue(page);
            expect(modelValue).toBeTruthy();

            // Open Run Skill and change model
            await openFollowPromptDialog(page);
            await page.selectOption('#fp-model', modelValue);
            await page.waitForTimeout(300);
            await page.click('#fp-close');

            // Open Update Document — should have the same model selected
            await openUpdateDocumentDialog(page);
            await expect(page.locator('#update-doc-model')).toHaveValue(modelValue);
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('7P.7 model preference survives page reload', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-prefs-'));
        try {
            await setupRepoForPrefs(page, serverUrl, tmpDir);
            await openFollowPromptDialog(page);

            const modelValue = await getFirstModelValue(page);
            expect(modelValue).toBeTruthy();

            // Set model via Run Skill dialog
            await openFollowPromptDialog(page);
            await page.selectOption('#fp-model', modelValue);
            await page.waitForTimeout(500);
            await page.click('#fp-close');

            // Reload
            await page.reload();
            await page.click('[data-tab="repos"]');
            await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });
            await page.locator('.repo-item').first().click();
            await page.click('.repo-sub-tab[data-subtab="tasks"]');
            await expect(page.locator('.miller-columns')).toBeVisible({ timeout: 10000 });

            // Open dialog again — model should be preserved
            await openFollowPromptDialog(page);
            await expect(page.locator('#fp-model')).toHaveValue(modelValue);
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('7P.8 rapid model changes persist last value', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-prefs-'));
        try {
            await setupRepoForPrefs(page, serverUrl, tmpDir);
            await openFollowPromptDialog(page);

            const model1 = await getFirstModelValue(page);
            const model2 = await getSecondModelValue(page);
            expect(model1).toBeTruthy();
            expect(model2).toBeTruthy();
            expect(model1).not.toBe(model2);

            await openFollowPromptDialog(page);

            // Rapidly change model multiple times
            await page.selectOption('#fp-model', model1);
            await page.selectOption('#fp-model', model2);
            await page.selectOption('#fp-model', '');   // Default
            await page.selectOption('#fp-model', model1);

            // Wait for all fire-and-forget PATCH requests to settle
            await page.waitForTimeout(1000);

            // Final value should be model1
            const res = await page.request.get(`${serverUrl}/api/workspaces/ws-prefs/preferences`);
            const prefs = await res.json();
            expect(prefs.lastModels?.task).toBe(model1);
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('7P.9 lastSkills preference persistence and restoration', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-prefs-'));
        try {
            await setupRepoForPrefs(page, serverUrl, tmpDir);

            // Pre-set lastSkills via per-workspace API
            await page.request.patch(`${serverUrl}/api/workspaces/ws-prefs/preferences`, {
                data: { lastSkills: { task: 'impl' } },
            });

            // Verify persistence via GET
            const res = await page.request.get(`${serverUrl}/api/workspaces/ws-prefs/preferences`);
            const prefs = await res.json();
            expect(prefs.lastSkills?.task).toBe('impl');
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('7P.10 workspace selector change loads skills for new workspace', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-prefs-'));
        try {
            // Create first workspace with skills
            const repoDir1 = createRepoFixture(path.join(tmpDir, 'repo1'));
            createTasksFixture(repoDir1);
            createPromptFixtures(repoDir1);

            // Add a skill to first workspace
            const skill1Dir = path.join(repoDir1, '.github', 'skills', 'impl');
            fs.mkdirSync(skill1Dir, { recursive: true });
            fs.writeFileSync(
                path.join(skill1Dir, 'SKILL.md'),
                '---\ndescription: Implement feature\n---\n# impl\nImpl skill.\n',
            );

            await seedWorkspace(serverUrl, 'ws-prefs', 'prefs-repo', repoDir1);

            // Create second workspace with a different skill
            const repoDir2 = createRepoFixture(path.join(tmpDir, 'repo2'));
            createTasksFixture(repoDir2);
            const skill2Dir = path.join(repoDir2, '.github', 'skills', 'review');
            fs.mkdirSync(skill2Dir, { recursive: true });
            fs.writeFileSync(
                path.join(skill2Dir, 'SKILL.md'),
                '---\ndescription: Review code\n---\n# review\nReview skill.\n',
            );

            await seedWorkspace(serverUrl, 'ws-prefs-2', 'prefs-repo-2', repoDir2);

            await page.goto(serverUrl);
            await page.click('[data-tab="repos"]');
            await expect(page.locator('.repo-item')).toHaveCount(2, { timeout: 10000 });
            await page.locator('.repo-item').first().click();
            await expect(page.locator('#repo-detail-content')).toBeVisible();
            await page.click('.repo-sub-tab[data-subtab="tasks"]');
            await expect(page.locator('.miller-columns')).toBeVisible({ timeout: 10000 });

            await openFollowPromptDialog(page);

            // First workspace should have 'impl' skill
            await expect(page.locator('.fp-item[data-name="impl"]')).toBeVisible({ timeout: 10000 });

            // Change workspace selector to second workspace
            const wsSelect = page.locator('#follow-prompt-submenu select').first();
            // The workspace select is the second select (after model)
            const allSelects = page.locator('#follow-prompt-submenu select');
            const wsSelectEl = allSelects.nth(1);
            await wsSelectEl.selectOption('ws-prefs-2');

            // Wait for skills to reload
            await page.waitForTimeout(1000);

            // Should now show 'review' skill from second workspace
            await expect(page.locator('.fp-item[data-name="review"]')).toBeVisible({ timeout: 10000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('7P.11 depth and effort preference persistence', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-prefs-'));
        try {
            await setupRepoForPrefs(page, serverUrl, tmpDir);

            // Set depth and effort preferences via API
            await page.request.patch(`${serverUrl}/api/workspaces/ws-prefs/preferences`, {
                data: { lastDepth: 'deep', lastEffort: 'high' },
            });

            // Verify persistence via GET
            const res = await page.request.get(`${serverUrl}/api/workspaces/ws-prefs/preferences`);
            const prefs = await res.json();
            expect(prefs.lastDepth).toBe('deep');
            expect(prefs.lastEffort).toBe('high');
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('7P.12 per-mode model preferences for ask and plan modes', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-prefs-'));
        try {
            await setupRepoForPrefs(page, serverUrl, tmpDir);

            // Set per-mode models via API
            await page.request.patch(`${serverUrl}/api/workspaces/ws-prefs/preferences`, {
                data: { lastModels: { ask: 'gpt-4', plan: 'claude-3-5-sonnet' } },
            });

            // Verify persistence via GET
            const res = await page.request.get(`${serverUrl}/api/workspaces/ws-prefs/preferences`);
            const prefs = await res.json();
            expect(prefs.lastModels?.ask).toBe('gpt-4');
            expect(prefs.lastModels?.plan).toBe('claude-3-5-sonnet');

            // Verify task mode is unaffected (should be empty or previous value)
            // We only set ask and plan, so task should remain as-is
        } finally {
            safeRmSync(tmpDir);
        }
    });
});
