/**
 * AI Service Unavailable (503) E2E Tests
 *
 * Coverage gap: error-handling.spec.ts covers generic 500s but not the
 * AI-specific 503 paths returned when the AI service is unavailable.
 *
 * Exercises:
 * - POST /api/workspaces/:id/workflows/generate → 503 (AddWorkflowDialog)
 * - POST /api/workspaces/:id/workflows/refine   → 503 (WorkflowAIRefinePanel)
 * - POST /api/wikis/:id/ask                     → 503 (WikiAsk widget)
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { seedWorkspace, seedWiki } from './fixtures/seed';
import { createWikiComponent } from './fixtures/wiki-fixtures';
import type { ComponentGraph } from './fixtures/wiki-fixtures';

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

/** Navigate to repos tab → select a repo → switch to the templates sub-tab. */
async function navigateToTemplatesTab(
    page: import('@playwright/test').Page,
    serverUrl: string,
): Promise<void> {
    await page.goto(serverUrl);
    await page.click('[data-tab="repos"]');
    await expect(page.locator('[data-testid="repo-tab"]')).toHaveCount(1, { timeout: 10_000 });
    await page.locator('[data-testid="repo-tab"]').first().click();
    await expect(page.locator('#repo-detail-content')).toBeVisible();
    await page.click('button[data-subtab="templates"]');
    await expect(page.locator('button[data-subtab="templates"]')).toHaveClass(/active/);
}

/** Create a minimal wiki directory with component-graph and articles. */
function createMinimalWikiDir(dir: string): void {
    const graph: ComponentGraph = {
        project: {
            name: 'Test Project',
            description: 'A test project',
            language: 'TypeScript',
            buildSystem: 'npm',
            entryPoints: ['src/index.ts'],
        },
        components: [
            createWikiComponent('core-service', { category: 'core', complexity: 'low', dependencies: [], dependents: [] }),
        ],
        categories: [{ name: 'core', description: 'Core logic' }],
        architectureNotes: 'Simple layered architecture.',
    };
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'component-graph.json'), JSON.stringify(graph, null, 2));
    const componentsDir = path.join(dir, 'components');
    fs.mkdirSync(componentsDir, { recursive: true });
    fs.writeFileSync(path.join(componentsDir, 'core-service.md'), '# Core Service\n\nHandles core logic.');
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

            await navigateToTemplatesTab(page, serverUrl);

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

            await navigateToTemplatesTab(page, serverUrl);

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

// ============================================================================
// Area 3 — Wiki ask → 503
// ============================================================================

test.describe('AI service unavailable — wiki ask (503)', () => {
    test('wiki ask shows error when AI is unavailable', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ai-503-ask-'));
        try {
            const wikiDir = path.join(tmpDir, 'wiki-data');
            createMinimalWikiDir(wikiDir);
            await seedWiki(serverUrl, 'wiki-ask-503', wikiDir, undefined, 'Ask 503 Wiki');

            // Navigate to wiki → open ask tab
            await page.goto(serverUrl + '#wiki');
            await expect(page.locator('.wiki-card[data-wiki-id="wiki-ask-503"]')).toBeVisible({ timeout: 10_000 });
            await page.click('.wiki-card[data-wiki-id="wiki-ask-503"]');
            await expect(page.locator('#wiki-component-tree')).not.toBeEmpty({ timeout: 5_000 });

            await page.click('.wiki-project-tab[data-wiki-project-tab="ask"]');
            await expect(page.locator('#wiki-ask-widget')).toBeVisible({ timeout: 5_000 });

            // Expand the ask panel
            await page.keyboard.press('Control+i');
            await expect(page.locator('#wiki-ask-messages')).toBeVisible({ timeout: 5_000 });

            // Intercept the ask endpoint to return 503
            await page.route('**/api/wikis/**/ask', route =>
                route.fulfill({
                    status: 503,
                    contentType: 'application/json',
                    body: JSON.stringify({ error: 'AI service unavailable' }),
                }),
            );

            // Type and send a question
            const input = page.locator('#wiki-ask-input, textarea[placeholder*="question"], textarea[placeholder*="ask"]').first();
            await input.fill('What does this project do?');
            await input.press('Enter');

            // Error message should appear in the conversation area
            await expect(page.locator('.ask-message-error')).toBeVisible({ timeout: 8_000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });
});
