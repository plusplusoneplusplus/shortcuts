/**
 * useChatPromptHistory — bash-style up/down arrow navigation through the
 * user's recent initial prompts in a workspace.
 *
 * Wired into NewChatArea, FollowUpInputArea, and EnqueueDialog. Lazily
 * fetches the workspace's prompt history on the first arrow press (cached
 * for 60 s per workspaceId), then walks backward (Up) through recent
 * prompts and forward (Down) toward the original draft.
 *
 * Behavior matrix:
 *   - Empty input + history available + Up → draft = '', show items[0]
 *   - At step N + Up → step N+1 (clamped to items.length - 1)
 *   - At step N + Down → step N-1 (or restore draft when stepping past 0)
 *   - User edits the input (typing, paste, etc.) → exit history mode;
 *     next Up restarts from the new draft
 *   - Cursor not at start (Up) / end (Down) of a non-empty input → no-op
 *     (let caret move within the line)
 *   - Slash-command or model-picker menu visible → caller checks first;
 *     this hook is invoked at lower priority
 */

import { useCallback, useRef } from 'react';
import { getSpaCocClient } from '../api/cocClient';

export interface UseChatPromptHistoryOptions {
    /** Workspace whose prompt history is browsed. Empty/undefined disables the hook. */
    workspaceId: string | undefined;
    /** Current input value. */
    value: string;
    /** Imperative setter that updates both React state and the contenteditable. */
    setValue: (next: string) => void;
    /** Cursor position from RichTextInput onChange. Used for edge-cursor gating. */
    cursorPos: number;
    /** Master enable. Pass false when the input is disabled. */
    enabled: boolean;
}

export interface ChatPromptHistoryHandle {
    /**
     * Returns true when the event was consumed (caller should `return`).
     * Returns false when the event should fall through (e.g. cursor is
     * mid-line, or the input is non-empty and there is no history yet).
     */
    handleKeyDown: (event: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean; preventDefault: () => void }) => boolean;
    /** Force-reset history mode (e.g. after sending a message). */
    reset: () => void;
}

interface CacheEntry {
    items: string[];
    expiresAt: number;
}

const CACHE_TTL_MS = 60_000;
const FETCH_LIMIT = 50;

// Module-level cache keyed by workspaceId. Lives across all input instances
// so navigating between repos / sub-tabs doesn't refetch.
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<string[]>>();

/** Reset the module cache. Test-only. */
export function __resetPromptHistoryCacheForTesting(): void {
    cache.clear();
    inflight.clear();
}

async function fetchItems(workspaceId: string): Promise<string[]> {
    const cached = cache.get(workspaceId);
    if (cached && cached.expiresAt > Date.now()) return cached.items;

    const existing = inflight.get(workspaceId);
    if (existing) return existing;

    const promise = (async () => {
        try {
            const res = await getSpaCocClient().promptHistory.list({
                workspaceId,
                limit: FETCH_LIMIT,
            });
            const items = Array.isArray(res?.items) ? res.items : [];
            cache.set(workspaceId, { items, expiresAt: Date.now() + CACHE_TTL_MS });
            return items;
        } catch {
            return [];
        } finally {
            inflight.delete(workspaceId);
        }
    })();
    inflight.set(workspaceId, promise);
    return promise;
}

export function useChatPromptHistory(opts: UseChatPromptHistoryOptions): ChatPromptHistoryHandle {
    // Mutable refs so the imperative key handler always sees the freshest values
    // without re-creating the closure on every keystroke.
    const valueRef = useRef(opts.value);
    valueRef.current = opts.value;
    const cursorPosRef = useRef(opts.cursorPos);
    cursorPosRef.current = opts.cursorPos;
    const setValueRef = useRef(opts.setValue);
    setValueRef.current = opts.setValue;
    const workspaceIdRef = useRef(opts.workspaceId);
    workspaceIdRef.current = opts.workspaceId;
    const enabledRef = useRef(opts.enabled);
    enabledRef.current = opts.enabled;

    // Items snapshot used for the current navigation session. Captured the
    // first time the user presses Up so subsequent Down/Up steps walk a
    // stable list even if the cache refreshes.
    const itemsRef = useRef<string[] | null>(null);
    // -1 = on the user's draft; 0 = items[0] (most recent); 1 = items[1]; ...
    const cursorRef = useRef<number>(-1);
    // Saved draft text the user had before navigating; restored when stepping
    // past the most recent entry with Down.
    const draftRef = useRef<string>('');
    // The text we ourselves last wrote into the input. Used to detect that
    // the user edited the input while in history mode (current value !=
    // last-written), in which case we exit history mode.
    const lastWrittenRef = useRef<string | null>(null);

    const reset = useCallback(() => {
        itemsRef.current = null;
        cursorRef.current = -1;
        draftRef.current = '';
        lastWrittenRef.current = null;
    }, []);

    const handleKeyDown = useCallback<ChatPromptHistoryHandle['handleKeyDown']>((e) => {
        if (!enabledRef.current) return false;
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return false;
        if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return false;

        const workspaceId = workspaceIdRef.current;
        if (!workspaceId) return false;

        const value = valueRef.current;
        const cursorPos = cursorPosRef.current;

        // If the user edited the input while we were navigating, exit history
        // mode. Their current text becomes the new draft.
        if (lastWrittenRef.current !== null && lastWrittenRef.current !== value) {
            reset();
        }

        // Edge-cursor gating: when the input is non-empty AND the user is in
        // their own draft (not navigating), only intercept arrows when the
        // caret is at the relevant edge. This preserves normal caret motion
        // for multi-line drafts.
        const inHistoryMode = itemsRef.current !== null && cursorRef.current >= 0;
        if (!inHistoryMode && value.length > 0) {
            if (e.key === 'ArrowUp' && cursorPos !== 0) return false;
            if (e.key === 'ArrowDown' && cursorPos !== value.length) return false;
        }

        // ArrowDown when not yet in history mode is always a no-op — never
        // trigger a fetch on Down, otherwise pressing Down on a draft would
        // swallow the key for no reason.
        if (e.key === 'ArrowDown' && (itemsRef.current === null || cursorRef.current < 0)) {
            return false;
        }

        // Lazy fetch on first interaction. We use a cached snapshot if present
        // so the first Up press feels instant on subsequent navigations.
        const cached = cache.get(workspaceId);
        if (cached && cached.expiresAt > Date.now()) {
            itemsRef.current = itemsRef.current ?? cached.items;
        } else {
            // Kick off the fetch; first press is best-effort. If we have no
            // items yet, swallow the key (so the caret doesn't jump) and let
            // the next press take effect when items arrive.
            if (!itemsRef.current) {
                draftRef.current = value;
                e.preventDefault();
                void fetchItems(workspaceId).then((items) => {
                    if (itemsRef.current === null) {
                        // Don't mutate state behind the user's back if they
                        // already typed something or the component re-rendered;
                        // just seed the snapshot for the next press.
                        itemsRef.current = items;
                    }
                });
                return true;
            }
        }

        const items = itemsRef.current ?? [];
        if (items.length === 0) {
            // No history at all — let the arrow key fall through.
            return false;
        }

        if (e.key === 'ArrowUp') {
            // Entering history for the first time? Save the current text as
            // the draft so Down can restore it later.
            if (cursorRef.current === -1) draftRef.current = value;
            const next = Math.min(cursorRef.current + 1, items.length - 1);
            if (next === cursorRef.current && cursorRef.current >= 0) {
                // Already at the oldest entry — no-op (bell).
                e.preventDefault();
                return true;
            }
            cursorRef.current = next;
            const text = items[next];
            lastWrittenRef.current = text;
            setValueRef.current(text);
            e.preventDefault();
            return true;
        }

        // ArrowDown
        if (cursorRef.current < 0) {
            // Already on draft, nothing to do.
            return false;
        }
        const next = cursorRef.current - 1;
        if (next < 0) {
            // Stepping past the most recent entry — restore the draft.
            cursorRef.current = -1;
            const text = draftRef.current;
            lastWrittenRef.current = text;
            setValueRef.current(text);
            e.preventDefault();
            return true;
        }
        cursorRef.current = next;
        const text = items[next];
        lastWrittenRef.current = text;
        setValueRef.current(text);
        e.preventDefault();
        return true;
    }, [reset]);

    return { handleKeyDown, reset };
}
