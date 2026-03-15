/**
 * Wiki Generation End-to-End Tests
 *
 * Coverage gap: wiki-admin.spec.ts mocks SSE for individual phases.
 * This spec exercises the complete user journey from the wiki list:
 *   add wiki → navigate → open generate tab → trigger generation → observe
 *   SSE progress → verify completion → view rendered content in browse tab.
 *
 * NOTE: Real generation requires deep-wiki + Copilot, which is not
 * available in CI. We use page.route() to inject mock SSE events so the
 * UI flow is real but the AI pipeline is replaced with controlled output.
 */

import type { Page } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { seedWiki } from './fixtures/seed';
import type { CategoryInfo, ComponentInfo } from './fixtures/wiki-fixtures';
import { createWikiComponent } from './fixtures/wiki-fixtures';
import type { ComponentGraph } from './fixtures/wiki-fixtures';

// ============================================================================
// Helpers
// ============================================================================

const CATEGORIES: CategoryInfo[] = [
    { name: 'core', description: 'Core business logic' },
    { name: 'api', description: 'API layer' },
];

function buildComponents(): ComponentInfo[] {
    return [
        createWikiComponent('auth-service', {
            category: 'core',
            complexity: 'high',
            dependencies: [],
            dependents: ['api-gateway'],
        }),
        createWikiComponent('api-gateway', {
            category: 'api',
            complexity: 'medium',
            dependencies: ['auth-service'],
            dependents: [],
        }),
    ];
}

const ARTICLES: Record<string, string> = {
    'auth-service': '# Auth Service\n\nHandles user authentication and sessions.',
    'api-gateway': '# API Gateway\n\nRoutes HTTP requests to backend services.',
};

function createWikiWithArticles(wikiDir: string): void {
    const graph: ComponentGraph = {
        project: {
            name: 'E2E Test Project',
            description: 'A project for E2E wiki generation tests',
            language: 'TypeScript',
            buildSystem: 'npm + webpack',
            entryPoints: ['src/index.ts'],
        },
        components: buildComponents(),
        categories: CATEGORIES,
        architectureNotes: 'Layered architecture.',
    };

    fs.mkdirSync(wikiDir, { recursive: true });
    fs.writeFileSync(path.join(wikiDir, 'component-graph.json'), JSON.stringify(graph, null, 2));

    const componentsDir = path.join(wikiDir, 'components');
    fs.mkdirSync(componentsDir, { recursive: true });
    for (const [id, content] of Object.entries(ARTICLES)) {
        fs.writeFileSync(path.join(componentsDir, `${id}.md`), content);
    }
}

/** Build a fake SSE stream body that mimics deep-wiki generation events. */
function buildMockSSEBody(startPhase: number): string {
    const events = [
        { type: 'status', phase: startPhase, message: `Starting phase ${startPhase}...` },
        { type: 'log', phase: startPhase, message: 'Processing files...' },
        { type: 'phase-complete', phase: startPhase, success: true, message: 'Phase completed', duration: 500 },
        { type: 'done', success: true, duration: 500 },
    ];
    return events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('');
}

/** Navigate to the wiki card list, click a wiki, open the generate admin tab. */
async function openWikiGenerateTab(page: Page, serverUrl: string, wikiId: string): Promise<void> {
    await page.goto(serverUrl + '#wiki');
    await expect(page.locator(`#wiki-card-list .wiki-card[data-wiki-id="${wikiId}"]`)).toBeVisible({ timeout: 10_000 });
    await page.click(`#wiki-card-list .wiki-card[data-wiki-id="${wikiId}"]`);
    await expect(page.locator('#wiki-component-tree')).not.toBeEmpty({ timeout: 5_000 });

    // Open the admin panel
    await expect(page.locator('#wiki-project-tabs')).toBeVisible({ timeout: 5_000 });
    await page.click('.wiki-project-tab[data-wiki-project-tab="admin"]');
    await page.click('[data-wiki-admin-tab="generate"]');
    await expect(page.locator('#admin-content-generate')).toBeVisible({ timeout: 5_000 });
}

// ============================================================================
// TC1: Full journey — navigate, trigger generation, observe progress, view content
// ============================================================================

test.describe('Wiki generation end-to-end', () => {
    test('navigate from wiki list → trigger generation → view completion → browse content', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wiki-gen-e2e-'));
        try {
            const wikiDir = path.join(tmpDir, 'wiki-data');
            createWikiWithArticles(wikiDir);
            await seedWiki(serverUrl, 'wiki-gen-e2e', wikiDir, tmpDir, 'E2E Gen Wiki');

            // Navigate from wiki list to generate tab
            await openWikiGenerateTab(page, serverUrl, 'wiki-gen-e2e');

            // Mock the generate endpoint to return a realistic SSE stream
            await page.route('**/api/wikis/**/admin/generate', async (route, req) => {
                if (req.method() !== 'POST') return route.continue();
                const body = JSON.parse(req.postData() || '{}');
                await route.fulfill({
                    status: 200,
                    headers: { 'Content-Type': 'text/event-stream' },
                    body: buildMockSSEBody(body.startPhase ?? 1),
                });
            });

            // Also mock the generate/status endpoint that is polled after completion
            await page.route('**/api/wikis/**/admin/generate/status', async (route) => {
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        available: true,
                        running: false,
                        phases: { '1': { cached: true }, '2': { cached: false }, '3': { cached: false }, '4': { cached: false }, '5': { cached: false } },
                    }),
                });
            });

            // All 5 phase cards should be visible
            await expect(page.locator('#phase-card-1')).toBeVisible();

            // Trigger phase 1 run
            await page.click('#phase-run-1');

            // Generation progress indicator or phase log should appear
            await expect(page.locator('#generate-status-bar, #phase-log-1')).toBeVisible({ timeout: 10_000 });

            // Wait for completion (phase log shows ✓ or "Complete")
            await expect(page.locator('#phase-log-1')).toContainText(/Complete|✓|complete/i, { timeout: 10_000 });

            // Navigate to browse tab — pre-seeded articles should be visible
            await page.click('.wiki-project-tab[data-wiki-project-tab="browse"]');
            await expect(page.locator('#wiki-component-tree')).toBeVisible({ timeout: 5_000 });

            // At least one component should be listed
            await expect(page.locator('#wiki-component-tree .tree-node, #wiki-component-tree li').first()).toBeVisible({ timeout: 5_000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });

    // ============================================================================
    // TC2: Generation failure shows error state
    // ============================================================================

    test('generation failure shows error state in the generate tab', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wiki-gen-fail-'));
        try {
            const wikiDir = path.join(tmpDir, 'wiki-data');
            createWikiWithArticles(wikiDir);
            await seedWiki(serverUrl, 'wiki-gen-fail', wikiDir, tmpDir, 'Gen Fail Wiki');

            await openWikiGenerateTab(page, serverUrl, 'wiki-gen-fail');

            // Mock generate to return an error
            await page.route('**/api/wikis/**/admin/generate', async (route, req) => {
                if (req.method() !== 'POST') return route.continue();
                await route.fulfill({
                    status: 400,
                    contentType: 'application/json',
                    body: JSON.stringify({ error: 'Repository path not found' }),
                });
            });

            await page.click('#phase-run-1');

            // Status bar should show error
            const statusBar = page.locator('#generate-status-bar');
            await expect(statusBar).toContainText('Repository path not found', { timeout: 10_000 });
            await expect(statusBar).toHaveClass(/error/);

            // Run buttons should be re-enabled (not stuck in running state)
            await expect(page.locator('#phase-run-1')).not.toBeDisabled({ timeout: 5_000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });

    // ============================================================================
    // TC3: Duplicate generation prevention (409 Conflict)
    // ============================================================================

    test('starting generation when one is already running shows conflict message', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wiki-gen-409-'));
        try {
            const wikiDir = path.join(tmpDir, 'wiki-data');
            createWikiWithArticles(wikiDir);
            await seedWiki(serverUrl, 'wiki-gen-409', wikiDir, tmpDir, 'Gen 409 Wiki');

            await openWikiGenerateTab(page, serverUrl, 'wiki-gen-409');

            // Mock generate to return 409
            await page.route('**/api/wikis/**/admin/generate', async (route, req) => {
                if (req.method() !== 'POST') return route.continue();
                await route.fulfill({
                    status: 409,
                    contentType: 'application/json',
                    body: JSON.stringify({ error: 'Generation already in progress' }),
                });
            });

            await page.click('#phase-run-1');

            // Status bar or error message should mention "already in progress"
            await expect(page.locator('#generate-status-bar')).toContainText(/already in progress/i, { timeout: 10_000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });

    // ============================================================================
    // TC4: "Run All" button triggers generation starting from phase 1
    // ============================================================================

    test('"Run All" triggers generation for all phases from the selected start phase', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wiki-gen-all-'));
        try {
            const wikiDir = path.join(tmpDir, 'wiki-data');
            createWikiWithArticles(wikiDir);
            await seedWiki(serverUrl, 'wiki-gen-all', wikiDir, tmpDir, 'Gen All Wiki');

            await openWikiGenerateTab(page, serverUrl, 'wiki-gen-all');

            let capturedBody: Record<string, unknown> | null = null;
            await page.route('**/api/wikis/**/admin/generate', async (route, req) => {
                if (req.method() !== 'POST') return route.continue();
                capturedBody = JSON.parse(req.postData() || '{}');
                await route.fulfill({
                    status: 200,
                    headers: { 'Content-Type': 'text/event-stream' },
                    body: buildMockSSEBody(capturedBody!.startPhase as number ?? 1),
                });
            });

            await page.route('**/api/wikis/**/admin/generate/status', async (route) => {
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        available: true, running: false,
                        phases: { '1': { cached: true }, '2': { cached: false }, '3': { cached: false }, '4': { cached: false }, '5': { cached: false } },
                    }),
                });
            });

            // Click "Run All" button (no id; find by text)
            await page.getByRole('button', { name: 'Run All' }).click();

            // Generation should start (status bar appears)
            await expect(page.locator('#generate-status-bar, #phase-log-1')).toBeVisible({ timeout: 10_000 });

            // Wait for completion
            await expect(page.locator('#phase-log-1')).toContainText(/Complete|✓|complete/i, { timeout: 10_000 });

            // The request should have been for phases 1-5
            expect(capturedBody?.startPhase).toBe(1);
            expect(capturedBody?.endPhase).toBe(5);
        } finally {
            safeRmSync(tmpDir);
        }
    });
});
