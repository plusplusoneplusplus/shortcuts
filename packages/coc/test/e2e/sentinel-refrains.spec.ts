import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

let script: string;
let css: string;
test.beforeAll(async () => {
    css = await readFile(path.resolve('src/server/spa/client/dist/bundle.css'), 'utf8');
    css += await readFile(path.resolve('src/server/spa/client/react/features/repo-detail/unified-right-panel/sentinelAutomationCard.css'), 'utf8');
    const result = await build({
        stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
            import React from 'react';
            import { createRoot } from 'react-dom/client';
            import { SentinelRefrains } from './src/server/spa/client/react/features/repo-detail/unified-right-panel/SentinelRefrains';
            import { UnifiedTodoTab } from './src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedTodoTab';
            import { applyRuntimeConfigPatch } from './src/server/spa/client/react/utils/config';
            import { registerCloneBaseUrls } from './src/server/spa/client/react/repos/cloneRegistry';
            const state = window.jobsFixture;
            const policy = { sentinelEnabled: true, sentinelTodoJobsEnabled: state.enabled, sentinelTodoScrubberEnabled: true };
            const diagnostic = 'Unsupported reasoning effort "medium" requested. ' + 'long-unbroken-diagnostic/'.repeat(80) + '\\nFull error ending';
            const jobs = state.seeded ? [
                { id: 'seed-1', name: 'New stable revision release', enabled: false, runs: [] },
                { id: 'seed-2', name: 'Implement feature or bug fix', enabled: false, runs: [{ id: 'failed', runNumber: 1, status: 'failed', error: diagnostic, createdAt: '2026-10-18T12:00:00Z', trigger: 'manual' }] },
                { id: 'seed-3', name: 'LongRefrainName'.repeat(30), enabled: true, activeRun: { id: 'active', runNumber: 2, status: 'running' }, runs: [], gateScript: 'return []', gatePaused: true },
            ].map(job => ({ revision: 1, provider: 'copilot', effortTier: 'medium', mode: 'autopilot', gateConsecutiveFailures: 0, processId: 'queue_job', ...job })) : [];
            if (state.history) {
                const makeRun = (runNumber, status, extra = {}) => ({ id: 'history-' + runNumber, runNumber, status, trigger: runNumber % 2 ? 'schedule' : 'manual',
                    createdAt: '2026-10-28T08:47:01.123Z', startedAt: '2026-10-28T08:47:02.456Z', finishedAt: '2026-10-28T08:48:53.789Z', durationMs: 112100,
                    jobTurnHref: '#repos/ws-owner/chats/queue_job?turn=' + runNumber + '&source=history', ...extra });
                jobs.splice(0, jobs.length, { id: 'history', name: 'New stable revision release', provider: 'copilot', effortTier: 'medium', mode: 'autopilot', enabled: true,
                    cron: '0 14 * * *', nextRunAt: '2026-10-29T14:00:00Z', revision: 1, processId: 'queue_job', gateConsecutiveFailures: 0,
                    runs: [makeRun(7, 'failed', { error: diagnostic }), makeRun(6, 'completed'), makeRun(5, 'cancelled'),
                        makeRun(4, 'skipped', { skipReason: 'gate-unavailable', error: diagnostic }), makeRun(3, 'interrupted'),
                        makeRun(2, 'running', { finishedAt: undefined, durationMs: undefined }), makeRun(1, 'queued', { startedAt: undefined, finishedAt: undefined, durationMs: undefined })] });
            }
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
                triggers: { listSentinelTodo: async () => ({ triggers: [] }) },
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
                        get: async () => ({ config: { ...scrub }, runs: state.seeded ? [{ id: 'coda-failed', status: 'failed', error: diagnostic, childProcessId: 'queue_coda', createdAt: at, deferredCount: 0, awaitingReviewCount: 0, counts: { done: 0, proposals: 0, unverified: 0 } }] : [] }),
                        updateConfig: async (ws, process, input) => { record('scrubber-config', ws, process); Object.assign(scrub, input); return scrub; },
                        start: async (ws, process) => { record('scrubber-start', ws, process); return { runId: 'scrub' }; },
                    },
                },
            };
            registerCloneBaseUrls(state.remote ? [{ workspaceId: 'ws-owner', baseUrl: 'https://owner.example.test' }] : []);
            applyRuntimeConfigPatch({ ...policy, triggersEnabled: false });
            const owner = { ownerWorkspaceId: 'ws-owner', ownerRoutingRef: state.remote ? 'ws-owner' : null, processId: 'queue_sentinel' };
            createRoot(document.getElementById('fixture')).render(state.seeded
                ? <SentinelRefrains owner={owner} items={[]} onFollowLink={(event, key) => { event.preventDefault(); state.followed = key; }} />
                : <UnifiedTodoTab scopeWorkspaceId="ws-owner" chatId="queue_sentinel" owner={owner} />);
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
async function mount(page: Page, { dark = false, width = 800, enabled = true, remote = false, seeded = false, history = false } = {}) {
    await page.route('http://jobs.fixture.test/**', route => route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }));
    await page.routeWebSocket(/.*/, () => {});
    await page.goto('http://jobs.fixture.test/');
    await page.setViewportSize({ width: Math.max(360, width + 32), height: 900 });
    await page.setContent(`<html class="${dark ? 'dark' : ''}"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
        <body style="margin:0;background:${dark ? '#1e1e1e' : 'white'};color:${dark ? '#cccccc' : '#1e1e1e'}">
        <div id="fixture" style="width:${width}px;height:820px;margin:8px"></div></body></html>`);
    await page.evaluate(values => {
        Object.assign(window, { jobsFixture: { ...values, calls: [], refs: [] } });
    }, { enabled, remote, seeded, history });
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: script });
    if (!seeded) {
        await expect(page.getByTestId('sentinel-todo-row-item')).toBeVisible();
        expect(await page.getByTestId('sentinel-todo-tab').evaluate(element => getComputedStyle(element).display)).toBe('flex');
    }
}
for (const dark of [false, true]) {
    for (const width of [320, 800]) {
        test(`Refrains create, run and cancel fits ${width}px in ${dark ? 'dark' : 'light'} theme`, async ({ page }, info) => {
            const errors: string[] = [];
            page.on('pageerror', error => errors.push(error.message));
            page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
            await mount(page, { dark, width });
            const jobs = page.getByRole('region', { name: 'Refrains', exact: true });
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
            await job.getByLabel('More actions for Browser audit').click();
            await job.getByRole('button', { name: 'Delete', exact: true }).click();
            await page.getByRole('dialog', { name: 'Delete refrain' }).getByRole('button', { name: 'Delete refrain', exact: true }).click();
            await expect(jobs.getByText(/No refrains yet/)).toBeVisible();
            expect(errors).toEqual([]);
        });
    }
}
test('flag-off keeps the Coda strip and makes no Refrains calls', async ({ page }) => {
    await mount(page, { enabled: false });
    await expect(page.getByRole('button', { name: 'Run now' })).toBeVisible();
    await expect(page.getByTestId('sentinel-refrains')).toHaveCount(0);
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

for (const dark of [false, true]) {
    for (const width of [280, 800]) {
        test(`compact cards, keyboard disclosures and full errors fit ${width}px ${dark ? 'dark' : 'light'}`, async ({ page }, info) => {
            const errors: string[] = [];
            page.on('pageerror', error => errors.push(error.message));
            page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
            await mount(page, { dark, width, seeded: true });
            const coda = page.getByTestId('sentinel-coda-strip');
            const job = page.getByTestId('sentinel-refrain-seed-2');
            await expect(job.getByRole('button', { name: 'Run now' })).toBeVisible();
            await expect(job.getByText('Paused', { exact: true })).toBeVisible();
            await expect(page.getByText('Gate paused after', { exact: false })).toBeVisible();
            for (const card of [coda, ...await page.getByRole('article').all()]) {
                expect(await card.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
            }
            await info.attach('card-bounds', { body: JSON.stringify({ coda: await coda.boundingBox(), refrain: await job.boundingBox() }), contentType: 'application/json' });
            if (width === 800) {
                expect((await coda.boundingBox())!.height).toBeLessThan(120);
                expect((await job.boundingBox())!.height).toBeLessThan(120);
            }
            const more = job.getByLabel('More actions for Implement feature or bug fix');
            for (const control of [job.getByRole('button', { name: 'Run now' }), job.getByRole('button', { name: 'Resume', exact: true }), more]) {
                expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(width < 768 ? 44 : 32);
            }
            await expect(job.getByRole('button', { name: 'Edit', exact: true })).toBeHidden();
            await more.focus();
            await page.keyboard.press('Enter');
            await expect(job.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
            await page.keyboard.press('Tab');
            await expect(job.getByRole('button', { name: 'Edit', exact: true })).toBeFocused();
            await page.keyboard.press('Escape');
            await expect(more).toBeFocused();
            await expect(job.getByRole('button', { name: 'Edit', exact: true })).toBeHidden();
            await page.keyboard.press('Space');
            const history = job.getByText('History (1)', { exact: true });
            await expect(history.locator('..')).not.toHaveAttribute('open', '');
            await history.focus();
            await page.keyboard.press('Enter');
            await expect(job.getByLabel('Details for run #1: failed (manual)')).toBeVisible();
            await history.press('Enter');
            await more.press('Escape');
            for (const card of [job, coda]) {
                const summary = card.locator('.sentinel-automation-error > summary');
                await summary.focus();
                await summary.press('Enter');
                const full = card.getByLabel('Full error', { exact: true });
                await expect(full).toBeVisible();
                await expect(full).toContainText('Full error ending');
                await page.keyboard.press('Tab');
                await expect(full).toBeFocused();
                // The whole diagnostic can be selected for native Copy, including its ending.
                expect(await full.evaluate(el => {
                    const range = document.createRange(); range.selectNodeContents(el);
                    const selection = window.getSelection(); if (!selection) return false;
                    selection.removeAllRanges(); selection.addRange(range);
                    return selection.toString() === el.textContent;
                })).toBe(true);
                expect(await card.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
                await summary.press('Space');
                await expect(full).toBeHidden();
            }
            const codaMore = coda.getByLabel('More actions for Coda');
            await codaMore.focus();
            await codaMore.press('Space');
            for (const name of ['Schedule ▾', 'Select items', 'History (1)']) await expect(coda.getByRole('button', { name, exact: true })).toBeVisible();
            await expect(coda.getByRole('link', { name: 'Open chat' })).toBeVisible();
            await codaMore.press('Escape');
            await expect(codaMore).toBeFocused();
            await coda.scrollIntoViewIfNeeded();
            await page.screenshot({ path: info.outputPath('compact-refrains.png'), fullPage: true });
            const calls = await page.evaluate(() => (window as Window & { jobsFixture: { calls: string[][] } }).jobsFixture.calls);
            expect(calls.every(call => call[0] === 'list')).toBe(true);
            expect(errors).toEqual([]);
        });
    }
}

for (const dark of [false, true]) {
    for (const width of [280, 800]) {
        test(`dense run history and multiple details fit ${width}px ${dark ? 'dark' : 'light'}`, async ({ page }, info) => {
            const errors: string[] = [];
            page.on('pageerror', error => errors.push(error.message));
            page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
            await mount(page, { dark, width, seeded: true, history: true, remote: true });
            const job = page.getByRole('article', { name: 'New stable revision release' });
            const history = job.getByText('History (7)', { exact: true });
            await history.focus();
            await history.press('Enter');
            const list = job.getByRole('list', { name: 'Run history for New stable revision release' });
            const rows = list.getByRole('listitem');
            await expect(rows).toHaveCount(7);
            for (const row of await rows.all()) {
                const summary = row.locator('summary');
                expect((await row.boundingBox())!.height).toBeLessThanOrEqual(width === 800 ? 40 : 48);
                expect((await summary.boundingBox())!.height).toBeGreaterThanOrEqual(width === 800 ? 32 : 44);
                expect(await row.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
                const link = row.getByRole('link', { name: 'Job turn' });
                await expect(link).toBeVisible();
                expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(width === 800 ? 32 : 44);
            }
            await expect(job.getByLabel('Last run #7: failed. Show full error')).toHaveCount(0);
            await expect(job.getByText(/copilot \/ medium effort tier/)).toContainText('Next');
            await page.screenshot({ path: info.outputPath('compact-run-history.png'), fullPage: true });
            const failed = list.getByRole('listitem', { name: 'Run #7', exact: true });
            const completed = list.getByRole('listitem', { name: 'Run #6', exact: true });
            const skipped = list.getByRole('listitem', { name: 'Run #4', exact: true });
            const firstSummary = failed.locator('summary');
            await firstSummary.focus();
            await firstSummary.press('Space');
            const error = failed.getByRole('region', { name: 'Error for run #7', exact: true });
            await expect(error).toBeVisible();
            await expect(error).toContainText('Full error ending');
            for (const timestamp of ['2026-10-28T08:47:01.123Z', '2026-10-28T08:47:02.456Z', '2026-10-28T08:48:53.789Z']) await expect(failed.getByText(timestamp)).toBeVisible();
            await firstSummary.press('Tab');
            await expect(error).toBeFocused();
            expect(await error.evaluate(el => {
                const range = document.createRange(); range.selectNodeContents(el);
                const selection = window.getSelection(); if (!selection) return false;
                selection.removeAllRanges(); selection.addRange(range);
                return selection.toString() === el.textContent;
            })).toBe(true);
            await completed.locator('summary').focus();
            await completed.locator('summary').press('Enter');
            await expect(completed.getByText('Finished', { exact: true })).toBeVisible();
            await expect(failed.locator('details')).toHaveAttribute('open', '');
            for (const row of [failed, completed]) expect(await row.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
            await page.screenshot({ path: info.outputPath('multiple-run-details.png'), fullPage: true });
            const link = completed.getByRole('link', { name: 'Job turn' });
            await expect(link).toHaveAttribute('href', '#repos/ws-owner/chats/queue_job?turn=6&source=history');
            await link.focus();
            await link.press('Enter');
            expect(await page.evaluate(() => (window as Window & { jobsFixture: { followed: string } }).jobsFixture.followed)).toBe('sentinel-job:queue_job:?turn=6&source=history');
            await firstSummary.focus();
            await firstSummary.press('Escape');
            await expect(firstSummary).toBeFocused();
            await expect(error).toBeHidden();
            await expect(completed.locator('details')).toHaveAttribute('open', '');
            await skipped.locator('summary').focus();
            await skipped.locator('summary').press('Enter');
            await expect(skipped.getByText('Skipped: gate unavailable (tool scripting off)')).toBeVisible();
            await expect(skipped.getByRole('region', { name: 'Error for run #4', exact: true })).toContainText('Full error ending');
            expect(await job.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
            await history.focus();
            await history.press('Space');
            await expect(list).toBeHidden();
            await expect(job.getByLabel('Last run #7: failed. Show full error')).toBeVisible();
            const calls = await page.evaluate(() => (window as Window & { jobsFixture: { calls: string[][] } }).jobsFixture.calls);
            expect(calls.every(call => call[0] === 'list')).toBe(true);
            expect(errors).toEqual([]);
        });
    }
}
