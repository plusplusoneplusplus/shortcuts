/**
 * @vitest-environment jsdom
 *
 * Tests for activeMobileTab state in useScratchpadState.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useScratchpadState } from '../../../../src/server/spa/client/react/features/chat/scratchpad/useScratchpadState';

describe('useScratchpadState — activeMobileTab', () => {
    beforeEach(() => { localStorage.clear(); });
    afterEach(() => { localStorage.clear(); });

    it('defaults activeMobileTab to "chat"', () => {
        const ref = { current: null } as React.RefObject<HTMLElement>;
        const { result } = renderHook(() => useScratchpadState(ref, 'horizontal', 'task-1'));
        expect(result.current.activeMobileTab).toBe('chat');
    });

    it('setActiveMobileTab updates the tab', () => {
        const ref = { current: null } as React.RefObject<HTMLElement>;
        const { result } = renderHook(() => useScratchpadState(ref, 'horizontal', 'task-1'));
        act(() => { result.current.setActiveMobileTab('scratchpad'); });
        expect(result.current.activeMobileTab).toBe('scratchpad');
    });

    it('setActiveMobileTab can switch back to "chat"', () => {
        const ref = { current: null } as React.RefObject<HTMLElement>;
        const { result } = renderHook(() => useScratchpadState(ref, 'horizontal', 'task-1'));
        act(() => { result.current.setActiveMobileTab('scratchpad'); });
        act(() => { result.current.setActiveMobileTab('chat'); });
        expect(result.current.activeMobileTab).toBe('chat');
    });

    it('close() resets activeMobileTab to "chat"', () => {
        const ref = { current: null } as React.RefObject<HTMLElement>;
        const { result } = renderHook(() => useScratchpadState(ref, 'horizontal', 'task-2'));
        act(() => { result.current.open(); });
        act(() => { result.current.setActiveMobileTab('scratchpad'); });
        expect(result.current.activeMobileTab).toBe('scratchpad');
        act(() => { result.current.close(); });
        expect(result.current.activeMobileTab).toBe('chat');
    });

    it('close() resets activeMobileTab even when taskId is null', () => {
        const ref = { current: null } as React.RefObject<HTMLElement>;
        const { result } = renderHook(() => useScratchpadState(ref, 'horizontal', null));
        act(() => { result.current.open(); });
        act(() => { result.current.setActiveMobileTab('scratchpad'); });
        act(() => { result.current.close(); });
        expect(result.current.activeMobileTab).toBe('chat');
    });
});
