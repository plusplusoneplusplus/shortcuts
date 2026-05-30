/**
 * Tests for ProviderModelsSection — provider-scoped model catalog and query UI.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

const mocks = vi.hoisted(() => ({
    agentProviders: {
        listModels: vi.fn(),
        getEnabledModels: vi.fn(),
        setEnabledModels: vi.fn(),
        getReasoningEfforts: vi.fn(),
        setReasoningEffort: vi.fn(),
        queryModel: vi.fn(),
    },
}));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../../src/server/spa/client/react/api/cocClient')>();
    return {
        ...actual,
        getSpaCocClient: () => ({ agentProviders: mocks.agentProviders }),
    };
});

// Must import after mocks
const { ProviderModelsSection } = await import('../../../../src/server/spa/client/react/features/models/ProviderModelsSection');

const SAMPLE_MODELS = [
    {
        id: 'gpt-5',
        name: 'GPT-5',
        enabled: true,
        capabilities: {
            supports: { vision: true, reasoningEffort: false },
            limits: { max_context_window_tokens: 200000 },
        },
    },
    {
        id: 'gpt-4',
        name: 'GPT-4',
        enabled: false,
        capabilities: {
            supports: { vision: false, reasoningEffort: false },
            limits: { max_context_window_tokens: 8192 },
        },
    },
];

describe('ProviderModelsSection', () => {
    beforeEach(() => {
        mocks.agentProviders.listModels.mockReset();
        mocks.agentProviders.setEnabledModels.mockReset();
        mocks.agentProviders.getReasoningEfforts.mockReset();
        mocks.agentProviders.setReasoningEffort.mockReset();
        mocks.agentProviders.queryModel.mockReset();
        mocks.agentProviders.getReasoningEfforts.mockResolvedValue({ provider: 'copilot', reasoningEfforts: {} });
    });
    afterEach(() => { vi.clearAllMocks(); });

    it('shows unavailable message when provider is not available', () => {
        // Even unavailable providers trigger the hook — provide a pending promise
        mocks.agentProviders.listModels.mockReturnValue(new Promise(() => {}));
        render(
            <ProviderModelsSection
                provider="codex"
                available={false}
                unavailableMessage="Enable Codex first."
            />
        );
        expect(screen.getByTestId('provider-models-unavailable')).toBeDefined();
        expect(screen.getByText('Enable Codex first.')).toBeDefined();
    });

    it('shows default unavailable message when no custom message', () => {
        mocks.agentProviders.listModels.mockReturnValue(new Promise(() => {}));
        render(
            <ProviderModelsSection provider="codex" available={false} />
        );
        expect(screen.getByText(/Codex is not available/)).toBeDefined();
    });

    it('shows loading state when available', () => {
        mocks.agentProviders.listModels.mockReturnValue(new Promise(() => {}));
        render(
            <ProviderModelsSection provider="copilot" available={true} />
        );
        expect(screen.getByTestId('provider-models-loading')).toBeDefined();
    });

    it('shows error state with retry button', async () => {
        mocks.agentProviders.listModels.mockRejectedValue(new Error('Server error'));
        render(
            <ProviderModelsSection provider="copilot" available={true} />
        );
        await waitFor(() => {
            expect(screen.getByTestId('provider-models-error')).toBeDefined();
        });
        expect(screen.getByTestId('provider-models-retry')).toBeDefined();
    });

    it('renders model cards in catalog view', async () => {
        mocks.agentProviders.listModels.mockResolvedValue({
            provider: 'copilot',
            models: SAMPLE_MODELS,
        });
        render(
            <ProviderModelsSection provider="copilot" available={true} />
        );
        await waitFor(() => {
            expect(screen.getByTestId('provider-models-section')).toBeDefined();
        });
        const cards = screen.getAllByTestId('provider-model-card');
        expect(cards).toHaveLength(2);
        expect(screen.getByTestId('provider-models-count').textContent).toBe('2 models');
        expect(screen.getByTestId('provider-models-enabled-count').textContent).toContain('1 of 2 enabled');
    });

    it('filters models by search', async () => {
        mocks.agentProviders.listModels.mockResolvedValue({
            provider: 'copilot',
            models: SAMPLE_MODELS,
        });
        render(
            <ProviderModelsSection provider="copilot" available={true} />
        );
        await waitFor(() => {
            expect(screen.getByTestId('provider-models-section')).toBeDefined();
        });

        const searchInput = screen.getByTestId('provider-models-search');
        fireEvent.change(searchInput, { target: { value: 'gpt-5' } });

        await waitFor(() => {
            const cards = screen.getAllByTestId('provider-model-card');
            expect(cards).toHaveLength(1);
        });
    });

    it('shows empty state when no models match filter', async () => {
        mocks.agentProviders.listModels.mockResolvedValue({
            provider: 'copilot',
            models: SAMPLE_MODELS,
        });
        render(
            <ProviderModelsSection provider="copilot" available={true} />
        );
        await waitFor(() => {
            expect(screen.getByTestId('provider-models-section')).toBeDefined();
        });

        const searchInput = screen.getByTestId('provider-models-search');
        fireEvent.change(searchInput, { target: { value: 'nonexistent' } });

        await waitFor(() => {
            expect(screen.getByTestId('provider-models-empty')).toBeDefined();
        });
    });

    it('shows empty state when provider has no models', async () => {
        mocks.agentProviders.listModels.mockResolvedValue({
            provider: 'codex',
            models: [],
        });
        render(
            <ProviderModelsSection provider="codex" available={true} />
        );
        await waitFor(() => {
            expect(screen.getByTestId('provider-models-empty')).toBeDefined();
        });
        expect(screen.getByText(/No models available from Codex/)).toBeDefined();
    });

    it('switches to query view and shows query UI', async () => {
        mocks.agentProviders.listModels.mockResolvedValue({
            provider: 'copilot',
            models: SAMPLE_MODELS,
        });
        render(
            <ProviderModelsSection provider="copilot" available={true} />
        );
        await waitFor(() => {
            expect(screen.getByTestId('provider-models-section')).toBeDefined();
        });

        fireEvent.click(screen.getByTestId('provider-models-tab-query'));

        await waitFor(() => {
            expect(screen.getByTestId('provider-model-query-view')).toBeDefined();
        });
        expect(screen.getByTestId('provider-model-query-prompt')).toBeDefined();
        expect(screen.getByTestId('provider-model-query-run')).toBeDefined();
        expect(screen.getByTestId('provider-model-query-empty')).toBeDefined();
    });

    it('runs query against the provider-scoped endpoint', async () => {
        mocks.agentProviders.listModels.mockResolvedValue({
            provider: 'copilot',
            models: [{ id: 'gpt-5', name: 'GPT-5', enabled: true }],
        });
        mocks.agentProviders.queryModel.mockResolvedValue({
            success: true,
            provider: 'copilot',
            response: 'Hello!',
            model: 'gpt-5',
            durationMs: 100,
        });
        render(
            <ProviderModelsSection provider="copilot" available={true} />
        );
        await waitFor(() => {
            expect(screen.getByTestId('provider-models-section')).toBeDefined();
        });

        fireEvent.click(screen.getByTestId('provider-models-tab-query'));
        await waitFor(() => {
            expect(screen.getByTestId('provider-model-query-prompt')).toBeDefined();
        });

        fireEvent.change(screen.getByTestId('provider-model-query-prompt'), { target: { value: 'Say hello' } });
        fireEvent.click(screen.getByTestId('provider-model-query-run'));

        await waitFor(() => {
            expect(mocks.agentProviders.queryModel).toHaveBeenCalledWith('copilot', expect.objectContaining({
                prompt: 'Say hello',
                timeoutMs: 60_000,
            }));
        });
        await waitFor(() => {
            expect(screen.getByTestId('provider-model-query-result')).toBeDefined();
        });
        expect(screen.getByTestId('provider-model-query-result').textContent).toBe('Hello!');
    });

    it('shows query error', async () => {
        mocks.agentProviders.listModels.mockResolvedValue({
            provider: 'copilot',
            models: [{ id: 'gpt-5', name: 'GPT-5', enabled: true }],
        });
        mocks.agentProviders.queryModel.mockRejectedValue(new Error('Timeout'));
        render(
            <ProviderModelsSection provider="copilot" available={true} />
        );
        await waitFor(() => {
            expect(screen.getByTestId('provider-models-section')).toBeDefined();
        });

        fireEvent.click(screen.getByTestId('provider-models-tab-query'));
        await waitFor(() => {
            expect(screen.getByTestId('provider-model-query-prompt')).toBeDefined();
        });

        fireEvent.change(screen.getByTestId('provider-model-query-prompt'), { target: { value: 'test' } });
        fireEvent.click(screen.getByTestId('provider-model-query-run'));

        await waitFor(() => {
            expect(screen.getByTestId('provider-model-query-error')).toBeDefined();
        });
    });

    it('sorts enabled models before disabled models', async () => {
        mocks.agentProviders.listModels.mockResolvedValue({
            provider: 'copilot',
            models: [
                { id: 'disabled-first', name: 'Alpha Model', enabled: false },
                { id: 'enabled-second', name: 'Beta Model', enabled: true },
                { id: 'disabled-third', name: 'Gamma Model', enabled: false },
            ],
        });
        render(
            <ProviderModelsSection provider="copilot" available={true} />
        );
        await waitFor(() => {
            expect(screen.getByTestId('provider-models-section')).toBeDefined();
        });

        const rows = screen.getAllByTestId('provider-model-card');
        expect(rows).toHaveLength(3);
        const names = rows.map(r => r.querySelector('[data-testid^="model-copy-"]')?.textContent);
        expect(names[0]).toBe('Beta Model');
    });

    it('calls provider-scoped API — not the old global models API', async () => {
        mocks.agentProviders.listModels.mockResolvedValue({
            provider: 'copilot',
            models: SAMPLE_MODELS,
        });
        render(
            <ProviderModelsSection provider="copilot" available={true} />
        );
        await waitFor(() => {
            expect(screen.getByTestId('provider-models-section')).toBeDefined();
        });

        expect(mocks.agentProviders.listModels).toHaveBeenCalledWith('copilot');
        expect(mocks.agentProviders.getReasoningEfforts).toHaveBeenCalledWith('copilot');
    });

    it('renders provider tabs when allProviders is passed', async () => {
        mocks.agentProviders.listModels.mockResolvedValue({
            provider: 'copilot',
            models: SAMPLE_MODELS,
        });
        const onProviderChange = vi.fn();
        render(
            <ProviderModelsSection
                provider="copilot"
                available={true}
                allProviders={['copilot', 'codex', 'claude']}
                onProviderChange={onProviderChange}
            />
        );
        await waitFor(() => {
            expect(screen.getByTestId('provider-models-section')).toBeDefined();
        });

        expect(screen.getByTestId('provider-tab-copilot')).toBeDefined();
        expect(screen.getByTestId('provider-tab-codex')).toBeDefined();
        expect(screen.getByTestId('provider-tab-claude')).toBeDefined();

        const activeTab = screen.getByTestId('provider-tab-copilot');
        expect(activeTab.getAttribute('aria-selected')).toBe('true');
    });

    it('calls onProviderChange when a provider tab is clicked', async () => {
        mocks.agentProviders.listModels.mockResolvedValue({
            provider: 'copilot',
            models: SAMPLE_MODELS,
        });
        const onProviderChange = vi.fn();
        render(
            <ProviderModelsSection
                provider="copilot"
                available={true}
                allProviders={['copilot', 'codex', 'claude']}
                onProviderChange={onProviderChange}
            />
        );
        await waitFor(() => {
            expect(screen.getByTestId('provider-models-section')).toBeDefined();
        });

        fireEvent.click(screen.getByTestId('provider-tab-codex'));
        expect(onProviderChange).toHaveBeenCalledWith('codex');
    });

    it('does not render provider tabs when allProviders is not passed', async () => {
        mocks.agentProviders.listModels.mockResolvedValue({
            provider: 'copilot',
            models: SAMPLE_MODELS,
        });
        render(
            <ProviderModelsSection provider="copilot" available={true} />
        );
        await waitFor(() => {
            expect(screen.getByTestId('provider-models-section')).toBeDefined();
        });

        expect(screen.queryByTestId('provider-tab-copilot')).toBeNull();
    });
});
