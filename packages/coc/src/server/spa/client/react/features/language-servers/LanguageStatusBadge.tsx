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

import React from 'react';
import type { LanguageDocumentSnapshot } from './documentStore';
import { describeLanguageStatus, type LanguageStatusTone } from './languageStatus';

export interface LanguageStatusBadgeProps {
    snapshot: LanguageDocumentSnapshot | null;
    /** Restarts the server behind this document. */
    onRestart: () => void;
}

const DOT_CLASS: Record<LanguageStatusTone, string> = {
    ready: 'bg-[#4ec9b0]',
    pending: 'bg-[#0078d4] animate-pulse',
    warning: 'bg-[#f59e0b]',
    error: 'bg-[#d32f2f] dark:bg-[#f48771]',
};

export function LanguageStatusBadge({ snapshot, onRestart }: LanguageStatusBadgeProps): React.ReactElement {
    const status = describeLanguageStatus(snapshot);

    return (
        <span
            className="flex items-center gap-1 text-[10px] text-[#848484]"
            title={status.title}
            data-testid="language-status"
            data-tone={status.tone}
        >
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${DOT_CLASS[status.tone]}`} aria-hidden="true" />
            <span data-testid="language-status-label">{status.label}</span>
            {status.canRestart && (
                <button
                    className="px-1 rounded text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-50 transition-colors"
                    onClick={onRestart}
                    disabled={status.busy}
                    title="Restart the language server"
                    data-testid="language-restart-btn"
                >
                    Restart
                </button>
            )}
        </span>
    );
}
