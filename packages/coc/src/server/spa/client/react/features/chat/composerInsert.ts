/**
 * composerInsert — a cross-tree bridge for dropping text into the chat composer.
 *
 * The workspace right dock renders in a sibling column of the chat pane, so its
 * "Insert into chat" action has no React path to the composer's state. Rather
 * than prop-drill through RepoDetail, it dispatches a window CustomEvent the
 * composer hosts listen for — the same bridge idiom as `coc-open-source-canvas`
 * and `coc-open-markdown-review`.
 *
 * Hosts: `ChatDetail` (follow-up input) and `NewChatArea` (first prompt).
 */

import { useEffect } from 'react';

export const COMPOSER_INSERT_EVENT = 'coc-insert-into-composer';

export interface ComposerInsertDetail {
    /**
     * Workspace the text belongs to. Composers bound to a different workspace
     * ignore the event; omit to target every mounted composer.
     */
    workspaceId?: string;
    /** Text to append to the composer draft. */
    text: string;
}

/** Append `text` to an existing composer draft, separated by a blank line. */
export function appendComposerText(current: string, text: string): string {
    const addition = text.trim();
    if (!addition) return current;
    const base = current.replace(/\s+$/, '');
    return base ? `${base}\n\n${addition}` : addition;
}

/** Ask the mounted composer(s) to append `text`. No-ops on a blank string. */
export function dispatchComposerInsert(detail: ComposerInsertDetail): void {
    if (!detail.text.trim()) return;
    try {
        window.dispatchEvent(new CustomEvent(COMPOSER_INSERT_EVENT, { detail }));
    } catch {
        /* ignore — non-DOM host */
    }
}

/**
 * Subscribe a composer to {@link COMPOSER_INSERT_EVENT}. `setText` receives the
 * usual React updater so the append is applied against the latest draft.
 */
export function useComposerInsertListener(
    workspaceId: string | undefined,
    setText: (updater: (prev: string) => string) => void,
): void {
    useEffect(() => {
        const handler = (event: Event) => {
            const detail = (event as CustomEvent).detail as ComposerInsertDetail | undefined;
            if (!detail || typeof detail.text !== 'string' || !detail.text.trim()) return;
            // A composer bound to a workspace only accepts that workspace's text.
            if (detail.workspaceId && workspaceId && detail.workspaceId !== workspaceId) return;
            setText(prev => appendComposerText(prev, detail.text));
        };
        window.addEventListener(COMPOSER_INSERT_EVENT, handler as EventListener);
        return () => window.removeEventListener(COMPOSER_INSERT_EVENT, handler as EventListener);
    }, [workspaceId, setText]);
}
