/**
 * Admin Config, Display Settings, Chat Settings & Restart E2E Tests
 *
 * Covers the per-card save model: AI & Execution card (load, save, validation,
 * error state), Chat Experience card (intent toggle, tool compactness, follow-up
 * save, count validation), Workspace Features card (terminal toggle), and the
 * Server Restart flow.
 */

import { test, expect } from './fixtures/server-fixture';

// ================================================================
// Helpers
// ================================================================

const MOCK_CONFIG_RESPONSE = {
    resolved: {
        model: 'gpt-4',
        parallel: 2,
        timeout: 3600,
        output: 'json',
        showReportIntent: false,
        toolCompactness: 1,
        approvePermissions: false,
        mcpConfig: false,
        persist: true,
        serve: { port: 4000, host: '127.0.0.1', dataDir: '/tmp/coc' },
        chat: { followUpSuggestions: { enabled: true, count: 3 } },
    },
    sources: {
        model: 'file',
        parallel: 'default',
        timeout: 'default',
        output: 'file',
        showReportIntent: 'default',
        toolCompactness: 'default',
    },
    configFilePath: '/tmp/.coc/config.yaml',
};

/** Navigate to the admin page and wait for content to load. */
async function navigateToAdmin(page: import('@playwright/test').Page, serverUrl: string): Promise<void> {
    await page.goto(serverUrl);
    await page.click('#admin-toggle');
    await expect(page.locator('#view-admin')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#admin-page-content')).not.toBeEmpty({ timeout: 5000 });
}

/** Switch the Settings tab to one of its sub-tab cards. The Settings tab defaults to `ai`. */
async function gotoSettingsSubTab(
    page: import('@playwright/test').Page,
    sub: 'ai' | 'chat' | 'appearance' | 'features' | 'integrations' | 'advanced',
): Promise<void> {
    const tab = page.locator(`[data-testid="settings-subtab-${sub}"]`);
    await expect(tab).toBeVisible({ timeout: 5000 });
    await tab.click();
}

// ================================================================
// Configuration Section
// ================================================================

test.describe('Admin: Configuration section', () => {

    test('config section loads and displays resolved values', async ({ page, serverUrl }) => {
        // Intercept config request to return controlled data
        await page.route('**/api/admin/config', (route, req) => {
            if (req.method() === 'GET') {
                return route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify(MOCK_CONFIG_RESPONSE),
                });
            }
            return route.continue();
        });

        await navigateToAdmin(page, serverUrl);

        // Config form should be populated from resolved values
        await expect(page.locator('#admin-config-model')).toHaveValue('gpt-4', { timeout: 5000 });
        await expect(page.locator('#admin-config-parallel')).toHaveValue('2');
        await expect(page.locator('#admin-config-timeout')).toHaveValue('3600');
        await expect(page.locator('#admin-config-output')).toHaveValue('json');

        // configFilePath is on the Server tab
        await page.click('[data-testid="admin-tab-server"]');
        await expect(page.locator('#admin-page-content')).toContainText('/tmp/.coc/config.yaml');
    });

    test('config save sends PUT and shows success toast', async ({ page, serverUrl }) => {
        await page.route('**/api/admin/config', (route, req) => {
            if (req.method() === 'GET') {
                return route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify(MOCK_CONFIG_RESPONSE),
                });
            }
            if (req.method() === 'PUT') {
                return route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify(MOCK_CONFIG_RESPONSE),
                });
            }
            return route.continue();
        });

        await navigateToAdmin(page, serverUrl);
        await expect(page.locator('#admin-config-parallel')).toHaveValue('2', { timeout: 5000 });

        // Change a value to make the AI & Execution card dirty
        await page.fill('#admin-config-parallel', '4');

        // Intercept the PUT request to verify payload
        const putPromise = page.waitForRequest(req =>
            req.url().includes('/api/admin/config') && req.method() === 'PUT',
        );

        await page.click('[data-testid="settings-ai-execution-save"]');

        const putReq = await putPromise;
        const body = JSON.parse(putReq.postData() ?? '{}');
        expect(body.parallel).toBe(4);
        expect(body.output).toBe('json');

        // Toast should appear
        await expect(page.locator('.toast-success')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.toast-success')).toContainText('Settings saved');
    });

    test('config save validation rejects parallelism less than 1', async ({ page, serverUrl }) => {
        await page.route('**/api/admin/config', (route, req) => {
            if (req.method() === 'GET') {
                return route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify(MOCK_CONFIG_RESPONSE),
                });
            }
            return route.continue();
        });

        await navigateToAdmin(page, serverUrl);
        await expect(page.locator('#admin-config-parallel')).toHaveValue('2', { timeout: 5000 });

        // Set invalid parallel value
        await page.fill('#admin-config-parallel', '0');
        await page.click('[data-testid="settings-ai-execution-save"]');

        // Error toast should appear with validation message
        await expect(page.locator('.toast-error')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.toast-error')).toContainText('Parallelism must be at least 1');
    });

    test('config save validation rejects negative timeout', async ({ page, serverUrl }) => {
        await page.route('**/api/admin/config', (route, req) => {
            if (req.method() === 'GET') {
                return route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify(MOCK_CONFIG_RESPONSE),
                });
            }
            return route.continue();
        });

        await navigateToAdmin(page, serverUrl);
        await expect(page.locator('#admin-config-parallel')).toHaveValue('2', { timeout: 5000 });

        // Set invalid timeout value (-5)
        await page.fill('#admin-config-timeout', '-5');
        await page.click('[data-testid="settings-ai-execution-save"]');

        // Error toast should appear
        await expect(page.locator('.toast-error')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.toast-error')).toContainText('Timeout must be a positive integer');
    });

    test('config load failure shows error in Configuration card', async ({ page, serverUrl }) => {
        // Return 500 from config endpoint
        await page.route('**/api/admin/config', route =>
            route.fulfill({
                status: 500,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'Internal Server Error' }),
            }),
        );

        await navigateToAdmin(page, serverUrl);

        // Config error element should be visible
        await expect(page.locator('[data-testid="admin-config-error"]')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('[data-testid="admin-config-error"]')).toContainText('Failed to load configuration');
    });
});

// ================================================================
// Display Settings
// ================================================================

test.describe('Admin: Display settings', () => {

    test('toggle show intent announcements sends PUT via card save', async ({ page, serverUrl }) => {
        await page.route('**/api/admin/config', (route, req) => {
            if (req.method() === 'GET') {
                return route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify(MOCK_CONFIG_RESPONSE),
                });
            }
            if (req.method() === 'PUT') {
                return route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify(MOCK_CONFIG_RESPONSE),
                });
            }
            return route.continue();
        });

        await navigateToAdmin(page, serverUrl);
        await gotoSettingsSubTab(page, 'chat');
        // The AdminToggle input is sr-only (opacity:0, width:0, height:0), so
        // toBeVisible() reports it as hidden and Playwright also refuses to
        // click it because it has zero size. Use a direct DOM .click() on the
        // checkbox instead.
        await expect(page.locator('[data-testid="toggle-show-report-intent"]')).toBeAttached({ timeout: 5000 });
        await page.locator('[data-testid="toggle-show-report-intent"]').evaluate((el) => (el as HTMLInputElement).click());

        // Intercept PUT and click per-card save
        const putPromise = page.waitForRequest(req =>
            req.url().includes('/api/admin/config') && req.method() === 'PUT',
        );
        await page.click('[data-testid="settings-chat-save"]');

        const putReq = await putPromise;
        const body = JSON.parse(putReq.postData() ?? '{}');
        expect(typeof body.showReportIntent).toBe('boolean');

        // Toast 'Settings saved'
        await expect(page.locator('.toast-success')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.toast-success')).toContainText('Settings saved');
    });

    test('tool compactness Minimal button sends PUT via card save', async ({ page, serverUrl }) => {
        await page.route('**/api/admin/config', (route, req) => {
            if (req.method() === 'GET') {
                return route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify(MOCK_CONFIG_RESPONSE),
                });
            }
            if (req.method() === 'PUT') {
                return route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify(MOCK_CONFIG_RESPONSE),
                });
            }
            return route.continue();
        });

        await navigateToAdmin(page, serverUrl);
        await gotoSettingsSubTab(page, 'chat');
        await expect(page.locator('[data-testid="tool-compactness-minimal"]')).toBeVisible({ timeout: 5000 });

        await page.locator('[data-testid="tool-compactness-minimal"]').click();

        // Click per-card save to persist the change
        const putPromise = page.waitForRequest(req =>
            req.url().includes('/api/admin/config') && req.method() === 'PUT',
        );
        await page.click('[data-testid="settings-chat-save"]');

        const putReq = await putPromise;
        const body = JSON.parse(putReq.postData() ?? '{}');
        expect(body.toolCompactness).toBe(2);

        await expect(page.locator('.toast-success')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.toast-success')).toContainText('Settings saved');
    });

    test('feature toggles send PUT via card save', async ({ page, serverUrl }) => {
        await page.route('**/api/admin/config', (route, req) => {
            if (req.method() === 'GET') {
                return route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        ...MOCK_CONFIG_RESPONSE,
                        resolved: { ...MOCK_CONFIG_RESPONSE.resolved, terminal: { enabled: false } },
                    }),
                });
            }
            if (req.method() === 'PUT') {
                return route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify(MOCK_CONFIG_RESPONSE),
                });
            }
            return route.continue();
        });

        await navigateToAdmin(page, serverUrl);
        await gotoSettingsSubTab(page, 'features');
        // sr-only checkbox — toggle via direct DOM click() to bypass viewport
        // and visibility checks.
        await expect(page.locator('[data-testid="toggle-terminal-enabled"]')).toBeAttached({ timeout: 5000 });
        await page.locator('[data-testid="toggle-terminal-enabled"]').evaluate((el) => (el as HTMLInputElement).click());
        await expect(page.locator('[data-testid="toggle-session-context-attachments-enabled"]')).toBeAttached({ timeout: 5000 });
        await page.locator('[data-testid="toggle-session-context-attachments-enabled"]').evaluate((el) => (el as HTMLInputElement).click());

        // Click per-card save to persist the change
        const putPromise = page.waitForRequest(req =>
            req.url().includes('/api/admin/config') && req.method() === 'PUT',
        );
        await page.click('[data-testid="settings-features-save"]');

        const putReq = await putPromise;
        const body = JSON.parse(putReq.postData() ?? '{}');
        expect(typeof body['terminal.enabled']).toBe('boolean');
        expect(body['features.sessionContextAttachments']).toBe(true);

        // Toast 'Settings saved'
        await expect(page.locator('.toast-success')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.toast-success')).toContainText('Settings saved');
    });
});

// ================================================================
// Chat Settings
// ================================================================

test.describe('Admin: Chat settings', () => {

    test('chat settings save sends PUT and shows toast', async ({ page, serverUrl }) => {
        await page.route('**/api/admin/config', (route, req) => {
            if (req.method() === 'GET') {
                return route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify(MOCK_CONFIG_RESPONSE),
                });
            }
            if (req.method() === 'PUT') {
                return route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify(MOCK_CONFIG_RESPONSE),
                });
            }
            return route.continue();
        });

        await navigateToAdmin(page, serverUrl);
        await gotoSettingsSubTab(page, 'chat');
        await expect(page.locator('[data-testid="input-chat-followup-count"]')).toHaveValue('3', { timeout: 5000 });

        // Change count to 5
        await page.fill('[data-testid="input-chat-followup-count"]', '5');

        const putPromise = page.waitForRequest(req =>
            req.url().includes('/api/admin/config') && req.method() === 'PUT',
        );

        await page.click('[data-testid="settings-chat-save"]');

        const putReq = await putPromise;
        const body = JSON.parse(putReq.postData() ?? '{}');
        expect(body['chat.followUpSuggestions.count']).toBe(5);

        await expect(page.locator('.toast-success')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.toast-success')).toContainText('Settings saved');
    });

    test('chat count validation rejects out-of-range value', async ({ page, serverUrl }) => {
        await page.route('**/api/admin/config', (route, req) => {
            if (req.method() === 'GET') {
                return route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify(MOCK_CONFIG_RESPONSE),
                });
            }
            return route.continue();
        });

        await navigateToAdmin(page, serverUrl);
        await gotoSettingsSubTab(page, 'chat');
        await expect(page.locator('[data-testid="input-chat-followup-count"]')).toHaveValue('3', { timeout: 5000 });

        // Set invalid count (0)
        await page.fill('[data-testid="input-chat-followup-count"]', '0');
        await page.click('[data-testid="settings-chat-save"]');

        await expect(page.locator('.toast-error')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.toast-error')).toContainText('Follow-up count must be an integer between 1 and 5');
    });
});

// ================================================================
// Server Restart
// ================================================================

test.describe('Admin: Server restart', () => {

    test('restart button sends POST and shows restarting status', async ({ page, serverUrl }) => {
        await page.route('**/api/admin/config', (route, req) => {
            if (req.method() === 'GET') {
                return route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify(MOCK_CONFIG_RESPONSE),
                });
            }
            return route.continue();
        });

        // Mock the restart endpoint
        await page.route('**/api/admin/restart', route =>
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ ok: true }),
            }),
        );

        // Mock stats to keep polling from reloading
        await page.route('**/api/admin/data/stats**', route =>
            route.fulfill({
                status: 503,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'restarting' }),
            }),
        );

        await navigateToAdmin(page, serverUrl);
        await page.click('[data-testid="admin-tab-server"]');

        const restartPromise = page.waitForRequest(req =>
            req.url().includes('/api/admin/restart') && req.method() === 'POST',
        );

        await page.click('#admin-restart-btn');

        await restartPromise;

        // Status should show 'Server is restarting'
        await expect(page.locator('#admin-restart-status')).toContainText('restarting', { timeout: 5000 });
    });

    test('restart failure shows error status', async ({ page, serverUrl }) => {
        await page.route('**/api/admin/config', (route, req) => {
            if (req.method() === 'GET') {
                return route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify(MOCK_CONFIG_RESPONSE),
                });
            }
            return route.continue();
        });

        // Mock restart endpoint to fail
        await page.route('**/api/admin/restart', route =>
            route.fulfill({
                status: 503,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'Service Unavailable' }),
            }),
        );

        await navigateToAdmin(page, serverUrl);
        await page.click('[data-testid="admin-tab-server"]');

        await page.click('#admin-restart-btn');

        // Status should show failure message
        await expect(page.locator('#admin-restart-status')).toContainText('Restart failed', { timeout: 5000 });

        // Button should be re-enabled
        await expect(page.locator('#admin-restart-btn')).not.toBeDisabled({ timeout: 5000 });
    });
});
