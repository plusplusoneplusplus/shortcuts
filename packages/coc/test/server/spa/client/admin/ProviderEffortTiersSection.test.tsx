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

function makeEffortTiersResponse(tiers: Record<string, unknown> = {}) {
    return { provider: 'copilot', effortTiers: tiers };
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

    it('renders three tier rows (Low / Medium / High)', async () => {
        render(<ProviderEffortTiersSection provider="copilot" />);

        await waitFor(() => {
            expect(screen.getByTestId('effort-tiers-table')).toBeTruthy();
        });

        expect(screen.getByTestId('effort-tier-row-low')).toBeTruthy();
        expect(screen.getByTestId('effort-tier-row-medium')).toBeTruthy();
        expect(screen.getByTestId('effort-tier-row-high')).toBeTruthy();

        expect(screen.getByTestId('effort-tier-name-low').textContent).toBe('Low');
        expect(screen.getByTestId('effort-tier-name-medium').textContent).toBe('Medium');
        expect(screen.getByTestId('effort-tier-name-high').textContent).toBe('High');
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

    it('shows Default badge on default-source rows and hides the Clear button', async () => {
        // GET returns a default entry the admin has not overridden.
        mockGetEffortTiers.mockResolvedValue({
            provider: 'copilot',
            effortTiers: {
                low: { model: 'fast-model', reasoningEffort: 'high', source: 'default' },
            },
            defaults: {
                low: { model: 'fast-model', reasoningEffort: 'high' },
            },
        });

        render(<ProviderEffortTiersSection provider="copilot" />);

        await waitFor(() => {
            expect(screen.getByTestId('effort-tier-default-badge-low')).toBeTruthy();
        });

        // No Clear button on a row that is already showing a default.
        expect(screen.queryByTestId('effort-tier-clear-low')).toBeNull();
    });

    it('Clear on an overridden row reverts to the default (and removes Default badge briefly until source flips)', async () => {
        mockGetEffortTiers.mockResolvedValue({
            provider: 'copilot',
            effortTiers: {
                low: { model: 'mid-model', reasoningEffort: 'medium', source: 'config' },
            },
            defaults: {
                low: { model: 'fast-model', reasoningEffort: 'high' },
            },
        });

        render(<ProviderEffortTiersSection provider="copilot" />);

        await waitFor(() => {
            const modelSelect = screen.getByTestId('effort-tier-model-select-low') as HTMLSelectElement;
            expect(modelSelect.value).toBe('mid-model');
        });

        // The row is an explicit override → Clear button is visible, no Default badge.
        expect(screen.queryByTestId('effort-tier-default-badge-low')).toBeNull();
        expect(screen.getByTestId('effort-tier-clear-low')).toBeTruthy();

        fireEvent.click(screen.getByTestId('effort-tier-clear-low'));

        await waitFor(() => {
            const modelSelect = screen.getByTestId('effort-tier-model-select-low') as HTMLSelectElement;
            // Reverted to default model (not emptied).
            expect(modelSelect.value).toBe('fast-model');
        });

        // After revert, the row now shows as default → Default badge appears, Clear hidden.
        expect(screen.getByTestId('effort-tier-default-badge-low')).toBeTruthy();
        expect(screen.queryByTestId('effort-tier-clear-low')).toBeNull();
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
