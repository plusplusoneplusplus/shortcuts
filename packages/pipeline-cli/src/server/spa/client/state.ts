/**
 * Shared mutable state — extracted from core.ts and queue.ts
 * to break circular dependency chains between modules.
 */

export interface AppState {
    processes: any[];
    selectedId: string | null;
    workspace: string;
    statusFilter: string;
    typeFilter: string;
    searchQuery: string;
    expandedGroups: Record<string, boolean>;
    liveTimers: Record<string, ReturnType<typeof setInterval>>;
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
}

export const queueState: QueueState = {
    queued: [],
    running: [],
    history: [],
    stats: { queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0, total: 0, isPaused: false },
    showDialog: false,
    showHistory: false,
};

(window as any).appState = appState;
