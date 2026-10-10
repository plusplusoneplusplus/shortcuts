/**
 * ComposerMetaStrip — middle cluster of the chat composer toolbar.
 *
 * Hosts live, per-message context that the user wants visible while drafting:
 *   - cwd chip       (working directory the AI will operate in)
 *   - ctx fuel gauge (how full the context window is)
 *
 * Visual style matches the OpenDesign chat-header reference: subtle muted
 * chips that ghost on hover, with the fuel gauge driving green→amber→red
 * thresholds at 60% / 80%.
 *
 * When breakdown props (sessionSystemTokens / sessionToolTokens /
 * sessionConversationTokens) are provided, the ctx bar renders coloured
 * segments (purple=system, blue=tools, green=conversation, gray=other) and
 * a breakdown popover appears on hover/tap. Sentinel chats pass
 * `autoCompact`, which adds a threshold marker, a status badge and the
 * auto-compact section to the shared popover.
 */

import { cn } from '../../ui/cn';
import {
    CONTEXT_POPOVER_CLASS, CONTEXT_TRIGGER_CLASS, ContextAutoCompactBadge, ContextThresholdMarker, ContextUsageBreakdown,
    formatTokenCount, useContextUsagePopover, type ContextAutoCompact,
} from '../../ui/ContextUsagePopover';

export interface ComposerMetaStripProps {
    /** Working directory the chat operates in (typically the workspace root). */
    workingDirectory?: string;
    /** Total context window size in tokens. */
    sessionTokenLimit?: number;
    /** Tokens currently occupying the context. */
    sessionCurrentTokens?: number;
    /** Active model name (used in the ctx tooltip). */
    sessionModel?: string;
    /**
     * Active AI provider. When a non-default provider is active (`'codex'` or
     * `'claude'`), a small read-only badge is shown so the user always knows
     * which provider is handling their chat. When `undefined` or `'copilot'`
     * no badge is shown (copilot is the default and the badge adds no value).
     */
    activeProvider?: 'copilot' | 'codex' | 'claude' | 'opencode';
    className?: string;
    /** System-prompt token count when the provider reports a breakdown. */
    sessionSystemTokens?: number;
    /** Tool-definition token count when the provider reports a breakdown. */
    sessionToolTokens?: number;
    /** Conversation-history token count when the provider reports a breakdown. */
    sessionConversationTokens?: number;
    /**
     * When true, the composer pane is container-narrow: the cwd chip renders
     * only the last path segment (basename), and context usage collapses to its
     * percentage. Tooltips and popovers retain the full details.
     */
    compact?: boolean;
    /** Sentinel auto-compact state and popover section. */
    autoCompact?: ContextAutoCompact;
}

function shortenPath(path: string, maxLen = 32): string {
    if (path.length <= maxLen) return path;
    const head = '…';
    return head + path.slice(path.length - (maxLen - head.length));
}

/**
 * Last path segment of `path` (basename), tolerant of POSIX (`/`) and Windows
 * (`\`) separators and trailing slashes. Falls back to the trimmed path when no
 * segment can be extracted (e.g. a bare `/`).
 */
function basename(path: string): string {
    const segments = path.split(/[/\\]+/).filter(Boolean);
    return segments.length > 0 ? segments[segments.length - 1] : path;
}

export function ComposerMetaStrip({
    workingDirectory,
    sessionTokenLimit,
    sessionCurrentTokens,
    sessionModel,
    activeProvider,
    className,
    sessionSystemTokens,
    sessionToolTokens,
    sessionConversationTokens,
    compact = false,
    autoCompact,
}: ComposerMetaStripProps) {
    const ctxPopover = useContextUsagePopover();

    const trimmedCwd = workingDirectory?.trim();
    const hasCwd = Boolean(trimmedCwd);
    const showProvider = activeProvider === 'codex' || activeProvider === 'claude';
    const providerLabel = activeProvider === 'claude' ? 'Claude' : 'Codex';

    const ctxLimit = sessionTokenLimit ?? 0;
    const ctxUsed = sessionCurrentTokens ?? 0;
    const showCtx = ctxLimit > 0;
    const ctxPctRaw = showCtx ? (ctxUsed / ctxLimit) * 100 : 0;
    const ctxPct = Math.min(100, Math.max(0, ctxPctRaw));
    const ctxPctRounded = Math.round(ctxPct);
    const fillWidth = showCtx ? Math.max(2, ctxPct) : 0;
    const ctxFillColor =
        ctxPct > 80 ? 'bg-[#f14c4c] dark:bg-[#f48771]' :
        ctxPct > 60 ? 'bg-[#e8912d] dark:bg-[#cca700]' :
                      'bg-[#16825d] dark:bg-[#89d185]';
    const ctxTextColor =
        ctxPct > 80 ? 'text-[#f14c4c] dark:text-[#f48771]' :
        ctxPct > 60 ? 'text-[#e8912d] dark:text-[#cca700]' :
                      'text-[#16825d] dark:text-[#89d185]';
    const ctxTitle = showCtx
        ? `Context window: ${formatTokenCount(ctxUsed)} / ${formatTokenCount(ctxLimit)} (${ctxPct.toFixed(1)}%)${sessionModel ? ` · ${sessionModel}` : ''}${autoCompact ? ` · ${autoCompact.label}` : ''}`
        : 'Context window: not yet known';

    // Breakdown availability (when the active provider reports it)
    const hasBreakdown =
        sessionSystemTokens != null &&
        sessionToolTokens != null &&
        sessionConversationTokens != null;

    // Segment widths as percentage of ctxLimit (only computed when breakdown present)
    const sysPct   = hasBreakdown && showCtx ? Math.min(100, (sessionSystemTokens!       / ctxLimit) * 100) : 0;
    const toolPct  = hasBreakdown && showCtx ? Math.min(100, (sessionToolTokens!         / ctxLimit) * 100) : 0;
    const convPct  = hasBreakdown && showCtx ? Math.min(100, (sessionConversationTokens! / ctxLimit) * 100) : 0;
    const knownPct = sysPct + toolPct + convPct;
    const otherTokens = hasBreakdown
        ? Math.max(0, ctxUsed - sessionSystemTokens! - sessionToolTokens! - sessionConversationTokens!)
        : 0;
    const otherPct = hasBreakdown && showCtx ? Math.max(0, ctxPct - knownPct) : 0;

    const breakdownRows = hasBreakdown ? [
        { label: 'System prompt',    tokens: sessionSystemTokens!,       dotClass: 'bg-purple-500 dark:bg-purple-400' },
        { label: 'Tool definitions', tokens: sessionToolTokens!,         dotClass: 'bg-blue-500 dark:bg-blue-400' },
        { label: 'Conversation',     tokens: sessionConversationTokens!, dotClass: 'bg-green-500 dark:bg-green-400' },
        { label: 'Other',            tokens: otherTokens,                dotClass: 'bg-gray-400 dark:bg-gray-500' },
    ] : [];

    if (!hasCwd && !showCtx && !showProvider) return null;

    return (
        <div
            className={cn(
                'flex items-center gap-0 min-w-0 overflow-visible',
                className,
            )}
            data-testid="composer-meta-strip"
        >
            {hasCwd && (
                /* The cwd chip is the strip's most expendable piece: when the
                   composer toolbar's flexible middle (an inline-size
                   @container) is too tight to fit cwd + ctx side by side, this
                   group hides so the ctx gauge keeps its space instead of the
                   two overlapping the neighbouring toolbar zones. Outside a
                   container context the query never matches and the chip is
                   always visible. */
                <span
                    className="flex items-center min-w-0 [@container_(max-width:319px)]:hidden"
                    data-testid="composer-cwd-group"
                >
                <span
                    title={`Working directory: ${trimmedCwd}`}
                    data-testid="composer-cwd-chip"
                    className="inline-flex items-center gap-1 h-[22px] px-2 rounded-sm border border-transparent text-[11px] text-[#5a5a5a] dark:text-[#999999] hover:bg-[#f3f3f3] dark:hover:bg-[#2a2d2e] hover:border-[#e0e0e0] dark:hover:border-[#3c3c3c] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] whitespace-nowrap min-w-0 transition-colors"
                >
                    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-shrink-0 opacity-70">
                        <path d="M2 4a1 1 0 0 1 1-1h3.5l1.5 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4z" />
                    </svg>
                    {!compact && (
                        <span aria-hidden="true" className="hidden sm:inline font-mono text-[9px] uppercase tracking-wider opacity-60">cwd</span>
                    )}
                    <code data-testid="composer-cwd-path" className="font-mono text-[10.5px] text-[#1e1e1e] dark:text-[#cccccc] truncate">
                        {compact ? basename(trimmedCwd!) : shortenPath(trimmedCwd!)}
                    </code>
                </span>
                {showCtx && (
                    <span aria-hidden="true" className="inline-block w-px h-[14px] bg-[#e0e0e0] dark:bg-[#3c3c3c] mx-1 flex-shrink-0" />
                )}
                </span>
            )}
            {showCtx && (
                <span
                    aria-label={ctxTitle}
                    data-testid="composer-ctx-fuel"
                    className={cn(
                        'relative inline-flex items-center gap-1.5 h-[22px] rounded-sm text-[11px] text-[#5a5a5a] dark:text-[#999999] flex-shrink-0',
                        compact ? 'px-1' : 'px-2',
                    )}
                    {...ctxPopover.containerProps}
                >
                    <button {...ctxPopover.triggerProps} aria-label={ctxTitle} className={cn(CONTEXT_TRIGGER_CLASS, 'gap-1.5 h-full')}>
                    <span
                        aria-hidden="true"
                        className={cn(
                            'font-mono text-[9px] uppercase tracking-wider opacity-60',
                            compact ? 'hidden' : '[@container_(max-width:159px)]:hidden',
                        )}
                    >
                        ctx
                    </span>
                    <span
                        data-testid="composer-ctx-bar"
                        className={cn(
                            'relative w-[64px] h-[6px] rounded-full bg-[#e8e8e8] dark:bg-[#2d2d2d] border border-[#e0e0e0] dark:border-[#3c3c3c] overflow-hidden flex-shrink-0',
                            compact ? 'hidden' : 'inline-block [@container_(max-width:159px)]:hidden',
                        )}
                    >
                        {hasBreakdown ? (
                            <>
                                {sysPct > 0 && (
                                    <span
                                        data-testid="composer-ctx-segment-system"
                                        className="absolute inset-y-0 left-0 bg-purple-500 dark:bg-purple-400"
                                        style={{ width: `${sysPct}%` }}
                                    />
                                )}
                                {toolPct > 0 && (
                                    <span
                                        data-testid="composer-ctx-segment-tools"
                                        className="absolute inset-y-0 bg-blue-500 dark:bg-blue-400"
                                        style={{ left: `${sysPct}%`, width: `${toolPct}%` }}
                                    />
                                )}
                                {convPct > 0 && (
                                    <span
                                        data-testid="composer-ctx-segment-conversation"
                                        className="absolute inset-y-0 bg-green-500 dark:bg-green-400"
                                        style={{ left: `${sysPct + toolPct}%`, width: `${convPct}%` }}
                                    />
                                )}
                                {otherPct > 0 && (
                                    <span
                                        data-testid="composer-ctx-segment-other"
                                        className="absolute inset-y-0 bg-gray-400 dark:bg-gray-500"
                                        style={{ left: `${knownPct}%`, width: `${otherPct}%` }}
                                    />
                                )}
                            </>
                        ) : (
                            <span
                                data-testid="composer-ctx-fill"
                                className={cn('absolute inset-y-0 left-0 rounded-full transition-all duration-300', ctxFillColor)}
                                style={{ width: `${fillWidth}%` }}
                            />
                        )}
                        <ContextThresholdMarker autoCompact={autoCompact} testId="composer-ctx-threshold-marker" />
                    </span>
                    <span
                        data-testid="composer-ctx-pct"
                        className={cn('font-mono text-[10.5px] tabular-nums min-w-[28px] text-right', ctxTextColor)}
                    >
                        {ctxPctRounded}%
                    </span>

                    <ContextAutoCompactBadge autoCompact={autoCompact} testId="composer-ctx-autocompact-badge" />
                    </button>

                    {/* Breakdown popover — hover previews, click/Enter pins; full breakdown when available, simple total otherwise */}
                    {ctxPopover.open && (
                        <div
                            className={cn(CONTEXT_POPOVER_CLASS, autoCompact && 'w-[300px] max-w-[calc(100vw-1rem)]')}
                            data-testid="composer-ctx-breakdown-popover"
                            role={autoCompact ? 'dialog' : undefined}
                            aria-label={autoCompact ? 'Context usage' : undefined}
                            {...ctxPopover.popoverProps}
                        >
                            <ContextUsageBreakdown used={ctxUsed} limit={ctxLimit} pct={ctxPct} rows={breakdownRows}
                                modelName={sessionModel} modelTestId="composer-ctx-model-name" />
                            {autoCompact?.panel}
                        </div>
                    )}
                </span>
            )}
            {showProvider && (hasCwd || showCtx) && (
                <span aria-hidden="true" className="inline-block w-px h-[14px] bg-[#e0e0e0] dark:bg-[#3c3c3c] mx-1 flex-shrink-0" />
            )}
            {showProvider && (
                <span
                    title={`Active AI provider: ${providerLabel}`}
                    data-testid="composer-provider-badge"
                    className={activeProvider === 'claude'
                        ? 'inline-flex items-center gap-1 h-[22px] px-2 rounded-sm border border-violet-400/30 dark:border-violet-500/30 bg-violet-500/8 dark:bg-violet-500/8 text-[11px] text-violet-700 dark:text-violet-400 flex-shrink-0'
                        : 'inline-flex items-center gap-1 h-[22px] px-2 rounded-sm border border-[#0078d4]/30 dark:border-[#3794ff]/30 bg-[#0078d4]/8 dark:bg-[#3794ff]/8 text-[11px] text-[#0078d4] dark:text-[#3794ff] flex-shrink-0'
                    }
                >
                    {activeProvider === 'claude' ? (
                        <svg width="9" height="9" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="flex-shrink-0">
                            <path d="M8 1l2 5.5L16 8l-6 1.5L8 15l-2-5.5L0 8l6-1.5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                        </svg>
                    ) : (
                        <svg width="9" height="9" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="flex-shrink-0">
                            <polygon points="8,1 14,4.5 14,11.5 8,15 2,11.5 2,4.5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                        </svg>
                    )}
                    <span className="font-mono text-[10px] font-medium uppercase tracking-wider">{providerLabel}</span>
                </span>
            )}
        </div>
    );
}
