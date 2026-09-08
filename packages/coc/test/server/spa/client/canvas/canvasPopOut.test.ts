/**
 * canvasPopOut — one standalone window per canvas.
 *
 * The cases pin what the shared panel's tab relies on: the URL routes at the
 * canvas's OWNING workspace, a repeat pop-out focuses the live window instead
 * of spawning a second, and a blocked popup is reported so the caller leaves
 * the canvas in its tab.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    canvasPopOutUrl,
    canvasPopOutWindowName,
    clearCanvasPopOutHandles,
    openCanvasPopOut,
} from '../../../../../src/server/spa/client/react/features/canvas/canvasPopOut';

function stubWindowOpen() {
    const handle = { closed: false, focus: vi.fn() };
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(handle as unknown as Window);
    return { handle, openSpy };
}

beforeEach(() => {
    clearCanvasPopOutHandles();
});

afterEach(() => {
    vi.restoreAllMocks();
    clearCanvasPopOutHandles();
});

describe('canvasPopOutUrl / canvasPopOutWindowName', () => {
    it('routes at the owning workspace and the canvas pop-out route', () => {
        const url = canvasPopOutUrl('owner-ws', 'canvas-1');
        expect(url).toContain('workspace=owner-ws');
        expect(url).toContain('canvasId=canvas-1');
        expect(url).toContain('#popout/canvas');
    });

    it('escapes ids that are not URL-safe', () => {
        const url = canvasPopOutUrl('ws/a b', 'c#1');
        expect(url).toContain(`workspace=${encodeURIComponent('ws/a b')}`);
        expect(url).toContain(`canvasId=${encodeURIComponent('c#1')}`);
    });

    it('names the window per canvas', () => {
        expect(canvasPopOutWindowName('canvas-1')).toBe('coc-canvas-canvas-1');
    });
});

describe('openCanvasPopOut', () => {
    it('opens the window with the canvas URL and its per-canvas name', () => {
        const { openSpy } = stubWindowOpen();
        expect(openCanvasPopOut('owner-ws', 'canvas-1')).toBe(true);

        expect(openSpy).toHaveBeenCalledOnce();
        const [url, name] = openSpy.mock.calls[0];
        expect(url).toContain('canvasId=canvas-1');
        expect(url).toContain('workspace=owner-ws');
        expect(name).toBe('coc-canvas-canvas-1');
    });

    it('focuses the live window instead of opening a second one', () => {
        const { handle, openSpy } = stubWindowOpen();
        openCanvasPopOut('owner-ws', 'canvas-1');
        expect(openCanvasPopOut('owner-ws', 'canvas-1')).toBe(true);

        expect(openSpy).toHaveBeenCalledOnce();
        expect(handle.focus).toHaveBeenCalledOnce();
    });

    it('reopens once the window has been closed', () => {
        const { handle, openSpy } = stubWindowOpen();
        openCanvasPopOut('owner-ws', 'canvas-1');
        handle.closed = true;

        openCanvasPopOut('owner-ws', 'canvas-1');
        expect(openSpy).toHaveBeenCalledTimes(2);
        expect(handle.focus).not.toHaveBeenCalled();
    });

    it('tracks each canvas separately', () => {
        const { openSpy } = stubWindowOpen();
        openCanvasPopOut('owner-ws', 'canvas-1');
        openCanvasPopOut('owner-ws', 'canvas-2');
        expect(openSpy).toHaveBeenCalledTimes(2);
        expect(openSpy.mock.calls[1][1]).toBe('coc-canvas-canvas-2');
    });

    it('reports a blocked popup so the caller keeps the canvas in its tab', () => {
        vi.spyOn(window, 'open').mockReturnValue(null);
        expect(openCanvasPopOut('owner-ws', 'canvas-1')).toBe(false);
    });

    it('does nothing without an owner or a canvas', () => {
        const { openSpy } = stubWindowOpen();
        expect(openCanvasPopOut('', 'canvas-1')).toBe(false);
        expect(openCanvasPopOut('owner-ws', '')).toBe(false);
        expect(openSpy).not.toHaveBeenCalled();
    });
});
