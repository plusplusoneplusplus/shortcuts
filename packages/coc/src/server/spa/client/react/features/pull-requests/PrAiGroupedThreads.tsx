/**
 * Sidebar panel that surfaces AI-generated thread groupings, e.g.
 * "Backpressure and aborts" / "Generated fixtures".
 */

import { cn } from '../../ui';
import type { AiThreadGroup } from './pr-mock-data';

interface PrAiGroupedThreadsProps {
    groups: AiThreadGroup[];
}

function severityClass(severity: AiThreadGroup['severity']): string {
    switch (severity) {
        case 'blocking':
            return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200';
        case 'non-blocking':
            return 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200';
        case 'noise':
            return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300';
    }
}

export function PrAiGroupedThreads({ groups }: PrAiGroupedThreadsProps) {
    const blockingCount = groups.filter(group => group.severity === 'blocking').length;

    return (
        <aside
            className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900"
            data-testid="pr-ai-thread-groups"
        >
            <header className="flex items-center justify-between gap-3 border-b border-gray-200 bg-gray-50 px-4 py-2.5 dark:border-gray-700 dark:bg-gray-800/60">
                <h2 className="m-0 text-sm font-semibold text-gray-900 dark:text-gray-100">
                    AI grouped threads
                </h2>
                {blockingCount > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2.5 py-1 text-[11px] font-semibold text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200">
                        {blockingCount} blocking
                    </span>
                )}
            </header>
            <div className="grid gap-2.5 p-4">
                {groups.map(group => (
                    <div
                        key={group.id}
                        className="rounded-md border border-gray-200 bg-white p-2.5 dark:border-gray-700 dark:bg-gray-800/40"
                        data-testid="pr-ai-thread-group"
                    >
                        <div className="flex items-baseline justify-between gap-3">
                            <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                                {group.title}
                            </span>
                            <span className="font-mono text-xs tabular-nums text-gray-500 dark:text-gray-400">
                                {group.count}
                            </span>
                        </div>
                        <p className="m-0 mt-1.5 text-xs text-gray-600 dark:text-gray-400">{group.body}</p>
                        <span
                            className={cn(
                                'mt-2 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                                severityClass(group.severity),
                            )}
                        >
                            {group.severity}
                        </span>
                    </div>
                ))}
            </div>
        </aside>
    );
}
