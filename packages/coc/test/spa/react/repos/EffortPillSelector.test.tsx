/**
 * Tests for EffortPillSelector — the dropdown chip that drives the
 * per-turn reasoning-effort override in the chat composer.
 *
 * The chip is structurally identical to AgentSelectorChip: trigger
 * button + popover listbox. Tests cover trigger labelling, open/close
 * lifecycle, option selection (and toggle-off via the "Auto" entry),
 * the disabled state, and the accessible listbox role.
 */
/* @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EffortPillSelector } from '../../../../src/server/spa/client/react/features/chat/EffortPillSelector';

describe('EffortPillSelector', () => {
    it('renders the trigger chip with "Auto" label when value is null', () => {
        render(<EffortPillSelector value={null} onChange={() => {}} />);
        const trigger = screen.getByTestId('effort-pill-trigger-btn');
        expect(trigger.textContent).toContain('Auto');
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        const container = screen.getByTestId('effort-pill-selector');
        expect(container.getAttribute('data-effort-value')).toBe('auto');
    });

    it('renders the trigger chip with the selected level label', () => {
        render(<EffortPillSelector value="medium" onChange={() => {}} />);
        const trigger = screen.getByTestId('effort-pill-trigger-btn');
        expect(trigger.textContent).toContain('Medium');
        const container = screen.getByTestId('effort-pill-selector');
        expect(container.getAttribute('data-effort-value')).toBe('medium');
    });

    it('does not render the listbox until the trigger is clicked', () => {
        render(<EffortPillSelector value={null} onChange={() => {}} />);
        expect(screen.queryByTestId('effort-pill-menu')).toBeNull();
        fireEvent.click(screen.getByTestId('effort-pill-trigger-btn'));
        expect(screen.getByTestId('effort-pill-menu')).toBeTruthy();
        expect(screen.getByTestId('effort-pill-trigger-btn').getAttribute('aria-expanded')).toBe('true');
    });

    it('renders Auto/Low/Medium/High options once opened', () => {
        render(<EffortPillSelector value={null} onChange={() => {}} />);
        fireEvent.click(screen.getByTestId('effort-pill-trigger-btn'));
        expect(screen.getByTestId('effort-pill-option-auto')).toBeTruthy();
        expect(screen.getByTestId('effort-pill-option-low')).toBeTruthy();
        expect(screen.getByTestId('effort-pill-option-medium')).toBeTruthy();
        expect(screen.getByTestId('effort-pill-option-high')).toBeTruthy();
    });

    it('marks the selected option with aria-selected and data-selected', () => {
        render(<EffortPillSelector value="high" onChange={() => {}} />);
        fireEvent.click(screen.getByTestId('effort-pill-trigger-btn'));
        const high = screen.getByTestId('effort-pill-option-high');
        expect(high.getAttribute('aria-selected')).toBe('true');
        expect(high.getAttribute('data-selected')).toBe('true');
        expect(screen.getByTestId('effort-pill-option-medium').getAttribute('aria-selected')).toBe('false');
        expect(screen.getByTestId('effort-pill-option-auto').getAttribute('aria-selected')).toBe('false');
    });

    it('marks the Auto option as selected when value is null', () => {
        render(<EffortPillSelector value={null} onChange={() => {}} />);
        fireEvent.click(screen.getByTestId('effort-pill-trigger-btn'));
        const auto = screen.getByTestId('effort-pill-option-auto');
        expect(auto.getAttribute('aria-selected')).toBe('true');
        expect(auto.getAttribute('data-selected')).toBe('true');
    });

    it('calls onChange with the picked level when a non-selected option is clicked', () => {
        const onChange = vi.fn();
        render(<EffortPillSelector value={null} onChange={onChange} />);
        fireEvent.click(screen.getByTestId('effort-pill-trigger-btn'));
        fireEvent.click(screen.getByTestId('effort-pill-option-high'));
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith('high');
    });

    it('closes the listbox after selecting an option', () => {
        render(<EffortPillSelector value={null} onChange={() => {}} />);
        fireEvent.click(screen.getByTestId('effort-pill-trigger-btn'));
        fireEvent.click(screen.getByTestId('effort-pill-option-low'));
        expect(screen.queryByTestId('effort-pill-menu')).toBeNull();
    });

    it('calls onChange(null) when the currently-selected option is clicked again', () => {
        const onChange = vi.fn();
        render(<EffortPillSelector value="medium" onChange={onChange} />);
        fireEvent.click(screen.getByTestId('effort-pill-trigger-btn'));
        fireEvent.click(screen.getByTestId('effort-pill-option-medium'));
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith(null);
    });

    it('calls onChange(null) when the explicit Auto entry is clicked', () => {
        const onChange = vi.fn();
        render(<EffortPillSelector value="high" onChange={onChange} />);
        fireEvent.click(screen.getByTestId('effort-pill-trigger-btn'));
        fireEvent.click(screen.getByTestId('effort-pill-option-auto'));
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith(null);
    });

    it('exposes a listbox role with an accessible label', () => {
        render(<EffortPillSelector value={null} onChange={() => {}} />);
        fireEvent.click(screen.getByTestId('effort-pill-trigger-btn'));
        const listbox = screen.getByRole('listbox', { name: 'Select reasoning effort' });
        expect(listbox).toBeTruthy();
    });

    it('honours the disabled prop by suppressing the popover and applying disabled', () => {
        const onChange = vi.fn();
        render(<EffortPillSelector value="low" onChange={onChange} disabled />);
        const trigger = screen.getByTestId('effort-pill-trigger-btn') as HTMLButtonElement;
        expect(trigger.disabled).toBe(true);
        fireEvent.click(trigger);
        expect(screen.queryByTestId('effort-pill-menu')).toBeNull();
        expect(onChange).not.toHaveBeenCalled();
    });
});
