/**
 * CoC Desktop — browser tab host (main-process side).
 *
 * The SPA's right panel can show general web pages in browser tabs. Each tab
 * is one `WebContentsView` stacked over the SPA window. The SPA owns the tab
 * UI (address bar, history buttons) and reports where its placeholder sits;
 * this module creates, places, hides and destroys the views and pushes live
 * navigation state back.
 *
 * SECURITY — browser views get NO preload, run with `contextIsolation` +
 * `sandbox`, keep Chromium's normal TLS validation, and live in an in-memory
 * partition per concrete workspace owner (see `browserPartitionFor`), so sign-ins
 * are shared by that owner's tabs, isolated from other workspaces / CoC / HTML
 * page tabs, and gone when CoC quits. Downloads are cancelled and handed to the
 * system browser. Requests route by sender, so one window can never drive
 * another window's views.
 *
 * This module imports from `electron`, so it is exercised by the live Electron
 * harness (test/e2e/browser-view.e2e.test.ts) rather than unit tests; keep the
 * logic here thin and push everything testable into `browser-view-policy.ts`.
 */

import { BrowserWindow, WebContents, WebContentsView, ipcMain, session, shell } from 'electron';
import {
    BROWSER_OPEN_EXTERNAL_CHANNEL,
    BROWSER_VIEW_CLOSE_CHANNEL,
    BROWSER_VIEW_DOWNLOAD_CHANNEL,
    BROWSER_VIEW_HIDE_CHANNEL,
    BROWSER_VIEW_NAVIGATE_CHANNEL,
    BROWSER_VIEW_NAV_CHANNEL,
    BROWSER_VIEW_NEW_TAB_CHANNEL,
    BROWSER_VIEW_OPEN_CHANNEL,
    BROWSER_VIEW_SET_BOUNDS_CHANNEL,
    BROWSER_VIEW_STATE_CHANNEL,
    BrowserDownloadEvent,
    BrowserOpenResult,
    BrowserViewState,
    browserPartitionFor,
    browserUserAgent,
    classifyBrowserNavigation,
    classifyBrowserWindowOpen,
    isBrowserNavAction,
    isBrowserPermissionAllowed,
    isValidBrowserSessionKey,
    isValidBrowserViewId,
    validateBrowserUrl,
} from './browser-view-policy';
import { toHtmlPageViewBounds } from './html-page-policy';

interface BrowserEntry {
    win: BrowserWindow;
    /** SPA webContents id, kept because `win.webContents` is unreadable once the window is destroyed. */
    ownerId: number;
    view: WebContentsView;
    viewId: string;
    partition: string;
    /** Last URL we were asked to load; reload after a failed load retries it. */
    requestedUrl: string;
    error?: string;
    popups: Set<BrowserWindow>;
}

/** Keyed by SPA webContents id, then by the SPA-chosen view id. */
const entriesByOwner = new Map<number, Map<string, BrowserEntry>>();
/** Any webContents (tab view or pop-up) id → the tab entry it belongs to. */
const entryByContents = new Map<number, BrowserEntry>();
/** SPA webContents ids whose window teardown hooks are already installed. */
const wiredOwners = new Set<number>();
/** Partitions whose session-level hooks are already installed. */
const configuredPartitions = new Set<string>();

let ipcRegistered = false;

function ownerEntries(ownerId: number): Map<string, BrowserEntry> {
    let entries = entriesByOwner.get(ownerId);
    if (!entries) {
        entries = new Map();
        entriesByOwner.set(ownerId, entries);
    }
    return entries;
}

function lookup(sender: WebContents, viewId: unknown): BrowserEntry | undefined {
    return isValidBrowserViewId(viewId) ? entriesByOwner.get(sender.id)?.get(viewId) : undefined;
}

function send(entry: BrowserEntry, channel: string, payload: unknown): void {
    const owner = entry.win.isDestroyed() ? null : entry.win.webContents;
    if (owner && !owner.isDestroyed()) {
        owner.send(channel, payload);
    }
}

function snapshot(entry: BrowserEntry): BrowserViewState {
    const wc = entry.view.webContents;
    if (wc.isDestroyed()) {
        return { viewId: entry.viewId, url: entry.requestedUrl, title: '', canGoBack: false, canGoForward: false, loading: false };
    }
    return {
        viewId: entry.viewId,
        url: wc.getURL() || entry.requestedUrl,
        title: entry.error ? '' : wc.getTitle(),
        canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward(),
        loading: wc.isLoading(),
        ...(entry.error ? { error: entry.error } : {}),
    };
}

function pushState(entry: BrowserEntry): void {
    send(entry, BROWSER_VIEW_STATE_CHANNEL, snapshot(entry));
}

function destroyEntry(entry: BrowserEntry): void {
    const entries = entriesByOwner.get(entry.ownerId);
    if (entries?.get(entry.viewId) === entry) {
        entries.delete(entry.viewId);
    }
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

function destroyAllFor(ownerId: number): void {
    const entries = entriesByOwner.get(ownerId);
    if (!entries) {
        return;
    }
    for (const entry of [...entries.values()]) {
        destroyEntry(entry);
    }
    entriesByOwner.delete(ownerId);
}

/** Tear every view down with its window, and on a full SPA reload. */
function wireOwner(win: BrowserWindow): void {
    const ownerId = win.webContents.id;
    if (wiredOwners.has(ownerId)) {
        return;
    }
    wiredOwners.add(ownerId);
    win.webContents.on('did-navigate', () => destroyAllFor(ownerId));
    win.on('closed', () => {
        destroyAllFor(ownerId);
        wiredOwners.delete(ownerId);
    });
}

/** Session-wide hooks: Chrome-like UA, deny-by-default permissions, download handoff. */
function configurePartition(partition: string): void {
    if (configuredPartitions.has(partition)) {
        return;
    }
    configuredPartitions.add(partition);
    const ses = session.fromPartition(partition);
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

function webPreferences(partition: string): Electron.WebPreferences {
    return { contextIsolation: true, sandbox: true, nodeIntegration: false, partition };
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
                    webPreferences: webPreferences(entry.partition),
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
    const update = () => pushState(entry);
    wc.on('did-start-loading', () => {
        entry.error = undefined;
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
            if (validatedURL) {
                entry.requestedUrl = validatedURL;
            }
            update();
        }
    });
    wc.on('render-process-gone', (_event, details) => {
        entry.error = `Page crashed (${details.reason})`;
        update();
    });
}

function load(entry: BrowserEntry, url: string): void {
    entry.requestedUrl = url;
    entry.error = undefined;
    void entry.view.webContents.loadURL(url).catch(() => {
        /* surfaced by did-fail-load */
    });
}

function ownWindow(sender: WebContents): BrowserWindow | null {
    const win = BrowserWindow.fromWebContents(sender);
    // Only a window's own SPA document may drive browser views — never a child view.
    return win && !win.isDestroyed() && win.webContents === sender ? win : null;
}

function openView(sender: WebContents, viewId: unknown, url: unknown, sessionKey: unknown): BrowserOpenResult {
    if (!isValidBrowserViewId(viewId)) {
        return { ok: false, reason: 'bad-id' };
    }
    if (!isValidBrowserSessionKey(sessionKey)) {
        return { ok: false, reason: 'bad-session' };
    }
    const win = ownWindow(sender);
    if (!win) {
        return { ok: false, reason: 'no-window' };
    }
    const check = validateBrowserUrl(url);
    if (!check.ok) {
        return check;
    }
    wireOwner(win);
    const partition = browserPartitionFor(sessionKey);
    const entries = ownerEntries(sender.id);
    const existing = entries.get(viewId);
    if (existing && existing.partition === partition && !existing.view.webContents.isDestroyed()) {
        // The SPA remounted the tab (chat switch, panel toggle): keep live history.
        pushState(existing);
        return { ok: true };
    }
    if (existing) {
        destroyEntry(existing);
    }
    configurePartition(partition);
    const view = new WebContentsView({ webPreferences: webPreferences(partition) });
    view.setVisible(false);
    // Index 0: under any other overlay (the find bar) that shares the window.
    win.contentView.addChildView(view, 0);
    const entry: BrowserEntry = { win, ownerId: sender.id, view, viewId, partition, requestedUrl: check.url, popups: new Set() };
    entries.set(viewId, entry);
    wireView(entry);
    load(entry, check.url);
    return { ok: true };
}

function navigateView(sender: WebContents, viewId: unknown, url: unknown): BrowserOpenResult {
    const entry = lookup(sender, viewId);
    if (!entry || entry.view.webContents.isDestroyed()) {
        return { ok: false, reason: 'not-found' };
    }
    const check = validateBrowserUrl(url);
    if (!check.ok) {
        return check;
    }
    load(entry, check.url);
    return { ok: true };
}

function runNav(entry: BrowserEntry, action: string): void {
    const wc = entry.view.webContents;
    if (wc.isDestroyed()) {
        return;
    }
    switch (action) {
        case 'back':
            if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
            break;
        case 'forward':
            if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
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

function setBounds(entry: BrowserEntry, rect: unknown): void {
    const bounds = toHtmlPageViewBounds(rect, entry.win.webContents.getZoomFactor());
    if (!bounds) {
        entry.view.setVisible(false);
        return;
    }
    entry.view.setBounds(bounds);
    entry.view.setVisible(true);
}

/** Register the app-wide browser-tab IPC handlers exactly once. Requests route by sender. */
export function registerBrowserViewIpc(): void {
    if (ipcRegistered) {
        return;
    }
    ipcRegistered = true;
    ipcMain.handle(BROWSER_VIEW_OPEN_CHANNEL, (event, viewId: unknown, url: unknown, sessionKey: unknown) =>
        openView(event.sender, viewId, url, sessionKey));
    ipcMain.handle(BROWSER_VIEW_NAVIGATE_CHANNEL, (event, viewId: unknown, url: unknown) =>
        navigateView(event.sender, viewId, url));
    ipcMain.on(BROWSER_VIEW_NAV_CHANNEL, (event, viewId: unknown, action: unknown) => {
        const entry = lookup(event.sender, viewId);
        if (entry && isBrowserNavAction(action)) {
            runNav(entry, action);
        }
    });
    ipcMain.on(BROWSER_VIEW_SET_BOUNDS_CHANNEL, (event, viewId: unknown, rect: unknown) => {
        const entry = lookup(event.sender, viewId);
        if (entry) {
            setBounds(entry, rect);
        }
    });
    ipcMain.on(BROWSER_VIEW_HIDE_CHANNEL, (event, viewId: unknown) => {
        lookup(event.sender, viewId)?.view.setVisible(false);
    });
    ipcMain.on(BROWSER_VIEW_CLOSE_CHANNEL, (event, viewId: unknown) => {
        const entry = lookup(event.sender, viewId);
        if (entry) {
            destroyEntry(entry);
        }
    });
    ipcMain.handle(BROWSER_OPEN_EXTERNAL_CHANNEL, async (event, url: unknown) => {
        const check = validateBrowserUrl(url);
        if (!ownWindow(event.sender) || !check.ok) {
            return false;
        }
        try {
            await shell.openExternal(check.url);
            return true;
        } catch {
            return false;
        }
    });
}
