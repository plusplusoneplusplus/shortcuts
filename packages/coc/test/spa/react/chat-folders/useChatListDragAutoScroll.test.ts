/**
 * useChatListDragAutoScroll — edge auto-scroll during a drag (AC-07).
 *
 * The teardown assertions are the point of this suite: a scroll interval that
 * outlives `dragend` or the component surfaces as a Vitest "Unhandled Errors"
 * section even when every test passes.
 *
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useChatListDragAutoScroll } from '../../../../src/server/spa/client/react/features/chat/hooks/useChatListDragAutoScroll';
import { CHAT_LIST_AUTO_SCROLL_INTERVAL_MS } from '../../../../src/server/spa/client/react/features/chat/chat-folder-drag';

/** A scroll container with a real box, since jsdom reports zeros otherwise. */
function makeContainer(): HTMLDivElement {
    const element = document.createElement('div');
    element.getBoundingClientRect = () => ({
        top: 0, bottom: 400, left: 0, right: 300, width: 300, height: 400, x: 0, y: 0,
        toJSON: () => ({}),
    }) as DOMRect;
    document.body.appendChild(element);
    return element;
}

function dispatchDragOver(element: HTMLElement, clientY: number): void {
    const event = new Event('dragover', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clientY', { value: clientY });
    act(() => { element.dispatchEvent(event); });
}

describe('useChatListDragAutoScroll (AC-07)', () => {
    let container: HTMLDivElement;

    beforeEach(() => {
        vi.useFakeTimers();
        container = makeContainer();
    });

    afterEach(() => {
        cleanup();
        vi.clearAllTimers();
        vi.useRealTimers();
        container.remove();
    });

    function renderAutoScroll(enabled = true) {
        const ref = { current: container } as React.RefObject<HTMLElement>;
        return renderHook(() => useChatListDragAutoScroll(ref, enabled));
    }

    it('scrolls the list while the pointer sits near the bottom edge', () => {
        renderAutoScroll();
        dispatchDragOver(container, 398);
        act(() => { vi.advanceTimersByTime(CHAT_LIST_AUTO_SCROLL_INTERVAL_MS * 5); });
        expect(container.scrollTop).toBeGreaterThan(0);
    });

    it('does nothing in the middle of the list', () => {
        renderAutoScroll();
        dispatchDragOver(container, 200);
        act(() => { vi.advanceTimersByTime(CHAT_LIST_AUTO_SCROLL_INTERVAL_MS * 10); });
        expect(container.scrollTop).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('installs nothing at all when chat folders are disabled', () => {
        renderAutoScroll(false);
        dispatchDragOver(container, 398);
        act(() => { vi.advanceTimersByTime(CHAT_LIST_AUTO_SCROLL_INTERVAL_MS * 5); });
        expect(container.scrollTop).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('clears the timer on dragend, including an Esc-cancelled drag', () => {
        renderAutoScroll();
        dispatchDragOver(container, 398);
        expect(vi.getTimerCount()).toBe(1);

        // A drag cancelled with Esc fires `dragend` on the SOURCE, which may be
        // outside this container — hence the document-level listener.
        act(() => { document.dispatchEvent(new Event('dragend', { bubbles: true })); });
        expect(vi.getTimerCount()).toBe(0);

        const settled = container.scrollTop;
        act(() => { vi.advanceTimersByTime(CHAT_LIST_AUTO_SCROLL_INTERVAL_MS * 20); });
        expect(container.scrollTop).toBe(settled);
    });

    it('clears the timer on drop', () => {
        renderAutoScroll();
        dispatchDragOver(container, 398);
        expect(vi.getTimerCount()).toBe(1);
        act(() => { container.dispatchEvent(new Event('drop', { bubbles: true })); });
        expect(vi.getTimerCount()).toBe(0);
    });

    it('stops when the pointer leaves the edge band without ending the drag', () => {
        renderAutoScroll();
        dispatchDragOver(container, 398);
        expect(vi.getTimerCount()).toBe(1);
        dispatchDragOver(container, 200);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('leaves no timer or listener behind on unmount', () => {
        const { unmount } = renderAutoScroll();
        dispatchDragOver(container, 2);
        expect(vi.getTimerCount()).toBe(1);

        unmount();
        expect(vi.getTimerCount()).toBe(0);

        // The listener is gone too: a post-unmount drag must not restart it.
        dispatchDragOver(container, 2);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('exposes an idempotent manual stop', () => {
        const { result } = renderAutoScroll();
        dispatchDragOver(container, 398);
        act(() => { result.current.stop(); result.current.stop(); });
        expect(vi.getTimerCount()).toBe(0);
    });
});
