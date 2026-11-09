/**
 * Tests for EffortTierSelector, the composite model + reasoning-effort tier
 * picker used by the chat composer when effort tier mode is enabled.
 */
/* @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen, fireEvent } from '@testing-library/react';
import { EffortTierSelector } from '../../../../src/server/spa/client/react/features/chat/EffortTierSelector';
import type { LocalEffortTiersMap } from '../../../../src/server/spa/client/react/hooks/useProviderEffortTiers';
import type { ModelInfo } from '../../../../src/server/spa/client/react/hooks/useModels';

import { registerCloneBaseUrls } from '../../../../src/server/spa/client/react/repos/cloneRegistry';
import { buildRemoteCloneKey } from '../../../../src/server/spa/client/react/repos/cloneIdentity';
import { WorkspaceOwnerContext } from '../../../../src/server/spa/client/react/repos/workspaceOwnerContext';

afterEach(() => { registerCloneBaseUrls([]); window.location.hash = ''; });

const tiers: LocalEffortTiersMap = {
    'very-low': { model: 'gpt-5.4-mini', reasoningEffort: 'low', source: 'default' },
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

        expect(screen.getByTestId('effort-tier-option-very-low').getAttribute('title')).toBe(
            'Very Low\nModel: gpt-5.4-mini\nReasoning effort: low',
        );
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
        const veryLow = screen.getByTestId('effort-tier-option-very-low') as HTMLButtonElement;

        expect(veryLow.disabled).toBe(true);
        expect(veryLow.getAttribute('title')).toBe('Very Low: Not configured in Admin');
        fireEvent.click(veryLow);
        expect(onChange).not.toHaveBeenCalled();
    });

    it('renders Very Low first and notifies when selected', () => {
        const onChange = vi.fn();
        const { rerender } = render(<EffortTierSelector tiers={tiers} selectedTier="medium" onChange={onChange} />);

        fireEvent.click(screen.getByTestId('effort-tier-trigger-btn'));

        expect(screen.getAllByRole('option').map(option => option.firstElementChild?.textContent)).toEqual([
            'Very Low',
            'Low',
            'Medium',
            'High',
        ]);

        fireEvent.click(screen.getByTestId('effort-tier-option-very-low'));

        expect(onChange).toHaveBeenCalledWith('very-low');
        rerender(<EffortTierSelector tiers={tiers} selectedTier="very-low" onChange={onChange} />);
        expect(screen.getByTestId('effort-tier-selector').getAttribute('data-tier-value')).toBe('very-low');
    });

    // Regression: the taller tier list was clipped by the Notes chat lens, a
    // transformed overflow-hidden host. The menu must render outside its host,
    // except inside a modal dialog, whose focus trap must keep containing it.
    it('portals the menu out of a clipped host, but keeps it inside a dialog', () => {
        const onChange = vi.fn();
        const { unmount } = render(
            <div data-testid="clipped-host" style={{ overflow: 'hidden', transform: 'translate(0, 0)' }}>
                <EffortTierSelector tiers={tiers} selectedTier="medium" onChange={onChange} />
            </div>,
        );
        fireEvent.click(screen.getByTestId('effort-tier-trigger-btn'));
        const menu = screen.getByTestId('effort-tier-menu');
        expect(screen.getByTestId('clipped-host').contains(menu)).toBe(false);
        expect(menu.style.position).toBe('fixed');
        fireEvent.mouseDown(screen.getByTestId('effort-tier-option-very-low'));
        fireEvent.click(screen.getByTestId('effort-tier-option-very-low'));
        expect(onChange).toHaveBeenCalledWith('very-low');
        unmount();

        render(
            <div role="dialog" aria-modal="true" data-testid="dialog-host">
                <EffortTierSelector tiers={tiers} selectedTier="medium" onChange={() => {}} />
            </div>,
        );
        fireEvent.click(screen.getByTestId('effort-tier-trigger-btn'));
        expect(screen.getByTestId('dialog-host').contains(screen.getByTestId('effort-tier-menu'))).toBe(true);
    });

    // AC-03 — container-narrow: drop the "Effort:" prefix, show value only.
    describe('compact (container-narrow)', () => {
        it('renders the value without the "Effort:" prefix when compact', () => {
            render(<EffortTierSelector tiers={tiers} selectedTier="medium" onChange={() => {}} compact />);
            const label = screen.getByTestId('effort-tier-label');
            expect(label.textContent).toBe('Medium');
            expect(label.textContent).not.toMatch(/Effort:/);
        });

        it('keeps the "Effort:" prefix when not compact', () => {
            render(<EffortTierSelector tiers={tiers} selectedTier="medium" onChange={() => {}} />);
            expect(screen.getByTestId('effort-tier-label').textContent).toBe('Effort: Medium');
        });

        it('preserves the accessible tier name in the compact form', () => {
            render(<EffortTierSelector tiers={tiers} selectedTier="high" onChange={() => {}} compact />);
            expect(screen.getByTestId('effort-tier-trigger-btn').getAttribute('aria-label')).toBe(
                'Effort tier: High',
            );
        });
    });
});


describe('Configure tiers action', () => {
    it('opens the existing editor without changing the tier, draft, or submitting a form', () => {
        const onChange = vi.fn();
        const onSubmit = vi.fn();
        render(<form onSubmit={onSubmit}>
            <textarea defaultValue="Keep my unsent draft" aria-label="Draft" />
            <EffortTierSelector tiers={tiers} selectedTier="medium" provider="codex" workspaceId="one" onChange={onChange} />
        </form>);
        fireEvent.click(screen.getByTestId('effort-tier-trigger-btn'));
        expect(screen.getAllByRole('option')).toHaveLength(4);
        const configure = screen.getByRole('button', { name: 'Configure tiers…' });
        expect(configure.closest('[role="listbox"]')).toBeNull();
        fireEvent.click(configure);
        expect(window.location.hash).toBe('#admin/agents?section=effort-tiers&provider=codex');
        expect(onChange).not.toHaveBeenCalled();
        expect(onSubmit).not.toHaveBeenCalled();
        expect(screen.getByLabelText('Draft')).toHaveValue('Keep my unsent draft');
        expect(screen.getByTestId('effort-tier-selector')).toHaveAttribute('data-tier-value', 'medium');
        expect(screen.queryByTestId('effort-tier-menu')).toBeNull();
        expect(screen.getByTestId('effort-tier-trigger-btn')).toHaveFocus();
    });

    it('supports keyboard navigation, Escape, and Enter activation without selecting a tier', async () => {
        const onChange = vi.fn();
        render(<EffortTierSelector tiers={{ medium: tiers.medium }} selectedTier="medium" provider="copilot" onChange={onChange} compact mobileTapTarget />);
        const trigger = screen.getByTestId('effort-tier-trigger-btn');
        fireEvent.keyDown(trigger, { key: 'ArrowDown' });
        expect(screen.getByTestId('effort-tier-option-medium')).toHaveFocus();
        fireEvent.keyDown(document.activeElement!, { key: 'End' });
        expect(screen.getByTestId('effort-tier-configure')).toHaveFocus();
        fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
        expect(trigger).toHaveFocus();
        expect(screen.queryByTestId('effort-tier-menu')).toBeNull();
        await userEvent.keyboard('{ArrowDown}{End}{Enter}');
        expect(window.location.hash).toBe('#admin/agents?section=effort-tiers&provider=copilot');
        expect(onChange).not.toHaveBeenCalled();
    });

    it('uses the exact owner context for colliding workspace IDs and keeps Auto provider-neutral', () => {
        registerCloneBaseUrls([{ workspaceId: 'same', serverId: 'other', baseUrl: 'https://other.example' }]);
        render(<WorkspaceOwnerContext.Provider value={{ workspaceId: 'same', selectionId: 'owner', baseUrl: 'https://owner.example' }}>
            <EffortTierSelector tiers={tiers} selectedTier="medium" workspaceId="same" provider="auto" onChange={vi.fn()} autoProviderMode />
        </WorkspaceOwnerContext.Provider>);
        fireEvent.click(screen.getByTestId('effort-tier-trigger-btn'));
        fireEvent.click(screen.getByTestId('effort-tier-configure'));
        const query = new URLSearchParams(window.location.hash.split('?')[1]);
        expect(query.get('owner')).toBe('https://owner.example');
        expect(query.has('provider')).toBe(false);
    });

    it('does not fall back locally for an unresolved remote or externally unavailable configuration', () => {
        const props = { tiers, selectedTier: 'medium' as const, provider: 'codex', onChange: vi.fn() };
        const view = render(<EffortTierSelector {...props} workspaceId={buildRemoteCloneKey('missing', 'same')} />);
        fireEvent.click(screen.getByTestId('effort-tier-trigger-btn'));
        expect(screen.getByTestId('effort-tier-configure')).toBeDisabled();
        view.rerender(<EffortTierSelector {...props} configurationUnavailable />);
        fireEvent.click(screen.getByTestId('effort-tier-configure'));
        expect(window.location.hash).toBe('');
    });
});

describe('EffortTierSelector custom model & effort', () => {
    const models: ModelInfo[] = [
        { id: 'gpt-5', name: 'GPT-5', tokenLimit: 1, enabled: true, supportedReasoningEfforts: ['low', 'medium', 'high'], defaultReasoningEffort: 'medium' },
        { id: 'gpt-5-pro', tokenLimit: 1, enabled: true, supportedReasoningEfforts: ['high', 'xhigh'] },
        { id: 'gpt-4.1', tokenLimit: 1, enabled: true, supportedReasoningEfforts: [] },
    ];

    it('shows tier model hints and hides the Custom row unless onCustomChange is set', () => {
        render(<EffortTierSelector tiers={tiers} selectedTier="medium" onChange={() => {}} models={models} />);
        fireEvent.click(screen.getByTestId('effort-tier-trigger-btn'));

        expect(screen.getByTestId('effort-tier-hint-medium').textContent).toBe('GPT-5 · auto');
        expect(screen.getByTestId('effort-tier-hint-high').textContent).toBe('gpt-5-pro · high');
        expect(screen.queryByTestId('effort-tier-custom')).toBeNull();
    });

    it('starts from the selected tier and applies the chosen model and effort', () => {
        const onCustomChange = vi.fn();
        render(<EffortTierSelector tiers={tiers} selectedTier="high" onChange={() => {}} models={models} onCustomChange={onCustomChange} />);
        fireEvent.click(screen.getByTestId('effort-tier-trigger-btn'));
        fireEvent.click(screen.getByTestId('effort-tier-custom'));

        const select = screen.getByTestId('effort-tier-custom-model') as HTMLSelectElement;
        expect(select.value).toBe('gpt-5-pro');
        expect(Array.from(select.options).map(o => o.value)).toEqual(['gpt-5', 'gpt-5-pro', 'gpt-4.1']);
        // Only the model's own efforts (plus Auto) are offered.
        expect(screen.getAllByRole('radio').map(r => r.textContent)).toEqual(['Auto', 'High', 'Xhigh']);
        expect(screen.getByTestId('effort-tier-custom-effort-high').getAttribute('aria-checked')).toBe('true');

        fireEvent.click(screen.getByTestId('effort-tier-custom-effort-xhigh'));
        fireEvent.click(screen.getByTestId('effort-tier-custom-apply'));

        expect(onCustomChange).toHaveBeenCalledWith({ model: 'gpt-5-pro', reasoningEffort: 'xhigh' });
        expect(screen.queryByTestId('effort-tier-menu')).toBeNull();
    });

    it('drops an unsupported effort when switching models', () => {
        const onCustomChange = vi.fn();
        render(<EffortTierSelector tiers={tiers} selectedTier="high" onChange={() => {}} models={models} onCustomChange={onCustomChange} />);
        fireEvent.click(screen.getByTestId('effort-tier-trigger-btn'));
        fireEvent.click(screen.getByTestId('effort-tier-custom'));

        fireEvent.change(screen.getByTestId('effort-tier-custom-model'), { target: { value: 'gpt-4.1' } });
        expect(screen.getByTestId('effort-tier-custom-no-efforts')).toBeTruthy();
        fireEvent.change(screen.getByTestId('effort-tier-custom-model'), { target: { value: 'gpt-5' } });
        // Falls back to the model's default effort.
        expect(screen.getByTestId('effort-tier-custom-effort-medium').getAttribute('aria-checked')).toBe('true');

        fireEvent.click(screen.getByTestId('effort-tier-custom-apply'));
        expect(onCustomChange).toHaveBeenCalledWith({ model: 'gpt-5', reasoningEffort: 'medium' });
    });

    it('shows the custom pick in the chip and lets the user reset to the tier', () => {
        const onCustomChange = vi.fn();
        render(<EffortTierSelector tiers={tiers} selectedTier="medium" onChange={() => {}} models={models}
            custom={{ model: 'gpt-5', reasoningEffort: 'high' }} onCustomChange={onCustomChange} />);

        const trigger = screen.getByTestId('effort-tier-trigger-btn');
        expect(trigger.getAttribute('data-custom')).toBe('true');
        expect(screen.getByTestId('effort-tier-label').textContent).toBe('✎ GPT-5 · High');
        expect(trigger.getAttribute('title')).toContain('Model: gpt-5');

        fireEvent.click(trigger);
        // No tier is checked while custom is active.
        expect(screen.getAllByRole('option').every(o => o.getAttribute('aria-selected') === 'false')).toBe(true);
        fireEvent.click(screen.getByTestId('effort-tier-custom'));
        expect(screen.getByTestId('effort-tier-custom-effort-high').getAttribute('aria-checked')).toBe('true');
        fireEvent.click(screen.getByTestId('effort-tier-custom-reset'));
        expect(onCustomChange).toHaveBeenCalledWith(null);
    });

    it('disables Custom in Auto provider mode and ignores a stale custom pick', () => {
        render(<EffortTierSelector tiers={tiers} selectedTier="medium" onChange={() => {}} models={models} autoProviderMode
            custom={{ model: 'gpt-5', reasoningEffort: 'high' }} onCustomChange={() => {}} />);

        expect(screen.getByTestId('effort-tier-label').textContent).toContain('Medium');
        fireEvent.click(screen.getByTestId('effort-tier-trigger-btn'));
        expect((screen.getByTestId('effort-tier-custom') as HTMLButtonElement).disabled).toBe(true);
    });

    it('returns to the tier list from the custom panel', () => {
        render(<EffortTierSelector tiers={tiers} selectedTier="medium" onChange={() => {}} models={models} onCustomChange={() => {}} />);
        fireEvent.click(screen.getByTestId('effort-tier-trigger-btn'));
        fireEvent.click(screen.getByTestId('effort-tier-custom'));
        fireEvent.click(screen.getByTestId('effort-tier-custom-back'));
        expect(screen.getAllByRole('option')).toHaveLength(4);
    });
});
