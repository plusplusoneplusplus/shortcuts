/**
 * useMessageNavigation tests — vim-style j/k navigation between conversation
 * turns. Verifies key handling, edge cases (no wrap), `gg` / `G` jumps, IME and
 * modifier suppression, no-op while typing in input, and Esc/i mode toggling.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useRef } from 'react';
import { render, fireEvent, act } from '@testing-library/react';
import { useMessageNavigation } from '../../../../../src/server/spa/client/react/features/chat/hooks/useMessageNavigation';

interface HarnessProps {
    turnIndices: number[];
    /** Render an editable textarea inside the container so we can test focus rules. */
    withInput?: boolean;
    /** Render a sibling pinned section that contains duplicated turn bubbles. */
    withPinned?: boolean;
}

function Harness({ turnIndices, withInput, withPinned }: HarnessProps) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const inputFocus = vi.fn();
    const inputRef = useRef<{ focus: () => void } | null>({ focus: inputFocus });
    (window as any).__inputFocus = inputFocus;

    const { currentTurnIndex, navHintVisible } = useMessageNavigation({
        scrollRef,
        containerRef,
        inputRef,
    });
    (window as any).__currentTurnIndex = currentTurnIndex;
    (window as any).__navHintVisible = navHintVisible;

    return (
        <div ref={containerRef} tabIndex={-1} data-testid="container">
            <div ref={scrollRef} data-testid="scroll">
                {withPinned && (
                    <div data-pinned-section>
                        {turnIndices.map(i => (
                            <div key={`pin-${i}`} data-turn-index={i} data-testid={`pinned-turn-${i}`} />
                        ))}
                    </div>
                )}
                {turnIndices.map(i => (
                    <div key={i} data-turn-index={i} data-testid={`turn-${i}`} />
                ))}
            </div>
            {withInput && (
                <textarea data-testid="input" defaultValue="" />
            )}
            <div data-testid="cursor">{currentTurnIndex == null ? 'none' : String(currentTurnIndex)}</div>
        </div>
    );
}

beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
});

function getCursor(container: HTMLElement): string {
    return container.querySelector('[data-testid="cursor"]')!.textContent ?? '';
}

describe('useMessageNavigation', () => {
    it('does nothing when there are no turns', () => {
        const { container } = render(<Harness turnIndices={[]} />);
        const root = container.querySelector('[data-testid="container"]') as HTMLElement;
        root.focus();
        fireEvent.keyDown(root, { key: 'j' });
        expect(getCursor(container)).toBe('none');
    });

    it('j moves to the first turn from null cursor and stops at the last', () => {
        const { container } = render(<Harness turnIndices={[0, 1, 2]} />);
        const root = container.querySelector('[data-testid="container"]') as HTMLElement;
        root.focus();
        fireEvent.keyDown(root, { key: 'j' });
        expect(getCursor(container)).toBe('0');
        fireEvent.keyDown(root, { key: 'j' });
        expect(getCursor(container)).toBe('1');
        fireEvent.keyDown(root, { key: 'j' });
        expect(getCursor(container)).toBe('2');
        // No wrap — stays at last.
        fireEvent.keyDown(root, { key: 'j' });
        expect(getCursor(container)).toBe('2');
    });

    it('k moves to the last turn from null cursor and stops at the first', () => {
        const { container } = render(<Harness turnIndices={[0, 1, 2]} />);
        const root = container.querySelector('[data-testid="container"]') as HTMLElement;
        root.focus();
        fireEvent.keyDown(root, { key: 'k' });
        expect(getCursor(container)).toBe('2');
        fireEvent.keyDown(root, { key: 'k' });
        expect(getCursor(container)).toBe('1');
        fireEvent.keyDown(root, { key: 'k' });
        expect(getCursor(container)).toBe('0');
        fireEvent.keyDown(root, { key: 'k' });
        expect(getCursor(container)).toBe('0');
    });

    it('Shift+G jumps to last; gg jumps to first', () => {
        const { container } = render(<Harness turnIndices={[0, 1, 2, 3, 4]} />);
        const root = container.querySelector('[data-testid="container"]') as HTMLElement;
        root.focus();
        fireEvent.keyDown(root, { key: 'G', shiftKey: true });
        expect(getCursor(container)).toBe('4');
        fireEvent.keyDown(root, { key: 'g' });
        fireEvent.keyDown(root, { key: 'g' });
        expect(getCursor(container)).toBe('0');
    });

    it('single g without follow-up does not move cursor', () => {
        const { container } = render(<Harness turnIndices={[0, 1, 2]} />);
        const root = container.querySelector('[data-testid="container"]') as HTMLElement;
        root.focus();
        fireEvent.keyDown(root, { key: 'g' });
        expect(getCursor(container)).toBe('none');
    });

    it('does not act on j/k while focus is in an editable input', () => {
        const { container } = render(<Harness turnIndices={[0, 1, 2]} withInput />);
        const input = container.querySelector('[data-testid="input"]') as HTMLTextAreaElement;
        input.focus();
        fireEvent.keyDown(input, { key: 'j' });
        expect(getCursor(container)).toBe('none');
    });

    it('Esc blurs editable input, focuses container and seeds cursor at last turn', () => {
        const { container } = render(<Harness turnIndices={[0, 1, 2]} withInput />);
        const input = container.querySelector('[data-testid="input"]') as HTMLTextAreaElement;
        input.focus();
        expect(document.activeElement).toBe(input);
        fireEvent.keyDown(input, { key: 'Escape' });
        expect(document.activeElement).not.toBe(input);
        expect(getCursor(container)).toBe('2');
    });

    it('i focuses the chat input when not typing', () => {
        const { container } = render(<Harness turnIndices={[0, 1, 2]} withInput />);
        const root = container.querySelector('[data-testid="container"]') as HTMLElement;
        root.focus();
        fireEvent.keyDown(root, { key: 'i' });
        expect((window as any).__inputFocus).toHaveBeenCalledTimes(1);
    });

    it('ignores keydown during IME composition', () => {
        const { container } = render(<Harness turnIndices={[0, 1, 2]} />);
        const root = container.querySelector('[data-testid="container"]') as HTMLElement;
        root.focus();
        fireEvent.keyDown(root, { key: 'j', isComposing: true });
        expect(getCursor(container)).toBe('none');
    });

    it('ignores j with disqualifying modifier keys', () => {
        const { container } = render(<Harness turnIndices={[0, 1, 2]} />);
        const root = container.querySelector('[data-testid="container"]') as HTMLElement;
        root.focus();
        fireEvent.keyDown(root, { key: 'j', ctrlKey: true });
        expect(getCursor(container)).toBe('none');
        fireEvent.keyDown(root, { key: 'j', metaKey: true });
        expect(getCursor(container)).toBe('none');
        fireEvent.keyDown(root, { key: 'j', altKey: true });
        expect(getCursor(container)).toBe('none');
    });

    it('skips bubbles inside a [data-pinned-section] when navigating', () => {
        const { container } = render(<Harness turnIndices={[0, 1]} withPinned />);
        const root = container.querySelector('[data-testid="container"]') as HTMLElement;
        root.focus();
        fireEvent.keyDown(root, { key: 'j' });
        expect(getCursor(container)).toBe('0');
        fireEvent.keyDown(root, { key: 'j' });
        expect(getCursor(container)).toBe('1');
        fireEvent.keyDown(root, { key: 'j' });
        // No wrap, no double-counting from the pinned section copies.
        expect(getCursor(container)).toBe('1');
    });

    it('keydown outside the chat container is ignored', () => {
        const { container } = render(<Harness turnIndices={[0, 1, 2]} />);
        // Dispatch on document.body — outside our container.
        fireEvent.keyDown(document.body, { key: 'j' });
        expect(getCursor(container)).toBe('none');
    });

    it('shows a nav-mode hint after movement and hides it after the timeout', () => {
        vi.useFakeTimers();
        try {
            const { container } = render(<Harness turnIndices={[0, 1]} />);
            const root = container.querySelector('[data-testid="container"]') as HTMLElement;
            root.focus();
            fireEvent.keyDown(root, { key: 'j' });
            expect((window as any).__navHintVisible).toBe(true);
            act(() => {
                vi.advanceTimersByTime(2600);
            });
            expect((window as any).__navHintVisible).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });
});
