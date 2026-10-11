import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// Real shared chat, isolated API fixtures: no running CoC server is modified.
let script: string;
let css: string;
test.beforeAll(async () => {
    css = await readFile(path.resolve('src/server/spa/client/dist/bundle.css'), 'utf8');
    const result = await build({
        stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
            import React from 'react';
            import { createRoot } from 'react-dom/client';
            import { AppProvider } from './src/server/spa/client/react/contexts/AppContext';
            import { QueueProvider } from './src/server/spa/client/react/contexts/QueueContext';
            import { TaskProvider } from './src/server/spa/client/react/contexts/TaskContext';
            import { NotificationProvider } from './src/server/spa/client/react/contexts/NotificationContext';
            import { ToastProvider } from './src/server/spa/client/react/contexts/ToastContext';
            import { ChatPreferencesProvider } from './src/server/spa/client/react/contexts/ChatPreferencesContext';
            import { ChatDetail } from './src/server/spa/client/react/features/chat/ChatDetail';
            const root = createRoot(document.getElementById('fixture'));
            window.showChat = (id) => root.render(
                <AppProvider><QueueProvider><TaskProvider><NotificationProvider>
                    <ToastProvider value={{ toasts: [], addToast: () => {}, removeToast: () => {} }}>
                        <ChatPreferencesProvider workspaceId="ws-fixture">
                            <ChatDetail key={id} taskId={id} workspaceId="ws-fixture" disableScratchpad />
                        </ChatPreferencesProvider>
                    </ToastProvider>
                </NotificationProvider></TaskProvider></QueueProvider></AppProvider>
            );
            window.showChat('queue_sentinel');
        ` },
        bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
        conditions: ['production'], loader: { '.css': 'empty', '.ttf': 'dataurl' },
        alias: { '@spa/features': './src/server/spa/client/react/features', '@spa/ui': './src/server/spa/client/react/ui', '@spa/shared': './src/server/spa/client/react/shared' },
    });
    script = result.outputFiles[0].text;
});

for (const paging of [false, true]) {
    for (const dark of [false, true]) {
        test(`Sentinel reclaims minimap width with paging=${paging}, dark=${dark}`, async ({ page }, testInfo) => {
            const errors: string[] = [];
            page.on('pageerror', error => errors.push(error.message));
            page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
            await page.setViewportSize({ width: 1280, height: 900 });
            await page.route('http://minimap.test/**', async route => {
                const url = new URL(route.request().url());
                if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: `
                    <html class="${dark ? 'dark' : ''}"><body style="margin:0;background:${dark ? '#1e1e1e' : '#fff'};color:${dark ? '#ccc' : '#1f2328'}">
                    <main style="display:flex;height:100vh"><div id="fixture" style="display:flex;flex:1;min-width:0"></div>
                    <aside id="todo" style="width:240px;flex-shrink:0;border-left:1px solid #888;padding:16px;box-sizing:border-box">To-do</aside></main>
                    <script>window.__DASHBOARD_CONFIG__ = { features: { chatHistoryPagingEnabled: ${paging} } };</script></body></html>` });
                if (url.pathname.includes('/stream')) return route.fulfill({ contentType: 'text/event-stream', body: '' });
                if (/\/processes\/queue_(sentinel|ask)$/.test(url.pathname)) {
                    const mode = url.pathname.endsWith('sentinel') ? 'sentinel' : 'ask';
                    return route.fulfill({ json: { process: {
                        id: `queue_${mode}`, type: 'chat', status: 'completed', title: `${mode} fixture`, sdkSessionId: 'fixture-session',
                        metadata: { mode, workspaceId: 'ws-fixture', provider: 'copilot' },
                        conversationTurns: Array.from({ length: 12 }, (_, turnIndex) => ({
                            role: turnIndex % 2 ? 'assistant' : 'user', turnIndex, timeline: [],
                            content: `${mode} turn ${turnIndex}: Conversation content retains its existing padding and scroll behavior.`,
                        })),
                    }, ...(paging ? { history: { oldestTurnIndex: 0, hasMore: false, totalTurns: 12, historyRevision: 0 } } : {}) } });
                }
                if (url.pathname.endsWith('/turns/pinned')) return route.fulfill({ json: { turns: [] } });
                if (url.pathname.endsWith('/models')) return route.fulfill({ json: [] });
                if (url.pathname.endsWith('/skills/all')) return route.fulfill({ json: { merged: [] } });
                if (url.pathname.endsWith('/config/runtime')) return route.fulfill({ json: { features: { chatHistoryPagingEnabled: paging } } });
                return route.fulfill({ json: {} });
            });
            await page.goto('http://minimap.test/');
            await page.addStyleTag({ content: css });
            await page.addScriptTag({ content: script });
            const conversation = page.getByTestId('activity-chat-conversation');
            await expect.poll(async () => errors.length || await conversation.count()).toBeGreaterThan(0);
            expect(errors).toEqual([]);
            await expect(conversation).toContainText('sentinel turn 11');
            await expect(page.locator('[class*="minimap-"]')).toHaveCount(0);
            await page.keyboard.press('Alt+m');
            await expect(page.locator('[class*="minimap-"]')).toHaveCount(0);
            const sentinelWidth = (await conversation.boundingBox())!.width;
            const todoWidth = (await page.locator('#todo').boundingBox())!.width;
            await page.screenshot({ path: testInfo.outputPath('sentinel.png') });
            await page.evaluate(() => (window as any).showChat('queue_ask'));
            await expect(page.getByTestId('minimap-panel')).toBeVisible();
            expect(sentinelWidth - (await conversation.boundingBox())!.width).toBeGreaterThan(0);
            expect((await page.locator('#todo').boundingBox())!.width).toBe(todoWidth);
            await page.getByTestId('minimap-collapse-btn').click();
            await expect(page.getByTestId('minimap-collapsed')).toBeAttached();
            await page.setViewportSize({ width: 700, height: 900 });
            await page.evaluate(() => (window as any).showChat('queue_sentinel'));
            await expect(conversation).toContainText('sentinel turn 11');
            await expect(page.locator('[class*="minimap-"]')).toHaveCount(0);
            const geometry = await conversation.evaluate(el => ({
                width: el.clientWidth, overflow: getComputedStyle(el).overflowY, padding: getComputedStyle(el).paddingRight,
            }));
            expect(geometry.width).toBeGreaterThan(0);
            expect(geometry.overflow).toBe('auto');
            expect(geometry.padding).toBe('16px');
            expect(errors).toEqual([]);
        });
    }
}
