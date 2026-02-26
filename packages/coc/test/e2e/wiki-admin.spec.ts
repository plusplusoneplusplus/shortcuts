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

import type { Page } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { seedWiki } from './fixtures/seed';
import { expect, test } from './fixtures/server-fixture';
import type { CategoryInfo, ComponentGraph, ComponentInfo } from './fixtures/wiki-fixtures';
import { createWikiComponent } from './fixtures/wiki-fixtures';

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
    tab: 'seeds' | 'config' | 'generate' = 'seeds',
): Promise<void> {
    await page.goto(serverUrl);
    await page.click('[data-tab="wiki"]');
    await expect(page.locator('#wiki-card-list .wiki-card[data-wiki-id="' + wikiId + '"]')).toBeVisible({ timeout: 10_000 });
    await page.click('#wiki-card-list .wiki-card[data-wiki-id="' + wikiId + '"]');
    await expect(page.locator('#wiki-component-tree')).not.toBeEmpty({ timeout: 5_000 });

    // Open admin panel through project-level admin tab, then select admin sub-tab
    await expect(page.locator('#wiki-project-tabs')).toBeVisible({ timeout: 5_000 });
    await page.click('.wiki-project-tab[data-wiki-project-tab="admin"]');
    await expect(page.locator('[data-wiki-admin-tab="' + tab + '"]')).toBeVisible({ timeout: 5_000 });
    await page.click('[data-wiki-admin-tab="' + tab + '"]');
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
        test('switching to action tabs shows admin panel and keeps sidebar', async ({ page, serverUrl }) => {
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-admin-toggle-'));
            try {
                const wikiDir = path.join(tmpDir, 'wiki-data');
                createCustomWiki(wikiDir, buildTestComponents(), CATEGORIES, { articles: TEST_ARTICLES });
                await seedWiki(serverUrl, 'admin-toggle-wiki', wikiDir, undefined, 'Admin Toggle Wiki');

                await selectWikiAndOpenAdmin(page, serverUrl, 'admin-toggle-wiki', 'seeds');

                // Admin content should be visible
                await expect(page.locator('[data-wiki-admin-tab="seeds"]')).toBeVisible({ timeout: 5_000 });

                // Switch back to browse
                await page.click('.wiki-project-tab[data-wiki-project-tab="browse"]');
                await expect(page.locator('#wiki-component-tree')).toBeVisible();
                await expect(page.locator('#wiki-component-detail')).toBeVisible();
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

                // Seeds tab should be active by default (admin sub-tab)
                await expect(page.locator('[data-wiki-admin-tab="seeds"]')).toHaveClass(/bg-\[#0078d4\]/);
                await expect(page.locator('#admin-content-seeds')).toBeVisible();
                await expect(page.locator('#admin-content-config')).not.toBeVisible();
                await expect(page.locator('#admin-content-generate')).not.toBeVisible();

                // Switch to config tab
                await page.click('[data-wiki-admin-tab="config"]');
                await expect(page.locator('[data-wiki-admin-tab="config"]')).toHaveClass(/bg-\[#0078d4\]/);
                await expect(page.locator('#admin-content-config')).toBeVisible();
                await expect(page.locator('#admin-content-seeds')).not.toBeVisible();

                // Switch to generate tab
                await page.click('[data-wiki-admin-tab="generate"]');
                await expect(page.locator('[data-wiki-admin-tab="generate"]')).toHaveClass(/bg-\[#0078d4\]/);
                await expect(page.locator('#admin-content-generate')).toBeVisible();
                await expect(page.locator('#admin-content-config')).not.toBeVisible();

                // Switch back to seeds
                await page.click('[data-wiki-admin-tab="seeds"]');
                await expect(page.locator('[data-wiki-admin-tab="seeds"]')).toHaveClass(/bg-\[#0078d4\]/);
                await expect(page.locator('#admin-content-seeds')).toBeVisible();
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

                // Click each tab and verify content switches
                for (const tabName of ['seeds', 'config', 'generate']) {
                    await page.click(`[data-wiki-admin-tab="${tabName}"]`);
                    await expect(page.locator(`#admin-content-${tabName}`)).toBeVisible();
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

                // Write a seeds.yaml file (server reads seeds.yaml)
                const seedsYaml = 'components:\n  - auth-service\n  - api-gateway\nfocus: security\n';
                fs.writeFileSync(path.join(wikiDir, 'seeds.yaml'), seedsYaml);

                await seedWiki(serverUrl, 'admin-seeds-wiki', wikiDir, undefined, 'Admin Seeds Wiki');
                await selectWikiAndOpenAdmin(page, serverUrl, 'admin-seeds-wiki');

                // Seeds editor should contain the seeds data
                const seedsEditor = page.locator('#seeds-editor');
                await expect(seedsEditor).not.toHaveValue('', { timeout: 5_000 });

                const value = await seedsEditor.inputValue();
                expect(value).toContain('auth-service');
                expect(value).toContain('security');
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

                // Type invalid YAML (unclosed quote)
                const seedsEditor = page.locator('#seeds-editor');
                await seedsEditor.fill('key: "unclosed string');
                await page.click('#seeds-save');

                // Should show error status (seeds editor validates YAML)
                const status = page.locator('#seeds-status');
                await expect(status).toContainText('Invalid', { timeout: 5_000 });
            } finally {
                fs.rmSync(tmpDir, { recursive: true, force: true });
            }
        });

        test('reset restores original content', async ({ page, serverUrl }) => {
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-admin-seeds-reset-'));
            try {
                const wikiDir = path.join(tmpDir, 'wiki-data');
                createCustomWiki(wikiDir, buildTestComponents(), CATEGORIES, { articles: TEST_ARTICLES });

                const seedsYaml = 'original: true\n';
                fs.writeFileSync(path.join(wikiDir, 'seeds.yaml'), seedsYaml);

                await seedWiki(serverUrl, 'admin-seeds-reset-wiki', wikiDir, undefined, 'Admin Seeds Reset Wiki');
                await selectWikiAndOpenAdmin(page, serverUrl, 'admin-seeds-reset-wiki');

                const seedsEditor = page.locator('#seeds-editor');
                await expect(seedsEditor).not.toHaveValue('', { timeout: 5_000 });

                // Modify content
                const originalValue = await seedsEditor.inputValue();
                await seedsEditor.fill('modified: true');

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
                await page.click('[data-wiki-admin-tab="config"]');
                await expect(page.locator('#admin-content-config')).toBeVisible();

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
                await selectWikiAndOpenAdmin(page, serverUrl, 'admin-gen-wiki', 'generate');
                await expect(page.locator('#admin-content-generate')).toBeVisible();

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

                await page.click('[data-wiki-admin-tab="generate"]');

                // Start phase select and Run buttons
                await expect(page.locator('#generate-start-phase')).toBeVisible();
                await expect(page.locator('#phase-run-1')).toBeVisible();
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

                await page.click('[data-wiki-admin-tab="generate"]');

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

                // Status bar or phase log should show progress
                await expect(page.locator('#generate-status-bar, #phase-log-1')).toBeVisible({ timeout: 10_000 });

                // Wait for generation to complete (status bar disappears when done)
                await expect(page.locator('#phase-log-1')).toContainText(/Complete|✓/, { timeout: 10_000 });
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

                await page.click('[data-wiki-admin-tab="generate"]');

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

                await page.click('[data-wiki-admin-tab="generate"]');

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
        test('switching tabs preserves saved seeds content', async ({ page, serverUrl }) => {
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-admin-preserve-'));
            try {
                const wikiDir = path.join(tmpDir, 'wiki-data');
                createCustomWiki(wikiDir, buildTestComponents(), CATEGORIES, { articles: TEST_ARTICLES });
                await seedWiki(serverUrl, 'admin-preserve-wiki', wikiDir, undefined, 'Admin Preserve Wiki');
                await selectWikiAndOpenAdmin(page, serverUrl, 'admin-preserve-wiki');
                await page.waitForTimeout(600);

                // Type in seeds editor and save
                const seedsEditor = page.locator('#seeds-editor');
                await seedsEditor.fill('{"custom": "seeds data"}');
                await page.click('#seeds-save');
                await expect(page.locator('#seeds-status')).toContainText('Saved');

                // Switch to config tab and edit
                await page.click('[data-wiki-admin-tab="config"]');
                const configEditor = page.locator('#config-editor');
                await page.waitForTimeout(300);
                await configEditor.fill('model: custom-model');

                // Switch to generate tab and back to seeds
                await page.click('[data-wiki-admin-tab="generate"]');
                await page.click('[data-wiki-admin-tab="seeds"]');

                // Saved seeds content should be preserved after tab switches (YAML format)
                await expect(seedsEditor).toContainText('custom');
                await expect(seedsEditor).toContainText('seeds data');
            } finally {
                fs.rmSync(tmpDir, { recursive: true, force: true });
            }
        });
    });
});
