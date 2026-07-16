/**
 * WhatsAppBot — high-level bot API wrapping Baileys connection.
 */

import type { BotOptions, BotStatus, InboundWAMessage, WASocket } from './types';
import type { ConnectorStatus, MessagingConnector, MessagingTarget, SendOptions } from '../core';
import { createBaileysConnection } from './connection';

/** Map native WhatsApp status to the normalized connector status. */
function toConnectorStatus(status: BotStatus): ConnectorStatus {
    switch (status) {
        case 'qr-pending': return 'pairing';
        case 'creating-group': return 'busy';
        default: return status;
    }
}

export class WhatsAppBot implements MessagingConnector {
    /** Stable provider id for the MessagingConnector contract. */
    readonly provider = 'whatsapp';
    private sock: WASocket | null = null;
    private readonly opts: Required<Pick<BotOptions, 'sessionDir' | 'onMessage' | 'printQR'>> & BotOptions;
    private _status: BotStatus = 'disconnected';
    private _lastQR: string | null = null;
    private _lastError: string | null = null;
    /** Track message IDs sent by this bot to distinguish from user-typed messages on same account. */
    private _sentMessageIds = new Set<string>();

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
    async send(jid: string, text: string, opts?: SendOptions): Promise<string> {
        if (!this.sock) {
            throw new Error('WhatsAppBot is not started');
        }
        // The normalized replyToId maps to a WhatsApp quoted message.
        const sendOpts = opts?.replyToId
            ? { quoted: { key: { remoteJid: jid, id: opts.replyToId, fromMe: true } } }
            : undefined;
        const result = await this.sock.sendMessage(jid, { text }, sendOpts);
        const msgId = result.key.id ?? '';
        if (msgId) this._sentMessageIds.add(msgId);
        return msgId;
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

    /** MessagingConnector: list groups as normalized targets. */
    async listTargets(): Promise<MessagingTarget[]> {
        const groups = await this.listGroups();
        return groups.map((g) => ({ id: g.jid, name: g.name }));
    }

    /** MessagingConnector: resolve a target by creating a group with the given name. */
    async resolveTarget(spec: unknown): Promise<string> {
        return this.createGroup(String(spec));
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

    /** Current connection status, normalized to the connector contract. */
    getStatus(): ConnectorStatus {
        return toConnectorStatus(this._status);
    }

    /** Current native WhatsApp status (includes 'qr-pending' / 'creating-group'). */
    getNativeStatus(): BotStatus {
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
            if (msg.key.remoteJid === 'status@broadcast') continue;

            // Skip messages sent programmatically by this bot (not user-typed from phone)
            const msgId = msg.key.id ?? '';
            if (msg.key.fromMe && this._sentMessageIds.has(msgId)) {
                this._sentMessageIds.delete(msgId);
                continue;
            }

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
