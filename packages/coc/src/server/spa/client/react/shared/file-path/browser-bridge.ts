/** Reply to `browser.open` / `browser.navigate`. */
export type BrowserOpenResult = { ok: true } | { ok: false; reason: string };

/** Live navigation snapshot of a desktop browser view. */
export interface BrowserViewState {
    viewId: string;
    url: string;
    title: string;
    canGoBack: boolean;
    canGoForward: boolean;
    loading: boolean;
    error?: string;
}

/** A page asked to open a new-window link as another tab. */
export interface BrowserNewTabRequest {
    openerViewId: string;
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
    open(viewId: string, url: string, sessionKey: string): Promise<BrowserOpenResult>;
    navigate(viewId: string, url: string): Promise<BrowserOpenResult>;
    nav(viewId: string, action: 'back' | 'forward' | 'reload' | 'stop'): void;
    setBounds(viewId: string, rect: { x: number; y: number; width: number; height: number } | null): void;
    hide(viewId: string): void;
    close(viewId: string): void;
    openExternal(url: string): Promise<boolean>;
    onState(callback: (state: BrowserViewState) => void): () => void;
    onNewTab(callback: (request: BrowserNewTabRequest) => void): () => void;
    onDownload(callback: (event: BrowserDownloadEvent) => void): () => void;
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
