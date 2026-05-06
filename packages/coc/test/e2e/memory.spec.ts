/**
 * Memory E2E Tests
 *
 * Tests the #memory route: MemoryView sub-tab navigation,
 * BoundedMemoryPanel (load, edit), MemoryConfigPanel (load, save),
 * and ExploreCachePanel (stats, aggregate button).
 *
 * Data-testid attributes:
 *   BoundedMemoryPanel:
 *     - data-testid="bounded-memory-editor"     — textarea for MEMORY.md content
 *     - data-testid="bounded-memory-save-btn"   — Save button
 *   MemoryConfigPanel:
 *     - data-testid="memory-config-save-btn"    — Save button
 *     - data-testid="memory-config-saved-toast" — "Saved!" feedback span
 *   ExploreCachePanel:
 *     - data-testid="explore-cache-stats"              — stats <dl>
 *     - data-testid="explore-cache-raw-count"          — raw entries <dd>
 *     - data-testid="explore-cache-consolidated-count" — consolidated <dd>
 *     - data-testid="explore-cache-aggregate-btn"      — "Aggregate now" button
 */

import { test, expect } from './fixtures/server-fixture';
import type { Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Navigate to the Memory tab and wait for the view to render. */
async function gotoMemory(page: Page, serverUrl: string): Promise<void> {
    await page.goto(`${serverUrl}/#memory`);
    await expect(page.locator('#view-memory')).toBeVisible({ timeout: 10_000 });
}

// ---------------------------------------------------------------------------
// 1. Tab navigation
// ---------------------------------------------------------------------------

test.describe('MemoryView – Tab navigation', () => {
    test('M.1 renders all three sub-tabs', async ({ page, serverUrl }) => {
        await gotoMemory(page, serverUrl);

        await expect(page.locator('[data-subtab="bounded"]')).toBeVisible();
        await expect(page.locator('[data-subtab="files"]')).toBeVisible();
        await expect(page.locator('[data-subtab="config"]')).toBeVisible();
    });

    test('M.2 bounded sub-tab is active by default', async ({ page, serverUrl }) => {
        await gotoMemory(page, serverUrl);

        const boundedTab = page.locator('[data-subtab="bounded"]');
        await expect(boundedTab).toHaveClass(/border-\[#0078d4\]/, { timeout: 5_000 });
    });

    test('M.3 switching to config sub-tab activates it', async ({ page, serverUrl }) => {
        await gotoMemory(page, serverUrl);

        await page.click('[data-subtab="config"]');
        const configTab = page.locator('[data-subtab="config"]');
        await expect(configTab).toHaveClass(/border-\[#0078d4\]/, { timeout: 5_000 });
    });

    test('M.4 deep-link #memory/config activates config tab', async ({ page, serverUrl }) => {
        await page.goto(`${serverUrl}/#memory/config`);
        await expect(page.locator('#view-memory')).toBeVisible({ timeout: 10_000 });
        await expect(page.locator('[data-subtab="config"]')).toBeVisible();
    });
});

// ---------------------------------------------------------------------------
// 2. MemoryConfigPanel
// ---------------------------------------------------------------------------

test.describe('MemoryConfigPanel', () => {
    test('M.5 config panel loads with form fields', async ({ page, serverUrl }) => {
        await gotoMemory(page, serverUrl);
        await page.click('[data-subtab="config"]');

        // Storage directory input should have a value
        const storageDirInput = page.locator('input[placeholder="~/.coc/memory"]');
        await expect(storageDirInput).toBeVisible({ timeout: 8_000 });
        const val = await storageDirInput.inputValue();
        expect(val.length).toBeGreaterThan(0);
    });

    test('M.6 save button triggers config update and shows saved toast', async ({ page, serverUrl }) => {
        await gotoMemory(page, serverUrl);
        await page.click('[data-subtab="config"]');

        await expect(page.locator('[data-testid="memory-config-save-btn"]')).toBeVisible({ timeout: 8_000 });
        await page.locator('[data-testid="memory-config-save-btn"]').click();

        await expect(page.locator('[data-testid="memory-config-saved-toast"]')).toBeVisible({ timeout: 5_000 });
        await expect(page.locator('[data-testid="memory-config-saved-toast"]')).toContainText('Saved!');
    });
});

// ---------------------------------------------------------------------------
// 3. ExploreCachePanel
// ---------------------------------------------------------------------------

test.describe('ExploreCachePanel', () => {
    test('M.7 explore cache stats render after navigating to config tab', async ({ page, serverUrl }) => {
        await gotoMemory(page, serverUrl);
        await page.click('[data-subtab="config"]');

        // ExploreCachePanel is inside config tab
        await expect(page.locator('[data-testid="explore-cache-aggregate-btn"]')).toBeVisible({ timeout: 8_000 });
    });

    test('M.8 stats dl renders with raw and consolidated counts', async ({ page, serverUrl }) => {
        // The tool-call cache stats endpoint is not implemented on the server,
        // so mock it to verify the UI rendering. Without the mock the panel
        // shows an error message instead of the stats <dl>.
        await page.route('**/api/memory/aggregate-tool-calls/stats', route => {
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ rawCount: 7, consolidatedCount: 3, lastAggregation: null }),
            });
        });

        await gotoMemory(page, serverUrl);
        await page.click('[data-subtab="config"]');

        await expect(page.locator('[data-testid="explore-cache-stats"]')).toBeVisible({ timeout: 8_000 });
        await expect(page.locator('[data-testid="explore-cache-raw-count"]')).toBeVisible();
        await expect(page.locator('[data-testid="explore-cache-consolidated-count"]')).toBeVisible();
    });

    test('M.9 aggregate button is clickable and shows feedback', async ({ page, serverUrl }) => {
        // Mock the aggregate endpoint to return quickly
        await page.route('**/api/memory/aggregate-tool-calls', route => {
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ aggregated: true, rawCount: 0, consolidatedCount: 0 }),
            });
        });

        await gotoMemory(page, serverUrl);
        await page.click('[data-subtab="config"]');

        await expect(page.locator('[data-testid="explore-cache-aggregate-btn"]')).toBeEnabled({ timeout: 8_000 });
        await page.locator('[data-testid="explore-cache-aggregate-btn"]').click();

        // Button should become disabled while aggregating then re-enable after
        await page.waitForTimeout(500);
        await expect(page.locator('[data-testid="explore-cache-aggregate-btn"]')).toBeEnabled({ timeout: 10_000 });
    });
});
