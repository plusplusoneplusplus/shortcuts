import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const skip = (!!process.env.CI && process.env.COC_DESKTOP_E2E !== '1')
    || (process.platform === 'linux' && !process.env.DISPLAY)
    || !existsSync(path.join(here, '..', '..', 'dist', 'extension-canvas-host.js'));

describe.skipIf(skip)('extension canvas guest (real Electron)', () => {
    it.each([
        ['extension-canvas-runner.cjs', {
            rendered: true, sse: true, external: true, originBlocked: true, sandboxed: true, closed: true,
        }],
        ['extension-canvas-bridge-runner.cjs', {
            sdk: true, preload: true, savedReopen: true, agentActionSse: true, external: true, restoredAfterRestart: true,
        }],
    ])('runs %s', async (runner, expected) => {
        const result = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
            const electron = createRequire(import.meta.url)('electron') as string;
            const args = process.env.COC_DESKTOP_E2E_NO_SANDBOX === '1' ? ['--no-sandbox'] : [];
            const env = { ...process.env };
            delete env.ELECTRON_RUN_AS_NODE;
            const child = spawn(electron, [...args, path.join(here, runner)], { env });
            let output = '';
            child.stdout.on('data', data => { output += String(data); });
            child.stderr.on('data', data => { output += String(data); });
            const timer = setTimeout(() => {
                child.kill('SIGKILL');
                reject(new Error(`Extension canvas runner timed out:\n${output}`));
            }, 30_000);
            child.on('error', error => { clearTimeout(timer); reject(error); });
            child.on('close', code => { clearTimeout(timer); resolve({ code, output }); });
        });
        expect(result.code, result.output).toBe(0);
        const record = result.output.split('\n').find(line => line.startsWith('E2E::'));
        expect(record, result.output).toBeDefined();
        expect(JSON.parse(record!.slice(5))).toEqual(expected);
    }, 40_000);
});
