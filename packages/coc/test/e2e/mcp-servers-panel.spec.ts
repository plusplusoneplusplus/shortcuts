/**
 * MCP Servers Panel E2E Tests
 *
 * Tests the MCP Servers settings panel at #repos/:id/settings/mcp:
 *   - Navigation to the panel and rendering
 *   - Empty state when no MCP servers are configured
 *   - Server list rendering with available servers
 *   - Toggle enable/disable with optimistic UI and API persistence
 *   - Reload persistence of toggle state
 *   - Error handling on API failure
 *   - Badge count in the sidebar navigation
 */

import { test, expect } from './fixtures/server-fixture';
import { seedWorkspace, request } from './fixtures/seed';
import type { Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface McpConfigResponse {
    availableServers: { name: string; type: string }[];
    enabledMcpServers: string[] | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WS_ID = 'mcp-test-ws';
const WS_NAME = 'mcp-test-repo';

/** Dismiss the onboarding welcome modal so it doesn't block pointer events. */
async function dismissOnboarding(serverUrl: string): Promise<void> {
    await request(`${serverUrl}/api/preferences`, {
        method: 'PATCH',
        body: JSON.stringify({
            hasSeenWelcome: true,
            onboardingProgress: { dismissed: true, hasCompletedTour: true },
        }),
    });
}

/** Seed a workspace and navigate to its MCP settings panel. */
async function setupAndNavigate(
    page: Page,
    serverUrl: string,
): Promise<void> {
    await seedWorkspace(serverUrl, WS_ID, WS_NAME);
    await dismissOnboarding(serverUrl);
    await page.goto(`${serverUrl}/#repos/${WS_ID}/settings/mcp`);
    await expect(page.locator('[data-testid="settings-content-panel"]')).toBeVisible({ timeout: 10_000 });
}

/** Intercept the GET mcp-config API to return fake available servers. */
async function mockMcpConfig(
    page: Page,
    config: McpConfigResponse,
): Promise<void> {
    await page.route(`**/api/workspaces/${WS_ID}/mcp-config`, async (route, request) => {
        if (request.method() === 'GET') {
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(config),
            });
        }
        return route.continue();
    });
}

/**
 * Click the toggle label for an MCP server.
 * The checkbox is `sr-only` (visually hidden), so clicking it directly fails
 * because the visible slider `<div>` intercepts pointer events. Instead, click
 * the parent `<label>` which naturally toggles the checkbox.
 */
function clickToggle(page: Page, serverName: string) {
    return page.locator(`[data-testid="mcp-toggle-${serverName}"]`).locator('..').click();
}

const TWO_SERVERS: McpConfigResponse = {
    availableServers: [
        { name: 'code-tools', type: 'stdio' },
        { name: 'web-search', type: 'sse' },
    ],
    enabledMcpServers: null, // null = all enabled
};

// ---------------------------------------------------------------------------
// 1. Panel navigation and rendering
// ---------------------------------------------------------------------------

test.describe('MCP Servers Panel — Navigation', () => {
    test('MCP.1 navigates to settings/mcp and renders the panel', async ({ page, serverUrl }) => {
        await mockMcpConfig(page, TWO_SERVERS);
        await setupAndNavigate(page, serverUrl);

        // The MCP nav item should be visible in the sidebar
        await expect(page.locator('[data-testid="nav-item-mcp"]')).toBeVisible();
    });

    test('MCP.2 clicking MCP nav item switches to MCP section', async ({ page, serverUrl }) => {
        await mockMcpConfig(page, TWO_SERVERS);
        await seedWorkspace(serverUrl, WS_ID, WS_NAME);
        await dismissOnboarding(serverUrl);

        // Start on a different section (info)
        await page.goto(`${serverUrl}/#repos/${WS_ID}/settings/info`);
        await expect(page.locator('[data-testid="settings-content-panel"]')).toBeVisible({ timeout: 10_000 });

        // Click MCP nav
        await page.locator('[data-testid="nav-item-mcp"]').click();

        // Should show server list (checkbox is opacity:0, so check it's attached)
        await expect(page.locator('[data-testid="mcp-toggle-code-tools"]')).toBeAttached({ timeout: 10_000 });
    });
});

// ---------------------------------------------------------------------------
// 2. Empty state
// ---------------------------------------------------------------------------

test.describe('MCP Servers Panel — Empty state', () => {
    test('MCP.3 shows empty message when no MCP servers are configured', async ({ page, serverUrl }) => {
        await mockMcpConfig(page, {
            availableServers: [],
            enabledMcpServers: null,
        });
        await setupAndNavigate(page, serverUrl);

        await expect(page.getByText('No MCP servers configured.')).toBeVisible({ timeout: 10_000 });
    });
});

// ---------------------------------------------------------------------------
// 3. Server list rendering
// ---------------------------------------------------------------------------

test.describe('MCP Servers Panel — Server list', () => {
    test('MCP.4 renders all available servers with names and types', async ({ page, serverUrl }) => {
        await mockMcpConfig(page, TWO_SERVERS);
        await setupAndNavigate(page, serverUrl);

        const panel = page.locator('[data-testid="mcp-server-list"]');

        // Both server names visible
        await expect(panel.getByText('code-tools')).toBeVisible({ timeout: 10_000 });
        await expect(panel.getByText('web-search')).toBeVisible();

        // Type badges visible in the server list (scoped to avoid AddServerCard duplicates)
        await expect(panel.getByText('stdio').first()).toBeVisible();
        await expect(panel.getByText('sse').first()).toBeVisible();
    });

    test('MCP.5 all servers enabled when enabledMcpServers is null', async ({ page, serverUrl }) => {
        await mockMcpConfig(page, TWO_SERVERS);
        await setupAndNavigate(page, serverUrl);

        // Both toggles should be checked
        await expect(page.locator('[data-testid="mcp-toggle-code-tools"]')).toBeChecked({ timeout: 10_000 });
        await expect(page.locator('[data-testid="mcp-toggle-web-search"]')).toBeChecked();
    });

    test('MCP.6 only specified servers enabled when enabledMcpServers is an array', async ({ page, serverUrl }) => {
        await mockMcpConfig(page, {
            availableServers: TWO_SERVERS.availableServers,
            enabledMcpServers: ['code-tools'], // only code-tools enabled
        });
        await setupAndNavigate(page, serverUrl);

        await expect(page.locator('[data-testid="mcp-toggle-code-tools"]')).toBeChecked({ timeout: 10_000 });
        await expect(page.locator('[data-testid="mcp-toggle-web-search"]')).not.toBeChecked();
    });
});

// ---------------------------------------------------------------------------
// 4. Toggle enable/disable
// ---------------------------------------------------------------------------

test.describe('MCP Servers Panel — Toggle', () => {
    test('MCP.7 disabling a server updates the toggle optimistically', async ({ page, serverUrl }) => {
        await mockMcpConfig(page, TWO_SERVERS);
        await setupAndNavigate(page, serverUrl);

        // All initially enabled
        await expect(page.locator('[data-testid="mcp-toggle-code-tools"]')).toBeChecked({ timeout: 10_000 });

        // Disable code-tools
        await clickToggle(page, 'code-tools');

        // Toggle should update immediately (optimistic)
        await expect(page.locator('[data-testid="mcp-toggle-code-tools"]')).not.toBeChecked({ timeout: 5_000 });
        // Other server unchanged
        await expect(page.locator('[data-testid="mcp-toggle-web-search"]')).toBeChecked();
    });

    test('MCP.8 enabling a disabled server updates the toggle', async ({ page, serverUrl }) => {
        await mockMcpConfig(page, {
            availableServers: TWO_SERVERS.availableServers,
            enabledMcpServers: ['code-tools'],
        });
        await setupAndNavigate(page, serverUrl);

        // web-search initially disabled
        await expect(page.locator('[data-testid="mcp-toggle-web-search"]')).not.toBeChecked({ timeout: 10_000 });

        // Enable it
        await clickToggle(page, 'web-search');

        // Should now be checked
        await expect(page.locator('[data-testid="mcp-toggle-web-search"]')).toBeChecked({ timeout: 5_000 });
    });

    test('MCP.9 toggle sends PUT to mcp-config API', async ({ page, serverUrl }) => {
        // For this test, let the real API handle the toggle (no mock on PUT)
        // but still mock GET to seed available servers
        let putBody: any = null;
        await page.route(`**/api/workspaces/${WS_ID}/mcp-config`, async (route, request) => {
            if (request.method() === 'GET') {
                return route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify(TWO_SERVERS),
                });
            }
            if (request.method() === 'PUT') {
                putBody = JSON.parse(request.postData() ?? '{}');
                return route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({ workspace: { id: WS_ID } }),
                });
            }
            return route.continue();
        });

        await setupAndNavigate(page, serverUrl);
        await expect(page.locator('[data-testid="mcp-toggle-code-tools"]')).toBeChecked({ timeout: 10_000 });

        // Disable code-tools
        await clickToggle(page, 'code-tools');
        await expect(page.locator('[data-testid="mcp-toggle-code-tools"]')).not.toBeChecked({ timeout: 5_000 });

        // Verify PUT was called with the right payload
        // When disabling one of two servers, enabledMcpServers should contain only the other
        expect(putBody).not.toBeNull();
        expect(putBody.enabledMcpServers).toEqual(['web-search']);
    });

    test('MCP.10 enabling all servers resets enabledMcpServers to null', async ({ page, serverUrl }) => {
        let putBody: any = null;
        await page.route(`**/api/workspaces/${WS_ID}/mcp-config`, async (route, request) => {
            if (request.method() === 'GET') {
                return route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        availableServers: TWO_SERVERS.availableServers,
                        enabledMcpServers: ['code-tools'], // only one enabled
                    }),
                });
            }
            if (request.method() === 'PUT') {
                putBody = JSON.parse(request.postData() ?? '{}');
                return route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({ workspace: { id: WS_ID } }),
                });
            }
            return route.continue();
        });

        await setupAndNavigate(page, serverUrl);

        // Enable web-search (the only disabled one)
        await expect(page.locator('[data-testid="mcp-toggle-web-search"]')).not.toBeChecked({ timeout: 10_000 });
        await clickToggle(page, 'web-search');
        await expect(page.locator('[data-testid="mcp-toggle-web-search"]')).toBeChecked({ timeout: 5_000 });

        // When all servers are enabled, the value should be null
        expect(putBody).not.toBeNull();
        expect(putBody.enabledMcpServers).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// 5. Persistence across reload
// ---------------------------------------------------------------------------

test.describe('MCP Servers Panel — Persistence', () => {
    test('MCP.11 toggle state persists after page reload', async ({ page, serverUrl }) => {
        // Track PUT calls and capture the state
        let savedEnabledList: string[] | null = null;
        await page.route(`**/api/workspaces/${WS_ID}/mcp-config`, async (route, request) => {
            if (request.method() === 'GET') {
                return route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        availableServers: TWO_SERVERS.availableServers,
                        enabledMcpServers: savedEnabledList,
                    }),
                });
            }
            if (request.method() === 'PUT') {
                const body = JSON.parse(request.postData() ?? '{}');
                savedEnabledList = body.enabledMcpServers;
                return route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({ workspace: { id: WS_ID } }),
                });
            }
            return route.continue();
        });

        await setupAndNavigate(page, serverUrl);

        // Disable code-tools
        await expect(page.locator('[data-testid="mcp-toggle-code-tools"]')).toBeChecked({ timeout: 10_000 });
        await clickToggle(page, 'code-tools');
        await expect(page.locator('[data-testid="mcp-toggle-code-tools"]')).not.toBeChecked({ timeout: 5_000 });

        // Reload the page
        await page.goto(`${serverUrl}/#repos/${WS_ID}/settings/mcp`);
        await expect(page.locator('[data-testid="settings-content-panel"]')).toBeVisible({ timeout: 10_000 });

        // code-tools should still be disabled after reload
        await expect(page.locator('[data-testid="mcp-toggle-code-tools"]')).not.toBeChecked({ timeout: 10_000 });
        await expect(page.locator('[data-testid="mcp-toggle-web-search"]')).toBeChecked();
    });
});

// ---------------------------------------------------------------------------
// 6. Error handling
// ---------------------------------------------------------------------------

test.describe('MCP Servers Panel — Error handling', () => {
    test('MCP.12 shows error when GET mcp-config fails', async ({ page, serverUrl }) => {
        await page.route(`**/api/workspaces/${WS_ID}/mcp-config`, async (route, request) => {
            if (request.method() === 'GET') {
                return route.fulfill({
                    status: 500,
                    contentType: 'application/json',
                    body: JSON.stringify({ error: 'Internal server error' }),
                });
            }
            return route.continue();
        });

        await setupAndNavigate(page, serverUrl);

        // Error message should be displayed in the mcp-empty-state element
        await expect(page.locator('[data-testid="settings-content-panel"]').locator('.mcp-empty-state')).toBeVisible({ timeout: 10_000 });
    });

    test('MCP.13 shows error state on PUT failure', async ({ page, serverUrl }) => {
        let putCallCount = 0;
        await page.route(`**/api/workspaces/${WS_ID}/mcp-config`, async (route, request) => {
            if (request.method() === 'GET') {
                return route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify(TWO_SERVERS),
                });
            }
            if (request.method() === 'PUT') {
                putCallCount++;
                return route.fulfill({
                    status: 500,
                    contentType: 'application/json',
                    body: JSON.stringify({ error: 'save failed' }),
                });
            }
            return route.continue();
        });

        await setupAndNavigate(page, serverUrl);

        // All initially checked
        await expect(page.locator('[data-testid="mcp-toggle-code-tools"]')).toBeChecked({ timeout: 10_000 });

        // Try to disable — PUT will fail and the panel shows error state
        await clickToggle(page, 'code-tools');

        // After the PUT fails, an error message should be displayed
        await expect(page.locator('.mcp-empty-state')).toBeVisible({ timeout: 10_000 });
        expect(putCallCount).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// 7. Sidebar badge count
// ---------------------------------------------------------------------------

test.describe('MCP Servers Panel — Badge', () => {
    test('MCP.14 sidebar badge shows enabled server count', async ({ page, serverUrl }) => {
        await mockMcpConfig(page, {
            availableServers: TWO_SERVERS.availableServers,
            enabledMcpServers: ['code-tools'], // 1 of 2 enabled
        });
        await setupAndNavigate(page, serverUrl);

        // The MCP nav item badge should show "1"
        const mcpNav = page.locator('[data-testid="nav-item-mcp"]');
        await expect(mcpNav).toContainText('1', { timeout: 10_000 });
    });

    test('MCP.15 badge updates after toggling a server', async ({ page, serverUrl }) => {
        await page.route(`**/api/workspaces/${WS_ID}/mcp-config`, async (route, request) => {
            if (request.method() === 'GET') {
                return route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify(TWO_SERVERS),
                });
            }
            if (request.method() === 'PUT') {
                return route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({ workspace: { id: WS_ID } }),
                });
            }
            return route.continue();
        });

        await setupAndNavigate(page, serverUrl);

        // Initially all enabled → badge shows 2
        const mcpNav = page.locator('[data-testid="nav-item-mcp"]');
        await expect(mcpNav).toContainText('2', { timeout: 10_000 });

        // Disable one server
        await clickToggle(page, 'code-tools');
        await expect(page.locator('[data-testid="mcp-toggle-code-tools"]')).not.toBeChecked({ timeout: 5_000 });

        // Badge should now show 1
        await expect(mcpNav).toContainText('1', { timeout: 5_000 });
    });
});
