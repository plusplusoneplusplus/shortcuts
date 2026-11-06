import { expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

it.skipIf(process.platform !== 'win32' || process.arch !== 'x64' || !!process.env.CI && process.env.COC_DESKTOP_E2E !== '1')(
    'waits for approval and preserves a cross-host sign-in POST in the real WebView2 runtime',
    async () => {
        const directory = await mkdtemp(path.join(tmpdir(), 'coc-approval-'));
        try {
            const env = { ...process.env, COC_APPROVAL_TEST_DATA: directory };
            delete env.ELECTRON_RUN_AS_NODE;
            env.COC_WEBVIEW2_PATH = path.join(directory, 'synthetic-webview2.exe');
            await copyFile(path.join(here, '../../../coc-native/rust/target/release/coc-webview2.exe'), env.COC_WEBVIEW2_PATH);
            const output = await new Promise<string>((resolve, reject) => {
                const child = spawn(createRequire(import.meta.url)('electron'), [path.join(here, 'webview2-approval-runner.cjs')], { env });
                let output = '';
                child.stdout.on('data', data => { output += data; });
                child.stderr.on('data', data => { output += data; });
                const timer = setTimeout(() => { child.kill(); reject(new Error(`Approval fixture timed out\n${output}`)); }, 25000);
                child.on('error', error => { clearTimeout(timer); reject(error); });
                child.on('close', code => {
                    clearTimeout(timer);
                    if (code !== 0) reject(new Error(`Approval fixture exited ${code}\n${output}`));
                    else resolve(output);
                });
            });
            const line = output.split('\n').find(line => line.startsWith('E2E::'));
            expect(line, output).toBeDefined();
            const result = JSON.parse(line!.slice(5));
            expect(result).toMatchObject({ premature: false, title: 'Approved destination', redirected: true,
                postPreserved: true, approvalRevoked: true });
            expect(result.checks).toBe(2);
        } finally {
            await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
        }
    }, 35000,
);
