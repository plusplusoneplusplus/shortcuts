/**
 * useWorkItemSearch — encapsulates work item search input, debounce, and keyboard shortcuts.
 * Modeled after useTaskSearch.ts.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export function useWorkItemSearch(options?: { isPreviewOpen?: boolean }) {
    const isPreviewOpen = options?.isPreviewOpen ?? false;
    const [searchQuery, setSearchQuery] = useState('');
    const [searchInput, setSearchInput] = useState('');
    const debounceRef = useRef<ReturnType<typeof setTimeout>>();
    const searchInputRef = useRef<HTMLInputElement>(null);

    const onSearchChange = useCallback((value: string) => {
        setSearchInput(value);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            setSearchQuery(value);
        }, 150);
    }, []);

    useEffect(() => {
        return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    }, []);

    const onSearchClear = useCallback(() => {
        setSearchInput('');
        setSearchQuery('');
        if (debounceRef.current) clearTimeout(debounceRef.current);
    }, []);

    // Keyboard shortcuts: Ctrl+F / Cmd+F → focus search, Escape → clear
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'f' && (e.ctrlKey || e.metaKey)) {
                if (isPreviewOpen) return;
                e.preventDefault();
                searchInputRef.current?.focus();
            }
            if (e.key === 'Escape') {
                if (searchInput || searchQuery) {
                    setSearchInput('');
                    setSearchQuery('');
                    searchInputRef.current?.blur();
                }
            }
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [searchInput, searchQuery, isPreviewOpen]);

    return { searchInput, searchQuery, searchInputRef, onSearchChange, onSearchClear };
}
