import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const skip = (!!process.env.CI && process.env.COC_DESKTOP_E2E !== '1')
    || (process.platform === 'linux' && !process.env.DISPLAY);
const engines = process.platform === 'win32' && process.arch === 'x64' ? ['electron', 'webview2'] : ['electron'];

describe.skipIf(skip).each(engines)('%s isolated cross-site frame control', engine => {
    it('uses real OOPIF sessions for bounded reading, trusted nested input and fail-closed lifecycle', async () => {
        for (const file of ['browser-control-page.js', 'browser-frame-registry.js', 'browser-control-queue.js']) {
            expect(existsSync(path.join(here, '../../dist', file)), `Build desktop before running frame e2e: ${file}`).toBe(true);
        }
        const directory = mkdtempSync(path.join(here, '../../.e2e-browser-frames-'));
        try {
            const env = { ...process.env, COC_BROWSER_FRAME_DATA: directory, COC_BROWSER_E2E_ENGINE: engine };
            delete env.ELECTRON_RUN_AS_NODE;
            if (engine === 'webview2') {
                const helper = path.join(here, '../../../coc-native/rust/target/release/coc-webview2.exe');
                expect(existsSync(helper), 'Compile the current Windows helper before running frame e2e').toBe(true);
                env.COC_WEBVIEW2_PATH = path.join(directory, 'synthetic-webview2.exe');
                copyFileSync(helper, env.COC_WEBVIEW2_PATH);
                env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--site-per-process --host-resolver-rules="MAP localhost 127.0.0.1"';
            }
            const result = await new Promise<Record<string, any>>((resolve, reject) => {
                const child = spawn(createRequire(import.meta.url)('electron'), [
                    path.join(here, 'browser-frame-control-runner.cjs'),
                ], { env });
                let output = '';
                child.stdout.on('data', data => { output += data; });
                child.stderr.on('data', data => { output += data; });
                let timedOut = false;
                const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 115_000);
                child.on('error', error => { clearTimeout(timer); reject(error); });
                child.on('close', code => {
                    clearTimeout(timer);
                    const line = output.split('\n').find(value => value.startsWith('E2E::'));
                    if (timedOut || code !== 0 || !line) {
                        reject(new Error(`${engine} frame fixture ${timedOut ? 'timed out' : `exited ${code}`}\n${output}`));
                    } else resolve(JSON.parse(line.slice(5)));
                });
            });
            expect(result).toMatchObject({
                engine, oopif: true, contextAssociation: true, automaticSnapshot: true,
                explicitReadEval: true, uniqueSameOrigin: true, boundaries: true,
                trustedNestedInput: true, nestedScroll: true, keyboardFocus: true,
                scaledBorderGeometry: true, pageZoom: true, occlusionRejected: true, conflictRejected: true,
                processSwapStale: true, detachStale: true, replacementStale: true,
                cancelledInputReleased: true, cancelledEvalSerialized: true,
                frameCap: 32, readCap: 8000, evalCap: 4000, depthCap: 8, nodeCap: 20000, charCap: 1000000,
                disabled: true, temporaryProfilesOnly: true,
                richPaste: process.env.COC_DESKTOP_RICH_CLIPBOARD_E2E === '1', absoluteClipping: true,
                containingBlockClipping: true, clippedKeysRejected: true, focusedSelectionPreserved: true,
            });
            expect(result.iframeSessions).toBeGreaterThanOrEqual(2);
            expect(result.sessionEvaluations).toBeGreaterThan(0);
            expect(result.maxProtocolBytes).toBeLessThanOrEqual(900_000);
        } finally {
            await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
        }
    }, 120_000);
});
