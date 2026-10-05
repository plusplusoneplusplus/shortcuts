import { afterEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const skip = (!!process.env.CI && process.env.COC_DESKTOP_E2E !== '1') || (process.platform === 'linux' && !process.env.DISPLAY) || !existsSync(path.join(here, '..', '..', 'dist', 'browser-view-host.js'));
const engines = process.platform === 'win32' && process.arch === 'x64' ? ['electron', 'webview2'] : ['electron'];
const temporary: string[] = [];

async function scenario(engine: string, userData: string, ...args: string[]) {
    return new Promise<Map<string, Record<string, any>>>((resolve, reject) => {
        const env = { ...process.env, COC_BROWSER_E2E_ENGINE: engine, COC_BROWSER_E2E_USER_DATA: userData };
        delete env.ELECTRON_RUN_AS_NODE;
        const electron = createRequire(import.meta.url)('electron') as string;
        const child = spawn(electron, [...(process.env.COC_DESKTOP_E2E_NO_SANDBOX === '1' ? ['--no-sandbox'] : []), path.join(here, 'browser-engines-runner.cjs'), ...args], { env });
        let output = '';
        let errors = '';
        child.stdout.on('data', data => { output += data; });
        child.stderr.on('data', data => { errors += data; });
        const timer = setTimeout(() => { child.kill(); reject(new Error(`Browser engine scenario timed out.\n${output}\n${errors}`)); }, 75_000);
        child.on('error', error => { clearTimeout(timer); reject(error); });
        child.on('exit', code => {
            clearTimeout(timer);
            if (code !== 0) { reject(new Error(`Browser engine scenario exited ${code}.\n${output}\n${errors}`)); return; }
            const records = new Map<string, Record<string, any>>();
            for (const line of output.split('\n').filter(line => line.startsWith('E2E::'))) {
                const record = JSON.parse(line.slice(5));
                records.set(record.step, record);
            }
            resolve(records);
        });
    });
}

afterEach(() => { temporary.forEach(dir => rmSync(dir, { recursive: true, force: true })); temporary.length = 0; });

describe.skipIf(skip).each(engines)('%s live desktop browser contract', engine => {
    it.skipIf(process.platform !== 'win32')('keeps native keyboard input in the composer after clicking away from the browser and updating layout', async () => {
        const directory = mkdtempSync(path.join(os.tmpdir(), 'coc-browser-focus-'));
        temporary.push(directory);
        const steps = await scenario(engine, directory, '--focus-check');
        expect(steps.get('browser-keyboard')?.value).toBe('/');
        expect(steps.get('composer-click'), JSON.stringify([...steps])).toMatchObject({ value: '/', active: 'composer', focused: true });
        expect(steps.get('composer-layout')).toMatchObject({ value: '//', browserInput: '/' });
        expect(steps.get('composer-refocus')?.value).toBe(engine === 'webview2' ? '////' : '///');
    }, 90_000);

    it('supports navigation, popups, security policy, profiles, mixed engines and explicit cleanup', async () => {
        const directory = mkdtempSync(path.join(os.tmpdir(), 'coc-browser-engines-'));
        temporary.push(directory);
        const steps = await scenario(engine, directory);
        expect(steps.get('open')?.result).toEqual({ ok: true, engine });
        expect(steps.get('open')?.report).toMatchObject({ bridge: 'undefined', require: 'undefined', storage: null });
        expect(steps.get('focus')?.focused).toBe(true);
        expect(steps.get('history')?.back).toMatchObject({ title: 'Home', canGoForward: true });
        expect(steps.get('history')?.forward).toMatchObject({ title: 'Second' });
        expect(steps.get('navigation')?.failure.error).toBeTruthy();
        expect(steps.get('navigation')?.failure.url).toMatch(/:1\/failed$/);
        expect(steps.get('navigation')?.retried).toMatchObject({ title: 'Home', loading: false });
        expect(steps.get('permissions')?.report.permission).toBe('denied');
        expect(steps.get('permissions')?.refused.ok).toBe(false);
        expect(steps.get('popup')?.report.popupMessage).toBe('authenticated');
        expect(steps.get('popup')?.popup.cookie).toContain('fixture=remembered');
        expect(steps.get('sharing')?.report.storage).toBe('stored');
        expect(steps.get('sharing')?.foreign).toEqual({ ok: false, reason: 'not-found' });
        if (steps.has('mixed')) {
            expect(steps.get('mixed')?.engine).not.toBe(engine);
            expect(steps.get('mixed')?.report).toMatchObject({ storage: null, cookie: '' });
            expect(steps.get('mixed')?.existing.engine).toBe(engine);
        }
        expect(steps.get('related')?.result).toEqual({ ok: true, engine });
        expect(steps.get('download')?.download.ok).toBe(true);
        expect(steps.get('cancel')?.result).toEqual({ ok: false, reason: 'cancelled' });
        expect(steps.get('cancel')?.tab).toEqual({ ok: true, engine });
        if (engine === 'webview2') expect(steps.get('profile-lock')?.result).toMatchObject({ ok: false, reason: 'profile-locked' });
        const restart = await scenario(engine, directory, '--restart-check');
        expect(restart.get('restart')).toMatchObject({ engine, history: false, preference: engine, report: { storage: 'stored' } });
        expect(restart.get('restart')?.report.cookie).toContain('fixture=remembered');
        expect(restart.get('clear')?.result).toEqual({ ok: true });
        expect(restart.get('clear')?.firstWindowClosed).toContainEqual({ viewId: 'main', engine });
        expect(restart.get('clear')?.secondWindowClosed).toContainEqual({ viewId: 'other', engine });
        expect(restart.get('clear')?.closedNavigation).toEqual({ ok: false, reason: 'not-found' });
        if (restart.get('clear')?.preserved) expect(restart.get('clear')?.preserved).toMatchObject({ ok: true, engine: engine === 'electron' ? 'webview2' : 'electron' });
        const cleared = await scenario(engine, directory, '--restart-check', '--after-clear');
        expect(cleared.get('restart')?.report).toMatchObject({ storage: null, cookie: '' });
    }, 180_000);
});
