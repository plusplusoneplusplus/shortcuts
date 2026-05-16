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
            className="relative overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900"
            data-testid="pr-ai-summary"
        >
            <span
                aria-hidden="true"
                className="absolute inset-y-0 left-0 w-[3px] bg-gradient-to-br from-purple-500 to-blue-500"
            />
            <header className="flex items-center justify-between gap-3 border-b border-gray-200 bg-gradient-to-b from-purple-50 to-white px-4 py-2.5 dark:border-gray-700 dark:from-purple-900/30 dark:to-gray-900">
                <h2 className="m-0 text-sm font-semibold text-gray-900 dark:text-gray-100">
                    AI review summary
                </h2>
                <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2.5 py-1 text-[11px] font-semibold text-purple-700 dark:bg-purple-900/40 dark:text-purple-200">
                    Generated from diff, checks, and threads
                </span>
            </header>
            <div className="px-4 py-4">
                <p
                    className="m-0 mb-3.5 text-[15px] leading-snug text-gray-800 dark:text-gray-200"
                    data-testid="pr-ai-summary-copy"
                >
                    {summary.summary}
                </p>
                <div className="mb-3.5 grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="pr-ai-metrics">
                    {summary.metrics.map(metric => (
                        <div
                            key={metric.key}
                            className="rounded-md border border-gray-200 bg-gray-50 p-2.5 dark:border-gray-700 dark:bg-gray-800/60"
                        >
                            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                {metric.key}
                            </div>
                            <div className="mt-0.5 text-lg font-semibold leading-tight tabular-nums text-gray-900 dark:text-gray-100">
                                {metric.value}
                            </div>
                        </div>
                    ))}
                </div>
                <ul className="m-0 grid list-none gap-2 p-0" data-testid="pr-ai-findings">
                    {summary.findings.map((finding, idx) => (
                        <li
                            key={`${finding.tag}-${idx}`}
                            className="grid items-start gap-2.5 text-[13px] text-gray-700 dark:text-gray-300"
                            style={{ gridTemplateColumns: '64px 1fr' }}
                        >
                            <span
                                className={cn(
                                    'self-start rounded-full px-1.5 py-0.5 text-center text-[10px] font-bold uppercase tracking-wide',
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
