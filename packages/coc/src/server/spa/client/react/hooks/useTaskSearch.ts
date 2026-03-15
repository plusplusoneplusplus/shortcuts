/**
 * useTaskSearch — encapsulates task search input, debounce, keyboard shortcuts,
 * and derived search results.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flattenTaskTree, filterTaskItems } from './useTaskTree';
import type { TaskFolder } from './useTaskTree';

export function useTaskSearch(tree: TaskFolder | null) {
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
    }, [searchInput, searchQuery]);

    const allItems = useMemo(() => tree ? flattenTaskTree(tree) : [], [tree]);
    const searchResults = useMemo(() => filterTaskItems(allItems, searchQuery), [allItems, searchQuery]);

    return { searchInput, searchQuery, searchResults, searchInputRef, onSearchChange, onSearchClear };
}
