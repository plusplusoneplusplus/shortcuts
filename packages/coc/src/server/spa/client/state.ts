/**
 * Shared mutable state — extracted from core.ts and queue.ts
 * to break circular dependency chains between modules.
 */

export type DashboardTab = 'processes' | 'repos' | 'wiki' | 'reports';
export type RepoSubTab = 'info' | 'pipelines' | 'tasks';

/** Tool call status for the SPA client (timestamps are ISO strings) */
export interface ClientToolCall {
    id: string;
    toolName: string;
    args: any;
    result?: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    startTime?: string;
    endTime?: string;
}

/** Lightweight conversation turn for the SPA client (timestamps are strings) */
export interface ClientConversationTurn {
    role: 'user' | 'assistant';
    content: string;
    timestamp?: string;
    turnIndex?: number;
    streaming?: boolean;
    toolCalls?: ClientToolCall[];
}

/** Cached conversation data for a historical process. */
export interface ConversationCacheEntry {
    turns: ClientConversationTurn[];
    cachedAt: number;
}

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
    /** Client-side cache of loaded conversations (processId → turns). */
    conversationCache: Record<string, ConversationCacheEntry>;
}

export const appState: AppState = {
    processes: [],
    selectedId: null,
    workspace: '__all',
    statusFilter: '__all',
    searchQuery: '',
    expandedGroups: {},
    liveTimers: {},
    activeTab: 'repos',
    workspaces: [],
    selectedRepoId: null,
    activeRepoSubTab: 'info',
    selectedWikiId: null,
    selectedWikiComponentId: null,
    conversationCache: {},
};

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
    /** Server is shutting down — drain in progress */
    draining: boolean;
    /** Drain progress: remaining tasks */
    drainQueued: number;
    drainRunning: number;
}

export const queueState: QueueState = {
    queued: [],
    running: [],
    history: [],
    stats: { queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0, total: 0, isPaused: false, isDraining: false },
    showDialog: false,
    showHistory: false,
    isFollowUpStreaming: false,
    currentStreamingTurnIndex: null,
    draining: false,
    drainQueued: 0,
    drainRunning: 0,
};

(window as any).appState = appState;

// ================================================================
// Tasks panel state
// ================================================================

export interface TaskPanelState {
    selectedWorkspaceId: string | null;
    expandedFolders: Record<string, boolean>;
    openFilePath: string | null;
    selectedFilePaths: Set<string>;
}

export const taskPanelState: TaskPanelState = {
    selectedWorkspaceId: null,
    expandedFolders: {},
    openFilePath: null,
    selectedFilePaths: new Set(),
};

// ================================================================
// Queue Task Conversation State
// ================================================================

/** Parsed conversation turns for the active queue task detail view */
export let queueTaskConversationTurns: ClientConversationTurn[] = [];

export function setQueueTaskConversationTurns(turns: ClientConversationTurn[]): void {
    queueTaskConversationTurns = turns;
}
