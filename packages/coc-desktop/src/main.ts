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
import { app, BrowserWindow } from 'electron';
import { attachOrStart, ServerHandle } from './server-controller';
import { splashDataUrl } from './splash';

let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;
/** The embedded (or attached) CoC server for this app instance. */
let serverHandle: ServerHandle | null = null;

/** The main app window. Created hidden; shown once the SPA is ready to paint. */
function createWindow(): BrowserWindow {
    const win = new BrowserWindow({
        width: 1280,
        height: 800,
        show: false,
        backgroundColor: '#0d1117',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
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
 * Point the main window at the live CoC SPA and reveal it once painted.
 * Always `loadURL` against `http://127.0.0.1:<port>` — never a bundled
 * `file://` asset — so the window renders the real, server-served client.
 */
async function showServedSpa(url: string): Promise<void> {
    mainWindow = createWindow();

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

/** Surface a fatal startup error in the (re-shown) splash window. */
function showSplashError(message: string): void {
    if (!splashWindow || splashWindow.isDestroyed()) {
        splashWindow = createSplashWindow();
    }
    void splashWindow.loadURL(splashDataUrl({ phase: 'error', message }));
    splashWindow.show();
}

async function bootstrap(): Promise<void> {
    // Show the loading splash immediately, before the (slower) server boot.
    splashWindow = createSplashWindow();

    try {
        // AC-02: attach to an already-running CoC server, or fork our own
        // against the shared ~/.coc data dir.
        serverHandle = await attachOrStart();
        process.stdout.write(
            `[coc-desktop] server ${serverHandle.started ? 'started (forked)' : 'attached (external)'} at ${serverHandle.url}\n`,
        );
        // AC-03: render the live SPA served from 127.0.0.1.
        await showServedSpa(serverHandle.url);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[coc-desktop] failed to start CoC server: ${message}\n`);
        showSplashError(`Failed to start the CoC server: ${message}`);
    }
}

app.whenReady().then(bootstrap);

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

app.on('window-all-closed', () => {
    // Quit on all platforms except macOS, where apps typically stay resident.
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
