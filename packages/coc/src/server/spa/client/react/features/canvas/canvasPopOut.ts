/**
 * canvasPopOut — open (or refocus) the standalone window for one canvas.
 *
 * The canvas lives in the shared right panel's tab; this is the "send it to its
 * own window" affordance the panel's toolbar offers. Two things make it more
 * than a `window.open` call:
 *
 *  - **One window per canvas.** The window is named `coc-canvas-<id>`, so a
 *    second pop-out of the same canvas focuses the window that already exists
 *    instead of spawning a duplicate. Handles are also kept here so a browser
 *    that ignores the name still focuses the live window.
 *  - **The desktop shell denies the open.** Electron intercepts `#popout/*`
 *    URLs and builds a native window itself, which makes `window.open` return
 *    `null` even though a window appeared — `popOutOpened` is the check that
 *    tells that apart from a blocked popup.
 *
 * The owning workspace travels in the URL, so a canvas from a repo-group member
 * or a remote clone keeps hitting its own server in the new window.
 */

import { popOutOpened } from '../../utils/popOutWindow';

/** Live handles by window name, so a repeat pop-out focuses rather than reopens. */
const handles = new Map<string, Window>();

/** The window name a canvas's pop-out is filed under. */
export function canvasPopOutWindowName(canvasId: string): string {
    return `coc-canvas-${canvasId}`;
}

/** The standalone URL for a canvas, routed at its OWNING workspace. */
export function canvasPopOutUrl(workspaceId: string, canvasId: string): string {
    const base = window.location.origin + window.location.pathname;
    return `${base}?workspace=${encodeURIComponent(workspaceId)}&canvasId=${encodeURIComponent(canvasId)}#popout/canvas`;
}

/**
 * Show this canvas in its own window: focus the existing one when it is still
 * open, otherwise open it. Returns whether a window is now up — `false` only
 * for a blocked popup, where the caller leaves the canvas in its tab.
 */
export function openCanvasPopOut(workspaceId: string, canvasId: string): boolean {
    if (!workspaceId || !canvasId) return false;
    const name = canvasPopOutWindowName(canvasId);
    const existing = handles.get(name);
    if (existing && !existing.closed) {
        existing.focus();
        return true;
    }
    handles.delete(name);
    const handle = window.open(canvasPopOutUrl(workspaceId, canvasId), name, 'width=900,height=900');
    if (!popOutOpened(handle)) return false;
    if (handle) handles.set(name, handle);
    return true;
}

/** Forget every tracked handle (test isolation). */
export function clearCanvasPopOutHandles(): void {
    handles.clear();
}
