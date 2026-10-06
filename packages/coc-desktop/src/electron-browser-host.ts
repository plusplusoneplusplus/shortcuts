/**
 * CoC Desktop — browser tab host (main-process side).
 *
 * The SPA's right panel can show general web pages in browser tabs. Each tab
 * is one `WebContentsView` stacked over the SPA window. The SPA owns the tab
 * UI (address bar, history buttons) and reports where its placeholder sits;
 * this module creates, places, hides and destroys the views and pushes live
 * navigation state back.
 *
 * Pages have no preload, run sandboxed with normal TLS, and share one persistent
 * installation-wide profile, isolated from the SPA and local HTML previews.
 * Ownership, engine selection and teardown orchestration belong to the manager.
 *
 * This module imports from `electron`, so it is exercised by the live Electron
 * harness (test/e2e/browser-view.e2e.test.ts) rather than unit tests; keep the
 * logic here thin and push everything testable into `browser-view-policy.ts`.
 */

import { BrowserWindow, WebContents, WebContentsView, session, shell, webContents } from 'electron';
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
    validateBrowserUrl,
} from './browser-view-policy';
import type { HtmlPageBounds } from './html-page-policy';

interface BrowserEntry {
    win: BrowserWindow;
    /** SPA webContents id, kept because `win.webContents` is unreadable once the window is destroyed. */
    ownerId: number;
    view: WebContentsView;
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
    const wc = entry.view.webContents;
    if (wc.isDestroyed()) {
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
    if (!entry.win.isDestroyed()) {
        entry.win.contentView.removeChildView(entry.view);
    }
    if (!entry.view.webContents.isDestroyed()) {
        entryByContents.delete(entry.view.webContents.id);
        entry.view.webContents.close();
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
    return { contextIsolation: true, sandbox: true, nodeIntegration: false, session: profileSession };
}

/** Navigation + `window.open` routing shared by the tab view and its pop-ups. */
function wireNavigation(entry: BrowserEntry, wc: WebContents): void {
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

function wireView(entry: BrowserEntry): void {
    const wc = entry.view.webContents;
    wireNavigation(entry, wc);
    wc.on('before-input-event', (event, input) => {
        // Only the embedded view, never authentication popups, owns this shortcut.
        const key = input.key.toLowerCase();
        const modifier = process.platform === 'darwin' ? input.meta : input.control;
        if (entry.closed || !entry.view.getVisible() || input.type !== 'keyDown'
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
}

function load(entry: BrowserEntry, url: string): void {
    entry.requestedUrl = url;
    entry.error = undefined;
    entry.errorCode = undefined;
    void entry.view.webContents.loadURL(url).catch(() => {
        /* surfaced by did-fail-load */
    });
}

function ownWindow(sender: WebContents): BrowserWindow | null {
    const win = BrowserWindow.fromWebContents(sender);
    // Only a window's own SPA document may drive browser views — never a child view.
    return win && !win.isDestroyed() && win.webContents === sender ? win : null;
}

function openView(sender: WebContents, request: BrowserViewRequest, sink: BrowserEventSink): BrowserEntry {
    const { viewId, url } = request;
    const win = ownWindow(sender);
    if (!win) {
        throw new BrowserHostError('no-window', 'Browser window is closed.');
    }
    const view = new WebContentsView({ webPreferences: webPreferences() });
    view.setVisible(false);
    // Index 0: under any other overlay (the find bar) that shares the window.
    win.contentView.addChildView(view, 0);
    const entry: BrowserEntry = { win, ownerId: sender.id, view, viewId, requestedUrl: url, popups: new Set(), sink, closed: false };
    entries.add(entry);
    wireView(entry);
    load(entry, url);
    return entry;
}

function runNav(entry: BrowserEntry, action: string): void {
    const wc = entry.view.webContents;
    if (wc.isDestroyed()) {
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
    if (!bounds) {
        entry.view.setVisible(false);
        return;
    }
    entry.view.setBounds(bounds);
    entry.view.setVisible(true);
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
            snapshot: () => snapshot(entry),
            navigate: url => load(entry, url),
            nav: action => runNav(entry, action),
            setBounds: bounds => setBounds(entry, bounds),
            focus: () => entry.view.webContents.focus(),
            close: () => destroyEntry(entry),
        };
    }

    async clearData(): Promise<void> {
        const profile = this.profile();
        await profile.clearStorageData();
        await profile.clearCache();
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
