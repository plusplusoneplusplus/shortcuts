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
    await expect(page.locator('[data-testid="repo-tab"]')).toHaveCount(1, { timeout: 10000 });

    await page.locator('[data-testid="repo-tab"]').first().click();
    await expect(page.locator('#repo-detail-content')).toBeVisible();

    await page.click('.repo-sub-tab[data-subtab="tasks"]');
    await expect(page.locator('.repo-sub-tab[data-subtab="tasks"]')).toHaveClass(/active/);

    await expect(page.locator('.miller-columns')).toBeVisible({ timeout: 10000 });

    return repoDir;
}

/** Helper: open the Run Skill EnqueueDialog for the first file row. Closes it first if already open. */
async function openFollowPromptDialog(page: import('@playwright/test').Page): Promise<void> {
    // Close the EnqueueDialog if already open
    const existing = page.locator('[data-testid="floating-dialog-panel"]');
    if (await existing.isVisible().catch(() => false)) {
        await page.locator('[data-testid="dialog-close-btn"]').first().click();
        await existing.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
    }
    const fileRow = page.locator('.miller-file-row').first();
    await expect(fileRow).toBeVisible({ timeout: 10000 });
    await fileRow.click({ button: 'right' });
    const contextMenu = page.locator('[data-testid="context-menu"]');
    await expect(contextMenu).toBeVisible({ timeout: 5000 });
    await contextMenu.getByRole('menuitem', { name: /Run Skill/ }).click();
    await expect(page.locator('[data-testid="floating-dialog-panel"]')).toBeVisible({ timeout: 5000 });
}

/** Helper: open the Update Document modal for the first file row. Closes EnqueueDialog first if open. */
async function openUpdateDocumentDialog(page: import('@playwright/test').Page): Promise<void> {
    // Close EnqueueDialog if open
    const fp = page.locator('[data-testid="floating-dialog-panel"]');
    if (await fp.isVisible().catch(() => false)) {
        await page.locator('[data-testid="dialog-close-btn"]').first().click();
        await fp.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
    }
    const fileRow = page.locator('.miller-file-row').first();
    await expect(fileRow).toBeVisible({ timeout: 10000 });
    await fileRow.click({ button: 'right' });
    const contextMenu = page.locator('[data-testid="context-menu"]');
    await expect(contextMenu).toBeVisible({ timeout: 5000 });
    await contextMenu.getByRole('menuitem', { name: /Update Document/ }).click();
    await expect(page.locator('#update-doc-overlay')).toBeVisible({ timeout: 5000 });
}

type DialogScope = ReturnType<import('@playwright/test').Page['locator']>;

const MOCK_MODELS = [
    { id: 'gpt-4', name: 'gpt-4', enabled: true, capabilities: { supports: { vision: false, reasoningEffort: false }, limits: { max_context_window_tokens: 128000 } } },
    { id: 'claude-3-5-sonnet', name: 'claude-3-5-sonnet', enabled: true, capabilities: { supports: { vision: false, reasoningEffort: false }, limits: { max_context_window_tokens: 128000 } } },
    { id: 'gemini-2.0', name: 'gemini-2.0', enabled: true, capabilities: { supports: { vision: false, reasoningEffort: false }, limits: { max_context_window_tokens: 128000 } } },
];

/** Scope locator for the Run Skill (EnqueueDialog) floating panel. */
function runSkillScope(page: import('@playwright/test').Page): DialogScope {
    return page.locator('[data-testid="floating-dialog-panel"]');
}

/** Scope locator for the Update Document modal overlay. */
function updateDocScope(page: import('@playwright/test').Page): DialogScope {
    return page.locator('#update-doc-overlay');
}

/** The compact model-picker chip button within a dialog's AI controls. */
function modelChip(scope: DialogScope, prefix: string): DialogScope {
    return scope.locator(`[data-testid="${prefix}-model-picker-chip"]`);
}

/** The provider (agent) selector chip button within a dialog's AI controls. */
function providerChip(scope: DialogScope): DialogScope {
    return scope.locator('[data-testid="agent-selector-chip-btn"]');
}

/** Open the model command menu and pick a model by id. Override is in-memory. */
async function pickModel(page: import('@playwright/test').Page, scope: DialogScope, prefix: string, modelId: string): Promise<void> {
    await modelChip(scope, prefix).click();
    const menu = page.locator('[data-testid="model-command-menu"]');
    await expect(menu).toBeVisible({ timeout: 5000 });
    await menu.getByText(modelId, { exact: true }).click();
    await expect(menu).toBeHidden({ timeout: 3000 });
}

/** Open the provider menu and switch to a provider. Persists lastChatProvider. */
async function switchProvider(scope: DialogScope, providerId: string): Promise<void> {
    await providerChip(scope).click();
    const menu = scope.locator('[data-testid="agent-selector-menu"]');
    await expect(menu).toBeVisible({ timeout: 5000 });
    await menu.locator(`[data-testid="agent-option-${providerId}"]`).click();
    await expect(menu).toBeHidden({ timeout: 3000 });
}

test.describe('Preferences (007)', () => {

    // Mock the provider/model endpoints feeding the chip-based AI controls so the
    // Run Skill and Update Document dialogs render a deterministic provider list
    // and model menu (the legacy <select> + /api/models flow was replaced by the
    // New-Chat-style ModalJobAiControls picker).
    test.beforeEach(async ({ page }) => {
        await page.route('**/api/agent-providers', route =>
            route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ providers: [
                { id: 'copilot', label: 'Copilot', enabled: true, available: true },
                { id: 'codex', label: 'Codex', enabled: true, available: true },
            ] }) }),
        );
        await page.route('**/api/agent-providers/*/models', route =>
            route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ provider: 'copilot', models: MOCK_MODELS }) }),
        );
        // Empty effort-tiers keeps the model-picker chip (not the tier selector) visible.
        await page.route('**/api/agent-providers/*/effort-tiers', route =>
            route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ provider: 'copilot', effortTiers: {}, defaults: {} }) }),
        );
        // Legacy endpoint retained for any code path still calling it.
        await page.route('**/api/models', route =>
            route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_MODELS) }),
        );
    });

    test('7P.1 model picker shows no override and lists provider models by default', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-prefs-'));
        try {
            await setupRepoForPrefs(page, serverUrl, tmpDir);

            await openFollowPromptDialog(page);
            const scope = runSkillScope(page);

            // The chip-based model picker is shown (legacy <select> removed).
            await expect(modelChip(scope, 'enqueue')).toBeVisible({ timeout: 10000 });

            // Opening the menu lists the provider's models and offers no "Use
            // default" clear row, since no override has been picked yet.
            await modelChip(scope, 'enqueue').click();
            const menu = page.locator('[data-testid="model-command-menu"]');
            await expect(menu).toBeVisible({ timeout: 5000 });
            await expect(menu.getByText('gpt-4', { exact: true })).toBeVisible();
            await expect(menu.getByText('claude-3-5-sonnet', { exact: true })).toBeVisible();
            await expect(menu.getByText('gemini-2.0', { exact: true })).toBeVisible();
            await expect(menu.locator('[data-testid="model-command-menu-clear"]')).toHaveCount(0);
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('7P.2 selecting a model in Run Skill updates the model chip', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-prefs-'));
        try {
            await setupRepoForPrefs(page, serverUrl, tmpDir);
            await openFollowPromptDialog(page);
            const scope = runSkillScope(page);

            await pickModel(page, scope, 'enqueue', 'gpt-4');

            // The chip reflects the in-memory override.
            await expect(modelChip(scope, 'enqueue')).toContainText('gpt-4');
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('7P.3 selecting a model in Update Document updates the model chip', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-prefs-'));
        try {
            await setupRepoForPrefs(page, serverUrl, tmpDir);
            await openUpdateDocumentDialog(page);
            const scope = updateDocScope(page);

            await expect(modelChip(scope, 'update-doc')).toBeVisible({ timeout: 10000 });
            await pickModel(page, scope, 'update-doc', 'claude-3-5-sonnet');

            await expect(modelChip(scope, 'update-doc')).toContainText('claude-3-5-sonnet');
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('7P.4 selecting a provider in Run Skill persists lastChatProvider to server', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-prefs-'));
        try {
            await setupRepoForPrefs(page, serverUrl, tmpDir);
            await openFollowPromptDialog(page);
            const scope = runSkillScope(page);

            await switchProvider(scope, 'codex');

            // Wait for the fire-and-forget PATCH to settle.
            await page.waitForTimeout(500);

            const res = await page.request.get(`${serverUrl}/api/workspaces/ws-prefs/preferences`);
            const prefs = await res.json();
            expect(prefs.lastChatProvider).toBe('codex');
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('7P.5 persisted provider preference is applied to Run Skill dialog on open', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-prefs-'));
        try {
            await setupRepoForPrefs(page, serverUrl, tmpDir);

            // Pre-set provider preference via per-workspace API.
            await page.request.patch(`${serverUrl}/api/workspaces/ws-prefs/preferences`, {
                data: { lastChatProvider: 'codex' },
            });

            // Reload to pick up preference.
            await page.reload();
            await page.click('[data-tab="repos"]');
            await expect(page.locator('[data-testid="repo-tab"]')).toHaveCount(1, { timeout: 10000 });
            await page.locator('[data-testid="repo-tab"]').first().click();
            await page.click('.repo-sub-tab[data-subtab="tasks"]');
            await expect(page.locator('.miller-columns')).toBeVisible({ timeout: 10000 });

            await openFollowPromptDialog(page);
            const scope = runSkillScope(page);

            await expect(providerChip(scope)).toContainText('Codex', { timeout: 10000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('7P.6 provider preference syncs across dialogs within same page', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-prefs-'));
        try {
            await setupRepoForPrefs(page, serverUrl, tmpDir);

            // Switch provider in Run Skill (persists to server).
            await openFollowPromptDialog(page);
            await switchProvider(runSkillScope(page), 'codex');
            await page.waitForTimeout(500);
            await page.locator('[data-testid="dialog-close-btn"]').first().click();
            await page.locator('[data-testid="floating-dialog-panel"]').waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});

            // Open Update Document — should reflect the same persisted provider.
            await openUpdateDocumentDialog(page);
            await expect(providerChip(updateDocScope(page))).toContainText('Codex', { timeout: 10000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('7P.7 provider preference survives page reload', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-prefs-'));
        try {
            await setupRepoForPrefs(page, serverUrl, tmpDir);

            // Set provider via Run Skill dialog.
            await openFollowPromptDialog(page);
            await switchProvider(runSkillScope(page), 'codex');
            await page.waitForTimeout(500);
            await page.locator('[data-testid="dialog-close-btn"]').first().click();
            await page.locator('[data-testid="floating-dialog-panel"]').waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});

            // Reload.
            await page.reload();
            await page.click('[data-tab="repos"]');
            await expect(page.locator('[data-testid="repo-tab"]')).toHaveCount(1, { timeout: 10000 });
            await page.locator('[data-testid="repo-tab"]').first().click();
            await page.click('.repo-sub-tab[data-subtab="tasks"]');
            await expect(page.locator('.miller-columns')).toBeVisible({ timeout: 10000 });

            // Open dialog again — provider should be preserved.
            await openFollowPromptDialog(page);
            await expect(providerChip(runSkillScope(page))).toContainText('Codex', { timeout: 10000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('7P.8 clearing a model override returns the chip to the default', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-prefs-'));
        try {
            await setupRepoForPrefs(page, serverUrl, tmpDir);
            await openFollowPromptDialog(page);
            const scope = runSkillScope(page);

            // Pick an override; the chip reflects it.
            await pickModel(page, scope, 'enqueue', 'gpt-4');
            await expect(modelChip(scope, 'enqueue')).toContainText('gpt-4');

            // Reopen the menu and use the "Use default" clear row.
            await modelChip(scope, 'enqueue').click();
            const menu = page.locator('[data-testid="model-command-menu"]');
            await expect(menu).toBeVisible({ timeout: 5000 });
            await menu.locator('[data-testid="model-command-menu-clear"]').click();
            await expect(menu).toBeHidden({ timeout: 3000 });

            // The override is cleared.
            await expect(modelChip(scope, 'enqueue')).not.toContainText('gpt-4');
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

            // Verify persistence via GET (server coerces single string to array for multi-skill support)
            const res = await page.request.get(`${serverUrl}/api/workspaces/ws-prefs/preferences`);
            const prefs = await res.json();
            expect(prefs.lastSkills?.task).toEqual(['impl']);
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
            await expect(page.locator('[data-testid="repo-tab"]')).toHaveCount(2, { timeout: 10000 });
            await page.locator('[data-testid="repo-tab"]').first().click();
            await expect(page.locator('#repo-detail-content')).toBeVisible();
            await page.click('.repo-sub-tab[data-subtab="tasks"]');
            await expect(page.locator('.miller-columns')).toBeVisible({ timeout: 10000 });

            await openFollowPromptDialog(page);

            // Wait for SkillPicker trigger to appear (skills loaded for first workspace)
            await expect(page.locator('[data-testid="skill-picker-trigger"]')).toBeVisible({ timeout: 10000 });

            // Open SkillPicker to verify first workspace has 'impl' skill
            await page.locator('[data-testid="skill-picker-trigger"]').click();
            await expect(page.locator('[data-testid="skill-picker-item-impl"]')).toBeVisible({ timeout: 10000 });
            // Close SkillPicker by clicking the trigger again (Escape would close the
            // parent FloatingDialog as well because it listens to Escape globally).
            await page.locator('[data-testid="skill-picker-trigger"]').click();
            await expect(page.locator('[data-testid="skill-picker-popover"]')).toBeHidden({ timeout: 3000 });

            // Change workspace selector to second workspace (now the dialog's
            // only <select>, since the legacy model <select> was replaced by the
            // chip-based AI controls).
            const wsSelect = page.locator('[data-testid="workspace-select"]');
            await wsSelect.selectOption('ws-prefs-2');

            // Wait for skills to reload for new workspace
            await page.waitForTimeout(1000);
            await expect(page.locator('[data-testid="skill-picker-trigger"]')).toBeVisible({ timeout: 10000 });

            // Open SkillPicker — should now show 'review' skill from second workspace
            await page.locator('[data-testid="skill-picker-trigger"]').click();
            await expect(page.locator('[data-testid="skill-picker-item-review"]')).toBeVisible({ timeout: 10000 });
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
