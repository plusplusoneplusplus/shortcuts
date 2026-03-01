/**
 * ProcessesView — responsive layout for the Processes tab.
 * Mobile: master-detail navigation. Tablet/Desktop: sidebar + detail pane.
 */

import { useState } from 'react';
import { ProcessFilters } from './ProcessFilters';
import { ProcessesSidebar } from './ProcessesSidebar';
import { ProcessDetail } from './ProcessDetail';
import { QueueTaskDetail } from '../queue/QueueTaskDetail';
import { useQueue } from '../context/QueueContext';
import { useApp } from '../context/AppContext';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { ResponsiveSidebar } from '../shared/ResponsiveSidebar';

function MobileDetailHeader({ onBack }: { onBack: () => void }) {
    return (
        <div className="flex items-center h-11 px-3 gap-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f3f3f3] dark:bg-[#252526] shrink-0">
            <button
                onClick={onBack}
                className="flex items-center justify-center w-8 h-8 rounded hover:bg-[#e0e0e0] dark:hover:bg-[#3c3c3c] transition-colors"
                aria-label="Back to process list"
                data-testid="mobile-back-button"
            >
                ←
            </button>
            <span className="text-sm font-medium text-[#1e1e1e] dark:text-[#cccccc] truncate">
                Process Detail
            </span>
        </div>
    );
}

function MobileFiltersAccordion({
    expanded,
    onToggle,
}: {
    expanded: boolean;
    onToggle: () => void;
}) {
    return (
        <div className="border-b border-[#e0e0e0] dark:border-[#3c3c3c] shrink-0">
            <button
                onClick={onToggle}
                className="flex items-center justify-between w-full px-3 h-11 text-sm font-medium text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#e0e0e0] dark:hover:bg-[#3c3c3c] transition-colors"
                aria-expanded={expanded}
                aria-controls="mobile-process-filters"
                data-testid="mobile-filters-toggle"
            >
                <span>Filters</span>
                <span className={`transition-transform ${expanded ? 'rotate-180' : ''}`}>
                    ▼
                </span>
            </button>
            {expanded && (
                <div id="mobile-process-filters" data-testid="mobile-filters-panel">
                    <ProcessFilters />
                </div>
            )}
        </div>
    );
}

export function ProcessesView() {
    const { state, dispatch } = useApp();
    const { state: queueState, dispatch: queueDispatch } = useQueue();
    const { breakpoint } = useBreakpoint();
    const isMobile = breakpoint === 'mobile';
    const [filtersExpanded, setFiltersExpanded] = useState(false);

    const hasSelection = state.selectedId !== null || queueState.selectedTaskId !== null;

    const handleBack = () => {
        dispatch({ type: 'SELECT_PROCESS', id: null });
        queueDispatch({ type: 'SELECT_QUEUE_TASK', id: null });
        if (location.hash.startsWith('#process/')) {
            location.hash = '#processes';
        }
    };

    const heightClass = isMobile
        ? 'h-[calc(100vh-48px-56px)]'
        : 'h-[calc(100vh-48px)]';

    return (
        <div id="view-processes" className={`flex ${heightClass} overflow-hidden`}>
            {isMobile ? (
                hasSelection ? (
                    <div className="flex-1 min-w-0 min-h-0 flex flex-col">
                        <MobileDetailHeader onBack={handleBack} />
                        <main className="flex-1 min-w-0 min-h-0 flex flex-col bg-white dark:bg-[#1e1e1e]">
                            {queueState.selectedTaskId ? <QueueTaskDetail /> : <ProcessDetail />}
                        </main>
                    </div>
                ) : (
                    <div className="flex-1 min-w-0 min-h-0 flex flex-col bg-[#f3f3f3] dark:bg-[#252526]">
                        <MobileFiltersAccordion
                            expanded={filtersExpanded}
                            onToggle={() => setFiltersExpanded(prev => !prev)}
                        />
                        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
                            <ProcessesSidebar />
                        </div>
                    </div>
                )
            ) : (
                <>
                    <ResponsiveSidebar
                        isOpen={false}
                        onClose={() => {}}
                        width={320}
                        tabletWidth={260}
                    >
                        <ProcessFilters />
                        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
                            <ProcessesSidebar />
                        </div>
                    </ResponsiveSidebar>
                    <main className="flex-1 min-w-0 min-h-0 flex flex-col bg-white dark:bg-[#1e1e1e]">
                        {queueState.selectedTaskId ? <QueueTaskDetail /> : <ProcessDetail />}
                    </main>
                </>
            )}
        </div>
    );
}
