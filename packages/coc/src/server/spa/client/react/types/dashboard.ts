/**
 * Canonical type definitions for all React code.
 */

export type DashboardTab = 'processes' | 'repos' | 'wiki' | 'reports' | 'admin' | 'memory';
export type RepoSubTab = 'info' | 'workflows' | 'tasks' | 'queue' | 'schedules' | 'templates' | 'chat' | 'git' | 'wiki' | 'copilot' | 'workflow' | 'explorer';
export type WikiProjectTab = 'browse' | 'ask' | 'graph' | 'admin';
export type WikiAdminTab = 'generate' | 'seeds' | 'config' | 'delete';
export type MemorySubTab = 'entries' | 'config';

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

export interface AppState {
    processes: any[];
    selectedId: string | null;
    workspace: string;
    statusFilter: string;
    searchQuery: string;
    expandedGroups: Record<string, boolean>;
    liveTimers: Record<string, ReturnType<typeof setInterval>>;
    activeTab: DashboardTab;
    workspaces: any[];
    selectedRepoId: string | null;
    activeRepoSubTab: RepoSubTab;
    reposSidebarCollapsed: boolean;
    selectedWikiId: string | null;
    selectedWikiComponentId: string | null;
    wikiView: WikiViewMode;
    wikis: any[];
    conversationCache: Record<string, ConversationCacheEntry>;
}

export interface QueueState {
    queued: any[];
    running: any[];
    history: any[];
    stats: {
        queued: number; running: number; completed: number;
        failed: number; cancelled: number; total: number; isPaused: boolean;
        isDraining: boolean;
    };
    showDialog: boolean;
    showHistory: boolean;
    isFollowUpStreaming: boolean;
    currentStreamingTurnIndex: number | null;
    draining: boolean;
    drainQueued: number;
    drainRunning: number;
}

export interface TaskPanelState {
    selectedWorkspaceId: string | null;
    expandedFolders: Record<string, boolean>;
    openFilePath: string | null;
    selectedFilePaths: Set<string>;
}
