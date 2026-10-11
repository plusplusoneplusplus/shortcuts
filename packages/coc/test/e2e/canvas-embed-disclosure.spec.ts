import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// Real wrapper, extension iframe and panel routing; API reads stay in the fixture.
let script: string;
let css: string;
test.use({ hasTouch: true });
test.beforeAll(async () => {
    css = await readFile(path.resolve('src/server/spa/client/dist/bundle.css'), 'utf8');
    const result = await build({
        stdin: {
            resolveDir: process.cwd(), loader: 'tsx', contents: `
                import React from 'react';
                import { createRoot } from 'react-dom/client';
                import { CanvasEmbed } from './src/server/spa/client/react/shared/CanvasEmbed';
                import { ChatRenderContextProvider } from './src/server/spa/client/react/features/chat/conversation/ChatRenderContext';
                import { UnifiedPanelHostProvider } from './src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelHost';
                import { readUnifiedPanelState } from './src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelStore';
                import { visibleTabs } from './src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';
                window.readCanvasTabs = () => visibleTabs(readUnifiedPanelState('ws-fixture'), 'chat-fixture');
                createRoot(document.getElementById('fixture')).render(
                    <UnifiedPanelHostProvider host={{ workspaceId: 'ws-fixture', chatId: 'chat-fixture' }}>
                        <ChatRenderContextProvider value={{ wsId: 'ws-fixture', chatId: 'chat-fixture' }}>
                            <CanvasEmbed workspaceId="ws-fixture" canvasId="first" />
                            <CanvasEmbed workspaceId="ws-fixture" canvasId="second" />
                        </ChatRenderContextProvider>
                    </UnifiedPanelHostProvider>
                );
            `,
        },
        bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
        loader: { '.css': 'empty' },
        plugins: [{
            name: 'unused-diagram-view',
            setup(builder) {
                builder.onResolve({ filter: /\/ExcalidrawPreview$/ }, () => ({ path: 'diagram', namespace: 'fixture' }));
                builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
                    contents: 'export const ExcalidrawPreview = () => null;',
                }));
            },
        }],
    });
    script = result.outputFiles[0].text;
});

for (const dark of [false, true]) {
    for (const width of [320, 900]) {
        test(`canvas disclosure preserves iframe drafts at ${width}px (${dark ? 'dark' : 'light'})`, async ({ page }) => {
            const errors: string[] = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.setViewportSize({ width, height: 900 });
            await page.route('http://canvas.test/**', async route => {
                const url = new URL(route.request().url());
                if (url.pathname === '/') {
                    await route.fulfill({
                        contentType: 'text/html',
                        body: '<div id="fixture" class="markdown-body" style="height:500px;overflow:auto"></div>',
                    });
                } else if (url.pathname.endsWith('/extension')) {
                    await route.fulfill({
                        json: { extension: {
                            manifest: { description: 'Draft editor', capabilities: [] },
                            capabilitiesJs: 'capabilities = {};',
                            uiHtml: '<label>Draft <input id="draft"></label><script>window.frameIdentity = Math.random();</script>',
                        } },
                    });
                } else if (/\/canvases\/(first|second)$/.test(url.pathname)) {
                    const id = url.pathname.split('/').at(-1);
                    await route.fulfill({
                        json: { canvas: {
                            id, workspaceId: 'ws-fixture', title: `Message draft ${id}`,
                            type: 'extension', content: '{}', revision: 1,
                            createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', lastEditor: 'ai',
                        } },
                    });
                } else {
                    throw new Error(`Unexpected fixture request: ${url.pathname}`);
                }
            });
            await page.goto('http://canvas.test/');
            await page.addStyleTag({ content: css });
            if (dark) await page.evaluate(() => document.documentElement.classList.add('dark'));
            await page.addScriptTag({ content: script });
            await expect(page.getByTestId('canvas-embed-toggle').first()).toBeVisible();
            expect(errors).toEqual([]);

            const first = page.getByTestId('canvas-embed').nth(0);
            const second = page.getByTestId('canvas-embed').nth(1);
            const toggle = first.getByTestId('canvas-embed-toggle');
            const frame = first.frameLocator('iframe');
            await frame.getByRole('textbox', { name: 'Draft' }).fill('Unsaved local draft');
            const identity = await frame.locator('body').evaluate(() => Reflect.get(window, 'frameIdentity'));
            const expandedHeight = (await first.boundingBox())!.height;
            const expandedScrollHeight = await page.locator('#fixture').evaluate(el => el.scrollHeight);
            const scrollTop = await page.locator('#fixture').evaluate(el => el.scrollTop);
            await toggle.focus();
            await page.keyboard.press('Enter');
            await expect(toggle).toHaveAttribute('aria-expanded', 'false');
            await expect(first.getByTestId('canvas-embed-body')).toBeHidden();
            await expect(first.getByTestId('canvas-embed-body')).toHaveAttribute('inert', '');
            expect(expandedHeight - (await first.boundingBox())!.height).toBeGreaterThanOrEqual(400);
            expect(expandedScrollHeight - await page.locator('#fixture').evaluate(el => el.scrollHeight)).toBeGreaterThanOrEqual(350);
            expect(await page.locator('#fixture').evaluate(el => el.scrollTop)).toBe(scrollTop);
            expect(await first.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
            await expect(second.getByTestId('canvas-embed-toggle')).toHaveAttribute('aria-expanded', 'true');

            // Tab skips the hidden iframe and reaches the separate panel action.
            await page.keyboard.press('Tab');
            const open = first.getByTestId('canvas-embed-open-in-panel');
            await expect(open).toBeFocused();
            await page.keyboard.press('Enter');
            expect(await page.evaluate(() => Reflect.get(window, 'readCanvasTabs')())).toMatchObject([
                { kind: 'canvas', ownerWorkspaceId: 'ws-fixture', resourceId: 'first', label: 'Message draft first' },
            ]);
            await expect(toggle).toHaveAttribute('aria-expanded', 'false');
            await toggle.focus();
            await page.keyboard.press('Space');
            await expect(toggle).toHaveAttribute('aria-expanded', 'true');
            await expect(frame.getByRole('textbox', { name: 'Draft' })).toHaveValue('Unsaved local draft');
            expect(await frame.locator('body').evaluate(() => Reflect.get(window, 'frameIdentity'))).toBe(identity);

            const secondToggle = second.getByTestId('canvas-embed-toggle');
            await secondToggle.tap();
            await expect(secondToggle).toHaveAttribute('aria-expanded', 'false');
            await expect(toggle).toHaveAttribute('aria-expanded', 'true');
            await secondToggle.tap();
            await expect(secondToggle).toHaveAttribute('aria-expanded', 'true');
            expect(errors).toEqual([]);
        });
    }
}
