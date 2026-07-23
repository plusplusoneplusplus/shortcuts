/**
 * usePromptAutocomplete — inline ghost-text completion hook.
 *
 * Given the current text and cursor position of a prompt input, fetches a
 * single best completion suffix from the server and exposes it for overlay
 * rendering. Acceptance is deferred to the caller (typically wired to Tab).
 *
 * Behavior:
 *   - Suggestions only appear when `enabled` is true, the cursor is at the
 *     end of `text`, and the trimmed prefix is at least `minPrefixLen` chars.
     *   - Requests are debounced and stale responses are dropped.
 *   - `accept()` returns the joined string (text + completion) for the caller
 *     to apply via the input's setValue handle.
 *   - `dismiss()` clears the current completion until the next text change.
 *
 * The hook is resilient to server errors: it never throws and silently
 * clears the completion on failure.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getCocClientFor, getSpaCocClient } from '../api/cocClient';

export interface UsePromptAutocompleteOptions {
    text: string;
    cursorPos: number;
    enabled: boolean;
    workspaceId?: string;
    processId?: string;
    surface?: 'queue' | 'follow-up';
    mode?: 'hybrid' | 'ai' | 'history';
    /**
     * The owning clone's remote `baseUrl` (AC-07). When set, completions are
     * fetched from that remote server via `getCocClientFor(baseUrl)`; the
     * routed request never falls through to the local origin. Omit for the
     * local origin — the legacy `getSpaCocClient()` client is used, so existing
     * callers are unchanged. This hook keeps no module cache, so no
     * server-scoped cache key is needed.
     */
    baseUrl?: string;
    /** Minimum non-whitespace prefix length before fetching. Default: 3. */
    minPrefixLen?: number;
    /** Debounce delay in ms. Default: 150 for hybrid/AI, 120 for history. */
    debounceMs?: number;
}

export interface UsePromptAutocompleteResult {
    /** The current ghost-text suffix to render after the cursor. Empty when nothing. */
    completion: string;
    /** Returns the joined string the input should adopt when the user accepts. */
    accept(): string;
    /** Clear the current completion until the next text change. */
    dismiss(): void;
}

export function usePromptAutocomplete(
    opts: UsePromptAutocompleteOptions,
): UsePromptAutocompleteResult {
    const {
        text,
        cursorPos,
        enabled,
        workspaceId,
        processId,
        surface,
        mode = 'hybrid',
        minPrefixLen = 3,
        baseUrl,
    } = opts;
    const debounceMs = opts.debounceMs ?? (mode === 'history' ? 120 : 150);
    const [completion, setCompletion] = useState('');
    const dismissedForTextRef = useRef<string | null>(null);
    const requestSeqRef = useRef(0);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        // Cancel any pending fetch.
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }

        // Bump sequence: any in-flight response with a stale id is discarded.
        const mySeq = ++requestSeqRef.current;

        // User explicitly dismissed the suggestion for the exact current text.
        // Don't refetch until the text changes.
        if (dismissedForTextRef.current === text) {
            return;
        }

        if (!enabled) {
            setCompletion('');
            return;
        }

        // Cursor must be at end of text — don't suggest mid-edit.
        if (cursorPos !== text.length) {
            setCompletion('');
            return;
        }

        const trimmed = text.replace(/^\s+/, '');
        if (trimmed.length < minPrefixLen) {
            setCompletion('');
            return;
        }

        timerRef.current = setTimeout(() => {
            timerRef.current = null;
            (async () => {
                try {
                    // Route to the owning clone (AC-07): a remote clone reads
                    // from its own server and never falls back to the local
                    // origin. Local origin (no baseUrl) uses the default client.
                    const client = baseUrl ? getCocClientFor(baseUrl) : getSpaCocClient();
                    const result = await client.suggestions.promptCompletion({
                        prefix: text,
                        workspaceId,
                        processId,
                        surface,
                        mode,
                    });
                    if (mySeq !== requestSeqRef.current) return; // stale
                    setCompletion(result.completion ?? '');
                } catch {
                    if (mySeq !== requestSeqRef.current) return;
                    setCompletion('');
                }
            })();
        }, debounceMs);

        return () => {
            if (timerRef.current) {
                clearTimeout(timerRef.current);
                timerRef.current = null;
            }
        };
    }, [text, cursorPos, enabled, workspaceId, processId, surface, mode, minPrefixLen, debounceMs, baseUrl]);

    // Any text change clears the dismissed flag so suggestions can resume.
    useEffect(() => {
        if (dismissedForTextRef.current !== null && dismissedForTextRef.current !== text) {
            dismissedForTextRef.current = null;
        }
    }, [text]);

    const accept = useCallback((): string => {
        if (!completion) return text;
        return text + completion;
    }, [text, completion]);

    const dismiss = useCallback((): void => {
        dismissedForTextRef.current = text;
        // Bump sequence so any in-flight response is dropped.
        requestSeqRef.current++;
        setCompletion('');
    }, [text]);

    return { completion, accept, dismiss };
}
