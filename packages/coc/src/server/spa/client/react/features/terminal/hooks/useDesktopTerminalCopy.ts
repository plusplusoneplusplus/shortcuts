/**
 * useDesktopTerminalCopy — let the desktop Edit ▸ Copy menu reach this terminal.
 *
 * xterm.js paints its own selection rather than making a DOM selection, so the
 * Electron Edit menu's stock Copy (`webContents.copy()`) copies nothing when
 * terminal output is selected — and on macOS the menu owns the Cmd+C
 * accelerator, so the key never reaches the terminal's own handler either.
 *
 * The desktop main process therefore pushes `cocDesktop.menu.onCopy` when Copy
 * fires. This hook answers it: `tryCopy` returns true when this terminal is
 * focused and has a selection (it copies, then), and the hook reports that back
 * with `copyHandled()` so the main process skips its `webContents.copy()`
 * fallback. Staying silent lets the fallback copy the DOM selection as usual.
 *
 * Outside the desktop shell the bridge is absent and the hook is inert — the
 * browser dashboard relies on the terminal's own key handler instead.
 */

import { useEffect, useRef } from 'react';

/** The slice of the desktop preload bridge this hook needs. */
interface MenuBridge {
    onCopy?: (callback: () => void) => (() => void) | void;
    copyHandled?: () => void;
}

function getMenuBridge(): MenuBridge | undefined {
    if (typeof window === 'undefined') return undefined;
    return (window as { cocDesktop?: { menu?: MenuBridge } }).cocDesktop?.menu;
}

/**
 * Subscribe to desktop Edit ▸ Copy pushes for the terminal's lifetime.
 * `tryCopy` returns whether this terminal took the copy.
 */
export function useDesktopTerminalCopy(tryCopy: () => boolean): void {
    // Held in a ref so a re-created `tryCopy` never re-subscribes the bridge.
    const tryCopyRef = useRef(tryCopy);
    tryCopyRef.current = tryCopy;

    useEffect(() => {
        const bridge = getMenuBridge();
        if (!bridge?.onCopy) return;
        const unsubscribe = bridge.onCopy(() => {
            if (tryCopyRef.current()) bridge.copyHandled?.();
        });
        return typeof unsubscribe === 'function' ? unsubscribe : undefined;
    }, []);
}
