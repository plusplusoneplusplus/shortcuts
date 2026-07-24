/**
 * useQuickAskSidenotes — manages Quick Ask side-notes for one process.
 *
 * Holds the merged list of persisted (`ready`) side-notes plus transient
 * optimistic items (`asking`/`error`), and exposes create/retry/delete. The
 * hook is a no-op (stable empty state, no network) when the admin
 * `features.quickAskSidenotes` flag is off or when process/workspace are
 * unknown, so it is always safe to call unconditionally.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuickAskSidenotesEnabled } from '../../../hooks/feature-flags/useQuickAskSidenotesEnabled';
import { fetchApi } from '../../../hooks/useApi';
import { deriveContext } from './quick-ask-selection';
import type { ChatSideNote, ClientSideNote, QuickAskSelection } from './types';

export interface UseQuickAskSidenotesResult {
    /** Whether the feature is active for this process. */
    enabled: boolean;
    /** Merged persisted + optimistic side-notes. */
    items: ClientSideNote[];
    /** Run a lookup for a captured selection. */
    createSidenote: (selection: QuickAskSelection) => void;
    /** Retry a failed lookup. */
    retrySidenote: (id: string) => void;
    /** Remove a side-note (persisted ones are deleted server-side). */
    deleteSidenote: (id: string) => void;
}

function newId(): string {
    try {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID();
        }
    } catch {
        /* ignore */
    }
    return 'tmp-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function labelFor(selectedText: string): string {
    const collapsed = selectedText.replace(/\s+/g, ' ').trim();
    return collapsed.length <= 22 ? collapsed : collapsed.slice(0, 22).trimEnd() + '…';
}

export function useQuickAskSidenotes(
    processId?: string,
    workspaceId?: string,
): UseQuickAskSidenotesResult {
    const enabled = useQuickAskSidenotesEnabled() && !!processId && !!workspaceId;
    const [items, setItems] = useState<ClientSideNote[]>([]);
    const hydratedFor = useRef<string | null>(null);
    // Always-current snapshot so callbacks can read the latest items without
    // depending on a state updater having run yet.
    const itemsRef = useRef<ClientSideNote[]>([]);
    itemsRef.current = items;

    const basePath = enabled
        ? `/api/processes/${encodeURIComponent(processId!)}/sidenotes?workspace=${encodeURIComponent(workspaceId!)}`
        : '';

    // Hydrate persisted side-notes once per process.
    useEffect(() => {
        if (!enabled) {return;}
        const key = `${processId}::${workspaceId}`;
        if (hydratedFor.current === key) {return;}
        hydratedFor.current = key;
        let cancelled = false;
        fetchApi(basePath)
            .then((data: { sidenotes?: ChatSideNote[] }) => {
                if (cancelled || !Array.isArray(data?.sidenotes)) {return;}
                const ready: ClientSideNote[] = data.sidenotes.map(n => ({ ...n, status: 'ready' as const }));
                setItems(prev => {
                    // Keep any optimistic items the user created before hydration resolved.
                    const optimistic = prev.filter(p => p.status !== 'ready');
                    return [...ready, ...optimistic];
                });
            })
            .catch(() => { /* best-effort */ });
        return () => { cancelled = true; };
    }, [enabled, basePath, processId, workspaceId]);

    const runLookup = useCallback((draft: ClientSideNote) => {
        if (!enabled) {return;}
        const body = JSON.stringify({
            turnIndex: draft.turnIndex,
            selectedText: draft.anchor.selectedText,
            contextBefore: draft.anchor.contextBefore,
            contextAfter: draft.anchor.contextAfter,
            question: draft.question,
        });
        fetchApi(basePath, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
        })
            .then((data: { sidenote?: ChatSideNote }) => {
                if (!data?.sidenote) {throw new Error('Malformed response');}
                setItems(prev => prev.map(p => (p.id === draft.id ? { ...data.sidenote!, status: 'ready' as const } : p)));
            })
            .catch(() => {
                setItems(prev => prev.map(p => (
                    p.id === draft.id ? { ...p, status: 'error' as const, error: 'Lookup failed' } : p
                )));
            });
    }, [enabled, basePath]);

    const createSidenote = useCallback((selection: QuickAskSelection) => {
        if (!enabled) {return;}
        // Re-derive context defensively in case the caller passed a partial rect.
        const ctx = (selection.contextBefore || selection.contextAfter)
            ? { contextBefore: selection.contextBefore, contextAfter: selection.contextAfter }
            : deriveContext(selection.selectedText, selection.selectedText);
        const draft: ClientSideNote = {
            id: newId(),
            processId: processId!,
            turnIndex: selection.turnIndex,
            anchor: {
                selectedText: selection.selectedText,
                contextBefore: ctx.contextBefore,
                contextAfter: ctx.contextAfter,
                fingerprint: '',
            },
            answer: '',
            label: labelFor(selection.selectedText),
            createdAt: new Date().toISOString(),
            status: 'asking',
        };
        setItems(prev => [...prev, draft]);
        runLookup(draft);
    }, [enabled, processId, runLookup]);

    const retrySidenote = useCallback((id: string) => {
        if (!enabled) {return;}
        const target = itemsRef.current.find(p => p.id === id);
        if (!target) {return;}
        const retried: ClientSideNote = { ...target, status: 'asking', error: undefined };
        setItems(prev => prev.map(p => (p.id === id ? retried : p)));
        runLookup(retried);
    }, [enabled, runLookup]);

    const deleteSidenote = useCallback((id: string) => {
        if (!enabled) {return;}
        const target = itemsRef.current.find(p => p.id === id);
        const wasPersisted = target?.status === 'ready';
        setItems(prev => prev.filter(p => p.id !== id));
        if (wasPersisted) {
            const delPath = `/api/processes/${encodeURIComponent(processId!)}/sidenotes/${encodeURIComponent(id)}?workspace=${encodeURIComponent(workspaceId!)}`;
            fetchApi(delPath, { method: 'DELETE' }).catch(() => { /* best-effort */ });
        }
    }, [enabled, processId, workspaceId]);

    return { enabled, items, createSidenote, retrySidenote, deleteSidenote };
}
