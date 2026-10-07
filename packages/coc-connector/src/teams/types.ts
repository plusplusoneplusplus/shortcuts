/**
 * MS Teams Bot types — standalone, no CoC/forge deps.
 */

import type { Ic3DirectMessageOptions } from './ic3/ic3-direct-message-config';
import type { RoutedTeamsOperations, TeamsOperationRoutes, TeamsMessageRef } from './operations';
import type { TeamsTrouterOptions } from './trouter';
import type { TeamsReadHints } from './notification-scheduler';
import type { GraphOutboundOptions } from './graph/graph-credential';
import type { InboundImage } from '../core/inbound-image';

export interface InboundTeamsMessage {
    /** Exact reader/backend identity for subsequent typed operations. */
    reference?: TeamsMessageRef;
    channelId: string;
    messageId: string;
    replyToMessageId?: string;
    text: string;
    /** Lazy authenticated images, available when receiveImages is enabled. */
    images?: InboundImage[];
    senderName?: string;
    senderAadId?: string;
    /** Teams identifies the sender as an application rather than a human user. */
    botAuthored?: boolean;
    createdDateTime?: string;
    /** This tracked reply was discovered while establishing the initial channel watermark. */
    initializationReplay?: boolean;
    /** Historic repo/topic control reply from paginated root backfill; restore selection without responding. */
    historicalSelectionReplay?: boolean;
}

/**
 * Transport mode for the Teams bot.
 * - 'graph': Use Microsoft Graph API directly (works with az login tokens). Primary/recommended.
 * - 'mcp': Use the Teams MCP server (requires McpServers.Teams.All — preauthorized apps only).
 */
export type TeamsTransportMode = 'graph' | 'mcp';

export interface TeamsBotOptions {
    /** Opt in to inline images on hybrid Graph channel reads; default consumers remain text-only. */
    receiveImages?: boolean;
    /** Private-protocol notification wake hints, default off; reads remain authoritative.
     * DMs require an explicit reader chat target: no discovery probe or synthetic 48:notes wakes. */
    enableTrouter?: boolean;
    trouterOptions?: TeamsTrouterOptions;
    /** Account-scoped connection identity; generated per instance when omitted. */
    connectionId?: string;
    /** Per-instance outbound routing for self, chat and channel operations. */
    operationRoutes?: Partial<TeamsOperationRoutes>;
    /** Separate, identity-pinned Graph credentials for explicit MCP channel write routes. */
    graphOutboundOptions?: GraphOutboundOptions;
    /** MCP discovery/operations with authoritative Graph channel reads; MCP is the standalone default. */
    channelReadBackend?: 'mcp' | 'graph';
    /** Read consent is validated separately from outbound consent against the same MCP account. */
    graphReadOptions?: GraphOutboundOptions;
    /**
     * Transport mode (default: 'graph').
     * - 'graph': Uses Graph API directly. Requires teamId + bearerToken (from az login).
     * - 'mcp': Uses Teams MCP server. Requires mcpServerUrl + preauthorized app.
     */
    mode?: TeamsTransportMode;
    /** Team ID (GUID) — required for 'graph' mode. */
    teamId?: string;
    /** MCP server URL for the Teams server — required for 'mcp' mode. */
    mcpServerUrl?: string;
    /** Region and separate IC3 credential provider; supplying options does not enable sends. */
    ic3DirectMessageOptions?: Ic3DirectMessageOptions;
    /** Called when an inbound text message arrives. */
    onMessage: (msg: InboundTeamsMessage) => Promise<void>;
    /** Called when connection state changes. */
    onStatusChange?: (status: BotStatus) => void;
    /** Called when an error occurs. */
    onError?: (error: string) => void;
    /** Safe poll outcome observer; never receives transport data. */
    onPoll?: (outcome: 'success' | 'failure') => void;
    /** Safe inbound routing observer; never receives message content or IDs. */
    onInbound?: (outcome: 'observed' | 'skipped', reason?: 'initial' | 'unchanged' | 'own' | 'empty' | 'bot') => void;
    /** Active polling interval in ms (default: 12000; idle: 30000). */
    pollIntervalMs?: number;
    /** Opt in to polling channel thread replies and dispatching each unseen post. */
    pollChannelReplies?: () => boolean;
    /** Enable Graph channel polling; omitted means Graph remains send-only. */
    pollGraphChannel?: () => boolean;
    /** Live channel thread roots supplied by the owner of durable thread bindings. */
    channelThreadRoots?: (channelId: string) => readonly string[];
    /** Persist a discovered channel root before its replies are routed; must be idempotent across reconnects. */
    onChannelRootDiscovered?: (root: InboundTeamsMessage) => Promise<void>;
    /** Recognize outbound thread messages whose IDs survived a connector restart. */
    isOwnChannelReply?: (msg: InboundTeamsMessage) => boolean;
    /** Recognize inbound thread messages already admitted by durable receipts. */
    isKnownChannelReply?: (msg: InboundTeamsMessage) => boolean;
    /** Display name for the bot in Teams (default: "CoC"). */
    botName?: string;
    /** Azure AD auth config for token acquisition. */
    auth?: TeamsAuthConfig;
    /** Enable verbose debug logging for poll and message routing (default: false). */
    debug?: boolean;
}

/** Azure AD authentication configuration for the Teams MCP server. */
export interface TeamsAuthConfig {
    /** Azure AD tenant ID (default: extracted from mcpServerUrl). */
    tenantId?: string;
    /** Azure AD client/app ID for device code flow. */
    clientId?: string;
    /** OAuth2 scope for the Teams MCP resource. */
    scope?: string;
    /** Pre-existing bearer token (skips device code flow). */
    bearerToken?: string;
    /** Called when device code flow requires user interaction. */
    onDeviceCode?: (verification: DeviceCodeInfo) => void;
    /** Called to refresh the token when a 401 is received. Should return a new bearer token. */
    onTokenRefresh?: () => Promise<string | null>;
}

/** Device code verification info shown to the user. */
export interface DeviceCodeInfo {
    userCode: string;
    verificationUri: string;
    message: string;
    expiresIn: number;
}

export type BotStatus = 'disconnected' | 'connecting' | 'authenticating' | 'connected' | 'error';

export interface McpToolCall {
    method: 'tools/call';
    params: {
        name: string;
        arguments?: Record<string, unknown>;
    };
}

export interface McpToolResult {
    content: Array<{ type: string; text?: string }>;
    isError?: boolean;
}

export interface McpToolsListResult {
    tools: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>;
}

export interface TeamsChannel {
    id: string;
    displayName: string;
    teamId?: string;
    teamName?: string;
}

export interface TransportSendOptions {
    replyToId?: string;
    mentions?: Array<{ aadId: string; displayName: string }>;
}

/**
 * TeamsTransport — abstraction over communication with Teams.
 * Two implementations: GraphTransport (Graph API) and McpTransport (MCP server).
 */
export interface TeamsTransport {
    readonly connectionId: string;
    readonly operations: RoutedTeamsOperations;
    /** Connect/initialize the transport with a bearer token. */
    initialize(token: string, opts: { teamId?: string; channelId?: string; chatId?: string }): Promise<void>;
    /** Send a message to a target (channelId or chatId). Returns the message ID. */
    send(target: string, text: string, opts?: TransportSendOptions): Promise<string>;
    /** Like an original channel post or its thread reply. Unsupported modes reject. */
    reactToChannelMessage(target: InboundTeamsMessage): Promise<void>;
    /** Poll for new messages since a timestamp or watermark. */
    poll(target: string, since?: string, hints?: TeamsReadHints): Promise<{ messages: InboundTeamsMessage[]; nextSince: string }>;
    /** Commit notification read progress only after the caller completes admission. */
    commitNotificationRead?(target: string): void;
    /** List channels in the team. */
    listChannels(teamId: string): Promise<TeamsChannel[]>;
    /** Resolve team/channel names to IDs (create if missing). */
    resolveTeamAndChannel(teamName: string, channelName: string): Promise<{ teamId: string; channelId: string }>;
    /** Update the bearer token (e.g. after refresh). */
    setToken(token: string): void;
    /** Set the target channel for the transport. */
    setChannelId(channelId: string): void;
    /** Disconnect/cleanup. */
    stop(): void;
    /** Enable verbose debug logging (default: false). */
    debug?: boolean;
}
