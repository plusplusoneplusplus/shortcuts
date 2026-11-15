import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { release, tmpdir } from 'node:os';
import path from 'node:path';
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

describe.skipIf(skip)('a real WKWebView overlay over a real Electron window', () => {
    it('tracks move/resize/fullscreen, hides with the window and on tab switch, and never steals focus in the background', async () => {
        const directory = mkdtempSync(path.join(tmpdir(), 'coc-window-wkwebview-'));
        try {
            const output = await new Promise<string>((resolve, reject) => {
                const env = { ...process.env, COC_BROWSER_E2E_USER_DATA: directory, COC_WKWEBVIEW_PATH: helper };
                delete env.ELECTRON_RUN_AS_NODE;
                const electron = createRequire(import.meta.url)('electron') as string;
                const child = spawn(electron, [path.join(here, 'wkwebview-window-runner.cjs')], { env });
                let stdout = '';
                let stderr = '';
                child.stdout.on('data', data => { stdout += data; });
                child.stderr.on('data', data => { stderr += data; });
                const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`WKWebView window fixture timed out\n${stdout}\n${stderr}`)); }, 80_000);
                child.on('error', error => { clearTimeout(timer); reject(error); });
                child.on('exit', code => {
                    clearTimeout(timer);
                    const line = stdout.split('\n').find(value => value.startsWith('E2E::'));
                    if (code !== 0 || !line) reject(new Error(`WKWebView window fixture exited ${code}\n${stdout}\n${stderr}`));
                    else resolve(line.slice(5));
                });
            });
            expect(JSON.parse(output)).toEqual({
                placed: true, tracksMoveResize: true, hidesOnTabSwitch: true, hidesWithParent: true,
                backgroundNoFocusSteal: true, followsFullscreen: true, explicitFocus: true,
            });
        } finally {
            await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
        }
    }, 90_000);
});
