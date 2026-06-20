// Adapts the dashboard's real conversation data into the recursive
// AgentRunNode tree the canvas renders. The orchestrator (this conversation)
// is the root; each `Task` tool call becomes a sub-agent node, nested under the
// sub-agent that spawned it via `parentToolCallId` so the tree has real depth
// (L0 orchestrator → L1 → L2 → …).
//
// Every tool call — across all nesting levels — is captured flat in the main
// conversation and linked by `parentToolCallId`, so the whole hierarchy is the
// already-loaded, faithful source for the tree: no extra fetch.

import type { ClientConversationTurn, ClientToolCall } from '../../../types/dashboard';
import { normalizeToolName } from '../conversation/tool-calls/toolNormalization';
import {
    asRecord,
    asString,
    buildAgentCompletionByTaskId,
    collectToolCalls,
    firstLine,
    parseTime,
    rawArgs,
    rawToolName,
} from './agentToolCalls';
import type { AgentCompletionResult } from './agentToolCalls';
import type { AgentRunNode, AgentRunStatus } from './types';

export interface AgentRunRootMeta {
    /** Root node id (defaults to 'root'). */
    id?: string;
    /** Root label (defaults to a generic orchestrator name). */
    title?: string;
    /** Overall conversation/process status — drives the root node's status. */
    status?: string;
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

/** Build a sub-agent node from a normalized `Task` tool call. */
function nodeFromTaskCall(
    tc: ClientToolCall,
    completionByTaskId: Map<string, AgentCompletionResult>,
): AgentRunNode {
    const args = asRecord(rawArgs(tc));
    const agentType = asString(args.agent_type) || asString(args.subagent_type);
    const agentName = asString(args.name);
    const description = asString(args.description);
    const prompt = asString(args.prompt);
    const model = asString(args.model);
    const mode = asString(args.mode);
    // Prefer the explicit agent name; fall back to the description, then a
    // truncated prompt.
    const name = agentName
        || description
        || (prompt ? (prompt.length > 48 ? `${prompt.slice(0, 45).trimEnd()}…` : prompt) : '')
        || 'sub-agent';
    const completion = completionByTaskId.get(tc.id);
    const result = completion?.result
        ?? (typeof tc.result === 'string' && tc.result.trim() ? tc.result.trim() : undefined);
    return {
        id: tc.id,
        name,
        role: agentType || 'agent',
        // Keep the description only when it adds something beyond the name.
        description: description && description !== name ? description : undefined,
        model: model || undefined,
        mode: mode || undefined,
        status: mapToolStatus(tc.status),
        startedAt: parseTime(tc.startTime),
        completedAt: parseTime(completion?.endTime ?? tc.endTime),
        summary: result ? firstLine(result) : undefined,
        prompt: prompt || undefined,
        result,
        children: [],
    };
}

/**
 * True when nesting `childId` under `parentId` would form a cycle — i.e.
 * `childId` is already an ancestor of `parentId` (A↔B), or the ancestor chain
 * itself loops. Such pairs fall back to root level instead of nesting, so a
 * malformed `parentToolCallId` chain can never produce infinite recursion.
 */
function wouldCreateCycle(
    parentIdById: Map<string, string | undefined>,
    childId: string,
    parentId: string,
): boolean {
    let cursor: string | undefined = parentId;
    const seen = new Set<string>();
    while (cursor) {
        if (cursor === childId || seen.has(cursor)) {
            return true;
        }
        seen.add(cursor);
        cursor = parentIdById.get(cursor);
    }
    return false;
}

/**
 * Build the agent-run tree from a conversation's turns. The root is the
 * orchestrator; every `Task` tool call becomes a sub-agent node nested under the
 * sub-agent that spawned it (via `parentToolCallId`), giving the tree real depth.
 * A Task whose parent isn't another captured Task (or is missing/cyclic) attaches
 * directly to the orchestrator. Children at every level are ordered by start time.
 */
export function buildAgentRunTreeFromTurns(
    turns: ClientConversationTurn[] | undefined,
    root?: AgentRunRootMeta,
): AgentRunNode {
    const allCalls = collectToolCalls(turns || []);
    const completionByTaskId = buildAgentCompletionByTaskId(allCalls);
    const taskCalls = allCalls
        .filter((tc) => normalizeToolName(rawToolName(tc)) === 'task');

    const nodeById = new Map<string, AgentRunNode>();
    const parentIdById = new Map<string, string | undefined>();
    for (const tc of taskCalls) {
        nodeById.set(tc.id, nodeFromTaskCall(tc, completionByTaskId));
        parentIdById.set(tc.id, tc.parentToolCallId);
    }

    const rootChildren: AgentRunNode[] = [];
    for (const tc of taskCalls) {
        const node = nodeById.get(tc.id)!;
        const parentId = tc.parentToolCallId;
        // Nest under the spawning sub-agent only when its Task call was captured
        // too and nesting wouldn't form a cycle; otherwise attach to the root.
        if (parentId && parentId !== tc.id && nodeById.has(parentId)
            && !wouldCreateCycle(parentIdById, tc.id, parentId)) {
            nodeById.get(parentId)!.children.push(node);
        } else {
            rootChildren.push(node);
        }
    }

    // Order siblings at every level by start time.
    for (const node of nodeById.values()) {
        node.children.sort(byStartedAt);
    }
    rootChildren.sort(byStartedAt);

    // Root status reflects the whole subtree: any descendant still running/queued
    // keeps the orchestrator "live" when no explicit process status is given.
    const anyActive = Array.from(nodeById.values())
        .some((n) => n.status === 'running' || n.status === 'queued');
    const rootStatus: AgentRunStatus = root?.status
        ? mapRootStatus(root.status)
        : (anyActive ? 'running' : 'done');

    return {
        id: root?.id || 'root',
        name: (root?.title && root.title.trim()) || 'CoC · orchestrator',
        role: 'orchestrator',
        status: rootStatus,
        isRoot: true,
        children: rootChildren,
    };
}

/** Count every run in the tree, including the root (all nesting levels). */
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
