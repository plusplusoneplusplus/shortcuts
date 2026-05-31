/**
 * @vitest-environment jsdom
 *
 * Unit tests for the useProviderEffortTiers hook.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockGetEffortTiers = vi.fn();
const mockReplaceEffortTiers = vi.fn();

vi.mock('../../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        agentProviders: {
            getEffortTiers: mockGetEffortTiers,
            replaceEffortTiers: mockReplaceEffortTiers,
        },
    }),
    getSpaCocClientErrorMessage: (err: unknown, fallback: string) =>
        err instanceof Error ? err.message : fallback,
}));

import { useProviderEffortTiers } from '../../../../../src/server/spa/client/react/hooks/useProviderEffortTiers';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeEffortTiersResponse(
    tiers: Record<string, unknown> = {},
    defaults: Record<string, unknown> = {},
) {
    return { provider: 'copilot', effortTiers: tiers, defaults };
}

const COPILOT_DEFAULTS = {
    low:    { model: 'claude-sonnet-4.6', reasoningEffort: 'high'  },
    medium: { model: 'claude-opus-4.8',   reasoningEffort: null    },
    high:   { model: 'gpt-5.5',           reasoningEffort: 'xhigh' },
};

const COPILOT_DEFAULT_TIERS = {
    low:    { ...COPILOT_DEFAULTS.low,    source: 'default' },
    medium: { ...COPILOT_DEFAULTS.medium, source: 'default' },
    high:   { ...COPILOT_DEFAULTS.high,   source: 'default' },
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe('useProviderEffortTiers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('loads empty tier map from server when no defaults provided', async () => {
        mockGetEffortTiers.mockResolvedValue(makeEffortTiersResponse({}));

        const { result } = renderHook(() => useProviderEffortTiers('copilot'));

        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.tiers).toEqual({});
        expect(result.current.error).toBeNull();
        expect(result.current.dirty).toBe(false);
    });

    it('loads merged tiers (config + defaults) and stays non-dirty', async () => {
        mockGetEffortTiers.mockResolvedValue(makeEffortTiersResponse(COPILOT_DEFAULT_TIERS, COPILOT_DEFAULTS));

        const { result } = renderHook(() => useProviderEffortTiers('copilot'));

        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.tiers.low?.source).toBe('default');
        expect(result.current.tiers.medium?.source).toBe('default');
        expect(result.current.tiers.high?.source).toBe('default');
        // Untouched defaults must not count as dirty.
        expect(result.current.dirty).toBe(false);
    });

    it('normalizes server response correctly', async () => {
        mockGetEffortTiers.mockResolvedValue(makeEffortTiersResponse({
            low: { model: 'fast-model', reasoningEffort: null, source: 'config' },
            medium: { model: 'mid-model', reasoningEffort: 'medium', source: 'config' },
        }));

        const { result } = renderHook(() => useProviderEffortTiers('copilot'));

        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.tiers.low).toEqual({ model: 'fast-model', reasoningEffort: '', source: 'config' });
        expect(result.current.tiers.medium).toEqual({ model: 'mid-model', reasoningEffort: 'medium', source: 'config' });
        expect(result.current.tiers.high).toBeUndefined();
    });

    it('treats server entries without explicit source as config (backwards-compatible)', async () => {
        mockGetEffortTiers.mockResolvedValue(makeEffortTiersResponse({
            low: { model: 'fast-model', reasoningEffort: null },
        }));

        const { result } = renderHook(() => useProviderEffortTiers('copilot'));

        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.tiers.low?.source).toBe('config');
    });

    it('sets error on fetch failure', async () => {
        mockGetEffortTiers.mockRejectedValue(new Error('network error'));

        const { result } = renderHook(() => useProviderEffortTiers('copilot'));

        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.error).toBe('network error');
    });

    it('setTier marks dirty and updates local state with source=config', async () => {
        mockGetEffortTiers.mockResolvedValue(makeEffortTiersResponse({}));

        const { result } = renderHook(() => useProviderEffortTiers('copilot'));

        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
            result.current.setTier('medium', 'mid-model', 'medium');
        });

        expect(result.current.tiers.medium).toEqual({ model: 'mid-model', reasoningEffort: 'medium', source: 'config' });
        expect(result.current.dirty).toBe(true);
    });

    it('clearTier reverts to default when defaults are available', async () => {
        mockGetEffortTiers.mockResolvedValue(makeEffortTiersResponse(
            { low: { model: 'fast-model', reasoningEffort: null, source: 'config' } },
            COPILOT_DEFAULTS,
        ));

        const { result } = renderHook(() => useProviderEffortTiers('copilot'));

        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.tiers.low).toMatchObject({ model: 'fast-model', source: 'config' });

        act(() => {
            result.current.clearTier('low');
        });

        // Reverted to default, not removed.
        expect(result.current.tiers.low).toEqual({
            model: 'claude-sonnet-4.6',
            reasoningEffort: 'high',
            source: 'default',
        });
        expect(result.current.dirty).toBe(true);
    });

    it('clearTier removes the tier when no default is available', async () => {
        mockGetEffortTiers.mockResolvedValue(makeEffortTiersResponse({
            low: { model: 'fast-model', reasoningEffort: null, source: 'config' },
        }));

        const { result } = renderHook(() => useProviderEffortTiers('copilot'));

        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
            result.current.clearTier('low');
        });

        expect(result.current.tiers.low).toBeUndefined();
        expect(result.current.dirty).toBe(true);
    });

    it('cancel resets local state to server state', async () => {
        mockGetEffortTiers.mockResolvedValue(makeEffortTiersResponse({
            medium: { model: 'mid-model', reasoningEffort: 'medium' },
        }));

        const { result } = renderHook(() => useProviderEffortTiers('copilot'));

        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
            result.current.setTier('low', 'fast-model', '');
        });

        expect(result.current.dirty).toBe(true);

        act(() => {
            result.current.cancel();
        });

        expect(result.current.dirty).toBe(false);
        expect(result.current.tiers.low).toBeUndefined();
        expect(result.current.tiers.medium).toEqual({ model: 'mid-model', reasoningEffort: 'medium', source: 'config' });
    });

    it('save omits unedited defaults from the payload', async () => {
        mockGetEffortTiers.mockResolvedValue(makeEffortTiersResponse(COPILOT_DEFAULT_TIERS, COPILOT_DEFAULTS));
        mockReplaceEffortTiers.mockResolvedValue(makeEffortTiersResponse(COPILOT_DEFAULT_TIERS, COPILOT_DEFAULTS));

        const { result } = renderHook(() => useProviderEffortTiers('copilot'));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.dirty).toBe(false);

        // User edits one default tier explicitly.
        act(() => {
            result.current.setTier('medium', 'my-mid', 'medium');
        });
        expect(result.current.dirty).toBe(true);

        await act(async () => {
            await result.current.save();
        });

        // Only the explicitly-edited tier is persisted; the two untouched defaults
        // must not leak into the payload.
        expect(mockReplaceEffortTiers).toHaveBeenCalledWith('copilot', {
            medium: { model: 'my-mid', reasoningEffort: 'medium' },
        });
    });

    it('save calls replaceEffortTiers and updates remote state', async () => {
        mockGetEffortTiers.mockResolvedValue(makeEffortTiersResponse({}));
        mockReplaceEffortTiers.mockResolvedValue(makeEffortTiersResponse({
            high: { model: 'opus-model', reasoningEffort: 'high' },
        }));

        const { result } = renderHook(() => useProviderEffortTiers('copilot'));

        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
            result.current.setTier('high', 'opus-model', 'high');
        });

        expect(result.current.dirty).toBe(true);

        await act(async () => {
            await result.current.save();
        });

        expect(mockReplaceEffortTiers).toHaveBeenCalledWith('copilot', {
            high: { model: 'opus-model', reasoningEffort: 'high' },
        });
        expect(result.current.dirty).toBe(false);
        expect(result.current.saveError).toBeNull();
    });

    it('save sends null for empty reasoningEffort string', async () => {
        mockGetEffortTiers.mockResolvedValue(makeEffortTiersResponse({}));
        mockReplaceEffortTiers.mockResolvedValue(makeEffortTiersResponse({
            low: { model: 'fast-model', reasoningEffort: null },
        }));

        const { result } = renderHook(() => useProviderEffortTiers('copilot'));

        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
            result.current.setTier('low', 'fast-model', '');
        });

        await act(async () => {
            await result.current.save();
        });

        expect(mockReplaceEffortTiers).toHaveBeenCalledWith('copilot', {
            low: { model: 'fast-model', reasoningEffort: null },
        });
    });

    it('save omits tiers with no model set', async () => {
        mockGetEffortTiers.mockResolvedValue(makeEffortTiersResponse({
            low: { model: 'fast-model', reasoningEffort: null },
        }));
        mockReplaceEffortTiers.mockResolvedValue(makeEffortTiersResponse({
            medium: { model: 'mid-model', reasoningEffort: null },
        }));

        const { result } = renderHook(() => useProviderEffortTiers('copilot'));

        await waitFor(() => expect(result.current.loading).toBe(false));

        // Clear low, add medium
        act(() => {
            result.current.clearTier('low');
            result.current.setTier('medium', 'mid-model', '');
        });

        await act(async () => {
            await result.current.save();
        });

        // low should not appear in the payload since it has no model
        const callArg = mockReplaceEffortTiers.mock.calls[0][1];
        expect(callArg.low).toBeUndefined();
        expect(callArg.medium).toEqual({ model: 'mid-model', reasoningEffort: null });
    });

    it('save sets saveError on failure', async () => {
        mockGetEffortTiers.mockResolvedValue(makeEffortTiersResponse({}));
        mockReplaceEffortTiers.mockRejectedValue(new Error('save failed'));

        const { result } = renderHook(() => useProviderEffortTiers('copilot'));

        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
            result.current.setTier('low', 'fast-model', '');
        });

        await act(async () => {
            await result.current.save();
        });

        expect(result.current.saveError).toBe('save failed');
        expect(result.current.dirty).toBe(true);
    });

    it('cancel clears saveError', async () => {
        mockGetEffortTiers.mockResolvedValue(makeEffortTiersResponse({}));
        mockReplaceEffortTiers.mockRejectedValue(new Error('save failed'));

        const { result } = renderHook(() => useProviderEffortTiers('copilot'));

        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
            result.current.setTier('low', 'fast-model', '');
        });

        await act(async () => {
            await result.current.save();
        });

        expect(result.current.saveError).toBeTruthy();

        act(() => {
            result.current.cancel();
        });

        expect(result.current.saveError).toBeNull();
    });

    it('reload re-fetches from server', async () => {
        mockGetEffortTiers
            .mockResolvedValueOnce(makeEffortTiersResponse({}))
            .mockResolvedValueOnce(makeEffortTiersResponse({
                medium: { model: 'mid-model', reasoningEffort: null },
            }));

        const { result } = renderHook(() => useProviderEffortTiers('copilot'));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.tiers.medium).toBeUndefined();

        act(() => {
            result.current.reload();
        });

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.tiers.medium).toEqual({ model: 'mid-model', reasoningEffort: '', source: 'config' });
    });
});
