/**
 * Tests for useModels hook — fetch models from active provider via agentProviders.listModels().
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useModels } from '../../../src/server/spa/client/react/hooks/useModels';

const mocks = vi.hoisted(() => ({
    agentProviders: {
        listModels: vi.fn(),
        setEnabledModels: vi.fn(),
    },
}));

vi.mock('../../../src/server/spa/client/react/api/cocClient', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../src/server/spa/client/react/api/cocClient')>();
    return {
        ...actual,
        getSpaCocClient: () => ({ agentProviders: mocks.agentProviders }),
    };
});

vi.mock('../../../src/server/spa/client/react/utils/config', () => ({
    getActiveProvider: () => 'copilot',
}));

beforeEach(() => {
    vi.restoreAllMocks();
    mocks.agentProviders.listModels.mockReset();
});

afterEach(() => {
    vi.clearAllMocks();
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('useModels', () => {
    it('returns loading=true during fetch', () => {
        // Never resolve to keep it in-flight
        mocks.agentProviders.listModels.mockReturnValueOnce(new Promise(() => {}));
        const { result } = renderHook(() => useModels());
        expect(result.current.loading).toBe(true);
    });

    it('returns loading=false and models after successful fetch', async () => {
        mocks.agentProviders.listModels.mockResolvedValueOnce({ provider: 'copilot', models: [
            { id: 'gpt-4', name: 'GPT-4', capabilities: { supports: { vision: false, reasoningEffort: false }, limits: { max_context_window_tokens: 128_000 } } },
            { id: 'claude-3', name: 'Claude 3', capabilities: { supports: { vision: false, reasoningEffort: false }, limits: { max_context_window_tokens: 200_000 } } },
        ]});
        const { result } = renderHook(() => useModels());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.models).toHaveLength(2);
        expect(result.current.models[0].id).toBe('gpt-4');
        expect(result.current.models[1].id).toBe('claude-3');
    });

    it('fetches models via agentProviders.listModels(activeProvider)', async () => {
        mocks.agentProviders.listModels.mockResolvedValueOnce({ provider: 'copilot', models: [] });
        renderHook(() => useModels());
        await waitFor(() => {
            expect(mocks.agentProviders.listModels).toHaveBeenCalledWith('copilot');
        });
    });

    it('returns empty models array when API returns empty array', async () => {
        mocks.agentProviders.listModels.mockResolvedValueOnce({ provider: 'copilot', models: [] });
        const { result } = renderHook(() => useModels());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.models).toEqual([]);
    });

    it('returns empty models on rejection', async () => {
        mocks.agentProviders.listModels.mockRejectedValueOnce(new Error('HTTP 500'));
        const { result } = renderHook(() => useModels());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.models).toEqual([]);
    });

    it('returns empty models and loading=false when fetch throws', async () => {
        mocks.agentProviders.listModels.mockRejectedValueOnce(new Error('Network error'));
        const { result } = renderHook(() => useModels());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.models).toEqual([]);
    });

    it('maps capabilities to tokenLimit', async () => {
        mocks.agentProviders.listModels.mockResolvedValueOnce({ provider: 'copilot', models: [
            { id: 'gpt-4o', name: 'GPT-4o', capabilities: { supports: { vision: true, reasoningEffort: false }, limits: { max_context_window_tokens: 128_000 } } },
        ]});
        const { result } = renderHook(() => useModels());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.models[0]).toMatchObject({ id: 'gpt-4o', tokenLimit: 128_000, name: 'GPT-4o' });
    });

    it('defaults tokenLimit to 0 when capabilities are missing', async () => {
        mocks.agentProviders.listModels.mockResolvedValueOnce({ provider: 'copilot', models: [
            { id: 'custom-model', name: 'Custom' },
        ]});
        const { result } = renderHook(() => useModels());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.models[0]).toMatchObject({ id: 'custom-model', tokenLimit: 0 });
    });
});
