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
    || !existsSync(path.join(here, '../../dist/electron-annotation-capture.js'));

describe.skipIf(skip)('annotation crops in a fractional Electron webview guest', () => {
    it.each([1, 1.5, 2])('match the displayed device pixels at every zoom and viewport edge at scale %s', async scale => {
        const directory = mkdtempSync(path.join(tmpdir(), 'coc-annotation-capture-'));
        try {
            const output = await new Promise<string>((resolve, reject) => {
                const env = { ...process.env, COC_BROWSER_E2E_USER_DATA: directory };
                delete env.ELECTRON_RUN_AS_NODE;
                const electron = createRequire(import.meta.url)('electron') as string;
                const args = [`--force-device-scale-factor=${scale}`, ...(process.env.COC_DESKTOP_E2E_NO_SANDBOX === '1' ? ['--no-sandbox'] : []), path.join(here, 'browser-annotation-capture-runner.cjs')];
                const child = spawn(electron, args, { env });
                let stdout = '';
                let stderr = '';
                child.stdout.on('data', data => { stdout += data; });
                child.stderr.on('data', data => { stderr += data; });
                const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`Annotation capture fixture timed out\n${stdout}\n${stderr}`)); }, 40_000);
                child.on('error', error => { clearTimeout(timer); reject(error); });
                child.on('exit', code => {
                    clearTimeout(timer);
                    const line = stdout.split('\n').find(value => value.startsWith('E2E::'));
                    if (code !== 0 || !line) reject(new Error(`Annotation capture fixture exited ${code}\n${stdout}\n${stderr}`));
                    else resolve(line.slice(5));
                });
            });
            const results = JSON.parse(output) as Array<Record<string, any>>;
            expect(results).toHaveLength(4 * 6 * 2);
            // At scale 1.5 and 2 the guest surface is narrower and shorter than the rounded viewport.
            if (scale !== 1) {
                expect(results.some(result => result.surface.width < Math.ceil(result.viewport.width * result.viewport.devicePixelRatio))).toBe(true);
            }
            for (const result of results) {
                expect(result, `${result.engine} ${result.case} at zoom ${result.zoom}`).toMatchObject({
                    aligned: true, width: result.expected.width, height: result.expected.height,
                    pngSize: { width: result.expected.width, height: result.expected.height },
                });
                expect(result.shiftedDiffers).not.toBe(false);
            }
            expect(results.filter(result => result.shiftedDiffers === true).length).toBeGreaterThan(results.length / 2);
        } finally {
            await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
        }
    }, 60_000);
});
