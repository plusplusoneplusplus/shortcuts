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
 */

import { cn } from '../../ui/cn';

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
     * Active AI provider. When codex is enabled (`'codex'` value) a small
     * read-only badge is shown so the user always knows which provider is
     * handling their chat.  When `undefined` or `'copilot'` no badge is
     * shown (copilot is the default and the badge adds no value when there
     * is only one provider).
     */
    activeProvider?: 'copilot' | 'codex';
    className?: string;
}

function shortenPath(path: string, maxLen = 32): string {
    if (path.length <= maxLen) return path;
    const head = '…';
    return head + path.slice(path.length - (maxLen - head.length));
}

function formatTokenCount(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(n);
}

export function ComposerMetaStrip({
    workingDirectory,
    sessionTokenLimit,
    sessionCurrentTokens,
    sessionModel,
    activeProvider,
    className,
}: ComposerMetaStripProps) {
    const trimmedCwd = workingDirectory?.trim();
    const hasCwd = Boolean(trimmedCwd);
    const showProvider = activeProvider === 'codex';

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
        ? `Context window: ${formatTokenCount(ctxUsed)} / ${formatTokenCount(ctxLimit)} (${ctxPct.toFixed(1)}%)${sessionModel ? ` · ${sessionModel}` : ''}`
        : 'Context window: not yet known';

    if (!hasCwd && !showCtx && !showProvider) return null;

    return (
        <div
            className={cn(
                'flex items-center gap-0 min-w-0 overflow-hidden',
                className,
            )}
            data-testid="composer-meta-strip"
        >
            {hasCwd && (
                <span
                    title={`Working directory: ${trimmedCwd}`}
                    data-testid="composer-cwd-chip"
                    className="inline-flex items-center gap-1 h-[22px] px-2 rounded-sm border border-transparent text-[11px] text-[#5a5a5a] dark:text-[#999999] hover:bg-[#f3f3f3] dark:hover:bg-[#2a2d2e] hover:border-[#e0e0e0] dark:hover:border-[#3c3c3c] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] whitespace-nowrap min-w-0 transition-colors"
                >
                    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-shrink-0 opacity-70">
                        <path d="M2 4a1 1 0 0 1 1-1h3.5l1.5 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4z" />
                    </svg>
                    <span aria-hidden="true" className="hidden sm:inline font-mono text-[9px] uppercase tracking-wider opacity-60">cwd</span>
                    <code className="font-mono text-[10.5px] text-[#1e1e1e] dark:text-[#cccccc] truncate">
                        {shortenPath(trimmedCwd!)}
                    </code>
                </span>
            )}
            {hasCwd && showCtx && (
                <span aria-hidden="true" className="inline-block w-px h-[14px] bg-[#e0e0e0] dark:bg-[#3c3c3c] mx-1 flex-shrink-0" />
            )}
            {showCtx && (
                <span
                    title={ctxTitle}
                    data-testid="composer-ctx-fuel"
                    className="inline-flex items-center gap-1.5 h-[22px] px-2 rounded-sm text-[11px] text-[#5a5a5a] dark:text-[#999999] flex-shrink-0"
                >
                    <span aria-hidden="true" className="font-mono text-[9px] uppercase tracking-wider opacity-60">ctx</span>
                    <span
                        data-testid="composer-ctx-bar"
                        className="relative inline-block w-[64px] h-[6px] rounded-full bg-[#e8e8e8] dark:bg-[#2d2d2d] border border-[#e0e0e0] dark:border-[#3c3c3c] overflow-hidden flex-shrink-0"
                    >
                        <span
                            data-testid="composer-ctx-fill"
                            className={cn('absolute inset-y-0 left-0 rounded-full transition-all duration-300', ctxFillColor)}
                            style={{ width: `${fillWidth}%` }}
                        />
                    </span>
                    <span
                        data-testid="composer-ctx-pct"
                        className={cn('font-mono text-[10.5px] tabular-nums min-w-[28px] text-right', ctxTextColor)}
                    >
                        {ctxPctRounded}%
                    </span>
                </span>
            )}
            {showProvider && (hasCwd || showCtx) && (
                <span aria-hidden="true" className="inline-block w-px h-[14px] bg-[#e0e0e0] dark:bg-[#3c3c3c] mx-1 flex-shrink-0" />
            )}
            {showProvider && (
                <span
                    title="Active AI provider: Codex"
                    data-testid="composer-provider-badge"
                    className="inline-flex items-center gap-1 h-[22px] px-2 rounded-sm border border-[#0078d4]/30 dark:border-[#3794ff]/30 bg-[#0078d4]/8 dark:bg-[#3794ff]/8 text-[11px] text-[#0078d4] dark:text-[#3794ff] flex-shrink-0"
                >
                    <svg width="9" height="9" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="flex-shrink-0">
                        <polygon points="8,1 14,4.5 14,11.5 8,15 2,11.5 2,4.5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                    </svg>
                    <span className="font-mono text-[10px] font-medium uppercase tracking-wider">Codex</span>
                </span>
            )}
        </div>
    );
}
