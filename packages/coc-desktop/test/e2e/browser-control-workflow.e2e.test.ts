import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const skip = (!!process.env.CI && process.env.COC_DESKTOP_E2E !== '1')
    || (process.platform === 'linux' && !process.env.DISPLAY);
// Windows x64 runs the identical relay workflow through the live native CDP helper.
const engines = process.platform === 'win32' && process.arch === 'x64' ? ['electron', 'webview2'] : ['electron'];

describe.skipIf(skip).each(engines)('%s browser-mode end-to-end relay', engine => {
    it('activates /browser and opens, snapshots, types, clicks and reads through the real desktop with isolated owners', async () => {
        for (const file of ['../../dist/browser-control-command.js', '../../../coc/dist/server/executors/chat-turn-context-builder.js',
            '../../../coc/src/server/spa/client/dist/bundle.css']) {
            expect(existsSync(path.join(here, file)), `Build packages before running e2e: ${file}`).toBe(true);
        }
        const directory = mkdtempSync(path.join(here, '../../.e2e-browser-workflow-'));
        try {
            const result = await new Promise<Record<string, any>>((resolve, reject) => {
                const env = { ...process.env, COC_BROWSER_WORKFLOW_DATA: directory, COC_BROWSER_E2E_ENGINE: engine };
                delete env.ELECTRON_RUN_AS_NODE;
                const child = spawn(createRequire(import.meta.url)('electron'), [
                    ...(process.env.COC_DESKTOP_E2E_NO_SANDBOX === '1' ? ['--no-sandbox'] : []),
                    path.join(here, 'browser-control-workflow-runner.cjs'),
                ], { env });
                let output = '';
                child.stdout.on('data', data => { output += data; });
                child.stderr.on('data', data => { output += data; });
                let timedOut = false;
                const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 90_000);
                child.on('error', error => { clearTimeout(timer); reject(error); });
                child.on('close', code => {
                    clearTimeout(timer);
                    const line = output.split('\n').find(value => value.startsWith('E2E::'));
                    if (timedOut || code !== 0 || !line) reject(new Error(`Workflow fixture ${timedOut ? 'timed out' : `exited ${code}`}\n${output}`));
                    else resolve(JSON.parse(line.slice(5)));
                });
            });
            expect(result).toMatchObject({
                engine, read: expect.stringContaining('Published: isolated relay works'),
                screenshotParity: true, screenshot: { width: expect.any(Number), height: expect.any(Number) },
                activation: ['browser'], sticky: true, panelRevealed: true,
                ownerScoped: true, workspaceScoped: true, conversationScoped: true, fileExcluded: true,
                exactSourceGuard: true, liveDisabled: true, nativePopups: true,
                crossOwnerFollowUp: true, ownerBadgeStop: true,
                nativeChromeStop: true, nativeStopCancelledWait: true, largePayloadsBounded: true,
                popupReport: { bridge: 'undefined', require: 'undefined' },
                report: { bridge: 'undefined', require: 'undefined' },
            });
            expect(result.actions.slice(0, 5)).toEqual(['open', 'snapshot', 'type', 'click', 'read']);
            expect(result.highDpiViewport.pixelRatio).toBeGreaterThanOrEqual(2);
            expect(result.highDpiViewport.physicalWidth).toBeGreaterThan(1280);
            expect(result.screenshot.width).toBeGreaterThan(0);
            expect(result.screenshot.width).toBeLessThanOrEqual(1280);
            expect(result.report.events).toContainEqual({ type: 'input', trusted: true });
            expect(result.report.events).toContainEqual({ type: 'click', trusted: true });
            expect(result.popupReport.events).toContainEqual({ type: 'input', trusted: true });
            expect(result.popupReport.events).toContainEqual({ type: 'click', trusted: true });
        } finally {
            await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
        }
    }, 110_000);
});
