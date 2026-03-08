/**
 * SkillsView — top-level route component for #skills.
 *
 * Renders sub-tabs: Installed | Bundled | Config
 */

import { useCallback } from 'react';
import { useApp } from '../../context/AppContext';
import { cn } from '../../shared/cn';
import type { SkillsSubTab } from '../../types/dashboard';
import { SkillsInstalledPanel } from './SkillsInstalledPanel';
import { SkillsBundledPanel } from './SkillsBundledPanel';
import { SkillsConfigPanel } from './SkillsConfigPanel';

const SUB_TABS: { id: SkillsSubTab; label: string }[] = [
    { id: 'installed', label: 'Installed' },
    { id: 'bundled', label: 'Bundled' },
    { id: 'config', label: 'Config' },
];

export function SkillsView() {
    const { state, dispatch } = useApp();
    const activeSubTab = state.activeSkillsSubTab;

    const switchSubTab = useCallback((tab: SkillsSubTab) => {
        dispatch({ type: 'SET_SKILLS_SUB_TAB', tab });
        location.hash = `#skills/${tab}`;
    }, [dispatch]);

    return (
        <div id="view-skills" className="flex flex-col h-full overflow-hidden">
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
                {activeSubTab === 'installed' && <SkillsInstalledPanel />}
                {activeSubTab === 'bundled' && <SkillsBundledPanel />}
                {activeSubTab === 'config' && <SkillsConfigPanel />}
            </div>
        </div>
    );
}
