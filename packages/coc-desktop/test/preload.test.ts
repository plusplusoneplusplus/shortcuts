/**
 * Tests for the preload bridge.
 *
 * REGRESSION: the preload runs sandboxed, where `require` can only load the
 * 'electron' builtin. It once imported its IPC channel names from
 * './find-in-page' / './devtunnel-modal'; that relative require threw
 * "module not found" inside the sandbox, the preload died, `window.cocDesktop`
 * never existed, and the injected find bar silently bailed — Ctrl+F did
 * nothing anywhere in the desktop app. The channel names are now local
 * literals in preload.ts; these tests pin (a) that preload.ts stays free of
 * relative/non-electron imports and (b) that its literals stay in sync with
 * the real exported constants.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
    FIND_IN_PAGE_CHANNEL,
    STOP_FIND_IN_PAGE_CHANNEL,
    FIND_RESULT_CHANNEL,
    OPEN_FIND_BAR_CHANNEL,
    CLOSE_FIND_BAR_CHANNEL,
} from '../src/find-in-page';
import {
    DEVTUNNEL_MODAL_SUBMIT_CHANNEL,
    DEVTUNNEL_MODAL_CANCEL_CHANNEL,
} from '../src/devtunnel-modal';
import {
    SCREENSHOT_OVERLAY_INIT_CHANNEL,
    SCREENSHOT_CROP_CHANNEL,
    SCREENSHOT_CANCEL_CHANNEL,
    SCREENSHOT_ANNOTATE_INIT_CHANNEL,
    SCREENSHOT_ANNOTATE_DONE_CHANNEL,
    SCREENSHOT_ANNOTATE_CANCEL_CHANNEL,
} from '../src/screenshot-capture';

const exposeInMainWorld = vi.fn();
const send = vi.fn();
const on = vi.fn();
const removeListener = vi.fn();

vi.mock('electron', () => ({
    contextBridge: { exposeInMainWorld: (...args: unknown[]) => exposeInMainWorld(...args) },
    ipcRenderer: {
        send: (...args: unknown[]) => send(...args),
        on: (...args: unknown[]) => on(...args),
        removeListener: (...args: unknown[]) => removeListener(...args),
    },
}));

const preloadSource = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/preload.ts'),
    'utf8',
);

describe('preload sandbox-safety', () => {
    it('imports nothing but the electron builtin (sandboxed require)', () => {
        const imports = [...preloadSource.matchAll(/^import\s[^;]*?from\s+['"]([^'"]+)['"]/gms)]
            .map((m) => m[1]);
        expect(imports).toEqual(['electron']);
    });
});

describe('preload bridge', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        vi.resetModules();
        await import('../src/preload');
    });

    function exposedApi(): any {
        expect(exposeInMainWorld).toHaveBeenCalledWith('cocDesktop', expect.anything());
        return exposeInMainWorld.mock.calls[0][1];
    }

    it('find.query sends on the real find-in-page channel', () => {
        const api = exposedApi();
        api.find.query('needle', { findNext: true, forward: true });
        expect(send).toHaveBeenCalledWith(FIND_IN_PAGE_CHANNEL, 'needle', { findNext: true, forward: true });
    });

    it('find.stop sends on the real stop channel', () => {
        exposedApi().find.stop();
        expect(send).toHaveBeenCalledWith(STOP_FIND_IN_PAGE_CHANNEL);
    });

    it('find.onResult subscribes on the real result channel and unsubscribes', () => {
        const cb = vi.fn();
        const unsubscribe = exposedApi().find.onResult(cb);
        expect(on).toHaveBeenCalledWith(FIND_RESULT_CHANNEL, expect.any(Function));
        unsubscribe();
        expect(removeListener).toHaveBeenCalledWith(FIND_RESULT_CHANNEL, expect.any(Function));
    });

    it('find.openBar / find.closeBar send on the real bar channels', () => {
        const api = exposedApi();
        api.find.openBar();
        expect(send).toHaveBeenCalledWith(OPEN_FIND_BAR_CHANNEL);
        api.find.closeBar();
        expect(send).toHaveBeenCalledWith(CLOSE_FIND_BAR_CHANNEL);
    });

    it('devtunnelModal submit/cancel send on the real devtunnel channels', () => {
        const api = exposedApi();
        api.devtunnelModal.submit('tunnel-1');
        expect(send).toHaveBeenCalledWith(DEVTUNNEL_MODAL_SUBMIT_CHANNEL, 'tunnel-1');
        api.devtunnelModal.cancel();
        expect(send).toHaveBeenCalledWith(DEVTUNNEL_MODAL_CANCEL_CHANNEL);
    });

    it('screenshot.crop / cancel send on the real screenshot channels', () => {
        const api = exposedApi();
        const rect = { x: 1, y: 2, width: 3, height: 4 };
        api.screenshot.crop(rect);
        expect(send).toHaveBeenCalledWith(SCREENSHOT_CROP_CHANNEL, rect);
        api.screenshot.cancel();
        expect(send).toHaveBeenCalledWith(SCREENSHOT_CANCEL_CHANNEL);
    });

    it('screenshot.onOverlayInit subscribes on the real overlay channel and unsubscribes', () => {
        const cb = vi.fn();
        const unsubscribe = exposedApi().screenshot.onOverlayInit(cb);
        expect(on).toHaveBeenCalledWith(SCREENSHOT_OVERLAY_INIT_CHANNEL, expect.any(Function));
        unsubscribe();
        expect(removeListener).toHaveBeenCalledWith(
            SCREENSHOT_OVERLAY_INIT_CHANNEL,
            expect.any(Function),
        );
    });

    it('screenshot.done / cancelAnnotate send on the real annotate channels', () => {
        const api = exposedApi();
        api.screenshot.done('data:image/png;base64,ABC');
        expect(send).toHaveBeenCalledWith(SCREENSHOT_ANNOTATE_DONE_CHANNEL, 'data:image/png;base64,ABC');
        api.screenshot.cancelAnnotate();
        expect(send).toHaveBeenCalledWith(SCREENSHOT_ANNOTATE_CANCEL_CHANNEL);
    });

    it('screenshot.onAnnotateInit subscribes on the real annotate channel and unsubscribes', () => {
        const cb = vi.fn();
        const unsubscribe = exposedApi().screenshot.onAnnotateInit(cb);
        expect(on).toHaveBeenCalledWith(SCREENSHOT_ANNOTATE_INIT_CHANNEL, expect.any(Function));
        unsubscribe();
        expect(removeListener).toHaveBeenCalledWith(
            SCREENSHOT_ANNOTATE_INIT_CHANNEL,
            expect.any(Function),
        );
    });
});
