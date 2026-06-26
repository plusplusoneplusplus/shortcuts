/**
 * ComposerPrReviewersPopover — lightweight reviewer approval details for the
 * in-composer PR chip's compact reviewer-count badge.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import {
    reviewerDisplayName,
    reviewVoteIcon,
    type Reviewer,
    type ReviewerApprovalSummary,
} from '../../pull-requests/pr-utils';

export interface ComposerPrReviewersPopoverProps {
    anchorRef: React.RefObject<HTMLElement>;
    summary: ReviewerApprovalSummary;
    prNumber: number | string;
    itemKey: string;
    onClose: () => void;
}

const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 6;

function ReviewerRow({ reviewer, testId }: { reviewer: Reviewer; testId: string }) {
    const { icon, label } = reviewVoteIcon(reviewer.vote);
    const name = reviewerDisplayName(reviewer);
    return (
        <li
            className="flex items-center gap-1.5 rounded px-1 py-0.5 text-[11px] leading-snug hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
            data-testid={testId}
            data-vote={reviewer.vote ?? ''}
        >
            <span className="shrink-0" title={label} aria-hidden="true">{icon}</span>
            <span className="min-w-0 flex-1 truncate text-[#1f2328] dark:text-[#c9d1d9]" title={name}>
                {name}
            </span>
            {reviewer.isRequired && (
                <span className="shrink-0 rounded bg-black/[0.06] px-1 text-[10px] text-[#57606a] dark:bg-white/[0.08] dark:text-[#8b949e]">
                    required
                </span>
            )}
            <span className="shrink-0 font-medium text-[#57606a] dark:text-[#8b949e]">{label}</span>
        </li>
    );
}

function ReviewerSection({
    title,
    reviewers,
    emptyText,
    titleClassName,
    rowTestId,
}: {
    title: string;
    reviewers: readonly Reviewer[];
    emptyText: string;
    titleClassName: string;
    rowTestId: string;
}) {
    return (
        <section className="mb-2 last:mb-0">
            <div className={`mb-1 px-1 text-[11px] font-semibold ${titleClassName}`}>{title}</div>
            {reviewers.length === 0 ? (
                <div className="px-1 py-0.5 text-[11px] text-[#57606a] dark:text-[#8b949e]">{emptyText}</div>
            ) : (
                <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                    {reviewers.map((reviewer, index) => (
                        <ReviewerRow key={`${reviewerDisplayName(reviewer)}-${index}`} reviewer={reviewer} testId={rowTestId} />
                    ))}
                </ul>
            )}
        </section>
    );
}

export function ComposerPrReviewersPopover({ anchorRef, summary, prNumber, itemKey, onClose }: ComposerPrReviewersPopoverProps) {
    const popoverRef = useRef<HTMLDivElement | null>(null);
    const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

    useLayoutEffect(() => {
        const anchor = anchorRef.current;
        const popover = popoverRef.current;
        if (!anchor || !popover) return;
        const a = anchor.getBoundingClientRect();
        const p = popover.getBoundingClientRect();

        let left = a.right - p.width;
        if (left + p.width > window.innerWidth - VIEWPORT_MARGIN) {
            left = window.innerWidth - p.width - VIEWPORT_MARGIN;
        }
        if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN;

        let top = a.top - p.height - ANCHOR_GAP;
        if (top < VIEWPORT_MARGIN) top = a.bottom + ANCHOR_GAP;

        setPos({ top, left });
    }, [anchorRef, summary.approvedCount, summary.waitingCount, summary.blockedCount]);

    useEffect(() => {
        const handler = (e: MouseEvent | TouchEvent) => {
            const target = e.target as Node | null;
            if (!target) return;
            if (popoverRef.current?.contains(target)) return;
            if (anchorRef.current?.contains(target)) return;
            onClose();
        };
        document.addEventListener('mousedown', handler);
        document.addEventListener('touchstart', handler);
        return () => {
            document.removeEventListener('mousedown', handler);
            document.removeEventListener('touchstart', handler);
        };
    }, [anchorRef, onClose]);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [onClose]);

    return ReactDOM.createPortal(
        <div
            ref={popoverRef}
            role="dialog"
            aria-label={`Reviewers for pull request #${prNumber}`}
            data-testid={`composer-pr-chip-reviewers-popover-${itemKey}`}
            className="fixed z-[10003] w-[320px] max-w-[calc(100vw-16px)] rounded-md border border-[#d0d7de] bg-white p-2 shadow-lg dark:border-[#3c3c3c] dark:bg-[#252526]"
            style={{
                top: pos?.top ?? -9999,
                left: pos?.left ?? -9999,
                visibility: pos ? 'visible' : 'hidden',
            }}
            onMouseDown={e => e.stopPropagation()}
        >
            <div className="mb-2 px-1 text-[11px] font-semibold text-[#1f2328] dark:text-[#c9d1d9]">
                {summary.approvedCount}/{summary.total} reviewers approved
            </div>
            <ReviewerSection
                title="Approved reviewers"
                reviewers={summary.approved}
                emptyText="No approvals yet."
                titleClassName="text-[#1a7f37] dark:text-[#3fb950]"
                rowTestId="composer-pr-chip-reviewer-approved-row"
            />
            <ReviewerSection
                title="Waiting reviewers"
                reviewers={summary.waiting}
                emptyText="No reviewers waiting."
                titleClassName="text-[#9a6700] dark:text-[#d29922]"
                rowTestId="composer-pr-chip-reviewer-waiting-row"
            />
            {summary.blockedCount > 0 && (
                <ReviewerSection
                    title="Change requested / blocked"
                    reviewers={summary.blocked}
                    emptyText="No blocking reviewers."
                    titleClassName="text-[#cf222e] dark:text-[#f85149]"
                    rowTestId="composer-pr-chip-reviewer-blocked-row"
                />
            )}
        </div>,
        document.body,
    );
}
