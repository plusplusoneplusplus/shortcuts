/**
 * Tests for the shared hover-popover primitive extracted from the whisper
 * summary spans: grace-timer hide, re-enter cancel, Escape / outside-pointer
 * dismissal, content gating, and viewport clamping.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import React from 'react';
import {
    clampPopoverPosition,
    HoverSummarySpan,
    HOVER_GRACE_MS,
} from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/hoverPopover';

function renderSpan(hasContent = true) {
    return render(
        <HoverSummarySpan
            text="3 skills"
            testId="hover-span"
            hasContent={hasContent}
            renderPopover={(anchor) => (
                <div
                    data-testid="hover-popover"
                    ref={anchor.popoverRef}
                    onMouseEnter={anchor.onMouseEnter}
                    onMouseLeave={anchor.onMouseLeave}
                >
                    popover content
                </div>
            )}
        />,
    );
}

describe('clampPopoverPosition', () => {
    const originalWidth = window.innerWidth;
    const originalHeight = window.innerHeight;

    beforeEach(() => {
        Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
        Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true });
    });

    afterEach(() => {
        Object.defineProperty(window, 'innerWidth', { value: originalWidth, configurable: true });
        Object.defineProperty(window, 'innerHeight', { value: originalHeight, configurable: true });
    });

    it('positions below-left when it fits', () => {
        const rect = { left: 10, bottom: 20, top: 0 } as DOMRect;
        expect(clampPopoverPosition(rect, 100, 50)).toEqual({ top: 24, left: 10 });
    });

    it('clamps the right edge inside the viewport', () => {
        const rect = { left: 1000, bottom: 20, top: 0 } as DOMRect;
        const pos = clampPopoverPosition(rect, 200, 50);
        expect(pos.left).toBe(1024 - 200 - 8);
        expect(pos.top).toBe(24);
    });

    it('flips above when clipped at the bottom', () => {
        const rect = { left: 10, bottom: 750, top: 700 } as DOMRect;
        const pos = clampPopoverPosition(rect, 100, 100);
        expect(pos.top).toBe(700 - 100 - 4);
    });
});

describe('HoverSummarySpan', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('shows the popover on hover and hides after the grace period', () => {
        const { getByTestId, queryByTestId } = renderSpan();
        expect(queryByTestId('hover-popover')).toBeNull();

        act(() => { fireEvent.mouseEnter(getByTestId('hover-span')); });
        expect(queryByTestId('hover-popover')).toBeTruthy();

        act(() => { fireEvent.mouseLeave(getByTestId('hover-span')); });
        act(() => { vi.advanceTimersByTime(HOVER_GRACE_MS); });
        expect(queryByTestId('hover-popover')).toBeNull();
    });

    it('keeps the popover open when the pointer crosses into it', () => {
        const { getByTestId, queryByTestId } = renderSpan();
        act(() => { fireEvent.mouseEnter(getByTestId('hover-span')); });

        // Leave the anchor (starts grace), then enter the popover (cancels it).
        act(() => { fireEvent.mouseLeave(getByTestId('hover-span')); });
        act(() => { fireEvent.mouseEnter(getByTestId('hover-popover')); });
        act(() => { vi.advanceTimersByTime(HOVER_GRACE_MS + 50); });

        expect(queryByTestId('hover-popover')).toBeTruthy();
    });

    it('dismisses on Escape', () => {
        const { getByTestId, queryByTestId } = renderSpan();
        act(() => { fireEvent.mouseEnter(getByTestId('hover-span')); });
        expect(queryByTestId('hover-popover')).toBeTruthy();

        act(() => { fireEvent.keyDown(document, { key: 'Escape' }); });
        expect(queryByTestId('hover-popover')).toBeNull();
    });

    it('dismisses on an outside pointer press', () => {
        const { getByTestId, queryByTestId } = renderSpan();
        act(() => { fireEvent.mouseEnter(getByTestId('hover-span')); });
        expect(queryByTestId('hover-popover')).toBeTruthy();

        act(() => { fireEvent.mouseDown(document.body); });
        expect(queryByTestId('hover-popover')).toBeNull();
    });

    it('does not dismiss when pressing inside the popover', () => {
        const { getByTestId, queryByTestId } = renderSpan();
        act(() => { fireEvent.mouseEnter(getByTestId('hover-span')); });

        act(() => { fireEvent.mouseDown(getByTestId('hover-popover')); });
        expect(queryByTestId('hover-popover')).toBeTruthy();
    });

    it('never shows the popover when there is no content', () => {
        const { getByTestId, queryByTestId } = renderSpan(false);
        act(() => { fireEvent.mouseEnter(getByTestId('hover-span')); });
        expect(queryByTestId('hover-popover')).toBeNull();
    });
});
