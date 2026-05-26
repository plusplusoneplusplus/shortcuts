/**
 * Tests for EffortPillSelector — the segmented pill control that drives
 * the per-turn reasoning-effort override in the chat composer.
 */
/* @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EffortPillSelector } from '../../../../src/server/spa/client/react/features/chat/EffortPillSelector';

describe('EffortPillSelector', () => {
    it('renders one button per effort level (Low, Medium, High)', () => {
        render(<EffortPillSelector value={null} onChange={() => {}} />);
        expect(screen.getByTestId('effort-pill-low')).toBeTruthy();
        expect(screen.getByTestId('effort-pill-medium')).toBeTruthy();
        expect(screen.getByTestId('effort-pill-high')).toBeTruthy();
    });

    it('marks no level when value is null (auto state)', () => {
        render(<EffortPillSelector value={null} onChange={() => {}} />);
        const container = screen.getByTestId('effort-pill-selector');
        expect(container.getAttribute('data-effort-value')).toBe('auto');
        expect(screen.getByTestId('effort-pill-low').getAttribute('aria-checked')).toBe('false');
        expect(screen.getByTestId('effort-pill-medium').getAttribute('aria-checked')).toBe('false');
        expect(screen.getByTestId('effort-pill-high').getAttribute('aria-checked')).toBe('false');
    });

    it('marks the supplied level as aria-checked when value is non-null', () => {
        render(<EffortPillSelector value="medium" onChange={() => {}} />);
        expect(screen.getByTestId('effort-pill-medium').getAttribute('aria-checked')).toBe('true');
        expect(screen.getByTestId('effort-pill-medium').getAttribute('data-selected')).toBe('true');
        expect(screen.getByTestId('effort-pill-low').getAttribute('aria-checked')).toBe('false');
        expect(screen.getByTestId('effort-pill-high').getAttribute('aria-checked')).toBe('false');
    });

    it('calls onChange with the picked level when a non-selected button is clicked', () => {
        const onChange = vi.fn();
        render(<EffortPillSelector value={null} onChange={onChange} />);
        fireEvent.click(screen.getByTestId('effort-pill-high'));
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith('high');
    });

    it('toggles the override off when the currently-selected button is clicked again', () => {
        const onChange = vi.fn();
        render(<EffortPillSelector value="medium" onChange={onChange} />);
        fireEvent.click(screen.getByTestId('effort-pill-medium'));
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith(null);
    });

    it('renders the radiogroup with an accessible label', () => {
        render(<EffortPillSelector value={null} onChange={() => {}} />);
        const group = screen.getByRole('radiogroup', { name: 'Reasoning effort' });
        expect(group).toBeTruthy();
    });

    it('honours the disabled prop by suppressing onChange and applying disabled attribute', () => {
        const onChange = vi.fn();
        render(<EffortPillSelector value="low" onChange={onChange} disabled />);
        const low = screen.getByTestId('effort-pill-low') as HTMLButtonElement;
        expect(low.disabled).toBe(true);
        fireEvent.click(low);
        expect(onChange).not.toHaveBeenCalled();
    });
});
