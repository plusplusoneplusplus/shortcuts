import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// Real hint, live flag hook and built CSS; no server/settings writes.
let script: string;
let css: string;
test.beforeAll(async () => {
    css = await readFile(path.resolve('src/server/spa/client/dist/bundle.css'), 'utf8');
    const result = await build({
        stdin: {
            resolveDir: process.cwd(), loader: 'tsx', contents: `
                import React from 'react';
                import { createRoot } from 'react-dom/client';
                import { SchedulerDelayHint, schedulerDelayLabel } from './src/server/spa/client/react/features/chat/SchedulerDelayHint';
                import { useSchedulerDelayHintEnabled } from './src/server/spa/client/react/hooks/feature-flags/useSchedulerDelayHintEnabled';
                import { applyRuntimeConfigPatch } from './src/server/spa/client/react/utils/config';
                window.flag = enabled => applyRuntimeConfigPatch({ schedulerDelayHintEnabled: enabled });
                window.flag(true);
                function Fixture() {
                    const enabled = useSchedulerDelayHintEnabled();
                    const [minutes, setMinutes] = React.useState({ all: 15, autopilot: 7 });
                    window.delays = setMinutes;
                    return <div id="toolbar" className="scheduler-delay-toolbar" style={{ width: '100%' }}>
                        <div className="inline-flex h-7 rounded-md border bg-white dark:bg-[#1e1e1e]">
                            {['all', 'autopilot'].map(scope => {
                                const label = enabled && schedulerDelayLabel(minutes[scope], scope);
                                return <button key={scope} title={label || undefined} aria-label={label || undefined}
                                    className="inline-flex items-center gap-1.5 px-2" data-scope={scope}>
                                    <span className="w-[7px] h-[7px] rounded-full bg-emerald-500" />
                                    <span className="text-[10px] font-mono text-emerald-700 dark:text-emerald-400">{scope === 'all' ? 'ALL' : 'AP'}</span>
                                    {label && <SchedulerDelayHint minutes={minutes[scope]} scope={scope} />}
                                </button>;
                            })}
                        </div>
                    </div>;
                }
                createRoot(document.getElementById('fixture')).render(<Fixture />);
            `,
        },
        bundle: true, write: false, format: 'iife', platform: 'browser', loader: { '.css': 'empty' },
    });
    script = result.outputFiles[0].text;
});

for (const theme of ['light', 'dark']) {
    test(`${theme}: compact hint retains accessible interval and responds to live changes`, async ({ page }, testInfo) => {
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setViewportSize({ width: 800, height: 200 });
        await page.setContent(`<html data-theme="${theme}" class="${theme}"><body><div id="fixture"></div></body></html>`);
        await page.addStyleTag({ content: css });
        await page.addScriptTag({ content: script });
        const hint = page.getByTestId('scheduler-delay-hint-all');
        await expect(hint.locator('.scheduler-delay-interval')).toBeVisible();
        await expect(page.locator('[data-scope="all"]')).toHaveAccessibleName('Delay between tasks: 15 minutes (ALL scope: all tasks)');
        const color = await hint.evaluate(el => getComputedStyle(el).color);
        expect(color).toBe(theme === 'dark' ? 'rgb(176, 176, 176)' : 'rgb(96, 96, 96)');
        await page.screenshot({ path: testInfo.outputPath(`${theme}-wide.png`) });
        await page.setViewportSize({ width: 240, height: 200 });
        await expect(hint).toBeVisible();
        await expect(hint.locator('svg')).toBeVisible();
        await expect(hint.locator('.scheduler-delay-interval')).toBeHidden();
        await expect(page.locator('[data-scope="autopilot"]')).toHaveAccessibleName('Delay between tasks: 7 minutes (AP scope: autopilot tasks)');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: testInfo.outputPath(`${theme}-compact.png`) });
        await page.evaluate(() => (window as any).delays({ all: 0, autopilot: 90 }));
        await expect(hint).toHaveCount(0);
        await expect(page.locator('[data-scope="autopilot"]')).toHaveAttribute('title', 'Delay between tasks: 90 minutes (AP scope: autopilot tasks)');
        await page.evaluate(() => (window as any).flag(false));
        await expect(page.getByTestId('scheduler-delay-hint-autopilot')).toHaveCount(0);
        expect(errors).toEqual([]);
    });
}
