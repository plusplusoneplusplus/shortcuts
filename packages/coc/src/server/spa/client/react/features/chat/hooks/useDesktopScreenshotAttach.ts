/**
 * useDesktopScreenshotAttach — receive desktop-pushed screenshots into the composer.
 *
 * When the SPA runs inside the CoC desktop shell, the main process pushes a
 * finished screenshot PNG (AC-04 chat-attach sink) over the preload bridge's
 * `cocDesktop.screenshot.onScreenshotAttach` channel. This hook subscribes while
 * mounted and hands each pushed data URL to `onScreenshot` (typically
 * `useFileAttachments().addScreenshotDataUrl`, which enforces the attachment
 * limits). Outside the desktop shell the bridge is absent and the hook is inert.
 *
 * `onScreenshot` MUST be a stable reference (e.g. the memoized
 * `addScreenshotDataUrl`); the effect re-subscribes whenever it changes.
 */

import { useEffect } from 'react';

/** The slice of the desktop preload bridge this hook needs. */
interface ScreenshotBridge {
    onScreenshotAttach?: (callback: (dataUrl: string) => void) => (() => void) | void;
}

function getScreenshotBridge(): ScreenshotBridge | undefined {
    if (typeof window === 'undefined') return undefined;
    return (window as { cocDesktop?: { screenshot?: ScreenshotBridge } }).cocDesktop?.screenshot;
}

/**
 * Subscribe to desktop screenshot pushes for the composer's lifetime, forwarding
 * each PNG data URL to `onScreenshot`. No-op when not running in the desktop shell.
 */
export function useDesktopScreenshotAttach(onScreenshot: (dataUrl: string) => void): void {
    useEffect(() => {
        const bridge = getScreenshotBridge();
        if (!bridge?.onScreenshotAttach) return;
        const unsubscribe = bridge.onScreenshotAttach(onScreenshot);
        return typeof unsubscribe === 'function' ? unsubscribe : undefined;
    }, [onScreenshot]);
}
