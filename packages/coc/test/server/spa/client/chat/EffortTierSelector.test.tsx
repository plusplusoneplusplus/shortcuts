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
    low: { model: 'fast-model', reasoningEffort: 'low' },
    medium: { model: 'balanced-model', reasoningEffort: '' },
    high: { model: 'deep-model', reasoningEffort: 'high' },
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

    it('opens the dropdown on trigger click', () => {
        renderSelector();
        fireEvent.click(screen.getByTestId('effort-tier-trigger-btn'));
        expect(screen.getByTestId('effort-tier-menu')).toBeTruthy();
    });

    it('renders all three tier options in the dropdown', () => {
        renderSelector();
        fireEvent.click(screen.getByTestId('effort-tier-trigger-btn'));
        expect(screen.getByTestId('effort-tier-option-low')).toBeTruthy();
        expect(screen.getByTestId('effort-tier-option-medium')).toBeTruthy();
        expect(screen.getByTestId('effort-tier-option-high')).toBeTruthy();
    });

    it('calls onChange and closes menu when a configured tier is selected', () => {
        const { onChange } = renderSelector({ selectedTier: 'medium' });
        fireEvent.click(screen.getByTestId('effort-tier-trigger-btn'));
        fireEvent.click(screen.getByTestId('effort-tier-option-high'));
        expect(onChange).toHaveBeenCalledWith('high');
        expect(screen.queryByTestId('effort-tier-menu')).toBeNull();
    });

    it('marks the current selection with data-selected=true', () => {
        renderSelector({ selectedTier: 'low' });
        fireEvent.click(screen.getByTestId('effort-tier-trigger-btn'));
        expect(screen.getByTestId('effort-tier-option-low').getAttribute('data-selected')).toBe('true');
        expect(screen.getByTestId('effort-tier-option-medium').getAttribute('data-selected')).toBe('false');
    });

    it('disables unconfigured tiers', () => {
        const tiersWithGap: LocalEffortTiersMap = {
            medium: { model: 'balanced', reasoningEffort: '' },
            high: { model: 'deep', reasoningEffort: 'high' },
        };
        renderSelector({ tiers: tiersWithGap, selectedTier: 'medium' });
        fireEvent.click(screen.getByTestId('effort-tier-trigger-btn'));
        const lowOption = screen.getByTestId('effort-tier-option-low');
        expect(lowOption.getAttribute('data-configured')).toBe('false');
        expect(lowOption.getAttribute('aria-disabled')).toBe('true');
    });

    it('does not call onChange when an unconfigured tier is clicked', () => {
        const tiersWithGap: LocalEffortTiersMap = {
            medium: { model: 'balanced', reasoningEffort: '' },
        };
        const { onChange } = renderSelector({ tiers: tiersWithGap, selectedTier: 'medium' });
        fireEvent.click(screen.getByTestId('effort-tier-trigger-btn'));
        fireEvent.click(screen.getByTestId('effort-tier-option-low'));
        expect(onChange).not.toHaveBeenCalled();
    });

    it('shows tooltip "Not configured in Admin" for unconfigured tier', () => {
        const tiersWithGap: LocalEffortTiersMap = {
            medium: { model: 'balanced', reasoningEffort: '' },
        };
        renderSelector({ tiers: tiersWithGap, selectedTier: 'medium' });
        fireEvent.click(screen.getByTestId('effort-tier-trigger-btn'));
        expect(screen.getByTestId('effort-tier-option-low').title).toBe('Not configured in Admin');
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
            <EffortTierSelector tiers={ALL_TIERS} selectedTier="high" onChange={vi.fn()} />,
        );
        expect(screen.getByTestId('effort-tier-selector').getAttribute('data-tier-value')).toBe('high');
    });
});
