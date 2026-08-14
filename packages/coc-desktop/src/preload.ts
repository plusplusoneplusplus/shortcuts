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
const REPORT_ISSUE_SUBMIT_CHANNEL = 'coc-desktop:report-issue-submit';
const REPORT_ISSUE_CANCEL_CHANNEL = 'coc-desktop:report-issue-cancel';
const SCREENSHOT_OVERLAY_INIT_CHANNEL = 'coc-desktop:screenshot-overlay-init';
const SCREENSHOT_CROP_CHANNEL = 'coc-desktop:screenshot-crop';
const SCREENSHOT_CANCEL_CHANNEL = 'coc-desktop:screenshot-cancel';
const SCREENSHOT_ANNOTATE_INIT_CHANNEL = 'coc-desktop:screenshot-annotate-init';
const SCREENSHOT_ANNOTATE_DONE_CHANNEL = 'coc-desktop:screenshot-annotate-done';
const SCREENSHOT_ANNOTATE_CANCEL_CHANNEL = 'coc-desktop:screenshot-annotate-cancel';
const SCREENSHOT_ANNOTATE_SAVE_CHANNEL = 'coc-desktop:screenshot-annotate-save';
const SCREENSHOT_ATTACH_CHANNEL = 'coc-desktop:screenshot-attach';
const POPOUT_NAV_CHANNEL = 'coc-desktop:popout-nav';
const POPOUT_NAVIGATE_CHANNEL = 'coc-desktop:popout-navigate';
const POPOUT_OPEN_EXTERNAL_CHANNEL = 'coc-desktop:popout-open-external';
const POPOUT_COPY_URL_CHANNEL = 'coc-desktop:popout-copy-url';
const POPOUT_STATE_CHANNEL = 'coc-desktop:popout-state';

/** Shape of an Electron `found-in-page` result, as relayed to the renderer. */
interface FindResult {
    activeMatchOrdinal: number;
    matches: number;
}

/** Payload the main process pushes to the capture overlay (see screenshot-capture.ts). */
interface OverlayInitPayload {
    imageDataUrl: string;
    width: number;
    height: number;
}

/** A crop rectangle sent from the overlay to the main process. */
interface CropRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** Payload the main process pushes to the annotation editor (see screenshot-capture.ts). */
interface AnnotateInitPayload {
    imageDataUrl: string;
    width: number;
    height: number;
}

/** Navigation snapshot the main process pushes to a pop-out's chrome bar. */
interface PopOutState {
    url: string;
    canGoBack: boolean;
    canGoForward: boolean;
    loading: boolean;
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
    /**
     * Report an Issue… modal bridge (see `report-issue.ts`). The modal document
     * calls `submit(title, description)` with both fields already trimmed, or
     * `cancel()` to dismiss. The main process builds the prefilled GitHub URL and
     * opens it in the default browser — nothing is uploaded from here, and no
     * credential ever crosses this bridge.
     */
    reportIssue: {
        submit: (title: string, description: string) =>
            ipcRenderer.send(REPORT_ISSUE_SUBMIT_CHANNEL, title, description),
        cancel: () => ipcRenderer.send(REPORT_ISSUE_CANCEL_CHANNEL),
    },
    /**
     * Screenshot capture + annotate bridge (see screenshot-capture.ts), used from
     * two renderers. The fullscreen capture overlay uses `onOverlayInit` to receive
     * the frozen shot, then `crop`/`cancel` to report the selected region or dismiss
     * the flow. The annotation editor window (AC-03) uses `onAnnotateInit` to receive
     * the cropped image, then `done` (flattened PNG data URL) / `cancelAnnotate`,
     * plus `saveAnnotate` for an on-demand Save-As that leaves the editor open.
     * The SPA (main CoC window) uses `onScreenshotAttach` to receive a finished
     * screenshot pushed from the main process (AC-04 chat-attach sink) and add it
     * to the active chat draft. The main process routes each request by sender
     * (see screenshot-capture-host.ts).
     */
    screenshot: {
        onOverlayInit: (callback: (payload: OverlayInitPayload) => void) => {
            const listener = (_event: unknown, payload: OverlayInitPayload) => callback(payload);
            ipcRenderer.on(SCREENSHOT_OVERLAY_INIT_CHANNEL, listener);
            return () => ipcRenderer.removeListener(SCREENSHOT_OVERLAY_INIT_CHANNEL, listener);
        },
        crop: (rect: CropRect) => ipcRenderer.send(SCREENSHOT_CROP_CHANNEL, rect),
        cancel: () => ipcRenderer.send(SCREENSHOT_CANCEL_CHANNEL),
        onAnnotateInit: (callback: (payload: AnnotateInitPayload) => void) => {
            const listener = (_event: unknown, payload: AnnotateInitPayload) => callback(payload);
            ipcRenderer.on(SCREENSHOT_ANNOTATE_INIT_CHANNEL, listener);
            return () => ipcRenderer.removeListener(SCREENSHOT_ANNOTATE_INIT_CHANNEL, listener);
        },
        done: (pngDataUrl: string) => ipcRenderer.send(SCREENSHOT_ANNOTATE_DONE_CHANNEL, pngDataUrl),
        cancelAnnotate: () => ipcRenderer.send(SCREENSHOT_ANNOTATE_CANCEL_CHANNEL),
        saveAnnotate: (pngDataUrl: string) =>
            ipcRenderer.send(SCREENSHOT_ANNOTATE_SAVE_CHANNEL, pngDataUrl),
        onScreenshotAttach: (callback: (pngDataUrl: string) => void) => {
            const listener = (_event: unknown, pngDataUrl: string) => callback(pngDataUrl);
            ipcRenderer.on(SCREENSHOT_ATTACH_CHANNEL, listener);
            return () => ipcRenderer.removeListener(SCREENSHOT_ATTACH_CHANNEL, listener);
        },
    },
    /**
     * Pop-out address-bar bridge (see popout-chrome.ts / popout-window-host.ts),
     * used from two renderers inside the same pop-out window: the chrome strip
     * drives `nav` / `navigate` / `openExternal` / `copyUrl` / `onState`, while
     * the popped-out page only sends `nav` for its injected Alt+←/→, Ctrl+R and
     * Ctrl+L shortcuts. The main process routes each request by sender.
     */
    popout: {
        nav: (action: string) => ipcRenderer.send(POPOUT_NAV_CHANNEL, action),
        navigate: (url: string) => ipcRenderer.send(POPOUT_NAVIGATE_CHANNEL, url),
        openExternal: () => ipcRenderer.send(POPOUT_OPEN_EXTERNAL_CHANNEL),
        copyUrl: () => ipcRenderer.send(POPOUT_COPY_URL_CHANNEL),
        onState: (callback: (state: PopOutState) => void) => {
            const listener = (_event: unknown, state: PopOutState) => callback(state);
            ipcRenderer.on(POPOUT_STATE_CHANNEL, listener);
            return () => ipcRenderer.removeListener(POPOUT_STATE_CHANNEL, listener);
        },
    },
} as const;

contextBridge.exposeInMainWorld('cocDesktop', api);

export type CocDesktopApi = typeof api;
