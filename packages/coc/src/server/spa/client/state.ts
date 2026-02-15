/**
 * Shared mutable state — extracted from core.ts and queue.ts
 * to break circular dependency chains between modules.
 */

export type DashboardTab = 'processes' | 'repos' | 'reports';
export type RepoSubTab = 'info' | 'pipelines' | 'tasks';

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
