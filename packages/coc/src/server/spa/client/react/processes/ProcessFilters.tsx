/**
 * ProcessFilters — search, status filter, workspace filter.
 * Replaces filters.ts event handlers.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useApp } from '../contexts/AppContext';
import { getSpaCocClient } from '../api/cocClient';
import { useProcessSearch } from './hooks/useProcessSearch';

export function ProcessFilters() {
    const { state, dispatch } = useApp();
    const [searchInput, setSearchInput] = useState(state.searchQuery);
    const debounceRef = useRef<ReturnType<typeof setTimeout>>();

    // Server-side FTS5 search (activates for queries >= 2 chars)
    const { results, total, loading } = useProcessSearch(searchInput, {
        workspace: state.workspace,
        statusFilter: state.statusFilter,
        typeFilter: state.typeFilter !== '__all' ? state.typeFilter : undefined,
    });

    // Sync search hook results into global state
    useEffect(() => {
        dispatch({ type: 'SET_SEARCH_LOADING', loading });
    }, [loading, dispatch]);

    useEffect(() => {
        // Only dispatch results for queries >= 2 chars; shorter queries use client-side filtering
        if (searchInput.length >= 2) {
            dispatch({ type: 'SET_SEARCH_RESULTS', results });
        } else {
            dispatch({ type: 'SET_SEARCH_RESULTS', results: null });
        }
    }, [results, searchInput, dispatch]);

    // Debounced search dispatch for client-side filtering (short queries)
    const onSearchChange = useCallback((value: string) => {
        setSearchInput(value);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            dispatch({ type: 'SET_SEARCH_QUERY', value });
        }, 200);
    }, [dispatch]);

    const clearSearch = useCallback(() => {
        setSearchInput('');
        if (debounceRef.current) clearTimeout(debounceRef.current);
        dispatch({ type: 'SET_SEARCH_QUERY', value: '' });
        dispatch({ type: 'SET_SEARCH_RESULTS', results: null });
        dispatch({ type: 'SET_SEARCH_LOADING', loading: false });
    }, [dispatch]);

    useEffect(() => {
        return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    }, []);

    const onStatusChange = useCallback((value: string) => {
        dispatch({ type: 'SET_STATUS_FILTER', value });
    }, [dispatch]);

    const onTypeChange = useCallback((value: string) => {
        dispatch({ type: 'SET_TYPE_FILTER', value });
    }, [dispatch]);

    const onWorkspaceChange = useCallback(async (workspaceId: string) => {
        dispatch({ type: 'SET_WORKSPACE_FILTER', value: workspaceId });
        try {
            const data = await getSpaCocClient().processes.list(
                workspaceId === '__all' ? undefined : { workspace: workspaceId },
            );
            if (data?.processes && Array.isArray(data.processes)) {
                dispatch({ type: 'SET_PROCESSES', processes: data.processes });
            }
            dispatch({ type: 'SELECT_PROCESS', id: null });
        } catch { /* ignore */ }
    }, [dispatch]);

    return (
        <div className="filter-bar p-2 flex flex-col gap-2">
            <div className="relative">
                <input
                    id="search-input"
                    type="text"
                    placeholder="Search processes..."
                    value={searchInput}
                    onChange={e => onSearchChange(e.target.value)}
                    className="w-full px-2 py-1.5 text-sm rounded border border-[#e0e0e0] bg-white dark:border-[#3c3c3c] dark:bg-[#3c3c3c] dark:text-[#cccccc] focus:outline-none focus:border-[#0078d4] pr-7"
                />
                {searchInput && (
                    <button
                        type="button"
                        onClick={clearSearch}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] text-sm leading-none p-0.5"
                        title="Clear search"
                        data-testid="clear-search-btn"
                    >
                        ×
                    </button>
                )}
            </div>
            {loading && (
                <div className="text-[11px] text-[#848484]" data-testid="search-loading">
                    Searching…
                </div>
            )}
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
            <select
                id="type-filter"
                value={state.typeFilter}
                onChange={e => onTypeChange(e.target.value)}
                className="w-full px-2 py-1.5 text-sm rounded border border-[#e0e0e0] bg-white dark:border-[#3c3c3c] dark:bg-[#3c3c3c] dark:text-[#cccccc]"
            >
                <option value="__all">All Types</option>
                <option value="chat">💬 Chat</option>
                <option value="run-script">📜 Prompt & Script</option>
                <option value="run-workflow">⚙️ Workflow</option>
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
