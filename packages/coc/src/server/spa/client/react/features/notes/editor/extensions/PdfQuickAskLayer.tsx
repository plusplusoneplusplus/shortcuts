/**
 * PdfQuickAskLayer — Quick Ask (✨ Ask AI) over a PDF's pdf.js text layer
 * (Goal 1 client half).
 *
 * Once a PDF renders through {@link PdfJsRenderer} its text layer is real host
 * DOM, so a drag across a passage yields a live `window.getSelection()` Range —
 * exactly what the chat Quick Ask loop already consumes. This layer reuses that
 * loop wholesale: it watches for selections inside `containerRef`, raises the
 * shared {@link QuickAskPill} (or Cmd/Ctrl+J), expands into {@link QuickAskInput}
 * for an optional custom question, then POSTs the selection ± page context to the
 * stateless `POST /api/quick-ask/answer` endpoint and shows the answer in the
 * shared {@link QuickAskSidenotePopover}.
 *
 * The answer itself never enters a chat thread (AC-04): it is a one-shot
 * side-note that lives in this component's state. Separately, when the host
 * supplies the persistence anchors (`pdfUrl` + a live note path), a successful
 * answer is written to the per-note paper-annotations sidecar as a W3C dual
 * anchor (`{quote-selector, page, rects}`) — Goal 2's write path. Persistence is
 * best-effort: the answer still shows even if the sidecar write fails.
 *
 * The whole layer is gated behind the same admin `features.quickAskSidenotes`
 * flag as chat side-notes and is a no-op without a `workspaceId`, so it is always
 * safe to mount.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { requestForWorkspace } from '../../../../repos/cloneRegistry';
import { useCloneBaseUrl } from '../../../../repos/cloneRouting';
import { useQuickAskSidenotesEnabled } from '../../../../hooks/feature-flags/useQuickAskSidenotesEnabled';
import { QuickAskPill } from '../../../chat/quick-ask/QuickAskPill';
import { QuickAskInput } from '../../../chat/quick-ask/QuickAskInput';
import { QuickAskSidenotePopover } from '../../../chat/quick-ask/QuickAskSidenotePopover';
import type { QuickAskSelection } from '../../../chat/quick-ask/types';
import { extractPaperRectAnchor, type PaperRectAnchor } from './paperAnchorGeometry';
import { PAPER_ANNOTATION_PERSISTED_EVENT } from './usePaperAnnotations';
import { paperPathFromPdfUrl } from './paperPathFromUrl';
import {
    MAX_QUICK_ASK_TURNS as MAX_TURNS, patchQuickAskTurn as patchTurn,
    quickAskHistory as historyBefore, useDocumentQuickAskSelection, useDocumentQuickAskThread,
    type QuickAskHistoryTurn as HistoryTurn,
} from './useDocumentQuickAsk';

export interface PdfQuickAskLayerProps {
    /** The container whose text layer selections should raise the Ask pill. */
    containerRef: React.RefObject<HTMLElement | null>;
    /** Workspace the answer endpoint runs against. Layer is a no-op when absent. */
    workspaceId?: string;
    /**
     * Goal 2: the PDF this layer annotates. Together with a note path it enables
     * persisting each answered Q&A to the paper-annotations sidecar. Absent →
     * Quick Ask still works, just without persistence.
     */
    pdfUrl?: string;
    /**
     * Goal 2: live getter for the current note path (persistence target). A
     * getter, not a value, because one editor instance survives note switches —
     * the path must be read at write time, not captured at mount.
     */
    getNotePath?: () => string | null | undefined;
    /** Goal 2: live getter for the current notes root id, if any. */
    getNoteRoot?: () => string | undefined;
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

interface PdfQuickAskContext {
    /** Geometric anchor captured at ask time, for the persisted highlight. */
    rectAnchor: PaperRectAnchor | null;
    /** Whether this Q&A was grounded on the whole paper (kept for retry + follow-ups). */
    useFullPaper: boolean;
}

export function PdfQuickAskLayer({
    containerRef,
    workspaceId,
    pdfUrl,
    getNotePath,
    getNoteRoot,
}: PdfQuickAskLayerProps) {
    const enabled = useQuickAskSidenotesEnabled() && !!workspaceId;

    // Cache relpath (`.papers/<id>.pdf`) of an ingested arXiv paper, if this
    // embed is one — only then can we offer whole-paper grounding (AC-04). An
    // arbitrary uploaded/hotlinked PDF has no extracted-text sidecar → undefined.
    const paperPath = useMemo(() => paperPathFromPdfUrl(pdfUrl), [pdfUrl]);

    // "Use full paper" toggle state for the current input. Default OFF — the
    // cheap selection-only path stays the default (AC-04).
    const [fullPaper, setFullPaper] = useState(false);

    const baseUrl = useCloneBaseUrl(workspaceId);
    const owner = useMemo(() => ({ workspaceId, baseUrl, pdfUrl, enabled }), [workspaceId, baseUrl, pdfUrl, enabled]);
    const { open, setOpen, openRef, start, advance, beginRequest, closePopover, handleCopy } =
        useDocumentQuickAskThread<PdfQuickAskContext>(owner);
    // The server-generated id of the annotation persisted for the current thread,
    // as a promise so a follow-up that resolves before the create POST completes
    // still chains its `turns` PATCH onto the real id (AC-03).
    const persistedRef = useRef<{ noteId: string; idPromise: Promise<string | null> } | null>(null);
    // Geometric anchor of the passage the pill/input is currently over. Captured
    // while the DOM selection is still live (ask time), because the selection is
    // cleared before the question is submitted.
    const pendingGeomRef = useRef<PaperRectAnchor | null>(null);

    // Live persistence context — read at write time, never captured at mount.
    const persistRef = useRef({ pdfUrl, getNotePath, getNoteRoot });
    persistRef.current = { pdfUrl, getNotePath, getNoteRoot };

    const { selection, input, inputRef, setInput, clearSelection, cancelInput, handleAsk } =
        useDocumentQuickAskSelection(containerRef, enabled, owner, () => {
            pendingGeomRef.current = extractPaperRectAnchor(containerRef.current);
            setFullPaper(false);
        });

    // Best-effort: persist an answered Q&A as a dual-anchor paper annotation.
    // No-op unless the host supplied a pdfUrl and a resolvable note path.
    const persistAnnotation = useCallback((
        sel: QuickAskSelection,
        question: string | undefined,
        answer: string,
        model: string | undefined,
        rectAnchor: PaperRectAnchor | null,
    ): Promise<string | null> => {
        if (!workspaceId) {return Promise.resolve(null);}
        const { pdfUrl: url, getNotePath: notePathGetter, getNoteRoot: rootGetter } = persistRef.current;
        const notePath = notePathGetter?.();
        if (!url || !notePath) {return Promise.resolve(null);}
        const path = `/api/workspaces/${encodeURIComponent(workspaceId)}/notes/paper-annotations/annotation`;
        return requestForWorkspace<{ annotation?: { id?: string } }>(workspaceId, path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                path: notePath,
                root: rootGetter?.(),
                annotation: {
                    pdfUrl: url,
                    quote: {
                        selectedText: sel.selectedText,
                        contextBefore: sel.contextBefore,
                        contextAfter: sel.contextAfter,
                    },
                    position: rectAnchor ?? undefined,
                    question,
                    answer,
                    model,
                },
            }),
        })
            .then(data => {
                // Let any mounted read/render layer for this note pick up the new
                // annotation without prop coupling (it reloads the sidecar).
                try {
                    window.dispatchEvent(new Event(PAPER_ANNOTATION_PERSISTED_EVENT));
                } catch {
                    /* environments without Event ctor: reload happens on next note open */
                }
                // The server-assigned id — the anchor a follow-up PATCHes `turns` to.
                return typeof data?.annotation?.id === 'string' ? data.annotation.id : null;
            })
            .catch(() => {
                /* persistence is best-effort; the answer already shows */
                return null;
            });
    }, [workspaceId]);

    // Persist a follow-up turn (AC-03): PATCH the accumulated ready turns onto the
    // annotation created for turn 0. Best-effort; the answer already shows even if
    // the sidecar write fails. Dispatches the persisted event so a mounted reopen
    // host reloads the thread.
    const patchAnnotationTurns = useCallback((annotationId: string, turns: HistoryTurn[]) => {
        if (!workspaceId || !turns.length) {return;}
        const { getNotePath: notePathGetter, getNoteRoot: rootGetter } = persistRef.current;
        const notePath = notePathGetter?.();
        if (!notePath) {return;}
        const path = `/api/workspaces/${encodeURIComponent(workspaceId)}/notes/paper-annotations/annotation/${encodeURIComponent(annotationId)}`;
        const body: { path: string; turns: HistoryTurn[]; root?: string } = { path: notePath, turns };
        const root = rootGetter?.();
        if (root) {body.root = root;}
        void requestForWorkspace(workspaceId, path, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        })
            .then(() => {
                try {
                    window.dispatchEvent(new Event(PAPER_ANNOTATION_PERSISTED_EVENT));
                } catch {
                    /* ignore */
                }
            })
            .catch(() => {
                /* best-effort */
            });
    }, [workspaceId]);

    // Run one stateless grounded turn, updating that turn in place by id+index.
    // `history` carries the prior Q/A turns so a follow-up is answered coherently
    // (AC-01); omitted when empty so turn 0 is byte-for-byte the one-shot request.
    // Whole-paper grounding (when opted in on turn 1) is reused for every turn.
    // Turn 0 persists the fresh annotation; follow-up persistence is AC-03.
    const postTurn = useCallback((
        sel: QuickAskSelection,
        question: string | undefined,
        history: HistoryTurn[],
        noteId: string,
        turnIndex: number,
        rectAnchor: PaperRectAnchor | null,
        wantFullPaper: boolean,
    ) => {
        if (!workspaceId) {return;}
        const request = beginRequest(noteId, turnIndex);
        const path = `/api/quick-ask/answer?workspace=${encodeURIComponent(workspaceId)}`;
        // Whole-paper grounding only when the user opted in AND this embed is a
        // cached arXiv paper with a text sidecar the server can read (AC-04);
        // otherwise the request is byte-for-byte the cheap selection-only path.
        const useFull = wantFullPaper && !!paperPath;
        requestForWorkspace<{ answer?: string; model?: string }>(workspaceId, path, {
            method: 'POST',
            signal: request.signal,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                selectedText: sel.selectedText,
                contextBefore: sel.contextBefore,
                contextAfter: sel.contextAfter,
                question,
                ...(history.length ? { history } : {}),
                ...(useFull
                    ? {
                        useFullPaper: true,
                        paperPath,
                        root: persistRef.current.getNoteRoot?.(),
                    }
                    : {}),
            }),
        })
            .then(data => {
                if (!request.isCurrent()) return;
                const answer = typeof data?.answer === 'string' ? data.answer : '';
                if (!answer) {throw new Error('Malformed response');}
                setOpen(prev => {
                    const next = patchTurn(prev, noteId, turnIndex, { status: 'ready', answer, error: undefined });
                    return next ? { ...next, note: { ...next.note, model: data.model } } : next;
                });
                if (turnIndex === 0) {
                    // Turn 0 creates the sidecar annotation; remember its id (as a
                    // promise) so a follow-up can PATCH its accumulated turns onto it.
                    persistedRef.current = {
                        noteId,
                        idPromise: persistAnnotation(sel, question, answer, data.model, rectAnchor),
                    };
                } else {
                    // Follow-up: re-persist the whole thread so the reopened paper
                    // annotation survives reload as a multi-turn thread (AC-03).
                    // Fold this just-answered turn into the accumulated ready turns
                    // (state updates lag one render, so read openRef and patch it).
                    const current = openRef.current;
                    const persisted = persistedRef.current;
                    if (current && current.note.id === noteId && persisted && persisted.noteId === noteId) {
                        const persistTurns: HistoryTurn[] = current.turns
                            .map((t, i) =>
                                (i === turnIndex
                                    ? { question: t.question, answer, status: 'ready' as const }
                                    : t))
                            .filter(t => t.status === 'ready')
                            .map(t => ({ question: t.question, answer: t.answer }));
                        void persisted.idPromise.then(annId => {
                            if (annId && request.isCurrent()) {patchAnnotationTurns(annId, persistTurns);}
                        });
                    }
                }
            })
            .catch(() => {
                if (!request.isCurrent()) return;
                setOpen(prev => patchTurn(prev, noteId, turnIndex, { status: 'error', error: 'Lookup failed' }));
            })
            .finally(request.finish);
    }, [workspaceId, persistAnnotation, patchAnnotationTurns, paperPath, beginRequest, setOpen]);

    // Submit the input: fire the lookup and open the popover with an optimistic
    // "asking" note anchored just below the selection.
    const submitInput = useCallback((question: string) => {
        const sel = inputRef.current;
        setInput(null);
        if (!sel) {return;}
        const rectAnchor = pendingGeomRef.current;
        pendingGeomRef.current = null;
        const wantFullPaper = fullPaper && !!paperPath;
        const trimmed = question.trim() || undefined;
        const id = newId();
        start(sel, trimmed, id, { rectAnchor, useFullPaper: wantFullPaper });
        postTurn(sel, trimmed, [], id, 0, rectAnchor, wantFullPaper);
    }, [postTurn, fullPaper, paperPath, start, inputRef, setInput]);

    // Per-turn retry (AC-02): re-run turn `turnIndex` with its question and the
    // prior ready turns as history, preserving the rest of the thread. Follow-up
    // turns carry no fresh geometry — only turn 0 re-persists a highlight.
    const handleRetry = useCallback((turnIndex: number) => {
        advance(turnIndex, (prev, index) => {
            postTurn(
                prev.selection,
                prev.turns[index].question,
                historyBefore(prev.turns, index),
                prev.note.id,
                index,
                index === 0 ? prev.rectAnchor : null,
                prev.useFullPaper,
            );
        });
    }, [postTurn, advance]);

    // Send a follow-up (AC-02): append an asking turn and post it with the
    // accumulated ready turns as grounding history. Blocked at the soft cap.
    const handleSend = useCallback((question: string) => {
        advance(question, (prev, turnIndex) => {
            postTurn(
                prev.selection,
                question,
                historyBefore(prev.turns, turnIndex),
                prev.note.id,
                turnIndex,
                null,
                prev.useFullPaper,
            );
        });
    }, [postTurn, advance]);

    const handleDelete = useCallback(() => setOpen(null), []);

    if (!enabled) {return null;}

    return (
        <>
            {selection && !input && (
                <QuickAskPill rect={selection.rect} onAsk={handleAsk} onDismiss={clearSelection} />
            )}

            {input && (
                <QuickAskInput
                    rect={input.rect}
                    onSubmit={submitInput}
                    onCancel={cancelInput}
                    fullPaper={paperPath
                        ? { enabled: fullPaper, onToggle: () => setFullPaper(v => !v) }
                        : undefined}
                />
            )}

            {open && (
                <QuickAskSidenotePopover
                    note={open.note}
                    position={open.position}
                    onClose={closePopover}
                    onCopy={handleCopy}
                    onRetry={() => { /* per-turn retry handled via reply.onRetry */ }}
                    onDelete={handleDelete}
                    reply={{
                        turns: open.turns,
                        onSend: handleSend,
                        onRetry: handleRetry,
                        disabled: open.turns.some(t => t.status === 'asking'),
                        atCap: open.turns.length >= MAX_TURNS,
                        maxTurns: MAX_TURNS,
                    }}
                />
            )}
        </>
    );
}
