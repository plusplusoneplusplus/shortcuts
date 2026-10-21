import { BrowserWindow, Menu, clipboard, dialog, ipcMain, shell, type WebContents } from 'electron';
import { defaultDataDir } from './server-controller';
import { browserProfilePath, readBrowserEngine, writeBrowserEngine, readBrowserPageZoom, writeBrowserPageZoom, readBrowserClickOnce, writeBrowserClickOnce } from './browser-preferences';
import { activateClickOnce, ClickOnceError } from './browser-clickonce';
import { BrowserHostManager } from './browser-host-manager';
import { BrowserHistoryStore, sanitizeHistoryUrl } from './browser-history';
import { ElectronBrowserHost } from './electron-browser-host';
import { ElectronFilePreviewHost } from './file-preview-host';
import { installBrowserWebviewGuard, isBrowserEmbedder, registerBrowserEmbedder as registerEmbedder } from './browser-webview-guard';
import { WebView2BrowserHost } from './webview2-browser-host';
import { toHtmlPageViewBounds } from './html-page-policy';
import { BROWSER_CONTROL_COMMAND_CHANNEL, BROWSER_CONTROL_CANCEL_CHANNEL, BROWSER_CONTROL_RELEASE_FRAMES_CHANNEL, BROWSER_CONTROL_SCOPE_CHANNEL, BROWSER_CONTROL_REVEAL_CHANNEL, BROWSER_CONTROL_FINISH_CHANNEL, BROWSER_CONTROL_VISIBLE_CHANNEL, validateBrowserCommandRequest } from './browser-control-command';
import {
    BROWSER_ADDRESS_MENU_CHANNEL,
    BROWSER_CLICKONCE_SET_CHANNEL,
    BROWSER_HISTORY_QUERY_CHANNEL, BROWSER_HISTORY_SUGGEST_CHANNEL, BROWSER_HISTORY_DELETE_CHANNEL, BROWSER_HISTORY_CLEAR_CHANNEL,
    BROWSER_HISTORY_RECORDING_CHANNEL, BROWSER_HISTORY_CHANGED_CHANNEL,
    BROWSER_IMPORT_COOKIES_CHANNEL, BROWSER_CLEAR_DATA_CHANNEL, BROWSER_OPEN_EXTERNAL_CHANNEL, BROWSER_PREFERENCES_CHANGED_CHANNEL,
    BROWSER_PREFERENCES_GET_CHANNEL, BROWSER_PREFERENCES_SET_CHANNEL, BROWSER_PAGE_ZOOM_SET_CHANNEL, BROWSER_VIEW_CLOSE_CHANNEL,
    BROWSER_VIEW_HIDE_CHANNEL, BROWSER_VIEW_NAV_CHANNEL, BROWSER_VIEW_NAVIGATE_CHANNEL,
    BROWSER_VIEW_OPEN_CHANNEL, BROWSER_VIEW_ADOPT_CHANNEL, BROWSER_VIEW_SET_BOUNDS_CHANNEL,
    BROWSER_VIEW_FOCUS_CHANNEL,
    BROWSER_HOST_FOCUS_CHANNEL,
    BROWSER_VIEW_OPEN_EXTERNAL_CHANNEL,
    isBrowserEngine, isBrowserNavAction, validateBrowserUrl,
} from './browser-view-policy';

let manager: BrowserHostManager | undefined;
let historyMaintenance: ReturnType<typeof setInterval> | undefined;
const owners = new Map<number, BrowserWindow>();
const controlRequests = new Map<number, Map<string, AbortController>>();

function cancelControl(ownerId: number, includeOwned = true): void {
    manager?.finishControl(ownerId, undefined, includeOwned);
    for (const controller of controlRequests.get(ownerId)?.values() ?? []) controller.abort(new Error('CoC desktop window closed or workspace changed during browser command'));
    controlRequests.delete(ownerId);
}

export function registerBrowserEmbedder(window: BrowserWindow, url: string): void {
    registerEmbedder(window, url);
    wireOwner(window);
}

function broadcastHistory(): void {
    for (const window of owners.values()) {
        if (window.isDestroyed() || window.webContents.isDestroyed() || !isBrowserEmbedder(window.webContents)) continue;
        try { window.webContents.send(BROWSER_HISTORY_CHANGED_CHANNEL); }
        catch (error) { console.error('[coc-desktop] Browser history notification failed:', error); }
    }
}

function ownWindow(sender: WebContents): BrowserWindow | null {
    const window = BrowserWindow.fromWebContents(sender);
    return window && !window.isDestroyed() && window.webContents === sender ? window : null;
}

function wireOwner(window: BrowserWindow): void {
    const id = window.webContents.id;
    if (owners.has(id)) { return; }
    owners.set(id, window);
    const failed = (error: unknown) => console.error('[coc-desktop] Browser cleanup failed:', error);
    // Reload closes guests without emitting onClosed into the next SPA document.
    window.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
        if (isMainFrame && !isInPlace) { cancelControl(id); manager?.bindControlScope(id, null, null); void manager?.reloadOwner(id).catch(failed); }
    });
    window.webContents.on('render-process-gone', () => {
        cancelControl(id);
        manager?.bindControlScope(id, null, null);
        void manager?.reloadOwner(id).catch(failed);
    });
    window.once('closed', () => { cancelControl(id); manager?.bindControlScope(id, null, null); void manager?.closeOwner(id).catch(failed); owners.delete(id); });
}

export function registerBrowserViewIpc(dataDir = defaultDataDir()): void {
    if (manager) { return; }
    installBrowserWebviewGuard();
    const webview2 = new WebView2BrowserHost(browserProfilePath(dataDir, 'webview2'));
    const history = new BrowserHistoryStore(dataDir, Date.now, broadcastHistory);
    historyMaintenance = setInterval(() => {
        void history.pruneExpired().catch(error => console.error('[coc-desktop] Browser history maintenance failed:', error));
    }, 60 * 60 * 1000);
    historyMaintenance.unref();
    manager = new BrowserHostManager({
        clickOnce: {
            enabled: () => readBrowserClickOnce(dataDir),
            ownerCurrent: ownerId => {
                const window = owners.get(ownerId);
                return !!window && !window.isDestroyed() && !window.webContents.isDestroyed() && isBrowserEmbedder(window.webContents);
            },
            activate: url => {
                if (process.platform !== 'win32' || process.arch !== 'x64') throw new ClickOnceError('unsupported');
                return activateClickOnce(url, () =>
                    (require('@plusplusoneplusplus/coc-native') as typeof import('@plusplusoneplusplus/coc-native')).loadWebView2Binary());
            },
            report: (ownerId, message) => {
                const window = owners.get(ownerId);
                if (!window || window.isDestroyed() || !isBrowserEmbedder(window.webContents)) return;
                void dialog.showMessageBox(window, {
                    type: 'info', title: 'ClickOnce activation', message, buttons: ['OK'], noLink: true,
                }).catch(() => console.error('[coc-desktop] ClickOnce notification failed.'));
            },
        },
        richClipboard: clipboard,
        history,
        hosts: {
            electron: new ElectronBrowserHost(browserProfilePath(dataDir, 'electron')),
            webview2,
        },
        fileHost: new ElectronFilePreviewHost(),
        getDefault: () => readBrowserEngine(dataDir),
        saveDefault: engine => writeBrowserEngine(dataDir, engine),
        getPageZoom: () => readBrowserPageZoom(dataDir),
        savePageZoom: percent => writeBrowserPageZoom(dataDir, percent),
        send: (id, channel, payload) => {
            const window = owners.get(id);
            if (!window || window.isDestroyed() || window.webContents.isDestroyed() || !isBrowserEmbedder(window.webContents)) { return; }
            if (channel === BROWSER_CONTROL_REVEAL_CHANNEL) {
                if (!isBrowserEmbedder(window.webContents)) return;
                window.show();
                window.focus();
            }
            window.webContents.send(channel, payload);
        },
        changed: () => {
            for (const window of owners.values()) {
                if (!window.isDestroyed()) { window.webContents.send(BROWSER_PREFERENCES_CHANGED_CHANNEL); }
            }
        },
    });
    // Every history operation requires the exact registered SPA main document.
    const historyWindow = (event: Electron.IpcMainInvokeEvent) =>
        event.senderFrame === event.sender.mainFrame && isBrowserEmbedder(event.sender) ? ownWindow(event.sender) : null;
    ipcMain.handle(BROWSER_CLICKONCE_SET_CHANNEL, (event, enabled: unknown) => {
        if (!historyWindow(event)) return { ok: false, reason: 'no-window' };
        if (typeof enabled !== 'boolean') return { ok: false, reason: 'invalid' };
        if (enabled && (process.platform !== 'win32' || process.arch !== 'x64')) return { ok: false, reason: 'unsupported-platform', message: 'ClickOnce requires Windows x64.' };
        try {
            writeBrowserClickOnce(dataDir, enabled);
            for (const window of owners.values()) {
                if (!window.isDestroyed()) window.webContents.send(BROWSER_PREFERENCES_CHANGED_CHANNEL);
            }
            return { ok: true };
        } catch { return { ok: false, reason: 'storage-failed', message: 'Could not save ClickOnce preference.' }; }
    });
    ipcMain.handle(BROWSER_ADDRESS_MENU_CHANNEL, (event, hasSelection: unknown) => {
        const window = historyWindow(event);
        if (!window) return { ok: false, reason: 'no-window' };
        if (typeof hasSelection !== 'boolean') return { ok: false, reason: 'invalid' };
        const edit = (action: 'cut' | 'copy' | 'paste' | 'selectAll') => () => {
            if (!window.isDestroyed() && !event.sender.isDestroyed() && isBrowserEmbedder(event.sender)) event.sender[action]();
        };
        try {
            Menu.buildFromTemplate([
                { label: 'Cut', enabled: hasSelection, click: edit('cut') },
                { label: 'Copy', enabled: hasSelection, click: edit('copy') },
                { label: 'Paste', click: edit('paste') },
                { type: 'separator' },
                { label: 'Select All', click: edit('selectAll') },
            ]).popup({ window });
            return { ok: true };
        } catch {
            return { ok: false, reason: 'unavailable', message: 'Address menu unavailable. Use the keyboard to copy or edit.' };
        }
    });
    ipcMain.handle(BROWSER_CONTROL_SCOPE_CHANNEL, (event, workspaceId: unknown, sessionKey: unknown) => {
        if (!historyWindow(event)) throw new Error('Browser control requires a registered SPA main frame');
        cancelControl(event.sender.id, false);
        manager!.bindControlScope(event.sender.id, workspaceId, sessionKey);
        return { ownerId: event.sender.id };
    });
    ipcMain.handle(BROWSER_CONTROL_RELEASE_FRAMES_CHANNEL, (event, sessionKey: unknown) => {
        if (!historyWindow(event)) throw new Error('Browser control requires a registered SPA main frame');
        return manager!.releaseFrames(event.sender.id, sessionKey);
    });
    ipcMain.handle(BROWSER_CONTROL_COMMAND_CHANNEL, async (event, input: unknown) => {
        if (!historyWindow(event)) throw new Error('Browser control requires a registered SPA main frame');
        const request = validateBrowserCommandRequest(input);
        let requests = controlRequests.get(event.sender.id);
        if (!requests) { requests = new Map(); controlRequests.set(event.sender.id, requests); }
        if (requests.has(request.id)) throw new Error('Duplicate browser request');
        const controller = new AbortController();
        requests.set(request.id, controller);
        const timeout = setTimeout(() => controller.abort(new Error('Browser command timed out after 60s')), 60_000);
        let aborted!: () => void;
        const cancellation = new Promise<never>((_resolve, reject) => {
            aborted = () => reject(controller.signal.reason);
            controller.signal.addEventListener('abort', aborted, { once: true });
        });
        try { return await Promise.race([manager!.executeControl(event.sender.id, request, controller.signal), cancellation]); }
        finally {
            clearTimeout(timeout);
            controller.signal.removeEventListener('abort', aborted);
            requests.delete(request.id);
        }
    });
    ipcMain.on(BROWSER_CONTROL_CANCEL_CHANNEL, (event, id: unknown) => {
        if (event.senderFrame !== event.sender.mainFrame || !isBrowserEmbedder(event.sender) || !ownWindow(event.sender) || typeof id !== 'string') return;
        controlRequests.get(event.sender.id)?.get(id)?.abort(new Error('Browser command cancelled'));
    });
    ipcMain.on(BROWSER_CONTROL_FINISH_CHANNEL, (event, turnId: unknown, routingRef: unknown) => {
        if (!historyWindow(event) || (turnId !== undefined && (typeof turnId !== 'string' || !turnId || turnId.length > 512))) return;
        if (routingRef !== undefined && (typeof routingRef !== 'string' || !routingRef || routingRef.length > 512)) return;
        manager!.finishControl(event.sender.id, turnId as string | undefined, true, routingRef as string | undefined);
    });
    ipcMain.on(BROWSER_CONTROL_VISIBLE_CHANNEL, (event, visible: unknown, routingRef: unknown) => {
        if (historyWindow(event) && typeof visible === 'boolean' && typeof routingRef === 'string') manager!.setControlVisible(event.sender.id, visible, routingRef);
    });
    const historyHandler = (operation: (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>) =>
        async (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => {
            if (!historyWindow(event)) return { ok: false, reason: 'no-window' };
            try { return await operation(event, ...args); }
            catch (error) { return { ok: false, reason: error instanceof TypeError ? 'invalid' : 'storage-failed', message: String(error) }; }
        };
    ipcMain.handle(BROWSER_HISTORY_QUERY_CHANNEL, historyHandler(async (_event, search = '', offset = 0, limit = 50) => {
        if (typeof search !== 'string' || typeof offset !== 'number' || typeof limit !== 'number') throw new TypeError('Invalid history query');
        return { ok: true, ...await history.query(search, offset, limit) };
    }));
    ipcMain.handle(BROWSER_HISTORY_SUGGEST_CHANNEL, historyHandler(async (_event, search = '') => {
        if (typeof search !== 'string') throw new TypeError('Invalid history query');
        return { ok: true, ...await history.suggest(search) };
    }));
    ipcMain.handle(BROWSER_HISTORY_DELETE_CHANNEL, historyHandler(async (_event, url) => {
        if (!sanitizeHistoryUrl(url)) throw new TypeError('Invalid history URL');
        await history.delete(url);
        return { ok: true };
    }));
    ipcMain.handle(BROWSER_HISTORY_RECORDING_CHANNEL, historyHandler(async (_event, recording) => {
        if (typeof recording !== 'boolean') throw new TypeError('Invalid recording setting');
        await history.setRecording(recording);
        return { ok: true };
    }));
    ipcMain.handle(BROWSER_HISTORY_CLEAR_CHANNEL, historyHandler(async event => {
        const { response } = await dialog.showMessageBox(historyWindow(event)!, {
            type: 'warning', title: 'Clear browser history', message: 'Clear all browser history on this machine?',
            detail: 'This affects every workspace and desktop window. Sign-ins and open tabs are preserved.',
            buttons: ['Cancel', 'Clear history'], defaultId: 0, cancelId: 0, noLink: true,
        });
        if (!historyWindow(event)) return { ok: false, reason: 'no-window' };
        if (response !== 1) return { ok: false, reason: 'cancelled' };
        await history.clear();
        return { ok: true };
    }));
    ipcMain.handle(BROWSER_VIEW_OPEN_CHANNEL, (event, id: unknown, source: unknown, sessionKey: unknown, engine: unknown) => {
        const window = ownWindow(event.sender);
        if (!window || event.senderFrame !== event.sender.mainFrame || !isBrowserEmbedder(event.sender)) { return { ok: false, reason: 'no-window' }; }
        wireOwner(window);
        return manager!.openSource(event.sender.id, id, source, sessionKey, engine);
    });
    ipcMain.handle(BROWSER_VIEW_ADOPT_CHANNEL, (event, id: unknown, guestId: unknown) =>
        event.senderFrame === event.sender.mainFrame && isBrowserEmbedder(event.sender)
            ? manager!.adopt(event.sender.id, id, guestId) : { ok: false, reason: 'no-window' });
    ipcMain.handle(BROWSER_IMPORT_COOKIES_CHANNEL, (event, id: unknown, domain: unknown, cookies: unknown, engine: unknown) =>
        event.senderFrame === event.sender.mainFrame && isBrowserEmbedder(event.sender) && ownWindow(event.sender)
            ? manager!.importCookies(event.sender.id, id, domain, cookies, engine) : { ok: false, reason: 'no-window' });
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
        return manager!.preferences().then(preferences => ({ ...preferences,
            clickOnce: { enabled: readBrowserClickOnce(dataDir), supported: process.platform === 'win32' && process.arch === 'x64' },
        }));
    });
    ipcMain.handle(BROWSER_PREFERENCES_SET_CHANNEL, (event, engine: unknown) =>
        ownWindow(event.sender) ? manager!.select(engine) : { ok: false, reason: 'no-window' });
    ipcMain.handle(BROWSER_PAGE_ZOOM_SET_CHANNEL, (event, percent: unknown) =>
        event.senderFrame === event.sender.mainFrame && isBrowserEmbedder(event.sender) && ownWindow(event.sender)
            ? manager!.setPageZoom(percent) : { ok: false, reason: 'no-window' });
    ipcMain.handle(BROWSER_CLEAR_DATA_CHANNEL, async (event, engine: unknown) => {
        const window = historyWindow(event);
        if (!window) { return { ok: false, reason: 'no-window' }; }
        if (!isBrowserEngine(engine)) { return { ok: false, reason: 'bad-engine' }; }
        const label = engine === 'electron' ? 'Electron' : 'WebView2';
        const { response } = await dialog.showMessageBox(window, {
            type: 'warning', title: `Clear ${label} browser data`,
            message: `Close all ${label} browser tabs and clear sign-ins?`,
            detail: 'This affects every workspace and desktop window. Cookies, cache and site storage will be cleared. The other browser engine and CoC application data are not affected.',
            buttons: ['Cancel', 'Close tabs and clear data'], defaultId: 0, cancelId: 0, noLink: true,
        });
        if (!historyWindow(event)) return { ok: false, reason: 'no-window' };
        return response === 1 ? manager!.clear(engine) : { ok: false, reason: 'cancelled' };
    });
}

export async function disposeBrowserViews(): Promise<void> {
    for (const ownerId of controlRequests.keys()) cancelControl(ownerId);
    clearInterval(historyMaintenance);
    historyMaintenance = undefined;
    await manager?.dispose();
}
