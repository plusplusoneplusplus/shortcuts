import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const skip = (!!process.env.CI && process.env.COC_DESKTOP_E2E !== '1')
    || (process.platform === 'linux' && !process.env.DISPLAY)
    || !existsSync(path.join(here, '../../dist/browser-view-host.js'));

describe.skipIf(skip)('real server → SPA → preload → main browser relay', () => {
    it('opens a closed panel, snapshots/types/clicks/reads/evaluates and returns bounded/cropped binary images', async () => {
        const directory = mkdtempSync(path.join(process.cwd(), '.browser-relay-e2e-'));
        try {
            const result = await new Promise<Record<string, any>>((resolve, reject) => {
                const env = { ...process.env, COC_BROWSER_E2E_USER_DATA: directory };
                delete env.ELECTRON_RUN_AS_NODE;
                const electron = createRequire(import.meta.url)('electron') as string;
                const args = [...(process.env.COC_DESKTOP_E2E_NO_SANDBOX === '1' ? ['--no-sandbox'] : []), path.join(here, 'browser-control-relay-runner.cjs')];
                const child = spawn(electron, args, { env });
                let output = '', errors = '';
                child.stdout.on('data', data => { output += data; });
                child.stderr.on('data', data => { errors += data; });
                const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`Relay fixture timed out\n${output}\n${errors}`)); }, 60_000);
                child.on('error', error => { clearTimeout(timer); reject(error); });
                child.on('exit', code => {
                    clearTimeout(timer);
                    const line = output.split('\n').find(value => value.startsWith('E2E::'));
                    if (code !== 0 || !line) reject(new Error(`Relay fixture exited ${code}\n${output}\n${errors}`));
                    else resolve(JSON.parse(line.slice(5)));
                });
            });
            expect(result).toMatchObject({ initialTabs: 0, tabs: 1, selected: true, value: { saved: 'Fixture value' }, imageType: 'image/jpeg', popupSelected: true });
            expect(result).toMatchObject({ disposed: true, serverClosed: true });
            expect(result.read).toContain('# Local fixture');
            expect(result.read).toContain('Fixture value');
            expect(result.popupRead).toContain('# Local fixture');
            expect(result.size.width).toBeLessThanOrEqual(1280);
            expect(result.size.width).toBeGreaterThan(0);
            expect(result.cropSize.width).toBeGreaterThan(0);
            expect(result.cropSize.width).toBeLessThan(result.size.width);
        } finally { await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
    }, 75_000);
});
