/**
 * ComposerPrChecksPopover — click-opened popover that lists a PR's FAILED CI
 * checks, each linking to its provider (GitHub / Azure DevOps) details page.
 *
 * Anchored to the in-composer chip's checks badge ({@link ComposerPrChip}) and
 * rendered through a React portal so the composer card's `overflow-hidden` can't
 * clip it. The chip docks at the bottom of the viewport, so the popover prefers
 * to open ABOVE the badge and only falls back below when there is no room.
 * Closes on outside-click, Escape, or following one of its links.
 *
 * Reuses the shared check-status helpers ({@link checkStatusEmoji} /
 * {@link checkStatusLabel} / {@link checkStatusClass}) — no copy-pasted
 * check-status logic.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { cn } from '../../../ui/cn';
import { checkStatusEmoji, checkStatusLabel } from '../../pull-requests/PrChecksSummary';
import { checkStatusClass } from '../../pull-requests/pr-derived-data';
import type { PrCheckRow } from '../../pull-requests/pr-derived-data';

export interface ComposerPrChecksPopoverProps {
    /** The badge button the popover anchors to (for positioning + outside-click). */
    anchorRef: React.RefObject<HTMLElement>;
    /** Failed check rows to list — callers pass only `status === 'failure'`. */
    failed: readonly PrCheckRow[];
    /** PR number, for the popover's heading + accessible label. */
    prNumber: number | string;
    /** Item key — namespaces the data-testids so stacked chips don't collide. */
    itemKey: string;
    /** Close the popover (outside-click, Escape, or link follow). */
    onClose: () => void;
}

/** Margin (px) kept between the popover and the viewport edges. */
const VIEWPORT_MARGIN = 8;
/** Gap (px) between the popover and its anchor badge. */
const ANCHOR_GAP = 6;

export function ComposerPrChecksPopover({ anchorRef, failed, prNumber, itemKey, onClose }: ComposerPrChecksPopoverProps) {
    const popoverRef = useRef<HTMLDivElement | null>(null);
    const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

    // Position above the badge (the chip docks at the bottom of the viewport);
    // measured after layout so the popover's own size is known. Falls back below
    // only when there is no room above, and clamps within the viewport.
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
    }, [anchorRef, failed.length]);

    // Close on outside click / touch.
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

    // Close on Escape.
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
            aria-label={`Failed checks for pull request #${prNumber}`}
            data-testid={`composer-pr-chip-checks-popover-${itemKey}`}
            className="fixed z-[10003] w-[340px] max-w-[calc(100vw-16px)] rounded-md border border-[#d0d7de] dark:border-[#3c3c3c] bg-white dark:bg-[#252526] p-2 shadow-lg"
            style={{
                top: pos?.top ?? -9999,
                left: pos?.left ?? -9999,
                // Hidden for the first paint until measured, so it never flashes at 0,0.
                visibility: pos ? 'visible' : 'hidden',
            }}
            // Keep an in-popover click from bubbling to the document outside-click handler.
            onMouseDown={e => e.stopPropagation()}
        >
            <div className="mb-1 px-1 text-[11px] font-semibold text-[#cf222e] dark:text-[#f85149]">
                {failed.length} failed {failed.length === 1 ? 'check' : 'checks'}
            </div>
            <ul className="m-0 flex max-h-[260px] list-none flex-col gap-0.5 overflow-y-auto p-0">
                {failed.map(row => (
                    <li
                        key={row.id}
                        className="flex items-center gap-1.5 rounded px-1 py-0.5 text-[11px] leading-snug hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                        data-testid="composer-pr-chip-checks-failed-row"
                        data-status={row.status}
                    >
                        <span className={cn('shrink-0 font-semibold', checkStatusClass(row.status))} aria-hidden="true">
                            {checkStatusEmoji(row.status)}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[#1f2328] dark:text-[#c9d1d9]" title={row.name}>
                            {row.detailsUrl ? (
                                <a
                                    href={row.detailsUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-[#0969da] hover:underline dark:text-[#58a6ff]"
                                    data-testid="composer-pr-chip-checks-failed-link"
                                    onClick={onClose}
                                >
                                    {row.name}
                                </a>
                            ) : (
                                row.name
                            )}
                        </span>
                        <span className={cn('shrink-0 font-medium', checkStatusClass(row.status))}>
                            {checkStatusLabel(row.status)}
                        </span>
                        {row.duration && (
                            <span className="shrink-0 font-mono tabular-nums text-[#57606a] dark:text-[#8b949e]">
                                {row.duration}
                            </span>
                        )}
                    </li>
                ))}
            </ul>
        </div>,
        document.body,
    );
}
