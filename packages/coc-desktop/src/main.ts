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

let mainWindow: BrowserWindow | null = null;

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

function bootstrap(): void {
    mainWindow = createWindow();
    // Server boot + window.loadURL wiring is added in AC-02 / AC-03.
}

app.whenReady().then(bootstrap);

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        bootstrap();
    }
});

app.on('window-all-closed', () => {
    // Quit on all platforms except macOS, where apps typically stay resident.
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
