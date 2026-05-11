/* @vitest-environment jsdom */
/**
 * Tests for useChatPromptHistory — bash-style up/down arrow navigation
 * through the user's recent initial prompts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
    useChatPromptHistory,
    __resetPromptHistoryCacheForTesting,
} from '../../../../src/server/spa/client/react/hooks/useChatPromptHistory';

const list = vi.fn();

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        promptHistory: {
            list: (...args: any[]) => list(...args),
        },
    }),
}));

interface KeyEvent {
    key: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
    shiftKey?: boolean;
    preventDefault: ReturnType<typeof vi.fn>;
}

function ev(key: string, mods?: Partial<KeyEvent>): KeyEvent {
    return {
        key,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        preventDefault: vi.fn(),
        ...mods,
    };
}

interface HookState {
    value: string;
    cursorPos: number;
    setValue: ReturnType<typeof vi.fn>;
    enabled: boolean;
    workspaceId: string | undefined;
}

function makeState(overrides?: Partial<HookState>): HookState {
    return {
        value: '',
        cursorPos: 0,
        setValue: vi.fn(),
        enabled: true,
        workspaceId: 'ws-1',
        ...overrides,
    };
}

beforeEach(() => {
    list.mockReset();
    __resetPromptHistoryCacheForTesting();
});

afterEach(() => {
    vi.clearAllMocks();
});

describe('useChatPromptHistory', () => {
    it('does nothing when disabled', async () => {
        list.mockResolvedValue({ items: ['a', 'b'] });
        const state = makeState({ enabled: false });
        const { result } = renderHook(() => useChatPromptHistory(state));
        const e = ev('ArrowUp');
        const handled = result.current.handleKeyDown(e);
        expect(handled).toBe(false);
        expect(state.setValue).not.toHaveBeenCalled();
        expect(list).not.toHaveBeenCalled();
    });

    it('does nothing when workspaceId is missing', async () => {
        list.mockResolvedValue({ items: ['a', 'b'] });
        const state = makeState({ workspaceId: undefined });
        const { result } = renderHook(() => useChatPromptHistory(state));
        expect(result.current.handleKeyDown(ev('ArrowUp'))).toBe(false);
        expect(list).not.toHaveBeenCalled();
    });

    it('ignores non-arrow keys', () => {
        const state = makeState();
        const { result } = renderHook(() => useChatPromptHistory(state));
        expect(result.current.handleKeyDown(ev('a'))).toBe(false);
        expect(result.current.handleKeyDown(ev('Enter'))).toBe(false);
        expect(result.current.handleKeyDown(ev('Tab'))).toBe(false);
    });

    it('ignores arrows with modifier keys', () => {
        const state = makeState();
        const { result } = renderHook(() => useChatPromptHistory(state));
        expect(result.current.handleKeyDown(ev('ArrowUp', { ctrlKey: true }))).toBe(false);
        expect(result.current.handleKeyDown(ev('ArrowUp', { metaKey: true }))).toBe(false);
        expect(result.current.handleKeyDown(ev('ArrowUp', { altKey: true }))).toBe(false);
        expect(result.current.handleKeyDown(ev('ArrowUp', { shiftKey: true }))).toBe(false);
    });

    it('first ArrowUp on empty input fetches lazily and seeds the snapshot', async () => {
        list.mockResolvedValue({ items: ['most recent', 'older', 'oldest'] });
        const state = makeState({ value: '', cursorPos: 0 });
        const { result } = renderHook(() => useChatPromptHistory(state));

        const e = ev('ArrowUp');
        const handled = result.current.handleKeyDown(e);

        // First press swallows the key (so the caret doesn't jump) but doesn't
        // yet have items — they arrive on the next microtask.
        expect(handled).toBe(true);
        expect(e.preventDefault).toHaveBeenCalled();
        expect(list).toHaveBeenCalledWith({ workspaceId: 'ws-1', limit: 50 });

        // Wait for the in-flight fetch to settle.
        await act(async () => {});
    });

    it('walks backward through history with successive ArrowUp presses', async () => {
        list.mockResolvedValue({ items: ['most recent', 'older', 'oldest'] });
        const state = makeState({ value: '', cursorPos: 0 });
        const { result, rerender } = renderHook(() => useChatPromptHistory(state));

        // First press primes the cache.
        result.current.handleKeyDown(ev('ArrowUp'));
        await act(async () => {});

        // Subsequent press walks backward (most recent first).
        const e1 = ev('ArrowUp');
        result.current.handleKeyDown(e1);
        expect(state.setValue).toHaveBeenLastCalledWith('most recent');
        expect(e1.preventDefault).toHaveBeenCalled();

        // Simulate the parent updating value after our setValue.
        state.value = 'most recent';
        state.cursorPos = 'most recent'.length;
        rerender();

        result.current.handleKeyDown(ev('ArrowUp'));
        expect(state.setValue).toHaveBeenLastCalledWith('older');

        state.value = 'older';
        state.cursorPos = 'older'.length;
        rerender();

        result.current.handleKeyDown(ev('ArrowUp'));
        expect(state.setValue).toHaveBeenLastCalledWith('oldest');
    });

    it('clamps at the oldest entry on extra ArrowUp', async () => {
        list.mockResolvedValue({ items: ['recent', 'old'] });
        const state = makeState({ value: '', cursorPos: 0 });
        const { result, rerender } = renderHook(() => useChatPromptHistory(state));

        result.current.handleKeyDown(ev('ArrowUp'));
        await act(async () => {});

        result.current.handleKeyDown(ev('ArrowUp')); // recent
        state.value = 'recent';
        state.cursorPos = 'recent'.length;
        rerender();

        result.current.handleKeyDown(ev('ArrowUp')); // old
        state.value = 'old';
        state.cursorPos = 'old'.length;
        rerender();

        const callsBefore = state.setValue.mock.calls.length;
        const e = ev('ArrowUp');
        result.current.handleKeyDown(e);
        expect(state.setValue.mock.calls.length).toBe(callsBefore); // no new write
        expect(e.preventDefault).toHaveBeenCalled();
    });

    it('ArrowDown walks forward toward the draft and restores it', async () => {
        list.mockResolvedValue({ items: ['recent', 'old'] });
        const state = makeState({ value: 'my draft', cursorPos: 'my draft'.length });
        const { result, rerender } = renderHook(() => useChatPromptHistory(state));

        // First Up: draft is non-empty so cursor must be at start. It is at end,
        // so this press should be ignored and fall through.
        const eFail = ev('ArrowUp');
        expect(result.current.handleKeyDown(eFail)).toBe(false);

        // Move caret to start and try again.
        state.cursorPos = 0;
        rerender();
        result.current.handleKeyDown(ev('ArrowUp'));
        await act(async () => {});

        // Now in history mode: walk backward.
        result.current.handleKeyDown(ev('ArrowUp'));
        expect(state.setValue).toHaveBeenLastCalledWith('recent');
        state.value = 'recent';
        state.cursorPos = 'recent'.length;
        rerender();

        result.current.handleKeyDown(ev('ArrowUp'));
        expect(state.setValue).toHaveBeenLastCalledWith('old');
        state.value = 'old';
        state.cursorPos = 'old'.length;
        rerender();

        // Now walk forward.
        result.current.handleKeyDown(ev('ArrowDown'));
        expect(state.setValue).toHaveBeenLastCalledWith('recent');
        state.value = 'recent';
        state.cursorPos = 'recent'.length;
        rerender();

        // Step past the most recent entry → restore the original draft.
        result.current.handleKeyDown(ev('ArrowDown'));
        expect(state.setValue).toHaveBeenLastCalledWith('my draft');
    });

    it('exiting history mode: editing the input clears in-history state', async () => {
        list.mockResolvedValue({ items: ['recent prompt'] });
        const state = makeState({ value: '', cursorPos: 0 });
        const { result, rerender } = renderHook(() => useChatPromptHistory(state));

        result.current.handleKeyDown(ev('ArrowUp'));
        await act(async () => {});
        result.current.handleKeyDown(ev('ArrowUp'));
        expect(state.setValue).toHaveBeenLastCalledWith('recent prompt');
        state.value = 'recent prompt';
        state.cursorPos = 'recent prompt'.length;
        rerender();

        // User edits the value mid-history.
        state.value = 'recent prompt edited';
        state.cursorPos = state.value.length;
        rerender();

        // Next Up must not jump to history items[1]; instead, treat the edited
        // text as the new draft. Since cursor is at end of non-empty input and
        // we are no longer in history mode, the gate kicks in and the press
        // falls through.
        const e = ev('ArrowUp');
        const handled = result.current.handleKeyDown(e);
        expect(handled).toBe(false);
    });

    it('ArrowDown when not in history mode falls through', () => {
        const state = makeState({ value: '', cursorPos: 0 });
        const { result } = renderHook(() => useChatPromptHistory(state));
        const e = ev('ArrowDown');
        expect(result.current.handleKeyDown(e)).toBe(false);
        expect(state.setValue).not.toHaveBeenCalled();
    });

    it('falls through when fetched history is empty (lets caret move normally)', async () => {
        list.mockResolvedValue({ items: [] });
        const state = makeState({ value: '', cursorPos: 0 });
        const { result } = renderHook(() => useChatPromptHistory(state));

        // First press primes; resolves to empty.
        result.current.handleKeyDown(ev('ArrowUp'));
        await act(async () => {});

        // Second press should fall through (no items to show).
        const e = ev('ArrowUp');
        const handled = result.current.handleKeyDown(e);
        expect(handled).toBe(false);
        expect(state.setValue).not.toHaveBeenCalled();
    });

    it('reset() clears in-history state so the next Up restarts from current draft', async () => {
        list.mockResolvedValue({ items: ['a', 'b'] });
        const state = makeState({ value: '', cursorPos: 0 });
        const { result, rerender } = renderHook(() => useChatPromptHistory(state));

        result.current.handleKeyDown(ev('ArrowUp'));
        await act(async () => {});
        result.current.handleKeyDown(ev('ArrowUp')); // → 'a'
        state.value = 'a';
        state.cursorPos = 1;
        rerender();

        act(() => result.current.reset());

        // After reset, parent typically clears the input (e.g. after send).
        state.value = 'fresh draft';
        state.cursorPos = state.value.length;
        rerender();

        // Cursor is at end of non-empty input → arrow falls through, as expected.
        expect(result.current.handleKeyDown(ev('ArrowUp'))).toBe(false);

        // Move caret to start, and a fresh Up should start a new history walk.
        state.cursorPos = 0;
        rerender();
        result.current.handleKeyDown(ev('ArrowUp'));
        expect(state.setValue).toHaveBeenLastCalledWith('a');
    });
});
