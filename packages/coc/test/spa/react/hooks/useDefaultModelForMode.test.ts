/**
 * Tests for useDefaultModelForMode hook.
 * Verifies that the hook resolves the effective default model from repo preferences
 * using provider-scoped cascade: providerModels[mode] → legacy defaultModels[mode] (Copilot) → legacy defaultModel (Copilot) → undefined.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

// ── Hoisted mocks ──────────────────────────────────────────────────────────
const { mockGetRepo, mockGetActiveProvider } = vi.hoisted(() => ({
    mockGetRepo: vi.fn(),
    mockGetActiveProvider: vi.fn(() => 'copilot'),
}));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        preferences: { getRepo: mockGetRepo },
    }),
}));

vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    getActiveProvider: mockGetActiveProvider,
}));

import { useDefaultModelForMode } from '../../../../src/server/spa/client/react/hooks/useDefaultModelForMode';

const MODELS = [
    { id: 'claude-sonnet-4.6', name: 'Claude Sonnet 4.6' },
    { id: 'claude-opus-4.7', name: 'Claude Opus 4.7' },
    { id: 'gpt-5.5', name: 'GPT-5.5' },
];

beforeEach(() => {
    vi.clearAllMocks();
    mockGetRepo.mockResolvedValue({});
    mockGetActiveProvider.mockReturnValue('copilot');
});

describe('useDefaultModelForMode', () => {
    it('returns undefined when no preferences are set', async () => {
        mockGetRepo.mockResolvedValue({});
        const { result } = renderHook(() =>
            useDefaultModelForMode('ws-1', 'ask', MODELS),
        );
        await waitFor(() => {
            expect(mockGetRepo).toHaveBeenCalledWith('ws-1');
        });
        expect(result.current.effectiveModel).toBeUndefined();
        expect(result.current.effectiveModelName).toBeUndefined();
    });

    it('returns repo-wide defaultModel when no per-mode override is set (Copilot)', async () => {
        mockGetRepo.mockResolvedValue({ defaultModel: 'claude-sonnet-4.6' });
        const { result } = renderHook(() =>
            useDefaultModelForMode('ws-1', 'ask', MODELS),
        );
        await waitFor(() => {
            expect(result.current.effectiveModel).toBe('claude-sonnet-4.6');
        });
        expect(result.current.effectiveModelName).toBe('Claude Sonnet 4.6');
    });

    it('returns per-mode default when set, overriding repo-wide default', async () => {
        mockGetRepo.mockResolvedValue({
            defaultModel: 'claude-sonnet-4.6',
            defaultModels: { ask: 'claude-opus-4.7' },
        });
        const { result } = renderHook(() =>
            useDefaultModelForMode('ws-1', 'ask', MODELS),
        );
        await waitFor(() => {
            expect(result.current.effectiveModel).toBe('claude-opus-4.7');
        });
        expect(result.current.effectiveModelName).toBe('Claude Opus 4.7');
    });

    it('falls back to repo-wide default for modes with no per-mode override', async () => {
        mockGetRepo.mockResolvedValue({
            defaultModel: 'gpt-5.5',
            defaultModels: { ask: 'claude-opus-4.7' },
        });
        const { result } = renderHook(() =>
            useDefaultModelForMode('ws-1', 'autopilot', MODELS),
        );
        await waitFor(() => {
            expect(result.current.effectiveModel).toBe('gpt-5.5');
        });
        expect(result.current.effectiveModelName).toBe('GPT-5.5');
    });

    it('maps autopilot mode to the task preference key', async () => {
        mockGetRepo.mockResolvedValue({
            defaultModels: { task: 'claude-opus-4.7' },
        });
        const { result } = renderHook(() =>
            useDefaultModelForMode('ws-1', 'autopilot', MODELS),
        );
        await waitFor(() => {
            expect(result.current.effectiveModel).toBe('claude-opus-4.7');
        });
        expect(result.current.effectiveModelName).toBe('Claude Opus 4.7');
    });

    it('maps ralph mode to the task preference key', async () => {
        mockGetRepo.mockResolvedValue({
            defaultModels: { task: 'gpt-5.5' },
        });
        const { result } = renderHook(() =>
            useDefaultModelForMode('ws-1', 'ralph', MODELS),
        );
        await waitFor(() => {
            expect(result.current.effectiveModel).toBe('gpt-5.5');
        });
        expect(result.current.effectiveModelName).toBe('GPT-5.5');
    });

    it('returns model ID as display name when model is not in available list', async () => {
        mockGetRepo.mockResolvedValue({ defaultModel: 'unknown-model-x' });
        const { result } = renderHook(() =>
            useDefaultModelForMode('ws-1', 'ask', MODELS),
        );
        await waitFor(() => {
            expect(result.current.effectiveModel).toBe('unknown-model-x');
        });
        expect(result.current.effectiveModelName).toBe('unknown-model-x');
    });

    it('returns undefined when workspaceId is undefined', () => {
        const { result } = renderHook(() =>
            useDefaultModelForMode(undefined, 'ask', MODELS),
        );
        expect(result.current.effectiveModel).toBeUndefined();
        expect(result.current.effectiveModelName).toBeUndefined();
        expect(mockGetRepo).not.toHaveBeenCalled();
    });

    it('re-fetches when workspaceId changes', async () => {
        mockGetRepo.mockResolvedValue({ defaultModel: 'claude-sonnet-4.6' });
        const { result, rerender } = renderHook(
            ({ wsId }) => useDefaultModelForMode(wsId, 'ask', MODELS),
            { initialProps: { wsId: 'ws-1' as string | undefined } },
        );
        await waitFor(() => {
            expect(result.current.effectiveModel).toBe('claude-sonnet-4.6');
        });

        mockGetRepo.mockResolvedValue({ defaultModel: 'gpt-5.5' });
        rerender({ wsId: 'ws-2' });
        await waitFor(() => {
            expect(result.current.effectiveModel).toBe('gpt-5.5');
        });
        expect(mockGetRepo).toHaveBeenCalledWith('ws-2');
    });

    it('updates effective model when chatMode changes', async () => {
        mockGetRepo.mockResolvedValue({
            defaultModel: 'claude-sonnet-4.6',
            defaultModels: { task: 'claude-opus-4.7' },
        });
        const { result, rerender } = renderHook(
            ({ mode }) => useDefaultModelForMode('ws-1', mode as any, MODELS),
            { initialProps: { mode: 'ask' } },
        );
        await waitFor(() => {
            expect(result.current.effectiveModel).toBe('claude-sonnet-4.6');
        });

        rerender({ mode: 'autopilot' });
        expect(result.current.effectiveModel).toBe('claude-opus-4.7');
        expect(result.current.effectiveModelName).toBe('Claude Opus 4.7');
    });

    it('ignores preferences fetch errors gracefully', async () => {
        mockGetRepo.mockRejectedValue(new Error('Network error'));
        const { result } = renderHook(() =>
            useDefaultModelForMode('ws-1', 'ask', MODELS),
        );
        await waitFor(() => {
            expect(mockGetRepo).toHaveBeenCalled();
        });
        expect(result.current.effectiveModel).toBeUndefined();
        expect(result.current.effectiveModelName).toBeUndefined();
    });

    it('ignores empty string defaultModel from preferences', async () => {
        mockGetRepo.mockResolvedValue({ defaultModel: '' });
        const { result } = renderHook(() =>
            useDefaultModelForMode('ws-1', 'ask', MODELS),
        );
        await waitFor(() => {
            expect(mockGetRepo).toHaveBeenCalled();
        });
        expect(result.current.effectiveModel).toBeUndefined();
    });

    it('ignores empty string in per-mode defaultModels', async () => {
        mockGetRepo.mockResolvedValue({
            defaultModel: 'gpt-5.5',
            defaultModels: { ask: '' },
        });
        const { result } = renderHook(() =>
            useDefaultModelForMode('ws-1', 'ask', MODELS),
        );
        await waitFor(() => {
            expect(result.current.effectiveModel).toBe('gpt-5.5');
        });
    });

    // ── Provider-scoped tests ──────────────────────────────────────────────

    it('uses provider-scoped defaultModelsByProvider when set', async () => {
        mockGetRepo.mockResolvedValue({
            defaultModel: 'gpt-5.5',
            defaultModelsByProvider: {
                copilot: { ask: 'claude-opus-4.7' },
            },
        });
        const { result } = renderHook(() =>
            useDefaultModelForMode('ws-1', 'ask', MODELS),
        );
        await waitFor(() => {
            expect(result.current.effectiveModel).toBe('claude-opus-4.7');
        });
    });

    it('provider-scoped defaults take priority over legacy defaults for Copilot', async () => {
        mockGetRepo.mockResolvedValue({
            defaultModel: 'gpt-5.5',
            defaultModels: { ask: 'claude-sonnet-4.6' },
            defaultModelsByProvider: {
                copilot: { ask: 'claude-opus-4.7' },
            },
        });
        const { result } = renderHook(() =>
            useDefaultModelForMode('ws-1', 'ask', MODELS),
        );
        await waitFor(() => {
            expect(result.current.effectiveModel).toBe('claude-opus-4.7');
        });
    });

    it('non-Copilot providers ignore legacy defaults', async () => {
        mockGetActiveProvider.mockReturnValue('codex');
        mockGetRepo.mockResolvedValue({
            defaultModel: 'gpt-5.5',
            defaultModels: { ask: 'claude-sonnet-4.6' },
        });
        const { result } = renderHook(() =>
            useDefaultModelForMode('ws-1', 'ask', MODELS),
        );
        await waitFor(() => {
            expect(mockGetRepo).toHaveBeenCalled();
        });
        // Codex has no provider-scoped defaults and legacy is Copilot-only
        expect(result.current.effectiveModel).toBeUndefined();
    });

    it('non-Copilot providers use their own provider-scoped defaults', async () => {
        mockGetActiveProvider.mockReturnValue('codex');
        mockGetRepo.mockResolvedValue({
            defaultModel: 'gpt-5.5',
            defaultModelsByProvider: {
                codex: { ask: 'claude-opus-4.7' },
            },
        });
        const { result } = renderHook(() =>
            useDefaultModelForMode('ws-1', 'ask', MODELS),
        );
        await waitFor(() => {
            expect(result.current.effectiveModel).toBe('claude-opus-4.7');
        });
    });

    it('uses the explicit provider argument instead of the active provider', async () => {
        mockGetActiveProvider.mockReturnValue('copilot');
        mockGetRepo.mockResolvedValue({
            defaultModel: 'gpt-5.5',
            defaultModelsByProvider: {
                codex: { ask: 'claude-opus-4.7' },
            },
        });
        const { result } = renderHook(() =>
            useDefaultModelForMode('ws-1', 'ask', MODELS, 'codex'),
        );
        await waitFor(() => {
            expect(result.current.effectiveModel).toBe('claude-opus-4.7');
        });
    });

    it('re-resolves provider defaults when the explicit provider changes', async () => {
        mockGetRepo.mockResolvedValue({
            defaultModelsByProvider: {
                copilot: { ask: 'gpt-5.5' },
                codex: { ask: 'claude-opus-4.7' },
            },
        });
        const { result, rerender } = renderHook(
            ({ provider }) => useDefaultModelForMode('ws-1', 'ask', MODELS, provider),
            { initialProps: { provider: 'copilot' } },
        );
        await waitFor(() => {
            expect(result.current.effectiveModel).toBe('gpt-5.5');
        });

        rerender({ provider: 'codex' });
        await waitFor(() => {
            expect(result.current.effectiveModel).toBe('claude-opus-4.7');
        });
    });

    it('supports a string provider default as an all-mode fallback', async () => {
        mockGetRepo.mockResolvedValue({
            defaultModelsByProvider: {
                codex: 'claude-opus-4.7',
            },
        });
        const { result } = renderHook(() =>
            useDefaultModelForMode('ws-1', 'autopilot', MODELS, 'codex'),
        );
        await waitFor(() => {
            expect(result.current.effectiveModel).toBe('claude-opus-4.7');
        });
    });

    it('Copilot falls back to legacy defaults when no provider-scoped defaults exist', async () => {
        mockGetRepo.mockResolvedValue({
            defaultModel: 'gpt-5.5',
            defaultModels: { ask: 'claude-sonnet-4.6' },
            defaultModelsByProvider: {},
        });
        const { result } = renderHook(() =>
            useDefaultModelForMode('ws-1', 'ask', MODELS),
        );
        await waitFor(() => {
            expect(result.current.effectiveModel).toBe('claude-sonnet-4.6');
        });
    });
});
