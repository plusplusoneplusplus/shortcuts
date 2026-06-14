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
    /** Role label: the sub-agent type (e.g. 'explore'), or 'orchestrator' for the root. */
    role: string;
    /** Short description of the run's task, when distinct from the name. */
    description?: string;
    /** Model the sub-agent runs on (e.g. 'claude-sonnet-4.6'), if specified. */
    model?: string;
    /** Execution mode (e.g. 'background'), if specified. */
    mode?: string;
    status: AgentRunStatus;
    /** True only for the synthetic orchestrator root. */
    isRoot?: boolean;
    /** Epoch ms when the run started, if known. */
    startedAt?: number;
    /** Epoch ms when the run finished, if known. */
    completedAt?: number;
    /** One-line summary / conclusion, if available. */
    summary?: string;
    /** Full task/instruction handed to this sub-agent (the Task tool's prompt). */
    prompt?: string;
    /** Full result/output the run produced, if available. */
    result?: string;
    /** Recursively spawned child runs. */
    children: AgentRunNode[];
}
