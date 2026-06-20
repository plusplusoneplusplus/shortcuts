// Shared readers for the dashboard's conversation tool calls, used by the
// agent-canvas data model. The run-tree builder (`buildAgentRunTree`) and the
// per-sub-agent conversation reconstructor (`buildSubAgentTurns`) both read tool
// calls the same way, so the readers live here to stay in lockstep.

import type { ClientConversationTurn, ClientToolCall } from '../../../types/dashboard';

export function parseTime(v: unknown): number | undefined {
    if (typeof v === 'number') {
        return Number.isFinite(v) ? v : undefined;
    }
    if (typeof v === 'string') {
        const ms = Date.parse(v);
        return Number.isFinite(ms) ? ms : undefined;
    }
    return undefined;
}

export function firstLine(text: string): string {
    const line = text.split('\n').map((l) => l.trim()).find(Boolean) || '';
    return line.length > 120 ? `${line.slice(0, 117).trimEnd()}…` : line;
}

export function asRecord(v: unknown): Record<string, unknown> {
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function asString(v: unknown): string {
    return typeof v === 'string' ? v.trim() : '';
}

// Live (SSE) tool calls carry `toolName` + `args`; persisted ones (forge's
// ToolCall read model) carry `name` + `args`/`parameters`. Read both so a
// sub-agent is detected the same way mid-run and after the chat completes.
export function rawToolName(tc: ClientToolCall): string | undefined {
    return tc.toolName ?? (tc as { name?: string }).name;
}

export function rawArgs(tc: ClientToolCall): unknown {
    return tc.args ?? (tc as { parameters?: unknown }).parameters;
}

const STARTED_AGENT_ID_RE = /\bagent_id:\s*([^\s,]+)/i;
const READ_AGENT_TERMINAL_RE = /^Agent (?:completed|failed|cancelled)\.[^\n]*(?:\r?\n){2,}([\s\S]+)$/i;

/** The tool call's args (or parameters) only when it's a non-empty object. */
export function nonEmptyArgs(tc: ClientToolCall): Record<string, unknown> | undefined {
    const a = rawArgs(tc);
    return a && typeof a === 'object' && !Array.isArray(a) && Object.keys(a).length > 0
        ? (a as Record<string, unknown>)
        : undefined;
}

// How "advanced" a status is — used to keep the best snapshot when the same
// tool-call id appears in both `turn.toolCalls` and the timeline.
const STATUS_RANK: Record<string, number> = { pending: 0, running: 1, completed: 2, failed: 2 };

// A single tool call surfaces as several snapshots (live `tool-start` /
// `tool-complete`, plus the persisted row), and each stamps its own *receipt*
// time — so the terminal snapshot's `startTime` is actually the completion
// moment. Merge a run's true span as the earliest observed start and the latest
// observed end; otherwise a late snapshot's start wins and collapses the run to
// a 0:00 duration in the canvas. Returns the original value to preserve its type
// (ISO string or epoch ms).
function earliestTime(a: unknown, b: unknown): unknown {
    const ta = parseTime(a);
    const tb = parseTime(b);
    if (ta === undefined) {
        return b;
    }
    if (tb === undefined) {
        return a;
    }
    return ta <= tb ? a : b;
}

function latestTime(a: unknown, b: unknown): unknown {
    const ta = parseTime(a);
    const tb = parseTime(b);
    if (ta === undefined) {
        return b;
    }
    if (tb === undefined) {
        return a;
    }
    return ta >= tb ? a : b;
}

function usefulToolName(tc: ClientToolCall): string | undefined {
    const name = rawToolName(tc);
    return name && name !== 'unknown' ? name : undefined;
}

/** Collect every tool call across turns, deduped by id, preferring terminal state. */
export function collectToolCalls(turns: ClientConversationTurn[]): ClientToolCall[] {
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
        // The terminal snapshot (e.g. a timeline `tool-complete`) often carries
        // EMPTY args while an earlier snapshot has the full invocation args —
        // keep whichever args are non-empty so name/model/type survive.
        const mergedArgs = nonEmptyArgs(better) ?? nonEmptyArgs(worse);
        const mergedToolName = usefulToolName(better) ?? usefulToolName(worse);
        byId.set(tc.id, {
            ...worse,
            ...better,
            ...(mergedToolName ? { toolName: mergedToolName } : {}),
            ...(mergedArgs ? { args: mergedArgs } : {}),
            startTime: earliestTime(better.startTime, worse.startTime) as ClientToolCall['startTime'],
            endTime: latestTime(better.endTime, worse.endTime) as ClientToolCall['endTime'],
            result: better.result ?? worse.result,
            error: better.error ?? worse.error,
            // The terminal snapshot can also drop the parent linkage — keep
            // whichever snapshot carries it so the run hierarchy survives.
            parentToolCallId: better.parentToolCallId ?? worse.parentToolCallId,
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

export interface AgentCompletionResult {
    result: string;
    status: ClientToolCall['status'];
    endTime?: string;
}

function startedAgentIdFromTaskResult(result: unknown): string | undefined {
    if (typeof result !== 'string') {
        return undefined;
    }
    const match = result.match(STARTED_AGENT_ID_RE);
    return match?.[1]?.trim().replace(/[.)]+$/, '') || undefined;
}

function readAgentId(tc: ClientToolCall): string | undefined {
    if (rawToolName(tc) !== 'read_agent') {
        return undefined;
    }
    return asString(asRecord(rawArgs(tc)).agent_id) || undefined;
}

function displayReadAgentResult(result: string): string {
    const trimmed = result.trim();
    const match = trimmed.match(READ_AGENT_TERMINAL_RE);
    const body = match?.[1]?.trim();
    return body || trimmed;
}

function resultSortTime(result: AgentCompletionResult): number {
    const t = parseTime(result.endTime);
    return t === undefined ? 0 : t;
}

/**
 * Background `task` calls complete immediately with a startup acknowledgement;
 * their final output is delivered later through a `read_agent` call keyed by the
 * same agent_id. Build a lookup so the Agents view can display the final output.
 */
export function buildAgentCompletionByTaskId(toolCalls: ClientToolCall[]): Map<string, AgentCompletionResult> {
    const completionByAgentId = new Map<string, AgentCompletionResult>();
    for (const tc of toolCalls) {
        const agentId = readAgentId(tc);
        const result = typeof tc.result === 'string' && tc.result.trim() ? displayReadAgentResult(tc.result) : '';
        if (!agentId || !result) {
            continue;
        }
        const next: AgentCompletionResult = { result, status: tc.status, endTime: tc.endTime };
        const existing = completionByAgentId.get(agentId);
        if (!existing || resultSortTime(next) >= resultSortTime(existing)) {
            completionByAgentId.set(agentId, next);
        }
    }

    const byTaskId = new Map<string, AgentCompletionResult>();
    for (const tc of toolCalls) {
        const agentId = startedAgentIdFromTaskResult(tc.result);
        const completion = agentId ? completionByAgentId.get(agentId) : undefined;
        if (completion) {
            byTaskId.set(tc.id, completion);
        }
    }
    return byTaskId;
}
