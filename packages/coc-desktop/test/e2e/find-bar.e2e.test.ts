/**
 * End-to-end test for the find bar, against mock data in a REAL Electron
 * instance: real WebContentsView, real preload bridge, real findInPage. The
 * scenario lives in `find-bar-runner.cjs` (an Electron app main script that
 * emits one `E2E::{json}` line per step); this file spawns it and asserts.
 *
 * Environment gates:
 *  - needs the compiled `dist/` (run `npm run build` first — CI does);
 *  - needs a display: skipped on headless Linux (no DISPLAY);
 *  - skipped on CI unless COC_DESKTOP_E2E=1, so a hung GUI can never wedge
 *    the unit-test job. Run locally with plain `npx vitest run test/e2e`.
 *
 * The runner strips ELECTRON_RUN_AS_NODE before launch — with it set (as some
 * dev shells do), the Electron binary behaves as plain Node and no app starts.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.join(here, '..', '..');
const runnerPath = path.join(here, 'find-bar-runner.cjs');
const distHost = path.join(pkgRoot, 'dist', 'find-bar-host.js');

// Under plain Node, require('electron') resolves to the binary's path string.
const electronPath = createRequire(import.meta.url)('electron') as unknown as string;

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
        const child = spawn(electronPath, [runnerPath], { env });
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

describe.skipIf(skip)('find bar E2E (real Electron, mock data)', () => {
    let steps: Map<string, StepRecord>;
    let exitCode: number | null;
    let raw: string;

    beforeAll(async () => {
        ({ steps, exitCode, raw } = await runScenario());
    }, 60_000);

    it('runs the full scenario to completion', () => {
        expect(exitCode, raw).toBe(0);
        expect([...steps.keys()]).toEqual(
            ['bridge', 'spa-owned', 'open', 'type', 'cycle', 'edit', 'close', 'reopen', 'resize'],
        );
    });

    it('installs the preload bridge and the Ctrl+F shortcut in the page', () => {
        expect(steps.get('bridge')).toMatchObject({ hasFind: true, shortcutInstalled: true });
    });

    it('stays closed while the SPA owns Ctrl+F (defaultPrevented)', () => {
        expect(steps.get('spa-owned')).toMatchObject({ childViews: 0 });
    });

    it('opens on unhandled Ctrl+F, pinned to the top-right', () => {
        const open = steps.get('open')!;
        expect(open).toMatchObject({ childViews: 1, hasBarWc: true });
        expect((open.bounds as { x: number }).x).toBe(open.expectedX);
        expect((open.bounds as { y: number }).y).toBe(12);
    });

    it('searches both mock panels with an exact count — never its own query box', () => {
        // "needle" appears 3 times across the left panel + right pane; an
        // in-page bar used to report 4 by matching its own input.
        const type = steps.get('type')!;
        expect(type).toMatchObject({ value: 'needle', count: '1/3' });
        expect(type.lastResult).toMatchObject({ ordinal: 1, matches: 3 });
    });

    it('Enter cycles through matches and wraps; Shift+Enter steps back', () => {
        const cycle = steps.get('cycle')!;
        expect(cycle.ordinals).toEqual([2, 3, 1]);
        expect(cycle.afterShiftEnter).toBe(3);
    });

    it('Backspace edits the query live and the search follows', () => {
        const edit = steps.get('edit')!;
        expect(edit.value).toBe('need');
        expect(edit.lastResult).toMatchObject({ matches: 3 });
    });

    it('Escape detaches the bar view', () => {
        expect(steps.get('close')).toMatchObject({ childViews: 0 });
    });

    it('reopening restores the query and re-runs the search', () => {
        const reopen = steps.get('reopen')!;
        expect(reopen).toMatchObject({ childViews: 1, value: 'need' });
        expect(reopen.lastResult).toMatchObject({ matches: 3 });
    });

    it('stays pinned to the top-right across window resizes', () => {
        const resize = steps.get('resize')!;
        expect((resize.bounds as { x: number }).x).toBe(resize.expectedX);
    });
});
