import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const skip = (!!process.env.CI && process.env.COC_DESKTOP_E2E !== '1')
    || (process.platform === 'linux' && !process.env.DISPLAY)
    || !existsSync(path.join(here, '../../dist/browser-control-page.js'));

describe.skipIf(skip)('shared browser-control page in real Electron', () => {
    it('types/clicks/selects with trusted events, handles frames/shadow DOM and invalidates navigation refs', async () => {
        const directory = mkdtempSync(path.join(tmpdir(), 'coc-browser-control-'));
        try {
            const result = await new Promise<Record<string, any>>((resolve, reject) => {
                const env = { ...process.env, COC_BROWSER_E2E_USER_DATA: directory };
                delete env.ELECTRON_RUN_AS_NODE;
                const electron = createRequire(import.meta.url)('electron') as string;
                const args = [...(process.env.COC_DESKTOP_E2E_NO_SANDBOX === '1' ? ['--no-sandbox'] : []), path.join(here, 'browser-control-page-runner.cjs')];
                const child = spawn(electron, args, { env });
                let output = '';
                let errors = '';
                child.stdout.on('data', data => { output += data; });
                child.stderr.on('data', data => { errors += data; });
                const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`Control fixture timed out\n${output}\n${errors}`)); }, 30_000);
                child.on('error', error => { clearTimeout(timer); reject(error); });
                child.on('exit', code => {
                    clearTimeout(timer);
                    const line = output.split('\n').find(value => value.startsWith('E2E::'));
                    if (code !== 0 || !line) reject(new Error(`Control fixture exited ${code}\n${output}\n${errors}`));
                    else resolve(JSON.parse(line.slice(5)));
                });
            });
            expect(result).toMatchObject({
                stable: true, reused: false, stale: expect.stringContaining('stale ref, re-snapshot'),
                cancelled: 'Fixture Stop', stoppedField: 'replace me',
                typeAheadSelections: ['c1', 'c', 'c1', 'c'],
                report: { value: 'Ada', plan: 'c', choices: ['b'], frameText: 'Nested', frameClicked: true, shadowClicked: true },
            });
            // The AI cursor is on screen, yet the agent's screenshot, snapshot and read never contain it.
            expect(result.cursor).toMatchObject({
                hosts: 1, point: true, snapshotHasOverlay: false, readHasOverlay: false, refsStable: true,
                agentCursorPixels: 0, agentPagePixels: 0,
            });
            expect(result.cursor.visibleCursorPixels).toBeGreaterThan(20);
            expect(result.report.events).toContainEqual({ type: 'input', trusted: true });
            expect(result.report.events).toContainEqual({ type: 'change', trusted: true });
            expect(result.report.events.every((event: { trusted: boolean }) => event.trusted)).toBe(true);
        } finally {
            await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
        }
    }, 45_000);
});
