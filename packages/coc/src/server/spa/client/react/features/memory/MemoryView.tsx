/**
 * MemoryView — top-level route component for #memory.
 *
 * Renders the redesigned MemoryV2Panel. The panel itself manages
 * its enabled/disabled state. Legacy panels are kept accessible via
 * a collapsed legacy section for workspaces not yet using v2.
 */

import { useCallback } from 'react';
import { useApp } from '../../contexts/AppContext';
import { cn } from '../../ui/cn';
import type { MemorySubTab } from '../../types/dashboard';
import { FeatureTip } from '../../welcome/FeatureTip';
import { MemoryConfigPanel } from './MemoryConfigPanel';
import { ExploreCacheBrowserPanel } from './ExploreCacheBrowserPanel';
import { MemoryV2Panel } from './MemoryV2Panel';

const LEGACY_TABS: { id: MemorySubTab; label: string }[] = [
    { id: 'files', label: 'Explore Cache' },
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
            <FeatureTip tipId="memory-intro" className="mx-3 mt-2" />

            {/* Memory V2 panel — handles its own enabled/disabled state */}
            <div className="flex-1 overflow-hidden" data-testid="memory-v2-container">
                <MemoryV2Panel />
            </div>

            {/* Legacy panels for explore-cache and config */}
            {(activeSubTab === 'files' || activeSubTab === 'config') && (
                <div className="border-t border-[#e0e0e0] dark:border-[#3c3c3c]">
                    <div className="flex items-center gap-1 px-3 pt-1 pb-0 bg-[#f3f3f3] dark:bg-[#252526]">
                        <span className="text-[10px] text-[#888] mr-1">Legacy:</span>
                        {LEGACY_TABS.map(({ id, label }) => (
                            <button
                                key={id}
                                className={cn(
                                    'h-7 px-2 text-xs transition-colors border-b-2',
                                    activeSubTab === id
                                        ? 'border-[#0078d4] text-[#0078d4] font-medium'
                                        : 'border-transparent text-[#888] hover:text-[#1e1e1e] dark:hover:text-[#cccccc]',
                                )}
                                data-subtab={id}
                                onClick={() => switchSubTab(id)}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                    <div className="overflow-auto" style={{ maxHeight: '40vh' }}>
                        {activeSubTab === 'files' && <ExploreCacheBrowserPanel />}
                        {activeSubTab === 'config' && <MemoryConfigPanel />}
                    </div>
                </div>
            )}
        </div>
    );
}
