/**
 * useMessageNavigation — vim-style j/k navigation between conversation turns.
 *
 * Behavior (only fires when the chat input is NOT focused):
 *   - `j` → next turn
 *   - `k` → previous turn (no wrap on either edge)
 *   - `g` then `g` within ~500ms → first turn
 *   - `Shift+G` → last turn
 *   - `Esc` → blur the chat input (and focus the chat container so j/k work)
 *   - `i` → focus the chat input (return to typing)
 *
 * Scoping: the hook listens on the chat container element supplied via
 * `containerRef`. Each chat (inline + each floating chat) owns its own
 * container, so multiple chats do not fight. The container should have
 * `tabIndex={-1}` so it can receive focus when the user presses Esc.
 *
 * The hook discovers navigable turns from the DOM at keypress time using
 * `[data-turn-index]`, naturally excluding deleted/archived turns. Bubbles
 * inside an element marked `data-pinned-section` are ignored to avoid the
 * pinned-section duplicates competing with the main timeline copy.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface MessageNavigationOptions {
    /** The scrolling element that contains the rendered turn bubbles. */
    scrollRef: React.RefObject<HTMLDivElement | null>;
    /** The outermost chat container. Must have tabIndex={-1} for focus management. */
    containerRef: React.RefObject<HTMLDivElement | null>;
    /** Optional: handle/element used to focus or blur the chat text input. */
    inputRef?: React.RefObject<{ focus: () => void } | null> | null;
    /** Whether the navigation hook is enabled (defaults to true). */
    enabled?: boolean;
}

export interface MessageNavigationState {
    /** Currently focused turn index (the "cursor"), or null when no cursor. */
    currentTurnIndex: number | null;
    /** Whether the brief nav-mode hint pill should be visible. */
    navHintVisible: boolean;
}

/** True if the element looks like an editable text surface (input/textarea/contenteditable). */
function isEditable(el: Element | null): boolean {
    if (!el) return false;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    const html = el as HTMLElement;
    if (html.isContentEditable) return true;
    return false;
}

/** Returns navigable turn elements in DOM order, skipping the pinned section. */
function getNavigableTurns(scrollEl: HTMLElement | null): HTMLElement[] {
    if (!scrollEl) return [];
    const all = scrollEl.querySelectorAll<HTMLElement>('[data-turn-index]');
    const out: HTMLElement[] = [];
    for (const el of Array.from(all)) {
        if (el.closest('[data-pinned-section]')) continue;
        out.push(el);
    }
    return out;
}

const HINT_TIMEOUT_MS = 2500;
const G_CHORD_TIMEOUT_MS = 500;

export function useMessageNavigation(opts: MessageNavigationOptions): MessageNavigationState {
    const { scrollRef, containerRef, inputRef, enabled = true } = opts;

    const [currentTurnIndex, setCurrentTurnIndex] = useState<number | null>(null);
    const [navHintVisible, setNavHintVisible] = useState(false);

    const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastGAtRef = useRef<number>(0);

    const showHint = useCallback(() => {
        setNavHintVisible(true);
        if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
        hintTimerRef.current = setTimeout(() => setNavHintVisible(false), HINT_TIMEOUT_MS);
    }, []);

    const hideHint = useCallback(() => {
        setNavHintVisible(false);
        if (hintTimerRef.current) {
            clearTimeout(hintTimerRef.current);
            hintTimerRef.current = null;
        }
    }, []);

    const scrollTo = useCallback((idx: number) => {
        const scrollEl = scrollRef.current;
        if (!scrollEl) return;
        const target = scrollEl.querySelector<HTMLElement>(`[data-turn-index="${idx}"]:not([data-pinned-section] *)`);
        if (!target) return;
        try {
            target.scrollIntoView({ block: 'start', behavior: 'smooth' });
        } catch {
            target.scrollIntoView();
        }
    }, [scrollRef]);

    useEffect(() => {
        if (!enabled) return;
        const container = containerRef.current;
        if (!container) return;

        const handler = (e: KeyboardEvent) => {
            // Ignore IME composition events.
            if (e.isComposing || e.keyCode === 229) return;

            const target = e.target as Element | null;
            const active = (typeof document !== 'undefined' ? document.activeElement : null) as Element | null;

            // Esc: always handle if focus is anywhere inside our container.
            if (e.key === 'Escape' && !e.ctrlKey && !e.metaKey && !e.altKey) {
                if (target && container.contains(target)) {
                    if (active && isEditable(active) && container.contains(active)) {
                        (active as HTMLElement).blur();
                    }
                    container.focus();
                    setCurrentTurnIndex(prev => {
                        if (prev != null) return prev;
                        const turns = getNavigableTurns(scrollRef.current);
                        if (turns.length === 0) return null;
                        const lastEl = turns[turns.length - 1];
                        const n = Number(lastEl.getAttribute('data-turn-index'));
                        return Number.isFinite(n) ? n : null;
                    });
                    showHint();
                    e.preventDefault();
                }
                return;
            }

            // For all other keys, only act if focus is NOT inside an editable
            // element (so typing in the chat input is unaffected) AND the event
            // target is inside our container.
            if (!target || !container.contains(target)) return;
            if (isEditable(active)) return;

            // Reject events with disqualifying modifier keys (allow Shift only for `G`).
            if (e.ctrlKey || e.metaKey || e.altKey) return;

            // `i` → focus chat input.
            if (e.key === 'i' && !e.shiftKey) {
                if (inputRef?.current) {
                    inputRef.current.focus();
                    hideHint();
                    e.preventDefault();
                }
                return;
            }

            const turns = getNavigableTurns(scrollRef.current);
            if (turns.length === 0) return;
            const indices = turns.map(el => Number(el.getAttribute('data-turn-index'))).filter(n => Number.isFinite(n));
            if (indices.length === 0) return;

            // `j` / `k` step.
            if ((e.key === 'j' || e.key === 'k') && !e.shiftKey) {
                const cur = currentTurnIndex;
                let nextIdx: number;
                if (cur == null) {
                    nextIdx = e.key === 'j' ? indices[0] : indices[indices.length - 1];
                } else {
                    const pos = indices.indexOf(cur);
                    if (pos === -1) {
                        nextIdx = e.key === 'j' ? indices[0] : indices[indices.length - 1];
                    } else if (e.key === 'j') {
                        if (pos >= indices.length - 1) return;
                        nextIdx = indices[pos + 1];
                    } else {
                        if (pos <= 0) return;
                        nextIdx = indices[pos - 1];
                    }
                }
                setCurrentTurnIndex(nextIdx);
                scrollTo(nextIdx);
                showHint();
                e.preventDefault();
                return;
            }

            // `Shift+G` → last.
            if (e.key === 'G' && e.shiftKey) {
                const last = indices[indices.length - 1];
                setCurrentTurnIndex(last);
                scrollTo(last);
                showHint();
                e.preventDefault();
                return;
            }

            // `gg` chord → first.
            if (e.key === 'g' && !e.shiftKey) {
                const now = Date.now();
                if (now - lastGAtRef.current <= G_CHORD_TIMEOUT_MS) {
                    const first = indices[0];
                    setCurrentTurnIndex(first);
                    scrollTo(first);
                    showHint();
                    lastGAtRef.current = 0;
                    e.preventDefault();
                } else {
                    lastGAtRef.current = now;
                    e.preventDefault();
                }
                return;
            }
        };

        container.addEventListener('keydown', handler);
        return () => {
            container.removeEventListener('keydown', handler);
        };
    }, [enabled, containerRef, scrollRef, inputRef, currentTurnIndex, scrollTo, showHint, hideHint]);

    useEffect(() => {
        return () => {
            if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
        };
    }, []);

    return { currentTurnIndex, navHintVisible };
}
