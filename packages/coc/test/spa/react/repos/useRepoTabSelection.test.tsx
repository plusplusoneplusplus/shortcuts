/**
 * useRepoTabSelection — unit tests for the centralized repo-tab selection command.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useRepoTabSelection } from '../../../../src/server/spa/client/react/features/repo-detail/useRepoTabSelection';

function setup(overrides: Partial<Parameters<typeof useRepoTabSelection>[0]> = {}) {
    const dispatch = vi.fn();
    const onSelect = vi.fn();
    const onRefresh = vi.fn();
    const deps = {
        dispatch,
        currentAgentId: null as string | null | undefined,
        onSelect,
        selectedRepoId: null as string | null,
        onRefresh,
        ...overrides,
    };
    const { result } = renderHook(() => useRepoTabSelection(deps));
    return { selectRepo: result.current, dispatch, onSelect, onRefresh };
}

describe('useRepoTabSelection', () => {
    beforeEach(() => vi.clearAllMocks());

    it('selects a repo with no agent: no dispatch, no refresh', () => {
        const { selectRepo, dispatch, onSelect, onRefresh } = setup();
        selectRepo('r1');
        expect(onSelect).toHaveBeenCalledWith('r1');
        expect(dispatch).not.toHaveBeenCalled();
        expect(onRefresh).not.toHaveBeenCalled();
    });

    it('switches agent and selects when the target lives under a different agent', () => {
        const { selectRepo, dispatch, onSelect, onRefresh } = setup({ currentAgentId: 'agent-a' });
        selectRepo('r1', 'agent-b');
        expect(dispatch).toHaveBeenCalledWith({ type: 'SET_CURRENT_AGENT', agentId: 'agent-b' });
        expect(onSelect).toHaveBeenCalledWith('r1');
        // Different repo id from the selected one → no forced refresh.
        expect(onRefresh).not.toHaveBeenCalled();
    });

    it('refreshes when re-selecting the SAME repo id under a different agent', () => {
        const { selectRepo, dispatch, onSelect, onRefresh } = setup({
            currentAgentId: 'agent-a',
            selectedRepoId: 'ws-abc',
        });
        selectRepo('ws-abc', 'agent-b');
        expect(dispatch).toHaveBeenCalledWith({ type: 'SET_CURRENT_AGENT', agentId: 'agent-b' });
        expect(onSelect).toHaveBeenCalledWith('ws-abc');
        expect(onRefresh).toHaveBeenCalledTimes(1);
    });

    it('does not refresh when the same repo id is re-selected on the SAME agent', () => {
        const { selectRepo, dispatch, onSelect, onRefresh } = setup({
            currentAgentId: 'agent-a',
            selectedRepoId: 'ws-abc',
        });
        selectRepo('ws-abc', 'agent-a');
        // Agent unchanged → still dispatches (idempotent) but no refresh.
        expect(dispatch).toHaveBeenCalledWith({ type: 'SET_CURRENT_AGENT', agentId: 'agent-a' });
        expect(onSelect).toHaveBeenCalledWith('ws-abc');
        expect(onRefresh).not.toHaveBeenCalled();
    });

    it('treats a falsy agent id as "no agent" (no dispatch even for same selected repo)', () => {
        const { selectRepo, dispatch, onRefresh } = setup({
            currentAgentId: 'agent-a',
            selectedRepoId: 'ws-abc',
        });
        selectRepo('ws-abc', undefined);
        expect(dispatch).not.toHaveBeenCalled();
        expect(onRefresh).not.toHaveBeenCalled();
    });
});
