/**
 * Checks tab content - combines the provider-derived checks/CI table with
 * a side-by-side merge readiness checklist.
 */

import { cn } from '../../ui';
import { checkStatusClass, findingTagClass } from './pr-derived-data';
import type { PrCheckRow, MergeReadinessItem } from './pr-derived-data';

interface PrChecksTableProps {
    rows: PrCheckRow[];
}

function statusLabel(status: PrCheckRow['status']): string {
    switch (status) {
        case 'success':   return 'Passed';
        case 'warning':   return 'Needs review';
        case 'failure':   return 'Failed';
        case 'cancelled': return 'Cancelled';
        case 'skipped':   return 'Skipped';
        case 'pending':   return 'Pending';
        case 'running':   return 'Running';
        case 'unknown':   return 'Unknown';
    }
}

export function PrChecksTable({ rows }: PrChecksTableProps) {
    const passingCount = rows.filter(row => row.status === 'success').length;

    return (
        <div
            className="overflow-hidden rounded-[5px] border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900"
            data-testid="pr-checks-table"
        >
            <header className="flex min-h-[30px] items-center justify-between gap-1.5 border-b border-gray-200 bg-gray-50 px-2 py-1 dark:border-gray-700 dark:bg-gray-800/60">
                <h2 className="m-0 text-[13px] font-semibold leading-tight text-gray-900 dark:text-gray-100">
                    Checks and CI
                </h2>
                <span className="inline-flex min-h-[20px] items-center gap-1 rounded-full bg-green-600 px-1.5 py-0.5 text-[11px] font-semibold text-white">
                    {passingCount} passing
                </span>
            </header>
            <div className="overflow-x-auto">
                {rows.length === 0 ? (
                    <p
                        className="m-0 px-2 py-3 text-[11px] italic text-gray-500 dark:text-gray-400"
                        data-testid="pr-checks-empty"
                    >
                        No CI checks reported for this pull request yet.
                    </p>
                ) : (
                    <table className="w-full border-collapse text-[12px]">
                        <thead>
                            <tr className="bg-gray-50 dark:bg-gray-800/60">
                                <th className="border-b border-gray-200 px-[7px] py-[5px] text-left text-[11px] font-semibold uppercase tracking-normal text-gray-500 dark:border-gray-700 dark:text-gray-400">
                                    Check
                                </th>
                                <th className="border-b border-gray-200 px-[7px] py-[5px] text-left text-[11px] font-semibold uppercase tracking-normal text-gray-500 dark:border-gray-700 dark:text-gray-400">
                                    Status
                                </th>
                                <th className="border-b border-gray-200 px-[7px] py-[5px] text-left text-[11px] font-semibold uppercase tracking-normal text-gray-500 dark:border-gray-700 dark:text-gray-400">
                                    Duration
                                </th>
                                <th className="border-b border-gray-200 px-[7px] py-[5px] text-left text-[11px] font-semibold uppercase tracking-normal text-gray-500 dark:border-gray-700 dark:text-gray-400">
                                    Details
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map(row => (
                                <tr
                                    key={row.id}
                                    className="border-b border-gray-100 last:border-0 dark:border-gray-800"
                                    data-testid="pr-check-row"
                                >
                                    <td className="px-[7px] py-[5px] align-top text-[12px] text-gray-800 dark:text-gray-200">
                                        {row.detailsUrl ? (
                                            <a
                                                href={row.detailsUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-blue-600 hover:underline dark:text-blue-400"
                                                data-testid="pr-check-link"
                                            >
                                                {row.name}
                                            </a>
                                        ) : (
                                            row.name
                                        )}
                                    </td>
                                    <td className={cn('px-[7px] py-[5px] align-top text-[12px] font-semibold', checkStatusClass(row.status))}>
                                        {statusLabel(row.status)}
                                    </td>
                                    <td className="px-[7px] py-[5px] align-top font-mono text-[11px] tabular-nums text-gray-500 dark:text-gray-400">
                                        {row.duration}
                                    </td>
                                    <td className="px-[7px] py-[5px] align-top text-[11px] text-gray-500 dark:text-gray-400">
                                        {row.interpretation}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}

interface PrMergeReadinessProps {
    items: MergeReadinessItem[];
}

export function PrMergeReadiness({ items }: PrMergeReadinessProps) {
    const blocked = items.some(item => item.tag === 'risk');

    return (
        <aside
            className="overflow-hidden rounded-[5px] border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900"
            data-testid="pr-merge-readiness"
        >
            <header className="flex min-h-[30px] items-center justify-between gap-1.5 border-b border-gray-200 bg-gray-50 px-2 py-1 dark:border-gray-700 dark:bg-gray-800/60">
                <h2 className="m-0 text-[13px] font-semibold leading-tight text-gray-900 dark:text-gray-100">
                    Merge readiness
                </h2>
                <span
                    className={cn(
                        'inline-flex min-h-[20px] items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold',
                        blocked
                            ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200'
                            : 'bg-green-600 text-white',
                    )}
                >
                    {blocked ? 'Almost' : 'Ready'}
                </span>
            </header>
            <ul className="m-0 grid list-none gap-1 p-2">
                {items.map((item, idx) => (
                    <li
                        key={`${item.tag}-${idx}`}
                        className="grid items-start gap-1.5 text-[12px] leading-snug text-gray-700 dark:text-gray-300"
                        style={{ gridTemplateColumns: '56px 1fr' }}
                        data-testid="pr-merge-readiness-item"
                    >
                        <span
                            className={cn(
                                'self-start rounded-full px-1.5 py-0.5 text-center text-[10px] font-bold uppercase tracking-normal leading-[1.4]',
                                findingTagClass(item.tag),
                            )}
                        >
                            {item.label}
                        </span>
                        <span>{item.body}</span>
                    </li>
                ))}
            </ul>
        </aside>
    );
}
