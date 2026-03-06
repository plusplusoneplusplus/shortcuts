/**
 * QueueContext — centralised state for the queue panel.
 * Replaces the global mutable queueState singleton from state.ts.
 */

import { createContext, useContext, useReducer, type ReactNode, type Dispatch } from 'react';

// ── State ──────────────────────────────────────────────────────────────

export interface QueueStats {
    queued: number;
    running: number;
    completed: number;
    failed: number;
    cancelled: number;
    total: number;
    isPaused: boolean;
    isDraining: boolean;
}

export interface QueueContextState {
    queued: any[];
    running: any[];
    history: any[];
    stats: QueueStats;
    repoQueueMap: Record<string, { queued: any[]; running: any[]; history: any[]; stats: QueueStats }>;
    /** Per-workspace count of chats currently streaming (follow-up SSE). */
    streamingChatWorkspaces: Record<string, number>;
    showDialog: boolean;
    dialogInitialFolderPath: string | null;
    dialogInitialWorkspaceId: string | null;
    showHistory: boolean;
    isFollowUpStreaming: boolean;
    currentStreamingTurnIndex: number | null;
    draining: boolean;
    drainQueued: number;
    drainRunning: number;
    selectedTaskId: string | null;
    /** Incremented each time the user clicks an already-selected task to force a refresh. */
    refreshVersion: number;
    queueInitialized: boolean;
}

function createEmptyQueueStats(): QueueStats {
    return {
        queued: 0,
        running: 0,
        completed: 0,
        failed: 0,
        cancelled: 0,
        total: 0,
        isPaused: false,
        isDraining: false,
    };
}

function mergeQueueStats(stats: any, fallback?: QueueStats): QueueStats {
    return {
        ...createEmptyQueueStats(),
        ...(fallback || {}),
        ...(stats || {}),
    };
}

const initialState: QueueContextState = {
    queued: [],
    running: [],
    history: [],
    stats: createEmptyQueueStats(),
    repoQueueMap: {},
    streamingChatWorkspaces: {},
    showDialog: false,
    dialogInitialFolderPath: null,
    dialogInitialWorkspaceId: null,
    showHistory: false,
    isFollowUpStreaming: false,
    currentStreamingTurnIndex: null,
    draining: false,
    drainQueued: 0,
    drainRunning: 0,
    selectedTaskId: null,
    refreshVersion: 0,
    queueInitialized: false,
};

// ── Actions ────────────────────────────────────────────────────────────

export type QueueAction =
    | { type: 'QUEUE_UPDATED'; queue: { queued: any[]; running: any[]; history?: any[]; stats: any } }
    | { type: 'REPO_QUEUE_UPDATED'; repoId: string; queue: { queued?: any[]; running?: any[]; history?: any[]; stats?: any } }
    | { type: 'REPO_QUEUE_STATS_UPDATED'; repoId: string; stats: Partial<QueueStats> }
    | { type: 'SEED_QUEUE'; queue: { queued: any[]; running: any[]; stats?: any } }
    | { type: 'SET_HISTORY'; history: any[] }
    | { type: 'DRAIN_START'; queued: number; running: number }
    | { type: 'DRAIN_PROGRESS'; queued: number; running: number }
    | { type: 'DRAIN_COMPLETE' }
    | { type: 'DRAIN_TIMEOUT' }
    | { type: 'TOGGLE_DIALOG' }
    | { type: 'OPEN_DIALOG'; folderPath?: string | null; workspaceId?: string | null }
    | { type: 'CLOSE_DIALOG' }
    | { type: 'TOGGLE_HISTORY' }
    | { type: 'SET_FOLLOW_UP_STREAMING'; value: boolean; turnIndex: number | null }
    | { type: 'SELECT_QUEUE_TASK'; id: string | null }
    | { type: 'REFRESH_SELECTED_QUEUE_TASK' }
    | { type: 'CHAT_STREAMING_STARTED'; workspaceId: string }
    | { type: 'CHAT_STREAMING_STOPPED'; workspaceId: string };

// ── Reducer ────────────────────────────────────────────────────────────

export function queueReducer(state: QueueContextState, action: QueueAction): QueueContextState {
    switch (action.type) {
        case 'QUEUE_UPDATED': {
            const prevCompleted = state.stats.completed || 0;
            const prevFailed = state.stats.failed || 0;
            const newStats = action.queue.stats || state.stats;
            const newCompleted = newStats.completed || 0;
            const newFailed = newStats.failed || 0;
            const autoShowHistory = (newCompleted > prevCompleted || newFailed > prevFailed)
                ? true : state.showHistory;
            return {
                ...state,
                queued: action.queue.queued || [],
                running: action.queue.running || [],
                history: action.queue.history ?? state.history,
                stats: newStats,
                showHistory: autoShowHistory,
                queueInitialized: true,
            };
        }
        case 'REPO_QUEUE_UPDATED': {
            const existingRepo = state.repoQueueMap[action.repoId];
            const repoData = {
                queued: action.queue.queued ?? existingRepo?.queued ?? [],
                running: action.queue.running ?? existingRepo?.running ?? [],
                history: action.queue.history ?? existingRepo?.history ?? [],
                stats: mergeQueueStats(action.queue.stats, existingRepo?.stats),
            };
            return {
                ...state,
                repoQueueMap: { ...state.repoQueueMap, [action.repoId]: repoData },
            };
        }
        case 'REPO_QUEUE_STATS_UPDATED': {
            const existingRepo = state.repoQueueMap[action.repoId];
            const repoData = {
                queued: existingRepo?.queued ?? [],
                running: existingRepo?.running ?? [],
                history: existingRepo?.history ?? [],
                stats: mergeQueueStats(action.stats, existingRepo?.stats),
            };
            return {
                ...state,
                repoQueueMap: { ...state.repoQueueMap, [action.repoId]: repoData },
            };
        }
        case 'SEED_QUEUE': {
            if (state.queueInitialized) return state;
            return {
                ...state,
                queued: action.queue.queued || [],
                running: action.queue.running || [],
                stats: action.queue.stats
                    ? { ...state.stats, ...action.queue.stats }
                    : state.stats,
            };
        }
        case 'SET_HISTORY':
            return { ...state, history: action.history };
        case 'DRAIN_START':
            return { ...state, draining: true, drainQueued: action.queued, drainRunning: action.running };
        case 'DRAIN_PROGRESS':
            return { ...state, drainQueued: action.queued, drainRunning: action.running };
        case 'DRAIN_COMPLETE':
        case 'DRAIN_TIMEOUT':
            return { ...state, draining: false, drainQueued: 0, drainRunning: 0 };
        case 'TOGGLE_DIALOG':
            return { ...state, showDialog: !state.showDialog };
        case 'OPEN_DIALOG':
            return { ...state, showDialog: true, dialogInitialFolderPath: action.folderPath ?? null, dialogInitialWorkspaceId: action.workspaceId ?? null };
        case 'CLOSE_DIALOG':
            return { ...state, showDialog: false, dialogInitialFolderPath: null, dialogInitialWorkspaceId: null };
        case 'TOGGLE_HISTORY':
            return { ...state, showHistory: !state.showHistory };
        case 'SET_FOLLOW_UP_STREAMING':
            return { ...state, isFollowUpStreaming: action.value, currentStreamingTurnIndex: action.turnIndex };
        case 'SELECT_QUEUE_TASK':
            return { ...state, selectedTaskId: action.id };
        case 'REFRESH_SELECTED_QUEUE_TASK':
            return { ...state, refreshVersion: state.refreshVersion + 1 };
        case 'CHAT_STREAMING_STARTED': {
            const prev = state.streamingChatWorkspaces[action.workspaceId] || 0;
            return {
                ...state,
                streamingChatWorkspaces: { ...state.streamingChatWorkspaces, [action.workspaceId]: prev + 1 },
            };
        }
        case 'CHAT_STREAMING_STOPPED': {
            const prev = state.streamingChatWorkspaces[action.workspaceId] || 0;
            const next = Math.max(0, prev - 1);
            const updated = { ...state.streamingChatWorkspaces };
            if (next === 0) delete updated[action.workspaceId];
            else updated[action.workspaceId] = next;
            return { ...state, streamingChatWorkspaces: updated };
        }
        default:
            return state;
    }
}

// ── Context ────────────────────────────────────────────────────────────

const QueueContext = createContext<{ state: QueueContextState; dispatch: Dispatch<QueueAction> } | null>(null);

export function QueueProvider({ children }: { children: ReactNode }) {
    const [state, dispatch] = useReducer(queueReducer, initialState);
    return <QueueContext.Provider value={{ state, dispatch }}>{children}</QueueContext.Provider>;
}

export function useQueue() {
    const ctx = useContext(QueueContext);
    if (!ctx) throw new Error('useQueue must be used within QueueProvider');
    return ctx;
}
