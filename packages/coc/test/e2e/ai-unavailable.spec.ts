/**
 * Coverage gap: error-handling.spec.ts covers generic 500s but not the
 * AI-specific 503 paths returned when the AI service is unavailable.
 *
 * Exercises:
 * - POST /api/workspaces/:id/workflows/generate → 503 (AddWorkflowDialog)
 * - POST /api/workspaces/:id/workflows/refine   → 503 (WorkflowAIRefinePanel)
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { seedWorkspace, request } from './fixtures/seed';
import { gotoWorkspace } from './fixtures/remote-shell';

/**
 * Enable the Workflows tab feature flag on the running server. The Workflows
 * sub-tab is gated by `workflows.enabled` and is off by default; the workflow
 * generate/refine tests exercise that tab and so must opt into it.
 */
async function enableWorkflowsFeature(serverUrl: string): Promise<void> {
    const res = await request(`${serverUrl}/api/admin/config`, {
        method: 'PUT',
        body: JSON.stringify({ 'workflows.enabled': true }),
    });
    if (res.status !== 200) {
        throw new Error(`Failed to enable workflows feature: ${res.status} ${res.body}`);
    }
}

// ============================================================================
// Helpers
// ============================================================================

/** Create a minimal git repo fixture for workflow tests. */
function createWorkflowFixtureRepo(tmpDir: string): string {
    const repoDir = path.join(tmpDir, 'test-repo');
    fs.mkdirSync(repoDir, { recursive: true });
    execSync('git init', { cwd: repoDir, stdio: 'ignore' });
    execSync('git -c user.name="test" -c user.email="test@test" commit -m "init" --allow-empty', {
        cwd: repoDir,
        stdio: 'ignore',
    });
    return repoDir;
}

/** Navigate directly to the workspace Workflows sub-tab. */
async function navigateToTemplatesTab(
    page: import('@playwright/test').Page,
    serverUrl: string,
    workspaceId: string,
): Promise<void> {
    await gotoWorkspace(page, serverUrl, workspaceId, 'workflows');
    await expect(page.locator('button[data-subtab="workflows"]')).toHaveAttribute('data-active', 'true');
}

// ============================================================================
// Area 3 — Workflow generate → 503
// ============================================================================

test.describe('AI service unavailable — workflow generate (503)', () => {
    test('generate workflow shows user-friendly error when AI is unavailable', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ai-503-gen-'));
        try {
            const repoDir = createWorkflowFixtureRepo(tmpDir);
            await seedWorkspace(serverUrl, 'ws-ai-503-gen', 'test-repo', repoDir);
            await enableWorkflowsFeature(serverUrl);

            await navigateToTemplatesTab(page, serverUrl, 'ws-ai-503-gen');

            // Intercept the generate endpoint to return 503 before opening the dialog
            await page.route('**/workflows/generate', route =>
                route.fulfill({
                    status: 503,
                    contentType: 'application/json',
                    body: JSON.stringify({ error: 'AI service unavailable' }),
                }),
            );

            // Open Add Workflow dialog
            await page.locator('[data-testid="workflows-section"]').getByRole('button', { name: '+ New' }).click();
            // Dialog should show with "AI Generated" template selected by default
            await expect(page.locator('[data-testid="dialog-overlay"]')).toBeVisible({ timeout: 5_000 });

            // Fill description (must be ≥10 characters to enable the generate button)
            await page.locator('textarea').fill('Process customer CSV files and summarize results');

            // Click "Generate Workflow ✨"
            await page.getByRole('button', { name: /Generate Workflow/i }).click();

            // Error message should be visible in the dialog
            await expect(page.locator('.text-red-500').filter({ hasText: /AI service unavailable|unavailable/i }))
                .toBeVisible({ timeout: 8_000 });

            // Dialog should still be open (not closed on error)
            await expect(page.locator('[data-testid="dialog-overlay"]')).toBeVisible();
        } finally {
            safeRmSync(tmpDir);
        }
    });
});

// ============================================================================
// Area 3 — Workflow refine → 503
// ============================================================================

test.describe('AI service unavailable — workflow refine (503)', () => {
    test('refine workflow shows error when AI is unavailable', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ai-503-refine-'));
        try {
            const repoDir = createWorkflowFixtureRepo(tmpDir);

            // Create a workflow YAML file for the repo
            const pipeDir = path.join(repoDir, '.vscode', 'workflows', 'my-workflow');
            fs.mkdirSync(pipeDir, { recursive: true });
            fs.writeFileSync(path.join(pipeDir, 'pipeline.yaml'),
                'name: my-workflow\nnodes:\n  step1:\n    type: map\n    prompt: "hello"\n');
            execSync('git add -A && git -c user.name="test" -c user.email="test@test" commit -m "add workflow"', {
                cwd: repoDir, stdio: 'ignore',
            });

            await seedWorkspace(serverUrl, 'ws-ai-503-refine', 'test-repo', repoDir);
            await enableWorkflowsFeature(serverUrl);

            await navigateToTemplatesTab(page, serverUrl, 'ws-ai-503-refine');

            // Click the workflow item to open it
            await expect(page.locator('.repo-workflow-item')).toHaveCount(1, { timeout: 10_000 });
            await page.locator('.repo-workflow-item').first().click();

            // Open the AI sidebar
            await expect(page.locator('[data-testid="ai-sidebar-toggle"]')).toBeVisible({ timeout: 8_000 });
            await page.click('[data-testid="ai-sidebar-toggle"]');
            await expect(page.locator('[data-testid="pipeline-ai-refine-panel"]')).toBeVisible({ timeout: 5_000 });

            // Intercept refine endpoint to return 503
            await page.route('**/workflows/refine', route =>
                route.fulfill({
                    status: 503,
                    contentType: 'application/json',
                    body: JSON.stringify({ error: 'AI service unavailable' }),
                }),
            );

            // Fill and submit the refine instruction
            await page.locator('[data-testid="refine-instruction"]').fill('Add a reduce step at the end');
            await page.click('[data-testid="refine-submit"]');

            // Error should appear in the refine panel
            await expect(page.locator('[data-testid="refine-error"]')).toBeVisible({ timeout: 8_000 });
            await expect(page.locator('[data-testid="refine-error"]')).toContainText(/unavailable|AI/i);
        } finally {
            safeRmSync(tmpDir);
        }
    });
});
