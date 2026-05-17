/**
 * Baileys connection factory — creates a WASocket with QR handling and auto-reconnect.
 */

import type { WASocket } from './types';

export interface ConnectionOptions {
    sessionDir: string;
    /** Device name shown in WhatsApp's "Linked Devices" list (default: "CoC") */
    deviceName?: string;
    onQR: (qr: string) => void;
    onConnected: () => void;
    onDisconnected: (loggedOut: boolean) => void;
    onError?: (error: string) => void;
}

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 3000;

/**
 * Create a Baileys connection. Reconnects automatically on non-logout disconnects
 * with exponential backoff (up to MAX_RETRIES attempts).
 */
export async function createBaileysConnection(opts: ConnectionOptions, attempt = 0): Promise<WASocket> {
    const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestBaileysVersion } = await import('@whiskeysockets/baileys');

    const { version } = await fetchLatestBaileysVersion();
    const { state, saveCreds } = await useMultiFileAuthState(opts.sessionDir);
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        browser: [opts.deviceName || 'CoC', 'Desktop', '1.0'],
        connectTimeoutMs: 30_000,
        version,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update: { connection?: string; lastDisconnect?: { error?: Error }; qr?: string }) => {
        if (update.qr) {
            attempt = 0; // Reset retries once we get a QR
            opts.onQR(update.qr);
        }
        if (update.connection === 'open') {
            attempt = 0;
            opts.onConnected();
        }
        if (update.connection === 'close') {
            const statusCode = (update.lastDisconnect?.error as any)?.output?.statusCode;
            const loggedOut = statusCode === DisconnectReason.loggedOut;
            opts.onDisconnected(loggedOut);
            if (loggedOut) {
                // Clear stale session so next connect gets a fresh QR
                const fs = require('fs');
                try { fs.rmSync(opts.sessionDir, { recursive: true, force: true }); } catch { /* ignore */ }
                console.log('[whatsapp-bot] Session cleared after logout, reconnecting for fresh QR...');
                setTimeout(() => createBaileysConnection(opts, 0), BASE_DELAY_MS);
            } else if (attempt < MAX_RETRIES) {
                const delay = BASE_DELAY_MS * Math.pow(2, attempt);
                console.log(`[whatsapp-bot] Reconnecting in ${delay / 1000}s (attempt ${attempt + 1}/${MAX_RETRIES})...`);
                setTimeout(() => createBaileysConnection(opts, attempt + 1), delay);
            } else {
                const msg = `Connection failed after ${MAX_RETRIES} attempts`;
                console.error(`[whatsapp-bot] ${msg}`);
                opts.onError?.(msg);
            }
        }
    });

    return sock as unknown as WASocket;
}
