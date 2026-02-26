/**
 * ProcessFilters — search, status filter, workspace filter.
 * Replaces filters.ts event handlers.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { fetchApi } from '../hooks/useApi';

export function ProcessFilters() {
    const { state, dispatch } = useApp();
    const [searchInput, setSearchInput] = useState(state.searchQuery);
    const debounceRef = useRef<ReturnType<typeof setTimeout>>();

    // Debounced search dispatch
    const onSearchChange = useCallback((value: string) => {
        setSearchInput(value);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            dispatch({ type: 'SET_SEARCH_QUERY', value });
        }, 200);
    }, [dispatch]);

    useEffect(() => {
        return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    }, []);

    const onStatusChange = useCallback((value: string) => {
        dispatch({ type: 'SET_STATUS_FILTER', value });
    }, [dispatch]);

    const onWorkspaceChange = useCallback(async (workspaceId: string) => {
        dispatch({ type: 'SET_WORKSPACE_FILTER', value: workspaceId });
        const path = workspaceId === '__all' ? '/processes' : '/processes?workspace=' + encodeURIComponent(workspaceId);
        try {
            const data = await fetchApi(path);
            if (data?.processes && Array.isArray(data.processes)) {
                dispatch({ type: 'SET_PROCESSES', processes: data.processes });
            } else if (Array.isArray(data)) {
                dispatch({ type: 'SET_PROCESSES', processes: data });
            }
            dispatch({ type: 'SELECT_PROCESS', id: null });
        } catch { /* ignore */ }
    }, [dispatch]);

    return (
        <div className="filter-bar p-2 flex flex-col gap-2">
            <input
                id="search-input"
                type="text"
                placeholder="Search processes..."
                value={searchInput}
                onChange={e => onSearchChange(e.target.value)}
                className="w-full px-2 py-1.5 text-sm rounded border border-[#e0e0e0] bg-white dark:border-[#3c3c3c] dark:bg-[#3c3c3c] dark:text-[#cccccc] focus:outline-none focus:border-[#0078d4]"
            />
            <select
                id="status-filter"
                value={state.statusFilter}
                onChange={e => onStatusChange(e.target.value)}
                className="w-full px-2 py-1.5 text-sm rounded border border-[#e0e0e0] bg-white dark:border-[#3c3c3c] dark:bg-[#3c3c3c] dark:text-[#cccccc]"
            >
                <option value="__all">All Statuses</option>
                <option value="running">🔄 Running</option>
                <option value="queued">⏳ Queued</option>
                <option value="completed">✅ Completed</option>
                <option value="failed">❌ Failed</option>
                <option value="cancelled">🚫 Cancelled</option>
            </select>
            {state.workspaces.length > 0 && (
                <select
                    id="workspace-select"
                    value={state.workspace}
                    onChange={e => onWorkspaceChange(e.target.value)}
                    className="w-full px-2 py-1.5 text-sm rounded border border-[#e0e0e0] bg-white dark:border-[#3c3c3c] dark:bg-[#3c3c3c] dark:text-[#cccccc]"
                >
                    <option value="__all">All Workspaces</option>
                    {state.workspaces.map((ws: any) => (
                        <option key={ws.id} value={ws.id}>
                            {ws.name || ws.path || ws.id}
                        </option>
                    ))}
                </select>
            )}
        </div>
    );
}
