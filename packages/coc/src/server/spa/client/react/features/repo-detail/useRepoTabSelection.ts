/**
 * useRepoTabSelection — the one place that routes a repo-tab click to a workspace.
 *
 * Every visible tab, agent pill, agent submenu, and overflow row selects a repo
 * with the same three-step contract: switch the current agent if the target
 * lives under a different one, select the workspace, and force a data refresh
 * when the *same* workspace ID is re-selected under a different agent (so stale
 * per-agent data is not shown). Centralizing it keeps those surfaces from
 * drifting apart — a real risk because the same workspace ID can exist under
 * multiple agents in container mode.
 */

import { useCallback } from 'react';

export interface RepoTabSelectionDeps {
    /** The reducer dispatch that owns `currentAgentId`. */
    dispatch: (action: { type: 'SET_CURRENT_AGENT'; agentId: string | null }) => void;
    /** The currently active agent id, or null/undefined outside container mode. */
    currentAgentId: string | null | undefined;
    /** Select a workspace by id (drives the main view). */
    onSelect: (id: string) => void;
    /** The currently selected repo id, used to detect same-repo agent switches. */
    selectedRepoId: string | null;
    /** Force a data refresh (used when re-selecting the same repo under a new agent). */
    onRefresh: () => void;
}

/**
 * Select a repo, optionally switching the active agent first.
 *
 * @param wsId    workspace id to select
 * @param agentId the agent the workspace lives under; falsy means "no agent"
 *                (non-container tabs pass `ws.agentId`, agent surfaces pass the
 *                group's agent id)
 */
export type RepoTabSelectFn = (wsId: string, agentId?: string | null) => void;

export function useRepoTabSelection(deps: RepoTabSelectionDeps): RepoTabSelectFn {
    const { dispatch, currentAgentId, onSelect, selectedRepoId, onRefresh } = deps;
    return useCallback<RepoTabSelectFn>((wsId, agentId) => {
        const switchingAgent = Boolean(agentId) && currentAgentId !== agentId;
        if (agentId) {
            dispatch({ type: 'SET_CURRENT_AGENT', agentId });
        }
        onSelect(wsId);
        if (switchingAgent && wsId === selectedRepoId) {
            onRefresh();
        }
    }, [dispatch, currentAgentId, onSelect, selectedRepoId, onRefresh]);
}
