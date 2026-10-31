/** Real sandboxed Chromium Blob/data transfer; native dialog UI remains manual. */
import { beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const skip = (!!process.env.CI && process.env.COC_DESKTOP_E2E !== '1')
    || (process.platform === 'linux' && !process.env.DISPLAY)
    || !existsSync(path.join(here, '..', '..', 'dist', 'file-preview-host.js'));
const cases = ['blob-csv', 'data-csv', 'data-binary', 'blob-empty', 'blob-missing', 'data-unsafe', 'blob-large'];
interface Step {
    step: string;
    dialogs: { correctOwner: boolean; suggestion: string; properties: string[] }[];
    savedSize: number;
    expectedSize: number;
    actualHash: string;
    expectedHash: string;
    filename: string;
    [key: string]: unknown;
}

function runScenario(): Promise<{ steps: Map<string, Step>; code: number | null; raw: string }> {
    return new Promise((resolve, reject) => {
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        // This security fixture deliberately has no --no-sandbox escape hatch.
        const child = spawn(createRequire(import.meta.url)('electron') as string,
            [path.join(here, 'html-download-runner.cjs')], { env });
        let out = '';
        let err = '';
        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            reject(new Error(`HTML download runner timed out.\n${out}\n${err}`));
        }, 120_000);
        child.stdout.on('data', data => { out += String(data); });
        child.stderr.on('data', data => { err += String(data); });
        child.on('error', error => { clearTimeout(timer); reject(error); });
        child.on('close', code => {
            clearTimeout(timer);
            try {
                const steps = new Map<string, Step>();
                for (const line of out.split('\n')) {
                    if (line.startsWith('E2E::')) {
                        const step = JSON.parse(line.slice(5)) as Step;
                        steps.set(step.step, step);
                    }
                }
                resolve({ steps, code, raw: out + err });
            } catch (error) { reject(error); }
        });
    });
}

describe.skipIf(skip)('HTML preview downloads (real sandboxed Electron)', () => {
    let result: Awaited<ReturnType<typeof runScenario>>;
    beforeAll(async () => { result = await runScenario(); }, 130_000);

    it('finishes all local transfers with sandboxed Electron despite requesting WebView2', () => {
        expect(result.code, result.raw).toBe(0);
        expect([...result.steps.keys()], result.raw).toEqual(['isolation', 'unsolicited', 'cancel', ...cases, 'approved-close']);
        expect(result.steps.get('isolation')).toMatchObject({
            engine: 'electron', sourceKind: 'file', persistent: false,
            preferences: { sandbox: true, contextIsolation: true }, bridge: 'undefined', node: 'undefined',
        });
    });

    it('rejects load, timer and synthetic activation before a chooser or write', () => {
        const record = result.steps.get('unsolicited');
        expect(record, result.raw).toMatchObject({
            dialogs: 0, entries: 0, attempts: ['load', 'timer'], trusted: [false],
            files: [], previewUsable: true,
        });
        // Require native requests to reach the main admission boundary, not just
        // a browser-level refusal that would leave the production gate untested.
        expect(record!.nativeRejections).toEqual(expect.arrayContaining([true]));
        expect((record!.nativeRejections as boolean[]).every(Boolean)).toBe(true);
    });

    it('cancels Save As without a write, allowing the following fresh-input retry', () => {
        expect(result.steps.get('cancel'), result.raw).toMatchObject({
            dialogs: 1, state: 'cancelled', notices: 0, files: [], previewUsable: true,
        });
        expect(result.steps.get('blob-csv'), result.raw).toMatchObject({ state: 'completed', trusted: [true] });
    });

    it('finishes an approved original native transfer after source destruction', () => {
        const record = result.steps.get('approved-close');
        expect(record, result.raw).toMatchObject({
            dialogs: 1, sourceDestroyed: true, pausedBeforeClose: true, state: 'completed', fileAvailable: true,
        });
        expect(record!.savedSize).toBe(record!.expectedSize);
        expect(record!.actualHash).toBe(record!.expectedHash);
    });

    it.each(cases)('saves exact bytes and preserves the preview: %s', id => {
        const record = result.steps.get(id);
        expect(record, result.raw).toBeDefined();
        expect(record!.dialogs).toEqual([{
            correctOwner: true, suggestion: expect.any(String),
            properties: expect.arrayContaining(['showOverwriteConfirmation']),
        }]);
        expect(record!.savedSize).toBe(record!.expectedSize);
        expect(record!.actualHash).toBe(record!.expectedHash);
        expect(record).toMatchObject({
            state: 'completed', received: record!.expectedSize,
            fileAvailable: true, publicMetadataSafe: true, previewUsable: true, trusted: [true],
        });
        const suggestion = record!.dialogs[0].suggestion;
        expect(suggestion).toBeTruthy();
        expect(suggestion).not.toMatch(/[/\\<>:"|?*\x00-\x1f\x7f]/);
        expect(suggestion).not.toMatch(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i);
        // Completion names the user's selected destination, not the suggestion.
        expect(record!.filename).toBe(`renamed-${id}.saved`);
        if (id === 'blob-csv') expect(suggestion).toBe('雪.csv');
        if (id === 'data-csv') expect(suggestion).toBe('Unicode.csv');
        if (id === 'blob-empty') expect(record!.savedSize).toBe(0);
        if (id === 'blob-large') expect(record!.savedSize).toBeGreaterThan(100 * 1024 * 1024);
    });
});
