import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const skip = (!!process.env.CI && process.env.COC_DESKTOP_E2E !== '1')
    || (process.platform === 'linux' && !process.env.DISPLAY)
    || !existsSync(path.join(here, '../../dist/browser-annotation-dom.js'));

describe.skipIf(skip)('shared annotation injection in real Electron', () => {
    it('isolates closed-shadow styles, swallows trusted clicks, selects an area and tears down on Escape', async () => {
        const directory = mkdtempSync(path.join(tmpdir(), 'coc-annotation-'));
        try {
            const output = await new Promise<string>((resolve, reject) => {
                const env = { ...process.env, COC_BROWSER_E2E_USER_DATA: directory };
                delete env.ELECTRON_RUN_AS_NODE;
                const electron = createRequire(import.meta.url)('electron') as string;
                const args = [...(process.env.COC_DESKTOP_E2E_NO_SANDBOX === '1' ? ['--no-sandbox'] : []), path.join(here, 'browser-annotation-dom-runner.cjs')];
                const child = spawn(electron, args, { env });
                let stdout = '';
                let stderr = '';
                child.stdout.on('data', data => { stdout += data; });
                child.stderr.on('data', data => { stderr += data; });
                const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`Annotation fixture timed out\n${stdout}\n${stderr}`)); }, 30_000);
                child.on('error', error => { clearTimeout(timer); reject(error); });
                child.on('exit', code => {
                    clearTimeout(timer);
                    const line = stdout.split('\n').find(value => value.startsWith('E2E::'));
                    if (code !== 0 || !line) reject(new Error(`Annotation fixture exited ${code}\n${stdout}\n${stderr}`));
                    else resolve(line.slice(5));
                });
            });
            expect(JSON.parse(output)).toMatchObject({
                element: { active: true, events: [{ type: 'selection', kind: 'element', tag: 'button', rect: { x: 40, y: 60, width: 120, height: 40 },
                    page: { title: 'Annotation fixture', viewport: { width: expect.any(Number), height: expect.any(Number), devicePixelRatio: expect.any(Number) }, url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/$/) },
                    element: { selector: 'button:nth-of-type(1)', shadowHosts: [], tag: 'button', id: '', classes: [], text: 'Pick me', outerHTML: '<button>Pick me</button>' },
                }] },
                styles: { closed: true, position: 'fixed', display: 'block', background: 'rgba(0, 0, 0, 0)',
                    outlineBackground: 'rgba(37, 99, 235, 0.12)', outlineBorder: '2px', label: 'button 120 x 40' },
                isolation: { clicks: 0, private: true },
                comment: { active: true, events: [{ type: 'comment', id: '1', number: 1, comment: 'Fix this element', selection: { kind: 'element',
                    rect: { x: 40, y: 60, width: 120, height: 40 }, element: { text: 'Pick me' } } }] },
                pinStyles: { text: '1', background: 'rgb(37, 99, 235)', private: true },
                edit: { active: true, events: [{ type: 'comment', id: '1', number: 1, comment: 'Fix this element revised',
                    selection: { immediate: false, element: { text: 'Pick me' } } }] },
                deleted: { active: true, events: [{ type: 'delete', id: '1' }] },
                pinsRemoved: true,
                pageKeys: 0,
                editorEscape: { active: true, events: [] },
                area: { active: true, events: [{ type: 'selection', kind: 'area', rect: { x: 200, y: 200, width: 100, height: 80 }, page: { title: 'Annotation fixture' } }] },
                released: 1,
                escaped: { active: false, events: [{ type: 'exit', reason: 'escape' }] },
                removed: true,
                transport: { selection: 'element', rect: { x: 40, y: 60, width: 120, height: 40 },
                    private: true, endings: ['stop'], navigationEndings: ['navigation'], noReinstall: true },
            });
        } finally {
            await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
        }
    }, 45_000);
});
