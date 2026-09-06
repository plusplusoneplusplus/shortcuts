/**
 * WhatsNewModal — shows the release notes for the running app version exactly
 * once (AC-05).
 *
 * Mounted at the app root. It renders nothing until the server confirms there is
 * unseen content, so there is no spinner and no layout shift on a normal load.
 * Dismissing via the button, Escape, or the backdrop acks the version server-side
 * and closes for good.
 *
 * The notes come from a GitHub release body, i.e. untrusted markdown. They go
 * through `renderMarkdownToHtml`, the shared renderer that HTML-escapes every
 * source line before highlighting it — raw input is never injected as-is.
 */

import { useEffect } from 'react';
import ReactDOM from 'react-dom';
import { renderMarkdownToHtml } from '../../diff/markdown-renderer';
import { usePortalContainer } from '../ui/usePortalContainer';
import { useWhatsNew } from './useWhatsNew';

export function WhatsNewModal() {
    const { content, dismiss } = useWhatsNew();
    const open = content !== null;
    const portalContainer = usePortalContainer(open);

    useEffect(() => {
        if (!open) return;
        const onKey = (e: globalThis.KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                dismiss();
            }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [open, dismiss]);

    if (!content || !portalContainer) return null;

    const html = renderMarkdownToHtml(content.notes);

    return ReactDOM.createPortal(
        <div
            className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/50 p-4"
            data-testid="whats-new-backdrop"
            role="presentation"
            onClick={dismiss}
        >
            <div
                className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900"
                role="dialog"
                aria-modal="true"
                aria-labelledby="whats-new-title"
                data-testid="whats-new-modal"
                onClick={e => e.stopPropagation()}
            >
                <header className="flex shrink-0 items-center gap-2 border-b border-gray-200 px-5 py-3 dark:border-gray-700">
                    <h2
                        id="whats-new-title"
                        className="min-w-0 flex-1 truncate text-base font-semibold text-gray-900 dark:text-gray-100"
                    >
                        {content.title}
                    </h2>
                    {content.isPrerelease && (
                        <span
                            className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
                            data-testid="whats-new-prerelease-badge"
                        >
                            Early build
                        </span>
                    )}
                    <button
                        type="button"
                        className="shrink-0 rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-800 dark:hover:text-gray-100"
                        onClick={dismiss}
                        aria-label="Close what's new"
                        title="Close (Esc)"
                        data-testid="whats-new-close"
                    >
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                            <path d="M6 6l12 12M6 18L18 6" />
                        </svg>
                    </button>
                </header>

                {/* Long notes scroll here; the footer dismiss action stays reachable. */}
                <div
                    className="markdown-body min-h-0 flex-1 overflow-y-auto px-5 py-4 text-sm text-gray-800 dark:text-gray-200"
                    data-testid="whats-new-notes"
                    dangerouslySetInnerHTML={{ __html: html }}
                />

                <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-gray-200 px-5 py-3 dark:border-gray-700">
                    {content.htmlUrl ? (
                        <a
                            className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                            href={content.htmlUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            data-testid="whats-new-release-link"
                        >
                            View release {content.tag} on GitHub
                        </a>
                    ) : (
                        <span />
                    )}
                    <button
                        type="button"
                        className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
                        onClick={dismiss}
                        data-testid="whats-new-dismiss"
                    >
                        Got it
                    </button>
                </footer>
            </div>
        </div>,
        portalContainer,
    );
}
