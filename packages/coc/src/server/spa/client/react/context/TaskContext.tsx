/**
 * TaskContext — centralised state for the Tasks panel.
 * Manages open file path, selected files, context file visibility, and task-change signals.
 */

import { createContext, useContext, useReducer, type ReactNode, type Dispatch } from 'react';

// ── State ──────────────────────────────────────────────────────────────

export interface TaskContextState {
    openFilePath: string | null;
    selectedFilePaths: Set<string>;
    showContextFiles: boolean;
    lastTasksChangedWsId: string | null;
    tasksChangedAt: number;
}

const initialState: TaskContextState = {
    openFilePath: null,
    selectedFilePaths: new Set(),
    showContextFiles: true,
    lastTasksChangedWsId: null,
    tasksChangedAt: 0,
};

// ── Actions ────────────────────────────────────────────────────────────

export type TaskAction =
    | { type: 'SET_OPEN_FILE_PATH'; path: string | null }
    | { type: 'TOGGLE_SELECTED_FILE'; path: string }
    | { type: 'CLEAR_SELECTION' }
    | { type: 'TOGGLE_SHOW_CONTEXT_FILES' }
    | { type: 'WORKSPACE_TASKS_CHANGED'; wsId: string };

// ── Reducer ────────────────────────────────────────────────────────────

export function taskReducer(state: TaskContextState, action: TaskAction): TaskContextState {
    switch (action.type) {
        case 'SET_OPEN_FILE_PATH':
            return { ...state, openFilePath: action.path };
        case 'TOGGLE_SELECTED_FILE': {
            const next = new Set(state.selectedFilePaths);
            if (next.has(action.path)) {
                next.delete(action.path);
            } else {
                next.add(action.path);
            }
            return { ...state, selectedFilePaths: next };
        }
        case 'CLEAR_SELECTION':
            return { ...state, selectedFilePaths: new Set() };
        case 'TOGGLE_SHOW_CONTEXT_FILES':
            return { ...state, showContextFiles: !state.showContextFiles };
        case 'WORKSPACE_TASKS_CHANGED':
            return { ...state, lastTasksChangedWsId: action.wsId, tasksChangedAt: Date.now() };
        default:
            return state;
    }
}

// ── Context ────────────────────────────────────────────────────────────

const TaskContext = createContext<{ state: TaskContextState; dispatch: Dispatch<TaskAction> } | null>(null);

export function TaskProvider({ children }: { children: ReactNode }) {
    const [state, dispatch] = useReducer(taskReducer, initialState);
    return <TaskContext.Provider value={{ state, dispatch }}>{children}</TaskContext.Provider>;
}

export function useTaskContext() {
    const ctx = useContext(TaskContext);
    if (!ctx) throw new Error('useTaskContext must be used within TaskProvider');
    return ctx;
}

/**
 * Convenience hook for task panel UI state.
 */
export function useTaskPanel() {
    const { state, dispatch } = useTaskContext();
    return {
        openFilePath: state.openFilePath,
        setOpenFilePath: (p: string | null) => dispatch({ type: 'SET_OPEN_FILE_PATH', path: p }),
        selectedFilePaths: state.selectedFilePaths,
        toggleSelectedFile: (p: string) => dispatch({ type: 'TOGGLE_SELECTED_FILE', path: p }),
        clearSelection: () => dispatch({ type: 'CLEAR_SELECTION' }),
        showContextFiles: state.showContextFiles,
        toggleShowContextFiles: () => dispatch({ type: 'TOGGLE_SHOW_CONTEXT_FILES' }),
    };
}
