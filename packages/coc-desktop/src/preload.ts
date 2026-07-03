/**
 * CoC Desktop — preload script.
 *
 * Runs in the renderer's isolated context before the SPA loads. The SPA is the
 * unmodified CoC web client served from localhost, so the preload exposes only a
 * tiny bridge: read-only diagnostics plus the find-in-page channel used by the
 * injected find bar (see `find-in-page.ts`). Further privileged IPC channels are
 * added by later acceptance criteria as the main process grows them.
 */

import { contextBridge, ipcRenderer } from 'electron';
import {
    FIND_IN_PAGE_CHANNEL,
    STOP_FIND_IN_PAGE_CHANNEL,
    FIND_RESULT_CHANNEL,
} from './find-in-page';

/** Shape of an Electron `found-in-page` result, as relayed to the renderer. */
interface FindResult {
    activeMatchOrdinal: number;
    matches: number;
}

const api = {
    /** Identifies the host so the SPA can tell it is running inside the desktop shell. */
    isDesktop: true,
    /** OS platform string (e.g. "darwin", "win32", "linux") so the SPA can apply
     *  platform-specific layout adjustments such as the macOS traffic-light inset. */
    platform: process.platform as string,
    versions: {
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
    },
    /**
     * Find-in-page bridge for the injected find bar. `query` searches the page,
     * `stop` clears the current selection, and `onResult` subscribes to match
     * counts (returning an unsubscribe function).
     */
    find: {
        query: (text: string, options: { forward?: boolean; findNext?: boolean }) =>
            ipcRenderer.send(FIND_IN_PAGE_CHANNEL, text, options),
        stop: () => ipcRenderer.send(STOP_FIND_IN_PAGE_CHANNEL),
        onResult: (callback: (result: FindResult) => void) => {
            const listener = (_event: unknown, result: FindResult) => callback(result);
            ipcRenderer.on(FIND_RESULT_CHANNEL, listener);
            return () => ipcRenderer.removeListener(FIND_RESULT_CHANNEL, listener);
        },
    },
} as const;

contextBridge.exposeInMainWorld('cocDesktop', api);

export type CocDesktopApi = typeof api;
