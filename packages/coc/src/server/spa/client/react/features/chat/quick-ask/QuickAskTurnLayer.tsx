/**
 * QuickAskTurnLayer — per-assistant-turn glue for Quick Ask side-notes.
 *
 * Watches for text selections inside the turn's content container and raises
 * the ✨ Ask AI pill; renders the collected "💡 Side notes" chips; and opens the
 * answer popover on chip click.
 *
 * Chips whose source phrase resolves inside the rendered turn are injected
 * **inline** at that phrase (AC-03); chips whose source can't be located fall
 * back to the detached "💡 Side notes (N)" footer row. Both kinds of chip run
 * the same click behavior: scroll-to + persistently highlight the source (or,
 * when unresolved, flash the whole turn) and open the answer popover.
 *
 * All rendering is gated by the admin `features.quickAskSidenotes` flag at the
 * call site, so this component is only mounted when the feature is enabled.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '../../../ui';
import { getQuickAskSelection } from './quick-ask-selection';
import { QuickAskPill } from './QuickAskPill';
import { QuickAskInput } from './QuickAskInput';
import { QuickAskSidenotePopover } from './QuickAskSidenotePopover';
import { resolveSidenoteAnchor } from './sidenoteAnchoring';
import {
    clearSidenoteAnchorIndicators,
    clearSidenoteHighlights,
    flashTurn,
    highlightSidenoteRange,
    indicateSidenoteAnchor,
    scrollElementIntoView,
} from './sidenoteHighlight';
import { clearInlineChips, injectInlineChip } from './sidenoteInlineChips';
import type { ClientSideNote, QuickAskSelection } from './types';
import './sidenoteHighlight.css';

export interface QuickAskTurnLayerProps {
    /** The assistant turn's rendered-content container. */
    containerRef: React.RefObject<HTMLElement | null>;
    /** Index of this assistant turn. */
    turnIndex: number;
    /** Selection is disabled while the turn is still streaming. */
    streaming?: boolean;
    /** Side-notes for THIS turn (persisted + optimistic). */
    notes: ClientSideNote[];
    onAsk: (selection: QuickAskSelection, question?: string) => void;
    onRetry: (id: string) => void;
    onDelete: (id: string) => void;
    onCopy: (note: ClientSideNote) => void;
}

interface OpenPopover {
    id: string;
    position: { top: number; left: number };
}

/** Stable empty set so an "all inline / none located" state keeps referential identity. */
const EMPTY_IDS: ReadonlySet<string> = new Set();

/** Shallow set equality by membership (both are id sets). */
function sameIdSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
    if (a === b) {return true;}
    if (a.size !== b.size) {return false;}
    for (const id of a) {
        if (!b.has(id)) {return false;}
    }
    return true;
}

export function QuickAskTurnLayer({
    containerRef,
    turnIndex,
    streaming,
    notes,
    onAsk,
    onRetry,
    onDelete,
    onCopy,
}: QuickAskTurnLayerProps) {
    const [selection, setSelection] = useState<QuickAskSelection | null>(null);
    // Selection whose Ask AI pill has been triggered and expanded into the
    // inline question input (AC-01). Null when no input is open.
    const [input, setInput] = useState<QuickAskSelection | null>(null);
    const [open, setOpen] = useState<OpenPopover | null>(null);
    const selectionRef = useRef<QuickAskSelection | null>(null);
    selectionRef.current = selection;
    const inputRef = useRef<QuickAskSelection | null>(input);
    inputRef.current = input;
    const openRef = useRef<OpenPopover | null>(open);
    openRef.current = open;
    // Id of the side-note whose source phrase currently carries the persistent
    // highlight (null when nothing is highlighted). Drives the outside-click
    // clearing below.
    const [highlightId, setHighlightId] = useState<string | null>(null);
    // Ids of notes whose anchor resolved inline this render (AC-03). These render
    // as injected inline markers and are omitted from the footer fallback row.
    const [locatedIds, setLocatedIds] = useState<ReadonlySet<string>>(EMPTY_IDS);

    const clearSelection = useCallback(() => setSelection(null), []);

    const captureSelection = useCallback(() => {
        const container = containerRef.current;
        if (!container || streaming) {
            setSelection(null);
            return;
        }
        const next = getQuickAskSelection(container, turnIndex);
        setSelection(next);
    }, [containerRef, streaming, turnIndex]);

    // Raise/clear the pill from pointer selections.
    useEffect(() => {
        if (streaming) {return;}
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
    }, [captureSelection, streaming]);

    // Keyboard alternative: Cmd/Ctrl+J on an active selection in this turn.
    useEffect(() => {
        if (streaming) {return;}
        const onKey = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && (e.key === 'j' || e.key === 'J')) {
                const container = containerRef.current;
                if (!container) {return;}
                const next = getQuickAskSelection(container, turnIndex);
                if (next) {
                    e.preventDefault();
                    // AC-01: expand into the inline question input instead of
                    // firing the lookup immediately.
                    setInput(next);
                    window.getSelection()?.removeAllRanges();
                    setSelection(null);
                }
            }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [containerRef, streaming, turnIndex]);

    // Dismiss the open input when the user points down anywhere outside it
    // (mirrors today's pill dismiss-on-outside-click behavior). Escape is
    // handled inside QuickAskInput.
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

    // AC-01: clicking the pill expands into the inline question input at the
    // same anchor rather than firing the lookup immediately.
    const handleAsk = useCallback(() => {
        const sel = selectionRef.current;
        if (!sel) {return;}
        setInput(sel);
        window.getSelection()?.removeAllRanges();
        setSelection(null);
    }, []);

    // Submit the input: pass the typed question through (empty/whitespace →
    // undefined, preserving the default "Briefly explain" server behavior).
    const submitInput = useCallback((question: string) => {
        const sel = inputRef.current;
        setInput(null);
        if (!sel) {return;}
        const trimmed = question.trim();
        onAsk(sel, trimmed || undefined);
    }, [onAsk]);

    const cancelInput = useCallback(() => setInput(null), []);

    // Activate a chip (footer button OR injected inline marker): (AC-01) locate +
    // scroll-to + persistently highlight the source phrase — or, when it can't be
    // located, scroll the turn into view and flash it once — and (AC-02) toggle
    // the answer popover on the same click.
    const activateChip = useCallback((chipEl: HTMLElement, id: string) => {
        const rect = chipEl.getBoundingClientRect();
        const container = containerRef.current;

        // Any activation clears the previous highlight first (covers both
        // re-activating the same chip and switching to a different chip).
        clearSidenoteHighlights(container);

        // Same chip re-activated → close popover and clear highlight (toggle off).
        if (openRef.current?.id === id) {
            setOpen(null);
            setHighlightId(null);
            return;
        }

        const note = notes.find(n => n.id === id);
        const resolution = container && note ? resolveSidenoteAnchor(container, note.anchor) : { located: false as const };
        if (resolution.located) {
            const spans = highlightSidenoteRange(container!, resolution.from, resolution.to);
            scrollElementIntoView(spans[0] ?? container, { block: 'center', behavior: 'smooth' });
            setHighlightId(id);
        } else {
            // Not located: fall back to scrolling the top of the turn into view
            // and flashing the whole turn once (no silent no-op).
            scrollElementIntoView(container, { block: 'start', behavior: 'smooth' });
            flashTurn(container);
            setHighlightId(null);
        }

        setOpen({ id, position: { top: rect.bottom + 6, left: rect.left } });
    }, [containerRef, notes]);

    // Injected inline markers are plain DOM (not React), so their click listener
    // calls through this ref to always reach the latest `activateChip` closure.
    const activateRef = useRef(activateChip);
    activateRef.current = activateChip;

    // AC-03: place a clickable inline chip at each side-note's resolved source
    // phrase inside the rendered turn. Recomputed every render from the anchors
    // (never persisted), so it degrades gracefully when the turn re-renders or the
    // source text moves — unresolved notes simply fall back to the footer row.
    //
    // Runs as a layout effect so the DOM markers + `locatedIds` are applied before
    // paint (no footer→inline flash). Markers are cleared first every pass, and
    // are injected highest-offset-first so an earlier insertion never invalidates
    // a not-yet-injected range.
    useLayoutEffect(() => {
        const container = containerRef.current;
        clearInlineChips(container);
        clearSidenoteAnchorIndicators(container);
        if (!container || streaming) {
            setLocatedIds(prev => (prev.size ? EMPTY_IDS : prev));
            return;
        }

        const located: Array<{ note: ClientSideNote; from: number; to: number; range: Range }> = [];
        for (const note of notes) {
            if (note.status !== 'ready') {continue;}
            const res = resolveSidenoteAnchor(container, note.anchor);
            if (res.located) {located.push({ note, from: res.from, to: res.to, range: res.range });}
        }
        // Inject after the resolved end, highest offset first, so the text-node
        // split from one insertion never shifts an earlier (lower-offset) range.
        located.sort((a, b) => b.to - a.to || b.from - a.from);

        for (const { note, from, to, range } of located) {
            // Persistent indicator first: it only wraps text nodes (adds no
            // characters), so the chip's range — resolved from the same
            // container.textContent offsets — remains valid for insertion.
            indicateSidenoteAnchor(container, from, to);
            injectInlineChip(container, range, {
                id: note.id,
                label: note.label,
                fullText: note.anchor.selectedText,
                isError: note.status === 'error',
                onActivate: chip => activateRef.current(chip, note.id),
            });
        }

        const nextIds = new Set(located.map(l => l.note.id));
        setLocatedIds(prev => (sameIdSet(prev, nextIds) ? prev : nextIds));

        return () => {
            clearInlineChips(container);
            clearSidenoteAnchorIndicators(container);
        };
    }, [notes, containerRef, streaming]);

    // AC-01: a persistent highlight clears when the user clicks anywhere that is
    // not a side-note chip (chips manage their own highlight) and not inside the
    // open answer popover (so reading the answer doesn't dismiss the highlight).
    useEffect(() => {
        if (!highlightId) {return;}
        const onDown = (ev: MouseEvent) => {
            const target = ev.target as HTMLElement | null;
            if (target?.closest('[data-testid^="quick-ask-chip"]')) {return;}
            if (target?.closest('[data-testid="quick-ask-popover"]')) {return;}
            clearSidenoteHighlights(containerRef.current);
            setHighlightId(null);
        };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [highlightId, containerRef]);

    // Drop the highlight if this turn unmounts or its notes change out from under
    // it (e.g. a re-render moves/removes the highlighted source).
    useEffect(() => {
        return () => clearSidenoteHighlights(containerRef.current);
    }, [containerRef]);

    const openNote = open ? notes.find(n => n.id === open.id) ?? null : null;
    // Footer is the fallback home: notes that didn't resolve inline (plus the
    // transient asking/error states, which are never placed inline).
    const footerNotes = notes.filter(n => !locatedIds.has(n.id));

    return (
        <>
            {selection && !input && (
                <QuickAskPill rect={selection.rect} onAsk={handleAsk} onDismiss={clearSelection} />
            )}

            {input && (
                <QuickAskInput rect={input.rect} onSubmit={submitInput} onCancel={cancelInput} />
            )}

            {footerNotes.length > 0 && (
                <div
                    className="mt-1.5 flex flex-wrap items-center gap-1.5"
                    data-testid="quick-ask-sidenote-row"
                >
                    <span className="text-[11px] text-[#848484] select-none" aria-hidden="true">
                        💡 Side notes ({footerNotes.length})
                    </span>
                    {footerNotes.map(note => {
                        const isOpen = open?.id === note.id;
                        if (note.status === 'asking') {
                            return (
                                <span
                                    key={note.id}
                                    className="inline-flex items-center gap-1 h-[22px] px-2 rounded-full border border-dashed border-[#3794ff]/50 text-[11px] text-[#848484]"
                                    data-testid="quick-ask-chip-asking"
                                >
                                    <span className="w-2.5 h-2.5 rounded-full border-2 border-[#3794ff]/40 border-t-[#3794ff] animate-spin" />
                                    asking…
                                </span>
                            );
                        }
                        return (
                            <button
                                key={note.id}
                                type="button"
                                onClick={e => activateChip(e.currentTarget as HTMLElement, note.id)}
                                data-testid={note.status === 'error' ? 'quick-ask-chip-error' : 'quick-ask-chip'}
                                className={cn(
                                    'inline-flex items-center gap-1 h-[22px] px-2 rounded-full border text-[11px] transition-transform hover:-translate-y-px',
                                    note.status === 'error'
                                        ? 'border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400'
                                        : 'border-[#3794ff]/35 bg-[#3794ff]/[0.12] text-[#3794ff]',
                                    isOpen && 'ring-1 ring-[#3794ff]/50',
                                )}
                                title={note.anchor.selectedText}
                            >
                                <span aria-hidden="true">{note.status === 'error' ? '⚠' : '💡'}</span>
                                <span className="max-w-[140px] truncate">{note.label}</span>
                            </button>
                        );
                    })}
                </div>
            )}

            {openNote && open && (
                <QuickAskSidenotePopover
                    note={openNote}
                    position={open.position}
                    onClose={() => {
                        setOpen(null);
                        clearSidenoteHighlights(containerRef.current);
                        setHighlightId(null);
                    }}
                    onCopy={onCopy}
                    onRetry={onRetry}
                    onDelete={onDelete}
                />
            )}
        </>
    );
}
