import { createContext, useContext, useEffect, useReducer, useRef, type Dispatch, type ReactNode } from 'react';

export const UNSEEN_STORAGE_PREFIX = 'coc-unseen-work-items-';

export interface WorkItemSummary {
    id: string;
    workItemNumber?: number;
    title: string;
    description?: string;
    status: string;
    type?: string;
    parentId?: string;
    priority?: string;
    source?: string;
    createdAt: string;
    updatedAt: string;
    lastRunAt?: string;
    pinnedAt?: string;
    archivedAt?: string;
    plan?: { version: number };
    tags?: string[];
}

export interface WorkItemPagination {
    total: number;
    hasMore: boolean;
    offset: number;
}

export interface WorkItemContextState {
    workItemsByRepo: Record<string, WorkItemSummary[]>;
    loading: Record<string, boolean>;
    selectedWorkItemId: string | null;
    unseenByRepo: Record<string, string[]>;
    /** Per-status pagination: repo → status → pagination state */
    paginationByRepo: Record<string, Record<string, WorkItemPagination>>;
}

export type WorkItemAction =
    | { type: 'SET_WORK_ITEMS'; repoId: string; items: WorkItemSummary[]; total: number; hasMore: boolean }
    | { type: 'APPEND_WORK_ITEMS'; repoId: string; items: WorkItemSummary[]; total: number; hasMore: boolean; offset: number }
    | { type: 'SET_GROUPED_WORK_ITEMS'; repoId: string; groups: Record<string, { items: WorkItemSummary[]; total: number; hasMore: boolean }> }
    | { type: 'APPEND_STATUS_ITEMS'; repoId: string; status: string; items: WorkItemSummary[]; total: number; hasMore: boolean; offset: number }
    | { type: 'SET_LOADING'; repoId: string; loading: boolean }
    | { type: 'SELECT_WORK_ITEM'; id: string | null }
    | { type: 'WORK_ITEM_ADDED'; repoId: string; item: WorkItemSummary }
    | { type: 'WORK_ITEM_UPDATED'; repoId: string; item: WorkItemSummary }
    | { type: 'WORK_ITEM_REMOVED'; repoId: string; id: string }
    | { type: 'LOAD_UNSEEN_WORK_ITEMS'; repoId: string; ids: string[] }
    | { type: 'MARK_WORK_ITEMS_SEEN'; repoId: string };

const initialState: WorkItemContextState = {
    workItemsByRepo: {},
    loading: {},
    selectedWorkItemId: null,
    unseenByRepo: {},
    paginationByRepo: {},
};

function addToUnseen(unseenByRepo: Record<string, string[]>, repoId: string, itemId: string): Record<string, string[]> {
    const current = unseenByRepo[repoId] || [];
    if (current.includes(itemId)) return unseenByRepo;
    return { ...unseenByRepo, [repoId]: [...current, itemId] };
}

function workItemReducer(state: WorkItemContextState, action: WorkItemAction): WorkItemContextState {
    switch (action.type) {
        case 'SET_WORK_ITEMS':
            return {
                ...state,
                workItemsByRepo: { ...state.workItemsByRepo, [action.repoId]: action.items },
                paginationByRepo: {
                    ...state.paginationByRepo,
                    [action.repoId]: { _flat: { total: action.total, hasMore: action.hasMore, offset: action.items.length } },
                },
            };
        case 'APPEND_WORK_ITEMS': {
            const existing = state.workItemsByRepo[action.repoId] || [];
            const existingIds = new Set(existing.map(i => i.id));
            const newItems = action.items.filter(i => !existingIds.has(i.id));
            return {
                ...state,
                workItemsByRepo: { ...state.workItemsByRepo, [action.repoId]: [...existing, ...newItems] },
                paginationByRepo: {
                    ...state.paginationByRepo,
                    [action.repoId]: {
                        ...(state.paginationByRepo[action.repoId] || {}),
                        _flat: { total: action.total, hasMore: action.hasMore, offset: action.offset + action.items.length },
                    },
                },
            };
        }
        case 'SET_GROUPED_WORK_ITEMS': {
            // Merge all group items into a flat list, replacing any previous items for this repo
            const allItems: WorkItemSummary[] = [];
            const pagination: Record<string, WorkItemPagination> = {};
            for (const [status, group] of Object.entries(action.groups)) {
                allItems.push(...group.items);
                pagination[status] = {
                    total: group.total,
                    hasMore: group.hasMore,
                    offset: group.items.length,
                };
            }
            return {
                ...state,
                workItemsByRepo: { ...state.workItemsByRepo, [action.repoId]: allItems },
                paginationByRepo: { ...state.paginationByRepo, [action.repoId]: pagination },
            };
        }
        case 'APPEND_STATUS_ITEMS': {
            const existing = state.workItemsByRepo[action.repoId] || [];
            const existingIds = new Set(existing.map(i => i.id));
            const newItems = action.items.filter(i => !existingIds.has(i.id));
            const repoPagination = state.paginationByRepo[action.repoId] || {};
            return {
                ...state,
                workItemsByRepo: { ...state.workItemsByRepo, [action.repoId]: [...existing, ...newItems] },
                paginationByRepo: {
                    ...state.paginationByRepo,
                    [action.repoId]: {
                        ...repoPagination,
                        [action.status]: {
                            total: action.total,
                            hasMore: action.hasMore,
                            offset: action.offset + action.items.length,
                        },
                    },
                },
            };
        }
        case 'SET_LOADING':
            return { ...state, loading: { ...state.loading, [action.repoId]: action.loading } };
        case 'SELECT_WORK_ITEM':
            return { ...state, selectedWorkItemId: action.id };
        case 'WORK_ITEM_ADDED': {
            const existing = state.workItemsByRepo[action.repoId] || [];
            return {
                ...state,
                workItemsByRepo: { ...state.workItemsByRepo, [action.repoId]: [...existing, action.item] },
                unseenByRepo: addToUnseen(state.unseenByRepo, action.repoId, action.item.id),
            };
        }
        case 'WORK_ITEM_UPDATED': {
            const items = state.workItemsByRepo[action.repoId] || [];
            const oldItem = items.find(i => i.id === action.item.id);
            const updatedItems = items.map(i => i.id === action.item.id ? action.item : i);
            const statusChanged = !!oldItem && oldItem.status !== action.item.status;
            return {
                ...state,
                workItemsByRepo: { ...state.workItemsByRepo, [action.repoId]: updatedItems },
                unseenByRepo: statusChanged ? addToUnseen(state.unseenByRepo, action.repoId, action.item.id) : state.unseenByRepo,
            };
        }
        case 'WORK_ITEM_REMOVED': {
            const filtered = (state.workItemsByRepo[action.repoId] || []).filter(i => i.id !== action.id);
            const unseen = (state.unseenByRepo[action.repoId] || []).filter(id => id !== action.id);
            return {
                ...state,
                workItemsByRepo: { ...state.workItemsByRepo, [action.repoId]: filtered },
                unseenByRepo: { ...state.unseenByRepo, [action.repoId]: unseen },
            };
        }
        case 'LOAD_UNSEEN_WORK_ITEMS': {
            const existingIds = new Set((state.workItemsByRepo[action.repoId] || []).map(i => i.id));
            const validIds = action.ids.filter(id => existingIds.has(id));
            return { ...state, unseenByRepo: { ...state.unseenByRepo, [action.repoId]: validIds } };
        }
        case 'MARK_WORK_ITEMS_SEEN':
            return { ...state, unseenByRepo: { ...state.unseenByRepo, [action.repoId]: [] } };
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

    // Persist unseen state to localStorage whenever it changes
    const prevUnseenRef = useRef(state.unseenByRepo);
    useEffect(() => {
        if (state.unseenByRepo === prevUnseenRef.current) return;
        prevUnseenRef.current = state.unseenByRepo;
        for (const [repoId, ids] of Object.entries(state.unseenByRepo)) {
            try {
                localStorage.setItem(UNSEEN_STORAGE_PREFIX + repoId, JSON.stringify(ids));
                window.dispatchEvent(new CustomEvent('coc-seen-updated'));
            } catch { /* quota or unavailable */ }
        }
    }, [state.unseenByRepo]);

    return <WorkItemContext.Provider value={{ state, dispatch }}>{children}</WorkItemContext.Provider>;
}

export function useWorkItems() {
    return useContext(WorkItemContext);
}

/** Load unseen work item IDs from localStorage for a workspace. */
export function loadUnseenWorkItemIds(workspaceId: string): string[] {
    try {
        const raw = localStorage.getItem(UNSEEN_STORAGE_PREFIX + workspaceId);
        return raw ? JSON.parse(raw) : [];
    } catch { return []; }
}
