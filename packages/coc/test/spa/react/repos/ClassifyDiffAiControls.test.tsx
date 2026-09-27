import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { AgentProviderStatus } from '@plusplusoneplusplus/coc-client';
import { ClassifyDiffAiControls } from '../../../../src/server/spa/client/react/features/git/diff/ClassifyDiffAiControls';
import type { UseModalJobAiSelectionResult } from '../../../../src/server/spa/client/react/shared/ModalJobAiControls';

function createSelection(overrides: Partial<UseModalJobAiSelectionResult> = {}): UseModalJobAiSelectionResult {
    const providers: AgentProviderStatus[] = [
        { id: 'copilot', label: 'Copilot', enabled: true, available: true, locked: true },
    ];

    return {
        provider: 'copilot',
        setProvider: vi.fn(),
        agentProviders: providers,
        providersLoading: false,
        useEffortTierMode: false,
        effortTierMap: {},
        selectedEffortTier: 'medium',
        setEffortTier: vi.fn(),
        modelCommand: {
            modelMenuVisible: false,
            modelFilter: '',
            filteredModels: [],
            modelHighlightIndex: 0,
            modelOverride: null,
            setModelOverride: vi.fn(),
            handleModelSelect: vi.fn(),
            showModelMenu: vi.fn(),
            dismissModelMenu: vi.fn(),
            handleModelKeyDown: vi.fn(),
            setModelFilter: vi.fn(),
        },
        defaultModelId: undefined,
        defaultModelLabel: undefined,
        validModelOverride: null,
        effortOverride: null,
        setEffortOverride: vi.fn(),
        effortOptions: [],
        effortPickerDisabled: false,
        resolved: { provider: 'copilot' },
        ...overrides,
    };
}

describe('ClassifyDiffAiControls', () => {
    const MULTI_PROVIDER_TIERS = {
        agentProviders: [
            { id: 'copilot', label: 'Copilot', enabled: true, available: true, locked: true },
            { id: 'codex', label: 'Codex', enabled: true, available: true },
        ] as AgentProviderStatus[],
        useEffortTierMode: true,
        effortTierMap: { medium: { model: 'm', reasoningEffort: 'medium', source: 'config' as const } },
    };

    it('collapseLabels hides the provider name and Effort prefix in a narrow container and stays on one row', () => {
        render(<ClassifyDiffAiControls selection={createSelection(MULTI_PROVIDER_TIERS)} collapseLabels />);

        expect(screen.getByTestId('classify-ai-controls').className).toContain('flex-nowrap');
        expect(screen.getByTestId('classify-ai-controls').className).not.toContain('flex-wrap');
        expect(screen.getByTestId('agent-selector-chip-label').className).toContain('[@container_(max-width:559px)]:hidden');
        const tierLabel = screen.getByTestId('effort-tier-label');
        expect(tierLabel.textContent).toBe('Effort: Medium');
        expect(tierLabel.querySelector('span')!.className).toContain('[@container_(max-width:559px)]:hidden');
    });

    it('keeps labels unconditionally visible without collapseLabels', () => {
        render(<ClassifyDiffAiControls selection={createSelection(MULTI_PROVIDER_TIERS)} />);

        expect(screen.getByTestId('classify-ai-controls').className).toContain('flex-wrap');
        expect(screen.getByTestId('agent-selector-chip-label').className).not.toContain('@container');
        expect(screen.getByTestId('effort-tier-label').innerHTML).not.toContain('@container');
    });

    it('hides the provider selector when only one provider can be selected', () => {
        render(<ClassifyDiffAiControls selection={createSelection()} />);

        expect(screen.getByTestId('classify-ai-controls')).toBeInTheDocument();
        expect(screen.queryByTestId('agent-selector-chip-btn')).toBeNull();
        expect(screen.queryByTestId('classify-provider-divider')).toBeNull();
    });

    it('shows the provider selector when multiple providers can be selected', () => {
        render(<ClassifyDiffAiControls selection={createSelection({
            agentProviders: [
                { id: 'copilot', label: 'Copilot', enabled: true, available: true, locked: true },
                { id: 'codex', label: 'Codex', enabled: true, available: true },
            ],
        })} />);

        expect(screen.getByTestId('agent-selector-chip-btn')).toHaveTextContent('Copilot');
        expect(screen.getByTestId('classify-provider-divider')).toBeInTheDocument();
    });

    it('shows Auto and hides provider-specific model controls when Auto is selected', () => {
        render(<ClassifyDiffAiControls selection={createSelection({
            provider: 'auto',
            agentProviders: [
                { id: 'auto', label: 'Auto', enabled: true, available: true },
                { id: 'copilot', label: 'Copilot', enabled: true, available: true, locked: true },
                { id: 'codex', label: 'Codex', enabled: true, available: true },
            ],
            useEffortTierMode: true,
            effortTierMap: {
                medium: { model: 'Auto', reasoningEffort: '', source: 'default' },
            },
            resolved: { effortTier: 'medium' },
        })} />);

        expect(screen.getByTestId('agent-selector-chip-btn')).toHaveTextContent('Auto');
        expect(screen.getByTestId('classify-effort-tier-selector')).toBeInTheDocument();
        expect(screen.queryByTestId('classify-model-picker-chip')).toBeNull();
    });

    it('renders effort tiers instead of the model picker in tier mode', () => {
        render(<ClassifyDiffAiControls selection={createSelection({
            useEffortTierMode: true,
            effortTierMap: {
                low: { model: 'fast-model', reasoningEffort: 'low', source: 'config' },
                medium: { model: 'balanced-model', reasoningEffort: 'medium', source: 'config' },
            },
        })} />);

        expect(screen.getByTestId('classify-effort-tier-selector')).toBeInTheDocument();
        expect(screen.queryByTestId('classify-model-picker-chip')).toBeNull();
    });

    it('renders the model command picker in non-tier mode', () => {
        const showModelMenu = vi.fn();
        render(<ClassifyDiffAiControls selection={createSelection({
            defaultModelId: 'gpt-x',
            defaultModelLabel: 'GPT X',
            modelCommand: {
                ...createSelection().modelCommand,
                showModelMenu,
            },
        })} />);

        const picker = screen.getByTestId('classify-model-picker-chip');
        expect(picker).toHaveTextContent('GPT X');

        fireEvent.click(picker);
        expect(showModelMenu).toHaveBeenCalled();
    });
});
