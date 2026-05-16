/**
 * Types for the MCP OAuth subsystem.
 *
 * Captures pending OAuth requests surfaced by the Copilot SDK's
 * `mcp.oauth_required` event so the dashboard can prompt the user to
 * complete the browser-based authorization flow.
 */

export type PendingMcpOAuthStatus = 'pending' | 'completed' | 'failed';

export interface PendingMcpOAuth {
    /** Stable id (the SDK requestId when available, else a generated uuid). */
    id: string;
    /** Display name of the MCP server requiring OAuth. */
    serverName: string;
    /** URL of the MCP server requiring OAuth. */
    serverUrl: string;
    /**
     * Authorization URL the user must open in a browser to complete the
     * flow. Undefined when the SDK build does not expose a proactive login
     * RPC; consumers should still surface `serverName` so the user can
     * authenticate out-of-band.
     */
    authorizationUrl?: string;
    /** Process (conversation) id that triggered the OAuth requirement. */
    processId?: string;
    /** Workspace id associated with the triggering process. */
    workspaceId?: string;
    /** Lifecycle status. */
    status: PendingMcpOAuthStatus;
    /** Wall-clock creation timestamp (ms since epoch). */
    createdAt: number;
    /** Last update timestamp (ms since epoch). */
    updatedAt: number;
    /** Optional failure reason when status === 'failed'. */
    error?: string;
}

/** Input shape for registering a new pending OAuth request. */
export interface RegisterMcpOAuthInput {
    requestId?: string;
    serverName: string;
    serverUrl: string;
    authorizationUrl?: string;
    processId?: string;
    workspaceId?: string;
}
