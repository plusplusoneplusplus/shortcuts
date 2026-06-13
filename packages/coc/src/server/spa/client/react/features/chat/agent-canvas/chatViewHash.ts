// Deep-link helpers for the chat's Thread/Agents view. The view rides as a
// `?view=agents` query param on the existing chat hash
// (`#repos/<ws>/<tab>/<taskId>`), read on mount and written on toggle. Pure
// string functions so they're unit-testable and SSR/embed-safe.

import type { ChatView } from './ChatViewToggle';

/** Read the chat view from a raw `location.hash` string, or null if unset/invalid. */
export function readChatViewFromHash(rawHash: string): ChatView | null {
    const qIndex = rawHash.indexOf('?');
    if (qIndex < 0) {
        return null;
    }
    const view = new URLSearchParams(rawHash.slice(qIndex + 1)).get('view');
    if (view === 'agents') {
        return 'agents';
    }
    if (view === 'thread') {
        return 'thread';
    }
    return null;
}

/**
 * Return `rawHash` with the `view` param set for the agents view and removed
 * for thread (the default). Preserves the path, leading `#`, and any other
 * query params. Returns a value directly comparable to `location.hash`.
 */
export function applyChatViewToHash(rawHash: string, view: ChatView): string {
    const hasLeadingHash = rawHash.startsWith('#');
    const body = hasLeadingHash ? rawHash.slice(1) : rawHash;
    const qIndex = body.indexOf('?');
    const path = qIndex < 0 ? body : body.slice(0, qIndex);
    const params = new URLSearchParams(qIndex < 0 ? '' : body.slice(qIndex + 1));
    if (view === 'agents') {
        params.set('view', 'agents');
    } else {
        params.delete('view');
    }
    const query = params.toString();
    const result = query ? `${path}?${query}` : path;
    return (hasLeadingHash ? '#' : '') + result;
}
