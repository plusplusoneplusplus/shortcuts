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
