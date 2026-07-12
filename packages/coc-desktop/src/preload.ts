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

// The preload runs SANDBOXED (Electron sandboxes preloads by default since v20):
// its `require` can only load the 'electron' builtin, and a relative import —
// which tsc compiles to `require('./find-in-page')` — throws "module not found",
// killing the whole preload and with it every `window.cocDesktop` bridge. So the
// IPC channel names are declared as local literals here instead of imported.
// They must match the exported constants in find-in-page.ts / devtunnel-modal.ts;
// preload.test.ts asserts they stay in sync.
const FIND_IN_PAGE_CHANNEL = 'coc-desktop:find-in-page';
const STOP_FIND_IN_PAGE_CHANNEL = 'coc-desktop:stop-find-in-page';
const FIND_RESULT_CHANNEL = 'coc-desktop:find-result';
const OPEN_FIND_BAR_CHANNEL = 'coc-desktop:open-find-bar';
const CLOSE_FIND_BAR_CHANNEL = 'coc-desktop:close-find-bar';
const DEVTUNNEL_MODAL_SUBMIT_CHANNEL = 'coc-desktop:devtunnel-modal-submit';
const DEVTUNNEL_MODAL_CANCEL_CHANNEL = 'coc-desktop:devtunnel-modal-cancel';

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
     * Find-in-page bridge, used from two renderers: the SPA page calls
     * `openBar` (its injected Ctrl+F listener), while the find-bar
     * WebContentsView page uses `query` / `stop` / `onResult` / `closeBar`.
     * The main process routes each request by sender (see find-bar-host.ts).
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
        openBar: () => ipcRenderer.send(OPEN_FIND_BAR_CHANNEL),
        closeBar: () => ipcRenderer.send(CLOSE_FIND_BAR_CHANNEL),
    },
    /**
     * Configure… modal bridge (Windows-only Dev Tunnel feature, AC-01). The modal
     * document (see `devtunnel-modal.ts`) calls `submit(id)` to save a new tunnel
     * ID or `cancel()` to dismiss; the main process persists the ID and reconfigures
     * the host. Only the tunnel ID crosses the bridge — never any credential.
     */
    devtunnelModal: {
        submit: (tunnelId: string) => ipcRenderer.send(DEVTUNNEL_MODAL_SUBMIT_CHANNEL, tunnelId),
        cancel: () => ipcRenderer.send(DEVTUNNEL_MODAL_CANCEL_CHANNEL),
    },
} as const;

contextBridge.exposeInMainWorld('cocDesktop', api);

export type CocDesktopApi = typeof api;
