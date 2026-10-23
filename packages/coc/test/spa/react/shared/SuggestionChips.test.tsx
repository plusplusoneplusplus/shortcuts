import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SuggestionChips } from '../../../../src/server/spa/client/react/ui/SuggestionChips';

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

    it('keeps all chips on one non-wrapping row', () => {
        render(
            <SuggestionChips suggestions={['A long first suggestion', 'B', 'C']} onSelect={vi.fn()} />
        );
        const row = screen.getByTestId('suggestion-chips');
        expect(row.className).toContain('flex-nowrap');
        expect(row.className).toContain('overflow-x-auto');
        expect(row.className).not.toContain('flex-wrap ');
    });

    it('truncates long chips and puts the full text in the tooltip', () => {
        const text = 'Make Open write the file into the URL too and keep the selection';
        render(<SuggestionChips suggestions={[text]} onSelect={vi.fn()} />);
        const chip = screen.getByTestId('suggestion-chip');
        expect(chip.className).toContain('truncate');
        expect(chip.className).toContain('max-w-[16rem]');
        expect(chip.className).toContain('text-xs');
        expect(chip.title).toBe(`${text}\nClick to edit · Ctrl+Click to send`);
    });

    it('uses an outline style in the send state', () => {
        render(<SuggestionChips suggestions={['Go']} onSelect={vi.fn()} ctrlHeld />);
        const chip = screen.getByTestId('suggestion-chip');
        expect(chip.className).toContain('bg-transparent');
        expect(chip.title).toBe('Go\nClick to send');
    });

    it('omits the dismiss button without onDismiss', () => {
        render(<SuggestionChips suggestions={['A']} onSelect={vi.fn()} />);
        expect(screen.queryByTestId('dismiss-suggestions-btn')).toBeNull();
    });

    it('renders the dismiss button inline after the chips and calls onDismiss', () => {
        const onDismiss = vi.fn();
        render(<SuggestionChips suggestions={['A']} onSelect={vi.fn()} onDismiss={onDismiss} />);
        const dismiss = screen.getByTestId('dismiss-suggestions-btn');
        const row = screen.getByTestId('suggestion-chips');
        expect(dismiss.className).not.toContain('absolute');
        expect(row.parentElement).toBe(dismiss.parentElement);
        expect(row.compareDocumentPosition(dismiss) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        fireEvent.click(dismiss);
        expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('keeps the dismiss button clickable while chips are disabled', () => {
        const onDismiss = vi.fn();
        render(<SuggestionChips suggestions={['A']} onSelect={vi.fn()} disabled onDismiss={onDismiss} />);
        const dismiss = screen.getByTestId('dismiss-suggestions-btn');
        expect(dismiss.hasAttribute('disabled')).toBe(false);
        fireEvent.click(dismiss);
        expect(onDismiss).toHaveBeenCalledTimes(1);
    });
});
