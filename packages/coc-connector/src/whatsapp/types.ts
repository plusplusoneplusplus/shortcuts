/**
 * WhatsApp Bot types — standalone, no CoC/forge deps.
 */

import type { InboundImage } from '../core';

export interface InboundWAMessage {
    /** Chat or group that contains the message. */
    chatJid: string;
    /** Author within a group, when supplied by WhatsApp. */
    participantJid?: string;
    /** Whether the paired account sent the message. */
    fromMe: boolean;
    /** Kept for existing consumers; identical to chatJid. */
    senderJid: string;
    messageId: string;
    quotedMessageId?: string;
    text: string;
    senderName?: string;
    images?: InboundImage[];
}

export interface BotOptions {
    /** Directory for Baileys multi-file auth state. */
    sessionDir: string;
    /** Device name shown in WhatsApp's "Linked Devices" (default: "CoC"). */
    deviceName?: string;
    /** Called when an inbound message arrives. Images require receiveImages. */
    onMessage: (msg: InboundWAMessage) => Promise<void>;
    /** Opt into images and their captions; default false for existing consumers. */
    receiveImages?: boolean;
    /** If true, print QR to terminal (default: true). */
    printQR?: boolean;
    /** Called when a new QR code is available for pairing. */
    onQR?: (qr: string) => void;
    /** Called when connection state changes. */
    onStatusChange?: (status: BotStatus) => void;
}

export type BotStatus = 'disconnected' | 'connecting' | 'qr-pending' | 'connected' | 'creating-group';

/** Decoded attachment bytes; raster images send natively, other MIME types as documents. */
export interface WhatsAppOutboundMedia {
    bytes: Buffer;
    filename: string;
    mimeType: string;
    caption?: string;
}

export type WhatsAppMediaContent = {
    image: Buffer;
    mimetype: string;
    fileName: string;
    caption?: string;
} | {
    document: Buffer;
    mimetype: string;
    fileName: string;
    caption?: string;
};

/** Minimal socket interface consumed by WhatsAppBot (subset of Baileys). */
export interface WASocket {
    user?: { id?: string };
    ev: {
        on(event: string, handler: (...args: unknown[]) => void): void;
        off?(event: string, handler: (...args: unknown[]) => void): void;
    };
    sendMessage(
        jid: string,
        content: { text: string } | WhatsAppMediaContent | { react: { text: string; key: { remoteJid: string; id: string; fromMe: boolean } } },
        options?: { quoted?: { key: { remoteJid?: string; id?: string; fromMe?: boolean }; message?: Record<string, unknown> } },
    ): Promise<{ key: { id?: string }; message?: Record<string, unknown> }>;
    groupCreate(subject: string, participants: string[]): Promise<{ id: string; [k: string]: unknown }>;
    groupFetchAllParticipating(): Promise<Record<string, { subject?: string; [k: string]: unknown }>>;
    end(error?: Error): void;
}
