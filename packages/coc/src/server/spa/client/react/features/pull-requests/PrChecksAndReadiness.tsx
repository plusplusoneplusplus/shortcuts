/**
 * Checks tab content — combines the AI-interpreted checks/CI table with
 * a side-by-side merge readiness checklist.
 */

import { cn } from '../../ui';
import { checkStatusClass, findingTagClass } from './pr-mock-data';
import type { AiCheckRow, MergeReadinessItem } from './pr-mock-data';

interface PrChecksTableProps {
    rows: AiCheckRow[];
}

function statusLabel(status: AiCheckRow['status']): string {
    switch (status) {
        case 'ok':   return 'Passed';
        case 'warn': return 'Needs review';
        case 'fail': return 'Failed';
    }
}

export function PrChecksTable({ rows }: PrChecksTableProps) {
    const passingCount = rows.filter(row => row.status === 'ok').length;

    return (
        <div
            className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900"
            data-testid="pr-checks-table"
        >
            <header className="flex items-center justify-between gap-3 border-b border-gray-200 bg-gray-50 px-4 py-2.5 dark:border-gray-700 dark:bg-gray-800/60">
                <h2 className="m-0 text-sm font-semibold text-gray-900 dark:text-gray-100">
                    Checks and CI
                </h2>
                <span className="inline-flex items-center gap-1 rounded-full bg-green-600 px-2.5 py-1 text-[11px] font-semibold text-white">
                    {passingCount} passing
                </span>
            </header>
            <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                    <thead>
                        <tr className="bg-gray-50 dark:bg-gray-800/60">
                            <th className="border-b border-gray-200 px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:border-gray-700 dark:text-gray-400">
                                Check
                            </th>
                            <th className="border-b border-gray-200 px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:border-gray-700 dark:text-gray-400">
                                Status
                            </th>
                            <th className="border-b border-gray-200 px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:border-gray-700 dark:text-gray-400">
                                Duration
                            </th>
                            <th className="border-b border-gray-200 px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:border-gray-700 dark:text-gray-400">
                                AI interpretation
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
                                <td className="px-3 py-2.5 align-top text-sm text-gray-800 dark:text-gray-200">
                                    {row.name}
                                </td>
                                <td className={cn('px-3 py-2.5 align-top text-sm font-semibold', checkStatusClass(row.status))}>
                                    {statusLabel(row.status)}
                                </td>
                                <td className="px-3 py-2.5 align-top font-mono text-xs tabular-nums text-gray-500 dark:text-gray-400">
                                    {row.duration}
                                </td>
                                <td className="px-3 py-2.5 align-top text-xs text-gray-600 dark:text-gray-400">
                                    {row.interpretation}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
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
            className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900"
            data-testid="pr-merge-readiness"
        >
            <header className="flex items-center justify-between gap-3 border-b border-gray-200 bg-gray-50 px-4 py-2.5 dark:border-gray-700 dark:bg-gray-800/60">
                <h2 className="m-0 text-sm font-semibold text-gray-900 dark:text-gray-100">
                    Merge readiness
                </h2>
                <span
                    className={cn(
                        'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold',
                        blocked
                            ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200'
                            : 'bg-green-600 text-white',
                    )}
                >
                    {blocked ? 'Almost' : 'Ready'}
                </span>
            </header>
            <ul className="m-0 grid list-none gap-2 p-4">
                {items.map((item, idx) => (
                    <li
                        key={`${item.tag}-${idx}`}
                        className="grid items-start gap-2.5 text-[13px] text-gray-700 dark:text-gray-300"
                        style={{ gridTemplateColumns: '64px 1fr' }}
                        data-testid="pr-merge-readiness-item"
                    >
                        <span
                            className={cn(
                                'self-start rounded-full px-1.5 py-0.5 text-center text-[10px] font-bold uppercase tracking-wide',
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
