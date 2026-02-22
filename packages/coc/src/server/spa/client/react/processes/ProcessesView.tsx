/**
 * ProcessesView — top-level two-pane layout for the Processes tab.
 * Left: ProcessFilters + ProcessList. Right: ProcessDetail.
 */

import { ProcessFilters } from './ProcessFilters';
import { ProcessList } from './ProcessList';
import { ProcessDetail } from './ProcessDetail';
import { QueuePanel } from '../queue/QueuePanel';
import { QueueTaskDetail } from '../queue/QueueTaskDetail';
import { useQueue } from '../context/QueueContext';

export function ProcessesView() {
    const { state: queueState } = useQueue();

    return (
        <div id="view-processes" className="flex h-[calc(100vh-48px)] overflow-hidden">
            {/* Left panel: filters + list */}
            <aside className="w-[320px] min-w-[320px] max-w-[320px] shrink-0 min-h-0 flex flex-col border-r border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f3f3f3] dark:bg-[#252526]">
                <ProcessFilters />
                <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
                    <ProcessList />
                    <QueuePanel />
                </div>
            </aside>

            {/* Right panel: detail */}
            <main className="flex-1 min-w-0 min-h-0 flex flex-col bg-white dark:bg-[#1e1e1e]">
                {queueState.selectedTaskId ? <QueueTaskDetail /> : <ProcessDetail />}
            </main>
        </div>
    );
}
