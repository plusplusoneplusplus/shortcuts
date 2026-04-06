import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from 'react';

export interface WorkItemSummary {
    id: string;
    title: string;
    status: string;
    type?: string;
    priority?: string;
    source: string;
    createdAt: string;
    updatedAt: string;
    lastRunAt?: string;
    plan?: { version: number };
    tags?: string[];
}

export interface WorkItemContextState {
    workItemsByRepo: Record<string, WorkItemSummary[]>;
    loading: Record<string, boolean>;
    selectedWorkItemId: string | null;
}

export type WorkItemAction =
    | { type: 'SET_WORK_ITEMS'; repoId: string; items: WorkItemSummary[] }
    | { type: 'SET_LOADING'; repoId: string; loading: boolean }
    | { type: 'SELECT_WORK_ITEM'; id: string | null }
    | { type: 'WORK_ITEM_ADDED'; repoId: string; item: WorkItemSummary }
    | { type: 'WORK_ITEM_UPDATED'; repoId: string; item: WorkItemSummary }
    | { type: 'WORK_ITEM_REMOVED'; repoId: string; id: string };

const initialState: WorkItemContextState = {
    workItemsByRepo: {},
    loading: {},
    selectedWorkItemId: null,
};

function workItemReducer(state: WorkItemContextState, action: WorkItemAction): WorkItemContextState {
    switch (action.type) {
        case 'SET_WORK_ITEMS':
            return { ...state, workItemsByRepo: { ...state.workItemsByRepo, [action.repoId]: action.items } };
        case 'SET_LOADING':
            return { ...state, loading: { ...state.loading, [action.repoId]: action.loading } };
        case 'SELECT_WORK_ITEM':
            return { ...state, selectedWorkItemId: action.id };
        case 'WORK_ITEM_ADDED': {
            const existing = state.workItemsByRepo[action.repoId] || [];
            return { ...state, workItemsByRepo: { ...state.workItemsByRepo, [action.repoId]: [...existing, action.item] } };
        }
        case 'WORK_ITEM_UPDATED': {
            const items = (state.workItemsByRepo[action.repoId] || []).map(i => i.id === action.item.id ? action.item : i);
            return { ...state, workItemsByRepo: { ...state.workItemsByRepo, [action.repoId]: items } };
        }
        case 'WORK_ITEM_REMOVED': {
            const items = (state.workItemsByRepo[action.repoId] || []).filter(i => i.id !== action.id);
            return { ...state, workItemsByRepo: { ...state.workItemsByRepo, [action.repoId]: items } };
        }
        default:
            return state;
    }
}

const WorkItemContext = createContext<{ state: WorkItemContextState; dispatch: Dispatch<WorkItemAction> }>({
    state: initialState,
    dispatch: () => {},
});

export function WorkItemProvider({ children }: { children: ReactNode }) {
    const [state, dispatch] = useReducer(workItemReducer, initialState);
    return <WorkItemContext.Provider value={{ state, dispatch }}>{children}</WorkItemContext.Provider>;
}

export function useWorkItems() {
    return useContext(WorkItemContext);
}
