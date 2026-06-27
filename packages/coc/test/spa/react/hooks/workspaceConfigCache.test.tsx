/**
 * Integration tests for AC-01 / AC-05 (workspace half): the `llm-tools-config`
 * consumers — LlmToolsPanel (settings) and useConversationRetrievalCapability
 * (per-conversation chat check) — read through the shared staticConfigCache
 * keyed by workspace.
 *
 * Verifies that:
 *  - a warm second open of an already-seen workspace issues NO network call and
 *    paints without a loading/null flash (AC-01),
 *  - a not-yet-seen workspace fetches exactly once and populates the cache,
 *  - both consumers share the per-workspace key (one call total), and
 *  - a settings mutation (the LlmToolsPanel toggle) invalidates the key so the
 *    next read refetches (AC-05).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, renderHook, screen, waitFor, act, fireEvent } from '@testing-library/react';
import React from 'react';

const mocks = vi.hoisted(() => ({
    addToast: vi.fn(),
    preferences: {
        getLlmToolsConfig: vi.fn(),
        updateLlmToolsConfig: vi.fn(),
    },
}));

// LlmToolsPanel reads via the default origin client.
vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({ preferences: mocks.preferences }),
}));

// useConversationRetrievalCapability reads via the selected clone's client.
vi.mock('../../../../src/server/spa/client/react/repos/cloneRouting', () => ({
    useCocClient: () => ({ preferences: mocks.preferences }),
}));

vi.mock('../../../../src/server/spa/client/react/contexts/ToastContext', () => ({
    useGlobalToast: () => ({ addToast: mocks.addToast }),
}));

import { LlmToolsPanel } from '../../../../src/server/spa/client/react/features/repo-settings/LlmToolsPanel';
import { useConversationRetrievalCapability } from '../../../../src/server/spa/client/react/features/chat/sessionContextDrop';
import {
    _clearConfigCache,
    peekConfig,
    configCacheKey,
} from '../../../../src/server/spa/client/react/api/staticConfigCache';

const GET_CONVO_TOOL = { name: 'get_conversation', label: 'Get Conversation', description: '', enabledByDefault: true };

/** Config in which conversation retrieval is fully available. */
function availableConfig(disabled: string[] = []) {
    return { tools: [GET_CONVO_TOOL], disabledLlmTools: disabled, conversationRetrievalAvailable: true };
}

beforeEach(() => {
    _clearConfigCache();
    mocks.preferences.getLlmToolsConfig.mockReset();
    mocks.preferences.updateLlmToolsConfig.mockReset();
    mocks.addToast.mockReset();
});
afterEach(() => { vi.clearAllMocks(); });

describe('llm-tools-config consumers share the per-workspace static-config cache (AC-01)', () => {
    it('LlmToolsPanel fetches once per workspace and serves a warm reopen from cache', async () => {
        mocks.preferences.getLlmToolsConfig.mockResolvedValue(availableConfig());

        const first = render(<LlmToolsPanel workspaceId="ws-1" />);
        await waitFor(() => expect(screen.getByTestId('llm-tools-panel')).toBeTruthy());
        expect(mocks.preferences.getLlmToolsConfig).toHaveBeenCalledTimes(1);
        first.unmount();

        // Warm reopen: panel paints immediately (no loading flash) and no 2nd fetch.
        const second = render(<LlmToolsPanel workspaceId="ws-1" />);
        expect(screen.getByTestId('llm-tools-panel')).toBeTruthy();
        expect(screen.queryByTestId('llm-tools-loading')).toBeNull();
        expect(mocks.preferences.getLlmToolsConfig).toHaveBeenCalledTimes(1);
        second.unmount();
    });

    it('useConversationRetrievalCapability serves a warm reopen synchronously from cache', async () => {
        mocks.preferences.getLlmToolsConfig.mockResolvedValue(availableConfig());

        const first = renderHook(() => useConversationRetrievalCapability('ws-2', true));
        await waitFor(() => expect(first.result.current).toBe(true));
        expect(mocks.preferences.getLlmToolsConfig).toHaveBeenCalledTimes(1);
        first.unmount();

        // Seeded from cache on the very first render — no transient null flash.
        const second = renderHook(() => useConversationRetrievalCapability('ws-2', true));
        expect(second.result.current).toBe(true);
        expect(mocks.preferences.getLlmToolsConfig).toHaveBeenCalledTimes(1);
    });

    it('LlmToolsPanel and useConversationRetrievalCapability share the per-workspace key', async () => {
        mocks.preferences.getLlmToolsConfig.mockResolvedValue(availableConfig());

        const panel = render(<LlmToolsPanel workspaceId="ws-3" />);
        await waitFor(() => expect(screen.getByTestId('llm-tools-panel')).toBeTruthy());
        panel.unmount();

        const hook = renderHook(() => useConversationRetrievalCapability('ws-3', true));
        await waitFor(() => expect(hook.result.current).toBe(true));
        // Shared cache → a single network call total across both consumers.
        expect(mocks.preferences.getLlmToolsConfig).toHaveBeenCalledTimes(1);
    });

    it('useConversationRetrievalCapability fetches a not-yet-seen workspace exactly once', async () => {
        mocks.preferences.getLlmToolsConfig.mockResolvedValue(availableConfig());

        const a = renderHook(() => useConversationRetrievalCapability('ws-a', true));
        await waitFor(() => expect(a.result.current).not.toBeNull());
        a.unmount();
        const callsAfterA = mocks.preferences.getLlmToolsConfig.mock.calls.length;

        const b = renderHook(() => useConversationRetrievalCapability('ws-b', true));
        await waitFor(() => expect(b.result.current).not.toBeNull());
        expect(mocks.preferences.getLlmToolsConfig).toHaveBeenCalledWith('ws-b');
        expect(mocks.preferences.getLlmToolsConfig.mock.calls.length).toBe(callsAfterA + 1);
    });

    it('useConversationRetrievalCapability returns false without fetching when disabled', async () => {
        const { result } = renderHook(() => useConversationRetrievalCapability('ws-off', false));
        expect(result.current).toBe(false);
        expect(mocks.preferences.getLlmToolsConfig).not.toHaveBeenCalled();
    });
});

describe('the LlmToolsPanel toggle invalidates the per-workspace cache (AC-05)', () => {
    it('drops the workspace key on save so the next read refetches', async () => {
        mocks.preferences.getLlmToolsConfig.mockResolvedValue(availableConfig());
        mocks.preferences.updateLlmToolsConfig.mockResolvedValue(availableConfig(['get_conversation']));

        const panel = render(<LlmToolsPanel workspaceId="ws-5" />);
        await waitFor(() => expect(screen.getByTestId('llm-tool-toggle-get_conversation')).toBeTruthy());
        // Cache is warm after the initial load.
        expect(peekConfig(configCacheKey.llmToolsConfig('ws-5'))).toBeDefined();

        await act(async () => {
            fireEvent.click(screen.getByTestId('llm-tool-toggle-get_conversation'));
        });

        // Mutation dropped the cached key.
        await waitFor(() => expect(peekConfig(configCacheKey.llmToolsConfig('ws-5'))).toBeUndefined());
        panel.unmount();

        // The next reader refetches instead of serving the stale value (2 GETs total).
        const hook = renderHook(() => useConversationRetrievalCapability('ws-5', true));
        await waitFor(() => expect(hook.result.current).not.toBeNull());
        expect(mocks.preferences.getLlmToolsConfig).toHaveBeenCalledTimes(2);
    });
});
