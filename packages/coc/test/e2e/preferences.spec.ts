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
 * Add prompt fixtures so the Follow Prompt submenu has items to render.
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

/** Helper: open the Follow Prompt submenu for the first file row. Closes it first if already open. */
async function openFollowPromptDialog(page: import('@playwright/test').Page): Promise<void> {
    // Close dialog if already open (e.g. from previous call)
    const existing = page.locator('#follow-prompt-submenu');
    if (await existing.isVisible().catch(() => false)) {
        await page.locator('#fp-close').click();
        await existing.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
    }
    const fileRow = page.locator('.miller-file-row').first();
    await fileRow.locator('[data-action="ai-action"]').click();
    await page.locator('[data-ai-action="follow-prompt"]').click();
    await expect(page.locator('#follow-prompt-submenu')).toBeVisible();
}

/** Helper: open the Update Document modal for the first file row. Closes overlays first if open. */
async function openUpdateDocumentDialog(page: import('@playwright/test').Page): Promise<void> {
    // Close Follow Prompt dialog if open
    const fp = page.locator('#follow-prompt-submenu');
    if (await fp.isVisible().catch(() => false)) {
        await page.locator('#fp-close').click();
        await fp.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
    }
    const fileRow = page.locator('.miller-file-row').first();
    await fileRow.locator('[data-action="ai-action"]').click();
    await page.locator('[data-ai-action="update-document"]').click();
    await expect(page.locator('#update-doc-overlay')).toBeVisible();
}

/** Helper: get a valid non-default model value from the fp-model select (Follow Prompt dialog must be open). */
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

/** Helper: get a second non-default model value from the fp-model select (Follow Prompt dialog must be open). */
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

    // Mock /api/queue/models so Follow Prompt and Update Document dialogs have model options
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

    test('7P.2 selecting model in Follow Prompt persists to server', async ({ page, serverUrl }) => {
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

            // Verify preference was persisted by reading the API directly
            const res = await page.request.get(`${serverUrl}/api/preferences`);
            const prefs = await res.json();
            expect(prefs.lastModel).toBe(modelValue);
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

            const res = await page.request.get(`${serverUrl}/api/preferences`);
            const prefs = await res.json();
            expect(prefs.lastModel).toBe(modelValue);
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('7P.4 model preference applied to Follow Prompt dialog on open', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-prefs-'));
        try {
            await setupRepoForPrefs(page, serverUrl, tmpDir);
            await openFollowPromptDialog(page);

            const modelValue = await getFirstModelValue(page);
            expect(modelValue).toBeTruthy();

            // Pre-set preference via API
            await page.request.patch(`${serverUrl}/api/preferences`, {
                data: { lastModel: modelValue },
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

            // Pre-set preference via API
            await page.request.patch(`${serverUrl}/api/preferences`, {
                data: { lastModel: modelValue },
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

            // Open Follow Prompt and change model
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

            // Set model via Follow Prompt dialog
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
            const res = await page.request.get(`${serverUrl}/api/preferences`);
            const prefs = await res.json();
            expect(prefs.lastModel).toBe(model1);
        } finally {
            safeRmSync(tmpDir);
        }
    });
});
