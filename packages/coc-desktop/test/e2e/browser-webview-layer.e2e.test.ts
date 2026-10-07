import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const skip = (!!process.env.CI && process.env.COC_DESKTOP_E2E !== '1')
    || (process.platform === 'linux' && !process.env.DISPLAY)
    || !existsSync(path.join(here, '../../dist/browser-view-host.js'))
    || !existsSync(path.join(here, '../../../coc/src/server/spa/client/dist/bundle.css'));

describe.skipIf(skip)('real SPA webview layer in Electron', () => {
    it('keeps page state across panel remounts and draws clickable DOM overlays above live page pixels', async () => {
        const data = mkdtempSync(path.join(tmpdir(), 'coc-webview-layer-'));
        try {
            const result = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
                const env: NodeJS.ProcessEnv = { ...process.env, COC_WEBVIEW_LAYER_DATA: data };
                delete env.ELECTRON_RUN_AS_NODE;
                const child = spawn(createRequire(import.meta.url)('electron'), [
                    ...(process.env.COC_DESKTOP_E2E_NO_SANDBOX === '1' ? ['--no-sandbox'] : []),
                    path.join(here, 'browser-webview-layer-runner.cjs'),
                ], { env });
                let output = '';
                let timedOut = false;
                child.stdout.on('data', data => { output += data; });
                child.stderr.on('data', data => { output += data; });
                const timeout = setTimeout(() => {
                    timedOut = true;
                    child.kill('SIGKILL');
                }, 60_000);
                child.on('error', error => { clearTimeout(timeout); reject(error); });
                child.on('close', code => {
                    clearTimeout(timeout);
                    if (timedOut) reject(new Error(`Renderer layer timed out:\n${output}`));
                    else resolve({ code, output });
                });
            });
            expect(result.code, result.output).toBe(0);
            const steps = result.output.split('\n').filter(line => line.startsWith('E2E::')).map(line => JSON.parse(line.slice(5)));
            expect(steps).toEqual(['persistence', 'overlays', 'toolbar', 'close', 'html'].map(step => ({ step, ok: true })));
        } finally {
            rmSync(data, { recursive: true, force: true });
        }
    }, 75_000);
});
