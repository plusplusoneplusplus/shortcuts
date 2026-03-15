/**
 * Admin Provider Tokens Section E2E Tests
 *
 * Tests the ProviderTokensSection component rendered inside the AdminPanel.
 * All provider API calls are intercepted so no real GitHub token is needed.
 *
 * Scenarios covered:
 *  - No token saved → input shown without "already saved" message
 *  - Token saved    → "A token is already saved (****)" message shown
 *  - Saving a new GitHub token → PUT sent, success message, "already saved" appears
 *  - ADO section has no PAT input (removed); org URL can be saved
 */

import { test, expect } from './fixtures/server-fixture';

// ================================================================
// Helpers
// ================================================================

/** Navigate to admin page and wait for it to render. */
async function navigateToAdmin(page: import('@playwright/test').Page, serverUrl: string): Promise<void> {
    await page.goto(serverUrl);
    await page.click('#admin-toggle');
    await expect(page.locator('#view-admin')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#admin-page-content')).not.toBeEmpty({ timeout: 5000 });
}

/** Intercept GET /api/providers/config to return the given providers shape,
 *  and PUT /api/providers/config to return 204, in a single route handler. */
async function mockProviders(
    page: import('@playwright/test').Page,
    providers: Record<string, unknown>,
): Promise<void> {
    await page.route('**/api/providers/config', (route, req) => {
        if (req.method() === 'GET') {
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ providers }),
            });
        }
        if (req.method() === 'PUT') {
            return route.fulfill({ status: 204, body: '' });
        }
        return route.continue();
    });
}

/** Intercept GET /api/providers/config to return the given providers shape. */
async function mockGetProviders(
    page: import('@playwright/test').Page,
    providers: Record<string, unknown>,
): Promise<void> {
    await page.route('**/api/providers/config', (route, req) => {
        if (req.method() === 'GET') {
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ providers }),
            });
        }
        return route.continue();
    });
}

// ================================================================
// Tests
// ================================================================

test.describe('Admin: Provider Tokens section', () => {

    // ----------------------------------------------------------------
    // TC1: Provider Tokens section renders when there is no GitHub token
    // ----------------------------------------------------------------

    test('provider tokens section renders with no token saved', async ({ page, serverUrl }) => {
        await mockGetProviders(page, {});
        await navigateToAdmin(page, serverUrl);

        await expect(page.locator('[data-testid="provider-tokens-section"]')).toBeVisible({ timeout: 5000 });

        // GitHub subsection visible
        await expect(page.locator('[data-testid="github-subsection"]')).toBeVisible();

        // No "already saved" message when no token
        await expect(page.locator('[data-testid="github-token-saved"]')).toHaveCount(0);

        // Input shows placeholder for new token
        const input = page.locator('[data-testid="github-token-input"]');
        await expect(input).toBeVisible();
        expect(await input.getAttribute('placeholder')).toBe('ghp_...');
    });

    // ----------------------------------------------------------------
    // TC2: "Already saved" message shown when GitHub hasToken is true
    // ----------------------------------------------------------------

    test('shows "already saved" message when GitHub token is present', async ({ page, serverUrl }) => {
        await mockGetProviders(page, { github: { hasToken: true } });
        await navigateToAdmin(page, serverUrl);

        await expect(page.locator('[data-testid="github-token-saved"]')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('[data-testid="github-token-saved"]')).toContainText('A token is already saved');

        // Placeholder changes to ****
        const input = page.locator('[data-testid="github-token-input"]');
        expect(await input.getAttribute('placeholder')).toBe('****');
    });

    // ----------------------------------------------------------------
    // TC3: Saving a new GitHub token sends correct PUT and shows success
    // ----------------------------------------------------------------

    test('saving a GitHub token sends PUT and shows success', async ({ page, serverUrl }) => {
        await mockProviders(page, {});
        await navigateToAdmin(page, serverUrl);

        await expect(page.locator('[data-testid="github-subsection"]')).toBeVisible({ timeout: 5000 });

        // Intercept the PUT to capture the body
        const putPromise = page.waitForRequest(req =>
            req.url().includes('/api/providers/config') && req.method() === 'PUT',
        );

        // Type a token and save
        await page.fill('[data-testid="github-token-input"]', 'ghp_testtoken123');
        await page.click('[data-testid="github-save-button"]');

        const putReq = await putPromise;
        const body = JSON.parse(putReq.postData() ?? '{}');
        expect(body).toEqual({ github: { token: 'ghp_testtoken123' } });

        // Success indicator appears
        await expect(page.locator('[data-testid="github-save-success"]')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('[data-testid="github-save-success"]')).toContainText('GitHub token saved');
    });

    // ----------------------------------------------------------------
    // TC4: After saving, "already saved" message appears
    // ----------------------------------------------------------------

    test('after saving GitHub token the "already saved" message appears', async ({ page, serverUrl }) => {
        await mockProviders(page, {});
        await navigateToAdmin(page, serverUrl);

        await expect(page.locator('[data-testid="github-subsection"]')).toBeVisible({ timeout: 5000 });

        // No "already saved" before save
        await expect(page.locator('[data-testid="github-token-saved"]')).toHaveCount(0);

        // Save a token
        await page.fill('[data-testid="github-token-input"]', 'ghp_tok');
        await page.click('[data-testid="github-save-button"]');

        // Wait for save to complete (success indicator)
        await expect(page.locator('[data-testid="github-save-success"]')).toBeVisible({ timeout: 5000 });

        // "Already saved" message should now appear
        await expect(page.locator('[data-testid="github-token-saved"]')).toBeVisible({ timeout: 5000 });
    });

    // ----------------------------------------------------------------
    // TC5: GitHub save button is disabled when input is empty
    // ----------------------------------------------------------------

    test('GitHub save button is disabled when input is empty', async ({ page, serverUrl }) => {
        await mockGetProviders(page, {});
        await navigateToAdmin(page, serverUrl);

        await expect(page.locator('[data-testid="github-subsection"]')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('[data-testid="github-save-button"]')).toBeDisabled();
    });

    // ----------------------------------------------------------------
    // TC6: ADO section has no PAT input (removed)
    // ----------------------------------------------------------------

    test('ADO section does not contain a PAT input', async ({ page, serverUrl }) => {
        await mockGetProviders(page, {});
        await navigateToAdmin(page, serverUrl);

        await expect(page.locator('[data-testid="ado-subsection"]')).toBeVisible({ timeout: 5000 });

        // PAT input must not exist
        await expect(page.locator('[data-testid="ado-token-input"]')).toHaveCount(0);
        await expect(page.locator('[data-testid="ado-toggle-visibility"]')).toHaveCount(0);

        // Org URL input must still exist
        await expect(page.locator('[data-testid="ado-org-url-input"]')).toBeVisible();
    });

    // ----------------------------------------------------------------
    // TC7: ADO org URL can be saved (only orgUrl in PUT body)
    // ----------------------------------------------------------------

    test('saving ADO org URL sends PUT with orgUrl only', async ({ page, serverUrl }) => {
        await mockProviders(page, {});
        await navigateToAdmin(page, serverUrl);

        await expect(page.locator('[data-testid="ado-subsection"]')).toBeVisible({ timeout: 5000 });

        const putPromise = page.waitForRequest(req =>
            req.url().includes('/api/providers/config') && req.method() === 'PUT',
        );

        await page.fill('[data-testid="ado-org-url-input"]', 'https://dev.azure.com/myorg');
        await page.click('[data-testid="ado-save-button"]');

        const putReq = await putPromise;
        const body = JSON.parse(putReq.postData() ?? '{}');
        expect(body).toEqual({ ado: { orgUrl: 'https://dev.azure.com/myorg' } });
        expect((body.ado as any).token).toBeUndefined();

        await expect(page.locator('[data-testid="ado-save-success"]')).toBeVisible({ timeout: 5000 });
    });

    // ----------------------------------------------------------------
    // TC8: ADO org URL pre-populated from saved config
    // ----------------------------------------------------------------

    test('ADO org URL is pre-filled from saved config', async ({ page, serverUrl }) => {
        await mockGetProviders(page, { ado: { orgUrl: 'https://dev.azure.com/saved-org' } });
        await navigateToAdmin(page, serverUrl);

        const input = page.locator('[data-testid="ado-org-url-input"]');
        await expect(input).toBeVisible({ timeout: 5000 });
        expect(await input.inputValue()).toBe('https://dev.azure.com/saved-org');
    });

    // ----------------------------------------------------------------
    // TC9: ADO save button disabled when org URL is empty
    // ----------------------------------------------------------------

    test('ADO save button is disabled when org URL is empty', async ({ page, serverUrl }) => {
        await mockGetProviders(page, {});
        await navigateToAdmin(page, serverUrl);

        await expect(page.locator('[data-testid="ado-subsection"]')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('[data-testid="ado-save-button"]')).toBeDisabled();
    });

    // ----------------------------------------------------------------
    // TC10: Save error shown when PUT returns an error
    // ----------------------------------------------------------------

    test('shows error when GitHub token save fails', async ({ page, serverUrl }) => {
        await mockGetProviders(page, {});

        // PUT returns 400
        await page.route('**/api/providers/config', (route, req) => {
            if (req.method() === 'PUT') {
                return route.fulfill({
                    status: 400,
                    contentType: 'application/json',
                    body: JSON.stringify({ error: 'Invalid token format' }),
                });
            }
            return route.continue();
        });

        await navigateToAdmin(page, serverUrl);
        await expect(page.locator('[data-testid="github-subsection"]')).toBeVisible({ timeout: 5000 });

        await page.fill('[data-testid="github-token-input"]', 'bad-token');
        await page.click('[data-testid="github-save-button"]');

        await expect(page.locator('[data-testid="github-save-error"]')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('[data-testid="github-save-error"]')).toContainText('Invalid token format');
    });
});
