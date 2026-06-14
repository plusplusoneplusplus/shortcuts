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
        byId.set(tc.id, {
            ...worse,
            ...better,
            ...(mergedArgs ? { args: mergedArgs } : {}),
            startTime: better.startTime ?? worse.startTime,
            endTime: better.endTime ?? worse.endTime,
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
