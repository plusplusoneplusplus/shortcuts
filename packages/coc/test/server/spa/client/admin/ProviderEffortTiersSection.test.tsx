/**
 * @vitest-environment jsdom
 *
 * Tests for the ProviderEffortTiersSection component.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockGetEffortTiers = vi.fn();
const mockReplaceEffortTiers = vi.fn();
const mockListModels = vi.fn();

vi.mock('../../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        agentProviders: {
            getEffortTiers: mockGetEffortTiers,
            replaceEffortTiers: mockReplaceEffortTiers,
            listModels: mockListModels,
        },
    }),
    getSpaCocClientErrorMessage: (err: unknown, fallback: string) =>
        err instanceof Error ? err.message : fallback,
}));

vi.mock('../../../../../src/server/spa/client/react/ui', () => ({
    Spinner: () => <span data-testid="spinner" />,
}));

import { ProviderEffortTiersSection } from '../../../../../src/server/spa/client/react/features/models/ProviderEffortTiersSection';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeEffortTiersResponse(tiers: Record<string, unknown> = {}, defaults: Record<string, unknown> = {}) {
    return { provider: 'copilot', effortTiers: tiers, defaults };
}

function makeModelsResponse(models: Array<{ id: string; name?: string; enabled?: boolean; supportedReasoningEfforts?: string[] }> = []) {
    return {
        provider: 'copilot',
        models: models.map(m => ({
            id: m.id,
            name: m.name ?? m.id,
            enabled: m.enabled ?? true,
            capabilities: {
                supports: {
                    vision: false,
                    reasoningEffort: (m.supportedReasoningEfforts?.length ?? 0) > 0,
                },
                limits: { max_context_window_tokens: 128_000 },
            },
            supportedReasoningEfforts: m.supportedReasoningEfforts ?? [],
        })),
    };
}

const SAMPLE_MODELS = [
    { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini', enabled: true, supportedReasoningEfforts: ['low', 'medium', 'high'] },
    { id: 'fast-model', name: 'Fast Model', enabled: true },
    { id: 'mid-model', name: 'Mid Model', enabled: true, supportedReasoningEfforts: ['low', 'medium', 'high'] },
    { id: 'opus-model', name: 'Opus Model', enabled: true, supportedReasoningEfforts: ['medium', 'high'] },
];

// ── Tests ────────────────────────────────────────────────────────────────────

describe('ProviderEffortTiersSection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetEffortTiers.mockResolvedValue(makeEffortTiersResponse({}));
        mockListModels.mockResolvedValue(makeModelsResponse(SAMPLE_MODELS));
    });

    afterEach(() => {
        cleanup();
    });

    it('renders four tier rows with Very Low first', async () => {
        render(<ProviderEffortTiersSection provider="copilot" />);

        await waitFor(() => {
            expect(screen.getByTestId('effort-tiers-table')).toBeTruthy();
        });

        expect(screen.getByTestId('effort-tier-row-very-low')).toBeTruthy();
        expect(screen.getByTestId('effort-tier-row-low')).toBeTruthy();
        expect(screen.getByTestId('effort-tier-row-medium')).toBeTruthy();
        expect(screen.getByTestId('effort-tier-row-high')).toBeTruthy();

        expect(screen.getByTestId('effort-tier-name-very-low').textContent).toBe('Very Low');
        expect(screen.getByTestId('effort-tier-name-low').textContent).toBe('Low');
        expect(screen.getByTestId('effort-tier-name-medium').textContent).toBe('Medium');
        expect(screen.getByTestId('effort-tier-name-high').textContent).toBe('High');

        const rowIds = Array.from(screen.getByTestId('effort-tiers-table').querySelectorAll('tbody tr'))
            .map(row => row.getAttribute('data-testid'));
        expect(rowIds).toEqual([
            'effort-tier-row-very-low',
            'effort-tier-row-low',
            'effort-tier-row-medium',
            'effort-tier-row-high',
        ]);
    });

    it('model dropdown lists all provider models', async () => {
        render(<ProviderEffortTiersSection provider="copilot" />);

        await waitFor(() => {
            expect(screen.getByTestId('effort-tiers-table')).toBeTruthy();
        });

        const modelSelect = screen.getByTestId('effort-tier-model-select-low') as HTMLSelectElement;
        const optionValues = Array.from(modelSelect.options).map(o => o.value);

        expect(optionValues).toContain('fast-model');
        expect(optionValues).toContain('mid-model');
        expect(optionValues).toContain('opus-model');
        expect(optionValues).toContain('');  // "Not set" option
    });

    it('effort dropdown shows model reasoning options after selecting a model', async () => {
        render(<ProviderEffortTiersSection provider="copilot" />);

        await waitFor(() => {
            expect(screen.getByTestId('effort-tiers-table')).toBeTruthy();
        });

        const modelSelect = screen.getByTestId('effort-tier-model-select-medium') as HTMLSelectElement;
        fireEvent.change(modelSelect, { target: { value: 'mid-model' } });

        await waitFor(() => {
            const effortSelect = screen.getByTestId('effort-tier-effort-select-medium') as HTMLSelectElement;
            const opts = Array.from(effortSelect.options).map(o => o.value);
            expect(opts).toContain('low');
            expect(opts).toContain('medium');
            expect(opts).toContain('high');
            expect(opts).toContain('');  // "Auto"
        });
    });

    it('effort dropdown is disabled when model has no reasoning support', async () => {
        render(<ProviderEffortTiersSection provider="copilot" />);

        await waitFor(() => {
            expect(screen.getByTestId('effort-tiers-table')).toBeTruthy();
        });

        const modelSelect = screen.getByTestId('effort-tier-model-select-low') as HTMLSelectElement;
        fireEvent.change(modelSelect, { target: { value: 'fast-model' } });

        await waitFor(() => {
            const effortSelect = screen.getByTestId('effort-tier-effort-select-low') as HTMLSelectElement;
            expect(effortSelect.disabled).toBe(true);
        });
    });

    it('effort dropdown is disabled when no model is selected', async () => {
        render(<ProviderEffortTiersSection provider="copilot" />);

        await waitFor(() => {
            expect(screen.getByTestId('effort-tiers-table')).toBeTruthy();
        });

        const effortSelect = screen.getByTestId('effort-tier-effort-select-low') as HTMLSelectElement;
        expect(effortSelect.disabled).toBe(true);
    });

    it('shows dirty state when a tier is changed', async () => {
        render(<ProviderEffortTiersSection provider="copilot" />);

        await waitFor(() => {
            expect(screen.getByTestId('effort-tiers-table')).toBeTruthy();
        });

        // No unsaved-changes marker initially
        expect(screen.queryByText('Unsaved changes')).toBeNull();

        const modelSelect = screen.getByTestId('effort-tier-model-select-medium');
        fireEvent.change(modelSelect, { target: { value: 'mid-model' } });

        await waitFor(() => {
            expect(screen.getByText('Unsaved changes')).toBeTruthy();
        });
    });

    it('save button calls replaceEffortTiers with correct payload', async () => {
        mockReplaceEffortTiers.mockResolvedValue(makeEffortTiersResponse({
            medium: { model: 'mid-model', reasoningEffort: 'medium' },
        }));

        render(<ProviderEffortTiersSection provider="copilot" />);

        await waitFor(() => {
            expect(screen.getByTestId('effort-tiers-table')).toBeTruthy();
        });

        // Select model for medium
        fireEvent.change(screen.getByTestId('effort-tier-model-select-medium'), { target: { value: 'mid-model' } });

        // Select reasoning effort
        await waitFor(() => {
            const effortSelect = screen.getByTestId('effort-tier-effort-select-medium') as HTMLSelectElement;
            expect(effortSelect.disabled).toBe(false);
        });

        fireEvent.change(screen.getByTestId('effort-tier-effort-select-medium'), { target: { value: 'medium' } });

        // Click save
        const saveBtn = screen.getByTestId('effort-tiers-save');
        fireEvent.click(saveBtn);

        await waitFor(() => {
            expect(mockReplaceEffortTiers).toHaveBeenCalledWith('copilot', {
                medium: { model: 'mid-model', reasoningEffort: 'medium' },
            });
        });

        // After save, no longer dirty
        await waitFor(() => {
            expect(screen.queryByText('Unsaved changes')).toBeNull();
        });
    });

    it('saves an edited very-low tier without persisting unchanged defaults', async () => {
        mockGetEffortTiers.mockResolvedValue(makeEffortTiersResponse(
            {
                'very-low': { model: 'gpt-5.4-mini', reasoningEffort: 'low', source: 'default' },
                low: { model: 'fast-model', reasoningEffort: null, source: 'default' },
            },
            {
                'very-low': { model: 'gpt-5.4-mini', reasoningEffort: 'low' },
                low: { model: 'fast-model', reasoningEffort: null },
            },
        ));
        mockReplaceEffortTiers.mockResolvedValue(makeEffortTiersResponse(
            {
                'very-low': { model: 'mid-model', reasoningEffort: 'medium', source: 'config' },
                low: { model: 'fast-model', reasoningEffort: null, source: 'default' },
            },
            {
                'very-low': { model: 'gpt-5.4-mini', reasoningEffort: 'low' },
                low: { model: 'fast-model', reasoningEffort: null },
            },
        ));

        render(<ProviderEffortTiersSection provider="copilot" />);

        await waitFor(() => {
            const modelSelect = screen.getByTestId('effort-tier-model-select-very-low') as HTMLSelectElement;
            expect(modelSelect.value).toBe('gpt-5.4-mini');
        });

        fireEvent.change(screen.getByTestId('effort-tier-model-select-very-low'), { target: { value: 'mid-model' } });

        await waitFor(() => {
            const effortSelect = screen.getByTestId('effort-tier-effort-select-very-low') as HTMLSelectElement;
            expect(effortSelect.disabled).toBe(false);
        });

        fireEvent.change(screen.getByTestId('effort-tier-effort-select-very-low'), { target: { value: 'medium' } });
        fireEvent.click(screen.getByTestId('effort-tiers-save'));

        await waitFor(() => {
            expect(mockReplaceEffortTiers).toHaveBeenCalledWith('copilot', {
                'very-low': { model: 'mid-model', reasoningEffort: 'medium' },
            });
        });
    });

    it('cancel button reverts local changes', async () => {
        render(<ProviderEffortTiersSection provider="copilot" />);

        await waitFor(() => {
            expect(screen.getByTestId('effort-tiers-table')).toBeTruthy();
        });

        fireEvent.change(screen.getByTestId('effort-tier-model-select-high'), { target: { value: 'opus-model' } });

        await waitFor(() => {
            expect(screen.getByText('Unsaved changes')).toBeTruthy();
        });

        fireEvent.click(screen.getByTestId('effort-tiers-cancel'));

        await waitFor(() => {
            expect(screen.queryByText('Unsaved changes')).toBeNull();
        });

        const modelSelect = screen.getByTestId('effort-tier-model-select-high') as HTMLSelectElement;
        expect(modelSelect.value).toBe('');
    });

    it('shows save error banner on failure', async () => {
        mockReplaceEffortTiers.mockRejectedValue(new Error('server error'));

        render(<ProviderEffortTiersSection provider="copilot" />);

        await waitFor(() => {
            expect(screen.getByTestId('effort-tiers-table')).toBeTruthy();
        });

        fireEvent.change(screen.getByTestId('effort-tier-model-select-low'), { target: { value: 'fast-model' } });

        fireEvent.click(screen.getByTestId('effort-tiers-save'));

        await waitFor(() => {
            expect(screen.getByTestId('effort-tiers-save-error')).toBeTruthy();
        });
    });

    it('clear button removes the tier entry when no default is provided', async () => {
        mockGetEffortTiers.mockResolvedValue(makeEffortTiersResponse({
            low: { model: 'fast-model', reasoningEffort: null, source: 'config' },
        }));

        render(<ProviderEffortTiersSection provider="copilot" />);

        await waitFor(() => {
            const modelSelect = screen.getByTestId('effort-tier-model-select-low') as HTMLSelectElement;
            expect(modelSelect.value).toBe('fast-model');
        });

        expect(screen.getByTestId('effort-tier-clear-low')).toBeTruthy();
        fireEvent.click(screen.getByTestId('effort-tier-clear-low'));

        await waitFor(() => {
            const modelSelect = screen.getByTestId('effort-tier-model-select-low') as HTMLSelectElement;
            expect(modelSelect.value).toBe('');
        });

        expect(screen.getByText('Unsaved changes')).toBeTruthy();
    });

    it('shows Very Low prefilled from provider defaults with a Default badge and no Clear button', async () => {
        // GET returns a default entry the admin has not overridden.
        mockGetEffortTiers.mockResolvedValue({
            provider: 'copilot',
            effortTiers: {
                'very-low': { model: 'gpt-5.4-mini', reasoningEffort: 'low', source: 'default' },
            },
            defaults: {
                'very-low': { model: 'gpt-5.4-mini', reasoningEffort: 'low' },
            },
        });

        render(<ProviderEffortTiersSection provider="copilot" />);

        await waitFor(() => {
            expect(screen.getByTestId('effort-tier-default-badge-very-low')).toBeTruthy();
        });

        const modelSelect = screen.getByTestId('effort-tier-model-select-very-low') as HTMLSelectElement;
        const effortSelect = screen.getByTestId('effort-tier-effort-select-very-low') as HTMLSelectElement;
        expect(modelSelect.value).toBe('gpt-5.4-mini');
        expect(effortSelect.value).toBe('low');
        expect(screen.queryByTestId('effort-tier-clear-very-low')).toBeNull();
    });

    it('Clear on an overridden very-low row reverts to the default', async () => {
        mockGetEffortTiers.mockResolvedValue({
            provider: 'copilot',
            effortTiers: {
                'very-low': { model: 'mid-model', reasoningEffort: 'medium', source: 'config' },
            },
            defaults: {
                'very-low': { model: 'gpt-5.4-mini', reasoningEffort: 'low' },
            },
        });

        render(<ProviderEffortTiersSection provider="copilot" />);

        await waitFor(() => {
            const modelSelect = screen.getByTestId('effort-tier-model-select-very-low') as HTMLSelectElement;
            expect(modelSelect.value).toBe('mid-model');
        });

        // The row is an explicit override → Clear button is visible, no Default badge.
        expect(screen.queryByTestId('effort-tier-default-badge-very-low')).toBeNull();
        expect(screen.getByTestId('effort-tier-clear-very-low')).toBeTruthy();

        fireEvent.click(screen.getByTestId('effort-tier-clear-very-low'));

        await waitFor(() => {
            const modelSelect = screen.getByTestId('effort-tier-model-select-very-low') as HTMLSelectElement;
            // Reverted to default model (not emptied).
            expect(modelSelect.value).toBe('gpt-5.4-mini');
        });

        // After revert, the row now shows as default → Default badge appears, Clear hidden.
        expect(screen.getByTestId('effort-tier-default-badge-very-low')).toBeTruthy();
        expect(screen.queryByTestId('effort-tier-clear-very-low')).toBeNull();
        // The change is dirty because it differs from the stored remote baseline.
        expect(screen.getByText('Unsaved changes')).toBeTruthy();
    });

    it('renders loaded tiers from server', async () => {
        mockGetEffortTiers.mockResolvedValue(makeEffortTiersResponse({
            low: { model: 'fast-model', reasoningEffort: null },
            high: { model: 'opus-model', reasoningEffort: 'high' },
        }));

        render(<ProviderEffortTiersSection provider="copilot" />);

        await waitFor(() => {
            const lowSelect = screen.getByTestId('effort-tier-model-select-low') as HTMLSelectElement;
            expect(lowSelect.value).toBe('fast-model');
        });

        const highSelect = screen.getByTestId('effort-tier-model-select-high') as HTMLSelectElement;
        expect(highSelect.value).toBe('opus-model');

        const highEffortSelect = screen.getByTestId('effort-tier-effort-select-high') as HTMLSelectElement;
        expect(highEffortSelect.value).toBe('high');
    });

    it('shows loading state initially', () => {
        mockGetEffortTiers.mockReturnValue(new Promise(() => { /* never resolves */ }));
        mockListModels.mockReturnValue(new Promise(() => { /* never resolves */ }));

        render(<ProviderEffortTiersSection provider="copilot" />);

        expect(screen.getByTestId('provider-effort-tiers-loading')).toBeTruthy();
    });

    it('shows error state and retry button on fetch failure', async () => {
        mockGetEffortTiers.mockRejectedValue(new Error('fetch failed'));

        render(<ProviderEffortTiersSection provider="copilot" />);

        await waitFor(() => {
            expect(screen.getByTestId('provider-effort-tiers-error')).toBeTruthy();
        });

        expect(screen.getByTestId('provider-effort-tiers-retry')).toBeTruthy();
    });
});
