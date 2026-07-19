/**
 * QueueContext — centralised state for the queue panel.
 * Replaces the global mutable queueState singleton from state.ts.
 */

import { createContext, useContext, useReducer, type ReactNode, type Dispatch } from 'react';
import type { SessionContextAttachmentDragPayload } from '../features/chat/sessionContextDrag';

// ── State ──────────────────────────────────────────────────────────────

export interface QueueStats {
    queued: number;
    running: number;
    total: number;
    isPaused: boolean;
    isDraining: boolean;
    pauseReason?: {
        taskId: string;
        displayName: string;
        failedAt: string;
    };
    /** Why the ALL queue is currently paused — present only when isPaused is true. */
    pauseSource?: 'manual' | 'quota';
    /** Why the autopilot queue is currently paused — present only when autopilot is paused. */
    autopilotPauseSource?: 'manual' | 'quota';
}

export interface QueueContextState {
    queued: any[];
    running: any[];
    history: any[];
    stats: QueueStats;
    repoQueueMap: Record<string, { queued: any[]; running: any[]; stats: QueueStats }>;
    /**
     * Per-workspace history cache so revisiting a repo can render the sidebar
     * instantly from the last known snapshot while the freshness fetch runs in
     * the background. Avoids a full loading spinner on every repo switch.
     */
    repoHistoryMap: Record<string, { items: any[]; hasMore: boolean; updatedAt: number }>;
    /** Per-workspace count of chats currently streaming (follow-up SSE). */
    streamingChatWorkspaces: Record<string, number>;
    showDialog: boolean;
    dialogInitialFolderPath: string | null;
    dialogInitialWorkspaceId: string | null;
    /** Pre-filled prompt text seeded into EnqueueDialog when it opens. */
    dialogInitialPrompt: string | null;
    /** Pointer/session context chips seeded into EnqueueDialog when it opens. */
    dialogAttachedContext: SessionContextAttachmentDragPayload[] | null;
    /** When 'ask', the dialog creates a read-only chat instead of a follow-prompt task.
     *  When 'resolve', the dialog submits via the resolve callback instead of the queue API. */
    dialogMode: 'task' | 'ask' | 'resolve';
    /** Controls post-submit behaviour: 'floating-chat' opens the result as an overlay; 'default' enqueues normally. */
    dialogLaunchMode: 'default' | 'floating-chat';
    /** Absolute paths to task files — injected into payload.context.files on submit. */
    dialogContextFiles: string[] | null;
    /** Display name for the context badge (e.g. task file name or folder name). */
    dialogContextTaskName: string | null;
    /** When true, EnqueueDialog submits one task per file in dialogContextFiles. */
    dialogBulkMode: boolean;
    /** Resolve-mode context: carries data needed to call the resolve/fix APIs instead of the queue. */
    dialogResolveContext: {
        /** Title for the dialog header. */
        title: string;
        /** Number of comments being resolved (displayed in info text). */
        commentCount: number;
        /** Callback invoked on submit instead of the queue API. Receives prompt text, skills, and selected model. */
        onSubmit: (context: string, skills: string[], model: string) => void;
    } | null;
    /** Whether the Prompt & Script dialog is shown. */
    showScriptDialog: boolean;
    /** Pre-selected workspace for the Prompt & Script dialog (null = use default first workspace). */
    scriptDialogWorkspaceId: string | null;
    showHistory: boolean;
    isFollowUpStreaming: boolean;
    currentStreamingTurnIndex: number | null;
    draining: boolean;
    drainQueued: number;
    drainRunning: number;
    selectedTaskId: string | null;
    /** Per-repo task selection to prevent cross-repo contamination. */
    selectedTaskIdByRepo: Record<string, string | null>;
    /** Incremented each time the user clicks an already-selected task to force a refresh. */
    refreshVersion: number;
    queueInitialized: boolean;
    /** True while EnqueueDialog is submitting a new task. */
    isTaskSubmitting: boolean;
}

function createEmptyQueueStats(): QueueStats {
    return {
        queued: 0,
        running: 0,
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
    repoHistoryMap: {},
    streamingChatWorkspaces: {},
    showDialog: false,
    dialogInitialFolderPath: null,
    dialogInitialWorkspaceId: null,
    dialogInitialPrompt: null,
    dialogAttachedContext: null,
    dialogMode: 'task',
    dialogLaunchMode: 'default',
    dialogContextFiles: null,
    dialogContextTaskName: null,
    dialogBulkMode: false,
    dialogResolveContext: null,
    showScriptDialog: false,
    scriptDialogWorkspaceId: null,
    showHistory: false,
    isFollowUpStreaming: false,
    currentStreamingTurnIndex: null,
    draining: false,
    drainQueued: 0,
    drainRunning: 0,
    selectedTaskId: null,
    selectedTaskIdByRepo: {},
    refreshVersion: 0,
    queueInitialized: false,
    isTaskSubmitting: false,
};

// ── Actions ────────────────────────────────────────────────────────────

export type QueueAction =
    | { type: 'QUEUE_UPDATED'; queue: { queued: any[]; running: any[]; stats: any } }
    | { type: 'REPO_QUEUE_UPDATED'; repoId: string; queue: { queued?: any[]; running?: any[]; stats?: any } }
    | { type: 'REPO_QUEUE_STATS_UPDATED'; repoId: string; stats: Partial<QueueStats> }
    | { type: 'REPO_HISTORY_UPDATED'; repoId: string; items: any[]; hasMore: boolean }
    | { type: 'SET_HISTORY'; history: any[] }
    | { type: 'DRAIN_START'; queued: number; running: number }
    | { type: 'DRAIN_PROGRESS'; queued: number; running: number }
    | { type: 'DRAIN_COMPLETE' }
    | { type: 'DRAIN_TIMEOUT' }
    | { type: 'TOGGLE_DIALOG' }
    | { type: 'OPEN_DIALOG'; folderPath?: string | null; workspaceId?: string | null; mode?: 'task' | 'ask' | 'resolve'; initialPrompt?: string | null; attachedContext?: SessionContextAttachmentDragPayload[] | null; launchMode?: 'default' | 'floating-chat'; contextFiles?: string[] | null; contextTaskName?: string | null; bulkMode?: boolean; resolveContext?: QueueContextState['dialogResolveContext'] }
    | { type: 'CLOSE_DIALOG' }
    | { type: 'TOGGLE_HISTORY' }
    | { type: 'SET_FOLLOW_UP_STREAMING'; value: boolean; turnIndex: number | null }
    | { type: 'SELECT_QUEUE_TASK'; id: string | null; repoId?: string }
    | { type: 'REFRESH_SELECTED_QUEUE_TASK' }
    | { type: 'CHAT_STREAMING_STARTED'; workspaceId: string }
    | { type: 'CHAT_STREAMING_STOPPED'; workspaceId: string }
    | { type: 'SET_DIALOG_MODE'; mode: 'task' | 'ask' | 'resolve' }
    | { type: 'OPEN_SCRIPT_DIALOG'; workspaceId?: string | null }
    | { type: 'CLOSE_SCRIPT_DIALOG' }
    | { type: 'SET_TASK_SUBMITTING'; value: boolean };

// ── Reducer ────────────────────────────────────────────────────────────

export function queueReducer(state: QueueContextState, action: QueueAction): QueueContextState {
    switch (action.type) {
        case 'QUEUE_UPDATED': {
            const activeIds = new Set([
                ...(action.queue.running || []).map((t: any) => t.id),
                ...(action.queue.queued || []).map((t: any) => t.id),
            ]);
            return {
                ...state,
                queued: action.queue.queued || [],
                running: action.queue.running || [],
                stats: action.queue.stats || state.stats,
                history: state.history.filter((t: any) => !activeIds.has(t.id)),
                queueInitialized: true,
            };
        }
        case 'REPO_QUEUE_UPDATED': {
            const existingRepo = state.repoQueueMap[action.repoId];
            const repoData = {
                queued: action.queue.queued ?? existingRepo?.queued ?? [],
                running: action.queue.running ?? existingRepo?.running ?? [],
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
                stats: mergeQueueStats(action.stats, existingRepo?.stats),
            };
            return {
                ...state,
                repoQueueMap: { ...state.repoQueueMap, [action.repoId]: repoData },
            };
        }
        case 'REPO_HISTORY_UPDATED': {
            return {
                ...state,
                repoHistoryMap: {
                    ...state.repoHistoryMap,
                    [action.repoId]: {
                        items: action.items,
                        hasMore: action.hasMore,
                        updatedAt: Date.now(),
                    },
                },
            };
        }
        case 'SET_HISTORY':
            return { ...state, history: action.history, showHistory: action.history.length > 0 ? true : state.showHistory };
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
            return { ...state, showDialog: true, dialogInitialFolderPath: action.folderPath ?? null, dialogInitialWorkspaceId: action.workspaceId ?? null, dialogInitialPrompt: action.initialPrompt ?? null, dialogAttachedContext: action.attachedContext ?? null, dialogMode: action.mode ?? 'task', dialogLaunchMode: action.launchMode ?? 'default', dialogContextFiles: action.contextFiles ?? null, dialogContextTaskName: action.contextTaskName ?? null, dialogBulkMode: action.bulkMode ?? false, dialogResolveContext: action.resolveContext ?? null };
        case 'CLOSE_DIALOG':
            return { ...state, showDialog: false, dialogInitialFolderPath: null, dialogInitialWorkspaceId: null, dialogInitialPrompt: null, dialogAttachedContext: null, dialogMode: 'task', dialogLaunchMode: 'default', dialogContextFiles: null, dialogContextTaskName: null, dialogBulkMode: false, dialogResolveContext: null };
        case 'TOGGLE_HISTORY':
            return { ...state, showHistory: !state.showHistory };
        case 'SET_FOLLOW_UP_STREAMING':
            return { ...state, isFollowUpStreaming: action.value, currentStreamingTurnIndex: action.turnIndex };
        case 'SELECT_QUEUE_TASK': {
            const next: Partial<QueueContextState> = { selectedTaskId: action.id };
            if (action.repoId) {
                next.selectedTaskIdByRepo = { ...state.selectedTaskIdByRepo, [action.repoId]: action.id };
            }
            return { ...state, ...next };
        }
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
        case 'SET_DIALOG_MODE':
            return { ...state, dialogMode: action.mode };
        case 'OPEN_SCRIPT_DIALOG':
            return { ...state, showScriptDialog: true, scriptDialogWorkspaceId: action.workspaceId ?? null };
        case 'CLOSE_SCRIPT_DIALOG':
            return { ...state, showScriptDialog: false, scriptDialogWorkspaceId: null };
        case 'SET_TASK_SUBMITTING':
            return { ...state, isTaskSubmitting: action.value };
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
