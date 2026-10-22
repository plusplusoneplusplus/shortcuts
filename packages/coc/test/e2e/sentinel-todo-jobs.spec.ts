import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

let script: string;
let css: string;
test.beforeAll(async () => {
    css = await readFile(path.resolve('src/server/spa/client/dist/bundle.css'), 'utf8');
    const result = await build({
        stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
            import React from 'react';
            import { createRoot } from 'react-dom/client';
            import { UnifiedTodoTab } from './src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedTodoTab';
            import { applyRuntimeConfigPatch } from './src/server/spa/client/react/utils/config';
            import { registerCloneBaseUrls } from './src/server/spa/client/react/repos/cloneRegistry';
            const state = window.jobsFixture;
            const policy = { sentinelEnabled: true, sentinelTodoJobsEnabled: state.enabled, sentinelTodoScrubberEnabled: true };
            const jobs = [];
            const calls = state.calls;
            const at = '2026-10-18T12:00:00Z';
            const scrub = { enabled: true, cron: '0 9 * * *', paused: false, consecutiveFailures: 0, revision: 1 };
            const item = { id: 'item', title: 'Tracked work', notes: '', completionCondition: '',
                status: 'todo', priority: 'regular', type: 'normal', archived: false, revision: 1,
                createdAt: at, updatedAt: at, createdBy: 'sentinel', updatedBy: 'sentinel', jobs: [] };
            const record = (action, workspace, process) => calls.push([action, workspace, process]);
            const find = id => jobs.find(job => job.id === id);
            window.fakeClient = {
                request: async () => ({ features: policy }),
                agentProviders: { getEffortTiers: async () => ({ effortTiers: {}, defaults: {} }) },
                events: { connect: () => ({ close() {} }) },
                sentinelTodos: {
                    get: async () => ({ revision: 1, items: [item] }),
                    jobs: {
                        list: async (ws, process) => { record('list', ws, process); return { jobs: jobs.map(job => ({ ...job })) }; },
                        create: async (ws, process, input) => { record('create', ws, process);
                            const job = { ...input, id: 'job-' + (jobs.length + 1), revision: 1, processId: 'queue_job', runs: [],
                                gateConsecutiveFailures: 0, gatePaused: false };
                            jobs.push(job); return job; },
                        update: async (ws, process, id, input) => { record('update', ws, process);
                            return Object.assign(find(id), input, { revision: find(id).revision + 1 }); },
                        delete: async (ws, process, id) => { record('delete', ws, process); jobs.splice(jobs.findIndex(job => job.id === id), 1); },
                        start: async (ws, process, id) => { record('start', ws, process);
                            const run = { id: 'run', runNumber: 1, status: 'running', trigger: 'manual', createdAt: at };
                            Object.assign(find(id), { activeRun: run, runs: [run] }); return run; },
                        cancel: async (ws, process, id) => { record('cancel', ws, process);
                            const job = find(id); const run = { ...job.activeRun, status: 'cancelled', error: 'Cancelled by user' };
                            delete job.activeRun; job.runs = [run]; return run; },
                        testGate: async (ws, process) => { record('test-gate', ws, process);
                            return { ok: true, empty: false, result: JSON.stringify({ items: Array.from({ length: 120 }, (_, i) => 'item-' + i) }) }; },
                    },
                    scrubber: {
                        get: async () => ({ config: { ...scrub }, runs: [] }),
                        updateConfig: async (ws, process, input) => { record('scrubber-config', ws, process); Object.assign(scrub, input); return scrub; },
                        start: async (ws, process) => { record('scrubber-start', ws, process); return { runId: 'scrub' }; },
                    },
                },
            };
            registerCloneBaseUrls(state.remote ? [{ workspaceId: 'ws-owner', baseUrl: 'https://owner.example.test' }] : []);
            applyRuntimeConfigPatch({ ...policy, triggersEnabled: false });
            createRoot(document.getElementById('fixture')).render(<UnifiedTodoTab scopeWorkspaceId="ws-owner" chatId="queue_sentinel"
                owner={{ ownerWorkspaceId: 'ws-owner', ownerRoutingRef: state.remote ? 'ws-owner' : null, processId: 'queue_sentinel' }} />);
        ` },
        bundle: true, write: false, jsx: 'automatic', format: 'iife', platform: 'browser', loader: { '.css': 'empty' },
        plugins: [{ name: 'jobs-fixture-client', setup(builder) {
            builder.onLoad({ filter: /[/\\]cloneRouting\.ts$/ }, () => ({
                contents: 'export const useCocClient = ref => { window.jobsFixture.refs.push(ref); return window.fakeClient; };', loader: 'ts',
            }));
            builder.onLoad({ filter: /[/\\]useProviderModels\.ts$/ }, () => ({
                contents: 'export const useProviderModels = () => ({ models: [{ id: "test-model", name: "Test model", enabled: true }], loading: false, error: null, reload() {} });', loader: 'ts',
            }));
            builder.onLoad({ filter: /[/\\]ReposContext\.tsx$/ }, () => ({
                contents: 'export const useReposOptional = () => null;', loader: 'ts',
            }));
            builder.onLoad({ filter: /[/\\]AppContext\.tsx$/ }, () => ({
                contents: 'export const useAppOptional = () => null; export const useApp = () => ({ state: { workspaces: [] } });', loader: 'ts',
            }));
        } }],
    });
    script = result.outputFiles[0].text;
});
async function mount(page: Page, { dark = false, width = 800, enabled = true, remote = false } = {}) {
    await page.route('http://jobs.fixture.test/**', route => route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }));
    await page.routeWebSocket(/.*/, () => {});
    await page.goto('http://jobs.fixture.test/');
    await page.setViewportSize({ width: Math.max(360, width + 32), height: 900 });
    await page.setContent(`<html class="${dark ? 'dark' : ''}"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
        <body style="margin:0;background:${dark ? '#1e1e1e' : 'white'}">
        <div id="fixture" style="width:${width}px;height:820px;margin:8px"></div></body></html>`);
    await page.evaluate(values => {
        Object.assign(window, { jobsFixture: { ...values, calls: [], refs: [] } });
    }, { enabled, remote });
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: script });
    await expect(page.getByTestId('sentinel-todo-row-item')).toBeVisible();
    expect(await page.getByTestId('sentinel-todo-tab').evaluate(element => getComputedStyle(element).display)).toBe('flex');
}
for (const dark of [false, true]) {
    for (const width of [320, 800]) {
        test(`Jobs create, run and cancel fits ${width}px in ${dark ? 'dark' : 'light'} theme`, async ({ page }, info) => {
            const errors: string[] = [];
            page.on('pageerror', error => errors.push(error.message));
            page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
            await mount(page, { dark, width });
            const jobs = page.getByRole('region', { name: 'Jobs', exact: true });
            await expect(jobs.getByText('Coda · built-in')).toBeVisible();
            await jobs.getByRole('button', { name: 'New refrain' }).click();
            const dialog = page.getByRole('dialog', { name: 'New refrain', exact: true });
            await expect(dialog.getByLabel('Name', { exact: true })).toBeFocused();
            await dialog.getByLabel('Name', { exact: true }).fill('Browser audit');
            await dialog.getByLabel('Instructions').fill('Review the fresh read-only snapshot.');
            await dialog.getByLabel('Model', { exact: true }).fill('test-model');
            await dialog.getByLabel('Mode', { exact: true }).selectOption('autopilot');
            await expect(dialog.getByText(/Autopilot can change files/)).toBeVisible();
            await dialog.getByLabel('Schedule preset').selectOption('0 */6 * * *');
            expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
            await dialog.getByRole('button', { name: 'Create refrain' }).click();
            const job = jobs.getByRole('article', { name: 'Browser audit' });
            await expect(job).toBeVisible();
            await expect(job.getByText('Autopilot', { exact: true })).toBeVisible();
            expect(await job.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
            await job.getByRole('button', { name: 'Run now' }).click();
            await expect(job.getByText('Run #1 running')).toBeVisible();
            await expect(job.getByRole('button', { name: 'Run now' })).toBeDisabled();
            await job.getByRole('button', { name: 'Cancel', exact: true }).click();
            await expect(job.getByText(/Last run #1: cancelled/)).toBeVisible();
            await job.getByRole('button', { name: 'Pause', exact: true }).click();
            await expect(job.getByText('Paused', { exact: true })).toBeVisible();
            await page.screenshot({ path: info.outputPath('sentinel-jobs.png'), fullPage: true });
            await job.getByRole('button', { name: 'Delete', exact: true }).click();
            await page.getByRole('dialog', { name: 'Delete refrain' }).getByRole('button', { name: 'Delete refrain', exact: true }).click();
            await expect(jobs.getByText(/No refrains yet/)).toBeVisible();
            expect(errors).toEqual([]);
        });
    }
}
test('flag-off keeps the Scrubber strip and makes no Jobs calls', async ({ page }) => {
    await mount(page, { enabled: false });
    await expect(page.getByRole('button', { name: 'Run now' })).toBeVisible();
    await expect(page.getByTestId('sentinel-todo-jobs')).toHaveCount(0);
    expect(await page.evaluate(() => (window as Window & { jobsFixture: { calls: unknown[] } }).jobsFixture.calls)).toEqual([]);
});
test('remote owner routes job creation to its own workspace and Sentinel', async ({ page }) => {
    await mount(page, { remote: true });
    await page.getByRole('button', { name: 'New refrain' }).click();
    const dialog = page.getByRole('dialog', { name: 'New refrain', exact: true });
    await dialog.getByLabel('Name', { exact: true }).fill('Remote audit');
    await dialog.getByLabel('Instructions').fill('Review the remote snapshot.');
    await dialog.getByLabel('Model', { exact: true }).fill('test-model');
    await dialog.getByRole('button', { name: 'Create refrain' }).click();
    await expect(page.getByRole('article', { name: 'Remote audit' })).toBeVisible();
    const calls = await page.evaluate(() => (window as Window & { jobsFixture: { calls: unknown[][] } }).jobsFixture.calls);
    expect(calls).toContainEqual(['create', 'ws-owner', 'queue_sentinel']);
    expect(calls.every(call => call[1] === 'ws-owner' && call[2] === 'queue_sentinel')).toBe(true);
});
test('gated job requires a schedule and shows Test gate results inline at 320px', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await mount(page, { width: 320 });
    await page.getByRole('button', { name: 'New refrain' }).click();
    const dialog = page.getByRole('dialog', { name: 'New refrain', exact: true });
    await dialog.getByLabel('Name', { exact: true }).fill('Gated audit');
    await dialog.getByLabel('Instructions').fill('Review the gate result.');
    await dialog.getByLabel('Model', { exact: true }).fill('test-model');
    await dialog.getByLabel('Gate script (optional)').fill('return { items: [1] };');
    await expect(dialog.getByText('A gate script needs a cron schedule.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Create refrain' })).toBeDisabled();
    await dialog.getByLabel('Schedule preset').selectOption('0 */6 * * *');
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await dialog.getByRole('button', { name: 'Create refrain' }).click();
    const job = page.getByRole('article', { name: 'Gated audit' });
    await expect(job.getByText('Gate active')).toBeVisible();
    await job.getByRole('button', { name: 'Test gate' }).click();
    await expect(job.getByText(/a tick would start a run/)).toBeVisible();
    await expect(job.getByText(/item-119/)).toBeVisible();
    expect(await job.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    const calls = await page.evaluate(() => (window as Window & { jobsFixture: { calls: unknown[][] } }).jobsFixture.calls);
    expect(calls).toContainEqual(['test-gate', 'ws-owner', 'queue_sentinel']);
    expect(calls.some(call => call[0] === 'start')).toBe(false);
    expect(errors).toEqual([]);
});
