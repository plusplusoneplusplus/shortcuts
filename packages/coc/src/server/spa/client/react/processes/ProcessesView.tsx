/**
 * ProcessesView — top-level two-pane layout for the Processes tab.
 * Left: ProcessFilters + ProcessList. Right: ProcessDetail.
 */

import { ProcessFilters } from './ProcessFilters';
import { ProcessList } from './ProcessList';
import { ProcessDetail } from './ProcessDetail';
import { QueuePanel } from '../queue/QueuePanel';

export function ProcessesView() {
    return (
        <div id="view-processes" className="flex h-[calc(100vh-48px)]">
            {/* Left panel: filters + list */}
            <aside className="w-[320px] min-w-[280px] flex flex-col border-r border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f3f3f3] dark:bg-[#252526]">
                <ProcessFilters />
                <ProcessList />
                <div className="border-t border-[#e0e0e0] dark:border-[#3c3c3c] p-2">
                    <QueuePanel />
                </div>
            </aside>

            {/* Right panel: detail */}
            <main className="flex-1 flex flex-col bg-white dark:bg-[#1e1e1e]">
                <ProcessDetail />
            </main>
        </div>
    );
}
