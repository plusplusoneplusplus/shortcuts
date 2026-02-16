/**
 * Shared mutable state — extracted from core.ts and queue.ts
 * to break circular dependency chains between modules.
 */

export type DashboardTab = 'processes' | 'repos' | 'wiki' | 'reports';
export type RepoSubTab = 'info' | 'pipelines' | 'tasks';

export type ProcessViewMode = 'active' | 'history';

/** Lightweight conversation turn for the SPA client (timestamps are strings) */
export interface ClientConversationTurn {
    role: 'user' | 'assistant';
    content: string;
    timestamp?: string;
    turnIndex?: number;
    streaming?: boolean;
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
    typeFilter: string;
    searchQuery: string;
    expandedGroups: Record<string, boolean>;
    liveTimers: Record<string, ReturnType<typeof setInterval>>;
    activeTab: DashboardTab;
    workspaces: any[];
    selectedRepoId: string | null;
    activeRepoSubTab: RepoSubTab;
    selectedWikiId: string | null;
    selectedWikiComponentId: string | null;
    /** Active/History view mode for the processes sidebar. */
    viewMode: ProcessViewMode;
    /** History processes loaded separately (lightweight, no conversation data). */
    historyProcesses: any[];
    /** Total count of history processes (for pagination). */
    historyTotal: number;
    /** Client-side cache of loaded conversations (processId → turns). */
    conversationCache: Record<string, ConversationCacheEntry>;
    /** Whether history data has been loaded at least once. */
    historyLoaded: boolean;
}

export const appState: AppState = {
    processes: [],
    selectedId: null,
    workspace: '__all',
    statusFilter: '__all',
    typeFilter: '__all',
    searchQuery: '',
    expandedGroups: {},
    liveTimers: {},
    activeTab: 'processes',
    workspaces: [],
    selectedRepoId: null,
    activeRepoSubTab: 'info',
    selectedWikiId: null,
    selectedWikiComponentId: null,
    viewMode: 'active',
    historyProcesses: [],
    historyTotal: 0,
    conversationCache: {},
    historyLoaded: false,
};

export interface QueueState {
    queued: any[];
    running: any[];
    history: any[];
    stats: {
        queued: number; running: number; completed: number;
        failed: number; cancelled: number; total: number; isPaused: boolean;
    };
    showDialog: boolean;
    showHistory: boolean;
    isFollowUpStreaming: boolean;
    currentStreamingTurnIndex: number | null;
}

export const queueState: QueueState = {
    queued: [],
    running: [],
    history: [],
    stats: { queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0, total: 0, isPaused: false },
    showDialog: false,
    showHistory: false,
    isFollowUpStreaming: false,
    currentStreamingTurnIndex: null,
};

(window as any).appState = appState;

// ================================================================
// Tasks panel state
// ================================================================

export interface TaskPanelState {
    selectedWorkspaceId: string | null;
    expandedFolders: Record<string, boolean>;
    openFilePath: string | null;
}

export const taskPanelState: TaskPanelState = {
    selectedWorkspaceId: null,
    expandedFolders: {},
    openFilePath: null,
};

// ================================================================
// Queue Task Conversation State
// ================================================================

/** Parsed conversation turns for the active queue task detail view */
export let queueTaskConversationTurns: ClientConversationTurn[] = [];

export function setQueueTaskConversationTurns(turns: ClientConversationTurn[]): void {
    queueTaskConversationTurns = turns;
}
