/**
 * Canonical type definitions for all React code.
 */

export type DashboardTab = 'processes' | 'repos' | 'wiki' | 'reports' | 'admin';
export type RepoSubTab = 'info' | 'pipelines' | 'tasks' | 'queue' | 'schedules' | 'chat';

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
    toolCalls?: ClientToolCall[];
    timeline: ClientTimelineItem[];
}

/** Cached conversation data for a historical process. */
export interface ConversationCacheEntry {
    turns: ClientConversationTurn[];
    cachedAt: number;
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
