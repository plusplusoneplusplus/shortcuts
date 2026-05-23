/**
 * Persistent Repo List on All Pages — E2E Tests (persistent-repo-list)
 *
 * The persistent mini sidebar has been removed; repo switching is handled
 * exclusively by the RepoTabStrip in the TopBar.
 *
 * Verifies:
 *   - mini-sidebar-layout / persistent-mini-sidebar are absent on all tabs
 *   - RepoTabStrip in TopBar is always visible (on all tabs)
 *
 * Relies on data-testid attributes:
 *   data-testid="mini-sidebar-layout"        — wrapper div (should be absent)
 *   data-testid="persistent-mini-sidebar"    — aside element (should be absent)
 *   data-testid="repo-tab-strip"             — RepoTabStrip in TopBar
 */

import { test, expect } from './fixtures/server-fixture';
import { seedWorkspace } from './fixtures/seed';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function navigateTo(page: import('@playwright/test').Page, serverUrl: string, tab: string): Promise<void> {
    await page.goto(`${serverUrl}/#${tab}`);
    await page.waitForTimeout(300);
}

// ---------------------------------------------------------------------------
// 1. Mini sidebar is absent on all tabs
// ---------------------------------------------------------------------------

test.describe('PRL.1 — No persistent mini sidebar on any tab', () => {
    test('PRL.1.1 mini-sidebar-layout is not present on repos tab', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        await expect(page.locator('#view-repos')).toBeVisible({ timeout: 10_000 });

        await expect(page.locator('[data-testid="mini-sidebar-layout"]')).toHaveCount(0);
    });

    test('PRL.1.2 persistent-mini-sidebar is not present on repos tab', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        await expect(page.locator('#view-repos')).toBeVisible({ timeout: 10_000 });

        await expect(page.locator('[data-testid="persistent-mini-sidebar"]')).toHaveCount(0);
    });

    test('PRL.1.3 mini-sidebar-layout is not present on skills tab', async ({ page, serverUrl }) => {
        // The standalone Processes tab was removed; use Skills (reached via the
        // Admin Tools sidebar) as a non-Repos top-level view to verify the
        // persistent mini-sidebar stays absent.
        await page.goto(serverUrl);
        await page.click('#admin-toggle');
        await expect(page.locator('#view-admin')).toBeVisible({ timeout: 10_000 });
        await page.click('#skills-toggle');
        await expect(page.locator('#view-skills')).toBeVisible({ timeout: 10_000 });

        await expect(page.locator('[data-testid="mini-sidebar-layout"]')).toHaveCount(0);
        await expect(page.locator('[data-testid="persistent-mini-sidebar"]')).toHaveCount(0);
    });

    test('PRL.1.4 mini-sidebar-layout is not present on admin tab', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        await page.click('[data-tab="admin"]');
        await expect(page.locator('[data-testid="admin-scroll-container"]')).toBeVisible({ timeout: 10_000 });

        await expect(page.locator('[data-testid="mini-sidebar-layout"]')).toHaveCount(0);
        await expect(page.locator('[data-testid="persistent-mini-sidebar"]')).toHaveCount(0);
    });
});

// ---------------------------------------------------------------------------
// 2. RepoTabStrip visible on all tabs
// ---------------------------------------------------------------------------

test.describe('PRL.2 — RepoTabStrip always visible in TopBar (desktop)', () => {
    test('PRL.2.1 repo-tab-strip is visible on repos tab', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        await expect(page.locator('#view-repos')).toBeVisible({ timeout: 10_000 });

        await expect(page.locator('[data-testid="repo-tab-strip"]')).toBeVisible({ timeout: 5_000 });
    });

    test('PRL.2.2 repo-tab-strip is visible on skills tab', async ({ page, serverUrl }) => {
        // Standalone Processes tab was removed; verify rail stays mounted on
        // another non-Repos top-level view (Skills, opened via the Admin
        // Tools sidebar).
        await page.goto(serverUrl);
        await page.click('#admin-toggle');
        await expect(page.locator('#view-admin')).toBeVisible({ timeout: 10_000 });
        await page.click('#skills-toggle');
        await expect(page.locator('#view-skills')).toBeVisible({ timeout: 10_000 });

        await expect(page.locator('[data-testid="repo-tab-strip"]')).toBeVisible({ timeout: 5_000 });
    });

    test('PRL.2.3 repo-tab-strip is visible on admin tab', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        await page.click('[data-tab="admin"]');
        await expect(page.locator('[data-testid="admin-scroll-container"]')).toBeVisible({ timeout: 10_000 });

        await expect(page.locator('[data-testid="repo-tab-strip"]')).toBeVisible({ timeout: 5_000 });
    });

    test('PRL.2.4 repo-tab-strip is visible on memory tab', async ({ page, serverUrl }) => {
        await page.goto(`${serverUrl}/#memory`);
        await page.waitForTimeout(500);

        await expect(page.locator('[data-testid="repo-tab-strip"]')).toBeVisible({ timeout: 8_000 });
    });
});
