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
    if (totalThreads === 0) return null;

    const blockingCount = groups
        .filter(group => group.severity === 'blocking')
        .reduce((sum, group) => sum + group.count, 0);

    return (
        <aside data-testid="pr-ai-thread-groups">
            <header className="mb-2 flex items-baseline justify-between gap-1.5">
                <h2 className="m-0 text-[15px] font-semibold text-gray-900 dark:text-gray-100">
                    Grouped threads
                </h2>
                <div className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
                    <span data-testid="pr-ai-thread-total">{totalThreads} total</span>
                    {blockingCount > 0 && (
                        <span className="text-orange-600 dark:text-orange-400">
                            {blockingCount} blocking
                        </span>
                    )}
                </div>
            </header>
            <div className="grid gap-[5px]">
                {groups.map(group => (
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
