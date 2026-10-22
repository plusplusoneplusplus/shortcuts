import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// Isolated component fixture: no live CoC service, config writes, or job admission.
let javascript: string;
let css: string;
test.beforeAll(async () => {
    const root = path.resolve(__dirname, '../..');
    const result = await build({
        stdin: { resolveDir: root, loader: 'tsx', contents: `
            import React, { useState, useRef } from 'react';
            import { createRoot } from 'react-dom/client';
            import { SentinelTargetInput } from './src/server/spa/client/react/features/chat/SentinelTargetInput';
            import { publishDashboardTopology } from './src/server/spa/client/react/shared/dashboard-discovery/topology';
            window.__DASHBOARD_CONFIG__ = { apiBasePath: '/api', features: { sentinelTargetAutocompleteEnabled: true } };
            publishDashboardTopology('ws', [{ id: 'ws', name: 'shortcuts' }, { id: 'group-tools', name: 'Tools', virtual: true },
                { id: 'ws', name: 'shortcuts', baseUrl: 'https://arm.test', remote: { serverId: 'alias', serverIdentity: 'arm-durable', serverLabel: 'ubuntu-arm', serverKind: 'url', baseUrl: 'https://arm.test', connection: 'online', offline: false } }], 'local-durable');
            function App() {
                const [value, setValue] = useState('');
                const ref = useRef(null);
                window.editorHandle = ref;
                window.rawValue = value;
                return <div style={{width: '100%', maxWidth: 720, marginTop: 310}}>
                    <SentinelTargetInput sentinel ownerRef="ws" ref={ref} value={value} onChange={setValue} data-testid="editor" />
                </div>;
            }
            createRoot(document.getElementById('root')).render(<App />);
        ` },
        bundle: true, write: false, jsx: 'automatic', format: 'iife', define: { 'process.env.NODE_ENV': '"test"' },
    });
    javascript = result.outputFiles[0].text;
    css = await readFile(path.join(root, 'src/server/spa/client/dist/bundle.css'), 'utf8');
});
test.beforeEach(async ({ page }) => {
    await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<html><body><div id="root"></div></body></html>' });
        const serverIdentity = url.hostname === 'arm.test' ? 'arm-durable' : 'local-durable';
        const body = url.pathname === '/api/health' ? { serverIdentity }
            : url.pathname === '/api/workspaces' ? { workspaces: [{ id: 'ws', name: 'shortcuts' }] }
            : { id: 'group-tools', name: 'Tools', members: [{ workspaceId: 'ws' }] };
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.goto('https://sentinel.test');
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: javascript });
});

test('atomic selection, editing, native undo/redo and readable clipboard', async ({ page, context }) => {
    const editor = page.getByTestId('editor');
    await editor.fill('Compare #short');
    await expect(page.getByRole('option')).toHaveCount(2);
    await editor.press('ArrowDown'); await editor.press('Tab');
    await expect(editor.locator('[contenteditable=false]')).toHaveText('#ubuntu-arm / shortcuts');
    expect(await page.evaluate(() => (window as any).editorHandle.current.getValue())).toContain('/workspace/arm-durable/ws');
    await editor.press('ControlOrMeta+z');
    await expect(editor.locator('[contenteditable=false]')).toHaveCount(0);
    await editor.press('ControlOrMeta+Shift+z');
    await expect(editor.locator('[contenteditable=false]')).toHaveCount(1);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await editor.press('ControlOrMeta+a'); await editor.press('ControlOrMeta+c');
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toContain('#ubuntu-arm / shortcuts'); expect(clipboard).not.toContain('#sentinel-targets');
    await editor.press('ControlOrMeta+x');
    await expect(editor.locator('[contenteditable=false]')).toHaveCount(0);
    await editor.press('ControlOrMeta+v');
    await expect(editor.locator('[contenteditable=false]')).toHaveCount(1);
    expect(await page.evaluate(() => (window as any).editorHandle.current.getValue())).toContain('/workspace/arm-durable/ws');
    await editor.press('ArrowRight'); await editor.press('Backspace'); await editor.press('Backspace');
    await expect(editor.locator('[contenteditable=false]')).toHaveCount(0);
    await editor.press('ControlOrMeta+z');
    await expect(editor.locator('[contenteditable=false]')).toHaveCount(1);
    expect(await page.evaluate(() => (window as any).editorHandle.current.getValue())).toContain('/workspace/arm-durable/ws');
});

test('multiple inline targets survive editing and touch results fit above a narrow composer', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    const editor = page.getByTestId('editor');
    await editor.fill('#short');
    await page.getByRole('option', { name: /shortcuts.*Local/ }).click();
    await editor.pressSequentially(' and #Tools');
    const group = page.getByRole('option', { name: /Tools/ });
    await expect(group).toContainText('1 members');
    const menuBox = (await page.getByTestId('sentinel-target-menu').boundingBox())!;
    const inputBox = (await editor.boundingBox())!;
    const rowBox = (await group.boundingBox())!;
    expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(inputBox.y);
    expect(menuBox.width).toBeLessThanOrEqual(inputBox.width + 1);
    expect(rowBox.height).toBeGreaterThanOrEqual(44);
    await group.click();
    await expect(editor.locator('[contenteditable=false]')).toHaveCount(2);
    const raw = await page.evaluate(() => (window as any).editorHandle.current.getValue());
    expect(raw).toContain('/workspace/local-durable/ws'); expect(raw).toContain('/group/local-durable/group-tools');
    await editor.press('ControlOrMeta+a'); await editor.pressSequentially('Edited draft');
    expect(await page.evaluate(() => (window as any).editorHandle.current.getValue())).toBe('Edited draft');
    await editor.press('ControlOrMeta+z');
    await expect(editor.locator('[contenteditable=false]')).toHaveCount(2);
});


test('normal multiline text and inline references keep their serialized offsets', async ({ page }) => {
    const editor = page.getByTestId('editor');
    await editor.fill('First line');
    await editor.press('End'); await editor.press('Enter'); await editor.press('Enter');
    await editor.pressSequentially('Compare #short');
    await page.getByRole('option', { name: /shortcuts.*Local/ }).click();
    const raw = await page.evaluate(() => (window as any).editorHandle.current.getValue());
    expect(raw).toMatch(/^First line\n\nCompare /);
    expect(raw).toContain('/workspace/local-durable/ws');
    await editor.pressSequentially('more text');
    await editor.press('ControlOrMeta+a'); await editor.press('Backspace');
    expect(await page.evaluate(() => (window as any).editorHandle.current.getValue())).toBe('');
    await editor.press('ControlOrMeta+z');
    await expect(editor.locator('[contenteditable=false]')).toHaveCount(1);
});
