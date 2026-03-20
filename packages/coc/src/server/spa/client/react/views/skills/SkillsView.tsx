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
        <div id="view-skills" className="flex h-full overflow-hidden">
            {/* Left tab sidebar */}
            <div className="flex flex-col flex-shrink-0 w-36 border-r border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f3f3f3] dark:bg-[#252526] py-2">
                {SUB_TABS.map(({ id, label }) => (
                    <button
                        key={id}
                        className={cn(
                            'text-left px-4 py-2 text-sm transition-colors border-l-2',
                            activeSubTab === id
                                ? 'border-[#0078d4] text-[#0078d4] font-medium bg-white dark:bg-[#1e1e1e]'
                                : 'border-transparent text-[#616161] dark:text-[#999999] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] hover:bg-[#e8e8e8] dark:hover:bg-[#2a2a2a]',
                        )}
                        data-subtab={id}
                        onClick={() => switchSubTab(id)}
                    >
                        {label}
                    </button>
                ))}
            </div>

            {/* Right content area */}
            <div className="flex-1 min-w-0 overflow-auto">
                {activeSubTab === 'installed' && <SkillsInstalledPanel />}
                {activeSubTab === 'bundled' && <SkillsBundledPanel />}
                {activeSubTab === 'config' && <SkillsConfigPanel />}
            </div>
        </div>
    );
}
