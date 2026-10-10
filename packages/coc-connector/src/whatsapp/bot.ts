/**
 * WhatsAppBot — high-level bot API wrapping Baileys connection.
 */

import type { BotOptions, BotStatus, InboundWAMessage, WASocket, WhatsAppOutboundMedia } from './types';
import { createHash } from 'node:crypto';
import type { ConnectorStatus, MessagingConnector, MessagingTarget, SendOptions } from '../core';
import { createBaileysConnection } from './connection';
import { createWhatsAppImage } from './inbound-image';
import { prepareWhatsAppMedia, WhatsAppMediaError } from './outbound-media';

const RECENT_MESSAGE_LIMIT = 500;

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
    private connectionAbort: AbortController | null = null;
    private readonly opts: Required<Pick<BotOptions, 'sessionDir' | 'onMessage' | 'printQR'>> & BotOptions;
    private _status: BotStatus = 'disconnected';
    private _lastQR: string | null = null;
    private _lastError: string | null = null;
    /** Track message IDs sent by this bot to distinguish from user-typed messages on same account. */
    private _sentMessageIds = new Set<string>();
    /** Recent message bodies by ID; Baileys needs the quoted body, not just its key, to build a reply. */
    private _recentMessages = new Map<string, Record<string, unknown>>();

    constructor(opts: BotOptions) {
        this.opts = {
            printQR: true,
            ...opts,
        };
    }

    /** Connect to WhatsApp. Prints QR on first run. */
    async start(): Promise<void> {
        this.connectionAbort?.abort();
        const controller = new AbortController();
        this.connectionAbort = controller;
        this.setStatus('connecting');
        this._lastError = null;
        const sock = await createBaileysConnection({
            sessionDir: this.opts.sessionDir,
            signal: controller.signal,
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
                if (controller.signal.aborted) { newSock.end(); return; }
                // Update socket reference — on reconnect, Baileys creates a new socket
                this.sock = newSock;
                this.sock.ev.on('messages.upsert', (upsert: any) => {
                    if (this.sock !== newSock || controller.signal.aborted) return;
                    return this.handleMessages(upsert, controller.signal).catch(() => {
                        console.error('[whatsapp-bot] Could not read incoming message');
                    });
                });
                this._lastQR = null;
                this._lastError = null;
                this.setStatus('connected');
                console.log('[whatsapp-bot] Connected to WhatsApp');
            },
            onDisconnected: (loggedOut) => {
                if (controller.signal.aborted) return;
                this.setStatus('disconnected');
                if (loggedOut) {
                    console.log('[whatsapp-bot] Logged out from WhatsApp');
                }
            },
            onError: (error) => {
                if (!controller.signal.aborted) this._lastError = error;
            },
        });
        if (controller.signal.aborted) sock.end();
        else this.sock = sock;
    }

    /** Gracefully disconnect. */
    async stop(): Promise<void> {
        this.connectionAbort?.abort();
        this.connectionAbort = null;
        if (this.sock) {
            this.sock.end();
            this.sock = null;
        }
        this.setStatus('disconnected');
    }

    /** Send a text message, optionally quoting another message. Returns the WA message ID. */
    async send(jid: string, text: string, opts?: SendOptions): Promise<string> {
        if (!this.sock) {
            throw new Error('WhatsAppBot is not started');
        }
        const result = await this.sock.sendMessage(jid, { text }, this.quoteOptions(jid, opts));
        const msgId = result.key.id ?? '';
        if (msgId) {
            this._sentMessageIds.add(msgId);
            this.rememberMessage(msgId, { conversation: text });
        }
        return msgId;
    }

    /** Send native raster images or documents; uncertain delivery throws without replay. */
    async sendMedia(jid: string, media: WhatsAppOutboundMedia, opts?: SendOptions): Promise<string> {
        const content = prepareWhatsAppMedia(media);
        const sock = this.sock;
        if (!sock || !this.isConnected()) throw new WhatsAppMediaError('disconnected');
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            const result = await Promise.race([
                sock.sendMessage(jid, content, this.quoteOptions(jid, opts)),
                new Promise<never>((_, reject) => {
                    timer = setTimeout(() => reject(new WhatsAppMediaError('timeout')), 30_000);
                }),
            ]);
            const msgId = result?.key?.id;
            if (typeof msgId !== 'string' || !msgId.trim()) throw new WhatsAppMediaError('send');
            this._sentMessageIds.add(msgId);
            // Cache the encoded receipt, never decoded attachment bytes.
            this.rememberMessage(msgId, result.message ?? { conversation: media.caption ?? '' });
            return msgId;
        } catch (error) {
            if (error instanceof WhatsAppMediaError) throw error;
            throw new WhatsAppMediaError('send');
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    private quoteOptions(jid: string, opts?: SendOptions): Parameters<WASocket['sendMessage']>[2] {
        // Baileys needs a body as well as a key to build a quoted reply.
        return opts?.replyToId
            ? {
                quoted: {
                    key: { remoteJid: jid, id: opts.replyToId, fromMe: true },
                    message: this._recentMessages.get(opts.replyToId) ?? { conversation: '' },
                },
            }
            : undefined;
    }

    /** React to a message; reject if Baileys does not complete within five seconds. */
    async react(chatJid: string, messageId: string, emoji: string): Promise<void> {
        if (!this.sock) throw new Error('WhatsAppBot is not started');
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            await Promise.race([
                this.sock.sendMessage(chatJid, {
                    react: { text: emoji, key: { remoteJid: chatJid, id: messageId, fromMe: true } },
                }),
                new Promise<never>((_, reject) => {
                    timer = setTimeout(() => reject(new Error('WhatsApp reaction timed out')), 5_000);
                }),
            ]);
        } finally {
            if (timer) clearTimeout(timer);
        }
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
            // Notify observers of the restore so they don't stay on 'creating-group';
            // skip it if the connection changed state mid-call.
            if (this._status === 'creating-group') this.setStatus(prevStatus);
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

    /** Hash the paired account, not the reconnecting socket or device suffix. */
    getMirrorAccountKey(): string | undefined {
        const id = this.sock?.user?.id;
        return typeof id === 'string' && id
            ? createHash('sha256').update(id.replace(/:\d+(?=@)/, '')).digest('hex') : undefined;
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

    private rememberMessage(id: string, message: Record<string, unknown>): void {
        this._recentMessages.delete(id);
        this._recentMessages.set(id, message);
        if (this._recentMessages.size > RECENT_MESSAGE_LIMIT) {
            this._recentMessages.delete(this._recentMessages.keys().next().value!);
        }
    }

    private async handleMessages(upsert: { messages?: any[]; type?: string }, signal: AbortSignal): Promise<void> {
        if (upsert.type !== 'notify') return;
        const normalizeContent = this.opts.receiveImages
            ? (await import('@whiskeysockets/baileys')).normalizeMessageContent
            : undefined;
        if (signal.aborted) return;
        for (const msg of upsert.messages ?? []) {
            if (msg.key.remoteJid === 'status@broadcast') continue;

            // Skip messages sent programmatically by this bot (not user-typed from phone)
            const msgId = msg.key.id ?? '';
            if (msg.key.fromMe && this._sentMessageIds.has(msgId)) {
                this._sentMessageIds.delete(msgId);
                continue;
            }

            const content = normalizeContent ? normalizeContent(msg.message) : msg.message;
            const image = this.opts.receiveImages ? content?.imageMessage : undefined;
            const text = content?.conversation
                ?? content?.extendedTextMessage?.text
                ?? image?.caption
                ?? '';
            if (!text && !image) continue;
            if (msgId) this.rememberMessage(msgId, msg.message);

            const inbound: InboundWAMessage = {
                chatJid: msg.key.remoteJid ?? '',
                participantJid: msg.key.participant,
                fromMe: msg.key.fromMe === true,
                senderJid: msg.key.remoteJid ?? '',
                messageId: msg.key.id ?? '',
                text,
                senderName: msg.pushName,
            };
            if (image) inbound.images = [createWhatsAppImage(image, signal)];

            // Check for quoted message
            const contextInfo = content?.extendedTextMessage?.contextInfo ?? image?.contextInfo;
            if (contextInfo?.stanzaId) {
                inbound.quotedMessageId = contextInfo.stanzaId;
            }

            this.opts.onMessage(inbound).catch((err) => {
                console.error('[whatsapp-bot] Error handling message:', err);
            });
        }
    }
}
