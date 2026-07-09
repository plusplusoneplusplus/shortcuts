/**
 * useTaskSearch — encapsulates task search input, debounce, keyboard shortcuts,
 * and derived search results.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flattenTaskTree, filterTaskItems } from './useTaskTree';
import type { TaskFolder } from './useTaskTree';
import { useScopedFindShortcut } from '../../hooks/useScopedFindShortcut';

export function useTaskSearch(tree: TaskFolder | null, options?: { isPreviewOpen?: boolean }) {
    const isPreviewOpen = options?.isPreviewOpen ?? false;
    const [searchQuery, setSearchQuery] = useState('');
    const [searchInput, setSearchInput] = useState('');
    const debounceRef = useRef<ReturnType<typeof setTimeout>>();
    const searchInputRef = useRef<HTMLInputElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

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

    // Ctrl+F / Cmd+F → focus search, routed by keyboard focus through the shared
    // helper so a hidden Tasks tab never swallows native find (the old
    // unconditional preventDefault broke the Electron/browser find). Disabled
    // while a file preview is open so native find-in-page can take over.
    useScopedFindShortcut(containerRef, () => {
        searchInputRef.current?.focus();
    }, { enabled: !isPreviewOpen });

    // Escape clears the search, but only while this panel is actually visible.
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            const container = containerRef.current;
            if (!container || container.offsetParent === null) return;
            if (searchInput || searchQuery) {
                setSearchInput('');
                setSearchQuery('');
                searchInputRef.current?.blur();
            }
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [searchInput, searchQuery]);

    const allItems = useMemo(() => tree ? flattenTaskTree(tree) : [], [tree]);
    const searchResults = useMemo(() => filterTaskItems(allItems, searchQuery), [allItems, searchQuery]);

    return { searchInput, searchQuery, searchResults, searchInputRef, containerRef, onSearchChange, onSearchClear };
}
