/**
 * Sidebar panel that surfaces deterministic thread groupings.
 *
 * The underlying `CommentThread[]` is real (from
 * `/api/origins/:originId/pull-requests/:prId/threads`). The grouping
 * categories and severity tags are assigned deterministically by
 * `buildThreadGroupsFromThreads`.
 */

import { cn } from '../../ui';
import type { ThreadGroupSummary } from './pr-derived-data';

interface PrAiGroupedThreadsProps {
    groups: ThreadGroupSummary[];
    /** Total number of real threads — shown so users see the AI did not
     *  silently drop any thread when bucketing. */
    totalThreads: number;
}

function severityClass(severity: ThreadGroupSummary['severity']): string {
    switch (severity) {
        case 'blocking':
            return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200';
        case 'non-blocking':
            return 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200';
        case 'noise':
            return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300';
    }
}

export function PrAiGroupedThreads({ groups, totalThreads }: PrAiGroupedThreadsProps) {
    const blockingCount = groups
        .filter(group => group.severity === 'blocking')
        .reduce((sum, group) => sum + group.count, 0);

    return (
        <aside
            className="overflow-hidden rounded-[5px] border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900"
            data-testid="pr-ai-thread-groups"
        >
            <header className="flex min-h-[30px] items-center justify-between gap-1.5 border-b border-gray-200 bg-gray-50 px-2 py-1 dark:border-gray-700 dark:bg-gray-800/60">
                <h2 className="m-0 text-[13px] font-semibold leading-tight text-gray-900 dark:text-gray-100">
                    Grouped threads
                </h2>
                <div className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
                    <span data-testid="pr-ai-thread-total">{totalThreads} total</span>
                    {blockingCount > 0 && (
                        <span className="inline-flex min-h-[20px] items-center gap-1 rounded-full bg-yellow-100 px-1.5 py-0.5 font-semibold text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200">
                            {blockingCount} blocking
                        </span>
                    )}
                </div>
            </header>
            <div className="grid gap-[5px] p-2">
                {totalThreads === 0 && (
                    <p className="m-0 px-1.5 py-0.5 text-[11px] italic text-gray-500 dark:text-gray-400">
                        No comment threads on this pull request yet.
                    </p>
                )}
                {totalThreads > 0 && groups.map(group => (
                    <div
                        key={group.id}
                        className={cn(
                            'rounded-[5px] border border-gray-200 bg-white p-1.5 dark:border-gray-700 dark:bg-gray-800/40',
                            group.count === 0 && 'opacity-60',
                        )}
                        data-testid="pr-ai-thread-group"
                        data-severity={group.severity}
                    >
                        <div className="flex items-baseline justify-between gap-1.5">
                            <span className="text-[12px] font-semibold leading-snug text-gray-900 dark:text-gray-100">
                                {group.title}
                            </span>
                            <span className="font-mono text-[11px] tabular-nums text-gray-500 dark:text-gray-400">
                                {group.count}
                            </span>
                        </div>
                        <p className="m-0 mt-0.5 text-[11px] leading-[1.35] text-gray-500 dark:text-gray-400">{group.body}</p>
                        <span
                            className={cn(
                                'mt-1 inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-normal leading-[1.4]',
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
