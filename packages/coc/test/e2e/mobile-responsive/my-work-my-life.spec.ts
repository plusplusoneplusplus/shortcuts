/**
 * My Work / My Life mobile responsiveness (AC-03).
 *
 * At a 375px viewport, no sub-tab of either virtual workspace may overflow
 * horizontally, and the mobile header must stay a single row with its actions
 * behind the `···` more sheet.
 *
 * Both virtual workspaces wear the shared `MobileTabBar` skin on mobile
 * (`VirtualWorkspaceMobileTabBar`): a back-to-scope-list slot, three pinned
 * tabs, and a `···` button whose sheet holds the remaining tabs plus the
 * header actions. The in-body `VirtualWorkspaceInlineHeader` this file used to
 * assert against is desktop/classic-shell only now, so every locator here goes
 * through the mobile chrome.
 *
 * The document-level `scrollWidth <= clientWidth` check the AC names is
 * necessary but not sufficient: the SPA shell is a fixed-height flex column
 * whose `#view-repos` main pane is `overflow-hidden`, so a 900px-wide child
 * never moves `documentElement.scrollWidth` — it is silently clipped instead.
 * Each sweep therefore also asserts that (a) nothing bleeds past the viewport's
 * right edge and (b) no text is cut off horizontally.
 *
 * The virtual workspaces are default-off, so each test enables them through the
 * live admin config API before loading the page. `features.schedulesInScheduledSlide`
 * is pinned off so the standalone Schedules sub-tab renders and gets covered too.
 */
import { test, expect, type Page } from '../fixtures/server-fixture';
import { request } from '../fixtures/seed';
import { MOBILE } from './viewports';

test.use({ viewport: MOBILE, hasTouch: true });

/** Sub-tabs of each virtual workspace, in header order. */
const MY_WORK_TABS = ['today', 'notes', 'activity', 'git', 'schedules', 'settings'];
const MY_LIFE_TABS = ['notes', 'activity', 'git', 'schedules', 'settings'];

/** Turn on both virtual workspaces, the Today tab, and the standalone Schedules tab. */
async function enableVirtualWorkspaces(serverUrl: string): Promise<void> {
    const res = await request(`${serverUrl}/api/admin/config`, {
        method: 'PUT',
        body: JSON.stringify({
            'myWork.enabled': true,
            'myLife.enabled': true,
            'myWork.todayView': true,
            'features.schedulesInScheduledSlide': false,
        }),
    });
    if (res.status !== 200) {
        throw new Error(`Failed to enable virtual workspaces: ${res.status} ${res.body}`);
    }
}

/**
 * Elements that overflow the viewport horizontally, as printable descriptions.
 *
 * Two independent faults, both scoped to `rootSelector` (the repos view by
 * default; the `···` sheet portals to `document.body`, outside it, so callers
 * that open the sheet pass its root explicitly):
 *  - `bleeds`: a visible box whose right edge sits past the viewport, with no
 *    horizontally scrollable ancestor to justify it.
 *  - `clipped`: a text leaf whose content is wider than its box and is neither
 *    scrollable nor ellipsis-truncated — i.e. a label cut in half.
 * Containers are excluded from `clipped` on purpose: a child with a negative
 * margin (the selection-ring bleed on My Work task rows) widens its parent's
 * scrollWidth without cutting off any text.
 */
async function findHorizontalOverflow(
    page: Page,
    rootSelector = '#view-repos',
): Promise<{ bleeds: string[]; clipped: string[] }> {
    return page.evaluate((selector) => {
        const viewportWidth = document.documentElement.clientWidth;
        const bleeds: string[] = [];
        const clipped: string[] = [];
        const root = document.querySelector(selector);
        if (!root) return { bleeds: [`${selector} is missing`], clipped: [] };

        const describe = (el: Element) => {
            const testId = (el as HTMLElement).dataset.testid;
            const cls = typeof el.className === 'string' ? el.className : '';
            return `${el.tagName}${testId ? `[${testId}]` : ''} ${cls.slice(0, 80)}`.trim();
        };
        const scrollsHorizontally = (el: Element) => {
            const overflowX = getComputedStyle(el).overflowX;
            return overflowX === 'auto' || overflowX === 'scroll';
        };
        const insideHorizontalScroller = (el: Element) => {
            for (let p = el.parentElement; p; p = p.parentElement) {
                if (scrollsHorizontally(p)) return true;
            }
            return false;
        };

        root.querySelectorAll('*').forEach(el => {
            const style = getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') return;
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return;

            if (rect.right > viewportWidth + 1 && !insideHorizontalScroller(el)) {
                bleeds.push(`${describe(el)} right=${Math.round(rect.right)} > ${viewportWidth}`);
            }

            const isTextLeaf = el.childElementCount === 0 && (el.textContent ?? '').trim().length > 0;
            if (
                isTextLeaf
                && !scrollsHorizontally(el)
                && style.textOverflow !== 'ellipsis'
                && el.clientWidth > 0
                && el.scrollWidth > el.clientWidth + 1
            ) {
                clipped.push(`${describe(el)} content=${el.scrollWidth} box=${el.clientWidth}`);
            }
        });
        return { bleeds, clipped };
    }, rootSelector);
}

/** Assert the viewport shows every sub-tab without horizontal overflow. */
async function expectNoHorizontalOverflow(page: Page, label: string, rootSelector?: string): Promise<void> {
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth, `${label}: document scrolls horizontally (${scrollWidth} > ${clientWidth})`)
        .toBeLessThanOrEqual(clientWidth);

    const { bleeds, clipped } = await findHorizontalOverflow(page, rootSelector);
    expect(bleeds, `${label}: content past the right edge of the viewport`).toEqual([]);
    expect(clipped, `${label}: text cut off horizontally`).toEqual([]);
}

/** The workspace's mobile tab bar, scoped to its header so a tab bar rendered
 *  by a keep-alive'd inner pane can never be picked up instead. */
function mobileTabBar(page: Page, prefix: 'my-work' | 'my-life') {
    return page.locator(`[data-testid="${prefix}-mobile-header"] [data-testid="mobile-tab-bar"]`);
}

/** Open a virtual workspace and wait for its view + mobile header to render. */
async function openWorkspace(page: Page, serverUrl: string, prefix: 'my-work' | 'my-life'): Promise<void> {
    const workspaceId = prefix === 'my-work' ? 'my_work' : 'my_life';
    await enableVirtualWorkspaces(serverUrl);
    await page.goto(`${serverUrl}/#repos/${workspaceId}/notes`);
    await expect(page.locator(`[data-testid="${prefix}-view"]`)).toBeVisible({ timeout: 15000 });
    await expect(page.locator(`[data-testid="${prefix}-mobile-header"]`)).toBeVisible({ timeout: 15000 });
    await expect(mobileTabBar(page, prefix)).toBeVisible({ timeout: 15000 });
}

/**
 * Switch to `tab` through the mobile chrome: pinned tabs are buttons on the
 * bar, the rest live in the `···` sheet.
 *
 * All panes stay mounted under keep-alive, so "the button exists" proves
 * nothing. The router drives the visible pane off the hash, so asserting the
 * hash carries the tab is what confirms the pane actually switched — plus
 * `aria-current` on the bar for a pinned tab, which is the only tab state the
 * bar renders.
 */
async function switchToSubTab(page: Page, prefix: 'my-work' | 'my-life', tab: string): Promise<void> {
    const bar = mobileTabBar(page, prefix);
    const pinned = bar.locator(`button[data-tab="${tab}"]`);

    if (await pinned.count() > 0) {
        await pinned.click();
        await expect(pinned, `${prefix}: ${tab} did not become the active tab`).toHaveAttribute('aria-current', 'page');
    } else {
        const moreBtn = bar.locator('button[data-tab="more"]');
        await expect(moreBtn, `${prefix}: ${tab} is neither pinned nor behind \`···\``).toHaveCount(1);
        await moreBtn.click();
        const item = page.locator(`[data-testid="mobile-tab-more-item-${tab}"]`);
        await expect(item, `${prefix}: ${tab} sub-tab is missing from the \`···\` sheet`).toBeVisible();
        await item.click();
        // Picking a tab closes the sheet; wait it out so the overflow sweep
        // below measures the pane and not the dismissing overlay.
        await expect(page.locator('[data-testid="mobile-tab-more-sheet"]')).toHaveCount(0);
    }

    await expect
        .poll(() => new URL(page.url()).hash, { message: `${prefix}: hash did not move to ${tab}` })
        .toContain(`/${tab}`);
}

/** Walk every sub-tab of a virtual workspace, asserting no horizontal overflow on each. */
async function sweepSubTabs(page: Page, prefix: 'my-work' | 'my-life', tabs: string[]): Promise<void> {
    for (const tab of tabs) {
        await switchToSubTab(page, prefix, tab);
        await page.waitForTimeout(300);
        await expectNoHorizontalOverflow(page, `${prefix} / ${tab}`);
    }
}

test.describe('My Work / My Life mobile responsive', () => {
    test('mobile: no horizontal overflow on any My Work sub-tab', async ({ page, serverUrl }) => {
        await openWorkspace(page, serverUrl, 'my-work');
        await sweepSubTabs(page, 'my-work', MY_WORK_TABS);
    });

    test('mobile: no horizontal overflow on any My Life sub-tab', async ({ page, serverUrl }) => {
        await openWorkspace(page, serverUrl, 'my-life');
        await sweepSubTabs(page, 'my-life', MY_LIFE_TABS);
    });

    test('mobile: the overflow detector catches content wider than the viewport', async ({ page, serverUrl }) => {
        // Guards the sweeps above: without this, a detector that silently
        // matched nothing would keep passing forever.
        await openWorkspace(page, serverUrl, 'my-work');
        await expectNoHorizontalOverflow(page, 'my-work / notes (baseline)');

        await page.evaluate(() => {
            const wide = document.createElement('div');
            wide.style.width = '900px';
            wide.style.height = '20px';
            wide.textContent = 'deliberately too wide';
            wide.dataset.testid = 'overflow-canary';
            document.querySelector('[data-testid="my-work-view"]')!.appendChild(wide);
        });

        const { bleeds } = await findHorizontalOverflow(page);
        expect(bleeds.join('\n')).toContain('overflow-canary');
    });

    test('mobile: the tab bar stays one row inside the viewport', async ({ page, serverUrl }) => {
        await openWorkspace(page, serverUrl, 'my-work');

        const headerBox = await page.locator('[data-testid="my-work-mobile-header"]').boundingBox();
        expect(headerBox).toBeTruthy();
        expect(headerBox!.width).toBeLessThanOrEqual(MOBILE.width);

        const bar = mobileTabBar(page, 'my-work');
        const barBox = await bar.boundingBox();
        expect(barBox).toBeTruthy();
        expect(barBox!.width).toBeLessThanOrEqual(MOBILE.width);
        // A single row: the bar is no taller than one row of tab buttons. Two
        // rows would be ~80px, so this catches the tabs wrapping.
        expect(barBox!.height).toBeLessThan(56);

        // The bar fits by pinning three tabs and folding the rest away, so it
        // never needs to scroll. Back slot + Today/Notes/Activity + `···`.
        await expect(page.locator('[data-testid="my-work-name-back"]')).toBeVisible();
        await expect(bar.locator('button[data-tab="today"]')).toBeVisible();
        await expect(bar.locator('button[data-tab="notes"]')).toBeVisible();
        await expect(bar.locator('button[data-tab="activity"]')).toBeVisible();
        await expect(bar.locator('button[data-tab="more"]')).toBeVisible();
        // Git / Schedules / Settings are behind `···` rather than squeezed in.
        await expect(bar.locator('button[data-tab="git"]')).toHaveCount(0);
        await expect(bar.locator('button[data-tab="schedules"]')).toHaveCount(0);
        await expect(bar.locator('button[data-tab="settings"]')).toHaveCount(0);
    });

    test('mobile: header actions live behind the `···` sheet', async ({ page, serverUrl }) => {
        await openWorkspace(page, serverUrl, 'my-work');

        // Labelled buttons are collapsed away on mobile.
        await expect(page.locator('[data-testid="my-work-sync-btn"]')).toHaveCount(0);
        await expect(page.locator('[data-testid="my-work-generate-btn"]')).toHaveCount(0);

        await mobileTabBar(page, 'my-work').locator('button[data-tab="more"]').click();
        const sheet = page.locator('[data-testid="mobile-tab-more-sheet"]');
        await expect(sheet).toBeVisible();
        // Sync / Generate sit above the overflow tabs, in header-config order.
        await expect(sheet.locator('[data-testid="mobile-tab-action-0"]')).toContainText('Sync Work IQ');
        await expect(sheet.locator('[data-testid="mobile-tab-action-1"]')).toContainText('Generate Summary');

        // The sheet portals to `document.body`, so sweep it as its own root —
        // scoped to `#view-repos` this assertion would pass vacuously.
        await expectNoHorizontalOverflow(page, 'my-work `···` sheet open', '[data-testid="mobile-tab-more-sheet"]');
    });
});
