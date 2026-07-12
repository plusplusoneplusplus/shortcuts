/**
 * CoC Desktop — find-bar host (main-process side).
 *
 * Owns the per-window find-bar WebContentsView and the find-in-page IPC. The
 * bar page itself (`buildFindBarHtml`) lives in its own webContents pinned to
 * the window's top-right, so the searched SPA page never contains the query
 * text — see the rationale in `find-in-page.ts`.
 *
 * This module imports from `electron`, so it is exercised by the live Electron
 * harness rather than unit tests; keep logic here thin and push everything
 * testable into `find-in-page.ts`.
 */

import * as path from 'path';
import { BrowserWindow, WebContentsView, ipcMain } from 'electron';
import {
    FIND_IN_PAGE_CHANNEL,
    STOP_FIND_IN_PAGE_CHANNEL,
    FIND_RESULT_CHANNEL,
    OPEN_FIND_BAR_CHANNEL,
    CLOSE_FIND_BAR_CHANNEL,
    FIND_BAR_WIDTH,
    FIND_BAR_HEIGHT,
    FIND_BAR_MARGIN,
    buildFindBarHtml,
    buildFindShortcutScript,
} from './find-in-page';

interface FindBarEntry {
    win: BrowserWindow;
    view: WebContentsView;
    shown: boolean;
}

/** Keyed by the SPA (target) webContents id. */
const entriesByTargetId = new Map<number, FindBarEntry>();
/** Keyed by the find-bar view's webContents id. */
const entriesByBarId = new Map<number, FindBarEntry>();

let ipcRegistered = false;

function positionFindBar(entry: FindBarEntry): void {
    const [width] = entry.win.getContentSize();
    entry.view.setBounds({
        x: Math.max(0, width - FIND_BAR_WIDTH - FIND_BAR_MARGIN),
        y: FIND_BAR_MARGIN,
        width: FIND_BAR_WIDTH,
        height: FIND_BAR_HEIGHT,
    });
}

function showFindBar(entry: FindBarEntry): void {
    positionFindBar(entry);
    if (!entry.shown) {
        entry.win.contentView.addChildView(entry.view);
        entry.shown = true;
    }
    entry.view.webContents.focus();
    // Focus + select the query; re-runs it so highlights return on reopen.
    entry.view.webContents
        .executeJavaScript('window.__cocFindBarFocus && window.__cocFindBarFocus()')
        .catch(() => { /* focusing is a nicety — never break the app */ });
}

function hideFindBar(entry: FindBarEntry): void {
    if (entry.shown) {
        entry.win.contentView.removeChildView(entry.view);
        entry.shown = false;
    }
    if (!entry.win.webContents.isDestroyed()) {
        // 'keepSelection', NOT 'clearSelection': clearing wipes the caret of
        // the page's focused editable, leaving it unable to accept input.
        entry.win.webContents.stopFindInPage('keepSelection');
        entry.win.webContents.focus();
    }
}

/**
 * Register the app-wide find-bar IPC handlers exactly once. Requests are
 * routed through the entry registries, so this stays correct with multiple
 * windows: open requests come from a target (SPA) webContents, everything
 * else from a bar webContents.
 */
export function registerFindBarIpc(): void {
    if (ipcRegistered) {
        return;
    }
    ipcRegistered = true;
    ipcMain.on(OPEN_FIND_BAR_CHANNEL, (event) => {
        const entry = entriesByTargetId.get(event.sender.id);
        if (entry) {
            showFindBar(entry);
        }
    });
    ipcMain.on(CLOSE_FIND_BAR_CHANNEL, (event) => {
        const entry = entriesByBarId.get(event.sender.id);
        if (entry) {
            hideFindBar(entry);
        }
    });
    ipcMain.on(FIND_IN_PAGE_CHANNEL, (event, text: string, options?: Electron.FindInPageOptions) => {
        const entry = entriesByBarId.get(event.sender.id);
        // Electron throws on an empty query; the bar guards too, but be safe.
        if (!entry || typeof text !== 'string' || text.length === 0) {
            return;
        }
        if (!entry.win.webContents.isDestroyed()) {
            entry.win.webContents.findInPage(text, options ?? {});
        }
    });
    ipcMain.on(STOP_FIND_IN_PAGE_CHANNEL, (event) => {
        const entry = entriesByBarId.get(event.sender.id);
        if (entry && !entry.win.webContents.isDestroyed()) {
            entry.win.webContents.stopFindInPage('keepSelection');
        }
    });
}

/**
 * Wire find-in-page for a window: create its (initially hidden) find-bar view,
 * relay `found-in-page` results to it, inject the Ctrl+F shortcut listener into
 * the SPA on every load (idempotent, so reloads are safe), and keep the bar
 * pinned to the top-right across resizes.
 */
export function attachFindBar(win: BrowserWindow): void {
    const view = new WebContentsView({
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    void view.webContents.loadURL(
        'data:text/html;charset=utf-8,' + encodeURIComponent(buildFindBarHtml()),
    );

    const entry: FindBarEntry = { win, view, shown: false };
    const targetId = win.webContents.id;
    const barId = view.webContents.id;
    entriesByTargetId.set(targetId, entry);
    entriesByBarId.set(barId, entry);

    win.webContents.on('found-in-page', (_event, result) => {
        if (!view.webContents.isDestroyed()) {
            view.webContents.send(FIND_RESULT_CHANNEL, result);
        }
    });
    win.webContents.on('did-finish-load', () => {
        win.webContents.executeJavaScript(buildFindShortcutScript()).catch(() => {
            /* injection is a nicety — never break the app if it fails */
        });
    });
    win.on('resize', () => {
        if (entry.shown) {
            positionFindBar(entry);
        }
    });
    win.on('closed', () => {
        entriesByTargetId.delete(targetId);
        entriesByBarId.delete(barId);
        view.webContents.close();
    });
}
