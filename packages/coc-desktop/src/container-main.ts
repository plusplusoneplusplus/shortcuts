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
    clipboard,
    dialog,
    ipcMain,
    Menu,
    Notification,
    Tray,
    nativeImage,
    shell,
} from 'electron';
import { attachOrStart, ServerHandle } from './server-controller';
import { shutdownServer, shouldOpenExternally, shouldSurfaceLoadFailure } from './lifecycle';
import { resolveIconPath, TRAY_ICON_FALLBACK_DATA_URL } from './app-icon';
import { splashDataUrl } from './splash';
import { buildMacInsetCss, buildWindowOptions } from './window-config';
import { readDevTunnelHttpPort } from './devtunnel-cli';
import { createDevTunnelGlue, type DevTunnelGlue } from './devtunnel-glue';
import { buildAppMenuTemplate, buildTrayMenuTemplate } from './app-menu';
import { confirmBrowserDemoQuit, disposeBrowserViews, registerBrowserViewIpc } from './browser-view-host';

const APP_NAME = 'CoCContainer';
const DEFAULT_PORT = 5000;
/** The product suffix used for the default tunnel identity (avoids contention with CoC's `hostname-coc`). */
const CONTAINER_TUNNEL_SUFFIX = 'coccontainer';
/** Store seam that threads the container suffix into all first-run / fallback config paths. */
const CONTAINER_DEVTUNNEL_STORE = { defaultSuffix: CONTAINER_TUNNEL_SUFFIX } as const;
app.setName(APP_NAME);

let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let serverHandle: ServerHandle | null = null;
let isQuitting = false;
/** Shared DevTunnel glue, null until lazily created on win32. */
let devTunnel: DevTunnelGlue | null = null;

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
            preload: path.join(__dirname, 'preload.js'),
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
        registerBrowserViewIpc();
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
    tray.setContextMenu(Menu.buildFromTemplate(
        buildTrayMenuTemplate({
            onShow: () => focusMainWindow(),
            onHide: () => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.hide();
                }
            },
            onQuit: () => app.quit(),
        }),
    ));
    tray.on('click', () => focusMainWindow());
}

// ─── Windows-only Dev Tunnel wiring ────────────────────────────────────────
//
// All logic lives in the shared `devtunnel-glue.ts` module. This block only
// creates the glue instance with CoCContainer-specific deps.

/** Lazily create the DevTunnel glue with CoCContainer's identity. */
function getDevTunnelGlue(): DevTunnelGlue {
    if (!devTunnel) {
        devTunnel = createDevTunnelGlue({
            dataDir: () => dataDir(),
            logPrefix: '[coccontainer-desktop]',
            rebuildMenu: () => setupContainerApplicationMenu(),
            store: CONTAINER_DEVTUNNEL_STORE,
            getServerPort: () => serverHandle?.port,
            getParentWindow: () => mainWindow,
            preloadPath: path.join(__dirname, 'preload.js'),
            electron: {
                showMessageBox: (options) => dialog.showMessageBox(options),
                showNotification: (title, body) => new Notification({ title, body }).show(),
                isNotificationSupported: () => Notification.isSupported(),
                ipcMainOn: (channel, listener) => ipcMain.on(channel, listener),
                clipboard: { writeText: (text) => clipboard.writeText(text) },
                createBrowserWindow: (options) => new BrowserWindow(options),
            },
        });
    }
    return devTunnel;
}

function setupContainerApplicationMenu(): void {
    if (process.platform !== 'win32') {
        return;
    }
    const template = buildAppMenuTemplate(process.platform, APP_NAME, {
        onCheckForUpdates: () => { /* no-op: update check not wired for container desktop */ },
        devTunnel: devTunnel?.buildMenuInput(),
    });
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function setupContainerDevTunnel(port: number): void {
    getDevTunnelGlue().setup(port);
}

async function bootstrap(): Promise<void> {
    if (process.platform === 'darwin' && app.dock) {
        const icon = loadIcon();
        if (!icon.isEmpty()) {
            app.dock.setIcon(icon);
        }
    }

    // Build the application menu on win32 before any window paints.
    if (process.platform === 'win32') {
        setupContainerApplicationMenu();
    }

    splashWindow = createSplashWindow();
    try {
        // On win32, if the DevTunnel is enabled with a single HTTP binding, prefer
        // that port for attach/start; otherwise fall back to DEFAULT_PORT / free port.
        const devTunnelConfig =
            process.platform === 'win32' ? getDevTunnelGlue().readConfigSafe() : undefined;
        const devTunnelPort = devTunnelConfig?.enabled
            ? await readDevTunnelHttpPort({ tunnelId: devTunnelConfig.tunnelId })
            : undefined;

        serverHandle = await attachOrStart({
            attachPort: devTunnelPort ?? DEFAULT_PORT,
            dataDir: dataDir(),
            serverEntryPath: path.join(__dirname, 'container-server-entry.js'),
        });
        await showDashboard(serverHandle.url);
        createTray();
        // Windows only: construct the DevTunnel host manager and, when enabled,
        // auto-start it — fire-and-forget, AFTER the SPA is shown.
        if (process.platform === 'win32') {
            setupContainerDevTunnel(serverHandle.port);
        }
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
    if (isQuitting) {
        return;
    }
    if (!confirmBrowserDemoQuit()) {
        event.preventDefault();
        return;
    }
    // Dispose the DevTunnel manager (does NOT persist enabled:false) before
    // anything else — it holds no server reference so disposing it is always safe.
    devTunnel?.dispose();
    event.preventDefault();
    isQuitting = true;
    void disposeBrowserViews()
        .catch(error => console.error('[coc-desktop] Browser shutdown failed:', error))
        .then(() => serverHandle?.started ? shutdownServer(serverHandle) : 'detached')
        .catch(error => console.error('[coc-desktop] Server shutdown failed:', error))
        .finally(() => {
        serverHandle = null;
        app.quit();
        });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
