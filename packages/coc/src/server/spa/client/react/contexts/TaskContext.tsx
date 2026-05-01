/**
 * TaskContext — centralised state for the Tasks panel.
 * Manages open file path, selected files, context file visibility, and task-change signals.
 */

import { createContext, useContext, useEffect, useReducer, useRef, type ReactNode, type Dispatch } from 'react';
import type { TasksPanelNavState } from '../types/dashboard';

// ── State ──────────────────────────────────────────────────────────────

export interface TaskContextState {
    openFilePath: string | null;
    /** Absolute task-root path for the currently open file (multi-root safe). */
    openFileTaskRootPath: string | null;
    selectedFilePaths: Set<string>;
    showContextFiles: boolean;
    lastTasksChangedWsId: string | null;
    tasksChangedAt: number;
    selectedFolderPath: string | null;
}

const initialState: TaskContextState = {
    openFilePath: null,
    openFileTaskRootPath: null,
    selectedFilePaths: new Set(),
    showContextFiles: true,
    lastTasksChangedWsId: null,
    tasksChangedAt: 0,
    selectedFolderPath: null,
};

// ── Actions ────────────────────────────────────────────────────────────

export type TaskAction =
    | { type: 'SET_OPEN_FILE_PATH'; path: string | null; taskRootPath?: string | null }
    | { type: 'TOGGLE_SELECTED_FILE'; path: string }
    | { type: 'SET_SELECTED_FILES'; paths: Set<string> }
    | { type: 'CLEAR_SELECTION' }
    | { type: 'TOGGLE_SHOW_CONTEXT_FILES' }
    | { type: 'WORKSPACE_TASKS_CHANGED'; wsId: string }
    | { type: 'SET_SELECTED_FOLDER_PATH'; path: string | null };

// ── Reducer ────────────────────────────────────────────────────────────

export function taskReducer(state: TaskContextState, action: TaskAction): TaskContextState {
    switch (action.type) {
        case 'SET_OPEN_FILE_PATH':
            return { ...state, openFilePath: action.path, openFileTaskRootPath: action.taskRootPath ?? null };
        case 'TOGGLE_SELECTED_FILE': {
            const next = new Set(state.selectedFilePaths);
            if (next.has(action.path)) {
                next.delete(action.path);
            } else {
                next.add(action.path);
            }
            return { ...state, selectedFilePaths: next };
        }
        case 'SET_SELECTED_FILES':
            return { ...state, selectedFilePaths: new Set(action.paths) };
        case 'CLEAR_SELECTION':
            return { ...state, selectedFilePaths: new Set() };
        case 'TOGGLE_SHOW_CONTEXT_FILES':
            return { ...state, showContextFiles: !state.showContextFiles };
        case 'WORKSPACE_TASKS_CHANGED':
            return { ...state, lastTasksChangedWsId: action.wsId, tasksChangedAt: Date.now() };
        case 'SET_SELECTED_FOLDER_PATH':
            return { ...state, selectedFolderPath: action.path };
        default:
            return state;
    }
}

// ── Context ────────────────────────────────────────────────────────────

const TaskContext = createContext<{ state: TaskContextState; dispatch: Dispatch<TaskAction> } | null>(null);

export function TaskProvider({ children, initialNavState, onNavStateChange }: {
    children: ReactNode;
    initialNavState?: TasksPanelNavState;
    onNavStateChange?: (navState: TasksPanelNavState) => void;
}) {
    const [state, dispatch] = useReducer(taskReducer, {
        ...initialState,
        openFilePath: initialNavState?.openFilePath ?? null,
        selectedFilePaths: new Set(initialNavState?.selectedFilePaths ?? []),
        selectedFolderPath: initialNavState?.selectedFolderPath ?? null,
    });

    // Sync navigation state back to caller, skipping the initial mount.
    const onNavStateChangeRef = useRef(onNavStateChange);
    onNavStateChangeRef.current = onNavStateChange;
    const isFirstMount = useRef(true);
    useEffect(() => {
        if (isFirstMount.current) { isFirstMount.current = false; return; }
        onNavStateChangeRef.current?.({
            openFilePath: state.openFilePath,
            selectedFilePaths: Array.from(state.selectedFilePaths),
            selectedFolderPath: state.selectedFolderPath,
            activeFolderPath: initialNavState?.activeFolderPath ?? null,
        });
    }, [state.openFilePath, state.selectedFilePaths, state.selectedFolderPath, initialNavState?.activeFolderPath]);

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
        openFileTaskRootPath: state.openFileTaskRootPath,
        setOpenFilePath: (p: string | null, taskRootPath?: string | null) => dispatch({ type: 'SET_OPEN_FILE_PATH', path: p, taskRootPath }),
        selectedFilePaths: state.selectedFilePaths,
        toggleSelectedFile: (p: string) => dispatch({ type: 'TOGGLE_SELECTED_FILE', path: p }),
        setSelectedFiles: (paths: Set<string>) => dispatch({ type: 'SET_SELECTED_FILES', paths }),
        clearSelection: () => dispatch({ type: 'CLEAR_SELECTION' }),
        showContextFiles: state.showContextFiles,
        toggleShowContextFiles: () => dispatch({ type: 'TOGGLE_SHOW_CONTEXT_FILES' }),
        selectedFolderPath: state.selectedFolderPath,
        setSelectedFolderPath: (p: string | null) => dispatch({ type: 'SET_SELECTED_FOLDER_PATH', path: p }),
    };
}
