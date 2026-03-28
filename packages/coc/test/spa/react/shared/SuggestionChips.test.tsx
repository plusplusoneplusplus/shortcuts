/**
 * Tests for SuggestionChips shared component.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SuggestionChips } from '../../../../src/server/spa/client/react/shared/SuggestionChips';

describe('SuggestionChips', () => {
    it('renders nothing when suggestions is empty', () => {
        const { container } = render(
            <SuggestionChips suggestions={[]} onSelect={vi.fn()} />
        );
        expect(container.innerHTML).toBe('');
    });

    it('renders a chip for each suggestion', () => {
        render(
            <SuggestionChips
                suggestions={['Option A', 'Option B', 'Option C']}
                onSelect={vi.fn()}
            />
        );
        expect(screen.getAllByTestId('suggestion-chip')).toHaveLength(3);
        expect(screen.getByText('Option A')).toBeTruthy();
        expect(screen.getByText('Option B')).toBeTruthy();
        expect(screen.getByText('Option C')).toBeTruthy();
    });

    it('calls onSelect with the chip text and event when clicked', () => {
        const onSelect = vi.fn();
        render(
            <SuggestionChips suggestions={['Pick me']} onSelect={onSelect} />
        );
        fireEvent.click(screen.getByTestId('suggestion-chip'));
        expect(onSelect).toHaveBeenCalledWith('Pick me', expect.any(Object));
    });

    it('forwards modifier keys via the mouse event', () => {
        const onSelect = vi.fn();
        render(
            <SuggestionChips suggestions={['Pick me']} onSelect={onSelect} />
        );
        fireEvent.click(screen.getByTestId('suggestion-chip'), { ctrlKey: true });
        const event = onSelect.mock.calls[0][1];
        expect(event.ctrlKey).toBe(true);
    });

    it('applies pointer-events-none and opacity-50 when disabled', () => {
        render(
            <SuggestionChips
                suggestions={['A']}
                onSelect={vi.fn()}
                disabled
            />
        );
        const wrapper = screen.getByTestId('suggestion-chips');
        expect(wrapper.className).toContain('pointer-events-none');
        expect(wrapper.className).toContain('opacity-50');
    });

    it('renders wrapper with data-testid="suggestion-chips"', () => {
        render(
            <SuggestionChips suggestions={['X']} onSelect={vi.fn()} />
        );
        expect(screen.getByTestId('suggestion-chips')).toBeTruthy();
    });
});
