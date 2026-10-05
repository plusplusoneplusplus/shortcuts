/**
 * CoC Desktop — preload script.
 *
 * Runs in the renderer's isolated context before the SPA loads. The SPA is the
 * unmodified CoC web client served from localhost, so the preload exposes only a
 * tiny bridge: read-only diagnostics plus the find-in-page channel used by the
 * injected find bar (see `find-in-page.ts`). Further privileged IPC channels are
 * added by later acceptance criteria as the main process grows them.
 */

import { contextBridge, ipcRenderer, webUtils } from 'electron';

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
const MENU_COPY_CHANNEL = 'coc-desktop:menu-copy';
const MENU_COPY_HANDLED_CHANNEL = 'coc-desktop:menu-copy-handled';
const HTML_PAGE_VIEW_PREFIX = 'html-page:';
const HTML_PAGE_SESSION_KEY = 'html-page';
const BROWSER_VIEW_OPEN_CHANNEL = 'coc-desktop:browser-view-open';
const BROWSER_VIEW_NAVIGATE_CHANNEL = 'coc-desktop:browser-view-navigate';
const BROWSER_VIEW_NAV_CHANNEL = 'coc-desktop:browser-view-nav';
const BROWSER_VIEW_SET_BOUNDS_CHANNEL = 'coc-desktop:browser-view-set-bounds';
const BROWSER_VIEW_HIDE_CHANNEL = 'coc-desktop:browser-view-hide';
const BROWSER_VIEW_CLOSE_CHANNEL = 'coc-desktop:browser-view-close';
const BROWSER_OPEN_EXTERNAL_CHANNEL = 'coc-desktop:browser-open-external';
const BROWSER_VIEW_STATE_CHANNEL = 'coc-desktop:browser-view-state';
const BROWSER_VIEW_NEW_TAB_CHANNEL = 'coc-desktop:browser-view-new-tab';
const BROWSER_VIEW_DOWNLOAD_CHANNEL = 'coc-desktop:browser-view-download';
const BROWSER_PREFERENCES_GET_CHANNEL = 'coc-desktop:browser-preferences-get';
const BROWSER_PREFERENCES_SET_CHANNEL = 'coc-desktop:browser-preferences-set';
const BROWSER_PREFERENCES_CHANGED_CHANNEL = 'coc-desktop:browser-preferences-changed';
const BROWSER_CLEAR_DATA_CHANNEL = 'coc-desktop:browser-clear-data';
const BROWSER_VIEW_CLOSE_REQUESTED_CHANNEL = 'coc-desktop:browser-view-close-requested';
const BROWSER_VIEW_CLOSED_CHANNEL = 'coc-desktop:browser-view-closed';
const BROWSER_VIEW_FOCUS_CHANNEL = 'coc-desktop:browser-view-focus';
const BROWSER_HOST_FOCUS_CHANNEL = 'coc-desktop:browser-host-focus';
const BROWSER_VIEW_OPEN_EXTERNAL_CHANNEL = 'coc-desktop:browser-view-open-external';
const BROWSER_SOURCE_KINDS = ['url', 'file'] as const;

// Chromium's DOM focus does not release the separate WebView2 process's native focus.
if (typeof document !== 'undefined') {
    const focusHost = () => ipcRenderer.send(BROWSER_HOST_FOCUS_CHANNEL);
    document.addEventListener('pointerdown', focusHost, true);
    document.addEventListener('focusin', focusHost, true);
}

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

/** Reply to `htmlPage.open` (mirrors `HtmlPageOpenResult` in html-page-policy.ts). */
type HtmlPageOpenResult = { ok: true } | { ok: false; reason: string };

/** Load status of a page tab (mirrors `HtmlPageLoadState` in html-page-policy.ts). */
interface HtmlPageLoadState {
    pageId: string;
    status: 'loading' | 'loaded' | 'failed';
    url?: string;
    error?: string;
}

/** Placeholder rect in SPA CSS px, straight from `getBoundingClientRect()`. */
interface HtmlPageRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** Reply to `browser.open` / `browser.navigate` (mirrors `BrowserOpenResult` in browser-view-policy.ts). */
type BrowserEngine = 'electron' | 'webview2';
type BrowserSourceKind = typeof BROWSER_SOURCE_KINDS[number];
type BrowserOpenResult = { ok: true; engine: BrowserEngine; sourceKind?: BrowserSourceKind } | { ok: false; reason: string; message?: string; engine?: BrowserEngine };
/** What `browser.open` loads (mirrors `BrowserSource`); a bare string is a `url` source. */
type BrowserSource = { kind: 'url'; url: string } | { kind: 'file'; path: string };
interface BrowserPreferences {
    defaultEngine: BrowserEngine;
    engines: { engine: BrowserEngine; available: boolean; reason?: string; message?: string }[];
    clearing: BrowserEngine[];
}

/** Live navigation snapshot of a browser tab (mirrors `BrowserViewState`). */
interface BrowserViewState {
    viewId: string;
    engine: BrowserEngine;
    sourceKind?: BrowserSourceKind;
    url: string;
    title: string;
    canGoBack: boolean;
    canGoForward: boolean;
    loading: boolean;
    error?: string;
    errorCode?: string;
}

/** A page asked to open a new tab (mirrors `BrowserNewTabRequest`). */
interface BrowserNewTabRequest {
    openerViewId: string;
    engine: BrowserEngine;
    url: string;
}

/** Download handed to the system browser (mirrors `BrowserDownloadEvent`). */
interface BrowserDownloadEvent {
    viewId: string;
    url: string;
    ok: boolean;
    error?: string;
}

const HTML_PAGE_OPEN_REASONS = ['invalid', 'not-absolute', 'not-html', 'missing', 'not-file', 'bad-id'];

/** Mirrors `toHtmlPageOpenResult` in html-page-policy.ts. */
function toHtmlPageOpenResult(result: BrowserOpenResult): HtmlPageOpenResult {
    if (result.ok) { return { ok: true }; }
    return { ok: false, reason: HTML_PAGE_OPEN_REASONS.includes(result.reason) ? result.reason : 'no-window' };
}

/** Mirrors `toHtmlPageLoadState` in html-page-policy.ts. */
function toHtmlPageLoadState(pageId: string, state: BrowserViewState): HtmlPageLoadState {
    const status = state.error ? 'failed' : state.loading ? 'loading' : 'loaded';
    return { pageId, status, url: state.url || undefined, ...(state.error ? { error: state.error } : {}) };
}

/** Subscribe `callback` to a main → SPA channel; returns the unsubscribe function. */
function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
    const listener = (_event: unknown, payload: T) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
}

/**
 * Browser tab bridge (see browser-view-host.ts). The SPA picks an opaque
 * `viewId` per tab and opens it with a source — `{ kind: 'url', url }`
 * (http(s), or a bare URL string) or `{ kind: 'file', path }` (a local
 * `.html`/`.htm` preview, always in the isolated Electron file host) — and
 * the tab's concrete owner `sessionKey`. `sources` lists the supported
 * source kinds so the SPA can feature-detect file previews. Sign-ins persist
 * installation-wide in separate engine profiles. It keeps the view over its placeholder with `setBounds` (null
 * hides it) / `hide`, drives history with `nav`, and tears it down with
 * `close`. `onState` streams url/title/history/loading/error, `onNewTab`
 * asks the SPA to open a new-window link as another tab, and `onDownload`
 * reports downloads handed to the system browser.
 */
const browser = {
    sources: BROWSER_SOURCE_KINDS,
    open: (viewId: string, source: BrowserSource | string, sessionKey: string, relatedEngine?: BrowserEngine): Promise<BrowserOpenResult> =>
        ipcRenderer.invoke(BROWSER_VIEW_OPEN_CHANNEL, viewId, source, sessionKey, relatedEngine),
    navigate: (viewId: string, url: string): Promise<BrowserOpenResult> =>
        ipcRenderer.invoke(BROWSER_VIEW_NAVIGATE_CHANNEL, viewId, url),
    nav: (viewId: string, action: 'back' | 'forward' | 'reload' | 'stop') =>
        ipcRenderer.send(BROWSER_VIEW_NAV_CHANNEL, viewId, action),
    setBounds: (viewId: string, rect: HtmlPageRect | null) =>
        ipcRenderer.send(BROWSER_VIEW_SET_BOUNDS_CHANNEL, viewId, rect),
    hide: (viewId: string) => ipcRenderer.send(BROWSER_VIEW_HIDE_CHANNEL, viewId),
    close: (viewId: string) => ipcRenderer.send(BROWSER_VIEW_CLOSE_CHANNEL, viewId),
    focus: (viewId: string) => ipcRenderer.send(BROWSER_VIEW_FOCUS_CHANNEL, viewId),
    openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke(BROWSER_OPEN_EXTERNAL_CHANNEL, url),
    /** Open the view's current page in the system browser (http(s) pages, or the previewed `file:` page). */
    openViewExternal: (viewId: string) => ipcRenderer.send(BROWSER_VIEW_OPEN_EXTERNAL_CHANNEL, viewId),
    onState: (callback: (state: BrowserViewState) => void) => subscribe(BROWSER_VIEW_STATE_CHANNEL, callback),
    onNewTab: (callback: (request: BrowserNewTabRequest) => void) =>
        subscribe(BROWSER_VIEW_NEW_TAB_CHANNEL, callback),
    onDownload: (callback: (event: BrowserDownloadEvent) => void) =>
        subscribe(BROWSER_VIEW_DOWNLOAD_CHANNEL, callback),
    getPreferences: (): Promise<BrowserPreferences> => ipcRenderer.invoke(BROWSER_PREFERENCES_GET_CHANNEL),
    setDefaultEngine: (engine: BrowserEngine): Promise<{ ok: boolean; reason?: string; message?: string }> =>
        ipcRenderer.invoke(BROWSER_PREFERENCES_SET_CHANNEL, engine),
    clearData: (engine: BrowserEngine): Promise<{ ok: boolean; reason?: string; message?: string }> =>
        ipcRenderer.invoke(BROWSER_CLEAR_DATA_CHANNEL, engine),
    onPreferencesChanged: (callback: () => void) => subscribe(BROWSER_PREFERENCES_CHANGED_CHANNEL, callback),
    onCloseRequested: (callback: (event: { viewId: string }) => void) => subscribe(BROWSER_VIEW_CLOSE_REQUESTED_CHANNEL, callback),
    onClosed: (callback: (event: { viewId: string; engine: BrowserEngine }) => void) => subscribe(BROWSER_VIEW_CLOSED_CHANNEL, callback),
};

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
     * Absolute on-disk path of a `File` pulled off a drag-and-drop
     * `DataTransfer`, so the SPA composer can turn an OS file drop into a
     * backticked path insertion. Electron 32 removed the old `File.path`
     * property, so `webUtils.getPathForFile` is the only way to recover it —
     * and it works right here in the preload, no IPC round-trip needed.
     *
     * Returns null when the File did not come from disk (a synthesized Blob,
     * a paste of image bytes) so callers can skip it instead of inserting an
     * empty path.
     */
    getPathForFile: (file: File): string | null => {
        try {
            const filePath = webUtils.getPathForFile(file);
            return filePath ? filePath : null;
        } catch {
            return null;
        }
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
    /**
     * Native Edit ▸ Copy bridge (see `terminal-copy.ts`). The main process pushes
     * `onCopy` when the menu item fires; a focused xterm terminal that owns a
     * selection copies it and calls `copyHandled()` so the main process skips its
     * `webContents.copy()` fallback. Silence means "not a terminal" and the
     * fallback copies the DOM selection as usual.
     */
    menu: {
        onCopy: (callback: () => void) => {
            const listener = () => callback();
            ipcRenderer.on(MENU_COPY_CHANNEL, listener);
            return () => ipcRenderer.removeListener(MENU_COPY_CHANNEL, listener);
        },
        copyHandled: () => ipcRenderer.send(MENU_COPY_HANDLED_CHANNEL),
    },
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
    /**
     * HTML page tab bridge — compatibility wrapper for SPAs that predate `file`
     * sources on {@link browser}. Each `pageId` maps to the browser view
     * `html-page:<pageId>`; `open` opens it as a `file` source and narrows the
     * reply to `{ ok: true } | { ok: false, reason }` (a refusal lets the SPA
     * fall back to the source viewer), and `onState` reports loading / loaded /
     * failed for those views only. All view logic lives behind `browser`.
     */
    htmlPage: {
        open: async (pageId: string, filePath: string): Promise<HtmlPageOpenResult> =>
            toHtmlPageOpenResult(await browser.open(HTML_PAGE_VIEW_PREFIX + pageId, { kind: 'file', path: filePath }, HTML_PAGE_SESSION_KEY)),
        setBounds: (pageId: string, rect: HtmlPageRect | null) => browser.setBounds(HTML_PAGE_VIEW_PREFIX + pageId, rect),
        hide: (pageId: string) => browser.hide(HTML_PAGE_VIEW_PREFIX + pageId),
        close: (pageId: string) => browser.close(HTML_PAGE_VIEW_PREFIX + pageId),
        reload: (pageId: string) => browser.nav(HTML_PAGE_VIEW_PREFIX + pageId, 'reload'),
        openExternal: (pageId: string) => browser.openViewExternal(HTML_PAGE_VIEW_PREFIX + pageId),
        onState: (callback: (state: HtmlPageLoadState) => void) => browser.onState(state => {
            if (state.viewId.startsWith(HTML_PAGE_VIEW_PREFIX)) { callback(toHtmlPageLoadState(state.viewId.slice(HTML_PAGE_VIEW_PREFIX.length), state)); }
        }),
    },
    browser,
} as const;

contextBridge.exposeInMainWorld('cocDesktop', api);

export type CocDesktopApi = typeof api;
