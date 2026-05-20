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

/** Options for creating a TeamsBot instance. */
export interface TeamsBotOptions {
    /** MCP server URL for the Teams server. */
    mcpServerUrl: string;
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
}

/** Connection status of the bot. */
export type BotStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

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
