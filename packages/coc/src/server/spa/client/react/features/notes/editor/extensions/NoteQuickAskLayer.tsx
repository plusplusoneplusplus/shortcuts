/**
 * NoteQuickAskLayer — Quick Ask (✨ Ask AI) over a WYSIWYG (TipTap) note's
 * editable text (Goal: notes-quick-ask, AC-01 + AC-02 client half).
 *
 * A TipTap note's content is real host DOM, so a drag across a phrase yields a
 * live `window.getSelection()` Range — exactly what the chat / PDF Quick Ask
 * loops already consume. This layer reuses that loop wholesale: it watches for
 * selections inside `containerRef` (the WYSIWYG editor scroll container),
 * raises the shared {@link QuickAskPill} (or Cmd/Ctrl+J), expands into
 * {@link QuickAskInput} for an optional custom question, then POSTs the
 * selection ± a surrounding window of note text to the stateless
 * `POST /api/quick-ask/answer` endpoint (no processId) and shows the answer in
 * the shared {@link QuickAskSidenotePopover}.
 *
 * Grounding (AC-02): the window is the ±context captured by
 * {@link getQuickAskSelection} (`CONTEXT_CHARS` each side), NOT the whole note.
 * The model is resolved server-side from the per-repo `quickAsk` preference.
 *
 * Scope note: this layer covers AC-01 (pill/input) and AC-02 (grounded one-shot
 * answer). It does NOT yet embed the answer into the note `.md` as a footnote
 * (AC-03) nor render a persistent inline chip/anchor (AC-04) — the answer lives
 * in this component's transient state for now.
 *
 * On a successful answer the note is embedded into the note `.md` as a footnote
 * (AC-03): {@link insertSidenoteRef} drops a `qaSidenoteRef` marker at the anchor
 * phrase in the live TipTap document, and the save pipeline then serializes the
 * `[^qa-<id>]` marker + a bottom definition block automatically. If the phrase
 * was deleted while the answer was in flight the marker is not inserted (AC-05
 * pending drop).
 *
 * Gated behind the same admin `features.quickAskSidenotes` flag as chat
 * side-notes and a no-op without a `workspaceId`, so it is always safe to mount.
 * The host mounts it only in WYSIWYG (rich) mode — never over the raw-markdown
 * source textarea (AC-01: no pill in source view).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { fetchApi } from '../../../../hooks/useApi';
import { useQuickAskSidenotesEnabled } from '../../../../hooks/feature-flags/useQuickAskSidenotesEnabled';
import { getQuickAskSelection } from '../../../chat/quick-ask/quick-ask-selection';
import { QuickAskPill } from '../../../chat/quick-ask/QuickAskPill';
import { QuickAskInput } from '../../../chat/quick-ask/QuickAskInput';
import { QuickAskSidenotePopover } from '../../../chat/quick-ask/QuickAskSidenotePopover';
import type { ClientSideNote, QuickAskSelection } from '../../../chat/quick-ask/types';
import { insertSidenoteRef } from './sidenoteRefPlacement';

export interface NoteQuickAskLayerProps {
    /** The WYSIWYG editor container whose selections should raise the Ask pill. */
    containerRef: React.RefObject<HTMLElement | null>;
    /** Workspace the answer endpoint runs against. Layer is a no-op when absent. */
    workspaceId?: string;
    /**
     * The live TipTap editor instance. On a successful answer the note is
     * embedded here as a `qaSidenoteRef` marker (AC-03). Absent → the answer
     * still shows in the popover but is not persisted.
     */
    editor?: Editor | null;
}

/** Synthetic turn index — notes are not chat turns, but the shared selection
 * shape carries one. */
const NOTE_TURN_INDEX = 0;

/** Short, markdown-safe id used both as the popover identity and the
 * `[^qa-<id>]` footnote label. Kept compact so the persisted `.md` stays
 * hand-readable. */
function newRefId(): string {
    const rnd = Math.random().toString(36).slice(2, 10);
    const t = Date.now().toString(36).slice(-4);
    return `${rnd}${t}`;
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

export function NoteQuickAskLayer({ containerRef, workspaceId, editor }: NoteQuickAskLayerProps) {
    const enabled = useQuickAskSidenotesEnabled() && !!workspaceId;

    const [selection, setSelection] = useState<QuickAskSelection | null>(null);
    const [input, setInput] = useState<QuickAskSelection | null>(null);
    const [open, setOpen] = useState<OpenNote | null>(null);

    const selectionRef = useRef<QuickAskSelection | null>(null);
    selectionRef.current = selection;
    const inputRef = useRef<QuickAskSelection | null>(null);
    inputRef.current = input;
    // The editor is read at write time (answer landing), never captured in a
    // callback closure — one instance survives note switches / re-renders.
    const editorRef = useRef<Editor | null | undefined>(editor);
    editorRef.current = editor;

    const clearSelection = useCallback(() => setSelection(null), []);

    // Run the stateless one-shot grounded lookup, updating the note by id. On
    // success the answer is embedded into the note `.md` as a footnote marker at
    // the anchor phrase (AC-03); if the phrase was deleted while the answer was in
    // flight the marker is dropped rather than orphaned (AC-05).
    const runLookup = useCallback((
        sel: QuickAskSelection,
        question: string | undefined,
        noteId: string,
    ) => {
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
                insertSidenoteRef(
                    editorRef.current,
                    {
                        selectedText: sel.selectedText,
                        contextBefore: sel.contextBefore,
                        contextAfter: sel.contextAfter,
                    },
                    { refId: noteId, question, answer },
                );
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

    // Capture the current selection (if any) into the pill state.
    const captureSelection = useCallback(() => {
        const container = containerRef.current;
        if (!container) {
            setSelection(null);
            return;
        }
        setSelection(getQuickAskSelection(container, NOTE_TURN_INDEX));
    }, [containerRef]);

    // Raise/clear the pill from pointer selections inside the editor.
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

    // Keyboard alternative: Cmd/Ctrl+J on an active selection in the editor.
    useEffect(() => {
        if (!enabled) {return;}
        const onKey = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && (e.key === 'j' || e.key === 'J')) {
                const container = containerRef.current;
                if (!container) {return;}
                const next = getQuickAskSelection(container, NOTE_TURN_INDEX);
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
        const id = newRefId();
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
