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
    estimatedUsdCost?: number;
    costBreakdown?: {
        inputUsd: number;
        cachedInputUsd: number;
        cacheWriteUsd: number;
        outputUsd: number;
    };
    pricingSource?: string;
    pricingUnavailable?: boolean;
    duration?: number;
    /** Session-level token limit (from session.usage_info) */
    tokenLimit?: number;
    /** Session-level current token count (from session.usage_info) */
    currentTokens?: number;
}

export type DashboardTab = 'processes' | 'repos' | 'wiki' | 'reports' | 'stats' | 'admin' | 'memory' | 'skills' | 'logs' | 'servers';

export const REPO_SUB_TAB_VALUES = [
    'chats', 'work-items', 'settings', 'workflows', 'templates', 'tasks',
    'schedules', 'git', 'wiki', 'workflow', 'explorer', 'activity',
    'pull-requests', 'terminal', 'notes',
] as const;
export type RepoSubTab = typeof REPO_SUB_TAB_VALUES[number];

export const SETTINGS_SECTION_VALUES = [
    'info', 'preferences', 'mcp', 'skills', 'llm-tools',
    'instructions', 'memory', 'run-script-template', 'tasks', 'notes',
] as const;
export type SettingsSection = typeof SETTINGS_SECTION_VALUES[number];
/** @deprecated Use SettingsSection */
export type CopilotSection = SettingsSection;

export const WIKI_PROJECT_TAB_VALUES = ['browse', 'ask', 'graph', 'admin'] as const;
export type WikiProjectTab = typeof WIKI_PROJECT_TAB_VALUES[number];

export const WIKI_ADMIN_TAB_VALUES = ['generate', 'seeds', 'config', 'delete'] as const;
export type WikiAdminTab = typeof WIKI_ADMIN_TAB_VALUES[number];
export type MemorySubTab = 'facts' | 'review' | 'episodes' | 'settings';
export type SkillsSubTab = 'installed' | 'gallery' | 'config';
export type AdminSubTab = 'settings' | 'providers' | 'data' | 'server' | 'prompts' | 'database' | 'agents' | 'messaging';

/** UI layout mode: 'classic' shows unified Activity tab; 'dev-workflow' shows Chats + Work Items + Tasks */
export type UiLayoutMode = 'classic' | 'dev-workflow';
export type PrDetailTab = 'overview' | 'files' | 'commits' | 'checks';

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
    /** True when the user's large pasted content was externalized to a temp file reference */
    pasteExternalized?: boolean;
    /** Model override used for this turn (set on user turns when /model was active) */
    model?: string;
    /** Chat mode used for this turn (set on user turns when mode override was active) */
    mode?: string;
    /** ISO timestamp when this turn was soft-deleted (undefined = not deleted) */
    deletedAt?: string;
    /** ISO timestamp when this turn was pinned (undefined = not pinned) */
    pinnedAt?: string;
    /** True when this turn is archived (collapsed/hidden by default) */
    archived?: boolean;
    /** Client-side elapsed time in ms from user send to response completion */
    costTimeMs?: number;
    /** Source metadata for automated follow-up turns (loops/wakeups). */
    turnSource?: { source: 'loop' | 'wakeup'; loopId?: string; wakeupId?: string };
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

/** Process-native history item returned by GET /api/workspaces/:id/history. */
export interface ProcessHistoryItem {
    id: string;
    type: string;
    status: string;
    title: string;
    promptPreview?: string;
    /** User-set custom title from the rename UI. */
    customTitle?: string;
    /** Denormalized cleaned snapshot of the latest user prompt (~120 chars). */
    lastMessagePreview?: string;
    startTime: number;
    endTime?: number;
    error?: string;
    mode?: string;
    model?: string;
    workspaceId: string;
    planFilePath?: string;
    workItemId?: string;
    turnCount: number;
    lastActivityAt?: number;
    seenAt?: string;
}

export interface ProcessHistoryResponse {
    history: ProcessHistoryItem[];
    hasMore: boolean;
    offset: number;
    limit: number;
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
    selectedFolderPath: string | null;
    activeFolderPath: string | null;
}

