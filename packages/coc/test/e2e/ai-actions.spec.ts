/**
 * AI Actions E2E Tests (007)
 *
 * Tests AI action dropdown on task file rows, Run Skill / Update Document
 * dialogs, API enqueue calls, and error handling.
 *
 * Depends on createRepoFixture + createTasksFixture for on-disk task files,
 * plus prompt/skill fixture files for the Run Skill discovery flow.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { seedWorkspace, request } from './fixtures/seed';
import { createRepoFixture, createTasksFixture } from './fixtures/repo-fixtures';

/** Poll GET /api/queue/:id until status matches or timeout expires. */
async function waitForTaskStatus(
    serverUrl: string,
    taskId: string,
    targetStatuses: string[],
    timeoutMs = 15_000,
    intervalMs = 250,
): Promise<Record<string, unknown>> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const res = await request(`${serverUrl}/api/queue/${taskId}`);
        if (res.status === 200) {
            const json = JSON.parse(res.body);
            const task = json.task ?? json;
            if (targetStatuses.includes(task.status as string)) {
                return task;
            }
        }
        await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error(`Task ${taskId} did not reach ${targetStatuses.join('|')} within ${timeoutMs}ms`);
}

/**
 * Add .prompt.md files and a skill directory so the Run Skill submenu
 * has items to render.
 */
function createPromptAndSkillFixtures(repoDir: string): void {
    const promptDir = path.join(repoDir, '.github', 'prompts');
    fs.mkdirSync(promptDir, { recursive: true });
    fs.writeFileSync(
        path.join(promptDir, 'review.prompt.md'),
        '---\ndescription: Review task\n---\nReview this task and suggest improvements.\n',
    );

    const skillDir = path.join(repoDir, '.github', 'skills', 'impl');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
        path.join(skillDir, 'SKILL.md'),
        '---\ndescription: Implement feature\n---\n# impl\nImplement the feature described in the task.\n',
    );
}

/** Helper: create a repo with tasks + skills, navigate to Tasks sub-tab. */
async function setupRepoWithAIActions(
    page: import('@playwright/test').Page,
    serverUrl: string,
    tmpDir: string,
    wsId = 'ws-ai-actions',
): Promise<string> {
    const repoDir = createRepoFixture(tmpDir);
    createTasksFixture(repoDir);
    createPromptAndSkillFixtures(repoDir);

    await seedWorkspace(serverUrl, wsId, 'ai-actions-repo', repoDir);

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

test.describe('AI Actions (007)', () => {

    test('7.1 right-click file row shows AI actions in context menu', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ai-'));
        try {
            await setupRepoWithAIActions(page, serverUrl, tmpDir);

            const fileRow = page.locator('.miller-file-row').first();
            await expect(fileRow).toBeVisible();

            await fileRow.click({ button: 'right' });

            // Context menu should contain AI action items
            await expect(page.locator('text=✨ Run Skill')).toBeVisible({ timeout: 5000 });
            await expect(page.locator('text=✨ Update Document')).toBeVisible({ timeout: 5000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('7.2 Run Skill via context menu opens submenu with skills', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ai-'));
        try {
            await setupRepoWithAIActions(page, serverUrl, tmpDir);

            const fileRow = page.locator('.miller-file-row').first();
            await fileRow.click({ button: 'right' });
            await page.locator('text=✨ Run Skill').click();

            // Run Skill dialog should appear (title === 'Run Skill' when context files present)
            const overlay = page.locator('[data-testid="floating-dialog-panel"]');
            await expect(overlay).toBeVisible({ timeout: 5000 });
            await expect(overlay).toContainText('Run Skill');

            // Open the SkillPicker popover and ensure the "impl" skill is available
            await page.locator('[data-testid="skill-picker-trigger"]').click();
            await expect(page.locator('[data-testid="skill-picker-popover"]')).toBeVisible({ timeout: 5000 });
            await expect(page.locator('[data-testid="skill-picker-item-impl"]')).toBeVisible({ timeout: 10000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('7.3 Run Skill enqueues task when skill item clicked', async ({ page, serverUrl, mockAI }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ai-'));
        try {
            await setupRepoWithAIActions(page, serverUrl, tmpDir);

            // Capture the queue POST response to extract the task ID for mock AI verification
            const queueResponsePromise = page.waitForResponse(res =>
                res.url().includes('/api/queue') &&
                !res.url().includes('/bulk') &&
                res.request().method() === 'POST',
            );

            const fileRow = page.locator('.miller-file-row').first();
            await fileRow.click({ button: 'right' });
            await page.locator('text=✨ Run Skill').click();

            const overlay = page.locator('[data-testid="floating-dialog-panel"]');
            await expect(overlay).toBeVisible({ timeout: 5000 });

            // Open the skill picker, select impl, then close picker
            await page.locator('[data-testid="skill-picker-trigger"]').click();
            await page.locator('[data-testid="skill-picker-item-impl"]').click({ timeout: 10000 });
            // Selected skill renders as a chip
            await expect(page.locator('[data-testid="skill-chip-impl"]')).toBeVisible({ timeout: 5000 });

            // Submit via primary footer button (label 'Enqueue' for Run Skill mode)
            await overlay.locator('button:has-text("Enqueue")').click();

            // Verify the POST payload
            const queueResponse = await queueResponsePromise;
            const reqBody = JSON.parse(queueResponse.request().postData() || '{}');
            expect(reqBody.type).toBe('chat');
            expect(reqBody.displayName).toContain('impl');

            // Dialog should close after submit
            await expect(overlay).toHaveCount(0, { timeout: 5000 });

            // --- Mock SDK Validation ---
            // Extract the task ID from the queue response and wait for AI execution
            const responseJson = await queueResponse.json();
            const taskId = ((responseJson.task ?? responseJson) as Record<string, unknown>).id as string;
            expect(taskId).toBeTruthy();

            // Wait for the task to be executed by the mock AI
            const completedTask = await waitForTaskStatus(serverUrl, taskId, ['completed', 'failed']);
            expect(completedTask.status).toBe('completed');

            // Verify mock SDK sendMessage was called for this task. The chat
            // executor may issue a follow-up call (e.g. title generation) so
            // accept any positive count rather than asserting exactly 1.
            expect(mockAI.mockSendMessage.calls.length).toBeGreaterThanOrEqual(1);

            // Verify the prompt passed to the mock SDK is non-empty.
            const [sendMessageOpts] = mockAI.mockSendMessage.calls[0] as [{ prompt: string }];
            expect(typeof sendMessageOpts.prompt).toBe('string');
            expect(sendMessageOpts.prompt.length).toBeGreaterThan(0);
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('7.4 Update Document via context menu opens modal with instruction textarea', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ai-'));
        try {
            await setupRepoWithAIActions(page, serverUrl, tmpDir);

            const fileRow = page.locator('.miller-file-row').first();
            await fileRow.click({ button: 'right' });
            await page.locator('text=✨ Update Document').click();

            // Update Document overlay should appear
            const overlay = page.locator('#update-doc-overlay');
            await expect(overlay).toBeVisible();

            // Should have instruction textarea
            await expect(page.locator('#update-doc-instruction')).toBeVisible();

            // Should have AI controls (provider + model picker chip)
            await expect(page.locator('[data-testid="update-doc-ai-controls"]')).toBeVisible();
            await expect(page.locator('[data-testid="update-doc-model-picker-chip"]')).toBeVisible();

            // Should have submit and cancel buttons
            await expect(page.locator('#update-doc-submit')).toBeVisible();
            await expect(page.locator('#update-doc-cancel')).toBeVisible();
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('7.5 Update Document submits instruction and enqueues task', async ({ page, serverUrl, mockAI }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ai-'));
        try {
            await setupRepoWithAIActions(page, serverUrl, tmpDir);

            // Capture queue POST response to extract task ID for mock AI verification
            const queueResponsePromise = page.waitForResponse(res =>
                res.url().includes('/api/queue') &&
                !res.url().includes('/bulk') &&
                res.request().method() === 'POST',
            );

            const fileRow = page.locator('.miller-file-row').first();
            await fileRow.click({ button: 'right' });
            await page.locator('text=✨ Update Document').click();

            // Fill instruction
            await page.fill('#update-doc-instruction', 'Add error handling to all functions');

            // Submit
            await page.click('#update-doc-submit');

            // Verify the POST payload
            const queueResponse = await queueResponsePromise;
            const reqBody = JSON.parse(queueResponse.request().postData() || '{}');
            expect(reqBody.type).toBe('custom');
            expect(reqBody.displayName).toContain('Update');
            expect(reqBody.payload.data.prompt).toContain('Add error handling');

            // Overlay should close
            await expect(page.locator('#update-doc-overlay')).toHaveCount(0, { timeout: 5000 });

            // Success toast
            await expect(page.locator('.toast-success')).toBeVisible({ timeout: 5000 });

            // --- Mock SDK Validation ---
            // Extract the task ID from the queue response and wait for AI execution
            const responseJson = await queueResponse.json();
            const taskId = ((responseJson.task ?? responseJson) as Record<string, unknown>).id as string;
            expect(taskId).toBeTruthy();

            // Wait for the task to be executed by the mock AI
            const completedTask = await waitForTaskStatus(serverUrl, taskId, ['completed', 'failed']);
            expect(completedTask.status).toBe('completed');

            // Verify mock SDK sendMessage was called for this task. The chat
            // executor may issue a follow-up call (e.g. title generation) so
            // accept any positive count rather than asserting exactly 1.
            expect(mockAI.mockSendMessage.calls.length).toBeGreaterThanOrEqual(1);

            // Find the user-prompt call (the call carrying the actual instruction).
            const userPromptCall = (mockAI.mockSendMessage.calls as Array<[{ prompt: string }]>)
                .find(([opts]) =>
                    typeof opts?.prompt === 'string' && opts.prompt.includes('Add error handling')
                );
            expect(userPromptCall).toBeTruthy();
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('7.6 Update Document cancel closes modal without API call', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ai-'));
        try {
            await setupRepoWithAIActions(page, serverUrl, tmpDir);

            const fileRow = page.locator('.miller-file-row').first();
            await fileRow.click({ button: 'right' });
            await page.locator('text=✨ Update Document').click();

            const overlay = page.locator('#update-doc-overlay');
            await expect(overlay).toBeVisible();

            // Click cancel
            await page.click('#update-doc-cancel');

            // Modal should close
            await expect(overlay).toHaveCount(0, { timeout: 5000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('7.7 Update Document close button dismisses modal', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ai-'));
        try {
            await setupRepoWithAIActions(page, serverUrl, tmpDir);

            const fileRow = page.locator('.miller-file-row').first();
            await fileRow.click({ button: 'right' });
            await page.locator('text=✨ Update Document').click();

            const overlay = page.locator('#update-doc-overlay');
            await expect(overlay).toBeVisible();

            // Click the X close button
            await page.click('#update-doc-close');

            await expect(overlay).toHaveCount(0, { timeout: 5000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('7.8 Run Skill close button dismisses submenu', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ai-'));
        try {
            await setupRepoWithAIActions(page, serverUrl, tmpDir);

            const fileRow = page.locator('.miller-file-row').first();
            await fileRow.click({ button: 'right' });
            await page.locator('text=✨ Run Skill').click();

            const overlay = page.locator('[data-testid="floating-dialog-panel"]');
            await expect(overlay).toBeVisible({ timeout: 5000 });

            // Click the X close button on the dialog header
            await page.locator('[data-testid="dialog-close-btn"]').click();

            await expect(overlay).toHaveCount(0, { timeout: 5000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('7.9 Additional Info field included in Run Skill payload', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ai-'));
        try {
            await setupRepoWithAIActions(page, serverUrl, tmpDir);

            const queueResponsePromise = page.waitForResponse(res =>
                res.url().includes('/api/queue') &&
                !res.url().includes('/bulk') &&
                res.request().method() === 'POST',
            );

            const fileRow = page.locator('.miller-file-row').first();
            await fileRow.click({ button: 'right' });
            await page.locator('text=✨ Run Skill').click();

            const overlay = page.locator('[data-testid="floating-dialog-panel"]');
            await expect(overlay).toBeVisible({ timeout: 5000 });

            // Fill the prompt input — EnqueueDialog uses a single rich-text prompt for
            // additional context (formerly the "Additional Info" field on FollowPromptDialog)
            await page.locator('[data-testid="prompt-input"]').fill('Focus on the auth module');

            // Open SkillPicker, select impl, close popover
            await page.locator('[data-testid="skill-picker-trigger"]').click();
            await page.locator('[data-testid="skill-picker-item-impl"]').click({ timeout: 10000 });
            await expect(page.locator('[data-testid="skill-chip-impl"]')).toBeVisible({ timeout: 5000 });

            // Submit
            await overlay.locator('button:has-text("Enqueue")').click();

            const queueResponse = await queueResponsePromise;
            const reqBody = JSON.parse(queueResponse.request().postData() || '{}');
            expect(reqBody.type).toBe('chat');
            // Skill is recorded in payload.context.skills
            expect(reqBody.payload.context).toBeDefined();
            expect(reqBody.payload.context.skills).toContain('impl');
            // Additional context now flows through the prompt field
            expect(reqBody.payload.prompt).toContain('Focus on the auth module');
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('7.10 Multi-skill selection and submission', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ai-'));
        try {
            // Create repo with two skills
            const repoDir = createRepoFixture(tmpDir);
            createTasksFixture(repoDir);
            createPromptAndSkillFixtures(repoDir);

            // Add a second skill
            const skill2Dir = path.join(repoDir, '.github', 'skills', 'review');
            fs.mkdirSync(skill2Dir, { recursive: true });
            fs.writeFileSync(
                path.join(skill2Dir, 'SKILL.md'),
                '---\ndescription: Review code\n---\n# review\nReview the code.\n',
            );

            await seedWorkspace(serverUrl, 'ws-multi-skill', 'multi-skill-repo', repoDir);

            await page.goto(serverUrl);
            await page.click('[data-tab="repos"]');
            await expect(page.locator('[data-testid="repo-tab"]')).toHaveCount(1, { timeout: 10000 });
            await page.locator('[data-testid="repo-tab"]').first().click();
            await expect(page.locator('#repo-detail-content')).toBeVisible();
            await page.click('.repo-sub-tab[data-subtab="tasks"]');
            await expect(page.locator('.miller-columns')).toBeVisible({ timeout: 10000 });

            const queueResponsePromise = page.waitForResponse(res =>
                res.url().includes('/api/queue') &&
                !res.url().includes('/bulk') &&
                res.request().method() === 'POST',
            );

            const fileRow = page.locator('.miller-file-row').first();
            await fileRow.click({ button: 'right' });
            await page.locator('text=✨ Run Skill').click();

            const overlay = page.locator('[data-testid="floating-dialog-panel"]');
            await expect(overlay).toBeVisible({ timeout: 5000 });

            // Open SkillPicker, select two skills (popover stays open for multi-select)
            await page.locator('[data-testid="skill-picker-trigger"]').click();
            await expect(page.locator('[data-testid="skill-picker-item-impl"]')).toBeVisible({ timeout: 10000 });
            await expect(page.locator('[data-testid="skill-picker-item-review"]')).toBeVisible({ timeout: 10000 });
            await page.locator('[data-testid="skill-picker-item-impl"]').click();
            await page.locator('[data-testid="skill-picker-item-review"]').click();

            // Both chips should be selected
            await expect(page.locator('[data-testid="skill-chip-impl"]')).toBeVisible({ timeout: 5000 });
            await expect(page.locator('[data-testid="skill-chip-review"]')).toBeVisible({ timeout: 5000 });

            // Submit
            await overlay.locator('button:has-text("Enqueue")').click();

            const queueResponse = await queueResponsePromise;
            const reqBody = JSON.parse(queueResponse.request().postData() || '{}');
            expect(reqBody.type).toBe('chat');
            expect(reqBody.payload.context.skills).toHaveLength(2);
            expect(reqBody.payload.context.skills).toContain('impl');
            expect(reqBody.payload.context.skills).toContain('review');
            expect(reqBody.displayName).toContain('impl');
            expect(reqBody.displayName).toContain('review');
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('7.13 No-skills empty state in Run Skill dialog', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ai-'));
        try {
            // Create a repo without any .github/skills/ directory
            const repoDir = createRepoFixture(tmpDir);
            createTasksFixture(repoDir);
            // Deliberately NOT calling createPromptAndSkillFixtures

            await seedWorkspace(serverUrl, 'ws-no-skills', 'no-skills-repo', repoDir);

            await page.goto(serverUrl);
            await page.click('[data-tab="repos"]');
            await expect(page.locator('[data-testid="repo-tab"]')).toHaveCount(1, { timeout: 10000 });
            await page.locator('[data-testid="repo-tab"]').first().click();
            await expect(page.locator('#repo-detail-content')).toBeVisible();
            await page.click('.repo-sub-tab[data-subtab="tasks"]');
            await expect(page.locator('.miller-columns')).toBeVisible({ timeout: 10000 });

            const fileRow = page.locator('.miller-file-row').first();
            await fileRow.click({ button: 'right' });
            await page.locator('text=✨ Run Skill').click();

            const overlay = page.locator('[data-testid="floating-dialog-panel"]');
            await expect(overlay).toBeVisible({ timeout: 5000 });
            await expect(overlay).toContainText('Run Skill');

            // The repo has no .github/skills/, but globally-installed skills
            // (auto-installed by the server) may still appear in the picker.
            // Open the picker and verify there are no Repo-section skills.
            await page.locator('[data-testid="skill-picker-trigger"]').click();
            await expect(page.locator('[data-testid="skill-picker-popover"]')).toBeVisible({ timeout: 5000 });
            await expect(page.locator('[data-testid="skill-picker-section-repo"]')).toHaveCount(0);

            // Context file chip should still be visible (showing the right-clicked file)
            await expect(page.locator('[data-testid="context-file-chip"]')).toHaveCount(1);
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('7.14 Ctrl+Enter keyboard shortcut submits Update Document', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ai-'));
        try {
            await setupRepoWithAIActions(page, serverUrl, tmpDir);

            const queueResponsePromise = page.waitForResponse(res =>
                res.url().includes('/api/queue') &&
                !res.url().includes('/bulk') &&
                res.request().method() === 'POST',
            );

            const fileRow = page.locator('.miller-file-row').first();
            await fileRow.click({ button: 'right' });
            await page.locator('text=✨ Update Document').click();

            await expect(page.locator('#update-doc-overlay')).toBeVisible();

            // Fill instruction
            await page.fill('#update-doc-instruction', 'Refactor error handling');

            // Press Ctrl+Enter
            await page.locator('#update-doc-instruction').press('Control+Enter');

            // Verify the POST was fired
            const queueResponse = await queueResponsePromise;
            const reqBody = JSON.parse(queueResponse.request().postData() || '{}');
            expect(reqBody.type).toBe('custom');
            expect(reqBody.payload.data.prompt).toContain('Refactor error handling');

            // Overlay should close
            await expect(page.locator('#update-doc-overlay')).toHaveCount(0, { timeout: 5000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('7.15 Update Document submit disabled when prompt is empty/whitespace', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ai-'));
        try {
            await setupRepoWithAIActions(page, serverUrl, tmpDir);

            const fileRow = page.locator('.miller-file-row').first();
            await fileRow.click({ button: 'right' });
            await page.locator('text=✨ Update Document').click();

            await expect(page.locator('#update-doc-overlay')).toBeVisible();

            // Clear the prompt completely
            await page.fill('#update-doc-instruction', '');

            // Submit button should be disabled
            await expect(page.locator('#update-doc-submit')).toBeDisabled();

            // Fill with whitespace only
            await page.fill('#update-doc-instruction', '   ');

            // Should still be disabled
            await expect(page.locator('#update-doc-submit')).toBeDisabled();

            // Fill with real content — button should be enabled
            await page.fill('#update-doc-instruction', 'Add tests');
            await expect(page.locator('#update-doc-submit')).toBeEnabled();
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('7.16 Folder context menu does not show AI action items', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ai-'));
        try {
            await setupRepoWithAIActions(page, serverUrl, tmpDir);

            // Find a folder row (backlog/ or archive/ from createTasksFixture)
            const folderRow = page.locator('[data-testid^="task-tree-item-"]').filter({ hasText: '📁' }).first();

            if (await folderRow.isVisible().catch(() => false)) {
                await folderRow.click({ button: 'right' });

                const contextMenu = page.locator('[data-testid="context-menu"]');
                const menuVisible = await contextMenu.isVisible().catch(() => false);
                if (menuVisible) {
                    // Folder context menu should NOT have the single-file "✨ Run Skill" or "✨ Update Document"
                    // It may have "Bulk Run Skill" which is a different item
                    await expect(contextMenu.locator('text="✨ Update Document"')).toHaveCount(0);
                }
            }
        } finally {
            safeRmSync(tmpDir);
        }
    });
});
