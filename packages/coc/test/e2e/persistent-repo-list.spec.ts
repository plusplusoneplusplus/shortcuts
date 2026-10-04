/**
 * Persistent Workspace Picker on All Pages — E2E Tests (persistent-repo-list)
 *
 * The persistent mini sidebar was removed in favor of the classic
 * `RepoTabStrip`, which was in turn graduated away by the remote-first
 * desktop shell. Workspace switching is now handled exclusively by the
 * `remote-chip` / `remote-dropdown` picker in the TopBar's `RemoteShellHeader`
 * — rendered unconditionally on desktop (`!isMobile`) regardless of which
 * top-level tab (Repos, Admin, Memory, ...) is active, so it still functions
 * as the single persistent workspace-switching surface this suite verifies.
 *
 * Verifies:
 *   - mini-sidebar-layout / persistent-mini-sidebar are absent on all tabs
 *   - the remote-chip picker in TopBar is always visible (on all tabs)
 *
 * Relies on data-testid attributes:
 *   data-testid="mini-sidebar-layout"        — wrapper div (should be absent)
 *   data-testid="persistent-mini-sidebar"    — aside element (should be absent)
 *   data-testid="remote-chip"                — RemoteShellHeader's workspace picker in TopBar
 */

import { test, expect } from './fixtures/server-fixture';

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
// 2. remote-chip workspace picker visible on all tabs
// ---------------------------------------------------------------------------

test.describe('PRL.2 — remote-chip workspace picker always visible in TopBar (desktop)', () => {
    test('PRL.2.1 remote-chip is visible on repos tab', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        await expect(page.locator('#view-repos')).toBeVisible({ timeout: 10_000 });

        await expect(page.locator('[data-testid="remote-chip"]').first()).toBeVisible({ timeout: 5_000 });
    });

    test('PRL.2.2 remote-chip is visible on skills tab', async ({ page, serverUrl }) => {
        // Standalone Processes tab was removed; verify the picker stays
        // mounted on another non-Repos top-level view (Skills, opened via the
        // Admin Tools sidebar).
        await page.goto(serverUrl);
        await page.click('#admin-toggle');
        await expect(page.locator('#view-admin')).toBeVisible({ timeout: 10_000 });
        await page.click('#skills-toggle');
        await expect(page.locator('#view-skills')).toBeVisible({ timeout: 10_000 });

        await expect(page.locator('[data-testid="remote-chip"]').first()).toBeVisible({ timeout: 5_000 });
    });

    test('PRL.2.3 remote-chip is visible on admin tab', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        await page.click('[data-tab="admin"]');
        await expect(page.locator('[data-testid="admin-scroll-container"]')).toBeVisible({ timeout: 10_000 });

        await expect(page.locator('[data-testid="remote-chip"]').first()).toBeVisible({ timeout: 5_000 });
    });

    test('PRL.2.4 remote-chip is visible on memory tab', async ({ page, serverUrl }) => {
        await page.goto(`${serverUrl}/#memory`);
        await page.waitForTimeout(500);

        await expect(page.locator('[data-testid="remote-chip"]').first()).toBeVisible({ timeout: 8_000 });
    });
});
