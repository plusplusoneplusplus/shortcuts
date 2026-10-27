/**
 * Browser tabs in the unified panel strip are sized by the strip, not by their
 * titles: equal widths at a shared 160px basis, shrinking evenly to 96px before
 * the row scrolls. Measured in a real browser because jsdom has no layout.
 *
 * The CSS is compiled from the strip source here rather than read from the
 * client dist, so the check never depends on a rebuilt bundle.
 */
import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';

const STRIP = './src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedPanelTabStrip.tsx';
const TITLES = ['Google', 'Search - Microsoft Bing and a much longer page title', 'YouTube', 'Apple'];

let script: string;
let css: string;
test.beforeAll(async () => {
    css = (await postcss([tailwindcss({
        content: [STRIP],
        darkMode: 'class',
        corePlugins: { preflight: true },
    })]).process('@tailwind base; @tailwind components; @tailwind utilities;', { from: undefined })).css;
    const bundle = await build({
        stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
            import React from 'react';
            import { createRoot } from 'react-dom/client';
            import { UnifiedPanelTabStrip } from '${STRIP}';
            import { EMPTY_UNIFIED_PANEL, openTab, visibleTabs } from './src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';
            let state = EMPTY_UNIFIED_PANEL;
            for (const label of ${JSON.stringify(TITLES)}) {
                state = openTab(state, { kind: 'browser', ownerWorkspaceId: 'ws', chatId: 'chat', resourceId: label, label });
            }
            state = openTab(state, { kind: 'terminal', ownerWorkspaceId: 'ws', chatId: 'chat', resourceId: 't', label: 'bash' });
            const tabs = visibleTabs(state, 'chat');
            window.fixtureTabs = tabs.map(tab => ({ id: tab.id, kind: tab.kind }));
            function Fixture() {
                const [width, setWidth] = React.useState(1200);
                window.setStripWidth = setWidth;
                return <div style={{ width }} data-testid="host">
                    <UnifiedPanelTabStrip tabs={tabs} activeId={tabs[3].id}
                        onActivate={() => {}} onClose={() => {}} onCloseMany={() => {}} onMove={() => {}} />
                </div>;
            }
            createRoot(document.getElementById('fixture')).render(<Fixture />);
        ` },
        bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
        loader: { '.css': 'empty' },
    });
    script = bundle.outputFiles[0].text;
});

async function measure(page: Page) {
    return page.evaluate(() => {
        const list = document.querySelector('[data-testid="unified-panel-tab-list"]') as HTMLElement;
        const tabs = (window as any).fixtureTabs as { id: string; kind: string }[];
        return {
            overflow: list.scrollWidth > list.clientWidth,
            tabs: tabs.map(({ id, kind }) => {
                const node = document.querySelector(`[data-testid="unified-panel-tab-${id}"]`) as HTMLElement;
                const label = document.querySelector(`[data-testid="unified-panel-tab-label-${id}"]`) as HTMLElement;
                const close = document.querySelector(`[data-testid="unified-panel-tab-close-${id}"]`) as HTMLElement;
                const box = node.getBoundingClientRect();
                return {
                    kind,
                    width: box.width,
                    height: box.height,
                    ellipsized: label.scrollWidth > label.clientWidth,
                    closeInside: close.getBoundingClientRect().right <= box.right,
                };
            }),
        };
    });
}

test('browser tabs share one width regardless of title, then shrink evenly and scroll', async ({ page }) => {
    await page.setContent(`<!doctype html><html><head><style>${css}</style></head><body><div id="fixture"></div></body></html>`);
    await page.addScriptTag({ content: script });
    await expect(page.getByTestId('unified-panel-tab-list')).toBeVisible();

    const wide = await measure(page);
    const browser = wide.tabs.filter(tab => tab.kind === 'browser');
    expect(browser.map(tab => tab.width)).toEqual([160, 160, 160, 160]);
    expect(browser[1].ellipsized).toBe(true);
    expect(browser.every(tab => tab.height === 35 && tab.closeInside)).toBe(true);
    expect(wide.overflow).toBe(false);

    // Constrained: browser tabs shrink together while other kinds hold their width.
    const terminalWidth = wide.tabs.find(tab => tab.kind === 'terminal')!.width;
    await page.evaluate(() => (window as any).setStripWidth(560));
    await expect.poll(async () => (await measure(page)).tabs[0].width).toBeLessThan(160);
    const narrow = await measure(page);
    const shrunk = narrow.tabs.filter(tab => tab.kind === 'browser').map(tab => tab.width);
    expect(Math.max(...shrunk) - Math.min(...shrunk)).toBeLessThan(1);
    expect(shrunk[0]).toBeGreaterThan(96);
    expect(narrow.tabs.find(tab => tab.kind === 'terminal')!.width).toBe(terminalWidth);
    expect(narrow.overflow).toBe(false);

    // Below the floor the row scrolls instead of squeezing further.
    await page.evaluate(() => (window as any).setStripWidth(240));
    await expect.poll(async () => (await measure(page)).overflow).toBe(true);
    const tight = await measure(page);
    expect(tight.tabs.filter(tab => tab.kind === 'browser').map(tab => tab.width)).toEqual([96, 96, 96, 96]);
    expect(tight.tabs.every(tab => tab.closeInside)).toBe(true);
});
