import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ConversationToolInventoryResponse } from '@plusplusoneplusplus/coc-client';

const owner = 'https://inventory-owner.example.test';
const workspaceId = 'workspace-fixture';
const processId = 'process-fixture';
const turn = { turnId: 'first-turn', turnIndex: 1, provider: 'copilot', startedAt: '2026-01-01T00:00:00Z' };
const captured: ConversationToolInventoryResponse = {
    state: 'captured', turn,
    snapshot: {
        version: 1, provider: 'copilot', capturedAt: '2026-01-01T00:00:01Z', truncated: false,
        categories: [
            { source: 'builtin', status: 'complete' },
            { source: 'coc', status: 'complete' },
            { source: 'mcp', status: 'partial', reason: 'Metadata unavailable' },
        ],
        tools: [
            { source: 'builtin', name: 'read_file', description: 'Read a file',
                inputSchema: { type: 'object', properties: { path: { type: 'string' } } } },
            { source: 'coc', name: 'list_notes', description: 'Browse saved notes', inputSchema: false },
            { source: 'mcp', serverName: 'CoC', name: 'unused_tool' },
            { source: 'mcp', serverName: 'Search server', name: 'search_web', description: '<img src=x onerror=alert(1)>' },
        ],
    },
};

let script: string;
let css: string;
test.beforeAll(async () => {
    css = await readFile(path.resolve('src/server/spa/client/dist/bundle.css'), 'utf8');
    const result = await build({
        stdin: {
            resolveDir: process.cwd(), loader: 'tsx', contents: `
                import React from 'react';
                import { createRoot } from 'react-dom/client';
                import { ConversationMetadataPopover } from './src/server/spa/client/react/features/chat/conversation/ConversationMetadataPopover';
                import { useToolInventoryUpdates } from './src/server/spa/client/react/features/chat/hooks/useToolInventoryUpdates';
                import { getCocClientFor } from './src/server/spa/client/react/api/cocClient';
                const client = getCocClientFor(${JSON.stringify(owner)});
                function Fixture() {
                    const refreshKey = useToolInventoryUpdates(${JSON.stringify(owner)}, ${JSON.stringify(workspaceId)}, ${JSON.stringify(processId)});
                    return <><button>Outside</button><ConversationMetadataPopover process={{}}
                        onFork={window.innerWidth >= 768 ? () => { throw new Error('Fork must not run'); } : undefined}
                        toolInventoryTarget={{ client, workspaceId: ${JSON.stringify(workspaceId)}, processId: ${JSON.stringify(processId)}, refreshKey }} /></>;
                }
                createRoot(document.getElementById('fixture')).render(<Fixture />);
            `,
        },
        bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
    });
    script = result.outputFiles[0].text;
});

for (const dark of [false, true]) {
    for (const width of [320, 900]) {
        test(`tools reader uses owner inventory at ${width}px (${dark ? 'dark' : 'light'})`, async ({ page }) => {
            const errors: string[] = [];
            page.on('pageerror', error => errors.push(error.message));
            page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
            await page.setViewportSize({ width, height: 700 });
            let response: ConversationToolInventoryResponse = captured;
            let reads = 0;
            await page.route('https://inventory-page.example.test/**', route => route.fulfill({
                contentType: 'text/html', body: '<div id="fixture"></div>',
            }));
            await page.route(`${owner}/**`, async route => {
                const url = new URL(route.request().url());
                expect(url.pathname).toBe(`/api/processes/${processId}/tool-inventory`);
                expect([...url.searchParams.entries()]).toEqual([['workspace', workspaceId]]);
                expect(route.request().method()).toBe('GET');
                reads++;
                await route.fulfill({
                    json: response,
                    headers: { 'access-control-allow-origin': '*' },
                });
            });
            await page.goto('https://inventory-page.example.test/');
            await page.addStyleTag({ content: css });
            if (dark) await page.evaluate(() => document.documentElement.classList.add('dark'));
            await page.addScriptTag({ content: script });
            const metadata = page.getByRole('button', { name: 'Show conversation metadata' });
            await expect(metadata).toBeVisible();
            expect(reads).toBe(0);
            await metadata.focus();
            await page.keyboard.press('Enter');
            const tools = page.getByRole('button', { name: 'Tools', exact: true });
            await expect(tools).toBeVisible();
            if (width >= 768) {
                await expect(page.getByRole('button', { name: 'Fork' })).toBeVisible();
                await expect(tools.locator('xpath=preceding-sibling::button[1]')).toContainText('Fork');
            }
            await tools.focus();
            await page.keyboard.press('Enter');
            const dialog = page.getByRole('dialog', { name: 'Tools', exact: true });
            await expect(dialog).toBeVisible();
            await expect(page.getByText('Conversation metadata', { exact: true })).toBeHidden();
            const search = dialog.getByRole('searchbox', { name: 'Search tools' });
            await expect(search).toBeFocused();
            await expect(dialog.getByText('read_file', { exact: true })).toBeVisible();
            expect(reads).toBe(1);
            await expect(dialog.getByText(/Latest started turn \u00b7 copilot/)).toContainText('Captured');
            await expect(dialog.getByText(/may still require approval/)).toBeVisible();
            await expect(dialog.getByText('MCP: partial \u2014 Metadata unavailable')).toBeVisible();
            for (const group of ['Built-in', 'CoC', 'MCP \u00b7 CoC', 'MCP \u00b7 Search server']) {
                await expect(dialog.getByRole('region', { name: group, exact: true })).toBeVisible();
            }
            const read = dialog.locator('summary', { hasText: 'read_file' });
            await read.focus();
            await page.keyboard.press('Enter');
            await expect(dialog.getByText('Read a file', { exact: true })).toBeVisible();
            await expect(dialog.locator('pre').filter({ hasText: '"path"' })).toBeVisible();
            await dialog.locator('summary', { hasText: 'list_notes' }).click();
            await expect(dialog.getByText('false', { exact: true })).toBeVisible();
            await dialog.locator('summary', { hasText: 'unused_tool' }).click();
            const mcp = dialog.getByRole('region', { name: 'MCP \u00b7 CoC', exact: true });
            await expect(mcp.getByText('Description unavailable', { exact: true })).toBeVisible();
            await expect(mcp.getByText('Input schema unavailable', { exact: true })).toBeVisible();
            await search.fill('search server');
            await expect(dialog.locator('summary')).toHaveCount(1);
            await dialog.locator('summary', { hasText: 'search_web' }).click();
            await expect(dialog.getByText('<img src=x onerror=alert(1)>', { exact: true })).toBeVisible();
            await expect(dialog.locator('img')).toHaveCount(0);
            expect(await dialog.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
            const bounds = await dialog.boundingBox();
            expect(bounds!.x).toBeGreaterThanOrEqual(0);
            expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
            expect(bounds!.height).toBeLessThanOrEqual(700);
            await page.screenshot({ path: test.info().outputPath('tools.png') });
            const close = dialog.getByRole('button', { name: 'Close', exact: true });
            await close.focus();
            await page.keyboard.press('Shift+Tab');
            await expect(dialog.locator('summary', { hasText: 'search_web' })).toBeFocused();
            await page.keyboard.press('Tab');
            await expect(close).toBeFocused();
            await page.getByRole('button', { name: 'Outside', exact: true }).evaluate(element => element.focus());
            expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);

            const emit = async (state: 'pending' | 'captured') => {
                await page.evaluate(({ owner, workspaceId, processId, state }) => {
                    window.dispatchEvent(new CustomEvent('coc-remote-ws-message', { detail: {
                        baseUrl: owner,
                        message: { type: 'tool-inventory-changed', workspaceId, processId, turnId: 'next-turn', state },
                    } }));
                }, { owner, workspaceId, processId, state });
            };
            const nextTurn = { ...turn, turnId: 'next-turn', turnIndex: 3, provider: 'claude' };
            response = { state: 'pending', turn: nextTurn };
            await emit('pending');
            await expect(dialog.getByText(/Inventory pending/)).toBeVisible();
            await expect(dialog.locator('summary')).toHaveCount(0);
            response = { ...captured, turn: nextTurn, snapshot: {
                ...captured.snapshot, provider: 'claude', tools: [{ source: 'builtin', name: 'next_unused_tool' }],
            } };
            await emit('captured');
            await expect(dialog.getByText('next_unused_tool', { exact: true })).toBeVisible();
            await expect(dialog.getByText(/Latest started turn \u00b7 claude/)).toBeVisible();
            await expect(dialog.getByText('read_file', { exact: true })).toBeHidden();
            await page.keyboard.press('Escape');
            await expect(dialog).toBeHidden();
            await expect(metadata).toBeFocused();
            const closedReads = reads;
            response = { state: 'unavailable' };
            await emit('pending');
            await expect(metadata).toBeFocused();
            expect(reads).toBe(closedReads);
            await metadata.click();
            await tools.click();
            await expect(dialog.getByText('Inventory unavailable', { exact: true })).toBeVisible();
            expect(reads).toBe(closedReads + 1);
            expect(errors).toEqual([]);
        });
    }
}
