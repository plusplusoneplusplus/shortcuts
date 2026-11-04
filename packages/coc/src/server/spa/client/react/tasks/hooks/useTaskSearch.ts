/**
 * useTaskSearch — encapsulates task search input, debounce, keyboard shortcuts,
 * and derived search results.
 */

import { useMemo } from 'react';
import { flattenTaskTree, filterTaskItems } from './useTaskTree';
import type { TaskFolder } from './useTaskTree';
import { usePanelSearch } from '../../hooks/usePanelSearch';

export function useTaskSearch(tree: TaskFolder | null, options?: { isPreviewOpen?: boolean }) {
    const search = usePanelSearch(options);

    const allItems = useMemo(() => tree ? flattenTaskTree(tree) : [], [tree]);
    const searchResults = useMemo(() => filterTaskItems(allItems, search.searchQuery), [allItems, search.searchQuery]);

    return { ...search, searchResults };
}
