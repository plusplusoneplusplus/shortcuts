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
    showDialog: boolean;
    dialogInitialFolderPath: string | null;
    showHistory: boolean;
    isFollowUpStreaming: boolean;
    currentStreamingTurnIndex: number | null;
    draining: boolean;
    drainQueued: number;
    drainRunning: number;
    selectedTaskId: string | null;
    queueInitialized: boolean;
}

const initialState: QueueContextState = {
    queued: [],
    running: [],
    history: [],
    stats: { queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0, total: 0, isPaused: false, isDraining: false },
    showDialog: false,
    dialogInitialFolderPath: null,
    showHistory: false,
    isFollowUpStreaming: false,
    currentStreamingTurnIndex: null,
    draining: false,
    drainQueued: 0,
    drainRunning: 0,
    selectedTaskId: null,
    queueInitialized: false,
};

// ── Actions ────────────────────────────────────────────────────────────

export type QueueAction =
    | { type: 'QUEUE_UPDATED'; queue: { queued: any[]; running: any[]; history?: any[]; stats: any } }
    | { type: 'SEED_QUEUE'; queue: { queued: any[]; running: any[]; stats?: any } }
    | { type: 'SET_HISTORY'; history: any[] }
    | { type: 'DRAIN_START'; queued: number; running: number }
    | { type: 'DRAIN_PROGRESS'; queued: number; running: number }
    | { type: 'DRAIN_COMPLETE' }
    | { type: 'DRAIN_TIMEOUT' }
    | { type: 'TOGGLE_DIALOG' }
    | { type: 'OPEN_DIALOG'; folderPath?: string | null }
    | { type: 'CLOSE_DIALOG' }
    | { type: 'TOGGLE_HISTORY' }
    | { type: 'SET_FOLLOW_UP_STREAMING'; value: boolean; turnIndex: number | null }
    | { type: 'SELECT_QUEUE_TASK'; id: string | null };

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
            return { ...state, showDialog: true, dialogInitialFolderPath: action.folderPath ?? null };
        case 'CLOSE_DIALOG':
            return { ...state, showDialog: false, dialogInitialFolderPath: null };
        case 'TOGGLE_HISTORY':
            return { ...state, showHistory: !state.showHistory };
        case 'SET_FOLLOW_UP_STREAMING':
            return { ...state, isFollowUpStreaming: action.value, currentStreamingTurnIndex: action.turnIndex };
        case 'SELECT_QUEUE_TASK':
            return { ...state, selectedTaskId: action.id };
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
