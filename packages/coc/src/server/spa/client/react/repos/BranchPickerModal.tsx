/**
 * BranchPickerModal — server-driven branch picker with debounced search and pagination.
 *
 * Opens as a modal overlay. Fetches branches from GET /workspaces/:id/git/branches
 * using search + pagination. Switches branches via POST /workspaces/:id/git/branches/switch.
 * Supports keyboard navigation (ArrowUp/Down, Enter, Escape).
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchApi } from '../hooks/useApi';

const PAGE_SIZE = 50;

interface GitBranch {
    name: string;
    isCurrent: boolean;
    isRemote: boolean;
    lastCommitSubject?: string;
    lastCommitDate?: string;
}

interface BranchPickerModalProps {
    workspaceId: string;
    currentBranch: string;
    isOpen: boolean;
    onClose: () => void;
    onSwitched: (newBranch: string) => void;
}

export function BranchPickerModal({ workspaceId, currentBranch, isOpen, onClose, onSwitched }: BranchPickerModalProps) {
    const [query, setQuery] = useState('');
    const [branches, setBranches] = useState<GitBranch[]>([]);
    const [offset, setOffset] = useState(0);
    const [hasMore, setHasMore] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [isSwitching, setIsSwitching] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [focusedIndex, setFocusedIndex] = useState(0);

    const searchInputRef = useRef<HTMLInputElement>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const listRef = useRef<HTMLUListElement>(null);

    const fetchBranches = useCallback(
        async (search: string, newOffset: number, append = false) => {
            if (!append) {
                setIsLoading(true);
            } else {
                setIsLoadingMore(true);
            }
            setError(null);
            try {
                const params = new URLSearchParams({
                    type: 'local',
                    limit: String(PAGE_SIZE),
                    offset: String(newOffset),
                });
                if (search) {
                    params.set('search', search);
                }
                const data = await fetchApi(
                    `/workspaces/${encodeURIComponent(workspaceId)}/git/branches?${params}`
                );
                const fetched: GitBranch[] = data.local?.branches ?? [];
                const more: boolean = data.local?.hasMore ?? false;
                if (append) {
                    setBranches(prev => [...prev, ...fetched]);
                } else {
                    setBranches(fetched);
                    setFocusedIndex(0);
                }
                setHasMore(more);
                setOffset(newOffset + fetched.length);
            } catch (err: any) {
                setError(err.message || 'Failed to load branches');
            } finally {
                setIsLoading(false);
                setIsLoadingMore(false);
            }
        },
        [workspaceId]
    );

    // On open: focus input, fetch initial list
    useEffect(() => {
        if (!isOpen) return;
        setQuery('');
        setBranches([]);
        setOffset(0);
        setHasMore(false);
        setError(null);
        setFocusedIndex(0);
        fetchBranches('', 0, false);
        setTimeout(() => searchInputRef.current?.focus(), 50);
    }, [isOpen, fetchBranches]);

    // Debounced search on query change
    useEffect(() => {
        if (!isOpen) return;
        if (debounceRef.current) {
            clearTimeout(debounceRef.current);
        }
        debounceRef.current = setTimeout(() => {
            setOffset(0);
            fetchBranches(query, 0, false);
        }, 300);
        return () => {
            if (debounceRef.current) {
                clearTimeout(debounceRef.current);
            }
        };
    }, [query, isOpen, fetchBranches]);

    const handleLoadMore = useCallback(() => {
        fetchBranches(query, offset, true);
    }, [fetchBranches, query, offset]);

    const handleSwitch = useCallback(
        async (branchName: string) => {
            if (branchName === currentBranch || isSwitching) return;
            setIsSwitching(true);
            setError(null);
            try {
                const result = await fetchApi(
                    `/workspaces/${encodeURIComponent(workspaceId)}/git/branches/switch`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name: branchName, force: false }),
                    }
                );
                if (result.success === false) {
                    throw new Error(result.error || 'Switch failed');
                }
                onSwitched(branchName);
                onClose();
            } catch (err: any) {
                setError(err.message || 'Failed to switch branch');
            } finally {
                setIsSwitching(false);
            }
        },
        [currentBranch, isSwitching, workspaceId, onSwitched, onClose]
    );

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
                return;
            }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setFocusedIndex(i => Math.min(i + 1, branches.length - 1));
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setFocusedIndex(i => Math.max(i - 1, 0));
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (branches[focusedIndex]) {
                    handleSwitch(branches[focusedIndex].name);
                }
            }
        },
        [onClose, branches, focusedIndex, handleSwitch]
    );

    // Scroll focused item into view
    useEffect(() => {
        if (!listRef.current) return;
        const item = listRef.current.children[focusedIndex] as HTMLElement | undefined;
        item?.scrollIntoView({ block: 'nearest' });
    }, [focusedIndex]);

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-[10020] flex items-start justify-center pt-[10vh]"
            data-testid="branch-picker-overlay"
            onClick={e => { if (e.target === e.currentTarget) onClose(); }}
        >
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/40" aria-hidden="true" />

            {/* Dialog */}
            <div
                className="relative z-10 w-full max-w-lg bg-white dark:bg-[#252526] rounded-lg shadow-2xl border border-[#e0e0e0] dark:border-[#3c3c3c] flex flex-col max-h-[70vh]"
                data-testid="branch-picker-modal"
                role="dialog"
                aria-label="Switch branch"
                onKeyDown={handleKeyDown}
            >
                {/* Header */}
                <div className="flex items-center gap-2 px-4 py-3 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                    <svg className="w-4 h-4 text-[#616161] dark:text-[#999] flex-shrink-0" viewBox="0 0 16 16" fill="currentColor">
                        <path fillRule="evenodd" d="M11.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122V6A2.5 2.5 0 0110 8.5H6A1.5 1.5 0 004.5 10v.128a2.251 2.251 0 11-1.5 0V5.372a2.25 2.25 0 111.5 0v1.836A2.993 2.993 0 016 6.5h4a1 1 0 001-1v-.628A2.25 2.25 0 019.5 3.25zM4.25 12a.75.75 0 100 1.5.75.75 0 000-1.5zM3.5 3.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0z" />
                    </svg>
                    <input
                        ref={searchInputRef}
                        type="text"
                        className="flex-1 bg-transparent text-sm text-[#1e1e1e] dark:text-[#ccc] placeholder-[#999] outline-none"
                        placeholder="Search branches…"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        data-testid="branch-picker-search"
                        aria-label="Search branches"
                    />
                    <button
                        className="text-[#616161] dark:text-[#999] hover:text-[#1e1e1e] dark:hover:text-[#ccc]"
                        onClick={onClose}
                        aria-label="Close"
                        data-testid="branch-picker-close"
                    >
                        <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z" />
                        </svg>
                    </button>
                </div>

                {/* Error */}
                {error && (
                    <div
                        className="px-4 py-2 text-xs text-[#d32f2f] dark:text-[#f48771] bg-[#fdecea] dark:bg-[#3c2020] border-b border-[#e0e0e0] dark:border-[#3c3c3c]"
                        data-testid="branch-picker-error"
                    >
                        {error}
                    </div>
                )}

                {/* Branch list */}
                <ul
                    ref={listRef}
                    className="overflow-y-auto flex-1"
                    data-testid="branch-picker-list"
                    role="listbox"
                    aria-label="Branches"
                >
                    {isLoading && (
                        <li className="px-4 py-3 text-sm text-[#999]" data-testid="branch-picker-loading">
                            Loading branches…
                        </li>
                    )}
                    {!isLoading && branches.length === 0 && !error && (
                        <li className="px-4 py-3 text-sm text-[#999]" data-testid="branch-picker-empty">
                            No branches found
                        </li>
                    )}
                    {branches.map((branch, idx) => {
                        const isCurrent = branch.name === currentBranch;
                        const isFocused = idx === focusedIndex;
                        return (
                            <li
                                key={branch.name}
                                role="option"
                                aria-selected={isCurrent}
                                className={`flex items-center gap-2 px-4 py-2 cursor-pointer text-sm select-none ${
                                    isFocused
                                        ? 'bg-[#e8f0fe] dark:bg-[#2a3a5c]'
                                        : 'hover:bg-[#f5f5f5] dark:hover:bg-[#2a2d2e]'
                                }`}
                                onClick={() => handleSwitch(branch.name)}
                                onMouseEnter={() => setFocusedIndex(idx)}
                                data-testid={`branch-item-${branch.name}`}
                            >
                                {/* Current branch indicator */}
                                <span className={`w-4 flex-shrink-0 text-center ${isCurrent ? 'text-[#16825d]' : ''}`}>
                                    {isCurrent ? '✓' : ''}
                                </span>
                                <span className={`font-mono truncate ${isCurrent ? 'font-semibold text-[#16825d]' : 'text-[#1e1e1e] dark:text-[#ccc]'}`}>
                                    {branch.name}
                                </span>
                                {isCurrent && (
                                    <span className="ml-auto text-xs text-[#16825d] flex-shrink-0" data-testid="branch-current-badge">
                                        current
                                    </span>
                                )}
                                {branch.lastCommitDate && !isCurrent && (
                                    <span className="ml-auto text-xs text-[#999] flex-shrink-0">{branch.lastCommitDate}</span>
                                )}
                            </li>
                        );
                    })}
                </ul>

                {/* Load more */}
                {hasMore && !isLoading && (
                    <div className="px-4 py-2 border-t border-[#e0e0e0] dark:border-[#3c3c3c]">
                        <button
                            className="w-full text-xs text-[#0078d4] hover:underline py-1 disabled:opacity-50"
                            onClick={handleLoadMore}
                            disabled={isLoadingMore}
                            data-testid="branch-picker-load-more"
                        >
                            {isLoadingMore ? 'Loading…' : 'Load more'}
                        </button>
                    </div>
                )}

                {/* Switching spinner */}
                {isSwitching && (
                    <div className="px-4 py-2 text-xs text-[#999] border-t border-[#e0e0e0] dark:border-[#3c3c3c]" data-testid="branch-picker-switching">
                        Switching branch…
                    </div>
                )}
            </div>
        </div>
    );
}
