/**
 * WhatsAppBot — high-level bot API wrapping Baileys connection.
 */

import type { BotOptions, BotStatus, InboundWAMessage, WASocket } from './types';
import { createBaileysConnection } from './connection';

export class WhatsAppBot {
    private sock: WASocket | null = null;
    private readonly opts: Required<Pick<BotOptions, 'sessionDir' | 'onMessage' | 'printQR'>> & BotOptions;
    private _status: BotStatus = 'disconnected';
    private _lastQR: string | null = null;
    private _lastError: string | null = null;

    constructor(opts: BotOptions) {
        this.opts = {
            printQR: true,
            ...opts,
        };
    }

    /** Connect to WhatsApp. Prints QR on first run. */
    async start(): Promise<void> {
        this.setStatus('connecting');
        this._lastError = null;
        this.sock = await createBaileysConnection({
            sessionDir: this.opts.sessionDir,
            deviceName: this.opts.deviceName,
            onQR: (qr) => {
                this._lastQR = qr;
                this._lastError = null;
                this.setStatus('qr-pending');
                if (this.opts.printQR) {
                    try {
                        const qrTerminal = require('qrcode-terminal');
                        qrTerminal.generate(qr, { small: true });
                    } catch {
                        console.log('[whatsapp-bot] QR code (scan with WhatsApp):', qr);
                    }
                }
                this.opts.onQR?.(qr);
            },
            onConnected: (newSock) => {
                // Update socket reference — on reconnect, Baileys creates a new socket
                this.sock = newSock;
                this.sock.ev.on('messages.upsert', (upsert: any) => {
                    this.handleMessages(upsert);
                });
                this._lastQR = null;
                this._lastError = null;
                this.setStatus('connected');
                console.log('[whatsapp-bot] Connected to WhatsApp');
            },
            onDisconnected: (loggedOut) => {
                this.setStatus('disconnected');
                if (loggedOut) {
                    console.log('[whatsapp-bot] Logged out from WhatsApp');
                }
            },
            onError: (error) => {
                this._lastError = error;
            },
        });
    }

    /** Gracefully disconnect. */
    async stop(): Promise<void> {
        if (this.sock) {
            this.sock.end();
            this.sock = null;
            this.setStatus('disconnected');
        }
    }

    /** Send a text message, optionally quoting another message. Returns the WA message ID. */
    async send(jid: string, text: string, opts?: { quotedId?: string }): Promise<string> {
        if (!this.sock) {
            throw new Error('WhatsAppBot is not started');
        }
        const sendOpts = opts?.quotedId
            ? { quoted: { key: { remoteJid: jid, id: opts.quotedId, fromMe: true } } }
            : undefined;
        const result = await this.sock.sendMessage(jid, { text }, sendOpts);
        return result.key.id ?? '';
    }

    /** List all WhatsApp groups the account participates in. */
    async listGroups(): Promise<Array<{ jid: string; name: string }>> {
        if (!this.sock) throw new Error('WhatsAppBot is not started');
        const groups = await this.sock.groupFetchAllParticipating();
        return Object.entries(groups).map(([jid, meta]) => ({
            jid,
            name: meta.subject ?? jid,
        }));
    }

    /** Create a new WhatsApp group and return its JID. */
    async createGroup(name: string): Promise<string> {
        if (!this.sock) throw new Error('WhatsAppBot is not started');
        const prevStatus = this._status;
        this.setStatus('creating-group');
        try {
            const result = await this.sock.groupCreate(name, []);
            console.log(`[whatsapp-bot] Created group "${name}" → ${result.id}`);
            return result.id;
        } finally {
            // Restore previous status — don't fire 'connected' again
            this._status = prevStatus;
        }
    }

    /** Whether the bot is currently connected. */
    isConnected(): boolean {
        return this._status === 'connected';
    }

    /** Current connection status. */
    getStatus(): BotStatus {
        return this._status;
    }

    /** Last QR code string (null when connected or never received). */
    getLastQR(): string | null {
        return this._lastQR;
    }

    /** Last connection error message, if any. */
    getLastError(): string | null {
        return this._lastError;
    }

    private setStatus(status: BotStatus): void {
        this._status = status;
        this.opts.onStatusChange?.(status);
    }

    private handleMessages(upsert: { messages?: any[]; type?: string }): void {
        if (upsert.type !== 'notify') return;
        for (const msg of upsert.messages ?? []) {
            // Skip status broadcasts and own messages
            if (msg.key.fromMe) continue;
            if (msg.key.remoteJid === 'status@broadcast') continue;

            const text = msg.message?.conversation
                ?? msg.message?.extendedTextMessage?.text
                ?? '';
            if (!text) continue;

            const inbound: InboundWAMessage = {
                senderJid: msg.key.remoteJid ?? '',
                messageId: msg.key.id ?? '',
                text,
                senderName: msg.pushName,
            };

            // Check for quoted message
            const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
            if (contextInfo?.stanzaId) {
                inbound.quotedMessageId = contextInfo.stanzaId;
            }

            this.opts.onMessage(inbound).catch((err) => {
                console.error('[whatsapp-bot] Error handling message:', err);
            });
        }
    }
}
