/**
 * QuickAskTurnLayer — per-assistant-turn glue for Quick Ask side-notes.
 *
 * Watches for text selections inside the turn's content container and raises
 * the ✨ Ask AI pill; renders the collected "💡 Side notes" chip row at the
 * bottom of the message; and opens the answer popover on chip click.
 *
 * All rendering is gated by the admin `features.quickAskSidenotes` flag at the
 * call site, so this component is only mounted when the feature is enabled.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '../../../ui';
import { getQuickAskSelection } from './quick-ask-selection';
import { QuickAskPill } from './QuickAskPill';
import { QuickAskSidenotePopover } from './QuickAskSidenotePopover';
import type { ClientSideNote, QuickAskSelection } from './types';

export interface QuickAskTurnLayerProps {
    /** The assistant turn's rendered-content container. */
    containerRef: React.RefObject<HTMLElement | null>;
    /** Index of this assistant turn. */
    turnIndex: number;
    /** Selection is disabled while the turn is still streaming. */
    streaming?: boolean;
    /** Side-notes for THIS turn (persisted + optimistic). */
    notes: ClientSideNote[];
    onAsk: (selection: QuickAskSelection) => void;
    onRetry: (id: string) => void;
    onDelete: (id: string) => void;
    onCopy: (note: ClientSideNote) => void;
}

interface OpenPopover {
    id: string;
    position: { top: number; left: number };
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
    const [open, setOpen] = useState<OpenPopover | null>(null);
    const selectionRef = useRef<QuickAskSelection | null>(null);
    selectionRef.current = selection;

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
                    onAsk(next);
                    window.getSelection()?.removeAllRanges();
                    setSelection(null);
                }
            }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [containerRef, streaming, turnIndex, onAsk]);

    const handleAsk = useCallback(() => {
        const sel = selectionRef.current;
        if (!sel) {return;}
        onAsk(sel);
        window.getSelection()?.removeAllRanges();
        setSelection(null);
    }, [onAsk]);

    const handleChipClick = useCallback((e: React.MouseEvent, id: string) => {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setOpen(prev => (prev?.id === id ? null : { id, position: { top: rect.bottom + 6, left: rect.left } }));
    }, []);

    const openNote = open ? notes.find(n => n.id === open.id) ?? null : null;

    return (
        <>
            {selection && (
                <QuickAskPill rect={selection.rect} onAsk={handleAsk} onDismiss={clearSelection} />
            )}

            {notes.length > 0 && (
                <div
                    className="mt-1.5 flex flex-wrap items-center gap-1.5"
                    data-testid="quick-ask-sidenote-row"
                >
                    <span className="text-[11px] text-[#848484] select-none" aria-hidden="true">
                        💡 Side notes ({notes.length})
                    </span>
                    {notes.map(note => {
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
                                onClick={e => handleChipClick(e, note.id)}
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
                    onClose={() => setOpen(null)}
                    onCopy={onCopy}
                    onRetry={onRetry}
                    onDelete={onDelete}
                />
            )}
        </>
    );
}
