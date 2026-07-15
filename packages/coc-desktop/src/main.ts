/**
 * CoC Desktop — Electron main process entry point.
 *
 * Boots the already-built CoC server in a forked child process and points a
 * native BrowserWindow at the localhost URL it serves. Behaviour layers in by
 * acceptance criterion:
 *
 *   - AC-02: probe `GET /api/health`, attach-or-start a forked coc server.
 *   - AC-03: splash window + `loadURL('http://127.0.0.1:<port>')`.  ← this file
 *   - AC-04: native-module (better-sqlite3 / node-pty) packaging.
 *   - AC-05: single-instance lock, tray, graceful drain on quit.
 *   - AC-06: agent-CLI preflight detection.
 */

import * as path from 'path';
import { app, BrowserWindow, Menu, Notification, Tray, dialog, nativeImage, shell, clipboard, ipcMain } from 'electron';
import { attachOrStart, defaultDataDir, ServerHandle } from './server-controller';
import {
    createRotatingFileLogger,
    installConsoleTee,
    resolveDesktopLogDir,
    DESKTOP_LOG_FILENAME,
    RotatingFileLogger,
} from './desktop-logging';
import { splashDataUrl } from './splash';
import { detectAgentClis, missingAgentClis, runFirstRunPreflight } from './agent-preflight';
import { augmentPathWithBundledAgents } from './agent-bin-path';
import { shutdownServer, shouldOpenExternally } from './lifecycle';
import { resolveIconPath } from './app-icon';
import { APP_NAME, buildAboutPanelOptions, readDesktopVersion } from './app-identity';
import {
    checkForUpdate,
    getSkippedVersion,
    setSkippedVersion,
    getUpdateChannel,
    setUpdateChannel,
    UpdateChannel,
    UpdatePrompt,
} from './update-check';
import { buildAppMenuTemplate, buildTrayMenuTemplate, DevTunnelMenuInput } from './app-menu';
import { attachFindBar, registerFindBarIpc } from './find-bar-host';
import { buildWindowOptions, buildMacInsetCss } from './window-config';
import {
    DevTunnelConfig,
    defaultDevTunnelConfig,
    defaultTunnelId,
    readDevTunnelConfig,
    setDevTunnelEnabled,
    setDevTunnelId,
} from './devtunnel-config';
import {
    createDevTunnelHostManager,
    defaultDevTunnelHostSpawner,
    DevTunnelHostErrorInfo,
    DevTunnelHostManager,
} from './devtunnel-host';
import { ensureDevTunnelHttpBinding, resolveDevTunnelCliPath } from './devtunnel-cli';
import { autoStartDevTunnelOnLaunch } from './devtunnel-launch';
import {
    devTunnelConfigDataUrl,
    DEVTUNNEL_MODAL_CANCEL_CHANNEL,
    DEVTUNNEL_MODAL_SUBMIT_CHANNEL,
} from './devtunnel-modal';

// Brand the app identity before anything builds the menu / dock / About panel.
// In dev (electron launched against this package) this fixes the menu-bar name,
// the Hide/Quit/About labels, and the dock tooltip that would otherwise read
// "Electron". Packaged builds get the name from electron-builder's productName.
app.setName(APP_NAME);

let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
/** The embedded (or attached) CoC server for this app instance. */
let serverHandle: ServerHandle | null = null;
/** Set once we begin draining on quit, so `before-quit` only intercepts once. */
let isQuitting = false;
/**
 * Fix 2: rotating on-disk log for the main process's `[coc-desktop]` output and
 * the forked server's stdout/stderr, so a Finder/Dock-launched (terminal-less)
 * app is diagnosable. Null until installed at the start of `bootstrap()`.
 */
let desktopLogger: RotatingFileLogger | null = null;
/**
 * AC-01/03/04: the Windows-only DevTunnel host manager. Null on macOS/Linux and
 * until the CoC server + port are known. Owns only the `devtunnel host` child —
 * never the CoC server — so disposing it can never stop an attached server.
 */
let devTunnelManager: DevTunnelHostManager | null = null;
/** The Configure… modal window, while open (Windows-only). */
let devTunnelModalWindow: BrowserWindow | null = null;
/** Guard so the Dev Tunnel modal IPC handlers are registered only once. */
let devTunnelModalIpcRegistered = false;

/** Fallback tray glyph used when the real icon file cannot be found. */
const TRAY_ICON_FALLBACK_DATA_URL =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAANklEQVR4nGNgoBH4jwNTpJkoQwhpxmsIsZqxGkKqZgxDRg2gggHkGIIVUKSZWEOIAhRpJgkAANCAm2UMZlD6AAAAAElFTkSuQmCC';

/**
 * Loads the CoC icon as a NativeImage, falling back to the tiny inline glyph
 * if the PNG cannot be found (e.g. a production asar without a bundled media/).
 */
function loadCocIcon(): ReturnType<typeof nativeImage.createFromPath> {
    const iconPath = resolveIconPath(__dirname, process.resourcesPath);
    if (iconPath) {
        return nativeImage.createFromPath(iconPath);
    }
    return nativeImage.createFromDataURL(TRAY_ICON_FALLBACK_DATA_URL);
}

/** The main app window. Created hidden; shown once the SPA is ready to paint. */
function createWindow(): BrowserWindow {
    const win = new BrowserWindow({
        width: 1280,
        height: 800,
        show: false,
        backgroundColor: '#0d1117',
        title: APP_NAME,
        // Windows/Linux: the BrowserWindow icon controls the taskbar/window icon.
        // macOS: ignored here; dock icon is set via app.dock.setIcon() in bootstrap().
        icon: loadCocIcon(),
        ...buildWindowOptions(process.platform),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    // Keep the OS window title as "CoC" rather than letting the served page
    // overwrite it (the SPA renders its own in-app title separately).
    win.on('page-title-updated', (event) => event.preventDefault());
    return win;
}

/** A small, frameless loading window shown while the server boots. */
function createSplashWindow(): BrowserWindow {
    const win = new BrowserWindow({
        width: 420,
        height: 260,
        frame: false,
        resizable: false,
        center: true,
        show: true,
        backgroundColor: '#0d1117',
        title: 'CoC',
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    void win.loadURL(splashDataUrl({ phase: 'loading' }));
    return win;
}

/** Tear down the splash window if it is still open. */
function closeSplash(): void {
    if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.destroy();
    }
    splashWindow = null;
}

/**
 * AC-05: route genuine external http(s) links to the system browser, keeping
 * same-origin navigation (the SPA and its sub-routes) inside the window. Covers
 * both `target=_blank`/`window.open` (window-open handler) and in-page
 * navigations (`will-navigate`).
 */
function wireExternalLinkRouting(win: BrowserWindow, servedUrl: string): void {
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
}

/**
 * macOS only: pad the SPA's top bar clear of the hiddenInset traffic lights and
 * make it the window drag handle. Injected on every load (reload-safe) from the
 * main process so it works regardless of the served SPA's version.
 */
function wireMacTitleBarInset(win: BrowserWindow): void {
    if (process.platform !== 'darwin') {
        return;
    }
    win.webContents.on('did-finish-load', () => {
        win.webContents.insertCSS(buildMacInsetCss()).catch(() => {
            /* styling is a nicety — never break the app if it fails */
        });
    });
}

/**
 * Point the main window at the live CoC SPA and reveal it once painted.
 * Always `loadURL` against `http://127.0.0.1:<port>` — never a bundled
 * `file://` asset — so the window renders the real, server-served client.
 */
async function showServedSpa(url: string): Promise<void> {
    mainWindow = createWindow();
    wireExternalLinkRouting(mainWindow, url);
    attachFindBar(mainWindow);
    wireMacTitleBarInset(mainWindow);

    // Reveal the window only once the renderer can paint, then drop the splash,
    // so the user never sees an empty white frame.
    mainWindow.once('ready-to-show', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show();
            mainWindow.focus();
        }
        closeSplash();
    });

    mainWindow.webContents.on('did-fail-load', (_e, errorCode, errorDescription) => {
        // Ignore aborted sub-resource loads; only surface a hard navigation failure.
        if (errorCode === -3) {
            return;
        }
        showSplashError(`Could not load the CoC UI (${errorDescription}).`);
    });

    await mainWindow.loadURL(url);
}

/**
 * AC-06: agent-CLI preflight. On first run, detect whether the Copilot / Codex /
 * Claude CLIs are reachable and surface non-blocking install guidance for any
 * that are missing.
 *
 * Detection runs against the SAME augmented PATH the forked server gets — the
 * bundled CLI directories prepended to the host PATH — so a provider whose
 * binary the app ships is reported as present (no spurious nag), and the check
 * matches what the server can actually spawn. This also sidesteps the
 * launchd-minimal PATH a Finder/Dock-launched macOS app would otherwise see.
 *
 * This must never block startup: it runs after the window is already shown, the
 * dialog is unparented and fire-and-forget, and any failure is swallowed.
 */
function runAgentPreflight(): void {
    try {
        const pathEnv = augmentPathWithBundledAgents();
        const guidance = runFirstRunPreflight(defaultDataDir(), { pathEnv });
        if (!guidance) {
            return;
        }
        process.stdout.write(`[coc-desktop] agent-CLI preflight: ${guidance.summary}\n`);
        void dialog
            .showMessageBox({
                type: 'info',
                title: guidance.title,
                message: guidance.summary,
                detail: guidance.detail,
                buttons: ['OK', 'Open install docs'],
                defaultId: 0,
                cancelId: 0,
                noLink: true,
            })
            .then((result) => {
                if (result.response === 1) {
                    // Open the docs for each still-missing CLI in the system browser.
                    for (const { cli } of missingAgentClis(detectAgentClis({ pathEnv }))) {
                        void shell.openExternal(cli.docsUrl);
                    }
                }
            })
            .catch(() => { /* dialog failures are non-fatal */ });
    } catch {
        // Preflight is a startup nicety — it must never break boot.
    }
}

/**
 * In-app update check. Polls GitHub Releases for a newer published build and, if
 * one exists, shows a non-blocking dialog so the user can upgrade "from the app
 * directly" — one click opens the platform installer in the system browser.
 *
 * Auto (on-launch) checks honour a "Skip This Version" choice so we never nag for
 * a version the user already declined. A manual "Check for Updates…" invocation
 * (`auto = false`) ignores the skip marker and also reports "you're up to date".
 *
 * True silent auto-install is intentionally not used: macOS refuses to apply
 * updates to an unsigned app, so a notify + one-click-download flow is the only
 * thing that works across both unsigned platforms today. See `update-check.ts`.
 *
 * Never blocks startup and never throws — any failure is swallowed.
 */
async function runUpdateCheck(auto: boolean): Promise<void> {
    try {
        const channel = getUpdateChannel(defaultDataDir(), app.getVersion());
        const result = await checkForUpdate({ currentVersion: app.getVersion(), channel });
        if (result.reason !== 'newer' || !result.prompt || !result.release) {
            if (!auto) {
                // Manual check: give explicit feedback even when nothing is new.
                const upToDate = result.reason === 'up-to-date';
                void dialog.showMessageBox({
                    type: upToDate ? 'info' : 'warning',
                    title: upToDate ? 'You’re up to date' : 'Update Check Failed',
                    message: upToDate
                        ? `CoC ${app.getVersion()} is the latest version.`
                        : 'Could not check for updates. Please try again later.',
                    buttons: ['OK'],
                    noLink: true,
                });
            }
            return;
        }
        // Auto checks respect a previously skipped version; manual checks don't.
        if (auto && getSkippedVersion(defaultDataDir()) === result.release.version) {
            return;
        }
        process.stdout.write(`[coc-desktop] update available: ${result.release.version}\n`);
        await promptForUpdate(result.prompt);
    } catch {
        // Update checking is a nicety — it must never break the app.
    }
}

/**
 * Render an {@link UpdatePrompt} as a native dialog and act on the choice. Maps
 * the chosen button by its label (not index) so the platform-specific button
 * sets in `formatUpdatePrompt` stay decoupled from this handler.
 */
async function promptForUpdate(prompt: UpdatePrompt): Promise<void> {
    const { response } = await dialog.showMessageBox({
        type: 'info',
        title: prompt.title,
        message: prompt.message,
        detail: prompt.detail,
        buttons: prompt.buttons,
        defaultId: 0,
        cancelId: prompt.buttons.length - 1,
        noLink: true,
    });
    const choice = prompt.buttons[response];
    switch (choice) {
        case 'Download':
            void shell.openExternal(prompt.downloadUrl);
            break;
        case 'Copy fix command':
            if (prompt.quarantineFix) {
                clipboard.writeText(prompt.quarantineFix);
            }
            // Then still send them to the download — the fix is a post-install step.
            void shell.openExternal(prompt.downloadUrl);
            break;
        case 'Skip This Version':
            setSkippedVersion(defaultDataDir(), prompt.version);
            break;
        default:
            // "Later" (or dialog dismissed): do nothing; re-prompt next launch.
            break;
    }
}

/** Surface a fatal startup error in the (re-shown) splash window. */
function showSplashError(message: string): void {
    if (!splashWindow || splashWindow.isDestroyed()) {
        splashWindow = createSplashWindow();
    }
    void splashWindow.loadURL(splashDataUrl({ phase: 'error', message }));
    splashWindow.show();
}

/**
 * AC-05: bring the existing app window back to the foreground. Used both by the
 * single-instance `second-instance` handler and the tray "Show" item.
 */
function focusMainWindow(): void {
    if (!mainWindow || mainWindow.isDestroyed()) {
        // No window yet (e.g. still on the splash) — re-show the SPA if we can.
        if (serverHandle) {
            void showServedSpa(serverHandle.url);
        }
        return;
    }
    if (mainWindow.isMinimized()) {
        mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
}

/**
 * AC-05: a minimal tray icon offering show/hide of the window and quit.
 * Created once, after the first window is up.
 */
function createTray(): void {
    if (tray) {
        return;
    }
    const icon = loadCocIcon();
    if (process.platform === 'darwin') {
        icon.setTemplateImage(true);
    }
    tray = new Tray(icon);
    tray.setToolTip('CoC');
    // "Check for Updates…" lives in the application menu now (see
    // setupApplicationMenu); the tray keeps only show/hide/quit.
    const menu = Menu.buildFromTemplate(
        buildTrayMenuTemplate({
            onShow: () => focusMainWindow(),
            onHide: () => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.hide();
                }
            },
            onQuit: () => app.quit(),
        }),
    );
    tray.setContextMenu(menu);
    // A left-click on the tray toggles the window into view.
    tray.on('click', () => focusMainWindow());
}

/**
 * AC-01/AC-02: install the native application menu (the macOS app-menu bar and
 * the Windows menu bar) with a "Check for Updates…" item directly after
 * "About CoC". Clicking it runs `runUpdateCheck(false)` — the same always-report,
 * ignore-skip-marker behaviour the tray item used to have.
 *
 * Linux is intentionally left on Electron's default menu (the action stays
 * tray-only there), so we only override the menu on macOS and Windows.
 */
function setupApplicationMenu(currentChannel?: UpdateChannel): void {
    if (process.platform !== 'darwin' && process.platform !== 'win32') {
        return;
    }
    const channel = currentChannel ?? getUpdateChannel(defaultDataDir(), app.getVersion());
    const template = buildAppMenuTemplate(process.platform, app.name, {
        onCheckForUpdates: () => void runUpdateCheck(false),
        currentChannel: channel,
        onSetUpdateChannel: (ch) => {
            setUpdateChannel(defaultDataDir(), ch);
            setupApplicationMenu(ch);
        },
        // AC-01: the top-level "Dev Tunnel" menu. Undefined off win32 / before the
        // manager exists; `buildAppMenuTemplate` only inserts it on win32 anyway.
        devTunnel: buildDevTunnelMenuInput(),
    });
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ─── AC-01/03/04: Windows-only Dev Tunnel wiring ────────────────────────────
//
// Every behavioural decision lives in the electron-free modules (config store,
// CLI reconciler, host lifecycle, launch gate, modal renderer). This block is
// only the thin Electron glue: build the menu snapshot, open the modal window,
// render failures as dialogs/notifications, and hand the manager the real deps.
// All of it is gated behind win32 so macOS/Linux menus/behaviour stay unchanged.

/**
 * Read the persisted DevTunnel preference, degrading a malformed file to the
 * default (feature-off) config so a corrupt file can never wedge the menu build
 * or a Start/Stop action. The config module still surfaces the malformed case as
 * an error to callers that want it; here we only need a value to render.
 */
function readDevTunnelConfigSafe(): DevTunnelConfig {
    try {
        return readDevTunnelConfig(defaultDataDir());
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[coc-desktop] devtunnel config unreadable: ${message}\n`);
        return defaultDevTunnelConfig();
    }
}

/**
 * Build the current Dev Tunnel menu snapshot (state + gate + click handlers), or
 * `undefined` when the feature is inactive (non-win32, or no manager yet). The
 * status/Retry/Copy rows read the runtime `manager.state`; Start vs Stop reads
 * the persisted `enabled` gate.
 */
function buildDevTunnelMenuInput(): DevTunnelMenuInput | undefined {
    if (process.platform !== 'win32' || !devTunnelManager) {
        return undefined;
    }
    return {
        state: devTunnelManager.state,
        enabled: readDevTunnelConfigSafe().enabled,
        handlers: {
            onConfigure: () => openDevTunnelConfigModal(),
            onStart: () => void startDevTunnel(),
            onStop: () => void stopDevTunnel(),
            onRetry: () => void devTunnelManager?.retry(),
            onShowLastError: () => showDevTunnelLastError(),
            onCopyPublicUrl: () => copyDevTunnelPublicUrl(),
        },
    };
}

/**
 * Construct the host manager once the CoC server + port are known, then rebuild
 * the menu (to add the Dev Tunnel item) and auto-start when enabled. Called only
 * on win32, AFTER the SPA is shown — the auto-start is fire-and-forget so a
 * DevTunnel problem can never block or delay the desktop window (AC-04).
 */
function setupDevTunnel(port: number): void {
    registerDevTunnelModalIpc();
    devTunnelManager = createDevTunnelHostManager({
        ensureBinding: (opts) => ensureDevTunnelHttpBinding(opts),
        resolveCliPath: () => resolveDevTunnelCliPath(),
        spawn: defaultDevTunnelHostSpawner,
        // Rebuild the native menu on every observable transition so the status
        // row, Start/Stop, Retry, and Copy Public URL always match reality.
        onStateChange: () => setupApplicationMenu(),
        // AC-04: exactly one Windows notification per auto-failure episode. Only
        // the concise message crosses — never the bounded raw CLI detail.
        onFailureNotification: (error) => showDevTunnelNotification(error),
    });
    // Rebuild now so the Dev Tunnel menu appears immediately (Status: Off).
    setupApplicationMenu();
    // AC-01 auto-start / AC-04 non-blocking: read the preference and, when
    // enabled, kick the host fire-and-forget after the SPA is already up.
    autoStartDevTunnelOnLaunch({
        port,
        readConfig: () => readDevTunnelConfig(defaultDataDir()),
        manager: devTunnelManager,
    });
}

/** Register the Configure… modal's submit/cancel IPC handlers exactly once. */
function registerDevTunnelModalIpc(): void {
    if (devTunnelModalIpcRegistered) {
        return;
    }
    devTunnelModalIpcRegistered = true;
    ipcMain.on(DEVTUNNEL_MODAL_SUBMIT_CHANNEL, (_event, rawId: unknown) => {
        const id = typeof rawId === 'string' ? rawId.trim() : '';
        closeDevTunnelModal();
        if (id) {
            void saveDevTunnelConfig(id);
        }
    });
    ipcMain.on(DEVTUNNEL_MODAL_CANCEL_CHANNEL, () => {
        closeDevTunnelModal();
    });
}

/**
 * Open the fixed-size, dark-shell Configure… modal owned by the main window. The
 * single field is prefilled with the current persisted ID (or the default
 * `<computer-name>-coc`). Focus an already-open modal rather than stacking two.
 */
function openDevTunnelConfigModal(): void {
    if (process.platform !== 'win32') {
        return;
    }
    if (devTunnelModalWindow && !devTunnelModalWindow.isDestroyed()) {
        devTunnelModalWindow.focus();
        return;
    }
    const tunnelId = readDevTunnelConfigSafe().tunnelId || defaultTunnelId();
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

/** Close the Configure… modal if it is still open. */
function closeDevTunnelModal(): void {
    if (devTunnelModalWindow && !devTunnelModalWindow.isDestroyed()) {
        devTunnelModalWindow.close();
    }
    devTunnelModalWindow = null;
}

/**
 * Persist a saved tunnel ID and, if a host is running, reconfigure it (stop the
 * old tunnel, start the newly configured one). Preserves the current enabled
 * flag. Never throws into the IPC handler.
 */
async function saveDevTunnelConfig(tunnelId: string): Promise<void> {
    try {
        setDevTunnelId(defaultDataDir(), tunnelId);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[coc-desktop] failed to save devtunnel id: ${message}\n`);
        return;
    }
    const port = serverHandle?.port;
    if (devTunnelManager && port !== undefined) {
        try {
            await devTunnelManager.reconfigure({ tunnelId, port });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            process.stderr.write(`[coc-desktop] devtunnel reconfigure failed: ${message}\n`);
        }
    }
    // Reflect the (possibly unchanged) state — reconfigure only emits on change.
    setupApplicationMenu();
}

/**
 * AC-01 Start: persist `enabled: true`, then start the host. A manual-start
 * failure returns a settled `failed` state — surface it as an actionable modal
 * (AC-04), not a background notification.
 */
async function startDevTunnel(): Promise<void> {
    const port = serverHandle?.port;
    if (!devTunnelManager || port === undefined) {
        return;
    }
    const config = setDevTunnelEnabled(defaultDataDir(), true);
    // Reflect the Start→Stop toggle immediately, before the async attempt.
    setupApplicationMenu();
    const state = await devTunnelManager.start(
        { tunnelId: config.tunnelId, port },
        { trigger: 'manual' },
    );
    if (state.status === 'failed' && state.error) {
        showDevTunnelErrorDialog('Dev Tunnel failed to start', state.error);
    }
}

/** AC-01 Stop: persist `enabled: false`, cancel timers, and reap the host tree. */
async function stopDevTunnel(): Promise<void> {
    setDevTunnelEnabled(defaultDataDir(), false);
    // Reflect the Stop→Start toggle immediately.
    setupApplicationMenu();
    await devTunnelManager?.stop();
}

/** AC-04 "Show Last Error…": surface the bounded last-error detail in a dialog. */
function showDevTunnelLastError(): void {
    const error = devTunnelManager?.state.error;
    if (error) {
        showDevTunnelErrorDialog('Dev Tunnel Error', error);
    }
}

/** AC-01 "Copy Public URL": copy the live public URL to the clipboard. */
function copyDevTunnelPublicUrl(): void {
    const url = devTunnelManager?.state.publicUrl;
    if (url) {
        clipboard.writeText(url);
    }
}

/**
 * AC-04: render a normalized DevTunnel failure as an actionable error dialog. The
 * concise `message` carries the guidance (install CLI, run `devtunnel user login`,
 * etc.); the bounded `detail` shows diagnostic text without leaking secrets.
 */
function showDevTunnelErrorDialog(title: string, error: DevTunnelHostErrorInfo): void {
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

/**
 * AC-04: show exactly one Windows notification for an auto-start/reconnect failure
 * episode. Only the concise message is shown — never the raw CLI detail — so no
 * credential or unbounded output can leak.
 */
function showDevTunnelNotification(error: DevTunnelHostErrorInfo): void {
    try {
        if (!Notification.isSupported()) {
            return;
        }
        new Notification({ title: 'Dev Tunnel', body: error.message }).show();
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[coc-desktop] devtunnel notification failed: ${message}\n`);
    }
}

/**
 * Fix 2: install the rotating on-disk log for this process as early as possible
 * so even the earliest `[coc-desktop]` startup lines are captured. The console
 * tee preserves the original terminal output (so the `npm start` dev flow is
 * unchanged), and the file lives alongside the server's `*.ndjson` logs under
 * `<dataDir>/logs`. Best-effort: a logging failure must never block boot.
 */
function installDesktopFileLogging(): void {
    if (desktopLogger) {
        return;
    }
    try {
        const logDir = resolveDesktopLogDir(defaultDataDir());
        desktopLogger = createRotatingFileLogger({
            filePath: path.join(logDir, DESKTOP_LOG_FILENAME),
        });
        installConsoleTee({ logger: desktopLogger });
    } catch {
        /* logging is a diagnostic nicety — never fatal */
    }
}

async function bootstrap(): Promise<void> {
    // Fix 2: capture main-process + forked-server output to disk before anything
    // else runs, so a terminal-less packaged launch is still diagnosable.
    installDesktopFileLogging();

    // Brand the native "About CoC" panel: CoC name, version, copyright and icon
    // instead of the default Electron atom + Electron version.
    app.setAboutPanelOptions(
        buildAboutPanelOptions({
            version: readDesktopVersion(__dirname),
            iconPath: resolveIconPath(__dirname, process.resourcesPath),
            electronVersion: process.versions.electron,
        }),
    );

    // AC-01: install the native application menu (with "Check for Updates…")
    // before any window paints, so the menu bar is correct from first show.
    setupApplicationMenu();

    // Register the find-in-page IPC handlers before any window loads, so the
    // injected find bar can talk to the main process as soon as it appears.
    registerFindBarIpc();

    // macOS: set the dock icon early (BrowserWindow `icon` is ignored by macOS).
    // Only override when the real icon file resolves — otherwise leave the dock
    // showing the app bundle's `.icns` (set by electron-builder) rather than
    // stamping the tiny placeholder glyph over it.
    if (process.platform === 'darwin' && app.dock) {
        const iconPath = resolveIconPath(__dirname, process.resourcesPath);
        if (iconPath) {
            const dockIcon = nativeImage.createFromPath(iconPath);
            if (!dockIcon.isEmpty()) {
                app.dock.setIcon(dockIcon);
            }
        }
    }

    // Show the loading splash immediately, before the (slower) server boot.
    splashWindow = createSplashWindow();

    try {
        // AC-02: attach to an already-running CoC server, or fork our own
        // against the shared ~/.coc data dir. Fix 2: when we start our own server,
        // tee its stdout/stderr into the desktop log (packaged/no-TTY only).
        serverHandle = await attachOrStart({
            onServerOutput: desktopLogger
                ? (chunk) => desktopLogger?.write(chunk)
                : undefined,
        });
        process.stdout.write(
            `[coc-desktop] server ${serverHandle.started ? 'started (forked)' : 'attached (external)'} at ${serverHandle.url}\n`,
        );
        // AC-03: render the live SPA served from 127.0.0.1.
        await showServedSpa(serverHandle.url);
        // AC-05: a tray to show/hide + quit, now that a window exists.
        createTray();
        // AC-01/03/04 (Windows only): construct the DevTunnel host manager and,
        // when enabled, auto-start it — fire-and-forget, AFTER the SPA is shown so
        // remote exposure never blocks or delays the local window.
        if (process.platform === 'win32') {
            setupDevTunnel(serverHandle.port);
        }
        // AC-06: warn (non-blocking) about any missing agent CLI now that the
        // window is up. The app is already usable regardless of the outcome.
        runAgentPreflight();
        // In-app update check: only for packaged builds (a dev run has no
        // meaningful release to compare against). Fire-and-forget; never blocks.
        if (app.isPackaged) {
            void runUpdateCheck(true);
        }
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[coc-desktop] failed to start CoC server: ${message}\n`);
        showSplashError(`Failed to start the CoC server: ${message}`);
    }
}

// AC-05: single-instance lock. A second launch must focus the existing window
// instead of opening a new app (and a second embedded server).
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        focusMainWindow();
    });

    app.whenReady().then(bootstrap);
}

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length > 0) {
        return;
    }
    // Re-open the window without re-booting the server if one already exists.
    if (serverHandle) {
        void showServedSpa(serverHandle.url);
    } else {
        void bootstrap();
    }
});

// AC-05: on quit, drain a server WE started; detach (leave running) one we only
// attached to. Intercept once, run the async drain, then let the quit proceed.
app.on('before-quit', (event) => {
    if (isQuitting) {
        return;
    }
    // AC-03: always stop the Desktop-owned tunnel process on quit, whether the
    // CoC server was started or only attached. `dispose()` reaps the host tree
    // but does NOT persist `enabled: false`, so the next launch can auto-start.
    // The manager holds no server reference, so this can never stop an attached
    // CoC server — hence it runs BEFORE the attached-server early-return below.
    devTunnelManager?.dispose();
    if (!serverHandle || !serverHandle.started) {
        // Nothing to drain (no server, or attached to an external one).
        return;
    }
    event.preventDefault();
    isQuitting = true;
    void shutdownServer(serverHandle)
        .then((outcome) => {
            process.stdout.write(`[coc-desktop] server shutdown on quit: ${outcome}\n`);
        })
        .finally(() => {
            serverHandle = null;
            app.quit();
        });
});

app.on('window-all-closed', () => {
    // Quit on all platforms except macOS, where apps typically stay resident.
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
