/**
 * End-to-end test for the modernised screenshot annotation editor, in a REAL
 * Electron instance: real screen capture, real crop overlay, the real frameless
 * editor `BrowserWindow`, the real `data:` URL page and preload bridge, driven
 * with real mouse and keyboard input.
 *
 * This is the automated form of the three manual demos in the goal spec:
 *   - AC-01: capture → drag a crop → the editor opens with no OS title bar, and
 *     the toolbar is a floating pill that owns the window's drag region.
 *   - AC-02: the tools are inline-SVG icons with tooltips, the active tool is
 *     visually distinct, every control is reachable with a visible focus ring,
 *     and the page fetches nothing.
 *   - AC-03: Done attaches without a file dialog; Save opens one on demand,
 *     writes a real PNG, and leaves the editor open.
 *
 * The scenario lives in `annotate-editor-runner.cjs` (an Electron app main
 * script that emits one `E2E::{json}` line per step); this file spawns it and
 * asserts. Environment gates match the find-bar / pop-out pair:
 *  - needs the compiled `dist/` (run `npm run build` first — CI does);
 *  - needs a display: skipped on headless Linux (no DISPLAY). `xvfb-run -a npx
 *    vitest run test/e2e` supplies one;
 *  - skipped on CI unless COC_DESKTOP_E2E=1, so a hung GUI can never wedge the
 *    unit-test job.
 *
 * On a Linux box whose `chrome-sandbox` helper is not setuid-root, Electron
 * aborts before the app starts; set COC_DESKTOP_E2E_NO_SANDBOX=1 to pass
 * `--no-sandbox` there. Nothing in this scenario depends on the sandbox.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANNOTATION_TOOLBAR_HEIGHT, ANNOTATION_STAGE_PADDING } from '../../src/screenshot-capture';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.join(here, '..', '..');
const runnerPath = path.join(here, 'annotate-editor-runner.cjs');
const distHost = path.join(pkgRoot, 'dist', 'screenshot-capture-host.js');

function resolveElectronPath(): string {
    return createRequire(import.meta.url)('electron') as unknown as string;
}

const onCiWithoutOptIn = !!process.env.CI && process.env.COC_DESKTOP_E2E !== '1';
const headlessLinux = process.platform === 'linux' && !process.env.DISPLAY;
const skip = onCiWithoutOptIn || headlessLinux || !existsSync(distHost);

interface StepRecord {
    step: string;
    [key: string]: unknown;
}

function runScenario(): Promise<{ steps: Map<string, StepRecord>; exitCode: number | null; raw: string }> {
    return new Promise((resolve, reject) => {
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        const args = process.env.COC_DESKTOP_E2E_NO_SANDBOX === '1'
            ? ['--no-sandbox', runnerPath]
            : [runnerPath];
        const child = spawn(resolveElectronPath(), args, { env });
        let out = '';
        let err = '';
        child.stdout.on('data', (d) => { out += String(d); });
        child.stderr.on('data', (d) => { err += String(d); });
        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            reject(new Error(`E2E runner timed out.\nstdout:\n${out}\nstderr:\n${err}`));
        }, 90_000);
        child.on('error', (e) => { clearTimeout(timer); reject(e); });
        child.on('exit', (code) => {
            clearTimeout(timer);
            const steps = new Map<string, StepRecord>();
            for (const line of out.split('\n')) {
                if (line.startsWith('E2E::')) {
                    const record = JSON.parse(line.slice('E2E::'.length)) as StepRecord;
                    steps.set(record.step, record);
                }
            }
            resolve({ steps, exitCode: code, raw: out + err });
        });
    });
}

describe.skipIf(skip)('annotation editor E2E (real Electron, real capture → crop → editor)', () => {
    let steps: Map<string, StepRecord>;
    let exitCode: number | null;
    let raw: string;

    beforeAll(async () => {
        ({ steps, exitCode, raw } = await runScenario());
    }, 120_000);

    it('runs the full capture → annotate → save → done → esc scenario', () => {
        expect(steps.get('error'), raw).toBeUndefined();
        expect(exitCode, raw).toBe(0);
        expect([...steps.keys()]).toEqual([
            'framed-control', 'editor-open', 'chrome', 'icons', 'affordances',
            'draw', 'canvas-fits', 'save-once', 'save-cancelled', 'undo', 'done', 'esc', 'finished',
        ]);
    });

    // ── AC-01 ────────────────────────────────────────────────────────────────

    it('opens the editor from a real crop with no OS title bar', () => {
        const control = steps.get('framed-control')!;
        const editor = steps.get('editor-open')!;
        // A framed window on this box really does reserve chrome — so `frameless`
        // discriminates rather than being true for every window.
        expect(control.bounds).not.toEqual(control.content);

        expect(editor.frameless).toBe(true);
        expect(editor.bounds).toEqual(editor.content);
        expect(editor).toMatchObject({ visible: true, resizable: true, urlHasToolbar: true });
        // The crop really made it into the canvas at its device resolution.
        const canvas = editor.canvas as { w: number; h: number; cssW: number };
        expect(canvas.w).toBeGreaterThan(100);
        expect(canvas.h).toBeGreaterThan(100);
    });

    it('floats one rounded, translucent, blurred pill instead of a full-width bar', () => {
        const chrome = steps.get('chrome')!;
        expect(chrome).toMatchObject({
            position: 'fixed',
            hasShadow: true,
            hasBlur: true,
            translucent: true,
            centered: true,
            fullWidthBar: false,
            bottomBorder: false,
        });
        expect(chrome.radius as number).toBeGreaterThanOrEqual(8);
    });

    it('keeps the pill inside its reserved inset over a full-height stage', () => {
        const chrome = steps.get('chrome')!;
        expect(chrome.stageFullHeight).toBe(true);
        expect(chrome.stagePadTop).toBe(ANNOTATION_TOOLBAR_HEIGHT);
        // The pill never covers the image.
        expect(chrome.pillBottom as number).toBeLessThanOrEqual(ANNOTATION_TOOLBAR_HEIGHT);
    });

    it('makes the pill the drag region and every control no-drag', () => {
        const chrome = steps.get('chrome')!;
        expect(chrome.barRegion).toBe('drag');
        const regions = chrome.controlRegions as string[];
        expect(regions.length).toBe(10);
        expect(regions.filter((r) => !r.endsWith('=no-drag'))).toEqual([]);
    });

    // ── AC-02 ────────────────────────────────────────────────────────────────

    it('renders every tool as real inline SVG carrying its old label as a tooltip', () => {
        const icons = steps.get('icons')!;
        const expected: Record<string, string> = {
            'annotate-tool-pen': 'Pen',
            'annotate-tool-line': 'Line',
            'annotate-tool-rect': 'Rect',
            'annotate-tool-arrow': 'Arrow',
        };
        for (const [id, label] of Object.entries(expected)) {
            const icon = icons[id] as Record<string, unknown>;
            expect(icon.svgNs, id).toBe('http://www.w3.org/2000/svg');
            expect(icon.shapes as number, id).toBeGreaterThan(0);
            expect({ w: icon.w, h: icon.h }, id).toEqual({ w: 16, h: 16 });
            expect(icon.title, id).toBe(label);
            expect(icon.aria, id).toBe(label);
            // Icon-only: the text label is gone from the button face.
            expect(icon.text, id).toBe('');
        }
        for (const [id, word] of [['annotate-undo', 'Undo'], ['annotate-save', 'Save']]) {
            const icon = icons[id] as Record<string, unknown>;
            expect(icon.svgNs, id).toBe('http://www.w3.org/2000/svg');
            expect(icon.shapes as number, id).toBeGreaterThan(0);
            expect(String(icon.title), id).toContain(word);
            expect(String(icon.aria), id).toContain(word);
            expect(icon.text, id).toBe('');
        }
        // Undo's tooltip still advertises the keyboard path.
        expect(String((icons['annotate-undo'] as Record<string, unknown>).title)).toContain('Ctrl/Cmd+Z');
        // Cancel/Done keep readable labels — with no title bar, Cancel is the
        // only close path, so it must stay obvious.
        expect(icons.cancelText).toBe('Cancel');
        expect(icons.doneText).toBe('Done');
    });

    it('fetches nothing over the network', () => {
        expect(steps.get('icons')!.resourceUrls).toEqual([]);
    });

    it('draws the active tool distinctly and gives every control a focus ring', () => {
        const aff = steps.get('affordances')!;
        expect(aff.activeClass).toBe('tool active');
        expect(aff.activeBg).toBe('rgb(0, 120, 212)'); // the SPA's VS Code accent
        expect(aff.activeBg).not.toBe(aff.inactiveBg);
        expect(aff.focusRuleCount as number).toBeGreaterThan(0);
        expect(aff.hoverRuleCount as number).toBeGreaterThan(0);

        const focusables = aff.focusables as Array<{ id: string; ring: string; tabIndex: number }>;
        expect(focusables.map((f) => f.id)).toEqual([
            'annotate-tool-pen', 'annotate-tool-line', 'annotate-tool-rect', 'annotate-tool-arrow',
            'annotate-color', 'annotate-width', 'annotate-undo', 'annotate-save',
            'annotate-cancel', 'annotate-done',
        ]);
        for (const f of focusables) {
            expect(f.tabIndex, f.id).toBe(0);
            expect(f.ring, f.id).toBe('2px solid');
        }
    });

    it('selects exactly one tool at a time and paints real strokes', () => {
        const draw = steps.get('draw')!;
        expect(draw.changed).toBe(true);
        expect(draw.drawn as number).toBeGreaterThan(draw.blank as number);
        const active = draw.activeAfterClick as Record<string, string[]>;
        for (const [tool, list] of Object.entries(active)) {
            expect(list, tool).toEqual([tool]);
        }
    });

    it('lays the image fully inside the padded stage — no clipping, no scrollbars', () => {
        const fits = steps.get('canvas-fits')!;
        expect(fits).toMatchObject({
            overflowsLeft: false,
            overflowsRight: false,
            overflowsTop: false,
            overflowsBottom: false,
            scrolls: false,
            aspectPreserved: true,
        });
        expect(fits.stagePad).toEqual({
            l: ANNOTATION_STAGE_PADDING,
            r: ANNOTATION_STAGE_PADDING,
            t: ANNOTATION_TOOLBAR_HEIGHT,
            b: ANNOTATION_STAGE_PADDING,
        });
    });

    // ── AC-03 ────────────────────────────────────────────────────────────────

    it('saves on demand to a real PNG and leaves the editor open', () => {
        const save = steps.get('save-once')!;
        expect(save).toMatchObject({
            dialogCalls: 1,
            dialogTitle: 'Save Screenshot',
            editorAlive: true,
            fileWritten: true,
            isPng: true,
        });
        expect(save.fileBytes as number).toBeGreaterThan(0);
        expect(save.defaultPath).toMatch(/^screenshot-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.png$/);
        // Saving is not finishing: nothing has been dispatched yet.
        expect(save.attachedSoFar).toBe(0);
    });

    it('writes nothing when the Save dialog is cancelled, and stays open', () => {
        expect(steps.get('save-cancelled')).toMatchObject({
            dialogCalls: 2,
            cancelFileWritten: false,
            editorAlive: true,
        });
    });

    it('still undoes with Ctrl+Z after a save', () => {
        expect(steps.get('undo')!.changed).toBe(true);
    });

    it('finishes to the clipboard and the chat draft with no file dialog', () => {
        const done = steps.get('done')!;
        // The whole point of AC-03: Done opens no Save-As.
        expect(done.dialogsAfterDone).toBe(done.dialogsBeforeDone);
        expect(done.editorClosed).toBe(true);
        expect(done.clipboardHasImage).toBe(true);
        expect(done.channels).toEqual(['coc-desktop:screenshot-attach']);
        expect(done.attachPayloadPrefix).toMatch(/^data:image\/png;base64,/);
    });

    it('closes on Esc without saving or dispatching — the only other close path', () => {
        expect(steps.get('esc')).toMatchObject({
            editorClosed: true,
            newDialogs: 0,
            newChannels: 0,
        });
    });
});
