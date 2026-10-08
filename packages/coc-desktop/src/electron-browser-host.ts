/**
 * CoC Desktop — browser tab host (main-process side).
 *
 * The SPA's right panel can show general web pages in browser tabs. Each tab
 * is a renderer-owned `webview`. Main authorizes and adopts its WebContents,
 * retains navigation policy and pushes state; the SPA owns DOM placement.
 *
 * Pages have no preload, run sandboxed with normal TLS, and share one persistent
 * installation-wide profile, isolated from the SPA and local HTML previews.
 * Ownership, engine selection and teardown orchestration belong to the manager.
 *
 * Mocked Electron event tests cover recording and keyboard forwarding; the live
 * harness (test/e2e/browser-view.e2e.test.ts) verifies browser event ordering,
 * guest isolation and restart persistence against local HTTP fixtures.
 */

import type { BrowserImportCookie } from './browser-cookie-import';
import { BrowserWindow, WebContents, session, shell, webContents } from 'electron';
import * as fs from 'node:fs';
import type { NativeDatabase } from '@plusplusoneplusplus/coc-native';
import { lockElectronProfile } from './browser-profile-lock';
import { BrowserHostError, type BrowserEngineHost, type BrowserEventSink, type BrowserHostedView, type BrowserViewRequest } from './browser-host-contract';
import {
    BROWSER_VIEW_DOWNLOAD_CHANNEL,
    BROWSER_VIEW_NEW_TAB_CHANNEL,
    BROWSER_VIEW_STATE_CHANNEL,
    BrowserDownloadEvent,
    BrowserViewState,
    browserUserAgent,
    classifyBrowserNavigation,
    classifyBrowserWindowOpen,
    isBrowserPermissionAllowed,
    hardenedBrowserPreferences,
    validateBrowserUrl,
} from './browser-view-policy';
import type { HtmlPageBounds } from './html-page-policy';
import { authorizeBrowserWebview, isBrowserEmbedder } from './browser-webview-guard';

interface BrowserEntry {
    win: BrowserWindow;
    /** SPA webContents id, kept because `win.webContents` is unreadable once the window is destroyed. */
    ownerId: number;
    contents?: WebContents;
    shown: boolean;
    authorization?: ReturnType<typeof authorizeBrowserWebview>;
    viewId: string;
    /** Last URL we were asked to load; reload after a failed load retries it. */
    requestedUrl: string;
    error?: string;
    errorCode?: BrowserViewState['errorCode'];
    popups: Set<BrowserWindow>;
    sink: BrowserEventSink;
    closed: boolean;
}

const entries = new Set<BrowserEntry>();
/** Any webContents (tab view or pop-up) id → the tab entry it belongs to. */
const entryByContents = new Map<number, BrowserEntry>();
let profileSession: Electron.Session | undefined;
let profileLock: NativeDatabase | undefined;

function send(entry: BrowserEntry, channel: string, payload: unknown): void {
    if (entry.closed) { return; }
    if (channel === BROWSER_VIEW_STATE_CHANNEL) { entry.sink.state(payload as BrowserViewState); }
    else if (channel === BROWSER_VIEW_NEW_TAB_CHANNEL) { entry.sink.newTab((payload as { url: string }).url); }
    else if (channel === BROWSER_VIEW_DOWNLOAD_CHANNEL) { entry.sink.download(payload as BrowserDownloadEvent); }
}

function snapshot(entry: BrowserEntry): BrowserViewState {
    const wc = entry.contents;
    if (!wc || wc.isDestroyed()) {
        return { viewId: entry.viewId, engine: 'electron', url: entry.requestedUrl, title: '', canGoBack: false, canGoForward: false, loading: false };
    }
    return {
        viewId: entry.viewId,
        engine: 'electron',
        url: entry.error ? entry.requestedUrl : wc.getURL() || entry.requestedUrl,
        title: entry.error ? '' : wc.getTitle(),
        canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward(),
        loading: wc.isLoading(),
        ...(entry.error ? { error: entry.error } : {}),
        ...(entry.errorCode ? { errorCode: entry.errorCode } : {}),
    };
}

function pushState(entry: BrowserEntry): void {
    send(entry, BROWSER_VIEW_STATE_CHANNEL, snapshot(entry));
}

function destroyEntry(entry: BrowserEntry): void {
    if (entry.closed) { return; }
    entry.closed = true;
    entries.delete(entry);
    for (const popup of [...entry.popups]) {
        if (!popup.isDestroyed()) {
            popup.destroy();
        }
    }
    entry.popups.clear();
    entry.authorization?.dispose();
    if (entry.contents && !entry.contents.isDestroyed()) {
        entryByContents.delete(entry.contents.id);
        entry.contents.close();
    }
}

/** Session-wide hooks: Chrome-like UA, deny-by-default permissions, download handoff. */
function configureProfile(): void {
    const ses = profileSession!;
    ses.setUserAgent(browserUserAgent(ses.getUserAgent()));
    ses.setPermissionRequestHandler((_wc, permission, callback) => callback(isBrowserPermissionAllowed(permission)));
    ses.setPermissionCheckHandler((_wc, permission) => isBrowserPermissionAllowed(permission));
    ses.on('will-download', (event, item, wc) => {
        event.preventDefault();
        const url = item.getURL();
        const entry = wc ? entryByContents.get(wc.id) : undefined;
        const report = (ok: boolean, error?: string) => {
            if (entry) {
                const payload: BrowserDownloadEvent = { viewId: entry.viewId, url, ok, ...(error ? { error } : {}) };
                send(entry, BROWSER_VIEW_DOWNLOAD_CHANNEL, payload);
            }
        };
        if (!validateBrowserUrl(url).ok) {
            report(false, 'Only http(s) downloads can be opened in the system browser.');
            return;
        }
        shell.openExternal(url).then(
            () => report(true),
            (err: unknown) => report(false, err instanceof Error ? err.message : String(err)),
        );
    });
}

function webPreferences(): Electron.WebPreferences {
    return hardenedBrowserPreferences(profileSession!);
}

/** Navigation + `window.open` routing shared by the tab view and its pop-ups. */
function wireNavigation(entry: BrowserEntry, wc: WebContents): void {
    wireHistory(entry, wc);
    entryByContents.set(wc.id, entry);
    wc.once('destroyed', () => {
        if (entryByContents.get(wc.id) === entry) {
            entryByContents.delete(wc.id);
        }
    });
    wc.setWindowOpenHandler(({ url, disposition }) => {
        const decision = classifyBrowserWindowOpen(url, disposition);
        if (decision === 'popup' && !entry.win.isDestroyed()) {
            return {
                action: 'allow',
                overrideBrowserWindowOptions: {
                    parent: entry.win,
                    autoHideMenuBar: true,
                    webPreferences: webPreferences(),
                },
            };
        }
        if (decision === 'tab') {
            send(entry, BROWSER_VIEW_NEW_TAB_CHANNEL, { openerViewId: entry.viewId, url });
        }
        return { action: 'deny' };
    });
    wc.on('did-create-window', (popup) => {
        entry.popups.add(popup);
        popup.once('closed', () => entry.popups.delete(popup));
        wireNavigation(entry, popup.webContents);
    });
    const guard = (event: Electron.Event, url: string) => {
        if (classifyBrowserNavigation(url) === 'deny') {
            event.preventDefault();
        }
    };
    wc.on('will-navigate', guard);
    wc.on('will-redirect', guard);
}

/** Main and popup documents record independently; loading/state notifications never record. */
function wireHistory(entry: BrowserEntry, wc: WebContents): void {
    let pendingUrl: string | undefined;
    let successfulUrl: string | undefined;
    const live = () => !entry.closed && !wc.isDestroyed();
    wc.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
        if (isMainFrame && !isInPlace) {
            pendingUrl = undefined;
            successfulUrl = undefined;
        }
    });
    wc.on('did-navigate', (_event, url, responseCode) => {
        // Error documents and non-HTTP navigations cannot arm a successful visit.
        pendingUrl = responseCode >= 0 && validateBrowserUrl(url).ok ? url : undefined;
    });
    const failed = (_event: Electron.Event, _code: number, _description: string, url: string, isMainFrame: boolean) => {
        if (isMainFrame && (!pendingUrl || !url || pendingUrl === url)) {
            pendingUrl = undefined;
            successfulUrl = undefined;
        }
    };
    wc.on('did-fail-load', failed);
    wc.on('did-fail-provisional-load', failed);
    wc.on('render-process-gone', () => { pendingUrl = undefined; successfulUrl = undefined; });
    wc.on('did-frame-finish-load', (_event, isMainFrame) => {
        if (!live() || !isMainFrame || !pendingUrl) { return; }
        successfulUrl = pendingUrl;
        pendingUrl = undefined;
        entry.sink.visited?.(successfulUrl, wc.getTitle());
    });
    wc.on('did-navigate-in-page', (_event, url, isMainFrame) => {
        if (!live() || !isMainFrame || !validateBrowserUrl(url).ok) { return; }
        // An initial document may change its URL before onload; record its final URL once.
        if (pendingUrl) { pendingUrl = url; return; }
        if (!successfulUrl) { return; }
        successfulUrl = url;
        entry.sink.visited?.(url, wc.getTitle());
    });
    wc.on('page-title-updated', (_event, title) => {
        if (live() && successfulUrl) { entry.sink.titleUpdated?.(successfulUrl, title); }
    });
}

function wireView(entry: BrowserEntry): void {
    const wc = entry.contents!;
    wireNavigation(entry, wc);
    wc.on('before-input-event', (event, input) => {
        // Only the embedded view, never authentication popups, owns this shortcut.
        const key = input.key.toLowerCase();
        const modifier = process.platform === 'darwin' ? input.meta : input.control;
        if (entry.closed || !entry.shown || input.type !== 'keyDown'
            || !['w', 't', 'l'].includes(key) || !modifier || input.alt
            || (key !== 'w' && input.shift) || (key === 'l' && !entry.sink.focusAddressRequested)) { return; }
        event.preventDefault();
        if (!input.isAutoRepeat) {
            if (key === 't' || key === 'l') {
                entry.win.webContents.focus();
                if (key === 'l') { entry.sink.focusAddressRequested!(); }
                else { entry.sink.openMenuRequested(); }
            } else { entry.sink.closeRequested(); }
        }
    });
    const update = () => pushState(entry);
    wc.on('did-start-loading', () => {
        entry.error = undefined;
        entry.errorCode = undefined;
        update();
    });
    wc.on('did-stop-loading', update);
    wc.on('did-navigate', update);
    wc.on('did-navigate-in-page', update);
    wc.on('page-title-updated', update);
    wc.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        // -3 is ERR_ABORTED: a navigation we (or the user, via Stop) cancelled.
        if (isMainFrame && errorCode !== -3) {
            entry.error = errorDescription || `Load failed (${errorCode})`;
            entry.errorCode = 'navigation-failed';
            if (validatedURL) {
                entry.requestedUrl = validatedURL;
            }
            update();
        }
    });
    wc.on('render-process-gone', (_event, details) => {
        entry.error = `Page crashed (${details.reason})`;
        entry.errorCode = 'runtime-crashed';
        update();
    });
    wc.once('destroyed', () => {
        if (!entry.closed) { destroyEntry(entry); entry.sink.closed?.(); }
    });
}

function load(entry: BrowserEntry, url: string): void {
    if (!entry.contents) { throw new BrowserHostError('busy', 'Browser guest is not attached yet.'); }
    entry.requestedUrl = url;
    entry.error = undefined;
    entry.errorCode = undefined;
    void entry.contents.loadURL(url).catch(() => {
        /* surfaced by did-fail-load */
    });
}

function ownWindow(sender: WebContents): BrowserWindow | null {
    const win = BrowserWindow.fromWebContents(sender);
    // Only a window's own SPA document may drive browser views — never a child view.
    return win && !win.isDestroyed() && win.webContents === sender && isBrowserEmbedder(sender) ? win : null;
}

function openView(sender: WebContents, request: BrowserViewRequest, sink: BrowserEventSink): BrowserEntry {
    const { viewId, url } = request;
    const win = ownWindow(sender);
    if (!win) {
        throw new BrowserHostError('no-window', 'Browser window is closed.');
    }
    const entry: BrowserEntry = { win, ownerId: sender.id, shown: false, viewId, requestedUrl: url, popups: new Set(), sink, closed: false };
    entries.add(entry);
    entry.authorization = authorizeBrowserWebview(sender.id, url, profileSession!, guest => {
        entry.contents = guest;
        wireView(entry);
    }, () => {
        destroyEntry(entry);
        sink.closed?.();
    });
    return entry;
}

function runNav(entry: BrowserEntry, action: string): void {
    const wc = entry.contents;
    if (!wc || wc.isDestroyed()) {
        return;
    }
    switch (action) {
        case 'back':
            if (wc.navigationHistory.canGoBack()) { wc.navigationHistory.goBack(); }
            break;
        case 'forward':
            if (wc.navigationHistory.canGoForward()) { wc.navigationHistory.goForward(); }
            break;
        case 'stop':
            wc.stop();
            pushState(entry);
            break;
        case 'reload':
            // After a failed load the error page is not a real history entry; retry the URL.
            if (entry.error || !wc.getURL()) {
                load(entry, entry.requestedUrl);
            } else {
                wc.reload();
            }
            break;
    }
}

function setBounds(entry: BrowserEntry, bounds: HtmlPageBounds | null): void {
    entry.shown = bounds !== null;
}

export class ElectronBrowserHost implements BrowserEngineHost {
    readonly engine = 'electron' as const;

    constructor(private readonly profilePath: string) {}

    async availability() { return { engine: this.engine, available: true }; }

    private profile(): Electron.Session {
        if (!profileLock) { profileLock = lockElectronProfile(this.profilePath); }
        if (!profileSession) {
            try {
                fs.mkdirSync(this.profilePath, { recursive: true });
                profileSession = session.fromPath(this.profilePath);
                configureProfile();
            } catch (error) {
                profileLock.close();
                profileLock = undefined;
                profileSession = undefined;
                throw error;
            }
        }
        return profileSession;
    }

    async create(request: BrowserViewRequest, sink: BrowserEventSink): Promise<BrowserHostedView> {
        this.profile();
        const sender = webContents.fromId(request.ownerId);
        if (!sender) { throw new BrowserHostError('no-window', 'Browser window is closed.'); }
        const entry = openView(sender, request, sink);
        return {
            embed: 'webview',
            src: entry.authorization!.src,
            partition: entry.authorization!.partition,
            adopt: guestId => {
                entry.authorization!.adopt(guestId);
                pushState(entry);
            },
            importCookies: cookies => this.importCookies(cookies),
            snapshot: () => snapshot(entry),
            navigate: url => load(entry, url),
            nav: action => runNav(entry, action),
            setBounds: bounds => setBounds(entry, bounds),
            focus: () => entry.contents?.focus(),
            close: () => destroyEntry(entry),
        };
    }

    async importCookies(cookies: BrowserImportCookie[]): Promise<void> {
        for (const cookie of cookies) { await this.profile().cookies.set(cookie); }
        await this.profile().cookies.flushStore();
    }

    async clearData(): Promise<void> {
        const profile = this.profile();
        // Clear the complete browsing-data set, including the network cookie store.
        await profile.clearData();
        await profile.clearAuthCache();
        await profile.clearCodeCaches({});
        await profile.cookies.flushStore();
        profile.flushStorageData();
    }

    async dispose(): Promise<void> {
        for (const entry of [...entries]) { destroyEntry(entry); }
        if (profileSession) {
            await profileSession.cookies.flushStore();
            profileSession.flushStorageData();
        }
        // Electron sessions (including background workers) live until process exit.
        // Keep the OS-backed lease for that same lifetime, including server drain.
    }
}
