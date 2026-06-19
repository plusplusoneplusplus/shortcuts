/**
 * @vitest-environment jsdom
 *
 * Tests for the EffortTierSelector component.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../../../../src/server/spa/client/react/ui/cn', () => ({
    cn: (...classes: any[]) => classes.filter(Boolean).join(' '),
}));

import { EffortTierSelector } from '../../../../../src/server/spa/client/react/features/chat/EffortTierSelector';
import type { LocalEffortTiersMap } from '../../../../../src/server/spa/client/react/hooks/useProviderEffortTiers';

const ALL_TIERS: LocalEffortTiersMap = {
    'very-low': { model: 'tiny-model', reasoningEffort: 'low', source: 'default' },
    low: { model: 'fast-model', reasoningEffort: 'low', source: 'config' },
    medium: { model: 'balanced-model', reasoningEffort: '', source: 'default' },
    high: { model: 'deep-model', reasoningEffort: 'high', source: 'config' },
};

function renderSelector(
    overrides: Partial<React.ComponentProps<typeof EffortTierSelector>> = {},
) {
    const onChange = vi.fn();
    render(
        <EffortTierSelector
            tiers={ALL_TIERS}
            selectedTier="medium"
            onChange={onChange}
            {...overrides}
        />,
    );
    return { onChange };
}

describe('EffortTierSelector', () => {
    it('renders the trigger button with current tier label', () => {
        renderSelector({ selectedTier: 'medium' });
        expect(screen.getByTestId('effort-tier-trigger-btn').textContent).toContain('Effort: Medium');
    });

    it('uses compact icon-only sizing below sm when mobile tap target mode is enabled', () => {
        renderSelector({ selectedTier: 'medium', mobileTapTarget: true });

        const trigger = screen.getByTestId('effort-tier-trigger-btn');
        const tokens = trigger.className.split(/\s+/);
        expect(tokens).toContain('h-8');
        expect(tokens).toContain('w-8');
        expect(tokens).toContain('justify-center');
        expect(tokens).toContain('sm:w-auto');
        expect(tokens).toContain('sm:px-2');
        expect(trigger.getAttribute('aria-label')).toBe('Effort tier: Medium');
        expect(trigger.textContent).toContain('E');
        const label = Array.from(trigger.querySelectorAll('span')).find(span => span.textContent?.includes('Effort: Medium')) as HTMLElement;
        expect(label.className).toContain('hidden');
        expect(label.className).toContain('sm:inline');
    });

    it('opens the dropdown on trigger click', () => {
        renderSelector();
        fireEvent.click(screen.getByTestId('effort-tier-trigger-btn'));
        expect(screen.getByTestId('effort-tier-menu')).toBeTruthy();
    });

    it('renders all four tier options in lowest-to-highest order', () => {
        renderSelector();
        fireEvent.click(screen.getByTestId('effort-tier-trigger-btn'));
        expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual([
            'Very Low',
            'Low',
            'Medium',
            'High',
        ]);
    });

    it('calls onChange and closes menu when a configured tier is selected', () => {
        const { onChange } = renderSelector({ selectedTier: 'medium' });
        fireEvent.click(screen.getByTestId('effort-tier-trigger-btn'));
        fireEvent.click(screen.getByTestId('effort-tier-option-high'));
        expect(onChange).toHaveBeenCalledWith('high');
        expect(screen.queryByTestId('effort-tier-menu')).toBeNull();
    });

    it('selects very-low and reflects it in data-tier-value', () => {
        const onChange = vi.fn();
        const { rerender } = render(
            <EffortTierSelector tiers={ALL_TIERS} selectedTier="medium" onChange={onChange} />,
        );
        expect(screen.getByTestId('effort-tier-selector').getAttribute('data-tier-value')).toBe('medium');

        fireEvent.click(screen.getByTestId('effort-tier-trigger-btn'));
        fireEvent.click(screen.getByTestId('effort-tier-option-very-low'));

        expect(onChange).toHaveBeenCalledWith('very-low');
        expect(screen.queryByTestId('effort-tier-menu')).toBeNull();
        rerender(
            <EffortTierSelector tiers={ALL_TIERS} selectedTier="very-low" onChange={onChange} />,
        );
        expect(screen.getByTestId('effort-tier-selector').getAttribute('data-tier-value')).toBe('very-low');
    });

    it('marks the current selection with data-selected=true', () => {
        renderSelector({ selectedTier: 'low' });
        fireEvent.click(screen.getByTestId('effort-tier-trigger-btn'));
        expect(screen.getByTestId('effort-tier-option-low').getAttribute('data-selected')).toBe('true');
        expect(screen.getByTestId('effort-tier-option-medium').getAttribute('data-selected')).toBe('false');
    });

    it('disables unconfigured tiers', () => {
        const tiersWithGap: LocalEffortTiersMap = {
            medium: { model: 'balanced', reasoningEffort: '', source: 'default' },
            high: { model: 'deep', reasoningEffort: 'high', source: 'config' },
        };
        renderSelector({ tiers: tiersWithGap, selectedTier: 'medium' });
        fireEvent.click(screen.getByTestId('effort-tier-trigger-btn'));
        const veryLowOption = screen.getByTestId('effort-tier-option-very-low');
        expect(veryLowOption.getAttribute('data-configured')).toBe('false');
        expect(veryLowOption.getAttribute('aria-disabled')).toBe('true');
    });

    it('does not call onChange when an unconfigured tier is clicked', () => {
        const tiersWithGap: LocalEffortTiersMap = {
            medium: { model: 'balanced', reasoningEffort: '', source: 'default' },
        };
        const { onChange } = renderSelector({ tiers: tiersWithGap, selectedTier: 'medium' });
        fireEvent.click(screen.getByTestId('effort-tier-trigger-btn'));
        fireEvent.click(screen.getByTestId('effort-tier-option-very-low'));
        expect(onChange).not.toHaveBeenCalled();
    });

    it('shows tooltip "Not configured in Admin" for unconfigured tier', () => {
        const tiersWithGap: LocalEffortTiersMap = {
            medium: { model: 'balanced', reasoningEffort: '', source: 'default' },
        };
        renderSelector({ tiers: tiersWithGap, selectedTier: 'medium' });
        fireEvent.click(screen.getByTestId('effort-tier-trigger-btn'));
        expect(screen.getByTestId('effort-tier-option-very-low').title).toBe('Very Low: Not configured in Admin');
    });

    it('disables the trigger button when disabled=true', () => {
        renderSelector({ disabled: true });
        const trigger = screen.getByTestId('effort-tier-trigger-btn') as HTMLButtonElement;
        expect(trigger.disabled).toBe(true);
    });

    it('uses the provided data-testid', () => {
        render(
            <EffortTierSelector
                tiers={ALL_TIERS}
                selectedTier="medium"
                onChange={vi.fn()}
                data-testid="my-selector"
            />,
        );
        expect(screen.getByTestId('my-selector')).toBeTruthy();
    });

    it('reflects selectedTier change via data-tier-value attribute', () => {
        const { rerender } = render(
            <EffortTierSelector tiers={ALL_TIERS} selectedTier="medium" onChange={vi.fn()} />,
        );
        expect(screen.getByTestId('effort-tier-selector').getAttribute('data-tier-value')).toBe('medium');
        rerender(
            <EffortTierSelector tiers={ALL_TIERS} selectedTier="very-low" onChange={vi.fn()} />,
        );
        expect(screen.getByTestId('effort-tier-selector').getAttribute('data-tier-value')).toBe('very-low');
    });
});
