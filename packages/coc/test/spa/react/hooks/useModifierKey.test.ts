import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useModifierKey } from '../../../../src/server/spa/client/react/hooks/useModifierKey';

function fireKey(type: 'keydown' | 'keyup', key: string) {
    window.dispatchEvent(new KeyboardEvent(type, { key }));
}

describe('useModifierKey', () => {
    it('returns false initially', () => {
        const { result } = renderHook(() => useModifierKey());
        expect(result.current).toBe(false);
    });

    it('returns true after Control keydown', () => {
        const { result } = renderHook(() => useModifierKey());
        act(() => fireKey('keydown', 'Control'));
        expect(result.current).toBe(true);
    });

    it('returns true after Meta keydown', () => {
        const { result } = renderHook(() => useModifierKey());
        act(() => fireKey('keydown', 'Meta'));
        expect(result.current).toBe(true);
    });

    it('returns false after keyup following keydown', () => {
        const { result } = renderHook(() => useModifierKey());
        act(() => fireKey('keydown', 'Control'));
        expect(result.current).toBe(true);
        act(() => fireKey('keyup', 'Control'));
        expect(result.current).toBe(false);
    });

    it('returns false after window blur (prevents stuck key)', () => {
        const { result } = renderHook(() => useModifierKey());
        act(() => fireKey('keydown', 'Meta'));
        expect(result.current).toBe(true);
        act(() => { window.dispatchEvent(new Event('blur')); });
        expect(result.current).toBe(false);
    });

    it('ignores non-modifier keys', () => {
        const { result } = renderHook(() => useModifierKey());
        act(() => fireKey('keydown', 'Shift'));
        expect(result.current).toBe(false);
        act(() => fireKey('keydown', 'a'));
        expect(result.current).toBe(false);
    });

    it('cleans up event listeners on unmount', () => {
        const addSpy = vi.spyOn(window, 'addEventListener');
        const removeSpy = vi.spyOn(window, 'removeEventListener');

        const { unmount } = renderHook(() => useModifierKey());

        const addedEvents = addSpy.mock.calls.map(c => c[0]);
        expect(addedEvents).toContain('keydown');
        expect(addedEvents).toContain('keyup');
        expect(addedEvents).toContain('blur');

        unmount();

        const removedEvents = removeSpy.mock.calls.map(c => c[0]);
        expect(removedEvents).toContain('keydown');
        expect(removedEvents).toContain('keyup');
        expect(removedEvents).toContain('blur');

        addSpy.mockRestore();
        removeSpy.mockRestore();
    });
});
