// Recursive agent-run tree consumed by the "Agents" canvas view — a spatial
// map of the orchestrator and its (recursively spawned) sub-agent runs.
//
// Ported from the design prototype (coc-chat/agent-canvas.jsx), adapted to the
// dashboard's real conversation data: every node is either the synthetic
// orchestrator root or a sub-agent run derived from a `Task` tool call.

/** Run lifecycle state, using the prototype's vocabulary so the CSS port maps 1:1. */
export type AgentRunStatus = 'queued' | 'running' | 'done' | 'failed';

export interface AgentRunNode {
    /** Stable id — the tool-call id for sub-agents, 'root' for the orchestrator. */
    id: string;
    /** Display name: the sub-agent's description (or a truncated prompt). */
    name: string;
    /** Role label: the sub-agent type (e.g. 'Explore'), or 'orchestrator' for the root. */
    role: string;
    status: AgentRunStatus;
    /** True only for the synthetic orchestrator root. */
    isRoot?: boolean;
    /** Epoch ms when the run started, if known. */
    startedAt?: number;
    /** Epoch ms when the run finished, if known. */
    completedAt?: number;
    /** One-line summary / conclusion, if available. */
    summary?: string;
    /** Recursively spawned child runs. */
    children: AgentRunNode[];
}
