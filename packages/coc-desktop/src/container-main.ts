/**
 * CoCContainer Desktop — Electron main process.
 *
 * Starts or attaches to the local CoCContainer gateway and renders its
 * dashboard in a native window.
 */

import * as os from 'os';
import * as path from 'path';
import {
    app,
    BrowserWindow,
    Menu,
    Tray,
    nativeImage,
    shell,
} from 'electron';
import { attachOrStart, ServerHandle } from './server-controller';
import { shutdownServer, shouldOpenExternally, shouldSurfaceLoadFailure } from './lifecycle';
import { resolveIconPath } from './app-icon';
import { splashDataUrl } from './splash';
import { buildMacInsetCss, buildWindowOptions } from './window-config';

const APP_NAME = 'CoCContainer';
const DEFAULT_PORT = 5000;
const TRAY_ICON_FALLBACK_DATA_URL =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAANklEQVR4nGNgoBH4jwNTpJkoQwhpxmsIsZqxGkKqZgxDRg2gggHkGIIVUKSZWEOIAhRpJgkAANCAm2UMZlD6AAAAAElFTkSuQmCC';

app.setName(APP_NAME);

let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let serverHandle: ServerHandle | null = null;
let isQuitting = false;

function dataDir(): string {
    return path.join(os.homedir(), '.coccontainer');
}

function loadIcon(): ReturnType<typeof nativeImage.createFromPath> {
    const iconPath = resolveIconPath(__dirname, process.resourcesPath);
    return iconPath
        ? nativeImage.createFromPath(iconPath)
        : nativeImage.createFromDataURL(TRAY_ICON_FALLBACK_DATA_URL);
}

function createSplashWindow(): BrowserWindow {
    const win = new BrowserWindow({
        width: 420,
        height: 260,
        frame: false,
        resizable: false,
        center: true,
        show: true,
        backgroundColor: '#0d1117',
        title: APP_NAME,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    void win.loadURL(splashDataUrl({ phase: 'loading' }, APP_NAME));
    return win;
}

function createMainWindow(): BrowserWindow {
    const win = new BrowserWindow({
        width: 1280,
        height: 800,
        show: false,
        backgroundColor: '#0d1117',
        title: APP_NAME,
        icon: loadIcon(),
        ...buildWindowOptions(process.platform),
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    win.on('page-title-updated', (event) => event.preventDefault());
    return win;
}

function closeSplash(): void {
    if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.destroy();
    }
    splashWindow = null;
}

function showSplashError(message: string): void {
    if (!splashWindow || splashWindow.isDestroyed()) {
        splashWindow = createSplashWindow();
    }
    void splashWindow.loadURL(splashDataUrl({ phase: 'error', message }, APP_NAME));
    splashWindow.show();
}

function wireNavigation(win: BrowserWindow, servedUrl: string): void {
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (shouldOpenExternally(url, servedUrl)) {
            void shell.openExternal(url);
            return { action: 'deny' };
        }
        return { action: 'allow' };
    });
    win.webContents.on('will-navigate', (event, url) => {
        if (shouldOpenExternally(url, servedUrl)) {
            event.preventDefault();
            void shell.openExternal(url);
        }
    });
    if (process.platform === 'darwin') {
        win.webContents.on('did-finish-load', () => {
            void win.webContents.insertCSS(buildMacInsetCss()).catch(() => {
                /* styling must never block the dashboard */
            });
        });
    }
}

async function showDashboard(url: string): Promise<void> {
    mainWindow = createMainWindow();
    wireNavigation(mainWindow, url);
    mainWindow.once('ready-to-show', () => {
        mainWindow?.show();
        mainWindow?.focus();
        closeSplash();
    });
    mainWindow.webContents.on(
        'did-fail-load',
        (_event, errorCode, errorDescription, _validatedUrl, isMainFrame) => {
            if (shouldSurfaceLoadFailure(errorCode, isMainFrame)) {
                showSplashError(`Could not load the CoCContainer UI (${errorDescription}).`);
            }
        },
    );
    await mainWindow.loadURL(url);
}

function focusMainWindow(): void {
    if (!mainWindow || mainWindow.isDestroyed()) {
        if (serverHandle) {
            void showDashboard(serverHandle.url);
        }
        return;
    }
    if (mainWindow.isMinimized()) {
        mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
}

function createTray(): void {
    if (tray) {
        return;
    }
    tray = new Tray(loadIcon());
    tray.setToolTip(APP_NAME);
    tray.setContextMenu(Menu.buildFromTemplate([
        { label: `Show ${APP_NAME}`, click: () => focusMainWindow() },
        {
            label: `Hide ${APP_NAME}`,
            click: () => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.hide();
                }
            },
        },
        { type: 'separator' },
        { label: `Quit ${APP_NAME}`, click: () => app.quit() },
    ]));
    tray.on('click', () => focusMainWindow());
}

async function bootstrap(): Promise<void> {
    if (process.platform === 'darwin' && app.dock) {
        const icon = loadIcon();
        if (!icon.isEmpty()) {
            app.dock.setIcon(icon);
        }
    }

    splashWindow = createSplashWindow();
    try {
        serverHandle = await attachOrStart({
            attachPort: DEFAULT_PORT,
            dataDir: dataDir(),
            serverEntryPath: path.join(__dirname, 'container-server-entry.js'),
        });
        await showDashboard(serverHandle.url);
        createTray();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        showSplashError(`Failed to start CoCContainer: ${message}`);
    }
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
    app.quit();
} else {
    app.on('second-instance', () => focusMainWindow());
    app.whenReady().then(bootstrap);
}

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length > 0) {
        return;
    }
    if (serverHandle) {
        void showDashboard(serverHandle.url);
    } else {
        void bootstrap();
    }
});

app.on('before-quit', (event) => {
    if (isQuitting || !serverHandle?.started) {
        return;
    }
    event.preventDefault();
    isQuitting = true;
    void shutdownServer(serverHandle).finally(() => {
        serverHandle = null;
        app.quit();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
