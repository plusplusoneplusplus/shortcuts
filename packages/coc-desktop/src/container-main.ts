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
import { resolveIconPath } from './app-icon';
import { splashDataUrl } from './splash';
import { buildMacInsetCss, buildWindowOptions } from './window-config';
import {
    DevTunnelConfig,
    defaultDevTunnelConfig,
    defaultTunnelId,
    readDevTunnelConfig,
    setDevTunnelCluster,
    setDevTunnelEnabled,
    setDevTunnelId,
} from './devtunnel-config';
import {
    createDevTunnelHostManager,
    defaultDevTunnelHostSpawner,
    deriveDevTunnelPublicUrl,
    DevTunnelHostErrorInfo,
    DevTunnelHostManager,
    DevTunnelHostState,
    parseDevTunnelCluster,
} from './devtunnel-host';
import {
    ensureDevTunnelHttpBinding,
    readDevTunnelHttpPort,
    resolveDevTunnelCliPath,
} from './devtunnel-cli';
import { autoStartDevTunnelOnLaunch } from './devtunnel-launch';
import {
    devTunnelConfigDataUrl,
    DEVTUNNEL_MODAL_CANCEL_CHANNEL,
    DEVTUNNEL_MODAL_SUBMIT_CHANNEL,
} from './devtunnel-modal';
import { buildAppMenuTemplate, buildTrayMenuTemplate, DevTunnelMenuInput } from './app-menu';

const APP_NAME = 'CoCContainer';
const DEFAULT_PORT = 5000;
/** The product suffix used for the default tunnel identity (avoids contention with CoC's `hostname-coc`). */
const CONTAINER_TUNNEL_SUFFIX = 'coccontainer';
/** Store seam that threads the container suffix into all first-run / fallback config paths. */
const CONTAINER_DEVTUNNEL_STORE = { defaultSuffix: CONTAINER_TUNNEL_SUFFIX } as const;
const TRAY_ICON_FALLBACK_DATA_URL =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAANklEQVR4nGNgoBH4jwNTpJkoQwhpxmsIsZqxGkKqZgxDRg2gggHkGIIVUKSZWEOIAhRpJgkAANCAm2UMZlD6AAAAAElFTkSuQmCC';

app.setName(APP_NAME);

let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let serverHandle: ServerHandle | null = null;
let isQuitting = false;
/** Windows-only DevTunnel host manager, null until the server port is known. */
let devTunnelManager: DevTunnelHostManager | null = null;
/** The Configure… modal window, while open (Windows-only). */
let devTunnelModalWindow: BrowserWindow | null = null;
/** Guard so the Dev Tunnel modal IPC handlers are registered only once. */
let devTunnelModalIpcRegistered = false;

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

/**
 * Read the persisted CoCContainer DevTunnel preference, degrading a malformed
 * file to the default (feature-off) config so a corrupt file can never wedge
 * the menu build or a Start/Stop action.
 */
function readContainerDevTunnelConfigSafe(): DevTunnelConfig {
    try {
        return readDevTunnelConfig(dataDir(), CONTAINER_DEVTUNNEL_STORE);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[coccontainer-desktop] devtunnel config unreadable: ${message}\n`);
        return defaultDevTunnelConfig(undefined, CONTAINER_TUNNEL_SUFFIX);
    }
}

/**
 * Build the current Dev Tunnel menu snapshot, or `undefined` when the feature
 * is inactive (non-win32, or no manager yet).
 */
function buildContainerDevTunnelMenuInput(): DevTunnelMenuInput | undefined {
    if (process.platform !== 'win32' || !devTunnelManager) {
        return undefined;
    }
    const config = readContainerDevTunnelConfigSafe();
    return {
        state: devTunnelManager.state,
        enabled: config.enabled,
        expectedUrl: deriveDevTunnelPublicUrl({
            tunnelId: config.tunnelId,
            port: serverHandle?.port,
            cluster: config.cluster,
        }),
        handlers: {
            onConfigure: () => openContainerDevTunnelConfigModal(),
            onStart: () => void startContainerDevTunnel(),
            onStop: () => void stopContainerDevTunnel(),
            onRetry: () => void devTunnelManager?.retry(),
            onShowLastError: () => showContainerDevTunnelLastError(),
            onCopyPublicUrl: () => copyContainerDevTunnelPublicUrl(),
        },
    };
}

function setupContainerApplicationMenu(): void {
    if (process.platform !== 'win32') {
        return;
    }
    const template = buildAppMenuTemplate(process.platform, APP_NAME, {
        onCheckForUpdates: () => { /* no-op: update check not wired for container desktop */ },
        devTunnel: buildContainerDevTunnelMenuInput(),
    });
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function cacheContainerDevTunnelCluster(state: DevTunnelHostState): void {
    if (state.status !== 'online' || !state.publicUrl) {
        return;
    }
    const cluster = parseDevTunnelCluster(state.publicUrl);
    if (!cluster) {
        return;
    }
    try {
        if (readContainerDevTunnelConfigSafe().cluster === cluster) {
            return;
        }
        setDevTunnelCluster(dataDir(), cluster, CONTAINER_DEVTUNNEL_STORE);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[coccontainer-desktop] failed to cache devtunnel cluster: ${message}\n`);
    }
}

function showContainerDevTunnelNotification(error: DevTunnelHostErrorInfo): void {
    try {
        if (!Notification.isSupported()) {
            return;
        }
        new Notification({ title: 'Dev Tunnel', body: error.message }).show();
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[coccontainer-desktop] devtunnel notification failed: ${message}\n`);
    }
}

function showContainerDevTunnelErrorDialog(title: string, error: DevTunnelHostErrorInfo): void {
    void dialog
        .showMessageBox({
            type: 'error',
            title,
            message: error.message,
            detail: error.detail,
            buttons: ['OK'],
            noLink: true,
        })
        .catch(() => { /* dialog failures are non-fatal */ });
}

function showContainerDevTunnelLastError(): void {
    const error = devTunnelManager?.state.error;
    if (error) {
        showContainerDevTunnelErrorDialog('Dev Tunnel Error', error);
    }
}

function copyContainerDevTunnelPublicUrl(): void {
    const url = devTunnelManager?.state.publicUrl;
    if (url) {
        clipboard.writeText(url);
    }
}

/** Register the Configure… modal's submit/cancel IPC handlers exactly once. */
function registerContainerDevTunnelModalIpc(): void {
    if (devTunnelModalIpcRegistered) {
        return;
    }
    devTunnelModalIpcRegistered = true;
    ipcMain.on(DEVTUNNEL_MODAL_SUBMIT_CHANNEL, (_event, rawId: unknown) => {
        const id = typeof rawId === 'string' ? rawId.trim() : '';
        closeContainerDevTunnelModal();
        if (id) {
            void saveContainerDevTunnelConfig(id);
        }
    });
    ipcMain.on(DEVTUNNEL_MODAL_CANCEL_CHANNEL, () => {
        closeContainerDevTunnelModal();
    });
}

function openContainerDevTunnelConfigModal(): void {
    if (process.platform !== 'win32') {
        return;
    }
    if (devTunnelModalWindow && !devTunnelModalWindow.isDestroyed()) {
        devTunnelModalWindow.focus();
        return;
    }
    const tunnelId =
        readContainerDevTunnelConfigSafe().tunnelId ||
        defaultTunnelId(undefined, CONTAINER_TUNNEL_SUFFIX);
    const modal = new BrowserWindow({
        width: 440,
        height: 250,
        parent: mainWindow ?? undefined,
        modal: true,
        resizable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        show: false,
        backgroundColor: '#0d1117',
        title: 'Configure Dev Tunnel',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    modal.setMenuBarVisibility(false);
    modal.once('ready-to-show', () => {
        if (!modal.isDestroyed()) {
            modal.show();
        }
    });
    modal.on('closed', () => {
        devTunnelModalWindow = null;
    });
    void modal.loadURL(devTunnelConfigDataUrl({ tunnelId }));
    devTunnelModalWindow = modal;
}

function closeContainerDevTunnelModal(): void {
    if (devTunnelModalWindow && !devTunnelModalWindow.isDestroyed()) {
        devTunnelModalWindow.close();
    }
    devTunnelModalWindow = null;
}

async function saveContainerDevTunnelConfig(tunnelId: string): Promise<void> {
    try {
        setDevTunnelId(dataDir(), tunnelId, CONTAINER_DEVTUNNEL_STORE);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[coccontainer-desktop] failed to save devtunnel id: ${message}\n`);
        return;
    }
    const port = serverHandle?.port;
    if (devTunnelManager && port !== undefined) {
        try {
            await devTunnelManager.reconfigure({ tunnelId, port });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            process.stderr.write(`[coccontainer-desktop] devtunnel reconfigure failed: ${message}\n`);
        }
    }
    setupContainerApplicationMenu();
}

async function startContainerDevTunnel(): Promise<void> {
    const port = serverHandle?.port;
    if (!devTunnelManager || port === undefined) {
        return;
    }
    const config = setDevTunnelEnabled(dataDir(), true, CONTAINER_DEVTUNNEL_STORE);
    setupContainerApplicationMenu();
    const state = await devTunnelManager.start(
        { tunnelId: config.tunnelId, port },
        { trigger: 'manual' },
    );
    if (state.status === 'failed' && state.error) {
        showContainerDevTunnelErrorDialog('Dev Tunnel failed to start', state.error);
    }
}

async function stopContainerDevTunnel(): Promise<void> {
    setDevTunnelEnabled(dataDir(), false, CONTAINER_DEVTUNNEL_STORE);
    setupContainerApplicationMenu();
    await devTunnelManager?.stop();
}

/**
 * Construct the DevTunnel host manager once the server port is known, then
 * rebuild the menu (to add the Dev Tunnel item) and auto-start when enabled.
 * Called only on win32, AFTER the SPA is shown — fire-and-forget so a DevTunnel
 * problem can never block or delay the desktop window.
 */
function setupContainerDevTunnel(port: number): void {
    registerContainerDevTunnelModalIpc();
    devTunnelManager = createDevTunnelHostManager({
        ensureBinding: (opts) => ensureDevTunnelHttpBinding(opts),
        resolveCliPath: () => resolveDevTunnelCliPath(),
        spawn: defaultDevTunnelHostSpawner,
        onStateChange: (state) => {
            cacheContainerDevTunnelCluster(state);
            setupContainerApplicationMenu();
        },
        onFailureNotification: (error) => showContainerDevTunnelNotification(error),
    });
    setupContainerApplicationMenu();
    autoStartDevTunnelOnLaunch({
        port,
        readConfig: () => readDevTunnelConfig(dataDir(), CONTAINER_DEVTUNNEL_STORE),
        manager: devTunnelManager,
    });
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
            process.platform === 'win32' ? readContainerDevTunnelConfigSafe() : undefined;
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
    // Dispose the DevTunnel manager (does NOT persist enabled:false) before
    // anything else — it holds no server reference so disposing it is always safe.
    devTunnelManager?.dispose();
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
