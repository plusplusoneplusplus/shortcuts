/**
 * Review summary panel built from deterministic provider facts: PR description,
 * diff stats, checks, reviewers, and comment threads.
 */

import { useMemo } from 'react';
import { Marked } from 'marked';
import { mathMarkedExtension } from '../../../shared/math/mathMarkedExtension';
import { cn } from '../../ui';
import { ReviewerBadge } from './ReviewerBadge';
import type { Reviewer } from './pr-utils';
import type { PrReviewFindingTag, PrReviewSummary } from './pr-detail-summary';

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
}

const CO_AUTHOR_TRAILER = /^[ \t]*Co-authored-by:.*(?:\r?\n|$)/gim;

/** Drop git `Co-authored-by:` trailers — they are noise in the summary body. */
export function stripCoAuthorTrailers(text: string): string {
    return text.replace(CO_AUTHOR_TRAILER, '').trim();
}

const FINDING_ICON: Record<PrReviewFindingTag, { icon: string; className: string }> = {
    good: { icon: '✓', className: 'text-green-600 dark:text-green-400' },
    risk: { icon: '!', className: 'text-orange-600 dark:text-orange-400' },
    note: { icon: 'i', className: 'text-gray-400 dark:text-gray-500' },
};

export function PrReviewSummaryPanel({ summary, reviewers, labels }: PrReviewSummaryPanelProps) {
    const reviewerList = reviewers ?? [];
    const labelList = labels ?? [];

    return (
        <section data-testid="pr-review-summary">
            <h2 className="m-0 mb-2 text-[15px] font-semibold text-gray-900 dark:text-gray-100">Summary</h2>
            <PrDescription description={stripCoAuthorTrailers(summary.summary)} />
            <ul className="m-0 grid list-none gap-1 p-0" data-testid="pr-review-findings">
                {summary.findings.map((finding, idx) => {
                    const icon = FINDING_ICON[finding.tag];
                    return (
                        <li
                            key={`${finding.tag}-${idx}`}
                            className="flex items-start gap-2 text-[12px] leading-snug text-gray-600 dark:text-gray-400"
                            data-tag={finding.tag}
                        >
                            <span aria-label={finding.label} className={cn('w-3 shrink-0 text-center font-semibold', icon.className)}>
                                {icon.icon}
                            </span>
                            <span>{finding.body}</span>
                        </li>
                    );
                })}
            </ul>

            {reviewerList.length > 0 && (
                <div className="mt-3" data-testid="reviewers-section">
                    <h3 className="mb-1 text-[12px] font-medium text-gray-500 dark:text-gray-400">Reviewers</h3>
                    <div className="space-y-1">
                        {reviewerList.map((reviewer, idx) => (
                            <ReviewerBadge key={idx} reviewer={reviewer} />
                        ))}
                    </div>
                </div>
            )}

            {labelList.length > 0 && (
                <div className="mt-3" data-testid="labels-section">
                    <h3 className="mb-1 text-[12px] font-medium text-gray-500 dark:text-gray-400">Labels</h3>
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
        </section>
    );
}

export function PrDescription({ description }: { description: string }) {
    const summaryHtml = useMemo(
        () => description ? String(summaryMarked.parse(description)) : '',
        [description],
    );
    return (
        <div
            className="markdown-body m-0 mb-1.5 min-w-0 overflow-x-auto break-words text-[13px] leading-[1.38] text-gray-800 dark:text-gray-200"
            data-testid="pr-review-summary-copy"
            dangerouslySetInnerHTML={{ __html: summaryHtml }}
        />
    );
}
