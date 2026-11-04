import { useCallback, useEffect, useRef, useState } from 'react';
import { useScopedFindShortcut } from './useScopedFindShortcut';

/** Search input mechanics only; each panel owns filtering and pagination. */
export function usePanelSearch(options?: { isPreviewOpen?: boolean }) {
    const [searchQuery, setSearchQuery] = useState('');
    const [searchInput, setSearchInput] = useState('');
    const debounceRef = useRef<ReturnType<typeof setTimeout>>();
    const searchInputRef = useRef<HTMLInputElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const onSearchChange = useCallback((value: string) => {
        setSearchInput(value);
        clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => setSearchQuery(value), 150);
    }, []);

    const onSearchClear = useCallback(() => {
        clearTimeout(debounceRef.current);
        setSearchInput('');
        setSearchQuery('');
    }, []);

    useEffect(() => () => clearTimeout(debounceRef.current), []);

    useScopedFindShortcut(containerRef, () => {
        searchInputRef.current?.focus();
    }, { enabled: !options?.isPreviewOpen });

    useEffect(() => {
        const handler = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            const container = containerRef.current;
            if (!container || container.offsetParent === null) return;
            if (searchInput || searchQuery) {
                onSearchClear();
                searchInputRef.current?.blur();
            }
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [searchInput, searchQuery, onSearchClear]);

    return { searchInput, searchQuery, searchInputRef, containerRef, onSearchChange, onSearchClear };
}
