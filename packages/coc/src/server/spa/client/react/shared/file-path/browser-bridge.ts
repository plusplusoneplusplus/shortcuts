/** Reply to `browser.open` / `browser.navigate`. */
export type BrowserEngine = 'electron' | 'webview2';
/** What `browser.open` loads; a bare string is a `url` source. */
export type BrowserSource = { kind: 'url'; url: string } | { kind: 'file'; path: string };
export type BrowserOpenResult = { ok: true; engine: BrowserEngine; sourceKind?: BrowserSource['kind']; embed?: 'webview'; src?: string; partition?: string } | { ok: false; reason: string; message?: string; engine?: BrowserEngine };
export interface BrowserPreferences {
    defaultEngine: BrowserEngine;
    engines: { engine: BrowserEngine; available: boolean; reason?: string; message?: string }[];
    clearing: BrowserEngine[];
    pageZoom?: { percent: number; min: number; max: number; step: number };
}
export type BrowserOperationResult = { ok: true } | { ok: false; reason: string; message?: string };
export interface BrowserHistoryEntry {
    url: string;
    title: string;
    lastVisited: number;
    visitCount: number;
}
export interface BrowserHistorySuggestion extends BrowserHistoryEntry { completion: string | null }
export type BrowserHistoryResult<T = BrowserHistoryEntry> = {
    ok: true; entries: T[]; total: number; recording: boolean; storageError: string | null;
} | { ok: false; reason: string; message?: string };
export interface DesktopBrowserHistory {
    query(search?: string, offset?: number, limit?: number): Promise<BrowserHistoryResult>;
    suggest(search?: string): Promise<BrowserHistoryResult<BrowserHistorySuggestion>>;
    delete(url: string): Promise<BrowserOperationResult>;
    clear(): Promise<BrowserOperationResult>;
    setRecording(recording: boolean): Promise<BrowserOperationResult>;
    onChanged(callback: () => void): () => void;
}
export const WEBVIEW2_INSTALL_URL = 'https://developer.microsoft.com/microsoft-edge/webview2/#download-section';
export const DESKTOP_BROWSER_PREFERENCES_HASH = '#admin/settings/appearance';

/** Live navigation snapshot of a desktop browser view. */
export interface BrowserViewState {
    viewId: string;
    engine: BrowserEngine;
    sourceKind?: BrowserSource['kind'];
    url: string;
    title: string;
    canGoBack: boolean;
    canGoForward: boolean;
    loading: boolean;
    error?: string;
    errorCode?: string;
}

/** A page asked to open a new-window link as another tab. */
export interface BrowserNewTabRequest {
    openerViewId: string;
    engine: BrowserEngine;
    url: string;
}

/** A download the desktop handed to the system browser. */
export interface BrowserDownloadEvent {
    viewId: string;
    url: string;
    ok: boolean;
    error?: string;
}

/** The desktop preload's browser tab API (see coc-desktop browser-view-host.ts). */
export interface DesktopBrowserBridge {
    /** Installation-wide history; absent on older desktop hosts. */
    history?: DesktopBrowserHistory;
    /** Source kinds `open` accepts; absent on desktops that only open URLs. */
    sources?: readonly string[];
    importCookies?(viewId: string | null, domain: string, cookies: string, engine?: BrowserEngine): Promise<BrowserOperationResult>;
    open(viewId: string, source: string | BrowserSource, sessionKey: string, relatedEngine?: BrowserEngine): Promise<BrowserOpenResult>;
    adopt?(viewId: string, guestId: number): Promise<BrowserOperationResult>;
    navigate(viewId: string, url: string): Promise<BrowserOpenResult>;
    nav(viewId: string, action: 'back' | 'forward' | 'reload' | 'stop'): void;
    setBounds(viewId: string, rect: { x: number; y: number; width: number; height: number } | null): void;
    hide(viewId: string): void;
    close(viewId: string): void;
    focus(viewId: string): void;
    openExternal(url: string): Promise<boolean>;
    /** Hand a view's current page to the system handler; present alongside `sources`. */
    openViewExternal?(viewId: string): void;
    onState(callback: (state: BrowserViewState) => void): () => void;
    onNewTab(callback: (request: BrowserNewTabRequest) => void): () => void;
    onDownload(callback: (event: BrowserDownloadEvent) => void): () => void;
    getPreferences(): Promise<BrowserPreferences>;
    setPageZoom?(percent: number): Promise<BrowserOperationResult>;
    setDefaultEngine(engine: BrowserEngine): Promise<BrowserOperationResult>;
    clearData(engine: BrowserEngine): Promise<BrowserOperationResult>;
    onPreferencesChanged(callback: () => void): () => void;
    /** Native page shortcuts cannot bubble into the SPA document. */
    onFocusAddressRequested?(callback: (event: { viewId: string }) => void): () => void;
    onOpenMenuRequested?(callback: (event: { viewId: string }) => void): () => void;
    onCloseRequested?(callback: (event: { viewId: string }) => void): () => void;
    onClosed(callback: (event: { viewId: string; engine: BrowserEngine }) => void): () => void;
}

/** Event a chat web-link click sends to ask the right panel for a browser tab. */
export const OPEN_BROWSER_URL_EVENT = 'coc-open-browser-url';

export interface OpenBrowserUrlDetail {
    url: string;
    /** Set by the panel that opened the tab. */
    handled?: boolean;
}

/**
 * Ask the mounted right panel to open `url` in a browser tab. Returns false
 * when there is no desktop browser view or no panel took it, so the caller
 * keeps its normal link behavior.
 */
export function requestPanelBrowserTab(url: string): boolean {
    if (!desktopBrowserBridge()) return false;
    const detail: OpenBrowserUrlDetail = { url };
    window.dispatchEvent(new CustomEvent(OPEN_BROWSER_URL_EVENT, { detail }));
    return detail.handled === true;
}

export function desktopBrowserBridge(): DesktopBrowserBridge | undefined {
    return (window as { cocDesktop?: { browser?: DesktopBrowserBridge } }).cocDesktop?.browser;
}

/**
 * Open an http(s) URL in the system browser: through the desktop bridge when
 * there is one, else a new `noopener` window. Resolves false when the handoff
 * failed (or a pop-up blocker stopped it).
 */
export async function openUrlInSystemBrowser(url: string): Promise<boolean> {
    const bridge = desktopBrowserBridge();
    if (bridge) {
        try {
            return await bridge.openExternal(url);
        } catch {
            return false;
        }
    }
    // `noopener` makes window.open return null even on success, so only a throw counts as failure.
    try {
        window.open(url, '_blank', 'noopener,noreferrer');
        return true;
    } catch {
        return false;
    }
}
