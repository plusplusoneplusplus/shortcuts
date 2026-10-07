/**
 * End-to-end test for the HTML page tab host in a REAL Electron instance: a
 * fixture `.html` file with a sibling CSS file is opened through the real
 * preload bridge, hosted in a real WebContentsView over `file://`, moved,
 * hidden, navigated and closed. The scenario lives in `html-page-runner.cjs`
 * (an Electron app main script that emits one `E2E::{json}` line per step);
 * this file spawns it and asserts.
 *
 * Environment gates match the find-bar pair:
 *  - needs the compiled `dist/` (run `npm run build` first — CI does);
 *  - needs a display: skipped on headless Linux (no DISPLAY);
 *  - skipped on CI unless COC_DESKTOP_E2E=1, so a hung GUI can never wedge the
 *    unit-test job. Run locally with plain `npx vitest run test/e2e`.
 *
 * On a Linux box whose `chrome-sandbox` helper is not setuid-root, Electron
 * aborts before the app starts; set COC_DESKTOP_E2E_NO_SANDBOX=1 to pass
 * `--no-sandbox` there. Nothing in this scenario depends on the sandbox.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.join(here, '..', '..');
const runnerPath = path.join(here, 'html-page-runner.cjs');
const distHost = path.join(pkgRoot, 'dist', 'file-preview-host.js');

// Under plain Node, require('electron') resolves to the binary's path string.
// Resolved lazily (inside runScenario) rather than at import time: on CI without
// opt-in this suite is skipped, and a flaky/half-extracted Electron install (e.g.
// a concurrent-extraction race on Windows) must never fail the file at import.
function resolveElectronPath(): string {
    return createRequire(import.meta.url)('electron') as unknown as string;
}

const onCiWithoutOptIn = !!process.env.CI && process.env.COC_DESKTOP_E2E !== '1';
const headlessLinux = process.platform === 'linux' && !process.env.DISPLAY;
const skip = onCiWithoutOptIn || headlessLinux || !existsSync(distHost);

interface StepRecord {
    step: string;
    [key: string]: unknown;
}

function runScenario(): Promise<{ steps: Map<string, StepRecord>; exitCode: number | null; raw: string }> {
    return new Promise((resolve, reject) => {
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        const args = process.env.COC_DESKTOP_E2E_NO_SANDBOX === '1'
            ? ['--no-sandbox', runnerPath]
            : [runnerPath];
        const child = spawn(resolveElectronPath(), args, { env });
        let out = '';
        let err = '';
        child.stdout.on('data', (d) => { out += String(d); });
        child.stderr.on('data', (d) => { err += String(d); });
        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            reject(new Error(`E2E runner timed out.\nstdout:\n${out}\nstderr:\n${err}`));
        }, 45_000);
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

describe.skipIf(skip)('HTML page tab host E2E (real Electron, file:// fixture)', () => {
    let steps: Map<string, StepRecord>;
    let exitCode: number | null;
    let raw: string;

    beforeAll(async () => {
        ({ steps, exitCode, raw } = await runScenario());
    }, 60_000);

    it('runs the full scenario to completion', () => {
        expect(exitCode, raw).toBe(0);
        expect([...steps.keys()]).toEqual(
            ['reject', 'open', 'isolation', 'source', 'reuse', 'resize', 'hide', 'navigate', 'open-external', 'reload', 'failure', 'close', 'quit'],
        );
    });

    it('refuses non-html, missing and relative paths without creating a view', () => {
        const reject = steps.get('reject')!;
        expect(reject.rejectNotHtml).toEqual({ ok: false, reason: 'not-html' });
        expect(reject.rejectMissing).toEqual({ ok: false, reason: 'missing' });
        expect(reject.rejectRelative).toEqual({ ok: false, reason: 'not-absolute' });
        expect(reject.viewCount).toBe(0);
    });

    it('renders the file over file:// with its sibling CSS, over the placeholder', () => {
        const open = steps.get('open')!;
        expect(open.openResult).toEqual({ ok: true });
        expect(open.viewCount).toBe(1);
        expect(open.url).toBe(open.expectedUrl);
        expect(open.title).toBe('Fixture');
        expect(open.background).toBe('rgb(1, 2, 3)');
        expect(open.bounds).toEqual({ x: 400, y: 50, width: 300, height: 200 });
        expect(open.visible).toBe(true);
        expect(open.states).toContain('loaded');
    });

    it('gives the page no CoC bridge and no Node', () => {
        expect(steps.get('open')).toMatchObject({ hasBridge: false, hasRequire: false, hasProcess: false });
    });

    it('never shares browser-profile cookies or storage with the preview', () => {
        const isolation = steps.get('isolation')!;
        expect(isolation.browserOpen).toMatchObject({ ok: true, engine: 'electron', sourceKind: 'url', embed: 'webview' });
        expect(isolation.profileCookieCount).toBe(1);
        expect(isolation.previewCookieNames).not.toContain('coc_profile_probe');
        expect(isolation.previewDocumentCookie).toBe('');
        expect(isolation).toMatchObject({ sameSession: false, previewPersistent: false, previewPartitionMatches: true });
    });

    it('opens file sources through the merged browser API in the isolated file host only', () => {
        expect(steps.get('source')).toMatchObject({
            sources: ['url', 'file'],
            fileSource: { ok: true, engine: 'electron', sourceKind: 'file' },
            fileUrlAsUrl: { ok: false },
            addedViews: 1,
            filePartitionMatches: true,
        });
    });

    it('reuses the view when the same page is opened again', () => {
        expect(steps.get('reuse')).toMatchObject({
            reopen: { ok: true }, viewCount: 1, replayed: ['loaded'],
        });
    });

    it('follows the placeholder when the panel resizes', () => {
        expect(steps.get('resize')).toMatchObject({
            bounds: { x: 300, y: 50, width: 500, height: 350 },
            visible: true,
        });
    });

    it('hides on hide() and on a null rect, and shows again on setBounds', () => {
        expect(steps.get('hide')).toEqual({ step: 'hide', hiddenByHide: true, shownAgain: true, hiddenByNull: true });
    });

    it('sends http(s) navigation and window.open to the system browser, navigates siblings in place', () => {
        const nav = steps.get('navigate')!;
        expect(nav.externalCalls).toEqual(['https://example.com/nav', 'https://example.com/popup']);
        expect(nav.afterExternalUrl).toMatch(/index\.html$/);
        expect(nav.afterSiblingUrl).toMatch(/other\.html$/);
        expect(nav.windowCount).toBe(1);
    });

    it('opens the current file:// URL in the system browser', () => {
        expect(steps.get('open-external')!.last).toMatch(/^file:\/\/.*other\.html$/);
    });

    it('keeps the preview live across a full SPA reload and reattaches it', () => {
        const reload = steps.get('reload')!;
        expect(reload).toMatchObject({
            hiddenAfterReload: true, viewsAfterReload: 1, siteClosed: true,
            reattach: { ok: true }, replayed: ['loaded'], canGoBack: true,
            sameView: true, visible: true, scrollY: 400, inPage: 'kept',
        });
        expect(reload.url).toMatch(/other\.html$/);
        expect(reload.afterBackUrl).toMatch(/index\.html$/);
    });

    it('reports a load failure so the tab can show an error', () => {
        const failure = steps.get('failure')!;
        expect(failure.last).toMatchObject({ pageId: 'p2', status: 'failed' });
        expect((failure.last as { error?: string }).error).toBeTruthy();
    });

    it('destroys the views when their tabs close', () => {
        expect(steps.get('close')).toMatchObject({ viewCount: 0, pageDestroyed: true });
    });

    it('quits normally while a page tab is still open', () => {
        expect(steps.get('quit-hung'), raw).toBeUndefined();
        expect(steps.get('quit')).toMatchObject({ liveViews: 1 });
    });
});
