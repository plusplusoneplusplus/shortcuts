/**
 * Canonical type definitions for all React code.
 */

/** Token usage data for a single conversation turn (client-side representation) */
export interface ClientTokenUsage {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    totalTokens: number;
    turnCount: number;
    cost?: number;
    duration?: number;
    /** Session-level token limit (from session.usage_info) */
    tokenLimit?: number;
    /** Session-level current token count (from session.usage_info) */
    currentTokens?: number;
}

export type DashboardTab = 'processes' | 'repos' | 'wiki' | 'reports' | 'admin' | 'memory' | 'skills' | 'logs';
export type RepoSubTab = 'info' | 'workflows' | 'tasks' | 'schedules' | 'git' | 'wiki' | 'copilot' | 'workflow' | 'explorer' | 'activity' | 'pull-requests';
export type WikiProjectTab = 'browse' | 'ask' | 'graph' | 'admin';
export type WikiAdminTab = 'generate' | 'seeds' | 'config' | 'delete';
export type MemorySubTab = 'entries' | 'config' | 'files';
export type SkillsSubTab = 'installed' | 'bundled' | 'config';

/** Tool call status for the SPA client (timestamps are ISO strings) */
export interface ClientToolCall {
    id: string;
    toolName: string;
    args: any;
    result?: string;
    error?: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    startTime?: string;
    endTime?: string;
    parentToolCallId?: string;
}

/** Timeline event for the SPA client (timestamps are ISO strings) */
export interface ClientTimelineItem {
    type: 'content' | 'tool-start' | 'tool-complete' | 'tool-failed';
    timestamp: string;
    content?: string;
    toolCall?: ClientToolCall;
}

/** Lightweight conversation turn for the SPA client (timestamps are strings) */
export interface ClientConversationTurn {
    role: 'user' | 'assistant';
    content: string;
    timestamp?: string;
    turnIndex?: number;
    streaming?: boolean;
    /** True when the last AI call for this turn failed — enables the Retry button. */
    isError?: boolean;
    toolCalls?: ClientToolCall[];
    timeline: ClientTimelineItem[];
    /** Base64 data-URL strings for user-attached images */
    images?: string[];
    /** Number of externalized images available via the images endpoint */
    imagesCount?: number;
    /** Whether this turn has externalized images */
    hasImages?: boolean;
    /** True for turns prepended from a prior session during cold resume */
    historical?: boolean;
    /** Skills invoked via /slash commands in this turn */
    skillNames?: string[];
    /** Token usage for this turn (assistant turns only, undefined for non-streaming/legacy) */
    tokenUsage?: ClientTokenUsage;
}

/** Cached conversation data for a historical process. */
export interface ConversationCacheEntry {
    turns: ClientConversationTurn[];
    cachedAt: number;
}

/** Summary of a chat session for sidebar display */
export interface ChatSessionItem {
    id: string;            // queue task ID
    processId?: string;    // linked process ID (for fetching conversation)
    status: string;        // 'running' | 'completed' | 'failed' | 'cancelled'
    createdAt: string;     // ISO timestamp
    completedAt?: string;  // ISO timestamp
    lastActivityAt?: string; // ISO timestamp — last conversation activity
    firstMessage: string;  // first user prompt (for preview, may be truncated by server)
    title?: string;        // AI-generated title (overrides firstMessage in sidebar when set)
    turnCount?: number;    // number of conversation turns (from enriched history)
}

export type WikiViewMode = 'list' | 'detail';

