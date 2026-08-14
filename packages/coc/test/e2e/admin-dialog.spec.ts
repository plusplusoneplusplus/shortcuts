/**
 * Admin overlay dialog — E2E (admin-settings-dialog)
 *
 * Admin is a centered overlay dialog, not a page: the gear opens `AdminPanel`
 * on top of whatever the user was looking at, and the hash stays the source of
 * truth so deep links and back/forward keep working.
 *
 * This spec covers the acceptance criteria that can only be checked in a real
 * browser — the jsdom suites (`AdminDialogRoute`, `AdminPanel-responsive`,
 * `AdminPanel-tools-sidebar`) already lock the wiring and the CSS source, but
 * they cannot see layout:
 *
 *   AC-01  gear (both variants) opens the dialog; the page behind stays mounted;
 *          Escape / × / backdrop close it and restore the view
 *   AC-02  `#admin/database/processes?page=2` cold deep link opens the dialog;
 *          in-dialog navigation updates the hash and keeps the dialog open;
 *          Back stays inside the dialog; closing a cold deep link lands on `#repos`
 *   AC-03  exactly one status dock is painted while the dialog is open
 *   AC-04  no horizontal overflow and no double scrollbar on any settings
 *          sub-tab or the Database Browser, at desktop and phone widths
 */

import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/server-fixture';

const ADMIN_VIEWPORTS = {
    desktop: { width: 1440, height: 900 },
    phone: { width: 390, height: 844 },
} as const;

const SETTINGS_SUBTABS = [
    'ai',
    'chat',
    'appearance',
    'features',
    'integrations',
    'providers',
    'advanced',
] as const;

const dialog = (page: Page) => page.locator('#admin-dialog');
const adminShell = (page: Page) => page.locator('#view-admin');
const mainPane = (page: Page) => page.locator('#admin-dialog .ar-main');

/**
 * Force the remote-first shell on. The E2E server config pins
 * `features.remoteShell` off, and the docked status cluster (which owns the
 * sidebar gear) only exists in that shell.
 */
async function enableRemoteShell(page: Page): Promise<void> {
    await page.route('**/api/config/runtime', async (route) => {
        try {
            const resp = await route.fetch();
            const json = await resp.json();
            const features = { ...(json.features ?? {}), remoteShellEnabled: true };
            await route.fulfill({
                status: resp.status(),
                headers: { ...resp.headers(), 'content-type': 'application/json' },
                body: JSON.stringify({ ...json, features }),
            });
        } catch {
            await route.continue().catch(() => {});
        }
    });
}

/** Land on the default (non-admin) route and wait for it to render. */
async function gotoDashboard(page: Page, serverUrl: string): Promise<void> {
    await page.goto(serverUrl);
    await expect(page.locator('#view-repos')).toBeVisible({ timeout: 10_000 });
}

/** Wait for the dialog and its admin content to be on screen. */
async function expectDialogOpen(page: Page): Promise<void> {
    await expect(dialog(page)).toBeVisible({ timeout: 10_000 });
    await expect(adminShell(page)).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#admin-page-content')).not.toBeEmpty({ timeout: 10_000 });
}

/**
 * Navigate to an admin section from inside the dialog.
 *
 * Below the shell's 600px container breakpoint the sidebar collapses into
 * `.ar-mobile-tab-select`, so the nav buttons are present but hidden — at phone
 * width the same section has to be reached through the select.
 */
async function gotoAdminSection(page: Page, key: string, testId: string): Promise<void> {
    const navItem = page.locator(`#admin-dialog [data-testid="${testId}"]`);
    if (await navItem.isVisible()) {
        await navItem.click();
        return;
    }
    await page.locator('#admin-dialog .ar-mobile-tab-select').selectOption(key);
}

/** scrollWidth/clientWidth of an element, for overflow assertions. */
async function widths(locator: ReturnType<Page['locator']>): Promise<{ scroll: number; client: number }> {
    return locator.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
}

// ---------------------------------------------------------------------------
// AC-01 — the gear opens a dialog over the current view
// ---------------------------------------------------------------------------

test.describe('AC-01 — gear opens the admin dialog over the current page', () => {
    test.use({ viewport: ADMIN_VIEWPORTS.desktop });

    test('topbar gear opens the dialog and leaves the page behind mounted', async ({ page, serverUrl }) => {
        await gotoDashboard(page, serverUrl);

        await page.click('#admin-toggle');
        await expectDialogOpen(page);

        // The page the user was on is still mounted underneath, not replaced.
        await expect(page.locator('#view-repos')).toHaveCount(1);
    });

    test('Escape closes the dialog and restores the previous route', async ({ page, serverUrl }) => {
        await gotoDashboard(page, serverUrl);

        await page.click('#admin-toggle');
        await expectDialogOpen(page);

        await page.keyboard.press('Escape');
        await expect(dialog(page)).toHaveCount(0);
        await expect(page.locator('#view-repos')).toBeVisible();
        await expect.poll(() => page.evaluate(() => location.hash)).not.toContain('admin');
    });

    test('the × button closes the dialog', async ({ page, serverUrl }) => {
        await gotoDashboard(page, serverUrl);

        await page.click('#admin-toggle');
        await expectDialogOpen(page);

        await page.click('#admin-dialog [data-testid="dialog-close-btn"]');
        await expect(dialog(page)).toHaveCount(0);
        await expect(page.locator('#view-repos')).toBeVisible();
    });

    test('the sidebar gear opens the same dialog', async ({ page, serverUrl }) => {
        await enableRemoteShell(page);
        await gotoDashboard(page, serverUrl);

        const sidebarGear = page.locator('[data-testid="sidebar-admin-toggle"]').first();
        await expect(sidebarGear).toBeVisible({ timeout: 10_000 });
        await sidebarGear.click();

        await expectDialogOpen(page);
        await expect(page.locator('#view-repos')).toHaveCount(1);
    });
});

// ---------------------------------------------------------------------------
// AC-02 — hash stays the source of truth
// ---------------------------------------------------------------------------

test.describe('AC-02 — deep links and in-dialog navigation', () => {
    test.use({ viewport: ADMIN_VIEWPORTS.desktop });

    test('a cold #admin/database deep link opens the dialog on the Database Browser', async ({ page, serverUrl }) => {
        await page.goto(`${serverUrl}/#admin/database/processes?page=2`);
        await expectDialogOpen(page);

        // Database Browser is the active sidebar item, and the page behind rendered.
        await expect(page.locator('[data-testid="admin-tab-database"]')).toHaveClass(/is-active/);
        await expect(page.locator('#view-repos')).toHaveCount(1);
    });

    test('closing a cold deep link lands on the default route, not a blank screen', async ({ page, serverUrl }) => {
        await page.goto(`${serverUrl}/#admin/database/processes?page=2`);
        await expectDialogOpen(page);

        await page.keyboard.press('Escape');
        await expect(dialog(page)).toHaveCount(0);
        await expect(page.locator('#view-repos')).toBeVisible();
        await expect.poll(() => page.evaluate(() => location.hash)).toBe('#repos');
    });

    test('in-dialog settings navigation updates the hash and Back stays in the dialog', async ({ page, serverUrl }) => {
        await gotoDashboard(page, serverUrl);
        await page.click('#admin-toggle');
        await expectDialogOpen(page);

        await page.click('[data-testid="settings-subtab-appearance"]');
        await expect.poll(() => page.evaluate(() => location.hash)).toBe('#admin/settings/appearance');
        await expect(dialog(page)).toBeVisible();

        await page.click('[data-testid="settings-subtab-features"]');
        await expect.poll(() => page.evaluate(() => location.hash)).toBe('#admin/settings/features');

        await page.goBack();
        await expect.poll(() => page.evaluate(() => location.hash)).toBe('#admin/settings/appearance');
        // Back moved between sections without kicking the user out to a full page.
        await expect(dialog(page)).toBeVisible();
    });
});

// ---------------------------------------------------------------------------
// AC-03 — exactly one status dock while the dialog is open
// ---------------------------------------------------------------------------

test.describe('AC-03 — status dock', () => {
    test.use({ viewport: ADMIN_VIEWPORTS.desktop });

    test('exactly one status dock is painted while the dialog is open', async ({ page, serverUrl }) => {
        await enableRemoteShell(page);
        await gotoDashboard(page, serverUrl);
        await expect(page.locator('[data-testid="global-status-dock"]')).toHaveCount(1);

        // The remote shell moves the cluster into the dock, so the topbar gear
        // is hidden and the dock's own gear is the way in.
        await page.locator('[data-testid="sidebar-admin-toggle"]').first().click();
        await expectDialogOpen(page);

        // The dock belongs to the page behind; admin must not add a second one.
        await expect(page.locator('[data-testid="global-status-dock"]')).toHaveCount(1);
        await expect(page.locator('#admin-dialog [data-testid="global-status-dock"]')).toHaveCount(0);

        await page.keyboard.press('Escape');
        await expect(dialog(page)).toHaveCount(0);
        await expect(page.locator('[data-testid="global-status-dock"]')).toHaveCount(1);
    });
});

// ---------------------------------------------------------------------------
// AC-04 — the dialog fits without breaking AdminPanel's layout
// ---------------------------------------------------------------------------

for (const [name, viewport] of Object.entries(ADMIN_VIEWPORTS)) {
    test.describe(`AC-04 — layout at ${name} (${viewport.width}×${viewport.height})`, () => {
        test.use({ viewport });

        test('every settings sub-tab renders without horizontal overflow', async ({ page, serverUrl }) => {
            await gotoDashboard(page, serverUrl);
            await page.click('#admin-toggle');
            await expectDialogOpen(page);

            for (const sub of SETTINGS_SUBTABS) {
                await gotoAdminSection(page, `settings:${sub}`, `settings-subtab-${sub}`);
                // `ai` is the default sub-tab, so it routes to the bare `#admin/settings`.
                await expect
                    .poll(() => page.evaluate(() => location.hash))
                    .toMatch(sub === 'ai' ? /^#admin\/settings(\/ai)?$/ : new RegExp(`^#admin/settings/${sub}$`));
                await expect(page.locator('[data-testid="settings-cards"]')).toBeVisible();

                // The main pane is the only scroll region, and it scrolls
                // vertically only — wide tables own their own x-scrollers.
                const pane = await widths(mainPane(page));
                expect(
                    pane.scroll,
                    `settings/${sub} overflows .ar-main horizontally at ${name}`,
                ).toBeLessThanOrEqual(pane.client + 1);
            }
        });

        test('the dialog never makes the page behind scroll', async ({ page, serverUrl }) => {
            await gotoDashboard(page, serverUrl);
            await page.click('#admin-toggle');
            await expectDialogOpen(page);

            const doc = await page.evaluate(() => ({
                scrollH: document.documentElement.scrollHeight,
                clientH: document.documentElement.clientHeight,
                scrollW: document.documentElement.scrollWidth,
                clientW: document.documentElement.clientWidth,
            }));
            expect(doc.scrollH, 'document scrolls vertically behind the dialog').toBeLessThanOrEqual(doc.clientH + 1);
            expect(doc.scrollW, 'document scrolls horizontally behind the dialog').toBeLessThanOrEqual(doc.clientW + 1);

            // The admin shell itself clips; `.ar-main` is the sole scroller.
            const shellOverflow = await adminShell(page).evaluate((el) => getComputedStyle(el).overflow);
            expect(shellOverflow).toContain('hidden');
            const mainOverflowY = await mainPane(page).evaluate((el) => getComputedStyle(el).overflowY);
            expect(mainOverflowY).toBe('auto');
        });

        test('the Database Browser is usable inside the dialog', async ({ page, serverUrl }) => {
            await page.goto(`${serverUrl}/#admin/database`);
            await expectDialogOpen(page);
            await expect(page.locator('[data-testid="admin-tab-database"]')).toHaveClass(/is-active/);

            const pane = await widths(mainPane(page));
            expect(
                pane.scroll,
                `Database Browser overflows .ar-main horizontally at ${name}`,
            ).toBeLessThanOrEqual(pane.client + 1);

            // The dialog panel stays within the viewport.
            const box = await dialog(page).boundingBox();
            expect(box).not.toBeNull();
            expect(box!.width).toBeLessThanOrEqual(viewport.width + 1);
            expect(box!.height).toBeLessThanOrEqual(viewport.height + 1);
        });
    });
}
