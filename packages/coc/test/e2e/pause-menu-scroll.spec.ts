import { test, expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Exercise the real private menu and stylesheet without a server or queue writes.
let script: string;
let css: string;
test.beforeAll(async () => {
    css = await readFile(path.resolve('src/server/spa/client/dist/bundle.css'), 'utf8');
    const result = await build({
        stdin: {
            resolveDir: process.cwd(), loader: 'tsx', contents: `
                import React from 'react';
                import { createRoot } from 'react-dom/client';
                import { PauseDurationMenu } from './src/server/spa/client/react/features/chat/ChatListPane';
                const quotaData = { providers: ['copilot', 'codex', 'claude'].map((id, i) => ({
                    id, quotaTypes: [{ type: 'seven_day', remainingPercentage: 0.2 + i * 0.1,
                        resetDate: new Date(Date.now() + (i + 1) * 86400000).toISOString() }]
                })) };
                function Fixture() {
                    const [scope, setScope] = React.useState(null);
                    const [workspace, setWorkspace] = React.useState('workspace-a');
                    const allRef = React.useRef(null);
                    const apRef = React.useRef(null);
                    const insertRef = React.useRef(null);
                    const record = value => { window.actions.push({ workspace, ...value }); setScope(null); };
                    return <>
                        <button id="workspace" onClick={() => { setWorkspace('workspace-b'); setScope(null); }}>Switch workspace</button>
                        <div id="split" style={{ height: '55vh', width: 'min(280px, 100vw)', overflow: 'hidden', borderBottom: '4px solid gray' }}>
                            <div id="pane" style={{ height: '100%', overflow: 'auto' }}>
                                <div style={{ height: 90 }} />
                                <div id="anchor" style={{ position: 'relative', display: 'flex', justifyContent: 'flex-end' }}>
                                    <button ref={allRef} id="all" onClick={() => setScope(scope === 'all' ? null : 'all')}>ALL</button>
                                    <button ref={apRef} id="autopilot" onClick={() => setScope(scope === 'autopilot' ? null : 'autopilot')}>AP</button>
                                    <button ref={insertRef} id="insert" onClick={() => setScope('insert')}>Insert</button>
                                    {scope && <PauseDurationMenu key={scope} testIdScope={scope}
                                        anchorRef={scope === 'all' ? allRef : scope === 'autopilot' ? apRef : insertRef}
                                        onClose={() => setScope(null)} quotaData={quotaData}
                                        sections={(scope === 'insert' ? ['all', 'autopilot'] : [scope]).map(s => ({
                                            label: scope === 'insert' ? 'Pause ' + s : undefined,
                                            testIdScope: scope === 'insert' ? 'insert-' + s : s,
                                            onSelect: options => record({ pause: s, options })
                                        }))}
                                        taskDelay={scope === 'insert' ? undefined : { scope, pending: true,
                                            onSelect: async minutes => record({ delay: scope, minutes }),
                                            onSkip: async () => record({ skip: scope }) }} />}
                                </div>
                                <div style={{ height: 1200 }}>Underlying chat list</div>
                            </div>
                        </div>
                        <div id="git">Git pane</div>
                        <div style={{ height: 1600 }}>Underlying document</div>
                    </>;
                }
                window.actions = [];
                createRoot(document.getElementById('fixture')).render(<Fixture />);
            `,
        },
        bundle: true, write: false, format: 'iife', platform: 'browser',
        loader: { '.css': 'empty' },
        plugins: [{
            name: 'private-pause-menu',
            setup(builder) {
                builder.onLoad({ filter: /[/\\]ChatListPane\.tsx$/ }, async args => ({
                    contents: `${await readFile(args.path, 'utf8')}\nexport { PauseDurationMenu };`,
                    loader: 'tsx', resolveDir: path.dirname(args.path),
                }));
            },
        }],
    });
    script = result.outputFiles[0].text;
});

async function mount(page: Page) {
    await page.setContent('<div id="fixture"></div>');
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: script });
    await expect(page.locator('#all')).toBeVisible();
}

async function metrics(menu: Locator) {
    return menu.evaluate(el => {
        const rect = el.getBoundingClientRect();
        const viewport = window.visualViewport;
        return {
            top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right,
            height: el.clientHeight, scrollHeight: el.scrollHeight,
            width: el.clientWidth, scrollWidth: el.scrollWidth, scrollTop: el.scrollTop,
            overflowY: getComputedStyle(el).overflowY,
            portaled: el.parentElement === document.body,
            viewport: {
                left: viewport?.offsetLeft ?? 0, top: viewport?.offsetTop ?? 0,
                width: viewport?.width ?? window.innerWidth, height: viewport?.height ?? window.innerHeight,
            },
        };
    });
}

async function expectFits(menu: Locator) {
    await expect.poll(async () => {
        const m = await metrics(menu);
        const viewport = m.viewport;
        return m.top >= viewport.top + 7 && m.bottom <= viewport.top + viewport.height - 7
            && m.left >= viewport.left + 7 && m.right <= viewport.left + viewport.width - 7
            && m.scrollWidth <= m.width + 1;
    }).toBe(true);
}

async function capture(page: Page, menu: Locator, testInfo: TestInfo, name: string) {
    const layout = testInfo.outputPath(`${name}.json`);
    await writeFile(layout, JSON.stringify(await metrics(menu), null, 2));
    await testInfo.attach(`${name}-layout`, { path: layout, contentType: 'application/json' });
    const image = testInfo.outputPath(`${name}.png`);
    await page.screenshot({ path: image });
    await testInfo.attach(name, { path: image, contentType: 'image/png' });
}

for (const scope of ['all', 'autopilot', 'insert']) {
    test(`${scope}: constrained menu escapes split and owns native wheel scrolling`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width: 360, height: 480 });
        await mount(page);
        await page.locator(`#${scope}`).click();
        const menu = page.getByTestId(`pause-duration-menu-${scope}`);
        await expect(menu).toBeVisible();
        await capture(page, menu, testInfo, 'initial-menu');
        await expectFits(menu);
        const initial = await metrics(menu);
        expect(initial.portaled).toBe(true);
        expect(initial.scrollHeight).toBeGreaterThan(initial.height);
        expect(initial.overflowY).toBe('auto');
        const splitBottom = await page.locator('#split').evaluate(el => el.getBoundingClientRect().bottom);
        expect(initial.bottom).toBeGreaterThan(splitBottom);
        const box = (await menu.boundingBox())!;
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.wheel(0, -2000);
        await page.waitForTimeout(150);
        expect(await page.locator('#pane').evaluate(el => el.scrollTop)).toBe(0);
        expect(await page.evaluate(() => window.scrollY)).toBe(0);
        await page.mouse.wheel(0, 2000);
        await expect.poll(async () => (await metrics(menu)).scrollTop).toBeGreaterThan(0);
        const last = page.getByTestId(scope === 'insert'
            ? 'pause-duration-insert-autopilot-until-all-recover' : `task-delay-${scope}-custom`);
        await expect(last).toBeInViewport();
        // At the bottom, further wheel input must not chain into either pane.
        await page.mouse.wheel(0, 2000);
        await page.waitForTimeout(150);
        expect(await page.locator('#pane').evaluate(el => el.scrollTop)).toBe(0);
        expect(await page.evaluate(() => window.scrollY)).toBe(0);
        await capture(page, menu, testInfo, 'scrolled-menu');
        if (scope !== 'insert') {
            await last.click();
            const input = page.getByTestId(`task-delay-${scope}-custom-input`);
            await expect(input).toBeFocused();
            await input.fill('17');
            await input.press('Enter');
            await expect(menu).toHaveCount(0);
            expect(await page.evaluate(() => Reflect.get(window, 'actions'))).toEqual([
                { workspace: 'workspace-a', delay: scope, minutes: 17 },
            ]);
        }
    });
}

test('resize, narrow layouts, enlarged text, keyboard and workspace actions', async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width: 1200, height: 1000 });
    await mount(page);
    await page.locator('#all').click();
    const menu = page.getByTestId('pause-duration-menu-all');
    await expectFits(menu);
    const large = await metrics(menu);
    expect(large.scrollHeight).toBe(large.height);
    await capture(page, menu, testInfo, 'large-menu');
    await page.locator('#split').evaluate(el => { el.style.width = '400px'; });
    await expect.poll(async () => (await metrics(menu)).right).toBeGreaterThan(large.right + 100);
    await expect.poll(async () => {
        const triggerRight = await page.locator('#all').evaluate(el => el.getBoundingClientRect().right);
        return Math.abs((await metrics(menu)).right - triggerRight);
    }).toBeLessThanOrEqual(1);
    await page.locator('#split').evaluate(el => { el.style.width = 'min(280px, 100vw)'; });
    await expect.poll(async () => (await metrics(menu)).right).toBeCloseTo(large.right, 0);
    for (const viewport of [{ width: 280, height: 320 }, { width: 220, height: 480 }, { width: 1200, height: 1000 }]) {
        await page.setViewportSize(viewport);
        await expectFits(menu);
        await capture(page, menu, testInfo, `resized-${viewport.width}-${viewport.height}`);
    }
    await page.addStyleTag({ content: 'html { font-size: 24px; }' });
    await page.setViewportSize({ width: 280, height: 400 });
    await expectFits(menu);
    await page.getByTestId('pause-duration-all-indefinite').focus();
    const buttons = await menu.locator('button').count();
    for (let i = 1; i < buttons; i++) await page.keyboard.press('Tab');
    await expect(page.getByTestId('task-delay-all-custom')).toBeFocused();
    await expect(page.getByTestId('task-delay-all-custom')).toBeInViewport();
    await capture(page, menu, testInfo, 'narrow-enlarged-menu');
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(page.locator('#all')).toBeFocused();
    await page.locator('#autopilot').click();
    await page.locator('#git').click();
    await expect(page.getByTestId('pause-duration-menu-autopilot')).toHaveCount(0);
    await page.locator('#workspace').click();
    await page.locator('#autopilot').click();
    await page.getByTestId('pause-duration-autopilot-1h').click();
    expect(await page.evaluate(() => Reflect.get(window, 'actions'))).toEqual([
        { workspace: 'workspace-b', pause: 'autopilot', options: { durationHours: 1 } },
    ]);
    expect(errors).toEqual([]);
});

test('touch scrolling and pinch zoom keep every option reachable', async ({ browser }, testInfo) => {
    const context = await browser.newContext({ viewport: { width: 360, height: 480 }, hasTouch: true });
    const page = await context.newPage();
    try {
        await mount(page);
        await page.locator('#all').tap();
        const menu = page.getByTestId('pause-duration-menu-all');
        await expectFits(menu);
        const box = (await menu.boundingBox())!;
        const cdp = await context.newCDPSession(page);
        // Native touch input, not synthetic DOM events or assigned scrollTop.
        const swipe = async () => {
            const x = box.x + box.width / 2;
            const start = box.y + box.height - 24;
            const distance = box.height - 48;
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: start }] });
            for (let step = 1; step <= 10; step++) {
                await cdp.send('Input.dispatchTouchEvent', {
                    type: 'touchMove', touchPoints: [{ x, y: start - distance * step / 10 }],
                });
                await page.waitForTimeout(20);
            }
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        };
        await swipe();
        await expect.poll(async () => (await metrics(menu)).scrollTop).toBeGreaterThan(0);
        await swipe();
        await expect(page.getByTestId('task-delay-all-custom')).toBeInViewport();
        await swipe();
        expect(await page.locator('#pane').evaluate(el => el.scrollTop)).toBe(0);
        expect(await page.evaluate(() => window.scrollY)).toBe(0);
        await capture(page, menu, testInfo, 'touch-scrolled-menu');
        await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1.5 });
        await expectFits(menu);
        expect((await metrics(menu)).viewport.width).toBeLessThan(360);
        await capture(page, menu, testInfo, 'pinch-zoom-menu');
        await page.getByTestId('task-delay-all-custom').tap();
        await expect(page.getByTestId('task-delay-all-custom-input')).toBeFocused();
        await expectFits(menu);
        await page.locator('#workspace').tap();
        await expect(menu).toHaveCount(0);
        expect(await page.evaluate(() => Reflect.get(window, 'actions'))).toEqual([]);
    } finally {
        await context.close();
    }
});
