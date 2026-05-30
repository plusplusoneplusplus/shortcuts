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
import { EffortPillSelector, buildEffortOptionsForModel } from '../../../../src/server/spa/client/react/features/chat/EffortPillSelector';

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

    it('renders "Extra High" label when xhigh is selected', () => {
        render(<EffortPillSelector value="xhigh" onChange={() => {}} />);
        const trigger = screen.getByTestId('effort-pill-trigger-btn');
        expect(trigger.textContent).toContain('Extra High');
        const container = screen.getByTestId('effort-pill-selector');
        expect(container.getAttribute('data-effort-value')).toBe('xhigh');
    });

    it('does not render the listbox until the trigger is clicked', () => {
        render(<EffortPillSelector value={null} onChange={() => {}} />);
        expect(screen.queryByTestId('effort-pill-menu')).toBeNull();
        fireEvent.click(screen.getByTestId('effort-pill-trigger-btn'));
        expect(screen.getByTestId('effort-pill-menu')).toBeTruthy();
        expect(screen.getByTestId('effort-pill-trigger-btn').getAttribute('aria-expanded')).toBe('true');
    });

    it('renders Auto/Low/Medium/High/Extra High options once opened', () => {
        render(<EffortPillSelector value={null} onChange={() => {}} />);
        fireEvent.click(screen.getByTestId('effort-pill-trigger-btn'));
        expect(screen.getByTestId('effort-pill-option-auto')).toBeTruthy();
        expect(screen.getByTestId('effort-pill-option-low')).toBeTruthy();
        expect(screen.getByTestId('effort-pill-option-medium')).toBeTruthy();
        expect(screen.getByTestId('effort-pill-option-high')).toBeTruthy();
        expect(screen.getByTestId('effort-pill-option-xhigh')).toBeTruthy();
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

    it('marks the xhigh option as selected when value is xhigh', () => {
        render(<EffortPillSelector value="xhigh" onChange={() => {}} />);
        fireEvent.click(screen.getByTestId('effort-pill-trigger-btn'));
        const xhigh = screen.getByTestId('effort-pill-option-xhigh');
        expect(xhigh.getAttribute('aria-selected')).toBe('true');
        expect(xhigh.getAttribute('data-selected')).toBe('true');
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

    it('calls onChange with "xhigh" when Extra High is clicked', () => {
        const onChange = vi.fn();
        render(<EffortPillSelector value={null} onChange={onChange} />);
        fireEvent.click(screen.getByTestId('effort-pill-trigger-btn'));
        fireEvent.click(screen.getByTestId('effort-pill-option-xhigh'));
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith('xhigh');
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

    it('renders only model-specific options when options prop is passed', () => {
        const opts = buildEffortOptionsForModel(['low', 'medium', 'high', 'xhigh']);
        render(<EffortPillSelector value={null} onChange={() => {}} options={opts} />);
        fireEvent.click(screen.getByTestId('effort-pill-trigger-btn'));
        expect(screen.getByTestId('effort-pill-option-low')).toBeTruthy();
        expect(screen.getByTestId('effort-pill-option-xhigh')).toBeTruthy();
    });

    it('does not show xhigh when model only supports low/medium/high', () => {
        const opts = buildEffortOptionsForModel(['low', 'medium', 'high']);
        render(<EffortPillSelector value={null} onChange={() => {}} options={opts} />);
        fireEvent.click(screen.getByTestId('effort-pill-trigger-btn'));
        expect(screen.queryByTestId('effort-pill-option-xhigh')).toBeNull();
        expect(screen.getByTestId('effort-pill-option-high')).toBeTruthy();
    });
});

describe('buildEffortOptionsForModel', () => {
    it('returns all four options when supportedEfforts is empty', () => {
        const opts = buildEffortOptionsForModel([]);
        expect(opts.map(o => o.value)).toEqual(['low', 'medium', 'high', 'xhigh']);
    });

    it('returns all four options when supportedEfforts is undefined', () => {
        const opts = buildEffortOptionsForModel(undefined);
        expect(opts.map(o => o.value)).toEqual(['low', 'medium', 'high', 'xhigh']);
    });

    it('filters to supported efforts only in canonical order', () => {
        const opts = buildEffortOptionsForModel(['xhigh', 'medium', 'low']);
        // Order should be canonical: low, medium, xhigh
        expect(opts.map(o => o.value)).toEqual(['low', 'medium', 'xhigh']);
    });

    it('returns xhigh option with label "Extra High"', () => {
        const opts = buildEffortOptionsForModel(['low', 'medium', 'high', 'xhigh']);
        const xhigh = opts.find(o => o.value === 'xhigh');
        expect(xhigh).toBeDefined();
        expect(xhigh!.label).toBe('Extra High');
    });

    it('returns all options when supportedEfforts is not recognised (falls back to all)', () => {
        const opts = buildEffortOptionsForModel(['unknown-effort']);
        // No known options match → fall back to all four
        expect(opts.map(o => o.value)).toEqual(['low', 'medium', 'high', 'xhigh']);
    });

    it('single-effort model returns just that option', () => {
        const opts = buildEffortOptionsForModel(['xhigh']);
        expect(opts.map(o => o.value)).toEqual(['xhigh']);
    });
});
