/**
 * SkillsView — top-level route component for #skills.
 *
 * Renders sub-tabs: Installed | Gallery | Config
 * Mobile: horizontal scrollable top tab strip.
 * Desktop: vertical left sidebar.
 */

import { useCallback } from 'react';
import { useApp } from '../../context/AppContext';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import { cn } from '../../shared/cn';
import type { SkillsSubTab } from '../../types/dashboard';
import { FeatureTip } from '../../welcome/FeatureTip';
import { SkillsInstalledPanel } from './SkillsInstalledPanel';
import { SkillsBundledPanel } from './SkillsBundledPanel';
import { SkillsConfigPanel } from './SkillsConfigPanel';

const SUB_TABS: { id: SkillsSubTab; label: string }[] = [
    { id: 'installed', label: 'Installed' },
    { id: 'gallery', label: 'Gallery' },
    { id: 'config', label: 'Config' },
];

export function SkillsView() {
    const { state, dispatch } = useApp();
    const { isMobile } = useBreakpoint();
    const activeSubTab = state.activeSkillsSubTab;

    const switchSubTab = useCallback((tab: SkillsSubTab) => {
        dispatch({ type: 'SET_SKILLS_SUB_TAB', tab });
        location.hash = `#skills/${tab}`;
    }, [dispatch]);

    const content = (
        <>
            {activeSubTab === 'installed' && <SkillsInstalledPanel />}
            {activeSubTab === 'gallery' && <SkillsBundledPanel />}
            {activeSubTab === 'config' && <SkillsConfigPanel />}
        </>
    );

    if (isMobile) {
        return (
            <div id="view-skills" className="flex flex-col h-full overflow-hidden">
                {/* Mobile: horizontal scrollable tab strip */}
                <div
                    className="flex overflow-x-auto scrollbar-hide flex-shrink-0 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f3f3f3] dark:bg-[#252526]"
                    data-testid="skills-mobile-tabs"
                >
                    {SUB_TABS.map(({ id, label }) => (
                        <button
                            key={id}
                            className={cn(
                                'flex-shrink-0 min-h-[44px] px-5 text-sm transition-colors border-b-2 whitespace-nowrap',
                                activeSubTab === id
                                    ? 'border-[#0078d4] text-[#0078d4] font-medium'
                                    : 'border-transparent text-[#616161] dark:text-[#999999]',
                            )}
                            data-subtab={id}
                            onClick={() => switchSubTab(id)}
                        >
                            {label}
                        </button>
                    ))}
                </div>
                {/* Mobile content area */}
                <div className="flex-1 min-w-0 overflow-auto">
                    {content}
                </div>
            </div>
        );
    }

    return (
        <div id="view-skills" className="flex flex-col h-full overflow-hidden">
            <FeatureTip tipId="skills-intro" className="mx-3 mt-2" />
            <div className="flex flex-1 min-h-0 overflow-hidden">
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
                    {activeSubTab === 'gallery' && <SkillsBundledPanel />}
                    {activeSubTab === 'config' && <SkillsConfigPanel />}
                </div>
            </div>
        </div>
    );
}
