/**
 * @vitest-environment jsdom
 *
 * Tests for ModalJobAiControls and its shared modal job AI-selection hook.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { AgentProviderStatus } from '@plusplusoneplusplus/coc-client';

const mocks = vi.hoisted(() => ({
    effortLevelsEnabled: true,
    defaultProvider: 'codex' as 'copilot' | 'codex' | 'claude',
    configuredDefaultProvider: 'codex' as 'copilot' | 'codex' | 'claude' | 'auto',
    autoProviderRoutingEnabled: false,
    listProviders: vi.fn(),
    listModels: vi.fn(),
    getReasoningEfforts: vi.fn(),
    getEffortTiers: vi.fn(),
    getRepo: vi.fn(),
    patchRepo: vi.fn(),
}));

vi.mock('../../../../../src/server/spa/client/react/utils/config', () => ({
    getDefaultProvider: () => mocks.defaultProvider,
    getConfiguredDefaultProvider: () => mocks.configuredDefaultProvider,
    getActiveProvider: () => mocks.defaultProvider,
    isAutoAgentProviderRoutingEnabled: () => mocks.autoProviderRoutingEnabled,
    isEffortLevelsEnabled: () => mocks.effortLevelsEnabled,
}));

vi.mock('../../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        agentProviders: {
            list: mocks.listProviders,
            listModels: mocks.listModels,
            getReasoningEfforts: mocks.getReasoningEfforts,
            getEffortTiers: mocks.getEffortTiers,
        },
        preferences: {
            getRepo: mocks.getRepo,
            patchRepo: mocks.patchRepo,
        },
    }),
    getSpaCocClientErrorMessage: (err: unknown, fallback: string) =>
        err instanceof Error ? err.message : fallback,
}));

import {
    ModalJobAiControls,
    useModalJobAiSelection,
    isSelectableProvider,
    type ResolvedModalJobAiSelection,
} from '../../../../../src/server/spa/client/react/shared/ModalJobAiControls';

const PROVIDERS: AgentProviderStatus[] = [
    { id: 'copilot', label: 'Copilot', enabled: true, available: true, locked: true },
    { id: 'codex', label: 'Codex', enabled: true, available: true },
];

const MODELS = [
    {
        id: 'codex-default',
        name: 'Codex Default',
        enabled: true,
        capabilities: {
            supports: { vision: false, reasoningEffort: true },
            limits: { max_context_window_tokens: 128000 },
        },
        supportedReasoningEfforts: ['low', 'medium', 'high'],
    },
    {
        id: 'codex-other',
        name: 'Codex Other',
        enabled: true,
        capabilities: {
            supports: { vision: false, reasoningEffort: true },
            limits: { max_context_window_tokens: 128000 },
        },
        supportedReasoningEfforts: ['low', 'medium', 'high'],
    },
];

function Harness({ workspaceId = 'ws-1', mode = 'ask' as const }) {
    const selection = useModalJobAiSelection({ workspaceId, mode });
    return (
        <>
            <ModalJobAiControls selection={selection} testIdPrefix="job" />
            <pre data-testid="resolved-selection">{JSON.stringify(selection.resolved)}</pre>
        </>
    );
}

function readResolved(): ResolvedModalJobAiSelection {
    return JSON.parse(screen.getByTestId('resolved-selection').textContent ?? '{}');
}

describe('ModalJobAiControls', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        mocks.effortLevelsEnabled = true;
        mocks.defaultProvider = 'codex';
        mocks.configuredDefaultProvider = 'codex';
        mocks.autoProviderRoutingEnabled = false;
        mocks.listProviders.mockResolvedValue({ providers: PROVIDERS });
        mocks.listModels.mockResolvedValue({ models: MODELS });
        mocks.getReasoningEfforts.mockResolvedValue({ reasoningEfforts: { 'codex-default': 'high' } });
        mocks.getEffortTiers.mockResolvedValue({
            provider: 'codex',
            effortTiers: {
                low: { model: 'tier-low-model', reasoningEffort: 'low', source: 'config' },
                medium: { model: 'tier-medium-model', reasoningEffort: 'high', source: 'config' },
            },
            defaults: {},
        });
        mocks.getRepo.mockResolvedValue({
            lastChatProvider: 'codex',
            defaultModelsByProvider: { codex: { ask: 'codex-default' } },
        });
        mocks.patchRepo.mockResolvedValue({});
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it('renders tier mode instead of legacy model and effort controls when tiers are enabled', async () => {
        render(<Harness />);

        await waitFor(() => {
            expect(screen.getByTestId('job-effort-tier-selector')).toBeTruthy();
            expect(screen.queryByTestId('job-model-picker-chip')).toBeNull();
            expect(screen.queryByTestId('effort-pill-selector')).toBeNull();
            expect(readResolved()).toEqual({
                provider: 'codex',
                model: 'tier-medium-model',
                reasoningEffort: 'high',
            });
        });
    });

    it('falls back to legacy model and reasoning-effort controls when tier mode is disabled', async () => {
        mocks.effortLevelsEnabled = false;

        render(<Harness />);

        await waitFor(() => expect(screen.getByTestId('job-model-picker-chip')).toBeTruthy());

        expect(screen.queryByTestId('job-effort-tier-selector')).toBeNull();
        expect(screen.getByTestId('effort-pill-selector')).toBeTruthy();
        await waitFor(() => expect(readResolved()).toEqual({
            provider: 'codex',
            reasoningEffort: 'high',
        }));
    });

    it('persists provider changes through repo preferences', async () => {
        render(<Harness />);

        await waitFor(() => expect(screen.getByTestId('agent-selector-chip-btn').textContent).toContain('Codex'));
        fireEvent.click(screen.getByTestId('agent-selector-chip-btn'));
        fireEvent.click(screen.getByTestId('agent-option-copilot'));

        expect(mocks.patchRepo).toHaveBeenCalledWith('ws-1', { lastChatProvider: 'copilot' });
        await waitFor(() => expect(readResolved().provider).toBe('copilot'));
    });

    it('restores Auto and resolves to an effort tier without provider or model overrides', async () => {
        mocks.autoProviderRoutingEnabled = true;
        mocks.configuredDefaultProvider = 'auto';
        mocks.defaultProvider = 'copilot';
        mocks.getRepo.mockResolvedValue({ lastChatProvider: 'auto' });

        render(<Harness />);

        await waitFor(() => expect(screen.getByTestId('agent-selector-chip-btn').textContent).toContain('Auto'));
        expect(screen.getByTestId('job-effort-tier-selector')).toBeTruthy();
        expect(screen.queryByTestId('job-model-picker-chip')).toBeNull();
        expect(readResolved()).toEqual({ effortTier: 'medium' });
    });

    it('persists Auto provider changes through repo preferences', async () => {
        mocks.autoProviderRoutingEnabled = true;

        render(<Harness />);

        await waitFor(() => expect(screen.getByTestId('agent-selector-chip-btn').textContent).toContain('Codex'));
        fireEvent.click(screen.getByTestId('agent-selector-chip-btn'));
        fireEvent.click(screen.getByTestId('agent-option-auto'));

        expect(mocks.patchRepo).toHaveBeenCalledWith('ws-1', { lastChatProvider: 'auto' });
        await waitFor(() => expect(readResolved()).toEqual({ effortTier: 'medium' }));
    });

    it('omits model and reasoning-effort overrides when legacy controls resolve to defaults only', async () => {
        mocks.effortLevelsEnabled = false;
        mocks.getRepo.mockResolvedValue({ lastChatProvider: 'codex' });
        mocks.getReasoningEfforts.mockResolvedValue({ reasoningEfforts: {} });

        render(<Harness />);

        await waitFor(() => expect(screen.getByTestId('job-model-picker-chip')).toBeTruthy());
        await waitFor(() => expect(readResolved()).toEqual({ provider: 'codex' }));
    });
});

describe('isSelectableProvider', () => {
    it('always allows Copilot as the safe fallback', () => {
        expect(isSelectableProvider('copilot', [])).toBe(true);
    });

    it('only allows optional providers that are enabled and available', () => {
        expect(isSelectableProvider('codex', [{ id: 'codex', enabled: true, available: true }])).toBe(true);
        expect(isSelectableProvider('codex', [{ id: 'codex', enabled: false, available: true }])).toBe(false);
        expect(isSelectableProvider('codex', [{ id: 'codex', enabled: true, available: false }])).toBe(false);
    });
});
