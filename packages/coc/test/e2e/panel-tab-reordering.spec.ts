import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

let script: string;
let css: string;
test.beforeAll(async () => {
    css = await readFile(path.resolve('src/server/spa/client/dist/bundle.css'), 'utf8');
    const bundle = await build({
        stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
            import React from 'react';
            import { createRoot } from 'react-dom/client';
            import { UnifiedPanelTabStrip } from './src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedPanelTabStrip';
            import { useUnifiedPanelTabs } from './src/server/spa/client/react/features/repo-detail/unified-right-panel/useUnifiedPanelTabs';
            import { writeUnifiedPanelState } from './src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelStore';
            import { EMPTY_UNIFIED_PANEL, openTab, unifiedPanelStorageKey } from './src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';
            const scope = 'fixture-workspace', chat = 'fixture-chat';
            if (!localStorage.getItem(unifiedPanelStorageKey(scope))) {
                let state = EMPTY_UNIFIED_PANEL;
                for (const kind of ['terminal', 'file', 'browser', 'todo']) {
                    state = openTab(state, { kind, ownerWorkspaceId: scope, chatId: chat,
                        resourceId: kind === 'file' ? 'sample.md' : kind, label: kind === 'file' ? 'sample.md' : kind });
                }
                writeUnifiedPanelState(scope, state);
            }
            const counts = window.panelFixture = { mounts: {}, unmounts: {}, activates: 0, closes: 0 };
            function Content({ tab }) {
                React.useEffect(() => {
                    counts.mounts[tab.id] = (counts.mounts[tab.id] || 0) + 1;
                    return () => { counts.unmounts[tab.id] = (counts.unmounts[tab.id] || 0) + 1; };
                }, [tab.id]);
                return <input data-content-kind={tab.kind} defaultValue={tab.kind} />;
            }
            function Fixture() {
                const api = useUnifiedPanelTabs(scope, chat, true);
                const [narrow, setNarrow] = React.useState(false);
                counts.activeId = api.activeId;
                return <>
                    <div style={{ width: narrow ? 200 : 600, margin: 20 }}>
                        <UnifiedPanelTabStrip tabs={api.tabs} activeId={api.activeId}
                            reorderEnabled reorderScope={scope + ':' + chat} onMove={api.move}
                            onActivate={id => { counts.activates++; api.activate(id); }}
                            onClose={id => { counts.closes++; api.close(id); }} onCloseMany={() => {}}
                            onOpenMenu={() => {}} />
                    </div>
                    <div>{api.tabs.map(tab => <Content key={tab.id} tab={tab} />)}</div>
                    <button onClick={() => setNarrow(true)}>Narrow strip</button>
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
    test(`mixed tab drag, keyboard/menu, content identity and restore (${dark ? 'dark' : 'light'})`, async ({ page }) => {
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        await page.route('http://panel.test/**', route => route.fulfill({
            contentType: 'text/html', body: `<html class="${dark ? 'dark' : ''}"><body><div id="fixture"></div></body></html>`,
        }));
        await page.goto('http://panel.test/');
        await page.addStyleTag({ content: css });
        await page.addScriptTag({ content: script });
        const tabs = page.getByRole('tab');
        const kinds = () => tabs.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-kind')));
        await expect(tabs).toHaveCount(4);
        expect(await kinds()).toEqual(['terminal', 'browser', 'todo', 'file']);
        for (const kind of ['terminal', 'browser', 'todo', 'file']) {
            await page.locator('[data-content-kind="' + kind + '"]').fill('retained ' + kind);
        }
        await page.evaluate(() => {
            const fixture = (window as unknown as { panelFixture: Record<string, unknown> }).panelFixture;
            fixture.nodes = [...document.querySelectorAll('[data-content-kind]')];
            fixture.initialActive = fixture.activeId;
        });
        const file = page.locator('[role="tab"][data-kind="file"]');
        const terminal = page.locator('[role="tab"][data-kind="terminal"]');
        const sourceBox = (await file.boundingBox())!;
        const targetBox = (await terminal.boundingBox())!;
        await page.mouse.move(sourceBox.x + 20, sourceBox.y + 15);
        await page.mouse.down();
        await page.mouse.move(sourceBox.x - 20, sourceBox.y + 15, { steps: 3 });
        await page.mouse.move(targetBox.x + 4, targetBox.y + 15, { steps: 4 });
        await expect(page.getByTestId('unified-panel-tab-drop-indicator')).toHaveAttribute('data-position', 'before');
        await expect(page.getByTestId('unified-panel-tab-drop-indicator')).toHaveCSS('width', '2px');
        await expect(page.getByTestId('unified-panel-tab-drop-indicator')).toHaveCSS('background-color', dark ? 'rgb(55, 148, 255)' : 'rgb(0, 120, 212)');
        await expect(file).toHaveAttribute('data-dragging', 'true');
        await expect(file).toHaveCSS('opacity', '0.5');
        await page.keyboard.press('Escape');
        await page.mouse.up();
        await expect(page.getByTestId('unified-panel-tab-drop-indicator')).toHaveCount(0);
        expect(await kinds()).toEqual(['terminal', 'browser', 'todo', 'file']);
        await file.dragTo(terminal, { targetPosition: { x: 4, y: 15 } });
        await expect.poll(kinds).toEqual(['file', 'terminal', 'browser', 'todo']);
        await expect(file).toBeFocused();
        for (const kind of ['terminal', 'browser', 'todo', 'file']) {
            await expect(page.locator('[data-content-kind="' + kind + '"]')).toHaveValue('retained ' + kind);
        }
        expect(await page.evaluate(() => {
            const fixture = (window as unknown as { panelFixture: {
                nodes: Element[]; activeId: string; initialActive: string; activates: number; closes: number;
                mounts: Record<string, number>; unmounts: Record<string, number>;
            } }).panelFixture;
            return {
                sameNodes: fixture.nodes.every(node => document.contains(node)),
                sameActive: fixture.activeId === fixture.initialActive,
                mounts: Object.values(fixture.mounts), unmounts: Object.values(fixture.unmounts),
                activates: fixture.activates, closes: fixture.closes,
            };
        })).toEqual({ sameNodes: true, sameActive: true, mounts: [1, 1, 1, 1], unmounts: [], activates: 0, closes: 0 });

        await file.press('Alt+ArrowRight');
        await expect.poll(kinds).toEqual(['terminal', 'file', 'browser', 'todo']);
        await file.press('Shift+F10');
        await page.getByRole('menuitem', { name: 'Move right', exact: true }).click();
        await expect.poll(kinds).toEqual(['terminal', 'browser', 'file', 'todo']);
        await expect(file).toBeFocused();
        await page.getByRole('button', { name: 'Narrow strip' }).click();
        const list = page.getByTestId('unified-panel-tab-list');
        expect(await list.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
        await expect(page.getByRole('button', { name: 'Open resource' })).toBeVisible();
        await page.reload();
        await page.addStyleTag({ content: css });
        await page.addScriptTag({ content: script });
        await expect(tabs).toHaveCount(3);
        expect(await kinds()).toEqual(['terminal', 'file', 'todo']);
        await expect(page.locator('[role="tab"][data-kind="todo"]')).toHaveAttribute('aria-selected', 'true');
        expect(errors).toEqual([]);
    });
}
