/**
 * Tests for DiffFindWidget — the controlled find-overlay view.
 *
 * These cover the widget's own contract (independent of the search model):
 * auto-focus on mount, the "N of M" / "No results" / blank counter states,
 * the case-sensitivity toggle, and the widget-local keys (Enter → next,
 * Shift+Enter → prev, Esc → close).
 */
/* @vitest-environment jsdom */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

import { DiffFindWidget } from '../../../src/server/spa/client/react/features/git/diff/DiffFindWidget';

afterEach(() => cleanup());

function setup(overrides: Partial<React.ComponentProps<typeof DiffFindWidget>> = {}) {
    const props = {
        query: 'foo',
        caseSensitive: false,
        matchCount: 3,
        activeIndex: 0,
        onQueryChange: vi.fn(),
        onToggleCaseSensitive: vi.fn(),
        onNext: vi.fn(),
        onPrev: vi.fn(),
        onClose: vi.fn(),
        ...overrides,
    };
    render(<DiffFindWidget {...props} />);
    return props;
}

describe('DiffFindWidget', () => {
    it('auto-focuses the input on mount', () => {
        setup();
        const input = screen.getByTestId('diff-find-input');
        expect(document.activeElement).toBe(input);
    });

    it('shows "N of M" with a 1-based active index', () => {
        setup({ query: 'foo', matchCount: 3, activeIndex: 1 });
        expect(screen.getByTestId('diff-find-count').textContent).toBe('2 of 3');
    });

    it('shows "No results" for a non-empty query with no matches', () => {
        setup({ query: 'zzz', matchCount: 0, activeIndex: -1 });
        expect(screen.getByTestId('diff-find-count').textContent).toBe('No results');
    });

    it('shows an empty counter when the query is blank', () => {
        setup({ query: '', matchCount: 0, activeIndex: -1 });
        expect(screen.getByTestId('diff-find-count').textContent).toBe('');
    });

    it('calls onQueryChange as the user types', () => {
        const props = setup({ query: '' });
        fireEvent.change(screen.getByTestId('diff-find-input'), { target: { value: 'bar' } });
        expect(props.onQueryChange).toHaveBeenCalledWith('bar');
    });

    it('Enter advances to the next match, Shift+Enter to the previous', () => {
        const props = setup();
        const input = screen.getByTestId('diff-find-input');
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(props.onNext).toHaveBeenCalledTimes(1);
        expect(props.onPrev).not.toHaveBeenCalled();

        fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
        expect(props.onPrev).toHaveBeenCalledTimes(1);
        expect(props.onNext).toHaveBeenCalledTimes(1);
    });

    it('Escape closes the widget', () => {
        const props = setup();
        fireEvent.keyDown(screen.getByTestId('diff-find-input'), { key: 'Escape' });
        expect(props.onClose).toHaveBeenCalledTimes(1);
    });

    it('the case toggle reflects state and fires the callback', () => {
        const props = setup({ caseSensitive: true });
        const toggle = screen.getByTestId('diff-find-case-toggle');
        expect(toggle.getAttribute('aria-pressed')).toBe('true');
        fireEvent.click(toggle);
        expect(props.onToggleCaseSensitive).toHaveBeenCalledTimes(1);
    });

    it('the next/prev buttons drive navigation and disable with no matches', () => {
        const props = setup({ matchCount: 0, activeIndex: -1 });
        const next = screen.getByTestId('diff-find-next') as HTMLButtonElement;
        const prev = screen.getByTestId('diff-find-prev') as HTMLButtonElement;
        expect(next.disabled).toBe(true);
        expect(prev.disabled).toBe(true);

        cleanup();
        const props2 = setup({ matchCount: 2, activeIndex: 0 });
        fireEvent.click(screen.getByTestId('diff-find-next'));
        expect(props2.onNext).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByTestId('diff-find-prev'));
        expect(props2.onPrev).toHaveBeenCalledTimes(1);
    });

    it('the close button fires onClose', () => {
        const props = setup();
        fireEvent.click(screen.getByTestId('diff-find-close'));
        expect(props.onClose).toHaveBeenCalledTimes(1);
    });
});
