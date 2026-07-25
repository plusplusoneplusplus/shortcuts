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
 * Deliberately NO persistence and NO chat thread involvement (AC-04): the answer
 * is a one-shot side-note that lives only in this component's state. Persisting
 * anchored annotations to a per-note sidecar is Goal 2.
 *
 * The whole layer is gated behind the same admin `features.quickAskSidenotes`
 * flag as chat side-notes and is a no-op without a `workspaceId`, so it is always
 * safe to mount.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchApi } from '../../../../hooks/useApi';
import { useQuickAskSidenotesEnabled } from '../../../../hooks/feature-flags/useQuickAskSidenotesEnabled';
import { getQuickAskSelection } from '../../../chat/quick-ask/quick-ask-selection';
import { QuickAskPill } from '../../../chat/quick-ask/QuickAskPill';
import { QuickAskInput } from '../../../chat/quick-ask/QuickAskInput';
import { QuickAskSidenotePopover } from '../../../chat/quick-ask/QuickAskSidenotePopover';
import type { ClientSideNote, QuickAskSelection } from '../../../chat/quick-ask/types';

export interface PdfQuickAskLayerProps {
    /** The container whose text layer selections should raise the Ask pill. */
    containerRef: React.RefObject<HTMLElement | null>;
    /** Workspace the answer endpoint runs against. Layer is a no-op when absent. */
    workspaceId?: string;
}

/** Synthetic turn index — notes/papers are not chat turns, but the shared
 * selection shape carries one. */
const PDF_TURN_INDEX = 0;

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
    /** Selection that produced this note, kept for retry. */
    selection: QuickAskSelection;
}

export function PdfQuickAskLayer({ containerRef, workspaceId }: PdfQuickAskLayerProps) {
    const enabled = useQuickAskSidenotesEnabled() && !!workspaceId;

    const [selection, setSelection] = useState<QuickAskSelection | null>(null);
    const [input, setInput] = useState<QuickAskSelection | null>(null);
    const [open, setOpen] = useState<OpenNote | null>(null);

    const selectionRef = useRef<QuickAskSelection | null>(null);
    selectionRef.current = selection;
    const inputRef = useRef<QuickAskSelection | null>(null);
    inputRef.current = input;

    const clearSelection = useCallback(() => setSelection(null), []);

    // Run the stateless one-shot lookup, updating the note in place by id.
    const runLookup = useCallback((sel: QuickAskSelection, question: string | undefined, noteId: string) => {
        if (!workspaceId) {return;}
        const path = `/api/quick-ask/answer?workspace=${encodeURIComponent(workspaceId)}`;
        fetchApi(path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                selectedText: sel.selectedText,
                contextBefore: sel.contextBefore,
                contextAfter: sel.contextAfter,
                question,
            }),
        })
            .then((data: { answer?: string; model?: string }) => {
                const answer = typeof data?.answer === 'string' ? data.answer : '';
                if (!answer) {throw new Error('Malformed response');}
                setOpen(prev => (prev && prev.note.id === noteId
                    ? { ...prev, note: { ...prev.note, status: 'ready', answer, model: data.model } }
                    : prev));
            })
            .catch(() => {
                setOpen(prev => (prev && prev.note.id === noteId
                    ? { ...prev, note: { ...prev.note, status: 'error', error: 'Lookup failed' } }
                    : prev));
            });
    }, [workspaceId]);

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
        setInput(sel);
        window.getSelection()?.removeAllRanges();
        setSelection(null);
    }, []);

    // Submit the input: fire the lookup and open the popover with an optimistic
    // "asking" note anchored just below the selection.
    const submitInput = useCallback((question: string) => {
        const sel = inputRef.current;
        setInput(null);
        if (!sel) {return;}
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
        });
        runLookup(sel, trimmed, id);
    }, [runLookup]);

    const cancelInput = useCallback(() => setInput(null), []);

    const closePopover = useCallback(() => setOpen(null), []);

    const handleCopy = useCallback((note: ClientSideNote) => {
        try {
            void navigator.clipboard?.writeText(note.answer);
        } catch {
            /* best-effort */
        }
    }, []);

    const handleRetry = useCallback((id: string) => {
        setOpen(prev => {
            if (!prev || prev.note.id !== id) {return prev;}
            runLookup(prev.selection, prev.note.question, id);
            return { ...prev, note: { ...prev.note, status: 'asking', error: undefined } };
        });
    }, [runLookup]);

    const handleDelete = useCallback(() => setOpen(null), []);

    if (!enabled) {return null;}

    return (
        <>
            {selection && !input && (
                <QuickAskPill rect={selection.rect} onAsk={handleAsk} onDismiss={clearSelection} />
            )}

            {input && (
                <QuickAskInput rect={input.rect} onSubmit={submitInput} onCancel={cancelInput} />
            )}

            {open && (
                <QuickAskSidenotePopover
                    note={open.note}
                    position={open.position}
                    onClose={closePopover}
                    onCopy={handleCopy}
                    onRetry={handleRetry}
                    onDelete={handleDelete}
                />
            )}
        </>
    );
}
