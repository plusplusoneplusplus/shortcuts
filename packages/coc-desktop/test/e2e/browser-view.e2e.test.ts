/**
 * End-to-end test for the browser tab host in a REAL Electron instance with
 * local HTTP fixture servers: open/refuse, link navigation, redirects,
 * in-page URL changes, history, stop/reload, failure + retry, new-window links,
 * sign-in pop-ups, session sharing/isolation, download handoff, visibility,
 * close cleanup and restart. The scenario lives in `browser-view-runner.cjs`
 * (an Electron app main script that emits one `E2E::{json}` line per step);
 * this file spawns it and asserts.
 *
 * Environment gates match html-page.e2e.test.ts:
 *  - needs the compiled `dist/` (run `npm run build` first — CI does);
 *  - needs a display: skipped on headless Linux (no DISPLAY; use `xvfb-run -a`);
 *  - skipped on CI unless COC_DESKTOP_E2E=1.
 * Set COC_DESKTOP_E2E_NO_SANDBOX=1 where `chrome-sandbox` is not setuid-root.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.join(here, '..', '..');
const runnerPath = path.join(here, 'browser-view-runner.cjs');
const distHost = path.join(pkgRoot, 'dist', 'browser-view-host.js');

function resolveElectronPath(): string {
    return createRequire(import.meta.url)('electron') as unknown as string;
}

const onCiWithoutOptIn = !!process.env.CI && process.env.COC_DESKTOP_E2E !== '1';
const headlessLinux = process.platform === 'linux' && !process.env.DISPLAY;
const skip = onCiWithoutOptIn || headlessLinux || !existsSync(distHost);

interface StepRecord {
    step: string;
    [key: string]: any;
}

function runScenario(userData: string, extraArgs: string[] = []): Promise<{ steps: Map<string, StepRecord>; exitCode: number | null; raw: string }> {
    return new Promise((resolve, reject) => {
        const env: NodeJS.ProcessEnv = { ...process.env, COC_BROWSER_E2E_USER_DATA: userData };
        delete env.ELECTRON_RUN_AS_NODE;
        const args = [
            ...(process.env.COC_DESKTOP_E2E_NO_SANDBOX === '1' ? ['--no-sandbox'] : []),
            runnerPath,
            ...extraArgs,
        ];
        const child = spawn(resolveElectronPath(), args, { env });
        let out = '';
        let err = '';
        child.stdout.on('data', (d) => { out += String(d); });
        child.stderr.on('data', (d) => { err += String(d); });
        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            reject(new Error(`E2E runner timed out.\nstdout:\n${out}\nstderr:\n${err}`));
        }, 75_000);
        child.on('error', (e) => { clearTimeout(timer); reject(e); });
        child.on('exit', (code) => {
            clearTimeout(timer);
            const steps = new Map<string, StepRecord>();
            for (const line of out.split('\n')) {
                if (line.startsWith('E2E::')) {
                    const record = JSON.parse(line.slice('E2E::'.length)) as StepRecord;
                    steps.set(record.step, record);
                }
            }
            resolve({ steps, exitCode: code, raw: out + err });
        });
    });
}

describe.skipIf(skip)('browser tab host E2E (real Electron, local HTTP fixtures)', () => {
    let userData: string;
    let steps: Map<string, StepRecord>;
    let exitCode: number | null;
    let raw: string;
    let restart: Awaited<ReturnType<typeof runScenario>>;

    beforeAll(async () => {
        userData = mkdtempSync(path.join(pkgRoot, '.e2e-browser-'));
        ({ steps, exitCode, raw } = await runScenario(userData));
        restart = await runScenario(userData, ['--restart-check']);
    }, 180_000);

    afterAll(() => {
        if (userData) rmSync(userData, { recursive: true, force: true });
    });

    it('runs the full scenario to completion', () => {
        expect(exitCode, raw).toBe(0);
        expect([...steps.keys()], raw).toEqual([
            'reject', 'open', 'dom-compositing', 'webview-security', 'close-shortcut', 'navigate', 'history', 'stop-reload', 'failure', 'new-tab', 'popup',
            'sessions', 'download', 'open-external', 'visibility', 'close', 'owner-reload', 'persistent-history',
        ]);
    });

    it('refuses non-web URLs, plain text and a missing session key without creating a view', () => {
        const reject = steps.get('reject')!;
        expect(reject.ftp).toEqual({ ok: false, reason: 'unsupported' });
        expect(reject.file).toMatchObject({ ok: false });
        expect(reject.text).toEqual({ ok: false, reason: 'invalid' });
        expect(reject.noSession).toEqual({ ok: false, reason: 'bad-session' });
        expect(reject.viewCount).toBe(0);
    });

    it('renders the page over the placeholder in a sandboxed, persistent browser profile', () => {
        const open = steps.get('open')!;
        expect(open.openResult).toMatchObject({ ok: true, engine: 'electron', sourceKind: 'url', embed: 'webview', partition: expect.stringMatching(/^coc-browser-/), src: open.home.url });
        expect(open.home).toMatchObject({ title: 'Home', loading: false, canGoBack: false });
        expect(open.home.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
        expect(open.viewCount).toBe(1);
        expect(open.bounds).toEqual({ x: 400, y: 50, width: 400, height: 300 });
        expect(open.visible).toBe(true);
        expect(open).toMatchObject({ hasBridge: false, hasRequire: false, hasProcess: false, partitionPersistent: true });
        expect(open.userAgent).not.toMatch(/Electron\//);
    });

    it('forwards the native close shortcut from an editable page without closing the desktop window', () => {
        const shortcut = steps.get('close-shortcut')!;
        expect(shortcut).toMatchObject({
            forwarded: [{ viewId: 'b1' }], beforeClose: 0,
            afterHidden: 1, windowAlive: true, viewAlive: true,
        });
        expect(shortcut.pageCloseKeys).toBe(shortcut.beforePage);
        expect(shortcut.hiddenPageCloseKeys).toBe(shortcut.pageCloseKeys + 1);
    });

    it('composites and clicks a DOM menu above a live guest without hiding the page', () => {
        expect(steps.get('dom-compositing')).toMatchObject({
            menuPixel: [0, 0, 255, 255], pagePixel: [255, 0, 0, 255], clicked: true, pageStayedLive: true,
        });
    });

    it('rejects unsafe, nested, subframe, untrusted and replayed guest attachments', () => {
        expect(steps.get('webview-security')).toMatchObject({
            rejectedUnsafe: true, hardenedGuest: { bridge: 'undefined', require: 'undefined', process: 'undefined' },
            protectedBeforeAdopt: true, rejectedNestedAndSubframe: true, rejectedUntrusted: true, rejectedReplay: true,
        });
    });

    it('follows links, redirects and in-page navigation', () => {
        const nav = steps.get('navigate')!;
        expect(nav.second).toMatchObject({ title: 'Second', canGoBack: true });
        expect(nav.landed.url).toMatch(/\/landed$/);
        expect(nav.landed.title).toBe('Landed');
        expect(nav.inPage.url).toMatch(/\/landed\?tab=2$/);
    });

    it('goes back and forward through live history', () => {
        const history = steps.get('history')!;
        expect(history.back).toMatchObject({ title: 'Second', canGoForward: true });
        expect(history.forward).toMatchObject({ title: 'Landed' });
    });

    it('persists successful final pages, reloads and popup visits across a desktop restart', () => {
        const entries = steps.get('persistent-history')!.entries;
        expect(entries, raw).toEqual(expect.any(Array));
        const byUrl = new Map<string, any>(entries.map((entry: any) => [entry.url, entry]));
        const nav = steps.get('navigate')!;
        expect(byUrl.get(nav.landed.url).engines.electron).toMatchObject({ title: 'Landed' });
        expect(byUrl.get(nav.second.url).engines.electron.visitCount).toBeGreaterThanOrEqual(2);
        expect(byUrl.get(nav.inPage.url).engines.electron).toMatchObject({ title: 'History hash', visitCount: 1 });
        expect(byUrl.get(steps.get('open')!.home.url).engines.electron.visitCount).toBeGreaterThanOrEqual(3);
        expect(entries.some((entry: any) => entry.url.endsWith('/login') && entry.engines.electron.title === 'Login')).toBe(true);
        // The failed URL succeeds on retry; only that successful retry counts.
        expect(byUrl.get(steps.get('failure')!.failed.url).engines.electron).toMatchObject({ title: 'Second', visitCount: 1 });
        expect(entries.some((entry: any) => /\/(redirect|slow|file\.zip)$/.test(entry.url))).toBe(false);
        expect(entries.every((entry: any) => /^https?:/.test(entry.url))).toBe(true);
        expect(restart.steps.get('restart')!.retainedHistory).toEqual(entries);
    });

    it('stops a slow load and reloads a page', () => {
        const sr = steps.get('stop-reload')!;
        expect(sr.slowLoading).toBe(true);
        expect(sr.stopped.loading).toBe(false);
        expect(sr.reloaded).toMatchObject({ title: 'Home', loading: false });
        expect(sr.sawReloadLoading).toBe(true);
    });

    it('reports a failed load and clears it on a successful retry', () => {
        const failure = steps.get('failure')!;
        expect(failure.failed.error).toBeTruthy();
        expect(failure.retried.error).toBeUndefined();
        expect(failure.retried.title).toBe('Second');
    });

    it('turns new-window links into a CoC tab request instead of a window', () => {
        const nt = steps.get('new-tab')!;
        expect(nt.newTab).toMatchObject({ openerViewId: 'b1' });
        expect(nt.newTab.url).toMatch(/\/second$/);
        expect(nt.windowDelta).toBe(0);
    });

    it('supports sign-in pop-ups in the same sandboxed session', () => {
        const popup = steps.get('popup')!;
        expect(popup.popupOpened).toBe(true);
        expect(popup.message).toBe('signed-in');
        expect(popup.popupPrefs).toEqual({ hasBridge: false, hasRequire: false });
        expect(popup.sameSession).toBe(true);
        expect(popup.cookieInTab).toBe('sid=signed-in');
    });

    it('shares sign-ins across workspace owners and isolates CoC itself', () => {
        expect(steps.get('sessions')).toMatchObject({ sameOwner: 'sid=signed-in', otherOwner: 'sid=signed-in', spaCookies: 0 });
    });

    it('hands downloads to the system browser without writing a file', () => {
        const dl = steps.get('download')!;
        expect(dl.download).toMatchObject({ viewId: 'b1', ok: true });
        expect(dl.download.url).toMatch(/\/file\.zip$/);
        expect(dl.externalCalls).toEqual([dl.download.url]);
        expect(dl.downloadedFiles).toEqual([]);
        expect(dl.tabUrl).not.toMatch(/file\.zip$/);
    });

    it('opens only http(s) URLs in the system browser', () => {
        const oe = steps.get('open-external')!;
        expect(oe.ok).toBe(true);
        expect(oe.refused).toBe(false);
        expect(oe.externalCalls).toHaveLength(1);
        expect(oe.externalCalls[0]).toMatch(/\/second$/);
    });

    it('hides and re-shows the view, and reopening the same tab keeps its history', () => {
        expect(steps.get('visibility')).toMatchObject({
            hiddenByHide: true, shownAgain: true, hiddenByNull: true,
            reopen: { ok: true, engine: 'electron', sourceKind: 'url' }, sameViewCount: true, keptHistory: true,
        });
        const switched = steps.get('visibility')!.workspaceSwitch;
        expect(switched.after).toEqual(switched.before);
        expect(switched.retained).toEqual({ state: { input: 'draft text', workspace: 'workspace-a' }, scrollY: 350 });
    });

    it('destroys the view and its pop-ups when the tab closes', () => {
        expect(steps.get('close')).toMatchObject({
            viewDestroyed: true, popupDestroyed: true, otherTabsAlive: true,
        });
    });

    it('drops every view when the SPA document reloads', () => {
        expect(steps.get('owner-reload')).toMatchObject({ viewCount: 0 });
    });

    it('retains sign-ins but not live navigation history after a restart', () => {
        expect(restart.exitCode, restart.raw).toBe(0);
        expect(restart.steps.get('restart')).toMatchObject({ title: 'Home', cookie: 'sid=signed-in', canGoBack: false });
    });
});
