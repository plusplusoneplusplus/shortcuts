/**
 * CoC Desktop — pop-out window host (main-process side).
 *
 * Builds the chrome-bar pop-out windows described in `popout-chrome.ts`: one
 * BrowserWindow whose `contentView` holds a fixed-height chrome strip on top and
 * the popped-out page below. Electron cannot inset a BrowserWindow's own
 * `webContents` — sibling views only ever overlay it — so owning back/forward
 * means owning the window, which means the `window.open` is denied and
 * reconstructed here (see the allow-list in `isPopOutChildUrl`).
 *
 * SECURITY — the page view carries the standard preload. That is only safe
 * because the navigation policy keeps it same-origin: typed cross-origin http(s)
 * goes to the system browser, other schemes are rejected, and in-page
 * `will-navigate` gets the same `shouldOpenExternally` treatment as the main
 * window. If that policy is ever relaxed, DROP the preload for foreign origins.
 *
 * This module imports from `electron`, so it is exercised by the live Electron
 * harness (test/e2e/popout-bar.e2e.test.ts) rather than unit tests; keep the
 * logic here thin and push everything testable into `popout-chrome.ts`.
 */

import * as path from 'path';
import { BrowserWindow, WebContentsView, clipboard, ipcMain, shell } from 'electron';
import {
    CHROME_BAR_HEIGHT,
    POPOUT_COPY_URL_CHANNEL,
    POPOUT_NAVIGATE_CHANNEL,
    POPOUT_NAV_CHANNEL,
    POPOUT_OPEN_EXTERNAL_CHANNEL,
    POPOUT_STATE_CHANNEL,
    PopOutNavAction,
    buildChromeBarHtml,
    buildPopOutShortcutScript,
    layoutPopOutViews,
    parsePopOutWindowSize,
    resolveTypedUrl,
} from './popout-chrome';
import { shouldOpenExternally } from './lifecycle';
import { PdfChildWindow, isSameOriginPdfChildUrl, wirePdfChildWindowClose } from './pdf-child-window';

interface PopOutEntry {
    win: BrowserWindow;
    chromeView: WebContentsView;
    pageView: WebContentsView;
    /** The served SPA's origin — the one origin the page view may navigate to. */
    appUrl: string;
    /** `window.open` target name, or '' for an unnamed open. */
    name: string;
}

/** Keyed by `window.open` name, so a repeat open focuses instead of duplicating. */
const entriesByName = new Map<string, PopOutEntry>();
/** Keyed by BOTH the chrome-bar and the page webContents id, for IPC routing. */
const entriesByContentsId = new Map<number, PopOutEntry>();

let ipcRegistered = false;

/** Options for one intercepted `window.open`. */
export interface CreatePopOutWindowOptions {
    /** The popped-out URL (already passed {@link isPopOutChildUrl}). */
    url: string;
    /** `window.open`'s second argument. Empty / `_blank` means "no reuse". */
    name?: string;
    /** `window.open`'s third argument, e.g. `width=900,height=700`. */
    features?: string;
    /** The served SPA URL; defines the one origin the page view may load. */
    appUrl: string;
    /** Window icon, matching the main window's. */
    icon?: Electron.NativeImage;
    /**
     * Ask the user whether to discard unsaved PDF annotations. Only consulted
     * for popped-out PDFs (see `pdf-child-window.ts`).
     */
    confirmPdfDiscard?: (win: BrowserWindow) => boolean;
}

/** Reusable names only — `_blank` explicitly asks for a fresh window each time. */
function reusableName(name?: string): string {
    const trimmed = (name ?? '').trim();
    return !trimmed || trimmed === '_blank' ? '' : trimmed;
}

function navigationState(entry: PopOutEntry) {
    const wc = entry.pageView.webContents;
    return {
        url: wc.getURL(),
        canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward(),
        loading: wc.isLoading(),
    };
}

/** Push a fresh {@link PopOutState} to the chrome bar. Safe after teardown. */
function pushState(entry: PopOutEntry): void {
    if (entry.chromeView.webContents.isDestroyed() || entry.pageView.webContents.isDestroyed()) {
        return;
    }
    entry.chromeView.webContents.send(POPOUT_STATE_CHANNEL, navigationState(entry));
}

function focusAddressField(entry: PopOutEntry): void {
    if (entry.chromeView.webContents.isDestroyed()) {
        return;
    }
    entry.chromeView.webContents.focus();
    entry.chromeView.webContents
        .executeJavaScript('window.__cocPopOutFocusUrl && window.__cocPopOutFocusUrl()')
        .catch(() => { /* focusing is a nicety — never break the window */ });
}

function applyNavAction(entry: PopOutEntry, action: PopOutNavAction): void {
    const wc = entry.pageView.webContents;
    if (wc.isDestroyed()) {
        return;
    }
    switch (action) {
        case 'back':
            if (wc.navigationHistory.canGoBack()) {
                wc.navigationHistory.goBack();
            }
            break;
        case 'forward':
            if (wc.navigationHistory.canGoForward()) {
                wc.navigationHistory.goForward();
            }
            break;
        case 'reload':
            wc.reload();
            break;
        case 'stop':
            wc.stop();
            break;
        case 'focus-bar':
            focusAddressField(entry);
            break;
        case 'focus-page':
            wc.focus();
            break;
        default:
            break;
    }
}

/**
 * Apply the AC-04 navigation policy to a URL typed into the address field:
 * same-origin loads in the page view, cross-origin http(s) goes to the system
 * browser, anything else is rejected. Either way the bar is re-synced from the
 * live page URL, so a rejected or externalised entry reverts its text.
 */
function applyTypedUrl(entry: PopOutEntry, input: string): void {
    const resolved = resolveTypedUrl(input, entry.appUrl);
    if (resolved.kind === 'internal' && !entry.pageView.webContents.isDestroyed()) {
        void entry.pageView.webContents.loadURL(resolved.url).catch(() => {
            /* a failed load surfaces via did-fail-load; never throw into IPC */
        });
    } else if (resolved.kind === 'external') {
        void shell.openExternal(resolved.url);
    }
    pushState(entry);
}

/**
 * Register the app-wide pop-out IPC handlers exactly once. Every request is
 * routed by sender id through {@link entriesByContentsId}, so this stays correct
 * with many pop-out windows open: the chrome bar sends all five commands, and
 * the page view sends `nav` for its injected shortcuts.
 */
export function registerPopOutIpc(): void {
    if (ipcRegistered) {
        return;
    }
    ipcRegistered = true;
    ipcMain.on(POPOUT_NAV_CHANNEL, (event, action: PopOutNavAction) => {
        const entry = entriesByContentsId.get(event.sender.id);
        if (entry) {
            applyNavAction(entry, action);
        }
    });
    ipcMain.on(POPOUT_NAVIGATE_CHANNEL, (event, input: string) => {
        const entry = entriesByContentsId.get(event.sender.id);
        if (entry && typeof input === 'string') {
            applyTypedUrl(entry, input);
        }
    });
    ipcMain.on(POPOUT_OPEN_EXTERNAL_CHANNEL, (event) => {
        const entry = entriesByContentsId.get(event.sender.id);
        if (!entry || entry.pageView.webContents.isDestroyed()) {
            return;
        }
        const url = entry.pageView.webContents.getURL();
        if (url.startsWith('http:') || url.startsWith('https:')) {
            void shell.openExternal(url);
        }
    });
    ipcMain.on(POPOUT_COPY_URL_CHANNEL, (event) => {
        const entry = entriesByContentsId.get(event.sender.id);
        if (entry && !entry.pageView.webContents.isDestroyed()) {
            clipboard.writeText(entry.pageView.webContents.getURL());
        }
    });
}

/** Keep the two views filling the window across every resize. */
function layout(entry: PopOutEntry): void {
    const [width, height] = entry.win.getContentSize();
    const bounds = layoutPopOutViews(width, height);
    entry.chromeView.setBounds(bounds.chrome);
    entry.pageView.setBounds(bounds.page);
}

/**
 * Relay every navigation signal the bar cares about. `did-navigate-in-page`
 * matters more than usual: pop-outs are hash routes, so most navigation inside
 * one never fires `did-navigate`.
 */
function wireNavigationEvents(entry: PopOutEntry): void {
    const wc = entry.pageView.webContents;
    const relay = () => pushState(entry);
    wc.on('did-navigate', relay);
    wc.on('did-navigate-in-page', relay);
    wc.on('did-start-loading', relay);
    wc.on('did-stop-loading', relay);
    wc.on('did-fail-load', relay);
}

/**
 * Build (or focus) a pop-out window for an intercepted `window.open`.
 *
 * Name-keyed reuse mirrors the browser's own `window.open(url, name)` semantics,
 * which the SPA depends on: MarkdownReviewDialog's `coc-md-popout-<key>`, the
 * chat `coc-popout-<taskId>`, the `coc-git-review-<hash>` family and the canvas
 * `coc-canvas-<id>` all expect a repeat open to focus the existing window
 * rather than spawn a duplicate.
 */
export function createPopOutWindow(options: CreatePopOutWindowOptions): BrowserWindow {
    const name = reusableName(options.name);
    const existing = name ? entriesByName.get(name) : undefined;
    if (existing && !existing.win.isDestroyed()) {
        if (existing.win.isMinimized()) {
            existing.win.restore();
        }
        existing.win.focus();
        // Same name, different URL (e.g. a different commit in the review
        // window): navigate the existing window rather than ignoring the open.
        if (!existing.pageView.webContents.isDestroyed()
            && existing.pageView.webContents.getURL() !== options.url) {
            void existing.pageView.webContents.loadURL(options.url).catch(() => { /* surfaced by did-fail-load */ });
        }
        return existing.win;
    }

    const isMac = process.platform === 'darwin';
    const size = parsePopOutWindowSize(options.features);
    const win = new BrowserWindow({
        width: size.width,
        height: size.height,
        show: false,
        backgroundColor: '#0d1117',
        icon: options.icon,
        ...(isMac
            ? {
                titleBarStyle: 'hiddenInset' as const,
                // Centre the lights vertically inside the 40 px chrome strip.
                trafficLightPosition: { x: 12, y: (CHROME_BAR_HEIGHT - 14) / 2 },
            }
            : {}),
    });
    win.setMenuBarVisibility(false);

    const webPreferences = {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
    };
    const chromeView = new WebContentsView({ webPreferences });
    const pageView = new WebContentsView({ webPreferences });

    const entry: PopOutEntry = { win, chromeView, pageView, appUrl: options.appUrl, name };
    // The page view goes in first so the chrome strip paints above it.
    win.contentView.addChildView(pageView);
    win.contentView.addChildView(chromeView);
    layout(entry);

    const chromeId = chromeView.webContents.id;
    const pageId = pageView.webContents.id;
    entriesByContentsId.set(chromeId, entry);
    entriesByContentsId.set(pageId, entry);
    if (name) {
        entriesByName.set(name, entry);
    }

    void chromeView.webContents.loadURL(
        'data:text/html;charset=utf-8,' + encodeURIComponent(buildChromeBarHtml({ macInset: isMac })),
    );
    // The bar's data: URL and the page both load asynchronously, so the page's
    // first navigation events can land before the bar has a listener. Re-push
    // once the bar is ready, otherwise it opens showing an empty address field.
    chromeView.webContents.once('did-finish-load', () => pushState(entry));

    wireNavigationEvents(entry);

    // AC-04: in-page link clicks and navigations obey the same external-link
    // rule the main window uses, so the page view never leaves the app origin.
    pageView.webContents.setWindowOpenHandler(({ url }) => {
        if (shouldOpenExternally(url, options.appUrl)) {
            void shell.openExternal(url);
            return { action: 'deny' };
        }
        return { action: 'allow' };
    });
    pageView.webContents.on('will-navigate', (event, url) => {
        if (shouldOpenExternally(url, options.appUrl)) {
            event.preventDefault();
            void shell.openExternal(url);
        }
    });
    pageView.webContents.on('did-finish-load', () => {
        pageView.webContents.executeJavaScript(buildPopOutShortcutScript()).catch(() => {
            /* injection is a nicety — never break the window if it fails */
        });
    });

    // Preserve the unsaved-annotation confirm for popped-out PDFs. The
    // beforeunload guard lives on the page view's webContents, while the close
    // request arrives on the window — hence the small adapter.
    if (options.confirmPdfDiscard && isSameOriginPdfChildUrl(options.url, options.appUrl)) {
        const confirmPdfDiscard = options.confirmPdfDiscard;
        const pdfAdapter: PdfChildWindow = {
            webContents: pageView.webContents,
            on: (event: 'close', listener: () => void) => win.on(event, listener),
            once: (event: 'closed', listener: () => void) => win.once(event, listener),
            removeListener: (event: 'close' | 'closed', listener: () => void) =>
                event === 'close'
                    ? win.removeListener('close', listener)
                    : win.removeListener('closed', listener),
        };
        wirePdfChildWindowClose(pdfAdapter, { confirmDiscard: () => confirmPdfDiscard(win) });
    }

    win.on('resize', () => layout(entry));
    win.on('closed', () => {
        entriesByContentsId.delete(chromeId);
        entriesByContentsId.delete(pageId);
        if (name && entriesByName.get(name) === entry) {
            entriesByName.delete(name);
        }
        if (!chromeView.webContents.isDestroyed()) {
            chromeView.webContents.close();
        }
        if (!pageView.webContents.isDestroyed()) {
            pageView.webContents.close();
        }
    });
    // The window itself never loads a document, so its own `ready-to-show` never
    // fires — reveal it once the page view has settled, either way.
    const reveal = () => {
        if (!win.isDestroyed() && !win.isVisible()) {
            win.show();
        }
    };
    pageView.webContents.once('did-finish-load', reveal);
    pageView.webContents.once('did-fail-load', reveal);

    void pageView.webContents.loadURL(options.url).catch(() => { /* surfaced by did-fail-load */ });
    return win;
}
