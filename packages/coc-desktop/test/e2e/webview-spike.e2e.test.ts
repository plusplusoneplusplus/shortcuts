import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const skip = (!!process.env.CI && process.env.COC_DESKTOP_E2E !== '1')
    || (process.platform === 'linux' && !process.env.DISPLAY);

describe.skipIf(skip)('stock Electron webview spike', () => {
    it('honors fromPath session overrides, composites DOM overlays and rejects subframe guests', async () => {
        const directory = mkdtempSync(path.join(here, '../../.e2e-webview-spike-'));
        try {
            const result = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
                const env = { ...process.env, COC_BROWSER_E2E_USER_DATA: directory };
                delete env.ELECTRON_RUN_AS_NODE;
                const child = spawn(createRequire(import.meta.url)('electron'), [
                    ...(process.env.COC_DESKTOP_E2E_NO_SANDBOX === '1' ? ['--no-sandbox'] : []),
                    path.join(here, 'webview-spike.cjs'),
                ], { env });
                let output = '';
                child.stdout.on('data', data => { output += data; });
                child.stderr.on('data', data => { output += data; });
                const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(output)); }, 30_000);
                child.on('error', error => { clearTimeout(timer); reject(error); });
                child.on('exit', code => { clearTimeout(timer); resolve({ code, output }); });
            });
            expect(result.code, result.output).toBe(0);
            expect(result.output).toContain('"exactSession":true');
            expect(result.output).toContain('"cookie":"spike=exact-session"');
            expect(result.output).toContain('"subframeAttached":false');
            if (process.platform === 'linux') { expect(result.output).toContain('"nativeInput":"passed"'); }
        } finally {
            rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
        }
    }, 40_000);
});
