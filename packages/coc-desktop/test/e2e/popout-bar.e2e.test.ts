/**
 * End-to-end test for the pop-out address bar, against a loopback HTTP fixture
 * in a REAL Electron instance: real interception of `window.open`, real
 * WebContentsView layout, real preload bridge, real navigation history. The
 * scenario lives in `popout-bar-runner.cjs` (an Electron app main script that
 * emits one `E2E::{json}` line per step); this file spawns it and asserts.
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
import { CHROME_BAR_HEIGHT } from '../../src/popout-chrome';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.join(here, '..', '..');
const runnerPath = path.join(here, 'popout-bar-runner.cjs');
const distHost = path.join(pkgRoot, 'dist', 'popout-window-host.js');

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

describe.skipIf(skip)('pop-out address bar E2E (real Electron, loopback fixture)', () => {
    let steps: Map<string, StepRecord>;
    let exitCode: number | null;
    let raw: string;

    beforeAll(async () => {
        ({ steps, exitCode, raw } = await runScenario());
    }, 60_000);

    it('runs the full scenario to completion', () => {
        expect(exitCode, raw).toBe(0);
        expect([...steps.keys()]).toEqual(
            ['open', 'initial', 'navigate', 'back', 'external', 'rejected', 'reuse', 'resize'],
        );
    });

    it('rebuilds a pop-out open as one window with a chrome view over a page view', () => {
        const open = steps.get('open')!;
        expect(open).toMatchObject({ windowCount: 1, viewCount: 2 });
        // window.open returned null — the SPA's `popOutOpened` case.
        expect(open.openResult).toBe('null');
        expect(open.chromeBounds).toEqual(open.expectedChrome);
        expect(open.pageBounds).toEqual(open.expectedPage);
        expect((open.chromeBounds as { height: number }).height).toBe(CHROME_BAR_HEIGHT);
    });

    it('grows the window so the page keeps the size the features string asked for', () => {
        const open = steps.get('open')!;
        expect(open.contentHeight).toBe(open.expectedContentHeight);
    });

    it('shows the popped-out URL with no history behind it', () => {
        const initial = steps.get('initial')!;
        expect(initial.url).toBe(initial.pageUrl);
        expect(initial).toMatchObject({ canGoBack: false, canGoForward: false });
    });

    it('navigates the page view on a typed same-origin URL and flips canGoBack', () => {
        const nav = steps.get('navigate')!;
        expect(nav.pageUrl).toContain('?p=2');
        expect(nav.url).toBe(nav.pageUrl);
        expect(nav).toMatchObject({ canGoBack: true });
    });

    it('back returns to the previous page and the bar follows', () => {
        const back = steps.get('back')!;
        expect(back.pageUrl).toContain('?p=1');
        expect(back.url).toBe(back.pageUrl);
        expect(back).toMatchObject({ canGoBack: false, canGoForward: true });
    });

    it('hands a typed cross-origin URL to the system browser without navigating', () => {
        const ext = steps.get('external')!;
        expect(ext.externalCalls).toEqual(['https://example.com/docs']);
        expect(ext.pageUrl).toContain('?p=1');
    });

    it('rejects a javascript: URL outright — no navigation, no external open', () => {
        const rejected = steps.get('rejected')!;
        expect(rejected.externalCallCount).toBe(1); // still just the example.com one
        expect(rejected.pageUrl).toContain('?p=1');
        // The bar reverted to the live URL rather than keeping the typed text.
        expect(rejected.barUrl).toBe(rejected.pageUrl);
    });

    it('focuses the existing window when the same window name is reopened', () => {
        expect(steps.get('reuse')).toMatchObject({ windowCount: 1 });
    });

    it('keeps both views filling the window across a resize', () => {
        const resize = steps.get('resize')!;
        expect(resize.chromeBounds).toEqual({ x: 0, y: 0, width: 600, height: CHROME_BAR_HEIGHT });
        expect(resize.pageBounds).toEqual({
            x: 0, y: CHROME_BAR_HEIGHT, width: 600, height: 400 - CHROME_BAR_HEIGHT,
        });
    });
});
