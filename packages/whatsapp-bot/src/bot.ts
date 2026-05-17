/**
 * WhatsAppBot — high-level bot API wrapping Baileys connection.
 */

import type { BotOptions, InboundWAMessage, WASocket } from './types';
import { createBaileysConnection } from './connection';

export class WhatsAppBot {
    private sock: WASocket | null = null;
    private readonly opts: Required<BotOptions>;
    private connected = false;

    constructor(opts: BotOptions) {
        this.opts = {
            printQR: true,
            ...opts,
        };
    }

    /** Connect to WhatsApp. Prints QR on first run. */
    async start(): Promise<void> {
        this.sock = await createBaileysConnection({
            sessionDir: this.opts.sessionDir,
            onQR: (qr) => {
                if (this.opts.printQR) {
                    try {
                        const qrTerminal = require('qrcode-terminal');
                        qrTerminal.generate(qr, { small: true });
                    } catch {
                        console.log('[whatsapp-bot] QR code (scan with WhatsApp):', qr);
                    }
                }
            },
            onConnected: () => {
                this.connected = true;
                console.log('[whatsapp-bot] Connected to WhatsApp');
            },
            onDisconnected: (loggedOut) => {
                this.connected = false;
                if (loggedOut) {
                    console.log('[whatsapp-bot] Logged out from WhatsApp');
                }
            },
        });

        this.sock.ev.on('messages.upsert', (upsert: any) => {
            this.handleMessages(upsert);
        });
    }

    /** Gracefully disconnect. */
    async stop(): Promise<void> {
        if (this.sock) {
            this.sock.end();
            this.sock = null;
            this.connected = false;
        }
    }

    /** Send a text message. Returns the WA message ID. */
    async send(jid: string, text: string): Promise<string> {
        if (!this.sock) {
            throw new Error('WhatsAppBot is not started');
        }
        const result = await this.sock.sendMessage(jid, { text });
        return result.key.id ?? '';
    }

    /** Whether the bot is currently connected. */
    isConnected(): boolean {
        return this.connected;
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
