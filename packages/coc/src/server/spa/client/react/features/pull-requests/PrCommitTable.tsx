/**
 * Commit intent table — shows each commit alongside an AI-detected
 * intent label (feat/fix/docs/test/refactor) and short note.
 */

import { cn } from '../../ui';
import { commitIntentClass } from './pr-mock-data';
import type { AiCommitRow } from './pr-mock-data';

interface PrCommitTableProps {
    rows: AiCommitRow[];
}

export function PrCommitTable({ rows }: PrCommitTableProps) {
    return (
        <div
            className="overflow-hidden rounded-[5px] border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900"
            data-testid="pr-commit-table"
        >
            <header className="flex min-h-[30px] items-center justify-between gap-1.5 border-b border-gray-200 bg-gray-50 px-2 py-1 dark:border-gray-700 dark:bg-gray-800/60">
                <h2 className="m-0 text-[13px] font-semibold leading-tight text-gray-900 dark:text-gray-100">
                    Commit intent
                </h2>
                <span className="inline-flex min-h-[20px] items-center gap-1 rounded-full bg-purple-100 px-1.5 py-0.5 text-[11px] font-semibold text-purple-700 dark:bg-purple-900/40 dark:text-purple-200">
                    AI labels are editable
                </span>
            </header>
            <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[12px]">
                    <thead>
                        <tr className="bg-gray-50 dark:bg-gray-800/60">
                            <th className="border-b border-gray-200 px-[7px] py-[5px] text-left text-[11px] font-semibold uppercase tracking-normal text-gray-500 dark:border-gray-700 dark:text-gray-400">
                                Commit
                            </th>
                            <th className="border-b border-gray-200 px-[7px] py-[5px] text-left text-[11px] font-semibold uppercase tracking-normal text-gray-500 dark:border-gray-700 dark:text-gray-400">
                                Intent
                            </th>
                            <th className="border-b border-gray-200 px-[7px] py-[5px] text-left text-[11px] font-semibold uppercase tracking-normal text-gray-500 dark:border-gray-700 dark:text-gray-400">
                                AI note
                            </th>
                            <th className="border-b border-gray-200 px-[7px] py-[5px] text-left text-[11px] font-semibold uppercase tracking-normal text-gray-500 dark:border-gray-700 dark:text-gray-400">
                                Hash
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(row => (
                            <tr
                                key={row.id}
                                className="border-b border-gray-100 last:border-0 dark:border-gray-800"
                                data-testid="pr-commit-row"
                            >
                                <td className="px-[7px] py-[5px] align-top text-[12px] text-gray-800 dark:text-gray-200">
                                    {row.title}
                                </td>
                                <td className="px-[7px] py-[5px] align-top">
                                    <span
                                        className={cn(
                                            'inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-normal leading-[1.4]',
                                            commitIntentClass(row.intent),
                                        )}
                                    >
                                        {row.intent}
                                    </span>
                                </td>
                                <td className="px-[7px] py-[5px] align-top text-[11px] text-gray-500 dark:text-gray-400">
                                    {row.note}
                                </td>
                                <td className="px-[7px] py-[5px] align-top font-mono text-[11px] tabular-nums text-gray-500 dark:text-gray-400">
                                    {row.hash}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
