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

import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { Editor } from '@tiptap/core';
import { requestForWorkspace } from '../../../../repos/cloneRegistry';
import { useCloneBaseUrl } from '../../../../repos/cloneRouting';
import { useQuickAskSidenotesEnabled } from '../../../../hooks/feature-flags/useQuickAskSidenotesEnabled';
import { QuickAskPill } from '../../../chat/quick-ask/QuickAskPill';
import { QuickAskInput } from '../../../chat/quick-ask/QuickAskInput';
import { QuickAskSidenotePopover } from '../../../chat/quick-ask/QuickAskSidenotePopover';
import type { ClientSideNote, QuickAskSelection, QuickAskTurn } from '../../../chat/quick-ask/types';
import { decodeQaTurns, QA_SIDENOTE_REF_CLASS, type QaTurn } from './sidenoteFootnote';
import { deleteSidenoteRef, insertSidenoteRef, updateSidenoteRefTurns } from './sidenoteRefPlacement';
import {
    MAX_QUICK_ASK_TURNS as MAX_TURNS, patchQuickAskTurn as patchTurn,
    quickAskHistory as historyBefore, quickAskLabel as labelFor,
    useDocumentQuickAskSelection, useDocumentQuickAskThread,
    type QuickAskHistoryTurn as HistoryTurn,
} from './useDocumentQuickAsk';

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

export function NoteQuickAskLayer({ containerRef, workspaceId, editor }: NoteQuickAskLayerProps) {
    const enabled = useQuickAskSidenotesEnabled() && !!workspaceId;

    const baseUrl = useCloneBaseUrl(workspaceId);
    const owner = useMemo(() => ({ workspaceId, baseUrl, enabled }), [workspaceId, baseUrl, enabled]);
    const { selection, input, inputRef, setInput, clearSelection, cancelInput, handleAsk } =
        useDocumentQuickAskSelection(containerRef, enabled, owner);
    const { open, setOpen, openRef, start, advance, beginRequest, closePopover, handleCopy } =
        useDocumentQuickAskThread(owner);
    // The editor is read at write time (answer landing), never captured in a
    // callback closure — one instance survives note switches / re-renders.
    const editorRef = useRef<Editor | null | undefined>(editor);
    editorRef.current = editor;

    // Run one stateless grounded turn, updating that turn in place by id+index.
    // `history` carries the prior Q/A turns so a follow-up is answered coherently
    // (AC-01); it is omitted when empty so turn 0 is byte-for-byte the one-shot
    // request. On the FIRST turn's success the answer is embedded into the note
    // `.md` as a footnote marker at the anchor phrase (AC-03); every follow-up
    // re-writes that marker's turns. Persistence is UNCONDITIONAL (mirrors the
    // PDF layers): it folds the just-answered turn into the launch-time
    // `threadTurns` snapshot rather than reading popover-open state, so an answer
    // that lands after the popover was dismissed is still persisted. If the
    // anchor phrase was deleted while in flight the marker is dropped rather than
    // orphaned (AC-05) — enforced downstream by `resolveSidenoteInsertPos`
    // returning null, NOT by popover-open state.
    const postTurn = useCallback((
        sel: QuickAskSelection,
        question: string | undefined,
        history: HistoryTurn[],
        noteId: string,
        turnIndex: number,
        threadTurns: QuickAskTurn[],
    ) => {
        if (!workspaceId) {return;}
        const request = beginRequest(noteId, turnIndex);
        const path = `/api/quick-ask/answer?workspace=${encodeURIComponent(workspaceId)}`;
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
            }),
        })
            .then(data => {
                if (!request.isCurrent()) return;
                const answer = typeof data?.answer === 'string' ? data.answer : '';
                if (!answer) {throw new Error('Malformed response');}
                // Persist the whole thread onto the marker (AC-03). Fold this
                // just-answered turn into the launch-time snapshot's ready turns
                // so turn 0 *inserts* the marker and every follow-up *re-writes*
                // its `data-qa-turns` — the marker never lags behind the thread,
                // even if the popover was dismissed mid-flight.
                const persistTurns: QaTurn[] = threadTurns
                    .map((t, i) =>
                        (i === turnIndex
                            ? { question: t.question, answer, status: 'ready' as const }
                            : t))
                    .filter(t => t.status === 'ready')
                    .map(t => ({ question: t.question, answer: t.answer }));
                if (turnIndex === 0) {
                    insertSidenoteRef(
                        editorRef.current,
                        {
                            selectedText: sel.selectedText,
                            contextBefore: sel.contextBefore,
                            contextAfter: sel.contextAfter,
                        },
                        { refId: noteId, question, answer, turns: persistTurns },
                    );
                } else {
                    updateSidenoteRefTurns(editorRef.current, noteId, persistTurns);
                }
                setOpen(prev => {
                    const next = patchTurn(prev, noteId, turnIndex, { status: 'ready', answer, error: undefined });
                    return next ? { ...next, note: { ...next.note, model: data.model } } : next;
                });
            })
            .catch(() => {
                if (!request.isCurrent()) return;
                setOpen(prev => patchTurn(prev, noteId, turnIndex, { status: 'error', error: 'Lookup failed' }));
            })
            .finally(request.finish);
    }, [workspaceId, beginRequest, setOpen]);

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
            // Reconstruct the full thread from the marker's `data-qa-turns` (AC-03);
            // fall back to the turn-0 answer/question mirror for a legacy marker
            // that predates multi-turn persistence.
            const turnsAttr = chip.getAttribute('data-qa-turns');
            const decodedTurns = turnsAttr ? decodeQaTurns(turnsAttr) : null;
            const answer = decodedTurns?.[0]?.answer ?? chip.getAttribute('data-qa-answer') ?? '';
            const question =
                decodedTurns?.[0]?.question ?? (chip.getAttribute('data-qa-question') || undefined);
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
                turns: decodedTurns && decodedTurns.length
                    ? decodedTurns.map(t => ({ question: t.question, answer: t.answer, status: 'ready' as const }))
                    : [{ question, answer, status: 'ready' }],
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

    // Submit the input: fire the lookup and open the popover with an optimistic
    // "asking" note anchored just below the selection.
    const submitInput = useCallback((question: string) => {
        const sel = inputRef.current;
        setInput(null);
        if (!sel) {return;}
        const trimmed = question.trim() || undefined;
        const id = newRefId();
        const thread = start(sel, trimmed, id, {});
        postTurn(sel, trimmed, [], id, 0, thread.turns);
    }, [postTurn, start, inputRef, setInput]);

    // Per-turn retry (AC-02): re-run turn `turnIndex` with the same question and
    // the prior ready turns as history, preserving the rest of the thread.
    const handleRetry = useCallback((turnIndex: number) => {
        advance(turnIndex, (thread, index) => {
            postTurn(thread.selection, thread.turns[index].question, historyBefore(thread.turns, index), thread.note.id, index, thread.turns);
        });
    }, [postTurn, advance]);

    // Send a follow-up (AC-02): append a new asking turn and post it with the
    // accumulated ready turns as grounding history. Blocked at the soft cap.
    const handleSend = useCallback((question: string) => {
        advance(question, (thread, index) => {
            postTurn(thread.selection, question, historyBefore(thread.turns, index), thread.note.id, index, thread.turns);
        });
    }, [postTurn, advance]);

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
