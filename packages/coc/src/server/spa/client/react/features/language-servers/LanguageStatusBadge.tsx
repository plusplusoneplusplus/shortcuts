/**
 * The language server's status, next to the file it answers for.
 *
 * Small on purpose: an editor badge, not a panel. It says which server is
 * behind this document and what it is doing, and it offers the one action a
 * user can take from here — restart the server without restarting CoC.
 *
 * The wording and the decision to offer a retry both come from
 * `describeLanguageStatus`, so this file only renders.
 */

import React, { useState } from 'react';
import type { LanguageDocumentSnapshot } from './documentStore';
import { describeLanguageStatus, type LanguageStatusTone } from './languageStatus';

export interface LanguageStatusBadgeProps {
    snapshot: LanguageDocumentSnapshot | null;
    /** Restarts the server behind this document. */
    onRestart: () => void;
    variant?: 'default' | 'corner';
}

const DOT_CLASS: Record<LanguageStatusTone, string> = {
    ready: 'bg-[#4ec9b0]',
    pending: 'bg-[#0078d4] animate-pulse',
    warning: 'bg-[#f59e0b]',
    error: 'bg-[#d32f2f] dark:bg-[#f48771]',
};

const CORNER_OPACITY_CLASS: Record<LanguageStatusTone, string> = {
    ready: 'opacity-[0.55] hover:opacity-100 focus-within:opacity-100',
    pending: 'opacity-100',
    warning: 'opacity-100',
    error: 'opacity-100',
};

export function LanguageStatusBadge({
    snapshot,
    onRestart,
    variant = 'default',
}: LanguageStatusBadgeProps): React.ReactElement {
    const status = describeLanguageStatus(snapshot);
    const isCorner = variant === 'corner';
    const [open, setOpen] = useState(false);
    const showDetails = status.tone === 'error';

    return (
        <span className="relative inline-flex pointer-events-auto">
            <span
                className={[
                    'flex items-center gap-1 text-[10px] text-[#848484]',
                    isCorner
                        ? `min-w-0 max-w-full rounded bg-white/85 dark:bg-[#1e1e1e]/85 backdrop-blur-sm shadow-sm px-1.5 py-0.5 transition-opacity ${CORNER_OPACITY_CLASS[status.tone]}`
                        : '',
                ].join(' ')}
                title={status.title}
                data-testid="language-status"
                data-tone={status.tone}
            >
                <button
                    type="button"
                    className="flex min-w-0 items-center gap-1"
                    onClick={() => showDetails && setOpen(value => !value)}
                    aria-expanded={showDetails ? open : undefined}
                    data-testid="language-status-summary"
                >
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${DOT_CLASS[status.tone]}`} aria-hidden="true" />
                    <span className={isCorner ? 'min-w-0 truncate' : undefined} data-testid="language-status-label">
                        {status.label}
                    </span>
                </button>
                {status.canRestart && (
                    <button
                        type="button"
                        className="flex-shrink-0 px-1 rounded text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-50 transition-colors"
                        onClick={onRestart}
                        disabled={status.busy}
                        title="Restart the language server"
                        data-testid="language-restart-btn"
                    >
                        {showDetails ? 'Retry' : 'Restart'}
                    </button>
                )}
            </span>
            {showDetails && open && (
                <span
                    className="absolute bottom-full right-0 mb-1 w-72 rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#252526] p-2 text-xs text-[#1e1e1e] dark:text-[#cccccc] shadow-lg"
                    data-testid="language-status-details"
                >
                    <strong className="block mb-1">{status.label}</strong>
                    {status.runtime && <span className="block text-[#848484] mb-1">{status.runtime}</span>}
                    {status.detail && <span className="block mb-2">{status.detail}</span>}
                    {status.recoveryCommand && (
                        <span className="block">
                            <code className="block rounded bg-black/5 dark:bg-white/10 px-1.5 py-1 mb-1">{status.recoveryCommand}</code>
                            <button
                                type="button"
                                className="text-[#0078d4] hover:underline"
                                onClick={() => { void navigator.clipboard?.writeText(status.recoveryCommand!); }}
                                data-testid="language-copy-recovery"
                            >
                                Copy command
                            </button>
                        </span>
                    )}
                </span>
            )}
        </span>
    );
}
