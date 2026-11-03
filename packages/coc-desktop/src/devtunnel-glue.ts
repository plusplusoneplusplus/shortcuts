/**
 * Shared DevTunnel Electron glue used by both CoC Desktop (`main.ts`) and
 * CoCContainer Desktop (`container-main.ts`).
 *
 * Every behavioural decision lives in the electron-free modules (config store,
 * CLI reconciler, host lifecycle, launch gate, modal renderer). This module
 * provides only the thin wiring that both entry points duplicated: safe config
 * reads, menu-input snapshots, cluster caching, error dialogs, notifications,
 * modal lifecycle, config persistence with reconfigure, and start/stop flows.
 *
 * Call sites inject their own `dataDir`, `logPrefix`, `menuRebuild` callback,
 * and optional `devTunnelStore` so the module is identity-agnostic.
 */

import * as path from 'path';
import type { BrowserWindow } from 'electron';
import {
    DevTunnelConfig,
    defaultDevTunnelConfig,
    defaultTunnelId,
    readDevTunnelConfig,
    setDevTunnelCluster,
    setDevTunnelEnabled,
    setDevTunnelId,
    type DevTunnelConfigStore,
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
    resolveDevTunnelCliPath,
} from './devtunnel-cli';
import { autoStartDevTunnelOnLaunch } from './devtunnel-launch';
import {
    devTunnelConfigDataUrl,
    DEVTUNNEL_MODAL_CANCEL_CHANNEL,
    DEVTUNNEL_MODAL_SUBMIT_CHANNEL,
} from './devtunnel-modal';
import type { DevTunnelMenuInput } from './app-menu';

// ---------------------------------------------------------------------------
// Injected dependencies — each entry point provides its own values.
// ---------------------------------------------------------------------------

export interface DevTunnelGlueOptions {
    /** Resolved app data directory (e.g. `~/.coc` or `~/.coccontainer`). */
    dataDir: () => string;
    /** Log-line prefix, e.g. `[coc-desktop]` or `[coccontainer-desktop]`. */
    logPrefix: string;
    /** Rebuild the native application menu (called on every observable state change). */
    rebuildMenu: () => void;
    /** Optional store seam for config read/write (CoCContainer passes its suffix). */
    store?: DevTunnelConfigStore;
    /** Current server port, if known. */
    getServerPort: () => number | undefined;
    /** Parent window provider for the Configure… modal. */
    getParentWindow: () => BrowserWindow | null;
    /** Absolute path to the preload script for modal windows. */
    preloadPath: string;
    /** Electron APIs that differ between test and real usage. */
    electron: DevTunnelElectronApis;
}

export interface DevTunnelElectronApis {
    showMessageBox: (options: Electron.MessageBoxOptions) => Promise<Electron.MessageBoxReturnValue>;
    showNotification: (title: string, body: string) => void;
    isNotificationSupported: () => boolean;
    ipcMainOn: (channel: string, listener: (event: Electron.IpcMainEvent, ...args: unknown[]) => void) => void;
    clipboard: { writeText: (text: string) => void };
    createBrowserWindow: (options: Electron.BrowserWindowConstructorOptions) => BrowserWindow;
}

// ---------------------------------------------------------------------------
// Public surface — one instance per entry point.
// ---------------------------------------------------------------------------

export interface DevTunnelGlue {
    /** The host manager, null until {@link setup} is called. */
    readonly manager: DevTunnelHostManager | null;
    /** The modal window, if open. */
    readonly modalWindow: BrowserWindow | null;

    /** Read config, degrading malformed to default. */
    readConfigSafe(): DevTunnelConfig;
    /** Build the menu snapshot for buildAppMenuTemplate. */
    buildMenuInput(): DevTunnelMenuInput | undefined;
    /** Create the host manager, rebuild the menu, and auto-start if enabled. */
    setup(port: number): void;
    /** Open the Configure… modal. */
    openConfigModal(parent: BrowserWindow | null, preloadPath: string): void;
    /** Close the Configure… modal. */
    closeConfigModal(): void;
    /** Start the tunnel (manual trigger). */
    start(): Promise<void>;
    /** Stop the tunnel. */
    stop(): Promise<void>;
    /** Show the last error dialog. */
    showLastError(): void;
    /** Copy the live public URL to the clipboard. */
    copyPublicUrl(): void;
    /** Dispose the manager (on quit). */
    dispose(): void;
}

export function createDevTunnelGlue(opts: DevTunnelGlueOptions): DevTunnelGlue {
    let manager: DevTunnelHostManager | null = null;
    let modalWindow: BrowserWindow | null = null;
    let modalIpcRegistered = false;

    function readConfigSafe(): DevTunnelConfig {
        try {
            return readDevTunnelConfig(opts.dataDir(), opts.store);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            process.stderr.write(`${opts.logPrefix} devtunnel config unreadable: ${message}\n`);
            return defaultDevTunnelConfig(undefined, opts.store?.defaultSuffix);
        }
    }

    function buildMenuInput(): DevTunnelMenuInput | undefined {
        if (process.platform !== 'win32' || !manager) {
            return undefined;
        }
        const config = readConfigSafe();
        return {
            state: manager.state,
            enabled: config.enabled,
            expectedUrl: deriveDevTunnelPublicUrl({
                tunnelId: config.tunnelId,
                port: opts.getServerPort(),
                cluster: config.cluster,
            }),
            handlers: {
                onConfigure: () => glue.openConfigModal(opts.getParentWindow(), opts.preloadPath),
                onStart: () => void glue.start(),
                onStop: () => void glue.stop(),
                onRetry: () => void manager?.retry(),
                onShowLastError: () => glue.showLastError(),
                onCopyPublicUrl: () => glue.copyPublicUrl(),
            },
        };
    }

    function cacheCluster(state: DevTunnelHostState): void {
        if (state.status !== 'online' || !state.publicUrl) {
            return;
        }
        const cluster = parseDevTunnelCluster(state.publicUrl);
        if (!cluster) {
            return;
        }
        try {
            if (readConfigSafe().cluster === cluster) {
                return;
            }
            setDevTunnelCluster(opts.dataDir(), cluster, opts.store);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            process.stderr.write(`${opts.logPrefix} failed to cache devtunnel cluster: ${message}\n`);
        }
    }

    function showErrorDialog(title: string, error: DevTunnelHostErrorInfo): void {
        void opts.electron.showMessageBox({
            type: 'error',
            title,
            message: error.message,
            detail: error.detail,
            buttons: ['OK'],
            noLink: true,
        }).catch(() => { /* dialog failures are non-fatal */ });
    }

    function showNotification(error: DevTunnelHostErrorInfo): void {
        try {
            if (!opts.electron.isNotificationSupported()) {
                return;
            }
            opts.electron.showNotification('Dev Tunnel', error.message);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            process.stderr.write(`${opts.logPrefix} devtunnel notification failed: ${message}\n`);
        }
    }

    function registerModalIpc(): void {
        if (modalIpcRegistered) {
            return;
        }
        modalIpcRegistered = true;
        opts.electron.ipcMainOn(DEVTUNNEL_MODAL_SUBMIT_CHANNEL, (_event: unknown, rawId: unknown) => {
            const id = typeof rawId === 'string' ? rawId.trim() : '';
            glue.closeConfigModal();
            if (id) {
                void saveConfig(id);
            }
        });
        opts.electron.ipcMainOn(DEVTUNNEL_MODAL_CANCEL_CHANNEL, () => {
            glue.closeConfigModal();
        });
    }

    async function saveConfig(tunnelId: string): Promise<void> {
        try {
            setDevTunnelId(opts.dataDir(), tunnelId, opts.store);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            process.stderr.write(`${opts.logPrefix} failed to save devtunnel id: ${message}\n`);
            return;
        }
        const port = opts.getServerPort();
        if (manager && port !== undefined) {
            try {
                await manager.reconfigure({ tunnelId, port });
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                process.stderr.write(`${opts.logPrefix} devtunnel reconfigure failed: ${message}\n`);
            }
        }
        opts.rebuildMenu();
    }

    const glue: DevTunnelGlue = {
        get manager() { return manager; },
        get modalWindow() { return modalWindow; },

        readConfigSafe,
        buildMenuInput,

        setup(port: number): void {
            registerModalIpc();
            manager = createDevTunnelHostManager({
                ensureBinding: (o) => ensureDevTunnelHttpBinding(o),
                resolveCliPath: () => resolveDevTunnelCliPath(),
                spawn: defaultDevTunnelHostSpawner,
                onStateChange: (state) => {
                    cacheCluster(state);
                    opts.rebuildMenu();
                },
                onFailureNotification: (error) => showNotification(error),
            });
            opts.rebuildMenu();
            autoStartDevTunnelOnLaunch({
                port,
                readConfig: () => readDevTunnelConfig(opts.dataDir(), opts.store),
                manager,
            });
        },

        openConfigModal(parent: BrowserWindow | null, preloadPath: string): void {
            if (process.platform !== 'win32') {
                return;
            }
            if (modalWindow && !modalWindow.isDestroyed()) {
                modalWindow.focus();
                return;
            }
            const tunnelId = readConfigSafe().tunnelId ||
                defaultTunnelId(undefined, opts.store?.defaultSuffix);
            const modal = opts.electron.createBrowserWindow({
                width: 440,
                height: 250,
                parent: parent ?? undefined,
                modal: true,
                resizable: false,
                minimizable: false,
                maximizable: false,
                fullscreenable: false,
                show: false,
                backgroundColor: '#0d1117',
                title: 'Configure Dev Tunnel',
                webPreferences: {
                    preload: preloadPath,
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
                modalWindow = null;
            });
            void modal.loadURL(devTunnelConfigDataUrl({ tunnelId }));
            modalWindow = modal;
        },

        closeConfigModal(): void {
            if (modalWindow && !modalWindow.isDestroyed()) {
                modalWindow.close();
            }
            modalWindow = null;
        },

        async start(): Promise<void> {
            const port = opts.getServerPort();
            if (!manager || port === undefined) {
                return;
            }
            const config = setDevTunnelEnabled(opts.dataDir(), true, opts.store);
            opts.rebuildMenu();
            const state = await manager.start(
                { tunnelId: config.tunnelId, port },
                { trigger: 'manual' },
            );
            if (state.status === 'failed' && state.error) {
                showErrorDialog('Dev Tunnel failed to start', state.error);
            }
        },

        async stop(): Promise<void> {
            setDevTunnelEnabled(opts.dataDir(), false, opts.store);
            opts.rebuildMenu();
            await manager?.stop();
        },

        showLastError(): void {
            const error = manager?.state.error;
            if (error) {
                showErrorDialog('Dev Tunnel Error', error);
            }
        },

        copyPublicUrl(): void {
            const url = manager?.state.publicUrl;
            if (url) {
                opts.electron.clipboard.writeText(url);
            }
        },

        dispose(): void {
            manager?.dispose();
        },
    };

    return glue;
}
