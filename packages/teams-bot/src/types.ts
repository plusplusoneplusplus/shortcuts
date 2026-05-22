/**
 * MS Teams Bot types — standalone, no CoC/forge deps.
 */

/** Inbound message received from MS Teams. */
export interface InboundTeamsMessage {
    channelId: string;
    messageId: string;
    replyToMessageId?: string;
    text: string;
    senderName?: string;
    senderAadId?: string;
}

/**
 * Transport mode for the Teams bot.
 * - 'graph': Use Microsoft Graph API directly (works with az login tokens). Primary/recommended.
 * - 'mcp': Use the Teams MCP server (requires McpServers.Teams.All — preauthorized apps only).
 */
export type TeamsTransportMode = 'graph' | 'mcp';

/** Options for creating a TeamsBot instance. */
export interface TeamsBotOptions {
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
    /** Called when an inbound text message arrives. */
    onMessage: (msg: InboundTeamsMessage) => Promise<void>;
    /** Called when connection state changes. */
    onStatusChange?: (status: BotStatus) => void;
    /** Called when an error occurs. */
    onError?: (error: string) => void;
    /** Polling interval in ms for checking new messages (default: 3000). */
    pollIntervalMs?: number;
    /** Display name for the bot in Teams (default: "CoC"). */
    botName?: string;
    /** Azure AD auth config for token acquisition. */
    auth?: TeamsAuthConfig;
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

/** Connection status of the bot. */
export type BotStatus = 'disconnected' | 'connecting' | 'authenticating' | 'connected' | 'error';

/** MCP tool call request. */
export interface McpToolCall {
    method: 'tools/call';
    params: {
        name: string;
        arguments?: Record<string, unknown>;
    };
}

/** MCP tool call response. */
export interface McpToolResult {
    content: Array<{ type: string; text?: string }>;
    isError?: boolean;
}

/** MCP list tools response. */
export interface McpToolsListResult {
    tools: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>;
}

/** Teams channel info. */
export interface TeamsChannel {
    id: string;
    displayName: string;
    teamId?: string;
    teamName?: string;
}

/** Send options for transport layer. */
export interface TransportSendOptions {
    replyToId?: string;
    mentions?: Array<{ aadId: string; displayName: string }>;
}

/**
 * TeamsTransport — abstraction over communication with Teams.
 * Two implementations: GraphTransport (Graph API) and McpTransport (MCP server).
 */
export interface TeamsTransport {
    /** Connect/initialize the transport with a bearer token. */
    initialize(token: string, opts: { teamId?: string; channelId?: string }): Promise<void>;
    /** Send a message to a channel. Returns the message ID. */
    send(channelId: string, text: string, opts?: TransportSendOptions): Promise<string>;
    /** Poll for new messages since a timestamp or watermark. */
    poll(channelId: string, since?: string): Promise<{ messages: InboundTeamsMessage[]; nextSince: string }>;
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
}
