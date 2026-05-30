/**
 * Tests for useProviderReasoningEfforts hook.
 *
 * Verifies that the hook fetches the per-provider, per-model reasoning-effort
 * preference map and exposes it as a Record<string, string>.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useProviderReasoningEfforts } from '../../../../src/server/spa/client/react/hooks/useProviderReasoningEfforts';

const mocks = vi.hoisted(() => ({
    agentProviders: {
        getReasoningEfforts: vi.fn(),
    },
}));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../../src/server/spa/client/react/api/cocClient')>();
    return {
        ...actual,
        getSpaCocClient: () => ({ agentProviders: mocks.agentProviders }),
    };
});

describe('useProviderReasoningEfforts', () => {
    beforeEach(() => { mocks.agentProviders.getReasoningEfforts.mockReset(); });
    afterEach(() => { vi.clearAllMocks(); });

    it('returns empty map on initial render (before fetch resolves)', () => {
        mocks.agentProviders.getReasoningEfforts.mockReturnValue(new Promise(() => {}));
        const { result } = renderHook(() => useProviderReasoningEfforts('copilot'));
        expect(result.current).toEqual({});
    });

    it('returns reasoning efforts map after fetch resolves', async () => {
        mocks.agentProviders.getReasoningEfforts.mockResolvedValue({
            reasoningEfforts: { 'model-x': 'high', 'model-y': 'medium' },
        });
        const { result } = renderHook(() => useProviderReasoningEfforts('copilot'));
        await waitFor(() => expect(result.current).toEqual({ 'model-x': 'high', 'model-y': 'medium' }));
    });

    it('calls the API with the provider argument', async () => {
        mocks.agentProviders.getReasoningEfforts.mockResolvedValue({ reasoningEfforts: {} });
        renderHook(() => useProviderReasoningEfforts('codex'));
        await waitFor(() => expect(mocks.agentProviders.getReasoningEfforts).toHaveBeenCalledWith('codex'));
    });

    it('re-fetches when provider changes', async () => {
        mocks.agentProviders.getReasoningEfforts.mockResolvedValue({ reasoningEfforts: {} });
        const { rerender } = renderHook(
            ({ provider }) => useProviderReasoningEfforts(provider),
            { initialProps: { provider: 'copilot' as const } },
        );
        await waitFor(() => expect(mocks.agentProviders.getReasoningEfforts).toHaveBeenCalledWith('copilot'));
        rerender({ provider: 'claude' as const });
        await waitFor(() => expect(mocks.agentProviders.getReasoningEfforts).toHaveBeenCalledWith('claude'));
    });

    it('returns empty map if API throws', async () => {
        mocks.agentProviders.getReasoningEfforts.mockRejectedValue(new Error('Network error'));
        const { result } = renderHook(() => useProviderReasoningEfforts('copilot'));
        // Wait a tick for the promise to reject
        await new Promise(r => setTimeout(r, 10));
        expect(result.current).toEqual({});
    });

    it('ignores response if provider changes before fetch resolves (cancellation)', async () => {
        let resolveFirst!: (v: any) => void;
        const firstFetch = new Promise(r => { resolveFirst = r; });
        mocks.agentProviders.getReasoningEfforts
            .mockReturnValueOnce(firstFetch)
            .mockResolvedValueOnce({ reasoningEfforts: { 'model-b': 'low' } });

        const { result, rerender } = renderHook(
            ({ provider }) => useProviderReasoningEfforts(provider),
            { initialProps: { provider: 'copilot' as const } },
        );

        // Switch provider before first fetch resolves
        rerender({ provider: 'codex' as const });
        await waitFor(() => expect(result.current).toEqual({ 'model-b': 'low' }));

        // Now resolve the stale first fetch with different data
        resolveFirst({ reasoningEfforts: { 'model-a': 'high' } });
        await new Promise(r => setTimeout(r, 20));
        // The cancelled response should NOT update state
        expect(result.current).toEqual({ 'model-b': 'low' });
    });

    it('returns empty map when API returns null reasoningEfforts', async () => {
        mocks.agentProviders.getReasoningEfforts.mockResolvedValue({ reasoningEfforts: null });
        const { result } = renderHook(() => useProviderReasoningEfforts('copilot'));
        await new Promise(r => setTimeout(r, 10));
        expect(result.current).toEqual({});
    });
});
