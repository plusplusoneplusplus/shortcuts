/**
 * Tests for the screenshot-capture Electron-free helpers (AC-01).
 *
 * Covers:
 *   - the exported global accelerator constant;
 *   - `registerScreenshotShortcut` against a MOCK `globalShortcut` — success,
 *     the "already in use" (returns false) path, and the throwing path — proving
 *     it binds `onTrigger` and never crashes;
 *   - `unregisterScreenshotShortcut` releasing the accelerator;
 *   - source-level assertions that `main.ts` wires register-on-ready and
 *     unregister-on-`will-quit`, and that there is exactly one
 *     `globalShortcut.register` call in the source (code-search DoD).
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
    SCREENSHOT_ACCELERATOR,
    GlobalShortcutLike,
    registerScreenshotShortcut,
    unregisterScreenshotShortcut,
    SCREENSHOT_OVERLAY_INIT_CHANNEL,
    SCREENSHOT_CROP_CHANNEL,
    SCREENSHOT_CANCEL_CHANNEL,
    normalizeCropRect,
    scaleCropRect,
    resolveScreenCaptureAccess,
    buildOverlayPageScript,
    buildOverlayHtml,
    SCREENSHOT_ANNOTATE_INIT_CHANNEL,
    SCREENSHOT_ANNOTATE_DONE_CHANNEL,
    SCREENSHOT_ANNOTATE_CANCEL_CHANNEL,
    ANNOTATION_TOOLBAR_HEIGHT,
    AnnotationStroke,
    drawAnnotationStroke,
    renderAnnotationScene,
    exportAnnotatedPng,
    fitAnnotationWindowSize,
    buildAnnotationPageScript,
    buildAnnotationHtml,
    SCREENSHOT_ATTACH_CHANNEL,
    AnnotationSinks,
    dispatchAnnotationSinks,
    buildScreenshotFileName,
} from '../src/screenshot-capture';

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src');

function readSrc(file: string): string {
    return readFileSync(path.join(srcDir, file), 'utf8');
}

/** A minimal mock of Electron's globalShortcut that records register calls. */
function mockGlobalShortcut(registerResult: boolean | (() => never)): {
    gs: GlobalShortcutLike;
    register: ReturnType<typeof vi.fn>;
    unregisterAll: ReturnType<typeof vi.fn>;
} {
    const register = vi.fn((_accelerator: string, _cb: () => void) => {
        if (typeof registerResult === 'function') {
            return registerResult();
        }
        return registerResult;
    });
    const unregisterAll = vi.fn();
    return { gs: { register, unregisterAll } as GlobalShortcutLike, register, unregisterAll };
}

describe('SCREENSHOT_ACCELERATOR', () => {
    it('is the documented default (avoids the macOS Cmd+Shift+3/4/5 shortcuts)', () => {
        expect(SCREENSHOT_ACCELERATOR).toBe('CommandOrControl+Shift+2');
    });
});

describe('registerScreenshotShortcut', () => {
    it('registers the default accelerator and returns true on success', () => {
        const { gs, register } = mockGlobalShortcut(true);
        const onTrigger = vi.fn();
        const result = registerScreenshotShortcut(gs, { onTrigger });
        expect(result).toBe(true);
        expect(register).toHaveBeenCalledWith(SCREENSHOT_ACCELERATOR, onTrigger);
    });

    it('honours a custom accelerator override', () => {
        const { gs, register } = mockGlobalShortcut(true);
        const onTrigger = vi.fn();
        registerScreenshotShortcut(gs, { accelerator: 'CommandOrControl+Alt+9', onTrigger });
        expect(register).toHaveBeenCalledWith('CommandOrControl+Alt+9', onTrigger);
    });

    it('invokes onTrigger when the bound accelerator fires', () => {
        const { gs, register } = mockGlobalShortcut(true);
        const onTrigger = vi.fn();
        registerScreenshotShortcut(gs, { onTrigger });
        // Fire the callback the way Electron would on a hotkey press.
        const boundCallback = register.mock.calls[0][1] as () => void;
        boundCallback();
        expect(onTrigger).toHaveBeenCalledTimes(1);
    });

    it('warns and returns false when the combo is already in use (register → false)', () => {
        const { gs } = mockGlobalShortcut(false);
        const onWarn = vi.fn();
        const result = registerScreenshotShortcut(gs, { onTrigger: vi.fn(), onWarn });
        expect(result).toBe(false);
        expect(onWarn).toHaveBeenCalledTimes(1);
        expect(onWarn.mock.calls[0][0]).toContain(SCREENSHOT_ACCELERATOR);
    });

    it('never throws when register throws — warns and returns false', () => {
        const { gs } = mockGlobalShortcut(() => {
            throw new Error('registration blew up');
        });
        const onWarn = vi.fn();
        let result: boolean | undefined;
        expect(() => {
            result = registerScreenshotShortcut(gs, { onTrigger: vi.fn(), onWarn });
        }).not.toThrow();
        expect(result).toBe(false);
        expect(onWarn).toHaveBeenCalledTimes(1);
        expect(onWarn.mock.calls[0][0]).toContain('registration failed');
    });

    it('tolerates a missing onWarn sink on the failure path', () => {
        const { gs } = mockGlobalShortcut(false);
        expect(() => registerScreenshotShortcut(gs, { onTrigger: vi.fn() })).not.toThrow();
    });
});

describe('unregisterScreenshotShortcut', () => {
    it('releases every registered accelerator via unregisterAll', () => {
        const { gs, unregisterAll } = mockGlobalShortcut(true);
        unregisterScreenshotShortcut(gs);
        expect(unregisterAll).toHaveBeenCalledTimes(1);
    });
});

describe('main.ts capture-accelerator wiring (code-search DoD)', () => {
    const mainSrc = readSrc('main.ts');

    it('imports globalShortcut from electron', () => {
        expect(mainSrc).toMatch(/import\s*\{[^}]*\bglobalShortcut\b[^}]*\}\s*from\s*'electron'/s);
    });

    it('registers the shortcut on app ready (inside bootstrap) and only once', () => {
        // The registration is funnelled through the once-guarded setup helper,
        // which bootstrap() calls on app ready.
        expect(mainSrc).toContain('function setupScreenshotShortcut()');
        expect(mainSrc).toContain('registerScreenshotShortcut(globalShortcut');
        expect(mainSrc).toContain('setupScreenshotShortcut();');
    });

    it('unregisters the shortcut on will-quit', () => {
        expect(mainSrc).toMatch(/will-quit/);
        expect(mainSrc).toContain('unregisterScreenshotShortcut(globalShortcut)');
    });

    it('has exactly one globalShortcut.register call across the source', () => {
        const files = ['main.ts', 'screenshot-capture.ts', 'screenshot-capture-host.ts'];
        const combined = files.map(readSrc).join('\n');
        const registerCalls = combined.match(/globalShortcut\.register\b/g) ?? [];
        expect(registerCalls).toHaveLength(1);
        const unregisterCalls = combined.match(/globalShortcut\.unregisterAll\b/g) ?? [];
        expect(unregisterCalls).toHaveLength(1);
    });
});

// ─── AC-02: capture + drag-to-crop ──────────────────────────────────────────

describe('AC-02 IPC channel names', () => {
    it('are distinct and namespaced', () => {
        const channels = [
            SCREENSHOT_OVERLAY_INIT_CHANNEL,
            SCREENSHOT_CROP_CHANNEL,
            SCREENSHOT_CANCEL_CHANNEL,
        ];
        expect(new Set(channels).size).toBe(channels.length);
        for (const c of channels) {
            expect(c.startsWith('coc-desktop:')).toBe(true);
        }
    });
});

describe('normalizeCropRect (AC-02 crop math, DoD #2)', () => {
    const bounds = { width: 1000, height: 800 };

    it('normalizes a top-left → bottom-right drag into {x,y,width,height}', () => {
        expect(normalizeCropRect({ x: 100, y: 100 }, { x: 300, y: 250 }, bounds)).toEqual({
            x: 100,
            y: 100,
            width: 200,
            height: 150,
        });
    });

    it('is drag-direction independent (reversed drag → same rect)', () => {
        const forward = normalizeCropRect({ x: 100, y: 100 }, { x: 300, y: 250 }, bounds);
        const reversed = normalizeCropRect({ x: 300, y: 250 }, { x: 100, y: 100 }, bounds);
        expect(reversed).toEqual(forward);
    });

    it('clamps a drag that runs past the overlay bounds', () => {
        expect(normalizeCropRect({ x: -50, y: -50 }, { x: 1200, y: 900 }, bounds)).toEqual({
            x: 0,
            y: 0,
            width: 1000,
            height: 800,
        });
    });

    it('rounds fractional coordinates to whole pixels', () => {
        expect(normalizeCropRect({ x: 100.4, y: 100.6 }, { x: 300.2, y: 250.9 }, bounds)).toEqual({
            x: 100,
            y: 101,
            width: 200,
            height: 150,
        });
    });

    it('returns null for a zero-area click (start === end)', () => {
        expect(normalizeCropRect({ x: 100, y: 100 }, { x: 100, y: 100 }, bounds)).toBeNull();
    });

    it('returns null for a collapsed line (zero height / zero width)', () => {
        expect(normalizeCropRect({ x: 100, y: 100 }, { x: 300, y: 100 }, bounds)).toBeNull();
        expect(normalizeCropRect({ x: 100, y: 100 }, { x: 100, y: 250 }, bounds)).toBeNull();
    });

    it('returns null for a sub-pixel selection', () => {
        expect(normalizeCropRect({ x: 100, y: 100 }, { x: 100.4, y: 100.4 }, bounds)).toBeNull();
    });
});

describe('scaleCropRect (AC-02 CSS→device scaling)', () => {
    it('scales a rect by the display scale factor', () => {
        expect(scaleCropRect({ x: 10, y: 20, width: 30, height: 40 }, 2)).toEqual({
            x: 20,
            y: 40,
            width: 60,
            height: 80,
        });
    });

    it('is identity at scale 1', () => {
        const rect = { x: 5, y: 6, width: 7, height: 8 };
        expect(scaleCropRect(rect, 1)).toEqual(rect);
    });

    it('falls back to scale 1 for a non-positive factor', () => {
        const rect = { x: 5, y: 6, width: 7, height: 8 };
        expect(scaleCropRect(rect, 0)).toEqual(rect);
        expect(scaleCropRect(rect, -2)).toEqual(rect);
    });

    it('never rounds width/height below 1 px', () => {
        expect(scaleCropRect({ x: 0, y: 0, width: 1, height: 1 }, 0.4)).toEqual({
            x: 0,
            y: 0,
            width: 1,
            height: 1,
        });
    });
});

describe('resolveScreenCaptureAccess (AC-02 permission gate, DoD #3)', () => {
    it('allows capture on non-macOS regardless of status', () => {
        expect(resolveScreenCaptureAccess('win32', 'denied')).toEqual({ allowed: true });
        expect(resolveScreenCaptureAccess('linux', undefined)).toEqual({ allowed: true });
    });

    it('allows capture on macOS when Screen Recording is granted', () => {
        expect(resolveScreenCaptureAccess('darwin', 'granted')).toEqual({ allowed: true });
    });

    it('blocks capture on macOS when permission is denied, with a clear message', () => {
        const access = resolveScreenCaptureAccess('darwin', 'denied');
        expect(access.allowed).toBe(false);
        expect(access.message).toContain('Screen Recording');
        expect(access.detail).toBeTruthy();
        expect(access.openSettings).toBe(true);
    });

    it('blocks capture on macOS for not-determined / restricted / unknown status', () => {
        for (const status of ['not-determined', 'restricted', 'unknown', undefined] as const) {
            expect(resolveScreenCaptureAccess('darwin', status).allowed).toBe(false);
        }
    });
});

// --- Overlay page script harness -----------------------------------------------

interface OverlayEl {
    style: Record<string, string>;
    textContent: string;
    src: string;
}

function makeOverlayEl(): OverlayEl {
    return { style: {}, textContent: '', src: '' };
}

interface OverlayHarness {
    els: Record<string, OverlayEl>;
    crop: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
    init: (payload: unknown) => void;
    fire: (type: string, e: unknown) => void;
}

function runOverlay(withApi = true): OverlayHarness {
    const winListeners: Record<string, Array<(e: unknown) => void>> = {};
    const crop = vi.fn();
    const cancel = vi.fn();
    let initCb: ((payload: unknown) => void) | null = null;
    const els: Record<string, OverlayEl> = {
        'screenshot-overlay-image': makeOverlayEl(),
        'screenshot-overlay-mask': makeOverlayEl(),
        'screenshot-overlay-selection': makeOverlayEl(),
        'screenshot-overlay-dimensions': makeOverlayEl(),
        'screenshot-overlay-hint': makeOverlayEl(),
    };
    const win: Record<string, unknown> = {
        innerWidth: 1000,
        innerHeight: 800,
        addEventListener(type: string, cb: (e: unknown) => void) {
            (winListeners[type] ||= []).push(cb);
        },
    };
    if (withApi) {
        win.cocDesktop = {
            screenshot: {
                onOverlayInit: (cb: (payload: unknown) => void) => {
                    initCb = cb;
                    return () => {};
                },
                crop,
                cancel,
            },
        };
    }
    const doc = { getElementById: (id: string) => els[id] };
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    new Function('window', 'document', buildOverlayPageScript())(win, doc);
    return {
        els,
        crop,
        cancel,
        init: (payload) => initCb && initCb(payload),
        fire: (type, e) => (winListeners[type] || []).forEach((f) => f(e)),
    };
}

describe('buildOverlayPageScript (overlay page)', () => {
    it('paints the frozen shot when the main process pushes it', () => {
        const h = runOverlay();
        h.init({ imageDataUrl: 'data:image/png;base64,AAAA' });
        expect(h.els['screenshot-overlay-image'].src).toBe('data:image/png;base64,AAAA');
    });

    it('a drag → mouse-up sends the normalized crop rectangle', () => {
        const h = runOverlay();
        h.fire('mousedown', { button: 0, clientX: 100, clientY: 100 });
        h.fire('mousemove', { button: 0, clientX: 300, clientY: 250 });
        h.fire('mouseup', { button: 0, clientX: 300, clientY: 250 });
        expect(h.crop).toHaveBeenCalledTimes(1);
        expect(h.crop).toHaveBeenCalledWith({ x: 100, y: 100, width: 200, height: 150 });
        expect(h.cancel).not.toHaveBeenCalled();
    });

    it('draws the live selection outline + dimensions during the drag', () => {
        const h = runOverlay();
        h.fire('mousedown', { button: 0, clientX: 100, clientY: 100 });
        // mousedown hides the full-screen mask and the hint.
        expect(h.els['screenshot-overlay-mask'].style.display).toBe('none');
        expect(h.els['screenshot-overlay-hint'].style.display).toBe('none');
        h.fire('mousemove', { button: 0, clientX: 300, clientY: 250 });
        const sel = h.els['screenshot-overlay-selection'];
        expect(sel.style.display).toBe('block');
        expect(sel.style.left).toBe('100px');
        expect(sel.style.top).toBe('100px');
        expect(sel.style.width).toBe('200px');
        expect(sel.style.height).toBe('150px');
        const dims = h.els['screenshot-overlay-dimensions'];
        expect(dims.style.display).toBe('block');
        expect(dims.textContent).toContain('200');
        expect(dims.textContent).toContain('150');
    });

    it('ignores a zero-area click (no crop, no cancel) and restores the mask', () => {
        const h = runOverlay();
        h.fire('mousedown', { button: 0, clientX: 100, clientY: 100 });
        h.fire('mouseup', { button: 0, clientX: 100, clientY: 100 });
        expect(h.crop).not.toHaveBeenCalled();
        expect(h.cancel).not.toHaveBeenCalled();
        // reset() re-shows the dim mask so the user can try again.
        expect(h.els['screenshot-overlay-mask'].style.display).toBe('block');
    });

    it('ESC cancels the capture with no crop', () => {
        const h = runOverlay();
        const e = { key: 'Escape', preventDefault: vi.fn() };
        h.fire('keydown', e);
        expect(h.cancel).toHaveBeenCalledTimes(1);
        expect(h.crop).not.toHaveBeenCalled();
        expect(e.preventDefault).toHaveBeenCalled();
    });

    it('right-click (contextmenu) cancels the capture', () => {
        const h = runOverlay();
        const e = { preventDefault: vi.fn() };
        h.fire('contextmenu', e);
        expect(h.cancel).toHaveBeenCalledTimes(1);
        expect(e.preventDefault).toHaveBeenCalled();
    });

    it('finishes exactly once — a later ESC after a crop is a no-op', () => {
        const h = runOverlay();
        h.fire('mousedown', { button: 0, clientX: 100, clientY: 100 });
        h.fire('mouseup', { button: 0, clientX: 300, clientY: 250 });
        h.fire('keydown', { key: 'Escape', preventDefault: vi.fn() });
        expect(h.crop).toHaveBeenCalledTimes(1);
        expect(h.cancel).not.toHaveBeenCalled();
    });

    it('ignores non-left mouse buttons for starting a drag', () => {
        const h = runOverlay();
        h.fire('mousedown', { button: 2, clientX: 100, clientY: 100 });
        h.fire('mouseup', { button: 2, clientX: 300, clientY: 250 });
        expect(h.crop).not.toHaveBeenCalled();
    });

    it('bails out cleanly when the preload screenshot bridge is absent', () => {
        expect(() => runOverlay(false)).not.toThrow();
    });
});

describe('buildOverlayHtml', () => {
    it('contains the elements the page script binds to, and the script itself', () => {
        const html = buildOverlayHtml();
        for (const id of [
            'screenshot-overlay-image',
            'screenshot-overlay-mask',
            'screenshot-overlay-selection',
            'screenshot-overlay-dimensions',
            'screenshot-overlay-hint',
        ]) {
            expect(html).toContain(`id="${id}"`);
        }
        expect(html).toContain('<script>');
        expect(html).toContain('normalizeCropRect');
    });
});

// ─── AC-03: custom `<canvas>` annotation window ─────────────────────────────

describe('AC-03 IPC channel names', () => {
    it('are distinct and namespaced', () => {
        const channels = [
            SCREENSHOT_ANNOTATE_INIT_CHANNEL,
            SCREENSHOT_ANNOTATE_DONE_CHANNEL,
            SCREENSHOT_ANNOTATE_CANCEL_CHANNEL,
        ];
        expect(new Set(channels).size).toBe(channels.length);
        for (const c of channels) {
            expect(c.startsWith('coc-desktop:')).toBe(true);
        }
    });

    it('do not collide with the AC-02 capture channels', () => {
        const all = [
            SCREENSHOT_OVERLAY_INIT_CHANNEL,
            SCREENSHOT_CROP_CHANNEL,
            SCREENSHOT_CANCEL_CHANNEL,
            SCREENSHOT_ANNOTATE_INIT_CHANNEL,
            SCREENSHOT_ANNOTATE_DONE_CHANNEL,
            SCREENSHOT_ANNOTATE_CANCEL_CHANNEL,
        ];
        expect(new Set(all).size).toBe(all.length);
    });
});

/** A recording 2D-context stub: captures every op + the settable draw state. */
interface CtxCall {
    op: string;
    args: unknown[];
}
function makeRecordingCtx() {
    const calls: CtxCall[] = [];
    const rec =
        (op: string) =>
        (...args: unknown[]) => {
            calls.push({ op, args });
        };
    return {
        calls,
        lineWidth: 0,
        strokeStyle: '',
        lineCap: '',
        lineJoin: '',
        save: rec('save'),
        restore: rec('restore'),
        beginPath: rec('beginPath'),
        moveTo: rec('moveTo'),
        lineTo: rec('lineTo'),
        stroke: rec('stroke'),
        clearRect: rec('clearRect'),
        drawImage: rec('drawImage'),
    };
}
function countOp(ctx: ReturnType<typeof makeRecordingCtx>, op: string): number {
    return ctx.calls.filter((c) => c.op === op).length;
}

describe('drawAnnotationStroke (AC-03 drawing model)', () => {
    it('draws freehand as a connected polyline of all points', () => {
        const ctx = makeRecordingCtx();
        const stroke: AnnotationStroke = {
            tool: 'pen',
            color: '#ff0000',
            width: 5,
            points: [
                { x: 0, y: 0 },
                { x: 10, y: 10 },
                { x: 20, y: 5 },
            ],
        };
        drawAnnotationStroke(ctx, stroke);
        expect(ctx.strokeStyle).toBe('#ff0000');
        expect(ctx.lineWidth).toBe(5);
        expect(ctx.calls[0].op).toBe('save');
        expect(ctx.calls[ctx.calls.length - 1].op).toBe('restore');
        expect(countOp(ctx, 'moveTo')).toBe(1);
        expect(countOp(ctx, 'lineTo')).toBe(2);
        expect(countOp(ctx, 'stroke')).toBe(1);
    });

    it('renders a single-point freehand as a dot (moveTo + lineTo to itself)', () => {
        const ctx = makeRecordingCtx();
        drawAnnotationStroke(ctx, { tool: 'pen', color: '#000', width: 3, points: [{ x: 7, y: 8 }] });
        expect(countOp(ctx, 'moveTo')).toBe(1);
        expect(countOp(ctx, 'lineTo')).toBe(1);
        expect(ctx.calls.find((c) => c.op === 'lineTo')?.args).toEqual([7, 8]);
    });

    it('draws a straight line between first and last point only', () => {
        const ctx = makeRecordingCtx();
        drawAnnotationStroke(ctx, {
            tool: 'line',
            color: '#00f',
            width: 2,
            points: [
                { x: 5, y: 5 },
                { x: 40, y: 60 },
            ],
        });
        expect(ctx.calls.filter((c) => c.op === 'moveTo').map((c) => c.args)).toEqual([[5, 5]]);
        expect(ctx.calls.filter((c) => c.op === 'lineTo').map((c) => c.args)).toEqual([[40, 60]]);
    });

    it('draws a rectangle as a closed 4-segment path (no strokeRect needed)', () => {
        const ctx = makeRecordingCtx();
        drawAnnotationStroke(ctx, {
            tool: 'rect',
            color: '#0f0',
            width: 2,
            points: [
                { x: 10, y: 20 },
                { x: 60, y: 50 },
            ],
        });
        // top-left corner, 4 edges back to start.
        expect(ctx.calls.find((c) => c.op === 'moveTo')?.args).toEqual([10, 20]);
        expect(countOp(ctx, 'lineTo')).toBe(4);
        expect(countOp(ctx, 'stroke')).toBe(1);
    });

    it('normalizes a reversed rectangle drag to the same top-left origin', () => {
        const ctx = makeRecordingCtx();
        drawAnnotationStroke(ctx, {
            tool: 'rect',
            color: '#0f0',
            width: 2,
            points: [
                { x: 60, y: 50 },
                { x: 10, y: 20 },
            ],
        });
        expect(ctx.calls.find((c) => c.op === 'moveTo')?.args).toEqual([10, 20]);
    });

    it('draws an arrow as a line plus a two-segment arrowhead', () => {
        const ctx = makeRecordingCtx();
        drawAnnotationStroke(ctx, {
            tool: 'arrow',
            color: '#fff',
            width: 3,
            points: [
                { x: 0, y: 0 },
                { x: 100, y: 0 },
            ],
        });
        // shaft stroke + arrowhead stroke.
        expect(countOp(ctx, 'stroke')).toBe(2);
        // arrowhead: two lines drawn back from the tip (100,0).
        const heads = ctx.calls.filter((c) => c.op === 'lineTo');
        expect(heads.length).toBeGreaterThanOrEqual(3);
    });

    it('is a no-op for an empty point list', () => {
        const ctx = makeRecordingCtx();
        drawAnnotationStroke(ctx, { tool: 'pen', color: '#000', width: 1, points: [] });
        expect(ctx.calls).toHaveLength(0);
    });
});

describe('renderAnnotationScene (AC-03 compositing)', () => {
    const size = { width: 200, height: 150 };

    it('clears, then draws the base image at full crop size, then each stroke', () => {
        const ctx = makeRecordingCtx();
        const base = { tag: 'base-image' };
        const strokes: AnnotationStroke[] = [
            { tool: 'pen', color: '#f00', width: 2, points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] },
            { tool: 'rect', color: '#0f0', width: 2, points: [{ x: 5, y: 5 }, { x: 9, y: 9 }] },
        ];
        renderAnnotationScene(ctx, base, strokes, size);
        expect(ctx.calls[0].op).toBe('clearRect');
        expect(ctx.calls[0].args).toEqual([0, 0, 200, 150]);
        const draw = ctx.calls.find((c) => c.op === 'drawImage');
        expect(draw?.args).toEqual([base, 0, 0, 200, 150]);
        // one stroke() per annotation.
        expect(countOp(ctx, 'stroke')).toBe(2);
    });

    it('skips the base image draw when none is loaded yet', () => {
        const ctx = makeRecordingCtx();
        renderAnnotationScene(ctx, null, [], size);
        expect(countOp(ctx, 'clearRect')).toBe(1);
        expect(countOp(ctx, 'drawImage')).toBe(0);
    });
});

describe('exportAnnotatedPng (AC-03 DoD #2 — flattened PNG export)', () => {
    it('composites base + strokes onto a crop-sized canvas and returns a PNG data URL', () => {
        const exportCtx = makeRecordingCtx();
        let created: { width: number; height: number } | null = null;
        const doc = {
            createElement: (_tag: '2d' | 'canvas') => {
                const canvas = {
                    width: 0,
                    height: 0,
                    getContext: () => exportCtx,
                    toDataURL: (_type?: string) => 'data:image/png;base64,FLATTENED',
                };
                created = canvas;
                return canvas;
            },
        };
        const base = { tag: 'base' };
        const strokes: AnnotationStroke[] = [
            { tool: 'line', color: '#000', width: 2, points: [{ x: 0, y: 0 }, { x: 5, y: 5 }] },
        ];
        const url = exportAnnotatedPng(doc as never, base, strokes, { width: 320, height: 240 });
        expect(url).toBe('data:image/png;base64,FLATTENED');
        // canvas sized to the crop's device dimensions.
        expect(created!.width).toBe(320);
        expect(created!.height).toBe(240);
        // base image plus the stroke were painted.
        expect(exportCtx.calls.find((c) => c.op === 'drawImage')?.args).toEqual([base, 0, 0, 320, 240]);
        expect(countOp(exportCtx, 'stroke')).toBe(1);
    });
});

describe('fitAnnotationWindowSize (AC-03 window sizing)', () => {
    it('leaves a small crop unscaled and adds the toolbar height', () => {
        expect(
            fitAnnotationWindowSize({ width: 400, height: 300 }, 1, { width: 1920, height: 1080 }, 48),
        ).toEqual({ width: 400, height: 348 });
    });

    it('converts device pixels to CSS px via the scale factor', () => {
        // 800x600 device @2x → 400x300 CSS, fits comfortably.
        expect(
            fitAnnotationWindowSize({ width: 800, height: 600 }, 2, { width: 1920, height: 1080 }, 48),
        ).toEqual({ width: 400, height: 348 });
    });

    it('shrinks a crop larger than the work area, preserving aspect ratio', () => {
        const size = fitAnnotationWindowSize(
            { width: 4000, height: 2000 },
            1,
            { width: 1000, height: 900 },
            48,
        );
        // width-bound: fit = 1000/4000 = 0.25 → 1000 x 500, + toolbar.
        expect(size.width).toBe(1000);
        expect(size.height).toBe(500 + 48);
    });

    it('falls back to scale 1 for a non-positive scale factor', () => {
        expect(
            fitAnnotationWindowSize({ width: 200, height: 100 }, 0, { width: 1920, height: 1080 }, 48),
        ).toEqual({ width: 200, height: 148 });
    });
});

// --- Annotation editor page-script harness --------------------------------------

function makeEditorEl(id: string, extra: Record<string, unknown> = {}) {
    const listeners: Record<string, Array<(e: unknown) => void>> = {};
    const el: Record<string, unknown> = {
        id,
        className: '',
        value: '',
        style: {} as Record<string, string>,
        addEventListener(type: string, cb: (e: unknown) => void) {
            (listeners[type] ||= []).push(cb);
        },
        fire(type: string, e: unknown) {
            (listeners[type] || []).forEach((f) => f(e));
        },
        ...extra,
    };
    return el;
}

interface EditorHarness {
    els: Record<string, ReturnType<typeof makeEditorEl>>;
    liveCtx: ReturnType<typeof makeRecordingCtx>;
    exportCtx: ReturnType<typeof makeRecordingCtx>;
    done: ReturnType<typeof vi.fn>;
    cancelAnnotate: ReturnType<typeof vi.fn>;
    createdImgs: Array<{ onload: (() => void) | null; src: string }>;
    exportCanvas: () => { width: number; height: number } | null;
    init: (payload: unknown) => void;
    fireWin: (type: string, e: unknown) => void;
    fireCanvas: (type: string, e: unknown) => void;
    click: (id: string) => void;
    input: (id: string, value: string) => void;
}

function runEditor(withApi = true): EditorHarness {
    const els: Record<string, ReturnType<typeof makeEditorEl>> = {};
    const register = (id: string, extra: Record<string, unknown> = {}) => {
        els[id] = makeEditorEl(id, extra);
    };

    const liveCtx = makeRecordingCtx();
    register('annotate-canvas', {
        width: 1,
        height: 1,
        getContext: () => liveCtx,
        getBoundingClientRect: () => ({
            left: 0,
            top: 0,
            width: els['annotate-canvas'].width as number,
            height: els['annotate-canvas'].height as number,
        }),
    });
    register('annotate-toolbar', { offsetHeight: ANNOTATION_TOOLBAR_HEIGHT });
    for (const t of ['pen', 'line', 'rect', 'arrow']) {
        register('annotate-tool-' + t);
    }
    register('annotate-color');
    register('annotate-width');
    register('annotate-undo');
    register('annotate-done');
    register('annotate-cancel');

    const createdImgs: Array<{ onload: (() => void) | null; src: string }> = [];
    const exportCtx = makeRecordingCtx();
    let exportCanvas: { width: number; height: number } | null = null;
    const doc = {
        getElementById: (id: string) => els[id],
        createElement: (tag: string) => {
            if (tag === 'img') {
                const img = { onload: null as (() => void) | null, src: '' };
                createdImgs.push(img);
                return img;
            }
            exportCanvas = {
                width: 0,
                height: 0,
                getContext: () => exportCtx,
                toDataURL: (_type?: string) => 'data:image/png;base64,EDITED',
            };
            return exportCanvas;
        },
    };

    const winListeners: Record<string, Array<(e: unknown) => void>> = {};
    const done = vi.fn();
    const cancelAnnotate = vi.fn();
    let initCb: ((payload: unknown) => void) | null = null;
    const win: Record<string, unknown> = {
        innerWidth: 1000,
        innerHeight: 800,
        addEventListener(type: string, cb: (e: unknown) => void) {
            (winListeners[type] ||= []).push(cb);
        },
    };
    if (withApi) {
        win.cocDesktop = {
            screenshot: {
                onAnnotateInit: (cb: (payload: unknown) => void) => {
                    initCb = cb;
                    return () => {};
                },
                done,
                cancelAnnotate,
            },
        };
    }

    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    new Function('window', 'document', buildAnnotationPageScript())(win, doc);

    return {
        els,
        liveCtx,
        exportCtx,
        done,
        cancelAnnotate,
        createdImgs,
        exportCanvas: () => exportCanvas,
        init: (payload) => initCb && initCb(payload),
        fireWin: (type, e) => (winListeners[type] || []).forEach((f) => f(e)),
        fireCanvas: (type, e) => els['annotate-canvas'].fire(type, e),
        click: (id) => els[id].fire('click', {}),
        input: (id, value) => els[id].fire('input', { target: { value } }),
    };
}

/** Initialize the editor with a crop and simulate the base image finishing load. */
function initLoaded(h: EditorHarness, width = 200, height = 150): void {
    h.init({ imageDataUrl: 'data:image/png;base64,BASE', width, height });
    h.createdImgs[0].onload?.();
}

describe('buildAnnotationPageScript (annotation editor page)', () => {
    it('sizes the canvas to the crop and paints the base image once loaded', () => {
        const h = runEditor();
        initLoaded(h, 320, 240);
        expect(h.els['annotate-canvas'].width).toBe(320);
        expect(h.els['annotate-canvas'].height).toBe(240);
        // the loaded base image is drawn to the live canvas.
        const draw = h.liveCtx.calls.find((c) => c.op === 'drawImage');
        expect(draw?.args?.[0]).toBe(h.createdImgs[0]);
    });

    it('marks the pen tool active by default and switches on toolbar clicks', () => {
        const h = runEditor();
        expect(h.els['annotate-tool-pen'].className).toBe('tool active');
        h.click('annotate-tool-rect');
        expect(h.els['annotate-tool-rect'].className).toBe('tool active');
        expect(h.els['annotate-tool-pen'].className).toBe('tool');
    });

    it('commits a freehand stroke on drag, exported on Done', () => {
        const h = runEditor();
        initLoaded(h);
        h.fireCanvas('mousedown', { button: 0, clientX: 10, clientY: 10 });
        h.fireCanvas('mousemove', { button: 0, clientX: 40, clientY: 30 });
        h.fireWin('mouseup', { button: 0, clientX: 50, clientY: 35 });
        h.click('annotate-done');
        expect(h.done).toHaveBeenCalledTimes(1);
        expect(h.done.mock.calls[0][0]).toBe('data:image/png;base64,EDITED');
        // the export canvas is the crop's device dimensions.
        expect(h.exportCanvas()!.width).toBe(200);
        expect(h.exportCanvas()!.height).toBe(150);
        // base image + one committed stroke flattened.
        expect(h.exportCtx.calls.find((c) => c.op === 'drawImage')?.args?.[0]).toBe(h.createdImgs[0]);
        expect(countOp(h.exportCtx, 'stroke')).toBe(1);
    });

    it('records line/rect strokes with the selected tool', () => {
        const h = runEditor();
        initLoaded(h);
        h.click('annotate-tool-line');
        h.fireCanvas('mousedown', { button: 0, clientX: 0, clientY: 0 });
        h.fireWin('mouseup', { button: 0, clientX: 20, clientY: 20 });
        h.click('annotate-tool-rect');
        h.fireCanvas('mousedown', { button: 0, clientX: 5, clientY: 5 });
        h.fireWin('mouseup', { button: 0, clientX: 40, clientY: 30 });
        h.click('annotate-done');
        // line = 1 stroke, rect = 1 stroke → 2 total over the base.
        expect(countOp(h.exportCtx, 'stroke')).toBe(2);
    });

    it('undo removes the most recent stroke', () => {
        const h = runEditor();
        initLoaded(h);
        for (const y of [10, 20]) {
            h.fireCanvas('mousedown', { button: 0, clientX: 0, clientY: y });
            h.fireWin('mouseup', { button: 0, clientX: 30, clientY: y });
        }
        h.click('annotate-undo');
        h.click('annotate-done');
        // two pen strokes drawn, one undone → one remains.
        expect(countOp(h.exportCtx, 'stroke')).toBe(1);
    });

    it('Ctrl/Cmd+Z also undoes the last stroke', () => {
        const h = runEditor();
        initLoaded(h);
        h.fireCanvas('mousedown', { button: 0, clientX: 0, clientY: 0 });
        h.fireWin('mouseup', { button: 0, clientX: 30, clientY: 30 });
        h.fireWin('keydown', { ctrlKey: true, key: 'z', preventDefault: vi.fn() });
        h.click('annotate-done');
        expect(countOp(h.exportCtx, 'stroke')).toBe(0);
    });

    it('applies the chosen colour and stroke width to new strokes', () => {
        const h = runEditor();
        initLoaded(h);
        h.input('annotate-color', '#123456');
        h.input('annotate-width', '12');
        h.fireCanvas('mousedown', { button: 0, clientX: 0, clientY: 0 });
        h.fireWin('mouseup', { button: 0, clientX: 30, clientY: 30 });
        h.click('annotate-done');
        // the flattened export drew the stroke with the picked style.
        expect(h.exportCtx.strokeStyle).toBe('#123456');
        expect(h.exportCtx.lineWidth).toBe(12);
    });

    it('Cancel discards without exporting', () => {
        const h = runEditor();
        initLoaded(h);
        h.click('annotate-cancel');
        expect(h.cancelAnnotate).toHaveBeenCalledTimes(1);
        expect(h.done).not.toHaveBeenCalled();
    });

    it('ESC cancels the editor', () => {
        const h = runEditor();
        initLoaded(h);
        h.fireWin('keydown', { key: 'Escape', preventDefault: vi.fn() });
        expect(h.cancelAnnotate).toHaveBeenCalledTimes(1);
        expect(h.done).not.toHaveBeenCalled();
    });

    it('finishes exactly once — ESC after Done is a no-op', () => {
        const h = runEditor();
        initLoaded(h);
        h.click('annotate-done');
        h.fireWin('keydown', { key: 'Escape', preventDefault: vi.fn() });
        expect(h.done).toHaveBeenCalledTimes(1);
        expect(h.cancelAnnotate).not.toHaveBeenCalled();
    });

    it('ignores non-left mouse buttons for starting a stroke', () => {
        const h = runEditor();
        initLoaded(h);
        h.fireCanvas('mousedown', { button: 2, clientX: 0, clientY: 0 });
        h.fireWin('mouseup', { button: 2, clientX: 30, clientY: 30 });
        h.click('annotate-done');
        expect(countOp(h.exportCtx, 'stroke')).toBe(0);
    });

    it('bails out cleanly when the preload screenshot bridge is absent', () => {
        expect(() => runEditor(false)).not.toThrow();
    });
});

describe('buildAnnotationHtml (AC-03 DoD #3 — custom canvas, no Excalidraw)', () => {
    const html = buildAnnotationHtml();

    it('contains the toolbar controls and a custom <canvas> surface', () => {
        for (const id of [
            'annotate-toolbar',
            'annotate-canvas',
            'annotate-tool-pen',
            'annotate-tool-line',
            'annotate-tool-rect',
            'annotate-tool-arrow',
            'annotate-color',
            'annotate-width',
            'annotate-undo',
            'annotate-done',
            'annotate-cancel',
        ]) {
            expect(html).toContain(`id="${id}"`);
        }
        expect(html).toContain('<canvas');
        expect(html).toContain('<script>');
    });

    it('does NOT use Excalidraw — the surface is a custom canvas', () => {
        expect(html).not.toMatch(/excalidraw/i);
    });
});

describe('AC-03 code-search (DoD #3 — no Excalidraw import)', () => {
    // The word "Excalidraw" appears in the source only inside comments that
    // DOCUMENT the decision not to use it; what the DoD forbids is a real import
    // pulling the library in. Assert no import/require statement references it.
    it('the capture module and host import Excalidraw nowhere', () => {
        const importRe = /(?:import[^;\n]*from\s*['"][^'"]*excalidraw|require\(\s*['"][^'"]*excalidraw)/i;
        for (const file of ['screenshot-capture.ts', 'screenshot-capture-host.ts']) {
            expect(readSrc(file)).not.toMatch(importRe);
        }
    });

    it('the host opens a dedicated annotation BrowserWindow that loads the custom editor', () => {
        const host = readSrc('screenshot-capture-host.ts');
        expect(host).toContain('function openAnnotationEditor(');
        expect(host).toContain('buildAnnotationHtml()');
        expect(host).toContain('new BrowserWindow(');
    });
});

// ─── AC-04: finish → three sinks (clipboard + chat-attach + save-file) ───────

describe('SCREENSHOT_ATTACH_CHANNEL', () => {
    it('is the coc-desktop namespaced push channel', () => {
        expect(SCREENSHOT_ATTACH_CHANNEL).toBe('coc-desktop:screenshot-attach');
    });
});

describe('dispatchAnnotationSinks (AC-04 DoD #2 — the three-sink dispatcher)', () => {
    const PNG = 'data:image/png;base64,AAAA';

    function recordingSinks(overrides: Partial<AnnotationSinks> = {}): {
        sinks: AnnotationSinks;
        order: string[];
    } {
        const order: string[] = [];
        const sinks: AnnotationSinks = {
            writeClipboard: vi.fn(() => { order.push('clipboard'); }),
            attachToChat: vi.fn(() => { order.push('attach'); }),
            saveFile: vi.fn(() => { order.push('save'); }),
            ...overrides,
        };
        return { sinks, order };
    }

    it('calls clipboard, chat-attach, then save — in that order — with the PNG', async () => {
        const { sinks, order } = recordingSinks();
        const result = await dispatchAnnotationSinks(PNG, sinks);
        expect(order).toEqual(['clipboard', 'attach', 'save']);
        expect(sinks.writeClipboard).toHaveBeenCalledWith(PNG);
        expect(sinks.attachToChat).toHaveBeenCalledWith(PNG);
        expect(sinks.saveFile).toHaveBeenCalledWith(PNG);
        expect(result).toEqual({ clipboard: true, attached: true, saved: true });
    });

    it('a Save-As cancel/throw does not throw and does not undo clipboard/attach', async () => {
        const onError = vi.fn();
        const { sinks, order } = recordingSinks({
            // Model a Save-As cancel that surfaces as a rejected promise.
            saveFile: vi.fn(async () => {
                order.push('save');
                throw new Error('user cancelled the save dialog');
            }),
        });
        const result = await dispatchAnnotationSinks(PNG, sinks, onError);
        // clipboard + attach still ran (and in order before the failing save).
        expect(order).toEqual(['clipboard', 'attach', 'save']);
        expect(sinks.writeClipboard).toHaveBeenCalledWith(PNG);
        expect(sinks.attachToChat).toHaveBeenCalledWith(PNG);
        // The dispatcher resolved (did not reject) and kept a+b marked done.
        expect(result).toEqual({ clipboard: true, attached: true, saved: false });
        expect(onError).toHaveBeenCalledWith('save', expect.any(Error));
    });

    it('isolates each sink — a clipboard failure still lets attach + save run', async () => {
        const onError = vi.fn();
        const { sinks, order } = recordingSinks({
            writeClipboard: vi.fn(() => { order.push('clipboard'); throw new Error('no clipboard'); }),
        });
        const result = await dispatchAnnotationSinks(PNG, sinks, onError);
        expect(order).toEqual(['clipboard', 'attach', 'save']);
        expect(result).toEqual({ clipboard: false, attached: true, saved: true });
        expect(onError).toHaveBeenCalledWith('clipboard', expect.any(Error));
    });
});

describe('buildScreenshotFileName (AC-04 — timestamped default Save-As name)', () => {
    it('formats a timestamped .png from the local date components', () => {
        // 2026-07-24 09:05:03 local time.
        const name = buildScreenshotFileName(new Date(2026, 6, 24, 9, 5, 3));
        expect(name).toBe('screenshot-2026-07-24-09-05-03.png');
    });

    it('zero-pads every component', () => {
        const name = buildScreenshotFileName(new Date(2026, 0, 1, 0, 0, 0));
        expect(name).toBe('screenshot-2026-01-01-00-00-00.png');
    });
});

describe('AC-04 host wiring (code-search)', () => {
    it('the host fans a finished PNG out to the three sinks via the pure dispatcher', () => {
        const host = readSrc('screenshot-capture-host.ts');
        // Clipboard sink.
        expect(host).toContain('clipboard.writeImage(nativeImage.createFromDataURL');
        // Chat-attach sink pushes to the MAIN window (not the editor).
        expect(host).toContain('mainWindowProvider()');
        expect(host).toContain('webContents.send(SCREENSHOT_ATTACH_CHANNEL');
        // Save sink opens a Save-As dialog with a timestamped default name.
        expect(host).toContain('dialog.showSaveDialog(');
        expect(host).toContain('buildScreenshotFileName(');
        // Ordering delegated to the pure, tested dispatcher.
        expect(host).toContain('dispatchAnnotationSinks(');
    });

    it('main.ts installs the main-window provider so the attach sink has a target', () => {
        const mainSrc = readSrc('main.ts');
        expect(mainSrc).toContain('setScreenshotMainWindowProvider(() => mainWindow)');
    });
});
