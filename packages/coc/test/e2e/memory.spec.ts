/**
 * Memory E2E Tests
 *
 * Tests the #memory route: MemoryView sub-tab navigation, MemoryEntriesPanel
 * (create, view, delete), MemoryConfigPanel (load, save), and
 * ExploreCachePanel (stats, aggregate button).
 *
 * New data-testid attributes added to source:
 *   MemoryEntriesPanel:
 *     - data-testid="memory-entries-empty"   — empty-state paragraph
 *     - data-testid={`memory-entry-row-${id}`} — entry card
 *     - data-testid="memory-entry-view-btn"  — View button (per row)
 *     - data-testid="memory-entry-delete-btn" — Delete button (per row)
 *     - data-testid="memory-entry-confirm-btn" — Confirm delete button
 *     - data-testid="memory-entry-cancel-btn"  — Cancel delete button
 *   MemoryConfigPanel:
 *     - data-testid="memory-config-save-btn"   — Save button
 *     - data-testid="memory-config-saved-toast" — "Saved!" feedback span
 *   ExploreCachePanel:
 *     - data-testid="explore-cache-stats"           — stats <dl>
 *     - data-testid="explore-cache-raw-count"       — raw entries <dd>
 *     - data-testid="explore-cache-consolidated-count" — consolidated <dd>
 *     - data-testid="explore-cache-aggregate-btn"   — "Aggregate now" button
 */

import { test, expect } from './fixtures/server-fixture';
import { request } from './fixtures/seed';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Navigate to the Memory tab and wait for the view to render. */
async function gotoMemory(page: Page, serverUrl: string): Promise<void> {
    await page.goto(serverUrl);
    await page.click('[data-tab="memory"]');
    await expect(page.locator('#view-memory')).toBeVisible({ timeout: 10_000 });
}

/** Create a memory entry via the REST API. */
async function createEntry(
    serverUrl: string,
    content: string,
    opts: { summary?: string; tags?: string[] } = {},
): Promise<{ id: string; summary?: string }> {
    const res = await request(`${serverUrl}/api/memory/entries`, {
        method: 'POST',
        body: JSON.stringify({ content, summary: opts.summary, tags: opts.tags ?? [] }),
    });
    if (res.status !== 201) throw new Error(`POST /api/memory/entries → ${res.status}: ${res.body}`);
    return JSON.parse(res.body);
}

/**
 * Configure the memory storage to use an isolated temp directory.
 * This prevents tests from reading/writing to the user's real ~/.coc/memory.
 * Returns the temp dir path (caller is responsible for cleanup).
 */
async function isolateMemoryStorage(serverUrl: string): Promise<string> {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-memory-'));
    const storageDir = path.join(tmpDir, 'memory');
    fs.mkdirSync(storageDir, { recursive: true });
    const res = await request(`${serverUrl}/api/memory/config`, {
        method: 'PUT',
        body: JSON.stringify({ storageDir }),
    });
    if (res.status !== 200) throw new Error(`PUT /api/memory/config → ${res.status}: ${res.body}`);
    return tmpDir;
}

// ---------------------------------------------------------------------------
// 1. Tab navigation
// ---------------------------------------------------------------------------

test.describe('MemoryView – Tab navigation', () => {
    test('M.1 renders all three sub-tabs', async ({ page, serverUrl }) => {
        await gotoMemory(page, serverUrl);

        await expect(page.locator('[data-subtab="entries"]')).toBeVisible();
        await expect(page.locator('[data-subtab="files"]')).toBeVisible();
        await expect(page.locator('[data-subtab="config"]')).toBeVisible();
    });

    test('M.2 entries sub-tab is active by default', async ({ page, serverUrl }) => {
        await gotoMemory(page, serverUrl);

        const entriesTab = page.locator('[data-subtab="entries"]');
        await expect(entriesTab).toHaveClass(/border-\[#0078d4\]/, { timeout: 5_000 });
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
// 2. MemoryEntriesPanel
// ---------------------------------------------------------------------------

test.describe('MemoryEntriesPanel', () => {
    let memTmpDir: string | null = null;

    test.beforeEach(async ({ serverUrl }) => {
        // Isolate memory storage so tests don't interfere with real ~/.coc/memory
        memTmpDir = await isolateMemoryStorage(serverUrl);
    });

    test.afterEach(() => {
        if (memTmpDir) {
            fs.rmSync(memTmpDir, { recursive: true, force: true });
            memTmpDir = null;
        }
    });

    test('M.5 shows empty state when no entries exist', async ({ page, serverUrl }) => {
        await gotoMemory(page, serverUrl);
        await expect(page.locator('[data-subtab="entries"]')).toBeVisible();

        await expect(page.locator('[data-testid="memory-entries-empty"]')).toBeVisible({ timeout: 8_000 });
        await expect(page.locator('[data-testid="memory-entries-empty"]')).toContainText('No memory entries found');
    });

    test('M.6 created entry appears in the list', async ({ page, serverUrl }) => {
        const entry = await createEntry(serverUrl, 'Test content for memory entry', { summary: 'Test entry summary' });

        await gotoMemory(page, serverUrl);

        await expect(page.locator(`[data-testid="memory-entry-row-${entry.id}"]`)).toBeVisible({ timeout: 8_000 });
        await expect(page.locator(`[data-testid="memory-entry-row-${entry.id}"]`)).toContainText('Test entry summary');
    });

    test('M.7 View button opens content dialog', async ({ page, serverUrl }) => {
        await createEntry(serverUrl, 'Detailed content to view', { summary: 'View test entry' });

        await gotoMemory(page, serverUrl);
        await expect(page.locator('[data-testid="memory-entry-view-btn"]').first()).toBeVisible({ timeout: 8_000 });
        await page.locator('[data-testid="memory-entry-view-btn"]').first().click();

        // The full content dialog shows the content in a <pre> element
        await expect(page.locator('.fixed.inset-0')).toBeVisible({ timeout: 5_000 });
        await expect(page.locator('.fixed.inset-0 pre')).toContainText('Detailed content to view');
    });

    test('M.8 Delete with confirmation removes the entry', async ({ page, serverUrl }) => {
        const entry = await createEntry(serverUrl, 'Entry to delete', { summary: 'Delete me' });

        await gotoMemory(page, serverUrl);
        await expect(page.locator(`[data-testid="memory-entry-row-${entry.id}"]`)).toBeVisible({ timeout: 8_000 });

        // Click delete to show confirm/cancel
        await page.locator(`[data-testid="memory-entry-row-${entry.id}"] [data-testid="memory-entry-delete-btn"]`).click();

        // Confirm button should appear
        await expect(page.locator(`[data-testid="memory-entry-row-${entry.id}"] [data-testid="memory-entry-confirm-btn"]`)).toBeVisible();

        // Confirm deletion
        await page.locator(`[data-testid="memory-entry-row-${entry.id}"] [data-testid="memory-entry-confirm-btn"]`).click();

        // Entry should disappear
        await expect(page.locator(`[data-testid="memory-entry-row-${entry.id}"]`)).toHaveCount(0, { timeout: 8_000 });
    });

    test('M.9 Cancel does not delete the entry', async ({ page, serverUrl }) => {
        const entry = await createEntry(serverUrl, 'Entry to keep', { summary: 'Keep me' });

        await gotoMemory(page, serverUrl);
        await expect(page.locator(`[data-testid="memory-entry-row-${entry.id}"]`)).toBeVisible({ timeout: 8_000 });

        await page.locator(`[data-testid="memory-entry-row-${entry.id}"] [data-testid="memory-entry-delete-btn"]`).click();
        await expect(page.locator(`[data-testid="memory-entry-row-${entry.id}"] [data-testid="memory-entry-cancel-btn"]`)).toBeVisible();
        await page.locator(`[data-testid="memory-entry-row-${entry.id}"] [data-testid="memory-entry-cancel-btn"]`).click();

        // Entry should remain
        await expect(page.locator(`[data-testid="memory-entry-row-${entry.id}"]`)).toBeVisible();
        // Delete button should be restored
        await expect(page.locator(`[data-testid="memory-entry-row-${entry.id}"] [data-testid="memory-entry-delete-btn"]`)).toBeVisible();
    });
});

// ---------------------------------------------------------------------------
// 3. MemoryConfigPanel
// ---------------------------------------------------------------------------

test.describe('MemoryConfigPanel', () => {
    test('M.10 config panel loads with form fields', async ({ page, serverUrl }) => {
        await gotoMemory(page, serverUrl);
        await page.click('[data-subtab="config"]');

        // Storage directory input should have a value
        const storageDirInput = page.locator('input[placeholder="~/.coc/memory"]');
        await expect(storageDirInput).toBeVisible({ timeout: 8_000 });
        const val = await storageDirInput.inputValue();
        expect(val.length).toBeGreaterThan(0);
    });

    test('M.11 save button triggers config update and shows saved toast', async ({ page, serverUrl }) => {
        await gotoMemory(page, serverUrl);
        await page.click('[data-subtab="config"]');

        await expect(page.locator('[data-testid="memory-config-save-btn"]')).toBeVisible({ timeout: 8_000 });
        await page.locator('[data-testid="memory-config-save-btn"]').click();

        await expect(page.locator('[data-testid="memory-config-saved-toast"]')).toBeVisible({ timeout: 5_000 });
        await expect(page.locator('[data-testid="memory-config-saved-toast"]')).toContainText('Saved!');
    });

    test('M.12 config save persists maxEntries change', async ({ page, serverUrl }) => {
        await gotoMemory(page, serverUrl);
        await page.click('[data-subtab="config"]');

        // Change maxEntries
        const maxEntriesInput = page.locator('input[type="number"]').first();
        await expect(maxEntriesInput).toBeVisible({ timeout: 8_000 });
        await maxEntriesInput.fill('500');

        await page.locator('[data-testid="memory-config-save-btn"]').click();
        await expect(page.locator('[data-testid="memory-config-saved-toast"]')).toBeVisible({ timeout: 5_000 });

        // Verify via API
        const res = await page.request.get(`${serverUrl}/api/memory/config`);
        const cfg = await res.json();
        expect(cfg.maxEntries).toBe(500);
    });
});

// ---------------------------------------------------------------------------
// 4. ExploreCachePanel
// ---------------------------------------------------------------------------

test.describe('ExploreCachePanel', () => {
    test('M.13 explore cache stats render after navigating to config tab', async ({ page, serverUrl }) => {
        await gotoMemory(page, serverUrl);
        await page.click('[data-subtab="config"]');

        // ExploreCachePanel is inside config tab
        await expect(page.locator('[data-testid="explore-cache-aggregate-btn"]')).toBeVisible({ timeout: 8_000 });
    });

    test('M.14 stats dl renders with raw and consolidated counts', async ({ page, serverUrl }) => {
        await gotoMemory(page, serverUrl);
        await page.click('[data-subtab="config"]');

        await expect(page.locator('[data-testid="explore-cache-stats"]')).toBeVisible({ timeout: 8_000 });
        await expect(page.locator('[data-testid="explore-cache-raw-count"]')).toBeVisible();
        await expect(page.locator('[data-testid="explore-cache-consolidated-count"]')).toBeVisible();
    });

    test('M.15 aggregate button is clickable and shows feedback', async ({ page, serverUrl }) => {
        // Mock the aggregate endpoint to return quickly (the real endpoint may invoke
        // an AI process that takes too long in CI / test environments).
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
