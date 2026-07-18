/**
 * Review summary panel built from deterministic provider facts: PR description,
 * diff stats, checks, reviewers, and comment threads.
 */

import { useMemo } from 'react';
import { Marked } from 'marked';
import { mathMarkedExtension } from '../../../shared/math/mathMarkedExtension';
import { cn } from '../../ui';
import { findingTagClass } from './pr-derived-data';
import { ReviewerBadge } from './ReviewerBadge';
import type { Reviewer } from './pr-utils';
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
}).use(mathMarkedExtension);

interface PrReviewSummaryPanelProps {
    summary: PrReviewSummary;
    reviewers?: Reviewer[];
    labels?: string[];
    url?: string;
}

export function PrReviewSummaryPanel({ summary, reviewers, labels, url }: PrReviewSummaryPanelProps) {
    const summaryHtml = useMemo(
        () => summary.summary ? String(summaryMarked.parse(summary.summary)) : '',
        [summary.summary],
    );
    const reviewerList = reviewers ?? [];
    const labelList = labels ?? [];

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
                <div className="flex items-center gap-1.5">
                    {url && (
                        <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[11px] text-blue-600 hover:underline dark:text-blue-400"
                        >
                            Open in browser
                        </a>
                    )}
                </div>
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

                {reviewerList.length > 0 && (
                    <div className="mt-2" data-testid="reviewers-section">
                        <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-normal text-gray-500 dark:text-gray-400">
                            Reviewers
                        </h3>
                        <div className="space-y-1">
                            {reviewerList.map((reviewer, idx) => (
                                <ReviewerBadge key={idx} reviewer={reviewer} />
                            ))}
                        </div>
                    </div>
                )}

                {labelList.length > 0 && (
                    <div className="mt-2" data-testid="labels-section">
                        <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-normal text-gray-500 dark:text-gray-400">
                            Labels
                        </h3>
                        <div className="flex flex-wrap gap-1">
                            {labelList.map((label, idx) => (
                                <span
                                    key={idx}
                                    className="rounded bg-gray-100 px-1 py-px text-[11px] text-gray-700 dark:bg-gray-700 dark:text-gray-300"
                                    data-testid="label-chip"
                                >
                                    {label}
                                </span>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </article>
    );
}
