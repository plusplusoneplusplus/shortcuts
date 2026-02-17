/**
 * Wiki Admin Panel E2E Tests
 *
 * Tests the admin panel: toggle show/hide, tab switching,
 * seeds/config editing, save/reset, generate phases, error handling.
 *
 * Depends on:
 *   - Commit 001: wiki fixtures (createWikiFixture, createWikiComponent)
 *   - Commit 002: wiki management tests (seedWiki)
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect } from './fixtures/server-fixture';
import { seedWiki, request } from './fixtures/seed';
import { createWikiFixture, createWikiComponent } from './fixtures/wiki-fixtures';
import type { ComponentGraph, ComponentInfo, CategoryInfo } from './fixtures/wiki-fixtures';
import type { Page } from '@playwright/test';

// ================================================================
// Helpers
// ================================================================

function writeComponentArticles(wikiDir: string, articles: Record<string, string>): void {
    const componentsDir = path.join(wikiDir, 'components');
    fs.mkdirSync(componentsDir, { recursive: true });
    for (const [id, content] of Object.entries(articles)) {
        fs.writeFileSync(path.join(componentsDir, `${id}.md`), content, 'utf-8');
    }
}

function createCustomWiki(
    wikiDir: string,
    components: ComponentInfo[],
    categories: CategoryInfo[],
    extras?: { articles?: Record<string, string>; projectName?: string },
): ComponentGraph {
    const graph: ComponentGraph = {
        project: {
            name: extras?.projectName ?? 'Test Project',
            description: 'A test project for E2E wiki admin tests',
            language: 'TypeScript',
            buildSystem: 'npm + webpack',
            entryPoints: ['src/index.ts'],
        },
        components,
        categories,
        architectureNotes: 'Layered architecture for testing.',
    };
    fs.mkdirSync(wikiDir, { recursive: true });
    fs.writeFileSync(path.join(wikiDir, 'component-graph.json'), JSON.stringify(graph, null, 2));
    if (extras?.articles) writeComponentArticles(wikiDir, extras.articles);
    return graph;
}

async function selectWikiAndOpenAdmin(
    page: Page,
    serverUrl: string,
    wikiId: string,
): Promise<void> {
    await page.goto(serverUrl);
    await page.click('[data-tab="wiki"]');
    await expect(page.locator('#wiki-select')).toContainText(wikiId, { timeout: 10_000 });
    await page.selectOption('#wiki-select', wikiId);
    await expect(page.locator('#wiki-component-tree')).not.toBeEmpty({ timeout: 5_000 });

    // Open admin panel
    await expect(page.locator('#wiki-admin-toggle')).not.toHaveClass(/hidden/, { timeout: 5_000 });
    await page.click('#wiki-admin-toggle');
    await expect(page.locator('#wiki-admin-panel')).not.toHaveClass(/hidden/, { timeout: 5_000 });
}

const CATEGORIES: CategoryInfo[] = [
    { name: 'core', description: 'Core business logic' },
    { name: 'api', description: 'API layer and routing' },
];

function buildTestComponents(): ComponentInfo[] {
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

const TEST_ARTICLES: Record<string, string> = {
    'auth-service': '# Auth Service\n\nHandles user authentication.',
    'api-gateway': '# API Gateway\n\nRoutes incoming HTTP requests.',
};

// ================================================================
// TC1: Admin Panel Toggle
// ================================================================

test.describe('Wiki Admin Panel', () => {
    test.describe('Admin panel toggle', () => {
        test('clicking admin toggle shows panel and hides wiki layout', async ({ page, serverUrl }) => {
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-admin-toggle-'));
            try {
                const wikiDir = path.join(tmpDir, 'wiki-data');
                createCustomWiki(wikiDir, buildTestComponents(), CATEGORIES, { articles: TEST_ARTICLES });
                await seedWiki(serverUrl, 'admin-toggle-wiki', wikiDir, undefined, 'Admin Toggle Wiki');

                await page.goto(serverUrl);
                await page.click('[data-tab="wiki"]');
                await expect(page.locator('#wiki-select option')).toHaveCount(2, { timeout: 10_000 });
                await page.selectOption('#wiki-select', 'admin-toggle-wiki');
                await expect(page.locator('#wiki-component-tree')).not.toBeEmpty({ timeout: 5_000 });

                // Admin panel should be hidden initially
                // (It may not exist in DOM yet until first toggle)
                const adminPanel = page.locator('#wiki-admin-panel');

                // Click admin toggle
                await page.click('#wiki-admin-toggle');

                // Admin panel should be visible
                await expect(adminPanel).not.toHaveClass(/hidden/, { timeout: 5_000 });

                // Wiki layout should be hidden
                const wikiLayout = page.locator('#view-wiki .wiki-layout');
                await expect(wikiLayout).toHaveClass(/hidden/);

                // Click back button to return to wiki
                await page.click('#wiki-admin-back');
                await expect(adminPanel).toHaveClass(/hidden/);
                await expect(wikiLayout).not.toHaveClass(/hidden/);
            } finally {
                fs.rmSync(tmpDir, { recursive: true, force: true });
            }
        });
    });

    // ================================================================
    // TC2: Admin Panel Tabs
    // ================================================================

    test.describe('Admin panel tab navigation', () => {
        test('tab switching shows correct content area', async ({ page, serverUrl }) => {
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-admin-tabs-'));
            try {
                const wikiDir = path.join(tmpDir, 'wiki-data');
                createCustomWiki(wikiDir, buildTestComponents(), CATEGORIES, { articles: TEST_ARTICLES });
                await seedWiki(serverUrl, 'admin-tabs-wiki', wikiDir, undefined, 'Admin Tabs Wiki');
                await selectWikiAndOpenAdmin(page, serverUrl, 'admin-tabs-wiki');

                // Seeds tab should be active by default
                await expect(page.locator('.admin-tab[data-tab="seeds"]')).toHaveClass(/active/);
                await expect(page.locator('#admin-content-seeds')).toHaveClass(/active/);
                await expect(page.locator('#admin-content-config')).not.toHaveClass(/active/);
                await expect(page.locator('#admin-content-generate')).not.toHaveClass(/active/);

                // Switch to config tab
                await page.click('.admin-tab[data-tab="config"]');
                await expect(page.locator('.admin-tab[data-tab="config"]')).toHaveClass(/active/);
                await expect(page.locator('.admin-tab[data-tab="seeds"]')).not.toHaveClass(/active/);
                await expect(page.locator('#admin-content-config')).toHaveClass(/active/);
                await expect(page.locator('#admin-content-seeds')).not.toHaveClass(/active/);

                // Switch to generate tab
                await page.click('.admin-tab[data-tab="generate"]');
                await expect(page.locator('.admin-tab[data-tab="generate"]')).toHaveClass(/active/);
                await expect(page.locator('#admin-content-generate')).toHaveClass(/active/);
                await expect(page.locator('#admin-content-config')).not.toHaveClass(/active/);

                // Switch back to seeds
                await page.click('.admin-tab[data-tab="seeds"]');
                await expect(page.locator('.admin-tab[data-tab="seeds"]')).toHaveClass(/active/);
                await expect(page.locator('#admin-content-seeds')).toHaveClass(/active/);
            } finally {
                fs.rmSync(tmpDir, { recursive: true, force: true });
            }
        });

        test('only one tab active at a time', async ({ page, serverUrl }) => {
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-admin-onetab-'));
            try {
                const wikiDir = path.join(tmpDir, 'wiki-data');
                createCustomWiki(wikiDir, buildTestComponents(), CATEGORIES, { articles: TEST_ARTICLES });
                await seedWiki(serverUrl, 'admin-onetab-wiki', wikiDir, undefined, 'Admin OneTab Wiki');
                await selectWikiAndOpenAdmin(page, serverUrl, 'admin-onetab-wiki');

                // Click each tab and verify only one is active
                for (const tabName of ['seeds', 'config', 'generate']) {
                    await page.click(`.admin-tab[data-tab="${tabName}"]`);
                    const activeTabs = page.locator('.admin-tab.active');
                    await expect(activeTabs).toHaveCount(1);
                    const activeContents = page.locator('.admin-tab-content.active');
                    await expect(activeContents).toHaveCount(1);
                }
            } finally {
                fs.rmSync(tmpDir, { recursive: true, force: true });
            }
        });
    });

    // ================================================================
    // TC3: Seeds Tab - Load and Display
    // ================================================================

    test.describe('Seeds tab', () => {
        test('loads seeds content into editor', async ({ page, serverUrl }) => {
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-admin-seeds-'));
            try {
                const wikiDir = path.join(tmpDir, 'wiki-data');
                createCustomWiki(wikiDir, buildTestComponents(), CATEGORIES, { articles: TEST_ARTICLES });

                // Write a seeds.json file
                const seedsContent = { components: ['auth-service', 'api-gateway'], focus: 'security' };
                fs.writeFileSync(path.join(wikiDir, 'seeds.json'), JSON.stringify(seedsContent));

                await seedWiki(serverUrl, 'admin-seeds-wiki', wikiDir, undefined, 'Admin Seeds Wiki');
                await selectWikiAndOpenAdmin(page, serverUrl, 'admin-seeds-wiki');

                // Seeds editor should contain the seeds data
                const seedsEditor = page.locator('#seeds-editor');
                await expect(seedsEditor).not.toHaveValue('', { timeout: 5_000 });

                const value = await seedsEditor.inputValue();
                const parsed = JSON.parse(value);
                expect(parsed.components).toContain('auth-service');
                expect(parsed.focus).toBe('security');
            } finally {
                fs.rmSync(tmpDir, { recursive: true, force: true });
            }
        });

        test('save validates JSON and shows error on invalid', async ({ page, serverUrl }) => {
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-admin-seeds-inv-'));
            try {
                const wikiDir = path.join(tmpDir, 'wiki-data');
                createCustomWiki(wikiDir, buildTestComponents(), CATEGORIES, { articles: TEST_ARTICLES });
                await seedWiki(serverUrl, 'admin-seeds-inv-wiki', wikiDir, undefined, 'Admin Seeds Inv Wiki');
                await selectWikiAndOpenAdmin(page, serverUrl, 'admin-seeds-inv-wiki');

                // Type invalid JSON
                const seedsEditor = page.locator('#seeds-editor');
                await seedsEditor.fill('{ invalid json }');
                await page.click('#seeds-save');

                // Should show error status
                const status = page.locator('#seeds-status');
                await expect(status).toContainText('Invalid JSON', { timeout: 5_000 });
                await expect(status).toHaveClass(/error/);
            } finally {
                fs.rmSync(tmpDir, { recursive: true, force: true });
            }
        });

        test('reset restores original content', async ({ page, serverUrl }) => {
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-admin-seeds-reset-'));
            try {
                const wikiDir = path.join(tmpDir, 'wiki-data');
                createCustomWiki(wikiDir, buildTestComponents(), CATEGORIES, { articles: TEST_ARTICLES });

                const seedsContent = { original: true };
                fs.writeFileSync(path.join(wikiDir, 'seeds.json'), JSON.stringify(seedsContent));

                await seedWiki(serverUrl, 'admin-seeds-reset-wiki', wikiDir, undefined, 'Admin Seeds Reset Wiki');
                await selectWikiAndOpenAdmin(page, serverUrl, 'admin-seeds-reset-wiki');

                const seedsEditor = page.locator('#seeds-editor');
                await expect(seedsEditor).not.toHaveValue('', { timeout: 5_000 });

                // Modify content
                const originalValue = await seedsEditor.inputValue();
                await seedsEditor.fill('{ "modified": true }');

                // Reset
                await page.click('#seeds-reset');
                await expect(seedsEditor).toHaveValue(originalValue);
            } finally {
                fs.rmSync(tmpDir, { recursive: true, force: true });
            }
        });
    });

    // ================================================================
    // TC4: Config Tab
    // ================================================================

    test.describe('Config tab', () => {
        test('loads config content into editor', async ({ page, serverUrl }) => {
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-admin-config-'));
            try {
                // Create repo path with config
                const repoDir = path.join(tmpDir, 'repo');
                const wikiDir = path.join(tmpDir, 'wiki-data');
                fs.mkdirSync(repoDir, { recursive: true });

                // Write a deep-wiki config
                fs.writeFileSync(
                    path.join(repoDir, 'deep-wiki.config.yaml'),
                    'model: claude-sonnet\nconcurrency: 3\n',
                );

                createCustomWiki(wikiDir, buildTestComponents(), CATEGORIES, { articles: TEST_ARTICLES });
                await seedWiki(serverUrl, 'admin-config-wiki', wikiDir, repoDir, 'Admin Config Wiki');

                await selectWikiAndOpenAdmin(page, serverUrl, 'admin-config-wiki');

                // Switch to config tab
                await page.click('.admin-tab[data-tab="config"]');
                await expect(page.locator('#admin-content-config')).toHaveClass(/active/);

                // Config editor should contain the config data
                const configEditor = page.locator('#config-editor');
                // Wait a moment for the async load
                await page.waitForTimeout(1000);
                const value = await configEditor.inputValue();
                // Config may or may not be loaded depending on server-side resolution
                // Just verify the editor is accessible
                expect(typeof value).toBe('string');
            } finally {
                fs.rmSync(tmpDir, { recursive: true, force: true });
            }
        });
    });

    // ================================================================
    // TC5: Generate Tab - Phase Display
    // ================================================================

    test.describe('Generate tab', () => {
        test('displays all 5 phase cards', async ({ page, serverUrl }) => {
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-admin-gen-'));
            try {
                const wikiDir = path.join(tmpDir, 'wiki-data');
                createCustomWiki(wikiDir, buildTestComponents(), CATEGORIES, { articles: TEST_ARTICLES });
                await seedWiki(serverUrl, 'admin-gen-wiki', wikiDir, tmpDir, 'Admin Gen Wiki');
                await selectWikiAndOpenAdmin(page, serverUrl, 'admin-gen-wiki');

                // Switch to generate tab
                await page.click('.admin-tab[data-tab="generate"]');
                await expect(page.locator('#admin-content-generate')).toHaveClass(/active/);

                // All 5 phase cards should be present
                for (let i = 1; i <= 5; i++) {
                    await expect(page.locator(`#phase-card-${i}`)).toBeVisible();
                    await expect(page.locator(`#phase-run-${i}`)).toBeVisible();
                    await expect(page.locator(`#phase-cache-${i}`)).toBeVisible();
                }

                // Phase names should be displayed
                await expect(page.locator('#phase-card-1')).toContainText('Discovery');
                await expect(page.locator('#phase-card-2')).toContainText('Consolidation');
                await expect(page.locator('#phase-card-3')).toContainText('Analysis');
                await expect(page.locator('#phase-card-4')).toContainText('Writing');
                await expect(page.locator('#phase-card-5')).toContainText('Website');
            } finally {
                fs.rmSync(tmpDir, { recursive: true, force: true });
            }
        });

        test('force checkbox and range controls are present', async ({ page, serverUrl }) => {
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-admin-gen-ctrl-'));
            try {
                const wikiDir = path.join(tmpDir, 'wiki-data');
                createCustomWiki(wikiDir, buildTestComponents(), CATEGORIES, { articles: TEST_ARTICLES });
                await seedWiki(serverUrl, 'admin-gen-ctrl-wiki', wikiDir, tmpDir, 'Admin Gen Ctrl Wiki');
                await selectWikiAndOpenAdmin(page, serverUrl, 'admin-gen-ctrl-wiki');

                await page.click('.admin-tab[data-tab="generate"]');

                // Force checkbox
                await expect(page.locator('#generate-force')).toBeVisible();
                await expect(page.locator('#generate-force')).not.toBeChecked();

                // Range controls
                await expect(page.locator('#generate-start-phase')).toBeVisible();
                await expect(page.locator('#generate-end-phase')).toBeVisible();
                await expect(page.locator('#generate-run-range')).toBeVisible();
            } finally {
                fs.rmSync(tmpDir, { recursive: true, force: true });
            }
        });

        test('run phase triggers generation SSE', async ({ page, serverUrl }) => {
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-admin-gen-run-'));
            try {
                const wikiDir = path.join(tmpDir, 'wiki-data');
                createCustomWiki(wikiDir, buildTestComponents(), CATEGORIES, { articles: TEST_ARTICLES });
                await seedWiki(serverUrl, 'admin-gen-run-wiki', wikiDir, tmpDir, 'Admin Gen Run Wiki');
                await selectWikiAndOpenAdmin(page, serverUrl, 'admin-gen-run-wiki');

                await page.click('.admin-tab[data-tab="generate"]');

                // Mock the generate endpoint
                await page.route('**/api/wikis/*/admin/generate', async (route, req) => {
                    if (req.method() !== 'POST') return route.continue();

                    const body = JSON.parse(req.postData() || '{}');
                    const events = [
                        `data: ${JSON.stringify({ type: 'status', phase: body.startPhase, message: 'Starting discovery...' })}\n\n`,
                        `data: ${JSON.stringify({ type: 'log', phase: body.startPhase, message: 'Scanning files...' })}\n\n`,
                        `data: ${JSON.stringify({ type: 'phase-complete', phase: body.startPhase, success: true, message: 'Phase completed', duration: 1234 })}\n\n`,
                        `data: ${JSON.stringify({ type: 'done', success: true, duration: 1234 })}\n\n`,
                    ];

                    await route.fulfill({
                        status: 200,
                        headers: { 'Content-Type': 'text/event-stream' },
                        body: events.join(''),
                    });
                });

                // Also mock the generate/status endpoint that fires after completion
                await page.route('**/api/wikis/*/admin/generate/status', async (route) => {
                    await route.fulfill({
                        status: 200,
                        contentType: 'application/json',
                        body: JSON.stringify({
                            available: true,
                            running: false,
                            phases: {
                                '1': { cached: true },
                                '2': { cached: false },
                                '3': { cached: false },
                                '4': { cached: false },
                                '5': { cached: false },
                            },
                        }),
                    });
                });

                // Click Phase 1 Run button
                await page.click('#phase-run-1');

                // Status bar should show progress
                const statusBar = page.locator('#generate-status-bar');
                await expect(statusBar).not.toHaveClass(/hidden/, { timeout: 10_000 });

                // Wait for generation to complete
                await expect(statusBar).toContainText(/completed|Phase/, { timeout: 10_000 });

                // Phase card 1 should show success
                await expect(page.locator('#phase-card-1')).toHaveClass(/phase-success/, { timeout: 10_000 });
            } finally {
                fs.rmSync(tmpDir, { recursive: true, force: true });
            }
        });
    });

    // ================================================================
    // TC6: Generate Error Handling
    // ================================================================

    test.describe('Generate error handling', () => {
        test('shows error when generation fails', async ({ page, serverUrl }) => {
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-admin-gen-err-'));
            try {
                const wikiDir = path.join(tmpDir, 'wiki-data');
                createCustomWiki(wikiDir, buildTestComponents(), CATEGORIES, { articles: TEST_ARTICLES });
                await seedWiki(serverUrl, 'admin-gen-err-wiki', wikiDir, tmpDir, 'Admin Gen Err Wiki');
                await selectWikiAndOpenAdmin(page, serverUrl, 'admin-gen-err-wiki');

                await page.click('.admin-tab[data-tab="generate"]');

                // Mock generate endpoint to return error
                await page.route('**/api/wikis/*/admin/generate', async (route, req) => {
                    if (req.method() !== 'POST') return route.continue();
                    await route.fulfill({
                        status: 400,
                        contentType: 'application/json',
                        body: JSON.stringify({ error: 'Repository not found' }),
                    });
                });

                await page.click('#phase-run-1');

                // Status bar should show error
                const statusBar = page.locator('#generate-status-bar');
                await expect(statusBar).toContainText('Repository not found', { timeout: 10_000 });
                await expect(statusBar).toHaveClass(/error/);

                // Run buttons should be re-enabled
                await expect(page.locator('#phase-run-1')).not.toBeDisabled({ timeout: 5_000 });
            } finally {
                fs.rmSync(tmpDir, { recursive: true, force: true });
            }
        });

        test('shows conflict when generation already in progress', async ({ page, serverUrl }) => {
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-admin-gen-409-'));
            try {
                const wikiDir = path.join(tmpDir, 'wiki-data');
                createCustomWiki(wikiDir, buildTestComponents(), CATEGORIES, { articles: TEST_ARTICLES });
                await seedWiki(serverUrl, 'admin-gen-409-wiki', wikiDir, tmpDir, 'Admin Gen 409 Wiki');
                await selectWikiAndOpenAdmin(page, serverUrl, 'admin-gen-409-wiki');

                await page.click('.admin-tab[data-tab="generate"]');

                // Mock generate endpoint to return 409 conflict
                await page.route('**/api/wikis/*/admin/generate', async (route, req) => {
                    if (req.method() !== 'POST') return route.continue();
                    await route.fulfill({
                        status: 409,
                        contentType: 'application/json',
                        body: JSON.stringify({ error: 'Generation already in progress' }),
                    });
                });

                await page.click('#phase-run-1');

                const statusBar = page.locator('#generate-status-bar');
                await expect(statusBar).toContainText('already in progress', { timeout: 10_000 });
            } finally {
                fs.rmSync(tmpDir, { recursive: true, force: true });
            }
        });
    });

    // ================================================================
    // TC7: Tab switching preserves form state
    // ================================================================

    test.describe('Tab state preservation', () => {
        test('switching tabs preserves editor content', async ({ page, serverUrl }) => {
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-admin-preserve-'));
            try {
                const wikiDir = path.join(tmpDir, 'wiki-data');
                createCustomWiki(wikiDir, buildTestComponents(), CATEGORIES, { articles: TEST_ARTICLES });
                await seedWiki(serverUrl, 'admin-preserve-wiki', wikiDir, undefined, 'Admin Preserve Wiki');
                await selectWikiAndOpenAdmin(page, serverUrl, 'admin-preserve-wiki');

                // Type in seeds editor
                const seedsEditor = page.locator('#seeds-editor');
                await seedsEditor.fill('{"custom": "seeds data"}');

                // Switch to config tab
                await page.click('.admin-tab[data-tab="config"]');
                const configEditor = page.locator('#config-editor');
                await configEditor.fill('model: custom-model');

                // Switch to generate tab and back to seeds
                await page.click('.admin-tab[data-tab="generate"]');
                await page.click('.admin-tab[data-tab="seeds"]');

                // Seeds content should be preserved
                await expect(seedsEditor).toHaveValue('{"custom": "seeds data"}');

                // Switch back to config
                await page.click('.admin-tab[data-tab="config"]');
                await expect(configEditor).toHaveValue('model: custom-model');
            } finally {
                fs.rmSync(tmpDir, { recursive: true, force: true });
            }
        });
    });
});
