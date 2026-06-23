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
import { prStatusBadge } from '../../pull-requests/pr-utils';
import { buildPrDetailHash } from '../../pull-requests/pr-open-utils';
import { summarizeCheckRows } from '../../pull-requests/PrChecksSummary';
import type { PrStatusCardItem } from './PrStatusCard';

export interface ComposerPrChipProps {
    /** The PR row to render (number, fetch state, loaded detail). */
    item: PrStatusCardItem;
    /** Dismiss this chip (the connected wrapper hides it for the session). */
    onDismiss: (key: string) => void;
    /** Retry a failed detail fetch. */
    onRetry?: (key: string) => void;
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

/**
 * Compact CI-checks count (e.g. `✓ 10/30` = passing / total), tinted by the
 * worst-active status: red when any check is failing, amber on warnings, blue
 * while any are pending/running, green once all reported checks pass. Renders
 * nothing until the eager checks fetch resolves with at least one check, so a
 * chat whose PR reports no CI stays quiet. Reuses {@link summarizeCheckRows} —
 * no copy-pasted check-status tallying.
 */
function ChecksBadge({ item }: { item: PrStatusCardItem }) {
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

    return (
        <span
            className={cn('shrink-0 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-mono text-[10px] font-medium', tone)}
            data-testid="composer-pr-chip-checks"
            data-passing={s.passing}
            data-total={s.total}
            title={title}
        >
            <span aria-hidden="true">{glyph}</span>
            {s.passing}/{s.total}
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

export function ComposerPrChip({ item, onDismiss, onRetry }: ComposerPrChipProps) {
    const number = item.pr?.number ?? item.number;
    const linkTarget = getPrLinkTarget(item, number);

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
            <ChecksBadge item={item} />
            {diff && (
                <span className="shrink-0 font-mono text-[11px]" data-testid="composer-pr-chip-diff">
                    <span className="font-semibold text-[#1a7f37] dark:text-[#3fb950]">+{diff.additions}</span>{' '}
                    <span className="font-semibold text-[#cf222e] dark:text-[#f85149]">−{diff.deletions}</span>
                </span>
            )}
            <ViewLink target={linkTarget} itemKey={item.key} />
            <DismissButton itemKey={item.key} onDismiss={onDismiss} />
        </div>
    );
}
