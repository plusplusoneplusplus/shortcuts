/**
 * AI review summary panel — shows the AI-generated digest for the PR
 * including the headline copy, a metric grid, and bulleted findings.
 */

import { cn } from '../../ui';
import { findingTagClass } from './pr-mock-data';
import type { AiSummary } from './pr-mock-data';

interface PrAiSummaryPanelProps {
    summary: AiSummary;
}

export function PrAiSummaryPanel({ summary }: PrAiSummaryPanelProps) {
    return (
        <article
            className="relative overflow-hidden rounded-[5px] border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900"
            data-testid="pr-ai-summary"
        >
            <span
                aria-hidden="true"
                className="absolute inset-y-0 left-0 w-[3px] bg-gradient-to-br from-purple-500 to-blue-500"
            />
            <header className="flex min-h-[30px] items-center justify-between gap-1.5 border-b border-gray-200 bg-gradient-to-b from-purple-50 to-white px-2 py-1 dark:border-gray-700 dark:from-purple-900/30 dark:to-gray-900">
                <h2 className="m-0 text-[13px] font-semibold leading-tight text-gray-900 dark:text-gray-100">
                    AI review summary
                </h2>
                <span className="inline-flex min-h-[20px] items-center gap-1 rounded-full bg-purple-100 px-1.5 py-0.5 text-[11px] font-semibold text-purple-700 dark:bg-purple-900/40 dark:text-purple-200">
                    Generated from diff, checks, and threads
                </span>
            </header>
            <div className="p-2">
                <p
                    className="m-0 mb-1.5 text-[13px] leading-[1.38] text-gray-800 dark:text-gray-200"
                    data-testid="pr-ai-summary-copy"
                >
                    {summary.summary}
                </p>
                <div className="mb-1.5 grid grid-cols-2 gap-[5px] sm:grid-cols-4" data-testid="pr-ai-metrics">
                    {summary.metrics.map(metric => (
                        <div
                            key={metric.key}
                            className="rounded-md border border-gray-200 bg-gray-50 px-[7px] py-[5px] dark:border-gray-700 dark:bg-gray-800/60"
                        >
                            <div className="text-[10px] font-semibold uppercase tracking-normal text-gray-500 dark:text-gray-400">
                                {metric.key}
                            </div>
                            <div className="mt-px text-[16px] font-semibold leading-[1.08] tabular-nums text-gray-900 dark:text-gray-100">
                                {metric.value}
                            </div>
                        </div>
                    ))}
                </div>
                <ul className="m-0 grid list-none gap-1 p-0" data-testid="pr-ai-findings">
                    {summary.findings.map((finding, idx) => (
                        <li
                            key={`${finding.tag}-${idx}`}
                            className="grid items-start gap-1.5 text-[12px] leading-snug text-gray-700 dark:text-gray-300"
                            style={{ gridTemplateColumns: '56px 1fr' }}
                        >
                            <span
                                className={cn(
                                    'self-start rounded-full px-1.5 py-0.5 text-center text-[10px] font-bold uppercase tracking-normal leading-[1.4]',
                                    findingTagClass(finding.tag),
                                )}
                            >
                                {finding.label}
                            </span>
                            <span>{finding.body}</span>
                        </li>
                    ))}
                </ul>
            </div>
        </article>
    );
}
