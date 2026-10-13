import { webContents } from 'electron';
import { isBrowserEmbedder } from './browser-webview-guard';
import { createMenuCopyDelegate, type MenuCopyDelegate } from './terminal-copy';

/** Resolve the actual focused surface, including DevTools and browser guests. */
export function createDesktopMenuCopyDelegate(): MenuCopyDelegate {
    return createMenuCopyDelegate({
        getTarget: () => {
            const contents = webContents.getFocusedWebContents();
            if (!contents || contents.isDestroyed()) return null;
            return {
                id: contents.id,
                send: isBrowserEmbedder(contents) ? (channel: string) => contents.send(channel) : undefined,
                copy: () => contents.copy(),
                isDestroyed: () => contents.isDestroyed(),
            };
        },
    });
}
