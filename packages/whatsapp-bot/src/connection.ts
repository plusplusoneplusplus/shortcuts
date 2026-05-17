/**
 * Baileys connection factory — creates a WASocket with QR handling and auto-reconnect.
 */

import type { WASocket } from './types';

export interface ConnectionOptions {
    sessionDir: string;
    onQR: (qr: string) => void;
    onConnected: () => void;
    onDisconnected: (loggedOut: boolean) => void;
}

/**
 * Create a Baileys connection. Reconnects automatically on non-logout disconnects.
 *
 * This is the only file that imports Baileys directly — all other modules
 * consume the `WASocket` interface.
 */
export async function createBaileysConnection(opts: ConnectionOptions): Promise<WASocket> {
    // Dynamic imports so Baileys is only loaded when actually called
    const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = await import('@whiskeysockets/baileys');

    const { state, saveCreds } = await useMultiFileAuthState(opts.sessionDir);
    const sock = makeWASocket({ auth: state, printQRInTerminal: false });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update: { connection?: string; lastDisconnect?: { error?: Error }; qr?: string }) => {
        if (update.qr) {
            opts.onQR(update.qr);
        }
        if (update.connection === 'open') {
            opts.onConnected();
        }
        if (update.connection === 'close') {
            const statusCode = (update.lastDisconnect?.error as any)?.output?.statusCode;
            const loggedOut = statusCode === DisconnectReason.loggedOut;
            opts.onDisconnected(loggedOut);
            if (!loggedOut) {
                // Auto-reconnect after 3 seconds
                setTimeout(() => createBaileysConnection(opts), 3000);
            }
        }
    });

    return sock as unknown as WASocket;
}
