/**
 * My Work / My Life mobile responsiveness (AC-03).
 *
 * At a 375px viewport, no sub-tab of either virtual workspace may overflow
 * horizontally, and the shared inline header must stay a single row with its
 * actions behind the `⋯` overflow menu.
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
 * Two independent faults, both scoped to the repos view:
 *  - `bleeds`: a visible box whose right edge sits past the viewport, with no
 *    horizontally scrollable ancestor to justify it.
 *  - `clipped`: a text leaf whose content is wider than its box and is neither
 *    scrollable nor ellipsis-truncated — i.e. a label cut in half.
 * Containers are excluded from `clipped` on purpose: a child with a negative
 * margin (the selection-ring bleed on My Work task rows) widens its parent's
 * scrollWidth without cutting off any text.
 */
async function findHorizontalOverflow(page: Page): Promise<{ bleeds: string[]; clipped: string[] }> {
    return page.evaluate(() => {
        const viewportWidth = document.documentElement.clientWidth;
        const bleeds: string[] = [];
        const clipped: string[] = [];
        const root = document.querySelector('#view-repos');
        if (!root) return { bleeds: ['#view-repos is missing'], clipped: [] };

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
    });
}

/** Assert the viewport shows every sub-tab without horizontal overflow. */
async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth, `${label}: document scrolls horizontally (${scrollWidth} > ${clientWidth})`)
        .toBeLessThanOrEqual(clientWidth);

    const { bleeds, clipped } = await findHorizontalOverflow(page);
    expect(bleeds, `${label}: content past the right edge of the viewport`).toEqual([]);
    expect(clipped, `${label}: text cut off horizontally`).toEqual([]);
}

/** Open a virtual workspace and wait for its view + header to render. */
async function openWorkspace(page: Page, serverUrl: string, prefix: 'my-work' | 'my-life'): Promise<void> {
    const workspaceId = prefix === 'my-work' ? 'my_work' : 'my_life';
    await enableVirtualWorkspaces(serverUrl);
    await page.goto(`${serverUrl}/#repos/${workspaceId}/notes`);
    await expect(page.locator(`[data-testid="${prefix}-view"]`)).toBeVisible({ timeout: 15000 });
    await expect(page.locator(`[data-testid="${prefix}-header"]`)).toBeVisible({ timeout: 15000 });
}

/** Walk every sub-tab of a virtual workspace, asserting no horizontal overflow on each. */
async function sweepSubTabs(page: Page, prefix: 'my-work' | 'my-life', tabs: string[]): Promise<void> {
    for (const tab of tabs) {
        const button = page.locator(`[data-testid="${prefix}-tab-${tab}"]`);
        await expect(button, `${prefix}: ${tab} sub-tab is missing`).toHaveCount(1);
        // The strip scrolls horizontally, so a later tab may start off-screen.
        await button.scrollIntoViewIfNeeded();
        await button.click();
        // The active tab is the one carrying the underline indicator, so this
        // confirms the pane actually switched rather than just that the button
        // exists (all panes stay mounted under keep-alive).
        await expect(button.locator('span.absolute')).toHaveCount(1);
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

    test('mobile: inline header stays one row inside the viewport', async ({ page, serverUrl }) => {
        await openWorkspace(page, serverUrl, 'my-work');

        const header = page.locator('[data-testid="my-work-header"]');
        const headerBox = await header.boundingBox();
        expect(headerBox).toBeTruthy();
        expect(headerBox!.width).toBeLessThanOrEqual(MOBILE.width);
        // A single row: the header is no taller than one row of tab buttons.
        expect(headerBox!.height).toBeLessThan(80);

        // The tab strip scrolls instead of overflowing the header.
        const strip = page.locator('[data-testid="my-work-header-tabs"]');
        const overflowX = await strip.evaluate(el => getComputedStyle(el).overflowX);
        expect(['auto', 'scroll']).toContain(overflowX);
        const scrollable = await strip.evaluate(el => el.scrollWidth > el.clientWidth);
        expect(scrollable).toBe(true);
    });

    test('mobile: header actions live behind the overflow menu', async ({ page, serverUrl }) => {
        await openWorkspace(page, serverUrl, 'my-work');

        // Labelled buttons are collapsed away on mobile.
        await expect(page.locator('[data-testid="my-work-sync-btn"]')).toHaveCount(0);
        await expect(page.locator('[data-testid="my-work-generate-btn"]')).toHaveCount(0);

        await page.locator('[data-testid="my-work-actions-overflow-btn"]').click();
        const menu = page.locator('[data-testid="my-work-actions-overflow-menu"]');
        await expect(menu).toBeVisible();
        await expect(menu.locator('[data-testid="my-work-sync-btn"]')).toBeVisible();
        await expect(menu.locator('[data-testid="my-work-generate-btn"]')).toBeVisible();

        await expectNoHorizontalOverflow(page, 'my-work header actions menu open');
    });
});
