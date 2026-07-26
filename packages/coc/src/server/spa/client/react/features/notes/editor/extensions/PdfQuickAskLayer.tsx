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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchApi } from '../../../../hooks/useApi';
import { useQuickAskSidenotesEnabled } from '../../../../hooks/feature-flags/useQuickAskSidenotesEnabled';
import { getQuickAskSelection } from '../../../chat/quick-ask/quick-ask-selection';
import { QuickAskPill } from '../../../chat/quick-ask/QuickAskPill';
import { QuickAskInput } from '../../../chat/quick-ask/QuickAskInput';
import { QuickAskSidenotePopover } from '../../../chat/quick-ask/QuickAskSidenotePopover';
import type { ClientSideNote, QuickAskSelection, QuickAskTurn } from '../../../chat/quick-ask/types';
import { extractPaperRectAnchor, type PaperRectAnchor } from './paperAnchorGeometry';
import { PAPER_ANNOTATION_PERSISTED_EVENT } from './usePaperAnnotations';
import { paperPathFromPdfUrl } from './paperPathFromUrl';

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

/** Synthetic turn index — notes/papers are not chat turns, but the shared
 * selection shape carries one. */
const PDF_TURN_INDEX = 0;

/** Soft cap on follow-up turns per thread (AC-02). */
const MAX_TURNS = 10;

/** One ordered prior Q/A turn sent as grounding history on a follow-up (AC-01). */
type HistoryTurn = { question?: string; answer: string };

/** Immutably patch turn `turnIndex` of the open thread and sync the note-level
 * status/answer to the latest turn. No-op when the open note id doesn't match. */
function patchTurn(
    prev: OpenNote | null,
    noteId: string,
    turnIndex: number,
    patch: Partial<QuickAskTurn>,
): OpenNote | null {
    if (!prev || prev.note.id !== noteId || !prev.turns[turnIndex]) {return prev;}
    const turns = prev.turns.map((t, i) => (i === turnIndex ? { ...t, ...patch } : t));
    const latest = turns[turns.length - 1];
    return {
        ...prev,
        turns,
        note: { ...prev.note, status: latest.status, answer: latest.answer, error: latest.error },
    };
}

/** Prior ready turns, in order, as follow-up grounding history. */
function historyBefore(turns: QuickAskTurn[], upto: number): HistoryTurn[] {
    return turns.slice(0, upto)
        .filter(t => t.status === 'ready')
        .map(t => ({ question: t.question, answer: t.answer }));
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

interface OpenNote {
    note: ClientSideNote;
    position: { top: number; left: number };
    /** Selection that produced this note, kept for retry + follow-up grounding. */
    selection: QuickAskSelection;
    /** Geometric anchor captured at ask time, for the persisted highlight. */
    rectAnchor: PaperRectAnchor | null;
    /** Whether this Q&A was grounded on the whole paper (kept for retry + follow-ups). */
    useFullPaper: boolean;
    /** The full multi-turn thread (AC-02). Turn 0 is the original ask. */
    turns: QuickAskTurn[];
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

    const [selection, setSelection] = useState<QuickAskSelection | null>(null);
    const [input, setInput] = useState<QuickAskSelection | null>(null);
    const [open, setOpen] = useState<OpenNote | null>(null);
    // "Use full paper" toggle state for the current input. Default OFF — the
    // cheap selection-only path stays the default (AC-04).
    const [fullPaper, setFullPaper] = useState(false);

    const selectionRef = useRef<QuickAskSelection | null>(null);
    selectionRef.current = selection;
    const inputRef = useRef<QuickAskSelection | null>(null);
    inputRef.current = input;
    // Geometric anchor of the passage the pill/input is currently over. Captured
    // while the DOM selection is still live (ask time), because the selection is
    // cleared before the question is submitted.
    const pendingGeomRef = useRef<PaperRectAnchor | null>(null);

    // Live persistence context — read at write time, never captured at mount.
    const persistRef = useRef({ pdfUrl, getNotePath, getNoteRoot });
    persistRef.current = { pdfUrl, getNotePath, getNoteRoot };

    const clearSelection = useCallback(() => setSelection(null), []);

    // Best-effort: persist an answered Q&A as a dual-anchor paper annotation.
    // No-op unless the host supplied a pdfUrl and a resolvable note path.
    const persistAnnotation = useCallback((
        sel: QuickAskSelection,
        question: string | undefined,
        answer: string,
        model: string | undefined,
        rectAnchor: PaperRectAnchor | null,
    ) => {
        if (!workspaceId) {return;}
        const { pdfUrl: url, getNotePath: notePathGetter, getNoteRoot: rootGetter } = persistRef.current;
        const notePath = notePathGetter?.();
        if (!url || !notePath) {return;}
        const path = `/api/workspaces/${encodeURIComponent(workspaceId)}/notes/paper-annotations/annotation`;
        void fetchApi(path, {
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
            .then(() => {
                // Let any mounted read/render layer for this note pick up the new
                // annotation without prop coupling (it reloads the sidecar).
                try {
                    window.dispatchEvent(new Event(PAPER_ANNOTATION_PERSISTED_EVENT));
                } catch {
                    /* environments without Event ctor: reload happens on next note open */
                }
            })
            .catch(() => {
                /* persistence is best-effort; the answer already shows */
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
        const path = `/api/quick-ask/answer?workspace=${encodeURIComponent(workspaceId)}`;
        // Whole-paper grounding only when the user opted in AND this embed is a
        // cached arXiv paper with a text sidecar the server can read (AC-04);
        // otherwise the request is byte-for-byte the cheap selection-only path.
        const useFull = wantFullPaper && !!paperPath;
        fetchApi(path, {
            method: 'POST',
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
            .then((data: { answer?: string; model?: string }) => {
                const answer = typeof data?.answer === 'string' ? data.answer : '';
                if (!answer) {throw new Error('Malformed response');}
                setOpen(prev => {
                    const next = patchTurn(prev, noteId, turnIndex, { status: 'ready', answer, error: undefined });
                    return next ? { ...next, note: { ...next.note, model: data.model } } : next;
                });
                if (turnIndex === 0) {
                    persistAnnotation(sel, question, answer, data.model, rectAnchor);
                }
            })
            .catch(() => {
                setOpen(prev => patchTurn(prev, noteId, turnIndex, { status: 'error', error: 'Lookup failed' }));
            });
    }, [workspaceId, persistAnnotation, paperPath]);

    // Capture the current text-layer selection (if any) into the pill state.
    const captureSelection = useCallback(() => {
        const container = containerRef.current;
        if (!container) {
            setSelection(null);
            return;
        }
        setSelection(getQuickAskSelection(container, PDF_TURN_INDEX));
    }, [containerRef]);

    // Raise/clear the pill from pointer selections inside the PDF.
    useEffect(() => {
        if (!enabled) {return;}
        const onMouseUp = () => {
            // Let the browser finalize the selection first.
            window.setTimeout(captureSelection, 0);
        };
        const onMouseDown = (e: MouseEvent) => {
            const target = e.target as HTMLElement | null;
            if (target && target.closest('[data-testid="quick-ask-pill"]')) {return;}
            setSelection(null);
        };
        document.addEventListener('mouseup', onMouseUp);
        document.addEventListener('mousedown', onMouseDown);
        return () => {
            document.removeEventListener('mouseup', onMouseUp);
            document.removeEventListener('mousedown', onMouseDown);
        };
    }, [enabled, captureSelection]);

    // Keyboard alternative: Cmd/Ctrl+J on an active selection in the PDF.
    useEffect(() => {
        if (!enabled) {return;}
        const onKey = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && (e.key === 'j' || e.key === 'J')) {
                const container = containerRef.current;
                if (!container) {return;}
                const next = getQuickAskSelection(container, PDF_TURN_INDEX);
                if (next) {
                    e.preventDefault();
                    // Capture geometry before the DOM selection is cleared.
                    pendingGeomRef.current = extractPaperRectAnchor(container);
                    setFullPaper(false); // each new question defaults to selection-only
                    setInput(next);
                    window.getSelection()?.removeAllRanges();
                    setSelection(null);
                }
            }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [enabled, containerRef]);

    // Dismiss the open input when the user points down outside it.
    useEffect(() => {
        if (!input) {return;}
        const onDown = (e: MouseEvent) => {
            const target = e.target as HTMLElement | null;
            if (target?.closest('[data-testid="quick-ask-input"]')) {return;}
            setInput(null);
        };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [input]);

    // Pill click → expand into the inline question input at the same anchor.
    const handleAsk = useCallback(() => {
        const sel = selectionRef.current;
        if (!sel) {return;}
        // Capture geometry before the DOM selection is cleared.
        pendingGeomRef.current = extractPaperRectAnchor(containerRef.current);
        setFullPaper(false); // each new question defaults to selection-only
        setInput(sel);
        window.getSelection()?.removeAllRanges();
        setSelection(null);
    }, [containerRef]);

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
        const note: ClientSideNote = {
            id,
            processId: '',
            turnIndex: sel.turnIndex,
            anchor: {
                selectedText: sel.selectedText,
                contextBefore: sel.contextBefore,
                contextAfter: sel.contextAfter,
                fingerprint: '',
            },
            question: trimmed,
            answer: '',
            label: labelFor(sel.selectedText),
            createdAt: new Date().toISOString(),
            status: 'asking',
        };
        setOpen({
            note,
            position: { top: sel.rect.bottom + 6, left: sel.rect.left },
            selection: sel,
            rectAnchor,
            useFullPaper: wantFullPaper,
            turns: [{ question: trimmed, answer: '', status: 'asking' }],
        });
        postTurn(sel, trimmed, [], id, 0, rectAnchor, wantFullPaper);
    }, [postTurn, fullPaper, paperPath]);

    const cancelInput = useCallback(() => setInput(null), []);

    const closePopover = useCallback(() => setOpen(null), []);

    // Copy the whole thread transcript (AC-03) — the popover builds it from the
    // live turns; fall back to the single answer for a one-shot note.
    const handleCopy = useCallback((note: ClientSideNote, text?: string) => {
        try {
            void navigator.clipboard?.writeText(text ?? note.answer);
        } catch {
            /* best-effort */
        }
    }, []);

    // Per-turn retry (AC-02): re-run turn `turnIndex` with its question and the
    // prior ready turns as history, preserving the rest of the thread. Follow-up
    // turns carry no fresh geometry — only turn 0 re-persists a highlight.
    const handleRetry = useCallback((turnIndex: number) => {
        setOpen(prev => {
            if (!prev) {return prev;}
            const turn = prev.turns[turnIndex];
            if (!turn) {return prev;}
            postTurn(
                prev.selection,
                turn.question,
                historyBefore(prev.turns, turnIndex),
                prev.note.id,
                turnIndex,
                turnIndex === 0 ? prev.rectAnchor : null,
                prev.useFullPaper,
            );
            const turns = prev.turns.map((t, i) =>
                (i === turnIndex ? { ...t, status: 'asking' as const, error: undefined } : t));
            return { ...prev, turns, note: { ...prev.note, status: 'asking', error: undefined } };
        });
    }, [postTurn]);

    // Send a follow-up (AC-02): append an asking turn and post it with the
    // accumulated ready turns as grounding history. Blocked at the soft cap.
    const handleSend = useCallback((question: string) => {
        setOpen(prev => {
            if (!prev || prev.turns.length >= MAX_TURNS) {return prev;}
            const turnIndex = prev.turns.length;
            postTurn(
                prev.selection,
                question,
                historyBefore(prev.turns, turnIndex),
                prev.note.id,
                turnIndex,
                null,
                prev.useFullPaper,
            );
            const turns: QuickAskTurn[] = [...prev.turns, { question, answer: '', status: 'asking' }];
            return { ...prev, turns, note: { ...prev.note, status: 'asking' } };
        });
    }, [postTurn]);

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
