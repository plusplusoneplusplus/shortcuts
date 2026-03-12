/**
 * Workflow DAG E2E Tests
 *
 * Tests that a workflow-type YAML (containing `nodes` object) renders the
 * WorkflowDAGChart with expected nodes, edges, and interactive zoom controls.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { seedWorkspace } from './fixtures/seed';

// ── Workflow YAML fixture with 4 nodes forming a DAG ─────────────────────────

const workflowYaml = `nodes:
  load_data:
    type: load
    source: data.csv
  filter_rows:
    type: filter
    from: [load_data]
    rules:
      - field: status
        operator: equals
        value: active
  map_items:
    type: map
    from: [filter_rows]
    prompt: "Summarize: {{item}}"
  reduce_results:
    type: reduce
    from: [map_items]
    prompt: "Combine all summaries"
`;

/** Create a minimal repo with the workflow YAML fixture. */
function createWorkflowFixture(tmpDir: string): string {
    const repoDir = path.join(tmpDir, 'dag-repo');
    const pipeDir = path.join(repoDir, '.vscode', 'workflows', 'workflow-test');
    fs.mkdirSync(pipeDir, { recursive: true });
    fs.writeFileSync(path.join(pipeDir, 'pipeline.yaml'), workflowYaml);
    execSync('git init', { cwd: repoDir, stdio: 'ignore' });
    execSync('git add -A', { cwd: repoDir, stdio: 'ignore' });
    execSync('git -c user.name="test" -c user.email="test@test" commit -m "init" --allow-empty', {
        cwd: repoDir,
        stdio: 'ignore',
    });
    return repoDir;
}

/** Navigate from the home page to the pipeline detail view. */
async function navigateToPipeline(
    page: import('@playwright/test').Page,
    serverUrl: string,
): Promise<void> {
    await page.goto(serverUrl);
    await page.click('[data-tab="repos"]');
    await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10_000 });

    await page.locator('.repo-item').first().click();
    await expect(page.locator('#repo-detail-content')).toBeVisible();
    await page.click('button[data-subtab="workflows"]');
    await expect(page.locator('button[data-subtab="workflows"]')).toHaveClass(/active/);

    const pipelineItems = page.locator('.repo-workflow-item');
    await expect(pipelineItems).toHaveCount(1, { timeout: 10_000 });
    await pipelineItems.first().click();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Workflow DAG Chart', () => {
    test('workflow YAML renders WorkflowDAGChart with expected nodes', async ({
        page,
        serverUrl,
    }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-dag-'));
        const repoDir = createWorkflowFixture(tmpDir);

        try {
            await seedWorkspace(serverUrl, 'ws-dag-1', 'dag-repo', repoDir);
            await navigateToPipeline(page, serverUrl);

            const container = page.locator('[data-testid="workflow-dag-container"]');
            await expect(container).toBeVisible({ timeout: 10_000 });

            const svg = page.locator('[data-testid="workflow-dag-chart"]');
            await expect(svg).toBeVisible();

            const nodes = page.locator('[data-testid^="workflow-node-"]');
            await expect(nodes).toHaveCount(4);
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('each workflow node displays correct type label', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-dag-'));
        const repoDir = createWorkflowFixture(tmpDir);

        try {
            await seedWorkspace(serverUrl, 'ws-dag-2', 'dag-repo', repoDir);
            await navigateToPipeline(page, serverUrl);

            await expect(
                page.locator('[data-testid="workflow-dag-container"]'),
            ).toBeVisible({ timeout: 10_000 });

            const expectedNodes: Array<{ id: string; type: string }> = [
                { id: 'load_data', type: 'load' },
                { id: 'filter_rows', type: 'filter' },
                { id: 'map_items', type: 'map' },
                { id: 'reduce_results', type: 'reduce' },
            ];

            for (const { id, type } of expectedNodes) {
                const nodeGroup = page.locator(`[data-testid="workflow-node-${id}"]`);
                await expect(nodeGroup).toBeVisible();
                const title = nodeGroup.locator('title');
                await expect(title).toContainText(`(${type})`);
            }
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('zoom controls are visible and functional', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-dag-'));
        const repoDir = createWorkflowFixture(tmpDir);

        try {
            await seedWorkspace(serverUrl, 'ws-dag-3', 'dag-repo', repoDir);
            await navigateToPipeline(page, serverUrl);

            await expect(
                page.locator('[data-testid="workflow-dag-container"]'),
            ).toBeVisible({ timeout: 10_000 });

            const controls = page.locator('[data-testid="zoom-controls"]');
            await expect(controls).toBeVisible();

            const label = page.locator('[data-testid="zoom-label"]');
            await expect(label).toHaveText('100%');

            // Zoom in → label changes from 100%
            await controls.locator('button[title="Zoom in"]').click();
            await expect(label).not.toHaveText('100%');

            // Reset → label returns to 100%
            await controls.locator('button[title="Reset zoom"]').click();
            await expect(label).toHaveText('100%');
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('fit-to-view adjusts zoom level', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-dag-'));
        const repoDir = createWorkflowFixture(tmpDir);

        try {
            await seedWorkspace(serverUrl, 'ws-dag-4', 'dag-repo', repoDir);
            await navigateToPipeline(page, serverUrl);

            await expect(
                page.locator('[data-testid="workflow-dag-container"]'),
            ).toBeVisible({ timeout: 10_000 });

            const controls = page.locator('[data-testid="zoom-controls"]');
            const label = page.locator('[data-testid="zoom-label"]');

            // Zoom in twice to move away from default
            await controls.locator('button[title="Zoom in"]').click();
            await controls.locator('button[title="Zoom in"]').click();
            await expect(label).toHaveText('150%');

            // Fit to view → zoom changes to calculated value (container vs content)
            await controls.locator('button[title="Fit to view"]').click();
            await expect(label).not.toHaveText('150%');
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('DAG container supports drag cursor', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-dag-'));
        const repoDir = createWorkflowFixture(tmpDir);

        try {
            await seedWorkspace(serverUrl, 'ws-dag-5', 'dag-repo', repoDir);
            await navigateToPipeline(page, serverUrl);

            const container = page.locator('[data-testid="workflow-dag-container"]');
            await expect(container).toBeVisible({ timeout: 10_000 });

            const cursor = await container.evaluate(
                (el) => getComputedStyle(el).cursor || (el as HTMLElement).style.cursor,
            );
            expect(cursor).toBe('grab');
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('zoom-out button decreases zoom level', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-dag-'));
        const repoDir = createWorkflowFixture(tmpDir);

        try {
            await seedWorkspace(serverUrl, 'ws-dag-6', 'dag-repo', repoDir);
            await navigateToPipeline(page, serverUrl);

            await expect(
                page.locator('[data-testid="workflow-dag-container"]'),
            ).toBeVisible({ timeout: 10_000 });

            const controls = page.locator('[data-testid="zoom-controls"]');
            const label = page.locator('[data-testid="zoom-label"]');

            // Zoom in twice to reach 150%
            await controls.locator('button[title="Zoom in"]').click();
            await controls.locator('button[title="Zoom in"]').click();
            await expect(label).toHaveText('150%');

            // Zoom out — label should decrease from 150%
            await controls.locator('button[title="Zoom out"]').click();
            await expect(label).not.toHaveText('150%');
        } finally {
            safeRmSync(tmpDir);
        }
    });
});
