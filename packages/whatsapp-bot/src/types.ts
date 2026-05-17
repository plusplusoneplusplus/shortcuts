/**
 * WhatsApp Bot types — standalone, no CoC/forge deps.
 */

/** Inbound message received from WhatsApp. */
export interface InboundWAMessage {
    senderJid: string;
    messageId: string;
    quotedMessageId?: string;
    text: string;
    senderName?: string;
}

/** Options for creating a WhatsAppBot instance. */
export interface BotOptions {
    /** Directory for Baileys multi-file auth state. */
    sessionDir: string;
    /** Device name shown in WhatsApp's "Linked Devices" (default: "CoC"). */
    deviceName?: string;
    /** Called when an inbound text message arrives. */
    onMessage: (msg: InboundWAMessage) => Promise<void>;
    /** If true, print QR to terminal (default: true). */
    printQR?: boolean;
    /** Called when a new QR code is available for pairing. */
    onQR?: (qr: string) => void;
    /** Called when connection state changes. */
    onStatusChange?: (status: BotStatus) => void;
}

/** Connection status of the bot. */
export type BotStatus = 'disconnected' | 'connecting' | 'qr-pending' | 'connected' | 'creating-group';

/** Minimal socket interface consumed by WhatsAppBot (subset of Baileys). */
export interface WASocket {
    ev: {
        on(event: string, handler: (...args: unknown[]) => void): void;
        off?(event: string, handler: (...args: unknown[]) => void): void;
    };
    sendMessage(jid: string, content: { text: string }): Promise<{ key: { id?: string } }>;
    groupCreate(subject: string, participants: string[]): Promise<{ id: string; [k: string]: unknown }>;
    groupFetchAllParticipating(): Promise<Record<string, { subject?: string; [k: string]: unknown }>>;
    end(error?: Error): void;
}
