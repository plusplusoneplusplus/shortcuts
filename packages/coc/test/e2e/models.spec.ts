/**
 * Models View E2E Tests
 *
 * Tests the #models route: model card grid rendering, enable/disable toggle
 * with persistence via PUT /api/models/enabled, search filtering, capability
 * filtering, and UI state indicators (badges, enabled count, saving).
 */

import { test, expect } from './fixtures/server-fixture';
import { request } from './fixtures/seed';
import type { Page } from '@playwright/test';

// ================================================================
// Test data
// ================================================================

const MOCK_MODELS = [
    {
        id: 'model-alpha',
        name: 'Model Alpha',
        enabled: true,
        capabilities: {
            supports: { vision: true, reasoningEffort: true },
            limits: { max_context_window_tokens: 200_000 },
        },
    },
    {
        id: 'model-beta',
        name: 'Model Beta',
        enabled: false,
        capabilities: {
            supports: { vision: true, reasoningEffort: false },
            limits: { max_context_window_tokens: 128_000 },
        },
    },
    {
        id: 'model-gamma',
        name: 'Model Gamma',
        enabled: false,
        capabilities: {
            supports: { vision: false, reasoningEffort: false },
            limits: { max_context_window_tokens: 64_000 },
        },
    },
];

// ================================================================
// Helpers
// ================================================================

/** Mock GET /api/models to return a controlled set of models. */
async function mockModelsApi(page: Page, models = MOCK_MODELS): Promise<void> {
    await page.route('**/api/models', async (route, req) => {
        if (req.method() === 'GET') {
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(models),
            });
        }
        return route.continue();
    });
}

/** Navigate to the models view via hash. */
async function navigateToModels(page: Page, serverUrl: string): Promise<void> {
    await page.goto(`${serverUrl}/#models`);
    await expect(page.locator('#view-models')).toBeVisible({ timeout: 10_000 });
}

/** Dismiss the onboarding modal so it doesn't block interactions. */
async function dismissOnboarding(serverUrl: string): Promise<void> {
    await request(`${serverUrl}/api/preferences`, {
        method: 'PATCH',
        body: JSON.stringify({
            hasSeenWelcome: true,
            onboardingProgress: { dismissed: true },
        }),
    });
}

// ================================================================
// Tests
// ================================================================

test.describe('Models View', () => {

    // ----------------------------------------------------------------
    // TC1: Navigate to #models — model list renders
    // ----------------------------------------------------------------

    test('renders model cards when navigating to #models', async ({ page, serverUrl }) => {
        await mockModelsApi(page);
        await dismissOnboarding(serverUrl);
        await navigateToModels(page, serverUrl);

        const cards = page.locator('[data-testid="model-card"]');
        await expect(cards).toHaveCount(3);

        // Each card shows the model name
        await expect(cards.nth(0)).toContainText('Model Alpha');
        await expect(cards.nth(1)).toContainText('Model Beta');
        await expect(cards.nth(2)).toContainText('Model Gamma');
    });

    // ----------------------------------------------------------------
    // TC2: Toggle model enabled/disabled — UI reflects new state
    // ----------------------------------------------------------------

    test('toggling a model updates the toggle state in the UI', async ({ page, serverUrl }) => {
        let currentModels = MOCK_MODELS.map(m => ({ ...m }));

        await page.route('**/api/models', async (route, req) => {
            if (req.method() === 'GET') {
                return route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify(currentModels),
                });
            }
            return route.continue();
        });

        await page.route('**/api/models/enabled', async (route, req) => {
            if (req.method() === 'PUT') {
                const body = JSON.parse(req.postData() ?? '{}');
                const enabledSet = new Set(body.enabledModels ?? []);
                currentModels = currentModels.map(m => ({
                    ...m,
                    enabled: enabledSet.has(m.id),
                }));
                return route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({ enabledModels: body.enabledModels }),
                });
            }
            return route.continue();
        });

        await dismissOnboarding(serverUrl);
        await navigateToModels(page, serverUrl);

        // Alpha starts enabled — its toggle should be "on"
        const firstCard = page.locator('[data-testid="model-card"]').first();
        await expect(firstCard.locator('[data-testid="toggle-on"]')).toBeVisible();

        // Click the toggle to disable Alpha
        await firstCard.locator('[data-testid="model-toggle"]').click();

        // After optimistic update, the toggle should switch to "off"
        await expect(firstCard.locator('[data-testid="toggle-off"]')).toBeVisible({ timeout: 5000 });
    });

    // ----------------------------------------------------------------
    // TC3: Toggle persists across reload
    // ----------------------------------------------------------------

    test('toggled model state persists after page reload', async ({ page, serverUrl }) => {
        // Use real server APIs — no mocking — so persistence is tested end-to-end
        await dismissOnboarding(serverUrl);
        await navigateToModels(page, serverUrl);

        // Wait for model cards to appear (real server returns models from the registry)
        const cards = page.locator('[data-testid="model-card"]');
        await expect(cards.first()).toBeVisible({ timeout: 10_000 });

        const cardCount = await cards.count();
        expect(cardCount).toBeGreaterThan(0);

        // Find the first card and capture its current toggle state
        const firstToggle = cards.first().locator('[data-testid="model-toggle"]');
        await expect(firstToggle).toBeVisible();

        const wasEnabled = (await cards.first().locator('[data-testid="toggle-on"]').count()) > 0;

        // Click the toggle — PUT /api/models/enabled is called.
        // Both listeners must be set up BEFORE clicking. Otherwise the request
        // can complete before `waitForResponse` is awaited, deadlocking the
        // test (we observed a 30s timeout in CI on the response wait alone).
        const putRequestPromise = page.waitForRequest(req =>
            req.url().includes('/api/models/enabled') && req.method() === 'PUT',
        );
        const putResponsePromise = page.waitForResponse(
            res => res.url().includes('/api/models/enabled')
                && res.request().method() === 'PUT'
                && res.status() === 200,
        );
        await firstToggle.click();
        await putRequestPromise;
        await putResponsePromise;

        // Reload the page and navigate back to models
        await page.goto(`${serverUrl}/#models`);
        await expect(page.locator('#view-models')).toBeVisible({ timeout: 10_000 });
        await expect(page.locator('[data-testid="model-card"]').first()).toBeVisible({ timeout: 10_000 });

        // The toggle state should reflect the persisted change
        const isNowEnabled = (await cards.first().locator('[data-testid="toggle-on"]').count()) > 0;
        expect(isNowEnabled).toBe(!wasEnabled);
    });

    // ----------------------------------------------------------------
    // TC4: Search filters visible model cards by name
    // ----------------------------------------------------------------

    test('search input filters model cards by name', async ({ page, serverUrl }) => {
        await mockModelsApi(page);
        await dismissOnboarding(serverUrl);
        await navigateToModels(page, serverUrl);

        const cards = page.locator('[data-testid="model-card"]');
        await expect(cards).toHaveCount(3);

        // Type a search term that matches only one model
        await page.fill('[data-testid="models-search"]', 'Gamma');
        await expect(cards).toHaveCount(1);
        await expect(cards.first()).toContainText('Model Gamma');

        // Count indicator should update
        await expect(page.locator('[data-testid="models-count"]')).toHaveText('1 model');
    });

    // ----------------------------------------------------------------
    // TC5: Search filters by model ID
    // ----------------------------------------------------------------

    test('search input filters model cards by id', async ({ page, serverUrl }) => {
        await mockModelsApi(page);
        await dismissOnboarding(serverUrl);
        await navigateToModels(page, serverUrl);

        await page.fill('[data-testid="models-search"]', 'model-beta');
        const cards = page.locator('[data-testid="model-card"]');
        await expect(cards).toHaveCount(1);
        await expect(cards.first()).toContainText('Model Beta');
    });

    // ----------------------------------------------------------------
    // TC6: Capability filter — Vision
    // ----------------------------------------------------------------

    test('vision capability filter reduces visible cards', async ({ page, serverUrl }) => {
        await mockModelsApi(page);
        await dismissOnboarding(serverUrl);
        await navigateToModels(page, serverUrl);

        await page.selectOption('[data-testid="models-filter"]', 'vision');
        const cards = page.locator('[data-testid="model-card"]');
        // Only Alpha and Beta have vision
        await expect(cards).toHaveCount(2);
    });

    // ----------------------------------------------------------------
    // TC7: Capability filter — Reasoning
    // ----------------------------------------------------------------

    test('reasoning capability filter reduces visible cards', async ({ page, serverUrl }) => {
        await mockModelsApi(page);
        await dismissOnboarding(serverUrl);
        await navigateToModels(page, serverUrl);

        await page.selectOption('[data-testid="models-filter"]', 'reasoning');
        const cards = page.locator('[data-testid="model-card"]');
        // Only Alpha has reasoning
        await expect(cards).toHaveCount(1);
        await expect(cards.first()).toContainText('Model Alpha');
    });

    // ----------------------------------------------------------------
    // TC8: Combined search + filter
    // ----------------------------------------------------------------

    test('search and capability filter combine with AND logic', async ({ page, serverUrl }) => {
        await mockModelsApi(page);
        await dismissOnboarding(serverUrl);
        await navigateToModels(page, serverUrl);

        // Filter to vision models (Alpha, Beta)
        await page.selectOption('[data-testid="models-filter"]', 'vision');
        await expect(page.locator('[data-testid="model-card"]')).toHaveCount(2);

        // Further narrow by search to just Beta
        await page.fill('[data-testid="models-search"]', 'Beta');
        await expect(page.locator('[data-testid="model-card"]')).toHaveCount(1);
        await expect(page.locator('[data-testid="model-card"]').first()).toContainText('Model Beta');
    });

    // ----------------------------------------------------------------
    // TC9: Empty state when no models match filter
    // ----------------------------------------------------------------

    test('shows empty state when no models match filter', async ({ page, serverUrl }) => {
        await mockModelsApi(page);
        await dismissOnboarding(serverUrl);
        await navigateToModels(page, serverUrl);

        await page.fill('[data-testid="models-search"]', 'nonexistent-model-xyz');
        await expect(page.locator('[data-testid="models-empty"]')).toBeVisible();
        await expect(page.locator('[data-testid="models-count"]')).toHaveText('0 models');
    });

    // ----------------------------------------------------------------
    // TC10: Disabled model shown with toggle-off indicator
    // ----------------------------------------------------------------

    test('disabled model shows toggle-off indicator', async ({ page, serverUrl }) => {
        await mockModelsApi(page);
        await dismissOnboarding(serverUrl);
        await navigateToModels(page, serverUrl);

        // Beta is disabled — its card should show toggle-off
        const betaCard = page.locator('[data-testid="model-card"]').nth(1);
        await expect(betaCard).toContainText('Model Beta');
        await expect(betaCard.locator('[data-testid="toggle-off"]')).toBeVisible();

        // Alpha is enabled — its card should show toggle-on
        const alphaCard = page.locator('[data-testid="model-card"]').nth(0);
        await expect(alphaCard.locator('[data-testid="toggle-on"]')).toBeVisible();
    });

    // ----------------------------------------------------------------
    // TC11: Enabled count indicator
    // ----------------------------------------------------------------

    test('enabled count indicator shows correct counts', async ({ page, serverUrl }) => {
        await mockModelsApi(page);
        await dismissOnboarding(serverUrl);
        await navigateToModels(page, serverUrl);

        // 1 of 3 enabled (only Alpha)
        await expect(page.locator('[data-testid="models-enabled-count"]')).toContainText('1 of 3 enabled');
    });

    // ----------------------------------------------------------------
    // TC12: Capability badges render correctly
    // ----------------------------------------------------------------

    test('vision and reasoning badges render on appropriate cards', async ({ page, serverUrl }) => {
        await mockModelsApi(page);
        await dismissOnboarding(serverUrl);
        await navigateToModels(page, serverUrl);

        // Alpha has both vision and reasoning
        const alphaCard = page.locator('[data-testid="model-card"]').nth(0);
        await expect(alphaCard.locator('[data-testid="badge-vision"]')).toBeVisible();
        await expect(alphaCard.locator('[data-testid="badge-reasoning"]')).toBeVisible();

        // Beta has vision but not reasoning
        const betaCard = page.locator('[data-testid="model-card"]').nth(1);
        await expect(betaCard.locator('[data-testid="badge-vision"]')).toBeVisible();
        await expect(betaCard.locator('[data-testid="badge-reasoning"]')).toHaveCount(0);

        // Gamma has neither
        const gammaCard = page.locator('[data-testid="model-card"]').nth(2);
        await expect(gammaCard.locator('[data-testid="badge-vision"]')).toHaveCount(0);
        await expect(gammaCard.locator('[data-testid="badge-reasoning"]')).toHaveCount(0);
    });

    // ----------------------------------------------------------------
    // TC13: Context window displayed on cards
    // ----------------------------------------------------------------

    test('model cards display formatted context window size', async ({ page, serverUrl }) => {
        await mockModelsApi(page);
        await dismissOnboarding(serverUrl);
        await navigateToModels(page, serverUrl);

        // Alpha: 200k context
        const alphaCard = page.locator('[data-testid="model-card"]').nth(0);
        await expect(alphaCard).toContainText('200.0k');

        // Beta: 128k context
        const betaCard = page.locator('[data-testid="model-card"]').nth(1);
        await expect(betaCard).toContainText('128.0k');

        // Gamma: 64k context
        const gammaCard = page.locator('[data-testid="model-card"]').nth(2);
        await expect(gammaCard).toContainText('64.0k');
    });

    // ----------------------------------------------------------------
    // TC14: Toggle sends PUT /api/models/enabled with correct payload
    // ----------------------------------------------------------------

    test('toggle sends PUT /api/models/enabled with updated enabled list', async ({ page, serverUrl }) => {
        await mockModelsApi(page);

        // Intercept PUT to verify payload
        let capturedPayload: { enabledModels: string[] } | undefined;
        await page.route('**/api/models/enabled', async (route, req) => {
            if (req.method() === 'PUT') {
                capturedPayload = JSON.parse(req.postData() ?? '{}');
                return route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({ enabledModels: capturedPayload?.enabledModels ?? [] }),
                });
            }
            return route.continue();
        });

        await dismissOnboarding(serverUrl);
        await navigateToModels(page, serverUrl);

        // Alpha is enabled; disable it by clicking its toggle
        const alphaToggle = page.locator('[data-testid="model-card"]').first()
            .locator('[data-testid="model-toggle"]');
        await alphaToggle.click();

        // Wait for the PUT request
        await expect.poll(() => capturedPayload).toBeTruthy();

        // Payload should NOT contain model-alpha (disabled), and should NOT
        // contain others since they were already disabled
        expect(capturedPayload!.enabledModels).not.toContain('model-alpha');
    });

    // ----------------------------------------------------------------
    // TC15: Refresh button reloads model data
    // ----------------------------------------------------------------

    test('refresh button triggers GET /api/models', async ({ page, serverUrl }) => {
        await mockModelsApi(page);
        await dismissOnboarding(serverUrl);
        await navigateToModels(page, serverUrl);

        await expect(page.locator('[data-testid="model-card"]')).toHaveCount(3);

        // Wait for the refresh button and click it; expect a new GET /api/models
        const modelsRequest = page.waitForRequest(req =>
            req.url().includes('/api/models') && req.method() === 'GET',
        );
        await page.click('[data-testid="models-refresh-btn"]');
        await modelsRequest;
    });

    // ----------------------------------------------------------------
    // TC16: Error state renders with retry
    // ----------------------------------------------------------------

    test('shows error state with retry button on API failure', async ({ page, serverUrl }) => {
        // All GET /api/models calls fail until we flip this flag
        let shouldSucceed = false;

        await page.route('**/api/models', async (route, req) => {
            const url = new URL(req.url());
            if (req.method() !== 'GET' || !url.pathname.endsWith('/api/models')) {
                return route.continue();
            }
            if (!shouldSucceed) {
                return route.fulfill({
                    status: 500,
                    contentType: 'application/json',
                    body: JSON.stringify({ error: 'Internal Server Error' }),
                });
            }
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(MOCK_MODELS),
            });
        });

        await dismissOnboarding(serverUrl);
        await page.goto(`${serverUrl}/#models`);

        // Error state should be visible
        await expect(page.locator('[data-testid="models-error"]')).toBeVisible({ timeout: 10_000 });

        // Switch to success responses, then click retry
        shouldSucceed = true;
        await page.click('[data-testid="models-retry"]');
        await expect(page.locator('[data-testid="model-card"]')).toHaveCount(3, { timeout: 10_000 });
    });
});
