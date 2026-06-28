/**
 * CoC Desktop — Electron main process entry point.
 *
 * Boots the already-built CoC server in a forked child process and points a
 * native BrowserWindow at the localhost URL it serves. This file is the
 * scaffold (AC-01); subsequent acceptance criteria layer in behaviour:
 *
 *   - AC-02: probe `GET /api/health`, attach-or-start a forked coc server.
 *   - AC-03: splash window + `loadURL('http://127.0.0.1:<port>')`.
 *   - AC-04: native-module (better-sqlite3 / node-pty) packaging.
 *   - AC-05: single-instance lock, tray, graceful drain on quit.
 *   - AC-06: agent-CLI preflight detection.
 */

import * as path from 'path';
import { app, BrowserWindow } from 'electron';
import { attachOrStart, ServerHandle } from './server-controller';

let mainWindow: BrowserWindow | null = null;
/** The embedded (or attached) CoC server for this app instance. */
let serverHandle: ServerHandle | null = null;

function createWindow(): BrowserWindow {
    const win = new BrowserWindow({
        width: 1280,
        height: 800,
        show: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    return win;
}

async function bootstrap(): Promise<void> {
    mainWindow = createWindow();

    // AC-02: attach to an already-running CoC server, or fork our own against
    // the shared ~/.coc data dir. AC-03 layers the splash + loadURL on top.
    try {
        serverHandle = await attachOrStart();
        process.stdout.write(
            `[coc-desktop] server ${serverHandle.started ? 'started (forked)' : 'attached (external)'} at ${serverHandle.url}\n`,
        );
        // AC-03 will: show a splash, then mainWindow.loadURL(serverHandle.url).
    } catch (err) {
        process.stderr.write(
            `[coc-desktop] failed to start CoC server: ${err instanceof Error ? err.message : String(err)}\n`,
        );
    }
}

app.whenReady().then(bootstrap);

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length > 0) {
        return;
    }
    // Re-open the window without re-booting the server if one already exists.
    if (serverHandle) {
        mainWindow = createWindow();
        // AC-03 will reload serverHandle.url here.
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
