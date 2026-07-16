/**
 * Core connector contract shared by every messaging provider (Teams, WhatsApp,
 * and future Slack/Discord/Telegram). Providers keep their own native types for
 * internal logic and adapt to these normalized shapes at the boundary.
 */

/** Normalized connection lifecycle across all providers. */
export type ConnectorStatus =
    | 'disconnected' | 'connecting' | 'authenticating'
    | 'pairing'      | 'connected'  | 'busy' | 'error';

/** Provider-neutral inbound message. */
export interface InboundMessage {
    /** Teams channelId/chatId | WhatsApp senderJid. */
    conversationId: string;
    messageId: string;
    /** Teams replyToMessageId | WhatsApp quotedMessageId. */
    replyToId?: string;
    text: string;
    senderName?: string;
    /** Teams senderAadId (WhatsApp: n/a). */
    senderId?: string;
    /** Escape hatch for provider-specific fields. */
    raw?: unknown;
}

/** Options accepted by a connector's send(). */
export interface SendOptions {
    replyToId?: string;
    mentions?: Array<{ id: string; displayName: string }>;
}

/** A place a connector can send to (Teams channel | WhatsApp group). */
export interface MessagingTarget {
    id: string;
    name: string;
}

/** Options common to constructing any messaging connector. */
export interface MessagingConnectorOptions {
    onMessage: (msg: InboundMessage) => Promise<void>;
    onStatusChange?: (status: ConnectorStatus) => void;
    onError?: (error: string) => void;
}

/**
 * The contract every messaging connector implements. Concrete connectors
 * (TeamsBot, WhatsAppBot) also expose provider-specific methods; this is the
 * common surface consumers and the future provider registry rely on.
 */
export interface MessagingConnector {
    /** Stable provider id — 'teams' | 'whatsapp' | ... */
    readonly provider: string;
    start(): Promise<void>;
    stop(): Promise<void>;
    send(target: string, text: string, opts?: SendOptions): Promise<string>;
    /** Channels (Teams) | groups (WhatsApp). */
    listTargets(): Promise<MessagingTarget[]>;
    /** resolveTeamAndChannel (Teams) | createGroup (WhatsApp). */
    resolveTarget?(spec: unknown): Promise<string>;
    isConnected(): boolean;
    /** Normalized status — see ConnectorStatus. */
    getStatus(): ConnectorStatus;
    getLastError(): string | null;
}
