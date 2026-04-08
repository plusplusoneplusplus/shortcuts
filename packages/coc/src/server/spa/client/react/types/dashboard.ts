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

export type DashboardTab = 'processes' | 'repos' | 'wiki' | 'reports' | 'stats' | 'admin' | 'memory' | 'skills' | 'logs' | 'models';
export type RepoSubTab = 'chats' | 'tasks' | 'settings' | 'workflows' | 'work-items' | 'schedules' | 'git' | 'wiki' | 'workflow' | 'explorer' | 'activity' | 'pull-requests';
export type SettingsSection = 'info' | 'preferences' | 'mcp' | 'skills' | 'instructions' | 'memory' | 'run-script-template' | 'tasks';
/** @deprecated Use SettingsSection */
export type CopilotSection = SettingsSection;
export type WikiProjectTab = 'browse' | 'ask' | 'graph' | 'admin';
export type WikiAdminTab = 'generate' | 'seeds' | 'config' | 'delete';
export type MemorySubTab = 'entries' | 'config' | 'files';
export type SkillsSubTab = 'installed' | 'gallery' | 'config';
export type AdminSubTab = 'settings' | 'providers' | 'data' | 'server' | 'prompts';
export type PrDetailTab = 'overview' | 'threads' | 'files';

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
    /** Non-image file attachments (name, mimeType, size, category) */
    fileAttachments?: Array<{ name: string; mimeType: string; size: number; category: string }>;
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
    /** When true, cached turns included streaming state and must be refreshed from server on re-mount. */
    dirty?: boolean;
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

export interface ClientTokenUsageStatsEntry {
    date: string;                               // YYYY-MM-DD
    byModel: Record<string, ClientTokenUsage>;  // model → usage
    dayTotal: ClientTokenUsage;                 // sum across models
}

export interface ClientTokenUsageStatsResponse {
    entries: ClientTokenUsageStatsEntry[];
    models: string[];                           // all models seen, sorted
    generatedAt: string;                        // ISO timestamp
    totalDays: number;
}

export type WikiViewMode = 'list' | 'detail';

/** Navigation state for the Tasks (Plans) sub-tab, persisted in AppContext. */
export interface TasksPanelNavState {
    openFilePath: string | null;
    selectedFilePaths: string[];
}

