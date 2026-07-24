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
