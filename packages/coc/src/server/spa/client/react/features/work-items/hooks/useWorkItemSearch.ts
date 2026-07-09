/**
 * useWorkItemSearch — encapsulates work item search input, debounce, and keyboard shortcuts.
 * Modeled after useTaskSearch.ts.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useScopedFindShortcut } from '../../../hooks/useScopedFindShortcut';

export function useWorkItemSearch(options?: { isPreviewOpen?: boolean }) {
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
    // helper so a hidden Work Items tab never swallows native find (the old
    // unconditional preventDefault broke the Electron/browser find).
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

    return { searchInput, searchQuery, searchInputRef, containerRef, onSearchChange, onSearchClear };
}
