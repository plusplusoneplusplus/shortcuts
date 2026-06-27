/**
 * ComposerPrChip — the compact, in-composer pull-request chip (design 01·B,
 * "Quiet rail — inside the input").
 *
 * Replaces the top-of-thread {@link PrStatusCard}: once a chat opens a PR, the PR
 * "rides along" as a context chip docked inside the composer — like an attachment
 * on the conversation. A single chip renders one {@link PrStatusCardItem} (the
 * connected {@link ChatComposerPrChips} stacks one chip per associated PR).
 *
 * Per-item UX states (driven by {@link PrStatusCardItem.state}):
 *   - loading: detail fetch in flight → skeleton row
 *   - ready:   detail loaded → glyph · #num · title · status · diff · View · ✕
 *   - error:   fetch failed → inline error + Retry + View + ✕
 *
 * Read-only beyond the provider "View pull request" link, a per-item Retry, and
 * the ✕ dismiss (which the connected wrapper hides for the session). Reuses
 * {@link prStatusBadge} for the status pill and falls back to
 * {@link buildPrDetailHash} only when the provider URL is unavailable.
 */
import React from 'react';
import { cn } from '../../../ui/cn';
import { prStatusBadge, summarizeReviewerApprovals } from '../../pull-requests/pr-utils';
import { buildPrDetailHash } from '../../pull-requests/pr-open-utils';
import { summarizeCheckRows } from '../../pull-requests/PrChecksSummary';
import { ComposerPrChecksPopover, type ComposerPrChecksAutoFix } from './ComposerPrChecksPopover';
import { ComposerPrReviewersPopover } from './ComposerPrReviewersPopover';
import { usePrAutoFixTrigger, type UsePrAutoFixTriggerResult } from './usePrAutoFixTrigger';
import type { PrStatusCardItem } from './PrStatusCard';

/** CI auto-fix wiring passed from the connected chip stack (AC-05). */
export interface ComposerPrChipAutoFixContext {
    /** Whether the triggers feature flag is on. */
    enabled: boolean;
    /** Owning workspace id (trigger scope + clone routing). */
    workspaceId?: string;
    /** Conversation (process) the fix action targets. */
    processId?: string;
}

export interface ComposerPrChipProps {
    /** The PR row to render (number, fetch state, loaded detail). */
    item: PrStatusCardItem;
    /** Dismiss this chip (the connected wrapper hides it for the session). */
    onDismiss: (key: string) => void;
    /** Retry a failed detail fetch. */
    onRetry?: (key: string) => void;
    /** Force-refresh this PR's status + checks now, bypassing the cache. Omit to hide the button. */
    onRefresh?: (key: string) => void;
    /** A force-refresh is in flight — spins the icon and disables the button. */
    refreshing?: boolean;
    /** CI auto-fix context (AC-05). Omit (or `enabled: false`) to hide the controls + badge. */
    autoFix?: ComposerPrChipAutoFixContext;
}

const ROW_CLASS =
    'flex items-center gap-2 px-3 py-1.5 text-xs ' +
    'bg-[#f6f8fa] dark:bg-[#161b22] ' +
    'border-b border-[#d0d7de] dark:border-[#3c3c3c]';

function GitGlyph() {
    return (
        <span
            className="shrink-0 inline-flex h-[18px] w-[18px] items-center justify-center rounded-md bg-[#1a7f37] text-white dark:bg-[#238636]"
            aria-hidden="true"
        >
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="4" cy="4" r="1.6" />
                <circle cx="4" cy="12" r="1.6" />
                <circle cx="12" cy="6" r="1.6" />
                <path d="M4 5.6v4.8M5.6 4h3.2A2 2 0 0111 6M12 7.6V9a2 2 0 01-2 2H5.6" />
            </svg>
        </span>
    );
}

function PinGlyph() {
    return (
        <span className="shrink-0 text-[#57606a] dark:text-[#8b949e]" aria-hidden="true" title="Pinned to this chat">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5.8 2.5h4.4M6.6 2.5l-.5 4.3L4 8.7h8L9.9 6.8l-.5-4.3" />
                <path d="M8 8.7v4.8" />
            </svg>
        </span>
    );
}

function RefreshButton({ itemKey, onRefresh, refreshing }: { itemKey: string; onRefresh: (key: string) => void; refreshing?: boolean }) {
    return (
        <button
            type="button"
            onClick={() => onRefresh(itemKey)}
            disabled={refreshing}
            className="shrink-0 inline-flex h-[22px] w-[22px] items-center justify-center rounded-md border-none bg-transparent text-[#57606a] hover:bg-black/[0.05] hover:text-[#0969da] dark:text-[#8b949e] dark:hover:bg-white/[0.08] dark:hover:text-[#58a6ff] cursor-pointer leading-none disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent"
            aria-label="Refresh pull request status"
            title={refreshing ? 'Refreshing…' : 'Refresh status'}
            data-testid={`composer-pr-chip-refresh-${itemKey}`}
            data-refreshing={refreshing ? 'true' : 'false'}
        >
            <svg
                width="12"
                height="12"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className={cn(refreshing && 'animate-spin')}
            >
                <path d="M13.6 8a5.6 5.6 0 1 1-1.64-3.96" />
                <path d="M13.5 2.4V5H10.9" />
            </svg>
        </button>
    );
}

function DismissButton({ itemKey, onDismiss }: { itemKey: string; onDismiss: (key: string) => void }) {
    return (
        <button
            type="button"
            onClick={() => onDismiss(itemKey)}
            className="shrink-0 inline-flex h-[22px] w-[22px] items-center justify-center rounded-md border-none bg-transparent text-[#57606a] hover:bg-black/[0.05] hover:text-[#cf222e] dark:text-[#8b949e] dark:hover:bg-white/[0.08] dark:hover:text-[#f85149] cursor-pointer leading-none"
            aria-label="Dismiss pull request"
            title="Dismiss"
            data-testid={`composer-pr-chip-dismiss-${itemKey}`}
        >
            ✕
        </button>
    );
}

function StatusBadge({ status }: { status: string }) {
    const badge = prStatusBadge(status);
    return (
        <span
            className={cn('shrink-0 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium', badge.className)}
            data-testid="composer-pr-chip-status"
            data-status={status}
        >
            <span aria-hidden="true">{badge.emoji}</span>
            {badge.label}
        </span>
    );
}

function ReviewersBadge({ item }: { item: PrStatusCardItem }) {
    const [open, setOpen] = React.useState(false);
    const anchorRef = React.useRef<HTMLButtonElement | null>(null);

    if (item.reviewersState !== 'ready') return null;
    const reviewers = item.reviewers ?? [];
    if (reviewers.length === 0) return null;

    const summary = summarizeReviewerApprovals(reviewers);
    const tone =
        summary.blockedCount > 0
            ? 'bg-[#ffebe9] text-[#cf222e] dark:bg-[#f85149]/20 dark:text-[#f85149]'
            : summary.waitingCount > 0
                ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200'
                : 'bg-[#dafbe1] text-[#1a7f37] dark:bg-[#238636]/25 dark:text-[#3fb950]';
    const titleParts = [
        `${summary.approvedCount}/${summary.total} reviewers approved`,
        summary.waitingCount > 0 ? `${summary.waitingCount} waiting` : '',
        summary.blockedCount > 0 ? `${summary.blockedCount} blocked` : '',
    ].filter(Boolean);

    return (
        <>
            <button
                ref={anchorRef}
                type="button"
                className={cn(
                    'shrink-0 inline-flex items-center gap-1 rounded-full border-none px-1.5 py-0.5 text-[10px] font-medium',
                    'cursor-pointer hover:brightness-95 dark:hover:brightness-110',
                    tone,
                )}
                data-testid="composer-pr-chip-reviewers"
                data-approved={summary.approvedCount}
                data-total={summary.total}
                data-waiting={summary.waitingCount}
                data-blocked={summary.blockedCount}
                title={`${titleParts.join(' - ')} - click to view reviewers`}
                aria-haspopup="dialog"
                aria-expanded={open}
                onClick={() => setOpen(prev => !prev)}
            >
                <span aria-hidden="true">{summary.blockedCount > 0 ? '!' : summary.waitingCount > 0 ? '...' : '✓'}</span>
                {summary.approvedCount}/{summary.total} {summary.total === 1 ? 'reviewer' : 'reviewers'}
            </button>
            {open && (
                <ComposerPrReviewersPopover
                    anchorRef={anchorRef}
                    summary={summary}
                    prNumber={item.pr?.number ?? item.number}
                    itemKey={item.key}
                    onClose={() => setOpen(false)}
                />
            )}
        </>
    );
}

/**
 * Compact CI-checks count (e.g. `✓ 10/30` = passing / total), tinted by the
 * worst-active status: red when any check is failing, amber on warnings, blue
 * while any are pending/running, green once all reported checks pass. Renders
 * nothing until the eager checks fetch resolves with at least one check, so a
 * chat whose PR reports no CI stays quiet. Reuses {@link summarizeCheckRows} —
 * no copy-pasted check-status tallying.
 *
 * The badge becomes a button that toggles a {@link ComposerPrChecksPopover}
 * when there is something to act on: at least one FAILING check to drill into,
 * OR CI auto-fix is available (so its monitor can be armed proactively, before
 * any failure). With nothing failing AND no auto-fix it stays a plain,
 * non-interactive pill.
 */
function ChecksBadge({ item, autoFix }: { item: PrStatusCardItem; autoFix?: UsePrAutoFixTriggerResult }) {
    const [open, setOpen] = React.useState(false);
    const anchorRef = React.useRef<HTMLButtonElement | null>(null);

    if (item.checksState !== 'ready') return null;
    const rows = item.checks ?? [];
    if (rows.length === 0) return null;
    const s = summarizeCheckRows(rows);

    const tone =
        s.failing > 0
            ? 'bg-[#ffebe9] text-[#cf222e] dark:bg-[#f85149]/20 dark:text-[#f85149]'
            : s.warning > 0
                ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200'
                : s.pending > 0
                    ? 'bg-[#ddf4ff] text-[#0969da] dark:bg-[#388bfd]/25 dark:text-[#58a6ff]'
                    : 'bg-[#dafbe1] text-[#1a7f37] dark:bg-[#238636]/25 dark:text-[#3fb950]';
    const glyph = s.failing > 0 ? '✕' : s.warning > 0 ? '⚠' : s.pending > 0 ? '●' : '✓';

    const detail = [
        s.failing > 0 ? `${s.failing} failing` : '',
        s.warning > 0 ? `${s.warning} warning` : '',
        s.pending > 0 ? `${s.pending} pending` : '',
    ].filter(Boolean).join(' · ');
    const title = `${s.passing}/${s.total} checks passing${detail ? ` — ${detail}` : ''}`;

    const baseClass = cn(
        'shrink-0 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-mono text-[10px] font-medium',
        tone,
    );
    const content = (
        <>
            <span aria-hidden="true">{glyph}</span>
            {s.passing}/{s.total}
        </>
    );

    const failed = rows.filter(row => row.status === 'failure');
    // The badge opens the popover when there is a failing check to drill into, or
    // when CI auto-fix is available — arming a `ci-failure` monitor is forward-
    // looking, so it must be reachable before any failure (e.g. while checks are
    // still pending). Otherwise the badge stays a plain, non-interactive pill.
    const interactive = s.failing > 0 || Boolean(autoFix);
    if (!interactive) {
        return (
            <span
                className={baseClass}
                data-testid="composer-pr-chip-checks"
                data-passing={s.passing}
                data-total={s.total}
                data-failing={s.failing}
                title={title}
            >
                {content}
            </span>
        );
    }

    // `autoFix` is only supplied when the feature is enabled, so the controls
    // always render; `disabledReason` (set when the PR/conversation context is
    // unresolved or a call is in flight) disables both controls, while
    // `fixNowDisabledReason` disables only "Fix now" when nothing is failing yet.
    const popoverAutoFix: ComposerPrChecksAutoFix | undefined = autoFix
        ? {
            enabled: true,
            armed: autoFix.armed,
            busy: autoFix.busy,
            disabledReason: autoFix.disabledReason,
            fixNowDisabledReason: failed.length === 0 ? 'No failing checks to fix' : null,
            onToggle: next => {
                void (next ? autoFix.arm() : autoFix.disarm());
            },
            onFixNow: () => {
                void autoFix.fixNow(failed.map(row => ({ name: row.name, detailsUrl: row.detailsUrl })));
            },
        }
        : undefined;
    const openHref = item.pr?.url || item.url;
    const archiveSettingsHref = `#repos/${encodeURIComponent(item.repoId)}/settings/preferences`;
    const autoMergeEnabled = item.pr?.autoMerge?.enabled;

    return (
        <>
            <button
                ref={anchorRef}
                type="button"
                className={cn(baseClass, 'cursor-pointer border-none hover:brightness-95 dark:hover:brightness-110')}
                data-testid="composer-pr-chip-checks"
                data-passing={s.passing}
                data-total={s.total}
                data-failing={s.failing}
                title={s.failing > 0 ? `${title} — click to view failed checks` : `${title} — click to manage CI auto-fix`}
                aria-haspopup="dialog"
                aria-expanded={open}
                onClick={() => setOpen(prev => !prev)}
            >
                {content}
            </button>
            {open && (
                <ComposerPrChecksPopover
                    anchorRef={anchorRef}
                    failed={failed}
                    allRows={rows}
                    prNumber={item.pr?.number ?? item.number}
                    itemKey={item.key}
                    onClose={() => setOpen(false)}
                    autoFix={popoverAutoFix}
                    openHref={openHref}
                    autoMergeEnabled={autoMergeEnabled}
                    archiveSettingsHref={archiveSettingsHref}
                />
            )}
        </>
    );
}

/** "Auto-fix on" indicator shown on the chip while a CI monitor is armed (AC-05). */
function AutoFixOnBadge({ itemKey }: { itemKey: string }) {
    return (
        <span
            className="shrink-0 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-[#dafbe1] text-[#1a7f37] dark:bg-[#238636]/25 dark:text-[#3fb950]"
            data-testid={`composer-pr-chip-autofix-badge-${itemKey}`}
            title="CI auto-fix is on for this pull request"
        >
            <span aria-hidden="true">⚡</span>
            Auto-fix on
        </span>
    );
}

interface PrLinkTarget {
    href: string;
    external: boolean;
}

function getPrLinkTarget(item: PrStatusCardItem, number: number | string): PrLinkTarget {
    const providerUrl = item.pr?.url || item.url;
    if (providerUrl) {
        return { href: providerUrl, external: true };
    }
    return { href: buildPrDetailHash(item.repoId, number), external: false };
}

function externalLinkAttrs(external: boolean): Pick<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'target' | 'rel'> {
    return external ? { target: '_blank', rel: 'noopener noreferrer' } : {};
}

function ViewLink({ target, itemKey }: { target: PrLinkTarget; itemKey: string }) {
    return (
        <a
            href={target.href}
            {...externalLinkAttrs(target.external)}
            className="shrink-0 inline-flex items-center gap-1 h-[22px] px-2 rounded-md bg-[#0969da] text-white text-[11px] font-medium no-underline hover:bg-[#0a5cc2] dark:bg-[#1f6feb] dark:hover:bg-[#388bfd]"
            data-testid={`composer-pr-chip-view-${itemKey}`}
            title="View pull request"
        >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
                <circle cx="8" cy="8" r="1.8" />
            </svg>
            View
        </a>
    );
}

export function ComposerPrChip({ item, onDismiss, onRetry, onRefresh, refreshing, autoFix }: ComposerPrChipProps) {
    const number = item.pr?.number ?? item.number;
    const linkTarget = getPrLinkTarget(item, number);

    // Per-PR CI auto-fix lifecycle (AC-05). The hook is inert until the feature
    // is enabled AND the PR/conversation context resolves, so it's safe to call
    // in every render state.
    const autoFixState = usePrAutoFixTrigger({
        enabled: autoFix?.enabled ?? false,
        workspaceId: autoFix?.workspaceId,
        processId: autoFix?.processId,
        originId: item.originId,
        prId: item.prId,
        prNumber: number,
    });

    if (item.state === 'loading') {
        return (
            <div className={ROW_CLASS} data-testid="composer-pr-chip" data-state="loading" data-pr-key={item.key}>
                <GitGlyph />
                <span className="shrink-0 font-mono text-[11px] font-medium text-[#57606a] dark:text-[#8b949e]">#{number}</span>
                <span className="h-3 min-w-0 flex-1 max-w-[12rem] animate-pulse rounded bg-[#d0d7de] dark:bg-[#30363d]" />
                <span className="shrink-0 text-[#57606a] dark:text-[#8b949e]">Loading…</span>
                <DismissButton itemKey={item.key} onDismiss={onDismiss} />
            </div>
        );
    }

    if (item.state === 'error') {
        return (
            <div className={ROW_CLASS} data-testid="composer-pr-chip" data-state="error" data-pr-key={item.key} role="alert">
                <GitGlyph />
                <span className="shrink-0 font-mono text-[11px] font-medium text-[#57606a] dark:text-[#8b949e]">#{number}</span>
                <span className="min-w-0 flex-1 truncate text-[#cf222e] dark:text-[#f85149]">
                    {item.error || 'Failed to load pull request.'}
                </span>
                {onRetry && (
                    <button
                        type="button"
                        className="shrink-0 rounded px-1.5 py-0.5 font-medium text-[#0969da] dark:text-[#58a6ff] hover:bg-black/[0.05] dark:hover:bg-white/[0.08] cursor-pointer"
                        data-testid={`composer-pr-chip-retry-${item.key}`}
                        onClick={() => onRetry(item.key)}
                    >
                        Retry
                    </button>
                )}
                <ViewLink target={linkTarget} itemKey={item.key} />
                <DismissButton itemKey={item.key} onDismiss={onDismiss} />
            </div>
        );
    }

    // ready
    const pr = item.pr;
    const diff = pr?.diffStats;
    return (
        <div className={ROW_CLASS} data-testid="composer-pr-chip" data-state="ready" data-pr-key={item.key}>
            <GitGlyph />
            <PinGlyph />
            <a
                href={linkTarget.href}
                {...externalLinkAttrs(linkTarget.external)}
                className="shrink-0 font-mono text-[11px] font-medium text-[#57606a] dark:text-[#8b949e] no-underline hover:text-[#0969da] dark:hover:text-[#58a6ff] hover:underline"
                data-testid={`composer-pr-chip-num-${item.key}`}
                title="Open full PR"
            >
                #{number}
            </a>
            <span
                className="min-w-0 flex-1 truncate font-semibold text-[#1f2328] dark:text-[#c9d1d9]"
                data-testid="composer-pr-chip-title"
                title={pr?.title}
            >
                {pr?.title}
            </span>
            {pr && <StatusBadge status={pr.status} />}
            <ReviewersBadge item={item} />
            <ChecksBadge item={item} autoFix={autoFix?.enabled ? autoFixState : undefined} />
            {autoFix?.enabled && autoFixState.armed && <AutoFixOnBadge itemKey={item.key} />}
            {diff && (
                <span className="shrink-0 font-mono text-[11px]" data-testid="composer-pr-chip-diff">
                    <span className="font-semibold text-[#1a7f37] dark:text-[#3fb950]">+{diff.additions}</span>{' '}
                    <span className="font-semibold text-[#cf222e] dark:text-[#f85149]">−{diff.deletions}</span>
                </span>
            )}
            {onRefresh && <RefreshButton itemKey={item.key} onRefresh={onRefresh} refreshing={refreshing} />}
            <ViewLink target={linkTarget} itemKey={item.key} />
            <DismissButton itemKey={item.key} onDismiss={onDismiss} />
        </div>
    );
}
