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
 * On a successful answer the note is embedded into the note `.md` as a footnote
 * with its selection anchor: {@link insertSidenoteRef} drops a
 * `qaSidenoteRef` marker after the anchor phrase, and the save pipeline
 * serializes the `[^qa-<id>]` marker plus bottom definition block. The marker's
 * persisted selection data drives a non-serialized dotted underline. If the
 * phrase was deleted while the answer was in flight, nothing is inserted.
 *
 * The persisted `.qa-sidenote-ref` marker renders as an always-visible ✨ action
 * chip. Clicking it reopens the shared {@link QuickAskSidenotePopover} with the
 * frozen question, answer, and exact selected text read from its `data-qa-*`
 * attributes. Legacy markers fall back to preceding text. The delete control
 * removes the marker node via {@link deleteSidenoteRef}, which also removes the
 * derived underline and bottom definition on save.
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
import { QA_SIDENOTE_REF_CLASS } from './sidenoteFootnote';
import { deleteSidenoteRef, insertSidenoteRef } from './sidenoteRefPlacement';

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

/**
 * Legacy display-only quoted term for a chip without persisted anchor data.
 * Recover a short trailing slice of text immediately preceding the chip.
 */
function phraseBeforeChip(chip: Element, max = 200): string {
    let acc = '';
    let node: Node | null = chip.previousSibling;
    while (node && acc.length < max) {
        acc = (node.textContent ?? '') + acc;
        node = node.previousSibling;
    }
    acc = acc.replace(/\s+/g, ' ').trim();
    return acc.length > max ? '…' + acc.slice(-max) : acc;
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
    // Latest open popover, read by the chip-click listener to toggle it closed.
    const openRef = useRef<OpenNote | null>(null);
    openRef.current = open;
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

    // AC-04: clicking a persisted `.qa-sidenote-ref` chip reopens the popover with
    // the frozen question/answer read straight off the marker's data-attrs.
    // Re-clicking the same chip toggles the popover closed (mirrors chat).
    useEffect(() => {
        if (!enabled) {return;}
        const onClick = (e: MouseEvent) => {
            const target = e.target as HTMLElement | null;
            const chip = target?.closest(`.${QA_SIDENOTE_REF_CLASS}`) as HTMLElement | null;
            const container = containerRef.current;
            if (!chip || !container || !container.contains(chip)) {return;}
            const refId = chip.getAttribute('data-qa-id');
            if (!refId) {return;}
            if (openRef.current?.note.id === refId) {
                setOpen(null);
                return;
            }
            const answer = chip.getAttribute('data-qa-answer') ?? '';
            const question = chip.getAttribute('data-qa-question') || undefined;
            const persistedPhrase = chip.getAttribute('data-qa-selected-text');
            const phrase = persistedPhrase || phraseBeforeChip(chip);
            const contextBefore = persistedPhrase
                ? chip.getAttribute('data-qa-context-before') ?? ''
                : '';
            const contextAfter = persistedPhrase
                ? chip.getAttribute('data-qa-context-after') ?? ''
                : '';
            const rect = chip.getBoundingClientRect();
            const note: ClientSideNote = {
                id: refId,
                processId: '',
                turnIndex: NOTE_TURN_INDEX,
                anchor: {
                    selectedText: phrase,
                    contextBefore,
                    contextAfter,
                    fingerprint: '',
                },
                question,
                answer,
                label: labelFor(phrase || answer),
                createdAt: '',
                status: 'ready',
            };
            setOpen({
                note,
                position: { top: rect.bottom + 6, left: rect.left },
                selection: {
                    turnIndex: NOTE_TURN_INDEX,
                    selectedText: phrase,
                    contextBefore,
                    contextAfter,
                    rect,
                },
            });
        };
        document.addEventListener('click', onClick);
        return () => document.removeEventListener('click', onClick);
    }, [enabled, containerRef]);

    // AC-04: dismiss the open answer popover on an outside pointer-down (mirrors
    // the input's dismiss idiom). A chip click is spared so it can toggle itself,
    // and clicks inside the popover are spared so reading/acting doesn't close it.
    useEffect(() => {
        if (!open) {return;}
        const onDown = (e: MouseEvent) => {
            const target = e.target as HTMLElement | null;
            if (target?.closest('[data-testid="quick-ask-popover"]')) {return;}
            if (target?.closest(`.${QA_SIDENOTE_REF_CLASS}`)) {return;}
            setOpen(null);
        };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [open]);

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

    // AC-04 delete control: remove the marker node from the live document so the
    // inline `[^qa-<id>]` marker and its bottom definition both vanish on save,
    // then close the popover. A no-op when the note was never embedded (still
    // asking/error) — nothing to remove.
    const handleDelete = useCallback((id: string) => {
        deleteSidenoteRef(editorRef.current, id);
        setOpen(null);
    }, []);

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
