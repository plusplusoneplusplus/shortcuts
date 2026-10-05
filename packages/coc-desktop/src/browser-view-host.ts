import { BrowserWindow, dialog, ipcMain, shell, type WebContents } from 'electron';
import { defaultDataDir } from './server-controller';
import { browserProfilePath, readBrowserEngine, writeBrowserEngine } from './browser-preferences';
import { BrowserHostManager } from './browser-host-manager';
import { ElectronBrowserHost } from './electron-browser-host';
import { ElectronFilePreviewHost } from './file-preview-host';
import { WebView2BrowserHost } from './webview2-browser-host';
import { toHtmlPageViewBounds } from './html-page-policy';
import {
    BROWSER_CLEAR_DATA_CHANNEL, BROWSER_OPEN_EXTERNAL_CHANNEL, BROWSER_PREFERENCES_CHANGED_CHANNEL,
    BROWSER_PREFERENCES_GET_CHANNEL, BROWSER_PREFERENCES_SET_CHANNEL, BROWSER_VIEW_CLOSE_CHANNEL,
    BROWSER_VIEW_HIDE_CHANNEL, BROWSER_VIEW_NAV_CHANNEL, BROWSER_VIEW_NAVIGATE_CHANNEL,
    BROWSER_VIEW_OPEN_CHANNEL, BROWSER_VIEW_SET_BOUNDS_CHANNEL,
    BROWSER_VIEW_FOCUS_CHANNEL,
    BROWSER_HOST_FOCUS_CHANNEL,
    BROWSER_VIEW_OPEN_EXTERNAL_CHANNEL,
    isBrowserEngine, isBrowserNavAction, validateBrowserUrl,
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
    const failed = (error: unknown) => console.error('[coc-desktop] Browser cleanup failed:', error);
    // A full SPA reload keeps file previews for the reloaded SPA to reattach; closing the window ends every view.
    window.webContents.on('did-navigate', () => { void manager?.reloadOwner(id).catch(failed); });
    window.once('closed', () => { void manager?.closeOwner(id).catch(failed); owners.delete(id); });
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
            window.webContents.send(channel, payload);
        },
        changed: () => {
            for (const window of owners.values()) {
                if (!window.isDestroyed()) { window.webContents.send(BROWSER_PREFERENCES_CHANGED_CHANNEL); }
            }
        },
    });
    ipcMain.handle(BROWSER_VIEW_OPEN_CHANNEL, (event, id: unknown, source: unknown, sessionKey: unknown, engine: unknown) => {
        const window = ownWindow(event.sender);
        if (!window) { return { ok: false, reason: 'no-window' }; }
        wireOwner(window);
        return manager!.openSource(event.sender.id, id, source, sessionKey, engine);
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
    ipcMain.on(BROWSER_VIEW_OPEN_EXTERNAL_CHANNEL, (event, id: unknown) => {
        if (ownWindow(event.sender)) { void manager!.openExternal(event.sender.id, id, url => shell.openExternal(url)); }
    });
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

export async function disposeBrowserViews(): Promise<void> {
    await manager?.dispose();
}
