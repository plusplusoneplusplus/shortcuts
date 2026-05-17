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
    /** Called when an inbound text message arrives. */
    onMessage: (msg: InboundWAMessage) => Promise<void>;
    /** If true, print QR to terminal (default: true). */
    printQR?: boolean;
}

/** Minimal socket interface consumed by WhatsAppBot (subset of Baileys). */
export interface WASocket {
    ev: {
        on(event: string, handler: (...args: unknown[]) => void): void;
        off?(event: string, handler: (...args: unknown[]) => void): void;
    };
    sendMessage(jid: string, content: { text: string }): Promise<{ key: { id?: string } }>;
    end(error?: Error): void;
}
