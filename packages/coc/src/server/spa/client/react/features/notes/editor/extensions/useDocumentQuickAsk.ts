import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { getQuickAskSelection } from '../../../chat/quick-ask/quick-ask-selection';
import type { ClientSideNote, QuickAskSelection, QuickAskTurn } from '../../../chat/quick-ask/types';

export const MAX_QUICK_ASK_TURNS = 10;
export type QuickAskHistoryTurn = { question?: string; answer: string };

export interface DocumentQuickAskThread {
    note: ClientSideNote;
    position: { top: number; left: number };
    selection: QuickAskSelection;
    turns: QuickAskTurn[];
}

export function quickAskLabel(selectedText: string): string {
    const collapsed = selectedText.replace(/\s+/g, ' ').trim();
    return collapsed.length <= 22 ? collapsed : collapsed.slice(0, 22).trimEnd() + '…';
}

export function quickAskHistory(turns: QuickAskTurn[], upto = turns.length): QuickAskHistoryTurn[] {
    return turns.slice(0, upto).filter(t => t.status === 'ready')
        .map(t => ({ question: t.question, answer: t.answer }));
}

export function patchQuickAskTurn<T extends DocumentQuickAskThread>(
    prev: T | null, noteId: string, turnIndex: number, patch: Partial<QuickAskTurn>,
): T | null {
    if (!prev || prev.note.id !== noteId || !prev.turns[turnIndex]) return prev;
    const turns = prev.turns.map((t, i) => i === turnIndex ? { ...t, ...patch } : t);
    const latest = turns[turns.length - 1];
    return { ...prev, turns, note: { ...prev.note, status: latest.status, answer: latest.answer, error: latest.error } };
}

/** Selection listeners are shared; callers capture document-specific anchors before clearing the DOM selection. */
export function useDocumentQuickAskSelection(
    containerRef: RefObject<HTMLElement | null>, enabled: boolean, owner: unknown, beforeInput?: () => void,
) {
    const [selection, setSelection] = useState<QuickAskSelection | null>(null);
    const [input, setInput] = useState<QuickAskSelection | null>(null);
    const selectionRef = useRef(selection);
    const inputRef = useRef(input);
    selectionRef.current = selection;
    inputRef.current = input;
    const beforeInputRef = useRef(beforeInput);
    beforeInputRef.current = beforeInput;
    const beginInput = useCallback((next: QuickAskSelection) => {
        beforeInputRef.current?.();
        setInput(next);
        window.getSelection()?.removeAllRanges();
        setSelection(null);
    }, []);
    const handleAsk = useCallback(() => {
        if (selectionRef.current) beginInput(selectionRef.current);
    }, [beginInput]);
    const clearSelection = useCallback(() => setSelection(null), []);
    const cancelInput = useCallback(() => setInput(null), []);

    useEffect(() => {
        setSelection(null);
        setInput(null);
        if (!enabled) return;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const onMouseUp = () => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                const container = containerRef.current;
                setSelection(container ? getQuickAskSelection(container, 0) : null);
            }, 0);
        };
        const onMouseDown = (event: MouseEvent) => {
            const target = event.target as HTMLElement | null;
            if (!target?.closest('[data-testid="quick-ask-pill"]')) setSelection(null);
            if (!target?.closest('[data-testid="quick-ask-input"]')) setInput(null);
        };
        const onKey = (event: KeyboardEvent) => {
            if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'j') return;
            const container = containerRef.current;
            const next = container ? getQuickAskSelection(container, 0) : null;
            if (!next) return;
            event.preventDefault();
            beginInput(next);
        };
        document.addEventListener('mouseup', onMouseUp);
        document.addEventListener('mousedown', onMouseDown);
        document.addEventListener('keydown', onKey);
        return () => {
            clearTimeout(timer);
            document.removeEventListener('mouseup', onMouseUp);
            document.removeEventListener('mousedown', onMouseDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [containerRef, enabled, owner, beginInput]);

    return { selection, input, inputRef, setInput, clearSelection, cancelInput, handleAsk };
}

export function useDocumentQuickAskThread<TExtra extends object = Record<never, never>>(owner: unknown) {
    type Thread = DocumentQuickAskThread & TExtra;
    const [open, setOpen] = useState<Thread | null>(null);
    const openRef = useRef(open);
    openRef.current = open;
    const lifetime = useRef({ owner, active: true, requests: new Map<string, AbortController>() });
    if (lifetime.current.owner !== owner) {
        lifetime.current.active = false;
        lifetime.current = { owner, active: true, requests: new Map() };
    }
    useEffect(() => {
        const current = lifetime.current;
        current.active = true;
        setOpen(null);
        return () => {
            current.active = false;
            for (const controller of current.requests.values()) controller.abort();
            current.requests.clear();
        };
    }, [owner]);

    const beginRequest = useCallback((noteId: string, turnIndex: number) => {
        const current = lifetime.current;
        const key = `${noteId}:${turnIndex}`;
        current.requests.get(key)?.abort();
        const controller = new AbortController();
        current.requests.set(key, controller);
        return {
            signal: controller.signal,
            isCurrent: () => current.active && !controller.signal.aborted,
            finish: () => {
                if (current.requests.get(key) === controller) current.requests.delete(key);
            },
        };
    }, []);
    const start = useCallback((
        selection: QuickAskSelection, question: string | undefined, id: string,
        extra: TExtra & { [K in keyof DocumentQuickAskThread]?: never },
    ) => {
        const thread: Thread = {
            ...extra,
            note: {
                id, processId: '', turnIndex: selection.turnIndex,
                anchor: { selectedText: selection.selectedText, contextBefore: selection.contextBefore, contextAfter: selection.contextAfter, fingerprint: '' },
                question, answer: '', label: quickAskLabel(selection.selectedText), createdAt: new Date().toISOString(), status: 'asking',
            },
            position: { top: selection.rect.bottom + 6, left: selection.rect.left },
            selection, turns: [{ question, answer: '', status: 'asking' }],
        };
        openRef.current = thread;
        setOpen(thread);
        return thread;
    }, []);
    const advance = useCallback((questionOrIndex: string | number, post: (thread: Thread, turnIndex: number) => void) => {
        const previous = openRef.current;
        if (!previous) return;
        const retry = typeof questionOrIndex === 'number';
        const index = retry ? questionOrIndex : previous.turns.length;
        let turns: QuickAskTurn[];
        if (typeof questionOrIndex === 'number') {
            if (!previous.turns[questionOrIndex]) return;
            turns = previous.turns.map((turn, i) => i === questionOrIndex ? { ...turn, status: 'asking', error: undefined } : turn);
        } else {
            if (index >= MAX_QUICK_ASK_TURNS) return;
            turns = [...previous.turns, { question: questionOrIndex, answer: '', status: 'asking' }];
        }
        const next = { ...previous, turns, note: { ...previous.note, status: 'asking' as const, ...(retry ? { error: undefined } : {}) } };
        openRef.current = next;
        setOpen(next);
        post(next, index);
    }, []);
    const closePopover = useCallback(() => {
        openRef.current = null;
        setOpen(null);
    }, []);
    const handleCopy = useCallback((note: ClientSideNote, text?: string) => {
        try { void navigator.clipboard?.writeText(text ?? note.answer); } catch { /* best-effort */ }
    }, []);
    return { open, setOpen, openRef, start, advance, beginRequest, closePopover, handleCopy };
}
