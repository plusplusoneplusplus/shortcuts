/**
 * useChatPaneNavigation — vim-style `h` / `l` navigation between the chat
 * list pane (left) and the chat detail pane (right), plus `j` / `k` /
 * `Enter` / `o` / `i` while the list pane has focus.
 *
 * Mounted once by `RepoChatTab` (and `ProcessesView`). Uses a window-level
 * keydown listener gated on:
 *   - `enabled === true`
 *   - active element is NOT editable (input/textarea/contenteditable)
 *   - no Ctrl/Meta/Alt modifier (Shift allowed but unused)
 *   - no IME composition
 *
 * Cross-pane shortcuts:
 *   - `h` → focus list pane; sets cursor to selectedTaskId or first card.
 *   - `l` → focus detail pane; on mobile flips `mobileShowDetail` via callback.
 *   - `i` → focus the chat input (returns to typing).
 *
 * List-pane-only shortcuts (when `focusedPane === 'list'`):
 *   - `j` / `k` → step to the next/previous navigable task card (no wrap)
 *     and **open it immediately** via `onSelectTask` (Slack/Gmail style).
 *     Cursor mirrors the new selection.
 *   - `Enter` / `o` → re-open the cursor's chat, or `selectedTaskId` if no
 *     cursor is set. Useful after `Esc` blurred the input.
 *
 * Cards are discovered from `listContainerRef.querySelectorAll('[data-task-id]')`
 * at keypress time, naturally honoring whatever filter/sort the list applies.
 *
 * Conflict avoidance with the j/k message-nav hook (in `ConversationArea`):
 * that hook attaches its listener to its own conversation container, so when
 * the list pane holds focus the conversation listener does not fire.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useDisplaySettings } from '../../../hooks/preferences/useDisplaySettings';

export interface UseChatPaneNavigationArgs {
    listContainerRef: React.RefObject<HTMLDivElement | null>;
    detailContainerRef: React.RefObject<HTMLDivElement | null>;
    inputRef?: React.RefObject<{ focus: () => void } | null> | null;
    selectedTaskId: string | null;
    onSelectTask: (id: string) => void;
    enabled?: boolean;
    isMobile?: boolean;
    mobileShowDetail?: boolean;
    onEnterDetail?: () => void;
    onEnterList?: () => void;
}

export interface UseChatPaneNavigationResult {
    focusedPane: 'list' | 'detail' | null;
    cursorTaskId: string | null;
}

function isEditable(el: Element | null): boolean {
    if (!el) return false;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    return (el as HTMLElement).isContentEditable === true;
}

function getNavigableTaskIds(listEl: HTMLElement | null): string[] {
    if (!listEl) return [];
    const nodes = listEl.querySelectorAll<HTMLElement>('[data-task-id]');
    const seen = new Set<string>();
    const out: string[] = [];
    for (const el of Array.from(nodes)) {
        const id = el.getAttribute('data-task-id');
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push(id);
    }
    return out;
}

export function useChatPaneNavigation(args: UseChatPaneNavigationArgs): UseChatPaneNavigationResult {
    const {
        listContainerRef,
        detailContainerRef,
        inputRef,
        selectedTaskId,
        onSelectTask,
        enabled = true,
        isMobile = false,
        mobileShowDetail = true,
        onEnterDetail,
        onEnterList,
    } = args;

    const { vimNavigationEnabled } = useDisplaySettings();
    const effectiveEnabled = enabled && vimNavigationEnabled;

    const [focusedPane, setFocusedPane] = useState<'list' | 'detail'>(
        selectedTaskId ? 'detail' : 'list',
    );
    const [cursorTaskId, setCursorTaskId] = useState<string | null>(null);

    // Keep refs to latest values so the keydown listener doesn't need to be re-bound.
    const stateRef = useRef({
        focusedPane,
        cursorTaskId,
        selectedTaskId,
        enabled: effectiveEnabled,
        isMobile,
        mobileShowDetail,
    });
    stateRef.current = {
        focusedPane,
        cursorTaskId,
        selectedTaskId,
        enabled: effectiveEnabled,
        isMobile,
        mobileShowDetail,
    };

    const callbacksRef = useRef({ onSelectTask, onEnterDetail, onEnterList });
    callbacksRef.current = { onSelectTask, onEnterDetail, onEnterList };

    const focusList = useCallback(() => {
        const el = listContainerRef.current;
        if (el) {
            try { el.focus({ preventScroll: true }); } catch { el.focus(); }
        }
    }, [listContainerRef]);

    const focusDetail = useCallback(() => {
        const el = detailContainerRef.current;
        if (el) {
            try { el.focus({ preventScroll: true }); } catch { el.focus(); }
        }
    }, [detailContainerRef]);

    const scrollCursorIntoView = useCallback((id: string) => {
        const list = listContainerRef.current;
        if (!list) return;
        let el: HTMLElement | null = null;
        try {
            el = list.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(id)}"]`);
        } catch {
            el = null;
        }
        if (!el) return;
        try {
            el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        } catch {
            el.scrollIntoView();
        }
    }, [listContainerRef]);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            const s = stateRef.current;
            if (!s.enabled) return;
            if (e.isComposing || (e as any).keyCode === 229) return;
            if (e.ctrlKey || e.metaKey || e.altKey) return;

            const active = (typeof document !== 'undefined' ? document.activeElement : null) as Element | null;
            if (isEditable(active)) return;

            // Resolve which pane currently "owns" focus.
            const listEl = listContainerRef.current;
            const detailEl = detailContainerRef.current;
            let currentPane: 'list' | 'detail' = s.focusedPane;
            if (active && listEl && listEl.contains(active)) currentPane = 'list';
            else if (active && detailEl && detailEl.contains(active)) currentPane = 'detail';

            const key = e.key;

            if (key === 'h' && !e.shiftKey) {
                if (s.isMobile && !s.mobileShowDetail) {
                    // Already on the list view on mobile — nothing to do.
                    return;
                }
                if (s.isMobile) {
                    callbacksRef.current.onEnterList?.();
                }
                setFocusedPane('list');
                const ids = getNavigableTaskIds(listContainerRef.current);
                const next = s.selectedTaskId && ids.includes(s.selectedTaskId)
                    ? s.selectedTaskId
                    : (ids[0] ?? null);
                setCursorTaskId(next);
                focusList();
                if (next) scrollCursorIntoView(next);
                e.preventDefault();
                return;
            }

            if (key === 'l' && !e.shiftKey) {
                if (s.isMobile) {
                    if (!s.selectedTaskId) {
                        // No chat selected — nothing meaningful to show in detail.
                        return;
                    }
                    callbacksRef.current.onEnterDetail?.();
                }
                setFocusedPane('detail');
                focusDetail();
                e.preventDefault();
                return;
            }

            if (key === 'i' && !e.shiftKey) {
                const inp = inputRef?.current;
                if (inp) {
                    inp.focus();
                    e.preventDefault();
                }
                return;
            }

            // List-pane-only shortcuts.
            if (currentPane !== 'list') return;

            if ((key === 'j' || key === 'k') && !e.shiftKey) {
                const ids = getNavigableTaskIds(listContainerRef.current);
                if (ids.length === 0) return;
                const cur = s.cursorTaskId;
                let nextIdx: number;
                if (cur == null || !ids.includes(cur)) {
                    nextIdx = key === 'j' ? 0 : ids.length - 1;
                } else {
                    const pos = ids.indexOf(cur);
                    if (key === 'j') {
                        if (pos >= ids.length - 1) return;
                        nextIdx = pos + 1;
                    } else {
                        if (pos <= 0) return;
                        nextIdx = pos - 1;
                    }
                }
                const nextId = ids[nextIdx];
                setCursorTaskId(nextId);
                callbacksRef.current.onSelectTask(nextId);
                scrollCursorIntoView(nextId);
                e.preventDefault();
                return;
            }

            if ((key === 'Enter' || key === 'o') && !e.shiftKey) {
                const target = s.cursorTaskId ?? s.selectedTaskId;
                if (!target) return;
                callbacksRef.current.onSelectTask(target);
                e.preventDefault();
                return;
            }
        };

        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [listContainerRef, detailContainerRef, inputRef, focusList, focusDetail, scrollCursorIntoView]);

    return {
        focusedPane: effectiveEnabled ? focusedPane : null,
        cursorTaskId: effectiveEnabled ? cursorTaskId : null,
    };
}
