/**
 * ComposerPrChecksPopover — click-opened popover that opens from the CI badge
 * and shows live check counts, a drill-down list of the checks in the selected
 * count category, two toggles (Auto-fix CI & address comments, Auto-merge when
 * ready), and an Auto-archive settings link.
 *
 * The three count rows (In progress / Passed / Failed) are buttons that filter
 * the list below them; it opens on Failed and clicking the active category
 * returns to it.
 *
 * Anchored to the in-composer chip's checks badge ({@link ComposerPrChip}) and
 * rendered through a React portal so the composer card's `overflow-hidden` can't
 * clip it. The chip docks at the bottom of the viewport, so the popover prefers
 * to open ABOVE the badge and only falls back below when there is no room.
 * Closes on outside-click, Escape, or following one of its links.
 *
 * Reuses the shared check-status helpers ({@link checkStatusEmoji} /
 * {@link checkStatusLabel} / {@link checkStatusClass}) — no copy-pasted
 * check-status logic. The count summary is computed via {@link summarizeCheckRows}.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { cn } from '../../../ui/cn';
import { checkStatusEmoji, checkStatusLabel, checkSummaryBucket, summarizeCheckRows } from '../../pull-requests/PrChecksSummary';
import { checkStatusClass } from '../../pull-requests/pr-derived-data';
import type { PrCheckRow } from '../../pull-requests/pr-derived-data';

/**
 * CI auto-fix controls surfaced in the failed-checks popover (AC-05). Present
 * only when the triggers feature is enabled; the toggle arms/disarms a
 * `ci-failure` monitor for this PR and "Fix now" sends one fix message.
 */
export interface ComposerPrChecksAutoFix {
    /** Whether the triggers feature flag is on (controls render only when true). */
    enabled: boolean;
    /** Whether a monitor is currently armed for this PR. */
    armed: boolean;
    /** A network op is in flight — disables the controls. */
    busy: boolean;
    /** Non-null disables BOTH controls and supplies a tooltip (unresolved context / busy). */
    disabledReason: string | null;
    /**
     * Non-null disables ONLY "Fix now" (e.g. nothing is failing right now) with
     * this tooltip; the arm/disarm toggle stays usable. The toggle is
     * forward-looking — a monitor can be armed before any failure — so it must
     * remain available even when there is nothing to fix yet.
     */
    fixNowDisabledReason: string | null;
    /** Toggle the monitor on/off (receives the desired next armed state). */
    onToggle: (next: boolean) => void;
    /** Send one fix message immediately (no monitor). */
    onFixNow: () => void;
}

/** Auto-merge toggle wired to the server mutation (Phase 2). */
export interface ComposerPrChecksAutoMerge {
    /** Current enabled state (optimistic — flips immediately on click). */
    enabled: boolean;
    /** Mutation in flight. */
    busy: boolean;
    /** Non-null disables the toggle with this tooltip. */
    disabledReason: string | null;
    /** Toggle auto-merge on/off (receives the desired next state). */
    onToggle: (next: boolean) => void;
}

export interface ComposerPrChecksPopoverProps {
    /** The badge button the popover anchors to (for positioning + outside-click). */
    anchorRef: React.RefObject<HTMLElement>;
    /**
     * Failed check rows — callers pass only `status === 'failure'`. Used as the
     * list source when `allRows` is absent.
     */
    failed: readonly PrCheckRow[];
    /**
     * All check rows — the source for both the In progress / Passed / Failed
     * count summary and the drill-down list under the selected category.
     */
    allRows?: readonly PrCheckRow[];
    /** PR number, for the accessible label. */
    prNumber: number | string;
    /** Item key — namespaces the data-testids so stacked chips don't collide. */
    itemKey: string;
    /** Close the popover (outside-click, Escape, or link follow). */
    onClose: () => void;
    /** CI auto-fix controls (AC-05). Omit to render the popover without them. */
    autoFix?: ComposerPrChecksAutoFix;
    /** External PR link shown as the ↗ icon in the header. Omit when no provider URL. */
    openHref?: string;
    /** Auto-merge toggle wired to the server mutation. Omit when unavailable. */
    autoMerge?: ComposerPrChecksAutoMerge;
    /** Hash link to the auto-archive settings section (e.g. `#repos/{id}/settings/preferences`). */
    archiveSettingsHref?: string;
}

/**
 * The three clickable count categories. `bucket` is the {@link checkSummaryBucket}
 * value the category selects, so a row is listed under a category exactly when it
 * was counted there — one mapping, no divergence. Statuses outside these three
 * buckets (skipped / cancelled / warning / unknown) stay unreachable here.
 */
const CATEGORIES = [
    {
        bucket: 'pending' as const,
        /** Testid suffix — matches the pre-existing count testids. */
        id: 'pending',
        label: 'In progress',
        glyph: '●',
        glyphClass: 'text-[#0969da] dark:text-[#58a6ff]',
        emptyText: 'No checks in progress.',
    },
    {
        bucket: 'passing' as const,
        id: 'passed',
        label: 'Passed',
        glyph: '✓',
        glyphClass: 'text-[#1a7f37] dark:text-[#3fb950]',
        emptyText: 'No passing checks.',
    },
    {
        bucket: 'failing' as const,
        id: 'failed',
        label: 'Failed',
        glyph: '✕',
        glyphClass: 'text-[#cf222e] dark:text-[#f85149]',
        emptyText: 'No failing checks right now — arm auto-fix to catch the next failure.',
    },
];

type CheckCategory = (typeof CATEGORIES)[number]['bucket'];

/** The category the popover opens on — its initial view is today's failed drill-down. */
const DEFAULT_CATEGORY: CheckCategory = 'failing';

/** Margin (px) kept between the popover and the viewport edges. */
const VIEWPORT_MARGIN = 8;
/** Gap (px) between the popover and its anchor badge. */
const ANCHOR_GAP = 6;

/** Checkbox-like visual indicator (not a native `<input>`; paired with a button wrapper). */
function CheckboxMark({ checked, className }: { checked: boolean; className?: string }) {
    return (
        <span
            aria-hidden="true"
            className={cn(
                'inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border',
                checked
                    ? 'border-[#0969da] bg-[#0969da] dark:border-[#58a6ff] dark:bg-[#1f6feb]'
                    : 'border-[#8c959f] bg-white dark:border-[#6e7681] dark:bg-[#0d1117]',
                className,
            )}
        >
            {checked && (
                <svg width="8" height="8" viewBox="0 0 10 10" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 5l2.5 2.5L8 3" />
                </svg>
            )}
        </span>
    );
}

export function ComposerPrChecksPopover({
    anchorRef,
    failed,
    allRows,
    prNumber,
    itemKey,
    onClose,
    autoFix,
    openHref,
    autoMerge,
    archiveSettingsHref,
}: ComposerPrChecksPopoverProps) {
    const popoverRef = useRef<HTMLDivElement | null>(null);
    const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

    // Which count category the drill-down list is showing. Opens on "Failed" and
    // resets to it on every open (the popover unmounts when closed); clicking the
    // active category clears back to the default.
    const [category, setCategory] = useState<CheckCategory>(DEFAULT_CATEGORY);

    const summary = allRows && allRows.length > 0 ? summarizeCheckRows(allRows) : null;
    // `allRows` carries every check; `failed` is the pre-filtered failure subset the
    // caller still uses for "Fix now", and is the only source when no rows were passed.
    const listSource = allRows ?? failed;
    const listed = listSource.filter(row => checkSummaryBucket(row.status) === category);
    const activeCategory = CATEGORIES.find(c => c.bucket === category)!;

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
        // Re-measured when the category changes too, so the popover stays glued to
        // the badge as the list's height changes instead of drifting off the anchor.
    }, [anchorRef, failed.length, allRows?.length, category]);

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

    const showArchive = Boolean(archiveSettingsHref);
    const showAutoFix = Boolean(autoFix?.enabled);
    const showToggles = showAutoFix;

    return ReactDOM.createPortal(
        <div
            ref={popoverRef}
            role="dialog"
            aria-label={`CI monitoring for pull request #${prNumber}`}
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
            {/* ── Header ───────────────────────────────────────────────────── */}
            <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-[11px] font-semibold text-[#1f2328] dark:text-[#c9d1d9]">
                    CI monitoring
                </span>
                {openHref && (
                    <a
                        href={openHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex h-5 w-5 items-center justify-center rounded text-[#57606a] hover:bg-black/[0.05] hover:text-[#0969da] dark:text-[#8b949e] dark:hover:bg-white/[0.08] dark:hover:text-[#58a6ff]"
                        title="Open pull request"
                        data-testid={`composer-pr-chip-popover-open-${itemKey}`}
                        onClick={onClose}
                    >
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M6.5 2H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V9.5" />
                            <path d="M10 2h4v4" />
                            <path d="M14 2L8.5 7.5" />
                        </svg>
                    </a>
                )}
            </div>

            {/* ── Count summary — each row filters the drill-down below ─────── */}
            {summary && (
                <div
                    className="mb-2 flex flex-col gap-0.5"
                    data-testid={`composer-pr-chip-counts-${itemKey}`}
                >
                    {CATEGORIES.map(c => {
                        const active = c.bucket === category;
                        return (
                            <button
                                key={c.bucket}
                                type="button"
                                aria-pressed={active}
                                title={`Show ${c.label.toLowerCase()} checks`}
                                data-testid={`composer-pr-chip-category-${c.id}-${itemKey}`}
                                data-active={active ? 'true' : 'false'}
                                // Clicking the active category clears the filter back to Failed.
                                onClick={() => setCategory(active ? DEFAULT_CATEGORY : c.bucket)}
                                className={cn(
                                    'flex w-full items-center justify-between rounded px-1 py-0.5 text-[11px]',
                                    'cursor-pointer border-none text-left',
                                    active
                                        ? 'bg-[#ddf4ff] font-medium dark:bg-[#388bfd]/25'
                                        : 'bg-transparent hover:bg-black/[0.04] dark:hover:bg-white/[0.06]',
                                )}
                            >
                                <span className="flex items-center gap-1.5">
                                    <span aria-hidden="true" className={cn('font-semibold', c.glyphClass)}>{c.glyph}</span>
                                    <span className={active ? 'text-[#1f2328] dark:text-[#c9d1d9]' : 'text-[#57606a] dark:text-[#8b949e]'}>
                                        {c.label}
                                    </span>
                                </span>
                                <span
                                    className={cn(
                                        'font-mono font-medium tabular-nums',
                                        active ? 'text-[#1f2328] dark:text-[#c9d1d9]' : 'text-[#57606a] dark:text-[#8b949e]',
                                    )}
                                    data-testid={`composer-pr-chip-counts-${c.id}-${itemKey}`}
                                >
                                    {summary[c.bucket]}
                                </span>
                            </button>
                        );
                    })}
                </div>
            )}

            {/* ── Check drill-down for the selected category ────────────────── */}
            {listed.length > 0 && (
                <ul
                    className="m-0 mb-2 flex max-h-[240px] list-none flex-col gap-0.5 overflow-y-auto p-0"
                    data-testid={`composer-pr-chip-checks-list-${itemKey}`}
                    data-category={category}
                >
                    {listed.map(row => (
                        <li
                            key={row.id}
                            className="flex items-center gap-1.5 rounded px-1 py-0.5 text-[11px] leading-snug hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                            data-testid="composer-pr-chip-checks-failed-row"
                            data-status={row.status}
                            data-name={row.name}
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
            )}

            {/* Empty state for the selected category. The auto-fix wording is reserved
                for Failed; the other two get a short neutral line. */}
            {listed.length === 0 && (
                <div
                    className="mb-2 px-1 py-1 text-[11px] text-[#57606a] dark:text-[#8b949e]"
                    data-testid={
                        category === DEFAULT_CATEGORY
                            ? `composer-pr-chip-checks-none-${itemKey}`
                            : `composer-pr-chip-checks-empty-${itemKey}`
                    }
                >
                    {activeCategory.emptyText}
                </div>
            )}

            {/* ── Toggles ──────────────────────────────────────────────────── */}
            {showToggles && (
                <div
                    className="flex flex-col gap-1 border-t border-[#d0d7de] dark:border-[#3c3c3c] pt-2"
                    data-testid={`composer-pr-chip-autofix-${itemKey}`}
                >
                    {/* Auto-fix CI & address comments */}
                    <div className="flex items-center justify-between gap-2">
                        <button
                            type="button"
                            role="checkbox"
                            aria-checked={autoFix!.armed}
                            disabled={Boolean(autoFix!.disabledReason) || autoFix!.busy}
                            title={autoFix!.disabledReason ?? (autoFix!.armed ? 'CI auto-fix is on — click to turn off' : 'Automatically fix failing CI and address review comments for this PR')}
                            data-testid={`composer-pr-chip-autofix-toggle-${itemKey}`}
                            data-armed={autoFix!.armed ? 'true' : 'false'}
                            onClick={() => autoFix!.onToggle(!autoFix!.armed)}
                            className={cn(
                                'inline-flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-[11px] text-[#1f2328] dark:text-[#c9d1d9]',
                                'cursor-pointer border-none bg-transparent text-left',
                                'hover:bg-black/[0.04] dark:hover:bg-white/[0.06]',
                                'disabled:cursor-default disabled:opacity-60',
                            )}
                        >
                            <CheckboxMark checked={autoFix!.armed} />
                            <span>Auto-fix CI &amp; address comments</span>
                        </button>
                        <button
                            type="button"
                            disabled={Boolean(autoFix!.disabledReason || autoFix!.fixNowDisabledReason)}
                            title={autoFix!.disabledReason ?? autoFix!.fixNowDisabledReason ?? 'Send one fix message now'}
                            data-testid={`composer-pr-chip-autofix-fixnow-${itemKey}`}
                            onClick={() => autoFix!.onFixNow()}
                            className={cn(
                                'shrink-0 inline-flex items-center gap-1 h-[24px] px-2 rounded-md text-[11px] font-medium cursor-pointer border-none',
                                'bg-[#0969da] text-white hover:bg-[#0a5cc2] dark:bg-[#1f6feb] dark:hover:bg-[#388bfd]',
                                'disabled:cursor-default disabled:opacity-60 disabled:hover:bg-[#0969da] dark:disabled:hover:bg-[#1f6feb]',
                            )}
                        >
                            Fix now
                        </button>
                    </div>

                    {/* Auto-merge when ready */}
                    {autoMerge ? (
                        <button
                            type="button"
                            role="checkbox"
                            aria-checked={autoMerge.enabled}
                            disabled={Boolean(autoMerge.disabledReason) || autoMerge.busy}
                            title={autoMerge.disabledReason ?? (autoMerge.enabled ? 'Auto-merge is on — click to turn off' : 'Enable auto-merge for this PR when all checks pass')}
                            data-testid={`composer-pr-chip-automerge-${itemKey}`}
                            data-enabled={autoMerge.enabled ? 'true' : 'false'}
                            onClick={() => autoMerge.onToggle(!autoMerge.enabled)}
                            className={cn(
                                'inline-flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-[11px] text-[#1f2328] dark:text-[#c9d1d9]',
                                'cursor-pointer border-none bg-transparent text-left',
                                'hover:bg-black/[0.04] dark:hover:bg-white/[0.06]',
                                'disabled:cursor-default disabled:opacity-60',
                            )}
                        >
                            <CheckboxMark checked={autoMerge.enabled} />
                            <span>Auto-merge when ready</span>
                        </button>
                    ) : (
                        <div
                            className="flex items-center gap-2 rounded-md px-1.5 py-1 text-[11px] text-[#1f2328] opacity-60 dark:text-[#c9d1d9]"
                            title="Auto-merge toggle coming soon"
                            data-testid={`composer-pr-chip-automerge-${itemKey}`}
                            data-enabled="false"
                        >
                            <CheckboxMark checked={false} />
                            <span>Auto-merge when ready</span>
                        </div>
                    )}
                </div>
            )}

            {/* ── Auto-archive settings link ────────────────────────────────── */}
            {showArchive && (
                <a
                    href={archiveSettingsHref}
                    className="mt-2 flex items-center justify-between rounded-md border-t border-[#d0d7de] px-1 pt-2 text-[11px] text-[#57606a] no-underline hover:bg-black/[0.04] hover:text-[#1f2328] dark:border-[#3c3c3c] dark:text-[#8b949e] dark:hover:bg-white/[0.06] dark:hover:text-[#c9d1d9]"
                    data-testid={`composer-pr-chip-archive-settings-${itemKey}`}
                    onClick={onClose}
                >
                    <span>Auto-archive settings</span>
                    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M3 8h10M9 4l4 4-4 4" />
                    </svg>
                </a>
            )}
        </div>,
        document.body,
    );
}
