import { act, renderHook } from '@testing-library/react';
import type { RefObject } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useScratchpadState } from '../../../../src/server/spa/client/react/features/chat/scratchpad/useScratchpadState';

function createContainerRef(): RefObject<HTMLElement> {
    return { current: document.createElement('div') };
}

describe('useScratchpadState', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('unregisters a stale active file and clears persisted linked path', () => {
        const { result } = renderHook(() => useScratchpadState(createContainerRef(), 'horizontal', 'task-1'));

        act(() => {
            result.current.open('Plans/deleted.plan.md');
            result.current.registerFiles(['Plans/remaining.plan.md']);
        });

        expect(result.current.linkedNotePath).toBe('Plans/deleted.plan.md');
        expect(localStorage.getItem('coc.scratchpad.linkedNotePath.task-1')).toBe('Plans/deleted.plan.md');

        act(() => {
            result.current.unregisterFile('plans/deleted.plan.md');
        });

        expect(result.current.linkedNotePath).toBeNull();
        expect(result.current.knownFiles).toEqual(['Plans/remaining.plan.md']);
        expect(localStorage.getItem('coc.scratchpad.linkedNotePath.task-1')).toBeNull();
    });

    it('keeps the active linked path when unregistering a different file', () => {
        const { result } = renderHook(() => useScratchpadState(createContainerRef(), 'horizontal', 'task-1'));

        act(() => {
            result.current.open('Plans/current.plan.md');
            result.current.registerFiles(['Plans/deleted.plan.md']);
        });

        act(() => {
            result.current.unregisterFile('Plans/deleted.plan.md');
        });

        expect(result.current.linkedNotePath).toBe('Plans/current.plan.md');
        expect(result.current.knownFiles).toEqual(['Plans/current.plan.md']);
        expect(localStorage.getItem('coc.scratchpad.linkedNotePath.task-1')).toBe('Plans/current.plan.md');
    });
});
