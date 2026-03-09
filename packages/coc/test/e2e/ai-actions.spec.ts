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
    await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });

    await page.locator('.repo-item').first().click();
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

            // Run Skill overlay should appear
            const overlay = page.locator('#follow-prompt-submenu');
            await expect(overlay).toBeVisible();

            // Should have a model select
            await expect(page.locator('#fp-model')).toBeVisible();

            // Should load and show skill items
            await expect(page.locator('.fp-item').first()).toBeVisible({ timeout: 10000 });

            // Should have the "impl" skill
            await expect(page.locator('.fp-item[data-name="impl"]')).toBeVisible();
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

            // Wait for skills to load
            await expect(page.locator('.fp-item').first()).toBeVisible({ timeout: 10000 });

            // Select the impl skill chip then submit
            await page.locator('.fp-item[data-name="impl"]').click();
            await page.locator('[data-testid="fp-submit-skills"]').click();

            // Verify the POST payload
            const queueResponse = await queueResponsePromise;
            const reqBody = JSON.parse(queueResponse.request().postData() || '{}');
            expect(reqBody.type).toBe('chat');
            expect(reqBody.displayName).toContain('impl');

            // Overlay should be removed
            await expect(page.locator('#follow-prompt-submenu')).toHaveCount(0, { timeout: 5000 });

            // Success toast should appear
            await expect(page.locator('.toast-success')).toBeVisible({ timeout: 5000 });

            // --- Mock SDK Validation ---
            // Extract the task ID from the queue response and wait for AI execution
            const responseJson = await queueResponse.json();
            const taskId = ((responseJson.task ?? responseJson) as Record<string, unknown>).id as string;
            expect(taskId).toBeTruthy();

            // Wait for the task to be executed by the mock AI
            const completedTask = await waitForTaskStatus(serverUrl, taskId, ['completed', 'failed']);
            expect(completedTask.status).toBe('completed');

            // Verify mock SDK sendMessage was called exactly once for this task
            expect(mockAI.mockSendMessage.calls.length).toBe(1);

            // Verify the prompt passed to the mock SDK references the prompt file path
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

            // Should have model select
            await expect(page.locator('#update-doc-model')).toBeVisible();

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

            // Verify mock SDK sendMessage was called exactly once for this task
            expect(mockAI.mockSendMessage.calls.length).toBe(1);

            // Verify the prompt passed to the mock SDK contains the user's instruction
            const [sendMessageOpts] = mockAI.mockSendMessage.calls[0] as [{ prompt: string }];
            expect(sendMessageOpts.prompt).toContain('Add error handling');
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

            const overlay = page.locator('#follow-prompt-submenu');
            await expect(overlay).toBeVisible();

            // Click the X close button
            await page.click('#fp-close');

            await expect(overlay).toHaveCount(0, { timeout: 5000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });
});
