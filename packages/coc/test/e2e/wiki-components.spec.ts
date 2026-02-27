/**
 * Wiki Component Browser E2E Tests
 *
 * Tests the component tree rendering, navigation, group collapse/expand,
 * detail panel content, home view, and edge cases.
 *
 * Depends on:
 *   - Commit 001: wiki fixtures (createWikiFixture, createWikiComponent)
 *   - Commit 002: wiki management tests (seedWiki, select, list, delete)
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { seedWiki } from './fixtures/seed';
import { expect, test, safeRmSync } from './fixtures/server-fixture';
import type { CategoryInfo, ComponentGraph, ComponentInfo } from './fixtures/wiki-fixtures';
import { createWikiComponent, createWikiFixture } from './fixtures/wiki-fixtures';

// ================================================================
// Helpers
// ================================================================

/**
 * Write component markdown articles to the wiki's `components/` directory.
 * Keys are component IDs; values are markdown content strings.
 */
function writeComponentArticles(wikiDir: string, articles: Record<string, string>): void {
    const componentsDir = path.join(wikiDir, 'components');
    fs.mkdirSync(componentsDir, { recursive: true });
    for (const [id, content] of Object.entries(articles)) {
        fs.writeFileSync(path.join(componentsDir, `${id}.md`), content, 'utf-8');
    }
}

/**
 * Create a ComponentGraph with explicit components and categories,
 * write it + optional markdown articles to wikiDir.
 */
function createCustomWiki(
    wikiDir: string,
    components: ComponentInfo[],
    categories: CategoryInfo[],
    extras?: {
        articles?: Record<string, string>;
        projectName?: string;
        domains?: ComponentGraph['domains'];
    },
): ComponentGraph {
    const graph: ComponentGraph = {
        project: {
            name: extras?.projectName ?? 'Test Project',
            description: 'A test project for E2E wiki component tests',
            language: 'TypeScript',
            buildSystem: 'npm + webpack',
            entryPoints: ['src/index.ts'],
        },
        components,
        categories,
        architectureNotes: 'Layered architecture for testing.',
        domains: extras?.domains,
    };

    fs.mkdirSync(wikiDir, { recursive: true });
    fs.writeFileSync(
        path.join(wikiDir, 'component-graph.json'),
        JSON.stringify(graph, null, 2),
    );

    if (extras?.articles) {
        writeComponentArticles(wikiDir, extras.articles);
    }

    return graph;
}

/** Navigate to wiki tab and select a wiki by clicking its card. */
async function selectWiki(
    page: import('@playwright/test').Page,
    serverUrl: string,
    wikiId: string,
): Promise<void> {
    await page.goto(serverUrl);
    await page.click('[data-tab="wiki"]');
    await expect(page.locator('#wiki-card-list .wiki-card[data-wiki-id="' + wikiId + '"]')).toBeVisible({ timeout: 10_000 });
    await page.click('#wiki-card-list .wiki-card[data-wiki-id="' + wikiId + '"]');
    // Wait for tree to populate
    await expect(page.locator('#wiki-component-tree')).not.toBeEmpty({ timeout: 5_000 });
}

// ================================================================
// Shared fixtures
// ================================================================

const CATEGORIES: CategoryInfo[] = [
    { name: 'core', description: 'Core business logic' },
    { name: 'api', description: 'API layer and routing' },
    { name: 'infra', description: 'Infrastructure and tooling' },
];

function buildTestComponents(): ComponentInfo[] {
    return [
        createWikiComponent('auth-service', {
            category: 'core',
            complexity: 'high',
            dependencies: [],
            dependents: ['api-gateway'],
        }),
        createWikiComponent('data-store', {
            category: 'core',
            complexity: 'medium',
            dependencies: [],
            dependents: ['auth-service'],
        }),
        createWikiComponent('api-gateway', {
            category: 'api',
            complexity: 'medium',
            dependencies: ['auth-service'],
            dependents: [],
        }),
        createWikiComponent('logger', {
            category: 'infra',
            complexity: 'low',
            dependencies: [],
            dependents: [],
        }),
    ];
}

const TEST_ARTICLES: Record<string, string> = {
    'auth-service': '# Auth Service\n\nHandles user authentication and token management.\n\n## Features\n\n- JWT tokens\n- OAuth2 support',
    'api-gateway': '# API Gateway\n\nRoutes incoming HTTP requests.\n\n## Endpoints\n\n- `/api/v1/users`\n- `/api/v1/auth`',
    'data-store': '# Data Store\n\nPersistence layer for application data.',
};

// ================================================================
// Test Suite 1: Component Tree Rendering
// ================================================================

test.describe('Component tree rendering', () => {
    test('shows empty state when wiki has no components', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wiki-empty-'));
        try {
            const wikiDir = path.join(tmpDir, 'wiki-data');
            createCustomWiki(wikiDir, [], []);

            await seedWiki(serverUrl, 'empty-wiki', wikiDir, undefined, 'Empty Wiki');
            await page.goto(serverUrl);
            await page.click('[data-tab="wiki"]');

            await expect(page.locator('#wiki-card-list .wiki-card[data-wiki-id="empty-wiki"]')).toBeVisible({ timeout: 10_000 });
            await page.click('#wiki-card-list .wiki-card[data-wiki-id="empty-wiki"]');

            const tree = page.locator('#wiki-component-tree');
            await expect(tree.locator('.wiki-tree-empty')).toBeVisible({ timeout: 5_000 });
            await expect(tree.locator('.wiki-tree-empty')).toContainText('No components');
            await expect(tree.locator('.wiki-tree-component')).toHaveCount(0);
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('renders category groups with component items', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wiki-groups-'));
        try {
            const wikiDir = path.join(tmpDir, 'wiki-data');
            createCustomWiki(wikiDir, buildTestComponents(), CATEGORIES, {
                articles: TEST_ARTICLES,
            });

            await seedWiki(serverUrl, 'groups-wiki', wikiDir, undefined, 'Groups Wiki');
            await selectWiki(page, serverUrl, 'groups-wiki');

            // Verify category groups are rendered
            const groups = page.locator('.wiki-tree-group');
            await expect(groups).toHaveCount(3); // core, api, infra

            // Verify component items exist inside groups
            const componentItems = page.locator('.wiki-tree-component');
            await expect(componentItems).toHaveCount(4);

            // Verify specific components by data-id
            await expect(page.locator('.wiki-tree-component[data-id="auth-service"]')).toBeVisible();
            await expect(page.locator('.wiki-tree-component[data-id="data-store"]')).toBeVisible();
            await expect(page.locator('.wiki-tree-component[data-id="api-gateway"]')).toBeVisible();
            await expect(page.locator('.wiki-tree-component[data-id="logger"]')).toBeVisible();
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('group headers display component count badges', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wiki-counts-'));
        try {
            const wikiDir = path.join(tmpDir, 'wiki-data');
            createCustomWiki(wikiDir, buildTestComponents(), CATEGORIES, {
                articles: TEST_ARTICLES,
            });

            await seedWiki(serverUrl, 'counts-wiki', wikiDir, undefined, 'Counts Wiki');
            await selectWiki(page, serverUrl, 'counts-wiki');

            // core has 2 components (auth-service, data-store)
            const coreGroup = page.locator('.wiki-tree-group').filter({ hasText: 'core' }).first();
            await expect(coreGroup.locator('.wiki-tree-count')).toContainText('(2)');

            // api has 1 component (api-gateway)
            const apiGroup = page.locator('.wiki-tree-group').filter({ hasText: 'api' }).first();
            await expect(apiGroup.locator('.wiki-tree-count')).toContainText('(1)');

            // infra has 1 component (logger)
            const infraGroup = page.locator('.wiki-tree-group').filter({ hasText: 'infra' }).first();
            await expect(infraGroup.locator('.wiki-tree-count')).toContainText('(1)');
        } finally {
            safeRmSync(tmpDir);
        }
    });
});

// ================================================================
// Test Suite 2: Component Navigation
// ================================================================

test.describe('Component navigation', () => {
    test('clicking component loads detail panel with article content', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wiki-click-'));
        try {
            const wikiDir = path.join(tmpDir, 'wiki-data');
            createCustomWiki(wikiDir, buildTestComponents(), CATEGORIES, {
                articles: TEST_ARTICLES,
            });

            await seedWiki(serverUrl, 'click-wiki', wikiDir, undefined, 'Click Wiki');
            await selectWiki(page, serverUrl, 'click-wiki');

            // Click on auth-service component
            await page.click('.wiki-tree-component[data-id="auth-service"]');

            // Detail panel should be visible
            await expect(page.locator('#wiki-component-detail')).toBeVisible({ timeout: 5_000 });
            await expect(page.locator('#wiki-empty')).toBeHidden();

            // Article content should be rendered
            const content = page.locator('#wiki-article-content');
            await expect(content).toContainText('Auth Service', { timeout: 5_000 });
            await expect(content).toContainText('authentication and token management');
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('active component gets highlighted in tree', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wiki-active-'));
        try {
            const wikiDir = path.join(tmpDir, 'wiki-data');
            createCustomWiki(wikiDir, buildTestComponents(), CATEGORIES, {
                articles: TEST_ARTICLES,
            });

            await seedWiki(serverUrl, 'active-wiki', wikiDir, undefined, 'Active Wiki');
            await selectWiki(page, serverUrl, 'active-wiki');

            // Click auth-service
            await page.click('.wiki-tree-component[data-id="auth-service"]');
            await expect(page.locator('#wiki-article-content')).not.toBeEmpty({ timeout: 5_000 });

            // Verify active class
            const authItem = page.locator('.wiki-tree-component[data-id="auth-service"]');
            await expect(authItem).toHaveClass(/active/);

            // Other components should NOT be active
            const gatewayItem = page.locator('.wiki-tree-component[data-id="api-gateway"]');
            await expect(gatewayItem).not.toHaveClass(/active/);
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('navigating between components updates active state and content', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wiki-nav-'));
        try {
            const wikiDir = path.join(tmpDir, 'wiki-data');
            createCustomWiki(wikiDir, buildTestComponents(), CATEGORIES, {
                articles: TEST_ARTICLES,
            });

            await seedWiki(serverUrl, 'nav-wiki', wikiDir, undefined, 'Nav Wiki');
            await selectWiki(page, serverUrl, 'nav-wiki');

            // Click auth-service first
            await page.click('.wiki-tree-component[data-id="auth-service"]');
            await expect(page.locator('#wiki-article-content')).toContainText('Auth Service', { timeout: 5_000 });
            await expect(page.locator('.wiki-tree-component[data-id="auth-service"]')).toHaveClass(/active/);

            // Switch to api-gateway
            await page.click('.wiki-tree-component[data-id="api-gateway"]');
            await expect(page.locator('#wiki-article-content')).toContainText('API Gateway', { timeout: 5_000 });

            // Active state should transfer
            await expect(page.locator('.wiki-tree-component[data-id="api-gateway"]')).toHaveClass(/active/);
            await expect(page.locator('.wiki-tree-component[data-id="auth-service"]')).not.toHaveClass(/active/);
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('clicking component card in home view navigates to detail', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wiki-card-'));
        try {
            const wikiDir = path.join(tmpDir, 'wiki-data');
            createCustomWiki(wikiDir, buildTestComponents(), CATEGORIES, {
                articles: TEST_ARTICLES,
            });

            await seedWiki(serverUrl, 'card-wiki', wikiDir, undefined, 'Card Wiki');
            await selectWiki(page, serverUrl, 'card-wiki');

            // Home view should show component cards
            const cards = page.locator('.wiki-component-card');
            await expect(cards.first()).toBeVisible({ timeout: 5_000 });

            // Click the auth-service card
            await page.click('.wiki-component-card[data-component-id="auth-service"]');

            // Should navigate to detail view with article content
            await expect(page.locator('#wiki-article-content')).toContainText('Auth Service', { timeout: 5_000 });
            await expect(page.locator('.wiki-tree-component[data-id="auth-service"]')).toHaveClass(/active/);
        } finally {
            safeRmSync(tmpDir);
        }
    });
});

// ================================================================
// Test Suite 3: Tree Group Collapse/Expand
// ================================================================

test.describe('Tree group collapse & expand', () => {
    test('groups start expanded by default', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wiki-expand-'));
        try {
            const wikiDir = path.join(tmpDir, 'wiki-data');
            createCustomWiki(wikiDir, buildTestComponents(), CATEGORIES, {
                articles: TEST_ARTICLES,
            });

            await seedWiki(serverUrl, 'expand-wiki', wikiDir, undefined, 'Expand Wiki');
            await selectWiki(page, serverUrl, 'expand-wiki');

            // All groups should have 'expanded' class
            const groups = page.locator('.wiki-tree-group');
            const groupCount = await groups.count();
            expect(groupCount).toBeGreaterThan(0);

            for (let i = 0; i < groupCount; i++) {
                await expect(groups.nth(i)).toHaveClass(/expanded/);
            }

            // Components inside groups should be visible
            await expect(page.locator('.wiki-tree-component[data-id="auth-service"]')).toBeVisible();
            await expect(page.locator('.wiki-tree-component[data-id="logger"]')).toBeVisible();
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('clicking group header toggles collapse and expand', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wiki-toggle-'));
        try {
            const wikiDir = path.join(tmpDir, 'wiki-data');
            createCustomWiki(wikiDir, buildTestComponents(), CATEGORIES, {
                articles: TEST_ARTICLES,
            });

            await seedWiki(serverUrl, 'toggle-wiki', wikiDir, undefined, 'Toggle Wiki');
            await selectWiki(page, serverUrl, 'toggle-wiki');

            // Find the 'api' group (contains api-gateway)
            const apiGroup = page.locator('.wiki-tree-group').filter({ hasText: 'api' }).first();
            const apiHeader = apiGroup.locator('.wiki-tree-item');
            const apiChild = apiGroup.locator('.wiki-tree-component[data-id="api-gateway"]');

            // Initially expanded
            await expect(apiGroup).toHaveClass(/expanded/);
            await expect(apiChild).toBeVisible();

            // Collapse by clicking header
            await apiHeader.click();
            await expect(apiGroup).not.toHaveClass(/expanded/);
            await expect(apiChild).not.toBeVisible();

            // Expand again
            await apiHeader.click();
            await expect(apiGroup).toHaveClass(/expanded/);
            await expect(apiChild).toBeVisible();
        } finally {
            safeRmSync(tmpDir);
        }
    });
});

// ================================================================
// Test Suite 4: Component Detail Content
// ================================================================

test.describe('Component detail content', () => {
    test('detail panel renders markdown content as HTML', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wiki-md-'));
        try {
            const wikiDir = path.join(tmpDir, 'wiki-data');
            createCustomWiki(wikiDir, buildTestComponents(), CATEGORIES, {
                articles: TEST_ARTICLES,
            });

            await seedWiki(serverUrl, 'md-wiki', wikiDir, undefined, 'Markdown Wiki');
            await selectWiki(page, serverUrl, 'md-wiki');

            await page.click('.wiki-tree-component[data-id="auth-service"]');

            // Wait for article to load
            const content = page.locator('#wiki-article-content');
            await expect(content).toContainText('Auth Service', { timeout: 5_000 });

            // Markdown should be rendered as HTML (h1 tag or markdown-body class)
            const markdownBody = content.locator('.markdown-body');
            await expect(markdownBody).toBeVisible();

            // Check that markdown headings are rendered
            await expect(content).toContainText('Features');
            await expect(content).toContainText('JWT tokens');
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('source files section shows key files with toggle', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wiki-src-'));
        try {
            const wikiDir = path.join(tmpDir, 'wiki-data');
            createCustomWiki(wikiDir, buildTestComponents(), CATEGORIES, {
                articles: TEST_ARTICLES,
            });

            await seedWiki(serverUrl, 'src-wiki', wikiDir, undefined, 'Source Wiki');
            await selectWiki(page, serverUrl, 'src-wiki');

            await page.click('.wiki-tree-component[data-id="auth-service"]');
            await expect(page.locator('#wiki-article-content')).toContainText('Auth Service', { timeout: 5_000 });

            // Source files section should exist
            const sourceSection = page.locator('#wiki-source-files');
            await expect(sourceSection).toBeVisible();

            // Toggle should expand source files
            await page.click('#wiki-source-toggle');
            await expect(sourceSection).toHaveClass(/expanded/);

            // Source pills should show key files
            const pills = sourceSection.locator('.source-pill');
            await expect(pills.first()).toBeVisible();
            await expect(sourceSection).toContainText('auth-service');

            // Toggle again to collapse
            await page.click('#wiki-source-toggle');
            await expect(sourceSection).not.toHaveClass(/expanded/);
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('component without article shows fallback content', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wiki-noart-'));
        try {
            const wikiDir = path.join(tmpDir, 'wiki-data');
            // logger has no article in TEST_ARTICLES
            createCustomWiki(wikiDir, buildTestComponents(), CATEGORIES, {
                articles: TEST_ARTICLES, // no 'logger' entry
            });

            await seedWiki(serverUrl, 'noart-wiki', wikiDir, undefined, 'No Article Wiki');
            await selectWiki(page, serverUrl, 'noart-wiki');

            await page.click('.wiki-tree-component[data-id="logger"]');

            // Should show fallback content with component name and purpose
            const content = page.locator('#wiki-article-content');
            await expect(content).toContainText('Logger', { timeout: 5_000 });
            await expect(content).toContainText('logger');
        } finally {
            safeRmSync(tmpDir);
        }
    });
});

// ================================================================
// Test Suite 5: Home View & Edge Cases
// ================================================================

test.describe('Home view & edge cases', () => {
    test('home view shows project stats and component grid', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wiki-home-'));
        try {
            const wikiDir = path.join(tmpDir, 'wiki-data');
            createCustomWiki(wikiDir, buildTestComponents(), CATEGORIES, {
                articles: TEST_ARTICLES,
                projectName: 'My Test Project',
            });

            await seedWiki(serverUrl, 'home-wiki', wikiDir, undefined, 'Home Wiki');
            await selectWiki(page, serverUrl, 'home-wiki');

            // Home view content is inside wiki-component-detail (ProjectOverview)
            const content = page.locator('#wiki-component-detail');

            // Project name should appear
            await expect(content).toContainText('My Test Project', { timeout: 5_000 });

            // Stats cards should show component count and categories count
            const statCards = content.locator('.stat-card');
            await expect(statCards).toHaveCount(3); // Components, Categories, Language

            // Component grid should contain cards
            const cards = content.locator('.wiki-component-card');
            await expect(cards).toHaveCount(4);

            // Cards should display component names
            await expect(content).toContainText('Auth Service');
            await expect(content).toContainText('Api Gateway');
            await expect(content).toContainText('Logger');
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('domain-based tree grouping renders when domains present', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wiki-domain-'));
        try {
            const wikiDir = path.join(tmpDir, 'wiki-data');
            const graph = createWikiFixture(wikiDir, {
                componentCount: 6,
                withDomains: true,
            });

            // Write articles for first two components
            const articles: Record<string, string> = {};
            for (const comp of graph.components.slice(0, 2)) {
                articles[comp.id] = `# ${comp.name}\n\nDescription for ${comp.id}.`;
            }
            writeComponentArticles(wikiDir, articles);

            await seedWiki(serverUrl, 'domain-wiki', wikiDir, undefined, 'Domain Wiki');
            await selectWiki(page, serverUrl, 'domain-wiki');

            // Should have domain groups (Frontend, Backend) instead of categories
            const groups = page.locator('.wiki-tree-group');
            await expect(groups).toHaveCount(2);

            // Verify domain names appear in group headers
            const groupHeaders = page.locator('.wiki-tree-item');
            await expect(groupHeaders.first()).toContainText('Frontend');
            await expect(groupHeaders.nth(1)).toContainText('Backend');

            // All 6 components should appear in tree
            const items = page.locator('.wiki-tree-component');
            await expect(items).toHaveCount(6);

            // Clicking a component in domain tree should load its detail
            const firstComp = graph.components[0];
            await page.click(`.wiki-tree-component[data-id="${firstComp.id}"]`);
            await expect(page.locator('#wiki-article-content')).toContainText(
                firstComp.name,
                { timeout: 5_000 },
            );
        } finally {
            safeRmSync(tmpDir);
        }
    });
});
