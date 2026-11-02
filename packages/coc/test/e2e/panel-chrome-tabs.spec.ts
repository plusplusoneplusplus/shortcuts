import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';

const PANEL = './src/server/spa/client/react/features/repo-detail/unified-right-panel';
let script: string;
let css: string;

// Exercise the actual strip and stylesheet without a running CoC server.
test.beforeAll(async () => {
    css = (await postcss([tailwindcss({
        content: [`${PANEL}/UnifiedPanelTabStrip.tsx`, `${PANEL}/UnifiedPanelTabGroupLabel.tsx`],
        darkMode: 'class',
    })]).process('@tailwind base; @tailwind components; @tailwind utilities;', { from: undefined })).css;
    css += await readFile(`${PANEL}/unifiedPanelTabs.css`, 'utf8');
    const bundle = await build({
        stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
            import React from 'react';
            import { createRoot } from 'react-dom/client';
            import { UnifiedPanelTabStrip } from '${PANEL}/UnifiedPanelTabStrip';
            import { EMPTY_UNIFIED_PANEL, openTab, visibleTabs } from '${PANEL}/unifiedPanelTabsModel';
            let initial = EMPTY_UNIFIED_PANEL;
            for (const [kind, label] of [['terminal', 'Shell'], ['notes', 'Notes'],
                ['file', 'a.ts'], ['file', 'b.ts'], ['file', 'c.ts'], ['file', 'active.ts'],
                ['browser', 'Documentation'], ['canvas', 'Design']]) {
                initial = openTab(initial, { kind, label, resourceId: label, ownerWorkspaceId: 'ws', chatId: 'chat' });
            }
            const initialTabs = visibleTabs(initial, 'chat');
            function Fixture() {
                const [tabs, setTabs] = React.useState(initialTabs);
                const [activeId, setActive] = React.useState(initialTabs.find(t => t.label === 'active.ts').id);
                const [folded, setFolded] = React.useState(new Set());
                const [narrow, setNarrow] = React.useState(false);
                return <>
                    <div style={{ width: narrow ? 320 : 1300 }}>
                        <UnifiedPanelTabStrip tabs={tabs} activeId={activeId} groupsEnabled
                            foldedGroups={folded} onToggleGroup={group => setFolded(previous => {
                                const next = new Set(previous);
                                if (!next.delete(group)) next.add(group);
                                return next;
                            })}
                            onActivate={setActive} onMove={() => {}} onOpenMenu={() => {}}
                            onClose={id => setTabs(previous => previous.filter(t => t.id !== id))}
                            onCloseMany={() => {}} />
                        <div data-testid="content" style={{ height: 150,
                            background: document.documentElement.classList.contains('dark') ? '#1e1e1e' : '#fff' }} />
                    </div>
                    <button onClick={() => setNarrow(true)}>Narrow panel</button>
                </>;
            }
            createRoot(document.getElementById('fixture')).render(<Fixture />);
        ` },
        bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
        loader: { '.css': 'empty' },
    });
    script = bundle.outputFiles[0].text;
});

for (const dark of [false, true]) {
    test(`Chrome tabs keep groups inline and controls reachable (${dark ? 'dark' : 'light'})`, async ({ page }, testInfo) => {
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setViewportSize({ width: 1400, height: 600 });
        await page.setContent(`<html class="${dark ? 'dark' : ''}"><head><style>${css}</style></head>
            <body><div id="fixture"></div></body></html>`);
        await page.addScriptTag({ content: script });
        const list = page.getByRole('tablist', { name: 'Open resources' });
        const active = page.getByRole('tab', { selected: true });
        await expect(active).toContainText('active.ts');
        await expect(active).toHaveCSS('border-top-left-radius', '10px');
        await expect(active).toHaveCSS('background-color', dark ? 'rgb(30, 30, 30)' : 'rgb(255, 255, 255)');
        await expect(active).toHaveCSS('border-right-width', '0px');
        const corner = await active.evaluate(node => {
            const style = getComputedStyle(node, '::before');
            return { background: style.backgroundImage, width: style.width, pointerEvents: style.pointerEvents };
        });
        expect(corner.background).toContain('radial-gradient');
        expect(corner.width).toBe('8px');
        expect(corner.pointerEvents).toBe('none');
        const groups = page.locator('[data-strip-group]');
        const tops = await groups.evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().top));
        expect(new Set(tops).size).toBe(1);
        const listBox = (await list.boundingBox())!;
        for (const group of await groups.all()) {
            const groupBox = (await group.boundingBox())!;
            const label = group.locator('.unified-panel-group-label');
            const labelBox = (await label.boundingBox())!;
            expect(groupBox.y).toBeGreaterThanOrEqual(listBox.y);
            expect(groupBox.y + groupBox.height).toBeLessThanOrEqual(listBox.y + listBox.height);
            expect(labelBox.y).toBeGreaterThanOrEqual(groupBox.y);
            expect(labelBox.y + labelBox.height).toBeLessThanOrEqual(groupBox.y + groupBox.height);
        }
        await page.screenshot({ path: testInfo.outputPath('tabs.png') });

        const files = page.getByRole('button', { name: 'Files, 4 tabs', exact: true });
        await files.click();
        await expect(files).toHaveAttribute('aria-expanded', 'false');
        await expect(page.locator('[data-strip-group="files"]').getByRole('tab')).toHaveCount(1);
        await expect(active).toContainText('active.ts');
        await files.click();
        await expect(files).toHaveAttribute('aria-expanded', 'true');
        const a = page.getByRole('tab').filter({ hasText: 'a.ts' });
        await a.click();
        await expect(a).toHaveAttribute('aria-selected', 'true');
        await expect(a).toHaveCSS('background-color', dark ? 'rgb(30, 30, 30)' : 'rgb(255, 255, 255)');
        await page.emulateMedia({ forcedColors: 'active' });
        await expect(a).toHaveCSS('outline-style', 'solid');
        await expect(files).toHaveCSS('outline-style', 'solid');
        await page.emulateMedia({ forcedColors: 'none' });
        await a.getByRole('button', { name: 'Close a.ts', exact: true }).click();
        await expect(a).toHaveCount(0);

        await page.getByRole('button', { name: 'Narrow panel' }).click();
        expect(await list.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
        await expect(page.getByRole('button', { name: 'Open resource', exact: true })).toBeVisible();
        await expect(page.getByTestId('unified-panel-tab-strip')).toHaveCSS('height', '41px');
        expect(errors).toEqual([]);
    });
}
