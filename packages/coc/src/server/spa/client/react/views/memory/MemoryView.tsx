/**
 * MemoryView — top-level route component for #memory.
 *
 * Renders sub-tabs: Entries | Config
 */

import { useCallback } from 'react';
import { useApp } from '../../context/AppContext';
import { cn } from '../../shared/cn';
import type { MemorySubTab } from '../../types/dashboard';
import { MemoryEntriesPanel } from './MemoryEntriesPanel';
import { MemoryConfigPanel } from './MemoryConfigPanel';

const SUB_TABS: { id: MemorySubTab; label: string }[] = [
    { id: 'entries', label: 'Entries' },
    { id: 'config', label: 'Config' },
];

export function MemoryView() {
    const { state, dispatch } = useApp();
    const activeSubTab = state.activeMemorySubTab;

    const switchSubTab = useCallback((tab: MemorySubTab) => {
        dispatch({ type: 'SET_MEMORY_SUB_TAB', tab });
        location.hash = `#memory/${tab}`;
    }, [dispatch]);

    return (
        <div id="view-memory" className="flex flex-col h-full overflow-hidden">
            {/* Sub-tab bar */}
            <div className="flex items-center gap-1 px-3 pt-2 pb-0 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f3f3f3] dark:bg-[#252526]">
                {SUB_TABS.map(({ id, label }) => (
                    <button
                        key={id}
                        className={cn(
                            'h-8 px-3 rounded-t text-sm transition-colors border-b-2',
                            activeSubTab === id
                                ? 'border-[#0078d4] text-[#0078d4] font-medium'
                                : 'border-transparent text-[#616161] dark:text-[#999999] hover:text-[#1e1e1e] dark:hover:text-[#cccccc]',
                        )}
                        data-subtab={id}
                        onClick={() => switchSubTab(id)}
                    >
                        {label}
                    </button>
                ))}
            </div>

            {/* Sub-tab content */}
            <div className="flex-1 overflow-auto">
                {activeSubTab === 'entries' && <MemoryEntriesPanel />}
                {activeSubTab === 'config' && <MemoryConfigPanel />}
            </div>
        </div>
    );
}
