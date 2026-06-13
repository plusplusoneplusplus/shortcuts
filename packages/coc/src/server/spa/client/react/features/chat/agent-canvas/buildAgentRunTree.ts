// Adapts the dashboard's real conversation data into the recursive
// AgentRunNode tree the canvas renders. The orchestrator (this conversation)
// is the root; each `Task` tool call it issued becomes a sub-agent child.
//
// Sub-agent `Task` calls are the faithful, already-loaded source for the agent
// tree — no extra fetch. The tree shape supports arbitrary depth, so deeper
// recursion (a sub-agent's own children) can be layered on later without
// touching the canvas.

import type { ClientConversationTurn, ClientToolCall } from '../../../types/dashboard';
import { normalizeToolName } from '../conversation/tool-calls/toolNormalization';
import type { AgentRunNode, AgentRunStatus } from './types';

export interface AgentRunRootMeta {
    /** Root node id (defaults to 'root'). */
    id?: string;
    /** Root label (defaults to a generic orchestrator name). */
    title?: string;
    /** Overall conversation/process status — drives the root node's status. */
    status?: string;
}

function parseTime(v: unknown): number | undefined {
    if (typeof v === 'number') {
        return Number.isFinite(v) ? v : undefined;
    }
    if (typeof v === 'string') {
        const ms = Date.parse(v);
        return Number.isFinite(ms) ? ms : undefined;
    }
    return undefined;
}

/** Tool-call status → run status. */
function mapToolStatus(status: string | undefined): AgentRunStatus {
    switch (status) {
        case 'completed': return 'done';
        case 'failed': return 'failed';
        case 'pending': return 'queued';
        case 'running':
        default: return 'running';
    }
}

/** AIProcess status → run status (for the orchestrator root). */
function mapRootStatus(status: string | undefined): AgentRunStatus {
    switch (status) {
        case 'completed': return 'done';
        case 'failed':
        case 'cancelled': return 'failed';
        case 'queued': return 'queued';
        case 'running':
        case 'cancelling': return 'running';
        default: return 'done';
    }
}

function firstLine(text: string): string {
    const line = text.split('\n').map((l) => l.trim()).find(Boolean) || '';
    return line.length > 120 ? `${line.slice(0, 117).trimEnd()}…` : line;
}

// How "advanced" a status is — used to keep the best snapshot when the same
// tool-call id appears in both `turn.toolCalls` and the timeline.
const STATUS_RANK: Record<string, number> = { pending: 0, running: 1, completed: 2, failed: 2 };

/** Collect every tool call across turns, deduped by id, preferring terminal state. */
function collectToolCalls(turns: ClientConversationTurn[]): ClientToolCall[] {
    const byId = new Map<string, ClientToolCall>();
    const consider = (tc: ClientToolCall | undefined): void => {
        if (!tc || !tc.id) {
            return;
        }
        const existing = byId.get(tc.id);
        if (!existing) {
            byId.set(tc.id, tc);
            return;
        }
        const keepNew = (STATUS_RANK[tc.status] ?? 0) >= (STATUS_RANK[existing.status] ?? 0);
        const better = keepNew ? tc : existing;
        const worse = keepNew ? existing : tc;
        byId.set(tc.id, {
            ...worse,
            ...better,
            startTime: better.startTime ?? worse.startTime,
            endTime: better.endTime ?? worse.endTime,
            result: better.result ?? worse.result,
            error: better.error ?? worse.error,
        });
    };
    for (const turn of turns) {
        if (Array.isArray(turn.toolCalls)) {
            for (const tc of turn.toolCalls) {
                consider(tc);
            }
        }
        for (const item of turn.timeline || []) {
            consider(item.toolCall);
        }
    }
    return Array.from(byId.values());
}

/** Stable sort by start time; runs with no known start time keep their order, last. */
function byStartedAt(a: AgentRunNode, b: AgentRunNode): number {
    if (a.startedAt === undefined && b.startedAt === undefined) {
        return 0;
    }
    if (a.startedAt === undefined) {
        return 1;
    }
    if (b.startedAt === undefined) {
        return -1;
    }
    return a.startedAt - b.startedAt;
}

function asRecord(v: unknown): Record<string, unknown> {
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Build a sub-agent node from a normalized `Task` tool call. */
function nodeFromTaskCall(tc: ClientToolCall): AgentRunNode {
    const args = asRecord(tc.args);
    const agentType = typeof args.agent_type === 'string' ? args.agent_type
        : typeof args.subagent_type === 'string' ? args.subagent_type
            : '';
    const description = typeof args.description === 'string' ? args.description.trim() : '';
    const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : '';
    const name = description
        || (prompt ? (prompt.length > 48 ? `${prompt.slice(0, 45).trimEnd()}…` : prompt) : '')
        || 'sub-agent';
    const summary = typeof tc.result === 'string' && tc.result.trim()
        ? firstLine(tc.result)
        : undefined;
    return {
        id: tc.id,
        name,
        role: agentType || 'agent',
        status: mapToolStatus(tc.status),
        startedAt: parseTime(tc.startTime),
        completedAt: parseTime(tc.endTime),
        summary,
        children: [],
    };
}

/**
 * Build the agent-run tree from a conversation's turns. The root represents the
 * orchestrator; its children are the `Task` sub-agents it spawned, ordered by
 * start time. Returns a root with no children when the conversation issued none.
 */
export function buildAgentRunTreeFromTurns(
    turns: ClientConversationTurn[] | undefined,
    root?: AgentRunRootMeta,
): AgentRunNode {
    const taskCalls = collectToolCalls(turns || [])
        .filter((tc) => normalizeToolName(tc.toolName) === 'task');

    const children = taskCalls.map(nodeFromTaskCall);
    children.sort(byStartedAt);

    const rootStatus: AgentRunStatus = root?.status
        ? mapRootStatus(root.status)
        : (children.some((c) => c.status === 'running' || c.status === 'queued') ? 'running' : 'done');

    return {
        id: root?.id || 'root',
        name: (root?.title && root.title.trim()) || 'CoC · orchestrator',
        role: 'orchestrator',
        status: rootStatus,
        isRoot: true,
        children,
    };
}

/** Count every run in the tree, including the root. */
export function countRuns(node: AgentRunNode): number {
    return 1 + (node.children || []).reduce((sum, c) => sum + countRuns(c), 0);
}

/**
 * Find the `data-turn-index` of the turn that issued a given run (its `Task`
 * tool-call id), so a canvas node click can scroll the thread to that turn.
 * Mirrors ConversationArea's `turn.turnIndex ?? arrayIndex`.
 */
export function findTurnIndexForRun(
    turns: ClientConversationTurn[] | undefined,
    runId: string,
): number | null {
    if (!turns) {
        return null;
    }
    for (let i = 0; i < turns.length; i++) {
        const turn = turns[i];
        const inToolCalls = Array.isArray(turn.toolCalls) && turn.toolCalls.some((tc) => tc.id === runId);
        const inTimeline = (turn.timeline || []).some((item) => item.toolCall?.id === runId);
        if (inToolCalls || inTimeline) {
            return turn.turnIndex ?? i;
        }
    }
    return null;
}
