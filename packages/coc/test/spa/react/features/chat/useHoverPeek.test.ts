/**
 * @vitest-environment jsdom
 *
 * Unit tests for useHoverPeek — the temporary float-peek state machine behind
 * the collapsed chat-list rail.
 *
 * Covers:
 *  - AC-01: hover-open delay + early-leave cancel
 *  - AC-03: leave-grace collapse + re-enter cancel
 *  - AC-04: Escape dismissal + click-outside dismissal
 *  - AC-05: imperative close (used by select-collapses-to-rail) never persists
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useHoverPeek } from '../../../../../src/server/spa/client/react/features/chat/hooks/useHoverPeek';

describe('useHoverPeek', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    // ── AC-01: hover-open delay + early-leave cancel ──────────────────────

    it('opens the peek after the configured open delay on rail hover', () => {
        const { result } = renderHook(() => useHoverPeek({ enabled: true, openDelay: 400 }));
        expect(result.current.isOpen).toBe(false);

        act(() => { result.current.onRailPointerEnter(); });
        // Not yet — timer pending.
        act(() => { vi.advanceTimersByTime(399); });
        expect(result.current.isOpen).toBe(false);

        act(() => { vi.advanceTimersByTime(1); });
        expect(result.current.isOpen).toBe(true);
    });

    it('cancels the open when the pointer leaves the rail before the delay elapses', () => {
        const { result } = renderHook(() => useHoverPeek({ enabled: true, openDelay: 400 }));

        act(() => { result.current.onRailPointerEnter(); });
        act(() => { vi.advanceTimersByTime(200); });
        act(() => { result.current.onRailPointerLeave(); });
        // The remainder of the original delay passes — must NOT open.
        act(() => { vi.advanceTimersByTime(400); });
        expect(result.current.isOpen).toBe(false);
    });

    it('does not open on hover when disabled (non-pointer/expanded)', () => {
        const { result } = renderHook(() => useHoverPeek({ enabled: false, openDelay: 400 }));

        act(() => { result.current.onRailPointerEnter(); });
        act(() => { vi.advanceTimersByTime(1000); });
        expect(result.current.isOpen).toBe(false);
    });

    it('uses the default 400ms open delay when none is provided', () => {
        const { result } = renderHook(() => useHoverPeek({ enabled: true }));

        act(() => { result.current.onRailPointerEnter(); });
        act(() => { vi.advanceTimersByTime(399); });
        expect(result.current.isOpen).toBe(false);
        act(() => { vi.advanceTimersByTime(1); });
        expect(result.current.isOpen).toBe(true);
    });

    // ── AC-03: leave-grace collapse + re-enter cancel ─────────────────────

    function openPeek(result: { current: ReturnType<typeof useHoverPeek> }) {
        act(() => { result.current.onRailPointerEnter(); });
        act(() => { vi.advanceTimersByTime(400); });
        expect(result.current.isOpen).toBe(true);
    }

    it('collapses after the grace delay when the pointer leaves the panel', () => {
        const { result } = renderHook(() => useHoverPeek({ enabled: true, openDelay: 400, closeDelay: 250 }));
        openPeek(result);

        act(() => { result.current.onPanelPointerLeave(); });
        act(() => { vi.advanceTimersByTime(249); });
        expect(result.current.isOpen).toBe(true);

        act(() => { vi.advanceTimersByTime(1); });
        expect(result.current.isOpen).toBe(false);
    });

    it('cancels the collapse when the pointer re-enters the panel within the grace window', () => {
        const { result } = renderHook(() => useHoverPeek({ enabled: true, openDelay: 400, closeDelay: 250 }));
        openPeek(result);

        act(() => { result.current.onPanelPointerLeave(); });
        act(() => { vi.advanceTimersByTime(100); });
        act(() => { result.current.onPanelPointerEnter(); });
        // Past the original grace window — must stay open.
        act(() => { vi.advanceTimersByTime(250); });
        expect(result.current.isOpen).toBe(true);
    });

    it('uses the default 250ms grace delay when none is provided', () => {
        const { result } = renderHook(() => useHoverPeek({ enabled: true }));
        openPeek(result);

        act(() => { result.current.onPanelPointerLeave(); });
        act(() => { vi.advanceTimersByTime(249); });
        expect(result.current.isOpen).toBe(true);
        act(() => { vi.advanceTimersByTime(1); });
        expect(result.current.isOpen).toBe(false);
    });

    // ── AC-04: Escape + outside-click dismissal ───────────────────────────

    it('collapses immediately on Escape keydown', () => {
        const { result } = renderHook(() => useHoverPeek({ enabled: true }));
        openPeek(result);

        act(() => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        });
        expect(result.current.isOpen).toBe(false);
    });

    it('does not collapse on a non-Escape keydown', () => {
        const { result } = renderHook(() => useHoverPeek({ enabled: true }));
        openPeek(result);

        act(() => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
        });
        expect(result.current.isOpen).toBe(true);
    });

    it('collapses on a mousedown outside the floating panel', () => {
        const panel = document.createElement('div');
        document.body.appendChild(panel);
        const panelRef = { current: panel };
        const { result } = renderHook(() => useHoverPeek({ enabled: true, panelRef }));
        openPeek(result);

        const outside = document.createElement('div');
        document.body.appendChild(outside);
        act(() => {
            outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        });
        expect(result.current.isOpen).toBe(false);

        panel.remove();
        outside.remove();
    });

    it('does NOT collapse on a mousedown inside the floating panel', () => {
        const panel = document.createElement('div');
        const inner = document.createElement('button');
        panel.appendChild(inner);
        document.body.appendChild(panel);
        const panelRef = { current: panel };
        const { result } = renderHook(() => useHoverPeek({ enabled: true, panelRef }));
        openPeek(result);

        act(() => {
            inner.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        });
        expect(result.current.isOpen).toBe(true);

        panel.remove();
    });

    it('does not register Escape/outside-click listeners while closed', () => {
        const { result } = renderHook(() => useHoverPeek({ enabled: true }));
        // Still closed — an Escape must be a no-op (and must not throw).
        act(() => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        });
        expect(result.current.isOpen).toBe(false);
    });

    // ── AC-05: imperative close (select-collapses-to-rail) ────────────────

    it('close() collapses the peek imperatively', () => {
        const { result } = renderHook(() => useHoverPeek({ enabled: true }));
        openPeek(result);

        act(() => { result.current.close(); });
        expect(result.current.isOpen).toBe(false);
    });

    it('close() does not touch localStorage (pure peek semantics)', () => {
        const setItem = vi.spyOn(Storage.prototype, 'setItem');
        const { result } = renderHook(() => useHoverPeek({ enabled: true }));
        openPeek(result);

        act(() => { result.current.close(); });
        expect(setItem).not.toHaveBeenCalledWith('activity-list-collapsed', expect.anything());
        setItem.mockRestore();
    });

    // ── Lifecycle ─────────────────────────────────────────────────────────

    it('force-closes and clears a pending open when disabled mid-flight', () => {
        const { result, rerender } = renderHook(
            ({ enabled }) => useHoverPeek({ enabled, openDelay: 400 }),
            { initialProps: { enabled: true } },
        );

        act(() => { result.current.onRailPointerEnter(); });
        // Disable before the open timer fires.
        rerender({ enabled: false });
        act(() => { vi.advanceTimersByTime(400); });
        expect(result.current.isOpen).toBe(false);
    });

    it('closes an already-open peek when it becomes disabled', () => {
        const { result, rerender } = renderHook(
            ({ enabled }) => useHoverPeek({ enabled, openDelay: 400 }),
            { initialProps: { enabled: true } },
        );
        openPeek(result);

        rerender({ enabled: false });
        expect(result.current.isOpen).toBe(false);
    });

    it('does not leak timers after unmount', () => {
        const { result, unmount } = renderHook(() => useHoverPeek({ enabled: true, openDelay: 400 }));
        act(() => { result.current.onRailPointerEnter(); });
        unmount();
        // Advancing past the delay after unmount must not throw / update state.
        expect(() => { act(() => { vi.advanceTimersByTime(400); }); }).not.toThrow();
    });
});
