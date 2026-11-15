import { expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { release, tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// The real helper: an explicit path, else the local debug build (`cargo build -p coc-wkwebview`),
// else the binary `build:native` stages (CI's artifact).
const helper = process.env.COC_WKWEBVIEW_PATH || [
    path.join(here, '../../../coc-native/rust/target/debug/coc-wkwebview'),
    path.join(here, `../../../coc-native/coc-wkwebview.darwin-${process.arch}`),
].find(file => existsSync(file)) || '';
const skip = (!!process.env.CI && process.env.COC_DESKTOP_E2E !== '1')
    || process.platform !== 'darwin' || Number(release().split('.')[0]) < 23
    || !existsSync(helper) || !existsSync(path.join(here, '../../dist/wkwebview-browser-host.js'));

it.skipIf(skip)('waits for approval and preserves a cross-host sign-in POST in a real WKWebView', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'coc-approval-wkwebview-'));
    try {
        const env = { ...process.env, COC_APPROVAL_TEST_DATA: directory, COC_APPROVAL_ENGINE: 'wkwebview', COC_WKWEBVIEW_PATH: helper };
        delete env.ELECTRON_RUN_AS_NODE;
        const output = await new Promise<string>((resolve, reject) => {
            const child = spawn(createRequire(import.meta.url)('electron'), [path.join(here, 'webview2-approval-runner.cjs')], { env });
            let output = '';
            child.stdout.on('data', data => { output += data; });
            child.stderr.on('data', data => { output += data; });
            const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`Approval fixture timed out\n${output}`)); }, 25000);
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
        // WebKit starts the page's scripted POST only after /login reports finished; control
        // readiness must still wait for it instead of returning on the sign-in page.
        expect(result).toMatchObject({ premature: false, title: 'Approved destination', redirected: true,
            postPreserved: true, approvalRevoked: true });
        expect(result.checks).toBe(2);
    } finally {
        await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    }
}, 35000);
