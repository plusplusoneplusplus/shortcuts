import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useModifierKey } from '../../../../src/server/spa/client/react/hooks/ui/useModifierKey';
import { createRef } from 'react';

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

    describe('with targetRef (focus-gating)', () => {
        function setupWithTarget() {
            const el = document.createElement('textarea');
            document.body.appendChild(el);
            const ref = createRef<HTMLElement>() as { current: HTMLElement | null };
            ref.current = el;
            return { el, ref };
        }

        function cleanupTarget(el: HTMLElement) {
            el.blur();
            document.body.removeChild(el);
        }

        it('sets held=true when targetRef element is focused', () => {
            const { el, ref } = setupWithTarget();
            el.focus();
            const { result } = renderHook(() => useModifierKey(ref));
            act(() => fireKey('keydown', 'Control'));
            expect(result.current).toBe(true);
            cleanupTarget(el);
        });

        it('stays false when targetRef element is NOT focused', () => {
            const { el, ref } = setupWithTarget();
            el.blur();
            const { result } = renderHook(() => useModifierKey(ref));
            act(() => fireKey('keydown', 'Control'));
            expect(result.current).toBe(false);
            cleanupTarget(el);
        });

        it('sets held=true when a child of targetRef is focused', () => {
            const wrapper = document.createElement('div');
            const child = document.createElement('textarea');
            wrapper.appendChild(child);
            document.body.appendChild(wrapper);
            const ref = createRef<HTMLElement>() as { current: HTMLElement | null };
            ref.current = wrapper;
            child.focus();
            const { result } = renderHook(() => useModifierKey(ref));
            act(() => fireKey('keydown', 'Meta'));
            expect(result.current).toBe(true);
            child.blur();
            document.body.removeChild(wrapper);
        });

        it('resets on keyup regardless of focus', () => {
            const { el, ref } = setupWithTarget();
            el.focus();
            const { result } = renderHook(() => useModifierKey(ref));
            act(() => fireKey('keydown', 'Control'));
            expect(result.current).toBe(true);
            el.blur();
            act(() => fireKey('keyup', 'Control'));
            expect(result.current).toBe(false);
            cleanupTarget(el);
        });

        it('resets on window blur regardless of focus', () => {
            const { el, ref } = setupWithTarget();
            el.focus();
            const { result } = renderHook(() => useModifierKey(ref));
            act(() => fireKey('keydown', 'Control'));
            expect(result.current).toBe(true);
            act(() => { window.dispatchEvent(new Event('blur')); });
            expect(result.current).toBe(false);
            cleanupTarget(el);
        });
    });
});
