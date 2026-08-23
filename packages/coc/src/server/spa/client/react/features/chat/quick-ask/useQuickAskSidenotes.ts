/**
 * useQuickAskSidenotes — manages Quick Ask side-notes for one process.
 *
 * Holds the merged list of persisted (`ready`) side-notes plus transient
 * optimistic items (`asking`/`error`), and exposes create/retry/delete. The
 * hook is a no-op (stable empty state, no network) when the admin
 * `features.quickAskSidenotes` flag is off or when process/workspace are
 * unknown, so it is always safe to call unconditionally.
 *
 * Every call goes through `requestForWorkspace` so it lands on the workspace's
 * OWN server. The sidenotes routes only validate the id SHAPE — they never look
 * the workspace up — so a local-origin call for a remote clone answers 200 after
 * writing `{dataDir}/repos/<remote-id>/chat-sidenotes/...` on the LOCAL disk (and
 * its POST then fails the local `processExists` check anyway).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuickAskSidenotesEnabled } from '../../../hooks/feature-flags/useQuickAskSidenotesEnabled';
import { requestForWorkspace } from '../../../repos/cloneRegistry';
import { deriveContext } from './quick-ask-selection';
import type { ChatSideNote, ClientSideNote, QuickAskSelection, QuickAskTurn } from './types';
import { MAX_QUICK_ASK_TURNS } from './types';

export interface UseQuickAskSidenotesResult {
    /** Whether the feature is active for this process. */
    enabled: boolean;
    /** Merged persisted + optimistic side-notes. */
    items: ClientSideNote[];
    /** Run a lookup for a captured selection, optionally with a custom question. */
    createSidenote: (selection: QuickAskSelection, question?: string) => void;
    /** Retry a failed lookup. */
    retrySidenote: (id: string) => void;
    /** Remove a side-note (persisted ones are deleted server-side). */
    deleteSidenote: (id: string) => void;
    /**
     * Ask a follow-up on an answered side-note. The new turn is appended
     * optimistically and persisted server-side on success, so the thread
     * survives a reload. A no-op past {@link MAX_QUICK_ASK_TURNS}.
     */
    followUpSidenote: (id: string, question: string) => void;
    /**
     * Re-run one turn of a thread after a failure. Turn 0 re-runs the original
     * lookup; later turns re-ask that turn's follow-up question in place.
     */
    retrySidenoteTurn: (id: string, turnIndex: number) => void;
}

/** Live thread for a server note: its persisted turns, else the implicit turn 0. */
function threadFor(note: ChatSideNote): QuickAskTurn[] {
    if (Array.isArray(note.turns) && note.turns.length > 0) {
        return note.turns.map(t => ({ question: t.question, answer: t.answer, status: 'ready' as const }));
    }
    return [{ question: note.question, answer: note.answer, status: 'ready' as const }];
}

/** Immutably patch turn `turnIndex` of note `id`'s thread. */
function patchThread(
    items: ClientSideNote[],
    id: string,
    turnIndex: number,
    patch: Partial<QuickAskTurn>,
): ClientSideNote[] {
    return items.map(p => {
        if (p.id !== id || !p.thread?.[turnIndex]) {return p;}
        return {
            ...p,
            thread: p.thread.map((t, i) => (i === turnIndex ? { ...t, ...patch } : t)),
        };
    });
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
        requestForWorkspace<{ sidenotes?: ChatSideNote[] }>(workspaceId, basePath)
            .then(data => {
                if (cancelled || !Array.isArray(data?.sidenotes)) {return;}
                const ready: ClientSideNote[] = data.sidenotes.map(n => ({
                    ...n,
                    status: 'ready' as const,
                    thread: threadFor(n),
                }));
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
        requestForWorkspace<{ sidenote?: ChatSideNote }>(workspaceId, basePath, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
        })
            .then(data => {
                if (!data?.sidenote) {throw new Error('Malformed response');}
                setItems(prev => prev.map(p => (
                    p.id === draft.id
                        ? { ...data.sidenote!, status: 'ready' as const, thread: threadFor(data.sidenote!) }
                        : p
                )));
            })
            .catch(() => {
                setItems(prev => prev.map(p => (
                    p.id === draft.id ? { ...p, status: 'error' as const, error: 'Lookup failed' } : p
                )));
            });
    }, [enabled, basePath, workspaceId]);

    const createSidenote = useCallback((selection: QuickAskSelection, question?: string) => {
        if (!enabled) {return;}
        // Re-derive context defensively in case the caller passed a partial rect.
        const ctx = (selection.contextBefore || selection.contextAfter)
            ? { contextBefore: selection.contextBefore, contextAfter: selection.contextAfter }
            : deriveContext(selection.selectedText, selection.selectedText);
        // Empty/whitespace-only question stays unset so the server falls back to
        // its default "Briefly explain" prompt (AC-02).
        const trimmedQuestion = question?.trim();
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
            question: trimmedQuestion || undefined,
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
            requestForWorkspace(workspaceId, delPath, { method: 'DELETE' }).catch(() => { /* best-effort */ });
        }
    }, [enabled, processId, workspaceId]);

    // POST one follow-up turn and reconcile it into `thread[turnIndex]`. The
    // server owns the history (it re-reads the persisted thread), so the request
    // carries only the new question. On success the whole note is replaced by the
    // server's copy — whose `turns` now include this answer — while any later
    // in-flight turns of the local thread are preserved.
    const postFollowUp = useCallback((id: string, question: string, turnIndex: number) => {
        if (!enabled) {return;}
        const path = `/api/processes/${encodeURIComponent(processId!)}/sidenotes/${encodeURIComponent(id)}/follow-up?workspace=${encodeURIComponent(workspaceId!)}`;
        requestForWorkspace<{ sidenote?: ChatSideNote }>(workspaceId, path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question }),
        })
            .then(data => {
                if (!data?.sidenote) {throw new Error('Malformed response');}
                setItems(prev => prev.map(p => {
                    if (p.id !== id) {return p;}
                    const persisted = threadFor(data.sidenote!);
                    // Persisted turns win; any local tail the server hasn't seen
                    // yet (a still-in-flight turn) is kept after them.
                    const local = p.thread ?? [];
                    return {
                        ...data.sidenote!,
                        status: 'ready' as const,
                        thread: [...persisted, ...local.slice(persisted.length)],
                    };
                }));
            })
            .catch(() => {
                setItems(prev => patchThread(prev, id, turnIndex, { status: 'error', error: 'Lookup failed' }));
            });
    }, [enabled, processId, workspaceId]);

    const followUpSidenote = useCallback((id: string, question: string) => {
        if (!enabled) {return;}
        const trimmed = question.trim();
        if (!trimmed) {return;}
        const target = itemsRef.current.find(p => p.id === id);
        if (!target || target.status !== 'ready') {return;}
        const thread = target.thread ?? threadFor(target);
        if (thread.length >= MAX_QUICK_ASK_TURNS) {return;}
        const turnIndex = thread.length;
        const next: QuickAskTurn[] = [...thread, { question: trimmed, answer: '', status: 'asking' }];
        setItems(prev => prev.map(p => (p.id === id ? { ...p, thread: next } : p)));
        postFollowUp(id, trimmed, turnIndex);
    }, [enabled, postFollowUp]);

    const retrySidenoteTurn = useCallback((id: string, turnIndex: number) => {
        if (!enabled) {return;}
        // Turn 0 is the original lookup — a failed one was never persisted, so it
        // re-runs through the create path rather than the follow-up route.
        if (turnIndex === 0) {return retrySidenote(id);}
        const target = itemsRef.current.find(p => p.id === id);
        const turn = target?.thread?.[turnIndex];
        if (!turn?.question) {return;}
        setItems(prev => patchThread(prev, id, turnIndex, { status: 'asking', error: undefined }));
        postFollowUp(id, turn.question, turnIndex);
    }, [enabled, retrySidenote, postFollowUp]);

    return {
        enabled,
        items,
        createSidenote,
        retrySidenote,
        deleteSidenote,
        followUpSidenote,
        retrySidenoteTurn,
    };
}
