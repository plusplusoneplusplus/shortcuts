import { BrowserWindow, dialog, ipcMain, shell, type WebContents } from 'electron';
import { defaultDataDir } from './server-controller';
import { browserProfilePath, readBrowserEngine, writeBrowserEngine } from './browser-preferences';
import { BrowserHostManager } from './browser-host-manager';
import { ElectronBrowserHost } from './electron-browser-host';
import { ElectronFilePreviewHost } from './file-preview-host';
import { WebView2BrowserHost } from './webview2-browser-host';
import {
    HTML_PAGE_CLOSE_CHANNEL, HTML_PAGE_HIDE_CHANNEL, HTML_PAGE_OPEN_CHANNEL, HTML_PAGE_OPEN_EXTERNAL_CHANNEL,
    HTML_PAGE_RELOAD_CHANNEL, HTML_PAGE_SESSION_KEY, HTML_PAGE_SET_BOUNDS_CHANNEL, HTML_PAGE_STATE_CHANNEL, HTML_PAGE_VIEW_PREFIX,
    isValidHtmlPageId, toHtmlPageLoadState, toHtmlPageViewBounds, type HtmlPageOpenResult,
} from './html-page-policy';
import {
    BROWSER_CLEAR_DATA_CHANNEL, BROWSER_OPEN_EXTERNAL_CHANNEL, BROWSER_PREFERENCES_CHANGED_CHANNEL,
    BROWSER_PREFERENCES_GET_CHANNEL, BROWSER_PREFERENCES_SET_CHANNEL, BROWSER_VIEW_CLOSE_CHANNEL,
    BROWSER_VIEW_HIDE_CHANNEL, BROWSER_VIEW_NAV_CHANNEL, BROWSER_VIEW_NAVIGATE_CHANNEL,
    BROWSER_VIEW_OPEN_CHANNEL, BROWSER_VIEW_SET_BOUNDS_CHANNEL,
    BROWSER_VIEW_FOCUS_CHANNEL,
    BROWSER_HOST_FOCUS_CHANNEL,
    BROWSER_VIEW_STATE_CHANNEL,
    isBrowserEngine, isBrowserNavAction, validateBrowserUrl, type BrowserViewState,
} from './browser-view-policy';

let manager: BrowserHostManager | undefined;
const owners = new Map<number, BrowserWindow>();

function ownWindow(sender: WebContents): BrowserWindow | null {
    const window = BrowserWindow.fromWebContents(sender);
    return window && !window.isDestroyed() && window.webContents === sender ? window : null;
}

function wireOwner(window: BrowserWindow): void {
    const id = window.webContents.id;
    if (owners.has(id)) { return; }
    owners.set(id, window);
    const close = () => { void manager?.closeOwner(id).catch(error => console.error('[coc-desktop] Browser cleanup failed:', error)); };
    window.webContents.on('did-navigate', close);
    window.once('closed', () => { close(); owners.delete(id); });
}

export function registerBrowserViewIpc(dataDir = defaultDataDir()): void {
    if (manager) { return; }
    const webview2 = new WebView2BrowserHost(browserProfilePath(dataDir, 'webview2'));
    manager = new BrowserHostManager({
        hosts: {
            electron: new ElectronBrowserHost(browserProfilePath(dataDir, 'electron')),
            webview2,
        },
        fileHost: new ElectronFilePreviewHost(),
        getDefault: () => readBrowserEngine(dataDir),
        saveDefault: engine => writeBrowserEngine(dataDir, engine),
        send: (id, channel, payload) => {
            const window = owners.get(id);
            if (!window || window.isDestroyed() || window.webContents.isDestroyed()) { return; }
            const state = payload as BrowserViewState;
            if (channel === BROWSER_VIEW_STATE_CHANNEL && state.viewId.startsWith(HTML_PAGE_VIEW_PREFIX)) {
                window.webContents.send(HTML_PAGE_STATE_CHANNEL, toHtmlPageLoadState(state.viewId.slice(HTML_PAGE_VIEW_PREFIX.length), state));
                return;
            }
            window.webContents.send(channel, payload);
        },
        changed: () => {
            for (const window of owners.values()) {
                if (!window.isDestroyed()) { window.webContents.send(BROWSER_PREFERENCES_CHANGED_CHANNEL); }
            }
        },
    });
    ipcMain.handle(BROWSER_VIEW_OPEN_CHANNEL, (event, id: unknown, url: unknown, sessionKey: unknown, engine: unknown) => {
        const window = ownWindow(event.sender);
        if (!window) { return { ok: false, reason: 'no-window' }; }
        wireOwner(window);
        return manager!.open(event.sender.id, id, url, sessionKey, engine);
    });
    ipcMain.handle(BROWSER_VIEW_NAVIGATE_CHANNEL, (event, id: unknown, url: unknown) =>
        ownWindow(event.sender) ? manager!.navigate(event.sender.id, id, url) : { ok: false, reason: 'no-window' });
    ipcMain.on(BROWSER_VIEW_NAV_CHANNEL, (event, id: unknown, action: unknown) => {
        if (ownWindow(event.sender) && isBrowserNavAction(action)) { void manager!.nav(event.sender.id, id, action); }
    });
    ipcMain.on(BROWSER_VIEW_SET_BOUNDS_CHANNEL, (event, id: unknown, rect: unknown) => {
        const window = ownWindow(event.sender);
        if (window) { void manager!.bounds(event.sender.id, id, toHtmlPageViewBounds(rect, event.sender.getZoomFactor())); }
    });
    ipcMain.on(BROWSER_VIEW_HIDE_CHANNEL, (event, id: unknown) => {
        if (ownWindow(event.sender)) { void manager!.bounds(event.sender.id, id, null); }
    });
    ipcMain.on(BROWSER_VIEW_FOCUS_CHANNEL, (event, id: unknown) => {
        if (ownWindow(event.sender)) { void manager!.command(event.sender.id, id, view => view.focus()); }
    });
    ipcMain.on(BROWSER_HOST_FOCUS_CHANNEL, event => {
        const window = ownWindow(event.sender);
        if (window) {
            window.webContents.focus();
            void webview2.focusOwner(event.sender.id).catch(error => console.error('[coc-desktop] Browser focus handoff failed:', error));
        }
    });
    ipcMain.on(BROWSER_VIEW_CLOSE_CHANNEL, (event, id: unknown) => {
        if (ownWindow(event.sender)) { void manager!.close(event.sender.id, id).catch(error => console.error('[coc-desktop] Browser close failed:', error)); }
    });
    ipcMain.handle(BROWSER_OPEN_EXTERNAL_CHANNEL, async (event, url: unknown) => {
        const check = validateBrowserUrl(url);
        if (!ownWindow(event.sender) || !check.ok) { return false; }
        try { await shell.openExternal(check.url); return true; }
        catch (error) { console.error('[coc-desktop] Browser external-open failed:', error); return false; }
    });
    registerHtmlPageIpc();
    ipcMain.handle(BROWSER_PREFERENCES_GET_CHANNEL, event => {
        const window = ownWindow(event.sender);
        if (!window) { throw new Error('Browser preferences require a desktop window.'); }
        wireOwner(window);
        return manager!.preferences();
    });
    ipcMain.handle(BROWSER_PREFERENCES_SET_CHANNEL, (event, engine: unknown) =>
        ownWindow(event.sender) ? manager!.select(engine) : { ok: false, reason: 'no-window' });
    ipcMain.handle(BROWSER_CLEAR_DATA_CHANNEL, async (event, engine: unknown) => {
        const window = ownWindow(event.sender);
        if (!window) { return { ok: false, reason: 'no-window' }; }
        if (!isBrowserEngine(engine)) { return { ok: false, reason: 'bad-engine' }; }
        const label = engine === 'electron' ? 'Electron' : 'WebView2';
        const { response } = await dialog.showMessageBox(window, {
            type: 'warning', title: `Clear ${label} browser data`,
            message: `Close all ${label} browser tabs and clear sign-ins?`,
            detail: 'This affects every workspace and desktop window. Cookies, cache and site storage will be cleared. The other browser engine and CoC application data are not affected.',
            buttons: ['Cancel', 'Close tabs and clear data'], defaultId: 0, cancelId: 0, noLink: true,
        });
        return response === 1 ? manager!.clear(engine) : { ok: false, reason: 'cancelled' };
    });
}

/** `htmlPage` channels: previews hosted by the shared manager under {@link HTML_PAGE_VIEW_PREFIX}. */
function registerHtmlPageIpc(): void {
    const id = (pageId: unknown) => isValidHtmlPageId(pageId) ? HTML_PAGE_VIEW_PREFIX + pageId : undefined;
    ipcMain.handle(HTML_PAGE_OPEN_CHANNEL, async (event, pageId: unknown, filePath: unknown): Promise<HtmlPageOpenResult> => {
        const window = ownWindow(event.sender);
        if (!isValidHtmlPageId(pageId)) { return { ok: false, reason: 'bad-id' }; }
        if (!window) { return { ok: false, reason: 'no-window' }; }
        wireOwner(window);
        const result = await manager!.openFile(event.sender.id, id(pageId), filePath, HTML_PAGE_SESSION_KEY);
        if (result.ok) { return { ok: true }; }
        const reason = result.reason;
        return { ok: false, reason: reason === 'invalid' || reason === 'not-absolute' || reason === 'not-html' || reason === 'missing' || reason === 'not-file' || reason === 'bad-id' ? reason : 'no-window' };
    });
    ipcMain.on(HTML_PAGE_SET_BOUNDS_CHANNEL, (event, pageId: unknown, rect: unknown) => {
        if (ownWindow(event.sender)) { void manager!.bounds(event.sender.id, id(pageId), toHtmlPageViewBounds(rect, event.sender.getZoomFactor())); }
    });
    ipcMain.on(HTML_PAGE_HIDE_CHANNEL, (event, pageId: unknown) => {
        if (ownWindow(event.sender)) { void manager!.bounds(event.sender.id, id(pageId), null); }
    });
    ipcMain.on(HTML_PAGE_CLOSE_CHANNEL, (event, pageId: unknown) => {
        if (ownWindow(event.sender)) { void manager!.close(event.sender.id, id(pageId)).catch(error => console.error('[coc-desktop] Preview close failed:', error)); }
    });
    ipcMain.on(HTML_PAGE_RELOAD_CHANNEL, (event, pageId: unknown) => {
        if (ownWindow(event.sender)) { void manager!.nav(event.sender.id, id(pageId), 'reload'); }
    });
    ipcMain.on(HTML_PAGE_OPEN_EXTERNAL_CHANNEL, (event, pageId: unknown) => {
        if (ownWindow(event.sender)) { void manager!.command(event.sender.id, id(pageId), view => shell.openExternal(view.snapshot().url)); }
    });
}

export async function disposeBrowserViews(): Promise<void> {
    await manager?.dispose();
}
