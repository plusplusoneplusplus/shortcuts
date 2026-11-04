/**
 * useWorkItemSearch — encapsulates work item search input, debounce, and keyboard shortcuts.
 * Modeled after useTaskSearch.ts.
 */

import { usePanelSearch } from '../../../hooks/usePanelSearch';

export function useWorkItemSearch(options?: { isPreviewOpen?: boolean }) {
    return usePanelSearch(options);
}
