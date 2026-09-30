/**
 * CoC Desktop — HTML page tab host (main-process side).
 *
 * The SPA's right panel can show a local `.html`/`.htm` file as a real
 * rendered page. Each page tab is one `WebContentsView` stacked over the SPA
 * window, loaded over `file://` so relative CSS/JS/images work. The SPA owns
 * the tab UI and reports where its placeholder element sits; this module just
 * creates, places, hides and destroys the views.
 *
 * SECURITY — the page view gets NO preload, runs with `contextIsolation` +
 * `sandbox`, and lives in its own in-memory session partition. Only paths that
 * pass {@link validateHtmlPagePath} are ever loaded, and navigation /
 * `window.open` go through the pure policy in `html-page-policy.ts`.
 *
 * This module imports from `electron`, so it is exercised by the live Electron
 * harness (test/e2e/html-page.e2e.test.ts) rather than unit tests; keep the
 * logic here thin and push everything testable into `html-page-policy.ts`.
 */

import { BrowserWindow, WebContents, WebContentsView, ipcMain, shell } from 'electron';
import {
    HTML_PAGE_CLOSE_CHANNEL,
    HTML_PAGE_HIDE_CHANNEL,
    HTML_PAGE_OPEN_CHANNEL,
    HTML_PAGE_OPEN_EXTERNAL_CHANNEL,
    HTML_PAGE_RELOAD_CHANNEL,
    HTML_PAGE_SET_BOUNDS_CHANNEL,
    HTML_PAGE_STATE_CHANNEL,
    HtmlPageLoadState,
    HtmlPageOpenResult,
    classifyHtmlPageNavigation,
    classifyHtmlPageWindowOpen,
    htmlPageFileUrl,
    isValidHtmlPageId,
    toHtmlPageViewBounds,
    validateHtmlPagePath,
} from './html-page-policy';

/** In-memory partition so page tabs never share storage/permissions with the SPA. */
const HTML_PAGE_PARTITION = 'coc-html-page';

interface HtmlPageEntry {
    win: BrowserWindow;
    view: WebContentsView;
    pageId: string;
    filePath: string;
    lastState?: HtmlPageLoadState;
}

/** Keyed by SPA webContents id, then by the SPA-chosen page id. */
const entriesByOwner = new Map<number, Map<string, HtmlPageEntry>>();
/** SPA webContents ids whose window teardown hooks are already installed. */
const wiredOwners = new Set<number>();

let ipcRegistered = false;

function ownerEntries(ownerId: number): Map<string, HtmlPageEntry> {
    let entries = entriesByOwner.get(ownerId);
    if (!entries) {
        entries = new Map();
        entriesByOwner.set(ownerId, entries);
    }
    return entries;
}

function lookup(sender: WebContents, pageId: unknown): HtmlPageEntry | undefined {
    return isValidHtmlPageId(pageId) ? entriesByOwner.get(sender.id)?.get(pageId) : undefined;
}

function pushState(owner: WebContents, state: HtmlPageLoadState): void {
    if (!owner.isDestroyed()) {
        owner.send(HTML_PAGE_STATE_CHANNEL, state);
    }
}

function destroyEntry(entry: HtmlPageEntry): void {
    const entries = entriesByOwner.get(entry.win.webContents.id);
    if (entries?.get(entry.pageId) === entry) {
        entries.delete(entry.pageId);
    }
    if (!entry.win.isDestroyed()) {
        entry.win.contentView.removeChildView(entry.view);
    }
    if (!entry.view.webContents.isDestroyed()) {
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

/**
 * Tear every page view down with its window, and on a full SPA reload (the
 * tab state that owned them is gone). Hash-route changes are
 * `did-navigate-in-page` and leave the views alone.
 */
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

function wirePageView(entry: HtmlPageEntry): void {
    const wc = entry.view.webContents;
    const owner = entry.win.webContents;
    const state = (status: HtmlPageLoadState['status'], error?: string) => {
        entry.lastState = { pageId: entry.pageId, status, url: wc.isDestroyed() ? undefined : wc.getURL(), error };
        pushState(owner, entry.lastState);
    };

    wc.setWindowOpenHandler(({ url }) => {
        if (classifyHtmlPageWindowOpen(url) === 'external') {
            void shell.openExternal(url);
        }
        return { action: 'deny' };
    });
    const guard = (event: Electron.Event, url: string) => {
        const decision = classifyHtmlPageNavigation(url, wc.getURL(), entry.filePath);
        if (decision === 'allow') {
            return;
        }
        event.preventDefault();
        if (decision === 'external') {
            void shell.openExternal(url);
        }
    };
    wc.on('will-navigate', guard);
    wc.on('will-redirect', guard);
    // Chromium follows a failed load with `did-finish-load` for its own error
    // page, so a failure stays sticky until the next load starts.
    let failed = false;
    wc.on('did-start-loading', () => {
        failed = false;
        state('loading');
    });
    wc.on('did-finish-load', () => {
        if (!failed) {
            state('loaded');
        }
    });
    wc.on('did-fail-load', (_event, errorCode, errorDescription, _url, isMainFrame) => {
        // -3 is ERR_ABORTED: a navigation we cancelled ourselves in the guard.
        if (isMainFrame && errorCode !== -3) {
            failed = true;
            state('failed', errorDescription || `Load failed (${errorCode})`);
        }
    });
    wc.on('render-process-gone', (_event, details) => state('failed', `Page crashed (${details.reason})`));
}

function openPage(sender: WebContents, pageId: unknown, filePath: unknown): HtmlPageOpenResult {
    if (!isValidHtmlPageId(pageId)) {
        return { ok: false, reason: 'bad-id' };
    }
    const win = BrowserWindow.fromWebContents(sender);
    // Only a window's own SPA document may host page tabs — never a child view.
    if (!win || win.isDestroyed() || win.webContents !== sender) {
        return { ok: false, reason: 'no-window' };
    }
    const check = validateHtmlPagePath(filePath);
    if (!check.ok) {
        return check;
    }
    wireOwner(win);
    const entries = ownerEntries(sender.id);
    const existing = entries.get(pageId);
    if (existing && existing.filePath === check.path && !existing.view.webContents.isDestroyed()) {
        if (existing.lastState) pushState(sender, existing.lastState);
        return { ok: true };
    }
    if (existing) {
        destroyEntry(existing);
    }

    const view = new WebContentsView({
        webPreferences: {
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
            partition: HTML_PAGE_PARTITION,
        },
    });
    view.setVisible(false);
    // Index 0: under any other overlay (the find bar) that shares the window.
    win.contentView.addChildView(view, 0);
    const entry: HtmlPageEntry = { win, view, pageId, filePath: check.path };
    entries.set(pageId, entry);
    wirePageView(entry);
    void view.webContents.loadURL(htmlPageFileUrl(check.path)).catch(() => {
        /* surfaced by did-fail-load */
    });
    return { ok: true };
}

function setBounds(entry: HtmlPageEntry, rect: unknown): void {
    const bounds = toHtmlPageViewBounds(rect, entry.win.webContents.getZoomFactor());
    if (!bounds) {
        entry.view.setVisible(false);
        return;
    }
    entry.view.setBounds(bounds);
    entry.view.setVisible(true);
}

/** Register the app-wide page-tab IPC handlers exactly once. Requests route by sender. */
export function registerHtmlPageIpc(): void {
    if (ipcRegistered) {
        return;
    }
    ipcRegistered = true;
    ipcMain.handle(HTML_PAGE_OPEN_CHANNEL, (event, pageId: unknown, filePath: unknown) =>
        openPage(event.sender, pageId, filePath));
    ipcMain.on(HTML_PAGE_SET_BOUNDS_CHANNEL, (event, pageId: unknown, rect: unknown) => {
        const entry = lookup(event.sender, pageId);
        if (entry) {
            setBounds(entry, rect);
        }
    });
    ipcMain.on(HTML_PAGE_HIDE_CHANNEL, (event, pageId: unknown) => {
        lookup(event.sender, pageId)?.view.setVisible(false);
    });
    ipcMain.on(HTML_PAGE_CLOSE_CHANNEL, (event, pageId: unknown) => {
        const entry = lookup(event.sender, pageId);
        if (entry) {
            destroyEntry(entry);
        }
    });
    ipcMain.on(HTML_PAGE_RELOAD_CHANNEL, (event, pageId: unknown) => {
        const entry = lookup(event.sender, pageId);
        if (!entry || entry.view.webContents.isDestroyed()) {
            return;
        }
        // After a failed load getURL() can be empty; reload the original file then.
        if (entry.view.webContents.getURL()) {
            entry.view.webContents.reload();
        } else {
            void entry.view.webContents.loadURL(htmlPageFileUrl(entry.filePath)).catch(() => { /* did-fail-load */ });
        }
    });
    ipcMain.on(HTML_PAGE_OPEN_EXTERNAL_CHANNEL, (event, pageId: unknown) => {
        const entry = lookup(event.sender, pageId);
        if (!entry) {
            return;
        }
        const current = entry.view.webContents.isDestroyed() ? '' : entry.view.webContents.getURL();
        void shell.openExternal(current.startsWith('file:') ? current : htmlPageFileUrl(entry.filePath));
    });
}
