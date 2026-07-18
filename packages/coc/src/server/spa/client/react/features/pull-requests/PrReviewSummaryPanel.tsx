/**
 * Review summary panel built from deterministic provider facts: PR description,
 * diff stats, checks, reviewers, and comment threads.
 */

import { useMemo } from 'react';
import { Marked } from 'marked';
import { cn } from '../../ui';
import { findingTagClass } from './pr-derived-data';
import type { PrReviewSummary } from './pr-detail-summary';

const summaryMarked = new Marked({
    gfm: true,
    breaks: true,
    renderer: {
        link(href: string, _title: string | null | undefined, text: string) {
            if (href && /^mailto:/i.test(href)) {
                return `<span>${text}</span>`;
            }
            return `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;
        },
    },
});

interface PrReviewSummaryPanelProps {
    summary: PrReviewSummary;
}

export function PrReviewSummaryPanel({ summary }: PrReviewSummaryPanelProps) {
    const summaryHtml = useMemo(
        () => summary.summary ? String(summaryMarked.parse(summary.summary)) : '',
        [summary.summary],
    );

    return (
        <article
            className="relative overflow-hidden rounded-[5px] border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900"
            data-testid="pr-review-summary"
        >
            <span
                aria-hidden="true"
                className="absolute inset-y-0 left-0 w-[3px] bg-gradient-to-br from-blue-500 to-cyan-500"
            />
            <header className="flex min-h-[30px] items-center justify-between gap-1.5 border-b border-gray-200 bg-gradient-to-b from-blue-50 to-white px-2 py-1 dark:border-gray-700 dark:from-blue-900/30 dark:to-gray-900">
                <h2 className="m-0 text-[13px] font-semibold leading-tight text-gray-900 dark:text-gray-100">
                    Review summary
                </h2>
                <span className="inline-flex min-h-[20px] items-center gap-1 rounded-full bg-blue-100 px-1.5 py-0.5 text-[11px] font-semibold text-blue-700 dark:bg-blue-900/40 dark:text-blue-200">
                    Provider facts
                </span>
            </header>
            <div className="p-2">
                <div
                    className="markdown-body m-0 mb-1.5 text-[13px] leading-[1.38] text-gray-800 dark:text-gray-200"
                    data-testid="pr-review-summary-copy"
                    dangerouslySetInnerHTML={{ __html: summaryHtml }}
                />
                <ul className="m-0 grid list-none gap-1 p-0" data-testid="pr-review-findings">
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
