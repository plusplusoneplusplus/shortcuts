import { desktopBrowserBridge, type DesktopBrowserBridge } from './browser-bridge';

/**
 * The SPA's sandboxed local HTML page view API. Backed by the merged
 * `cocDesktop.browser` file source when the desktop advertises it, else by the
 * older `cocDesktop.htmlPage` preload API (which has no history control).
 */
export interface DesktopHtmlPageBridge {
    open(pageId: string, filePath: string): Promise<{ ok: true; embed?: 'webview'; src?: string; partition?: string } | { ok: false; reason: string }>;
    setBounds(pageId: string, rect: { x: number; y: number; width: number; height: number } | null): void;
    hide(pageId: string): void;
    close(pageId: string): void;
    reload(pageId: string): void;
    openExternal(pageId: string): void;
    onState(callback: (state: HtmlPageLoadState) => void): () => void;
    /** Back / forward through the page's history; absent on desktops without the merged browser API. */
    nav?(pageId: string, action: 'back' | 'forward'): void;
}

export interface HtmlPageLoadState {
    pageId: string;
    status: 'loading' | 'loaded' | 'failed';
    url?: string;
    error?: string;
    canGoBack?: boolean;
    canGoForward?: boolean;
}

export interface OpenHtmlPageDetail {
    pageId: string;
    filePath: string;
    wsId: string;
    scopeWsId: string;
    chatId?: string;
    handled?: boolean;
}

/** Browser view id and session the desktop's own `htmlPage` wrapper uses, so both paths share one id space. */
export const HTML_PAGE_VIEW_PREFIX = 'html-page:';
export const HTML_PAGE_SESSION_KEY = 'html-page';

type FileSourceBrowserBridge = DesktopBrowserBridge & { openViewExternal(viewId: string): void };

function supportsFileSource(bridge: DesktopBrowserBridge | undefined): bridge is FileSourceBrowserBridge {
    return Boolean(bridge?.sources?.includes('file') && typeof bridge.openViewExternal === 'function');
}

/** Adapt the merged browser API's `file` source to the page view API. */
export function htmlPageBridgeFromBrowser(browser: FileSourceBrowserBridge): DesktopHtmlPageBridge {
    const viewId = (pageId: string) => HTML_PAGE_VIEW_PREFIX + pageId;
    return {
        open: async (pageId, filePath) => {
            const result = await browser.open(viewId(pageId), { kind: 'file', path: filePath }, HTML_PAGE_SESSION_KEY);
            return result.ok ? {
                ok: true,
                ...(result.embed ? { embed: result.embed, src: result.src, partition: result.partition } : {}),
            } : { ok: false, reason: result.reason };
        },
        setBounds: (pageId, rect) => browser.setBounds(viewId(pageId), rect),
        hide: pageId => browser.hide(viewId(pageId)),
        close: pageId => browser.close(viewId(pageId)),
        reload: pageId => browser.nav(viewId(pageId), 'reload'),
        nav: (pageId, action) => browser.nav(viewId(pageId), action),
        openExternal: pageId => browser.openViewExternal(viewId(pageId)),
        onState: callback => browser.onState(state => {
            if (!state.viewId.startsWith(HTML_PAGE_VIEW_PREFIX)) return;
            const failed = Boolean(state.error) && !state.loading;
            callback({
                pageId: state.viewId.slice(HTML_PAGE_VIEW_PREFIX.length),
                status: failed ? 'failed' : state.loading ? 'loading' : 'loaded',
                url: state.url,
                ...(failed ? { error: state.error } : {}),
                canGoBack: state.canGoBack,
                canGoForward: state.canGoForward,
            });
        }),
    };
}

let cachedBrowser: FileSourceBrowserBridge | undefined;
let cachedAdapter: DesktopHtmlPageBridge | undefined;

/**
 * The page view API, or undefined outside the desktop app. Prefers the merged
 * browser `file` source; an older desktop without it falls back to `htmlPage`.
 */
export function desktopHtmlPageBridge(): DesktopHtmlPageBridge | undefined {
    const browser = desktopBrowserBridge();
    if (supportsFileSource(browser)) {
        // One adapter per bridge keeps the value stable across renders (effect deps).
        if (cachedBrowser !== browser) {
            cachedBrowser = browser;
            cachedAdapter = htmlPageBridgeFromBrowser(browser);
        }
        return cachedAdapter;
    }
    return (window as { cocDesktop?: { htmlPage?: DesktopHtmlPageBridge } }).cocDesktop?.htmlPage;
}
