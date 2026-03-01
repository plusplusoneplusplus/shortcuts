import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SuggestionChips } from '../../../src/server/spa/client/react/shared/SuggestionChips';

describe('SuggestionChips', () => {
    it('renders nothing when suggestions is empty', () => {
        const { container } = render(
            <SuggestionChips suggestions={[]} onSelect={vi.fn()} />
        );
        expect(container.querySelector('[data-testid="suggestion-chips"]')).toBeNull();
    });

    it('renders one button per suggestion', () => {
        render(
            <SuggestionChips
                suggestions={['Question 1', 'Question 2', 'Question 3']}
                onSelect={vi.fn()}
            />
        );
        const buttons = screen.getAllByTestId('suggestion-chip');
        expect(buttons).toHaveLength(3);
        expect(buttons[0].textContent).toContain('Question 1');
        expect(buttons[1].textContent).toContain('Question 2');
        expect(buttons[2].textContent).toContain('Question 3');
    });

    it('renders arrow prefix on each button', () => {
        render(
            <SuggestionChips suggestions={['Hello']} onSelect={vi.fn()} />
        );
        const button = screen.getByTestId('suggestion-chip');
        expect(button.textContent).toContain('→');
    });

    it('calls onSelect with correct text on click', () => {
        const onSelect = vi.fn();
        render(
            <SuggestionChips
                suggestions={['Alpha', 'Beta']}
                onSelect={onSelect}
            />
        );
        const buttons = screen.getAllByTestId('suggestion-chip');
        fireEvent.click(buttons[1]);
        expect(onSelect).toHaveBeenCalledOnce();
        expect(onSelect).toHaveBeenCalledWith('Beta');
    });

    it('applies disabled styling when disabled is true', () => {
        render(
            <SuggestionChips
                suggestions={['Disabled chip']}
                onSelect={vi.fn()}
                disabled
            />
        );
        const container = screen.getByTestId('suggestion-chips');
        expect(container.className).toContain('pointer-events-none');
        expect(container.className).toContain('opacity-50');
    });

    it('does not apply disabled styling when disabled is false', () => {
        render(
            <SuggestionChips
                suggestions={['Enabled chip']}
                onSelect={vi.fn()}
                disabled={false}
            />
        );
        const container = screen.getByTestId('suggestion-chips');
        expect(container.className).not.toContain('pointer-events-none');
        expect(container.className).not.toContain('opacity-50');
    });

    it('has fadeIn animation style on wrapper', () => {
        render(
            <SuggestionChips suggestions={['Animated']} onSelect={vi.fn()} />
        );
        const container = screen.getByTestId('suggestion-chips');
        expect(container.style.animation).toContain('suggestionFadeIn');
    });
});
