/**
 * Tests for EffortTierSelector, the composite model + reasoning-effort tier
 * picker used by the chat composer when effort tier mode is enabled.
 */
/* @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EffortTierSelector } from '../../../../src/server/spa/client/react/features/chat/EffortTierSelector';
import type { LocalEffortTiersMap } from '../../../../src/server/spa/client/react/hooks/useProviderEffortTiers';

const tiers: LocalEffortTiersMap = {
    low: { model: 'gpt-5-mini', reasoningEffort: 'low', source: 'config' },
    medium: { model: 'gpt-5', reasoningEffort: '', source: 'default' },
    high: { model: 'gpt-5-pro', reasoningEffort: 'high', source: 'config' },
};

describe('EffortTierSelector', () => {
    it('shows the selected tier model and reasoning effort in the trigger tooltip', () => {
        render(<EffortTierSelector tiers={tiers} selectedTier="high" onChange={() => {}} />);

        expect(screen.getByTestId('effort-tier-trigger-btn').getAttribute('title')).toBe(
            'Effort tier: High\nModel: gpt-5-pro\nReasoning effort: high',
        );
    });

    it('shows Auto when the selected tier has no explicit reasoning effort', () => {
        render(<EffortTierSelector tiers={tiers} selectedTier="medium" onChange={() => {}} />);

        expect(screen.getByTestId('effort-tier-trigger-btn').getAttribute('title')).toBe(
            'Effort tier: Medium\nModel: gpt-5\nReasoning effort: Auto',
        );
    });

    it('shows model and reasoning effort tooltips for configured menu tiers', () => {
        render(<EffortTierSelector tiers={tiers} selectedTier="low" onChange={() => {}} />);

        fireEvent.click(screen.getByTestId('effort-tier-trigger-btn'));

        expect(screen.getByTestId('effort-tier-option-low').getAttribute('title')).toBe(
            'Low\nModel: gpt-5-mini\nReasoning effort: low',
        );
        expect(screen.getByTestId('effort-tier-option-medium').getAttribute('title')).toBe(
            'Medium\nModel: gpt-5\nReasoning effort: Auto',
        );
    });

    it('keeps unconfigured tiers disabled with an explanatory tooltip', () => {
        const onChange = vi.fn();
        render(<EffortTierSelector tiers={{ low: tiers.low }} selectedTier="low" onChange={onChange} />);

        fireEvent.click(screen.getByTestId('effort-tier-trigger-btn'));
        const medium = screen.getByTestId('effort-tier-option-medium') as HTMLButtonElement;

        expect(medium.disabled).toBe(true);
        expect(medium.getAttribute('title')).toBe('Medium: Not configured in Admin');
        fireEvent.click(medium);
        expect(onChange).not.toHaveBeenCalled();
    });
});
