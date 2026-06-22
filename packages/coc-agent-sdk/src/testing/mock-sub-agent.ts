/**
 * Provider-agnostic sub-agent tool-event producer for tests.
 *
 * Sub-agent emission is unified one layer below the providers — at the SDK
 * `ToolEvent` (`onToolEvent`) seam. Every provider (claude/codex/copilot)
 * normalizes its native tool calls into that shape, so a helper that drives
 * `onToolEvent` is automatically unified across all current and future
 * providers.
 *
 * This file is the SINGLE source for the two result-string contracts the chat
 * agent-canvas parser (`agentToolCalls.ts`) consumes:
 *  - the background-startup acknowledgement (carries `agent_id: <id>`), and
 *  - the `read_agent` terminal completion (`Agent completed.\n\n<output>`).
 * Both unit tests (coc package) and Playwright e2e consume this one
 * implementation, so the producer and the parser stay in lockstep.
 */

import type { ToolEvent } from '../types';
import type { MockFnFactory } from './mock-fn';
import { createMockSDKService } from './mock-sdk-service';
import type { MockSDKServiceResult } from './mock-sdk-service';

// ---------------------------------------------------------------------------
// Spec
// ---------------------------------------------------------------------------

/** Synchronous sub-agent vs. asynchronous (background) sub-agent. */
export type SubAgentKind = 'sync' | 'background';

/** Terminal outcome of a sub-agent run. */
export type SubAgentStatus = 'completed' | 'failed';

/**
 * Declarative description of one sub-agent run. The producer turns each spec
 * into the start/complete `ToolEvent` sequence the real pipeline would emit.
 */
export interface SubAgentSpec {
    /** `toolCallId` of the `Task` call. Must be unique across the whole tree. */
    id: string;
    /** `sync` (default) → the Task result is the output; `background` → a Task
     * ack plus a later `read_agent` completion keyed by `agent_id`. */
    kind?: SubAgentKind;
    /** Maps to the sub-agent's `role` in the canvas (Task arg `agent_type`). */
    agentType?: string;
    /** Sub-agent title (Task arg `name`). */
    name?: string;
    /** Title fallback / inspector description (Task arg `description`). */
    description?: string;
    /** Model label (Task arg `model`). */
    model?: string;
    /** Run mode (Task arg `mode`). Background specs default this to `background`. */
    mode?: string;
    /** Prompt; truncated title fallback when no name/description (Task arg `prompt`). */
    prompt?: string;
    /** Final output text of the sub-agent run. */
    result?: string;
    /** Terminal status (default `completed`). */
    status?: SubAgentStatus;
    /**
     * `agent_id` used to wire a background Task ack to its `read_agent`
     * completion. Defaults to `id`. Keep it whitespace-free — the parser regex
     * `STARTED_AGENT_ID_RE` stops at the first space or comma.
     */
    agentId?: string;
    /** `parentToolCallId` — nests this Task under another Task (top-level only). */
    parentId?: string;
    /** Nested sub-agents spawned by this one (their `parentId` is set to `id`). */
    children?: SubAgentSpec[];
}

// ---------------------------------------------------------------------------
// Result-string formatters (single source of truth)
// ---------------------------------------------------------------------------

/** Trailing phrase appended to the background-startup acknowledgement. */
const BACKGROUND_STARTED_SUFFIX = '. You will be notified when it completes.';

/**
 * The startup acknowledgement a background `Task` call resolves with. Must
 * contain `agent_id: <id>` so `STARTED_AGENT_ID_RE`
 * (`/\bagent_id:\s*([^\s,]+)/i`) can extract the id that keys the later
 * `read_agent` completion.
 */
export function formatBackgroundStartedResult(agentId: string): string {
    return `Agent started in background with agent_id: ${agentId}${BACKGROUND_STARTED_SUFFIX}`;
}

/**
 * The terminal result a `read_agent` call resolves with. Must satisfy
 * `READ_AGENT_TERMINAL_RE`
 * (`/^Agent (?:completed|failed|cancelled)\.[^\n]*(?:\r?\n){2,}([\s\S]+)$/i`):
 * an `Agent <status>.` header line, a blank line, then the final output.
 */
export function formatAgentCompletedResult(params: {
    agentId: string;
    agentType?: string;
    status?: 'completed' | 'failed' | 'cancelled';
    output: string;
}): string {
    const status = params.status ?? 'completed';
    const agentType = params.agentType ?? 'task';
    return `Agent ${status}. agent_id: ${params.agentId}, agent_type: ${agentType}, status: ${status}\n\n${params.output}`;
}

/** Deterministic `read_agent` toolCallId derived from the Task's id. */
export function readAgentToolCallId(taskId: string): string {
    return `${taskId}__read`;
}

// ---------------------------------------------------------------------------
// Producer
// ---------------------------------------------------------------------------

/** Build the `Task` tool-call parameters the canvas reads back. */
function taskParameters(spec: SubAgentSpec): Record<string, unknown> {
    const params: Record<string, unknown> = {};
    if (spec.agentType) params.agent_type = spec.agentType;
    if (spec.name) params.name = spec.name;
    if (spec.description) params.description = spec.description;
    if (spec.model) params.model = spec.model;
    const mode = spec.mode ?? (spec.kind === 'background' ? 'background' : undefined);
    if (mode) params.mode = mode;
    if (spec.prompt) params.prompt = spec.prompt;
    return params;
}

/**
 * Turn sub-agent specs into the exact `ToolEvent[]` the real pipeline would
 * emit through `onToolEvent`. Emission order per spec mirrors the runtime:
 *  - `tool-start` (Task), then nested children's full lifecycles, then
 *  - sync:       a `tool-complete` (or `tool-failed`) whose result is the output;
 *  - background: a `tool-complete` Task ack carrying `agent_id`, followed by a
 *                `read_agent` start + completion keyed by the same `agent_id`.
 */
export function createSubAgentToolEvents(specs: SubAgentSpec[]): ToolEvent[] {
    const events: ToolEvent[] = [];

    const emit = (spec: SubAgentSpec, parentId?: string): void => {
        const kind = spec.kind ?? 'sync';
        const status = spec.status ?? 'completed';
        const output = spec.result ?? '';

        const start: ToolEvent = {
            type: 'tool-start',
            toolCallId: spec.id,
            toolName: 'Task',
            parameters: taskParameters(spec),
        };
        if (parentId) start.parentToolCallId = parentId;
        events.push(start);

        // Children are spawned by this agent during its run, so their lifecycles
        // nest between this Task's start and its completion. Their parent linkage
        // is wired to this Task's id regardless of any `parentId` they declare.
        for (const child of spec.children ?? []) {
            emit(child, spec.id);
        }

        if (kind === 'background') {
            const agentId = spec.agentId ?? spec.id;
            // The Task call only acks the background launch — it always succeeds.
            events.push({
                type: 'tool-complete',
                toolCallId: spec.id,
                toolName: 'Task',
                result: formatBackgroundStartedResult(agentId),
            });
            // The real output (and any failure) surfaces later via read_agent.
            const readId = readAgentToolCallId(spec.id);
            events.push({
                type: 'tool-start',
                toolCallId: readId,
                toolName: 'read_agent',
                parameters: { agent_id: agentId, wait: true },
            });
            events.push({
                type: 'tool-complete',
                toolCallId: readId,
                toolName: 'read_agent',
                result: formatAgentCompletedResult({
                    agentId,
                    agentType: spec.agentType,
                    status,
                    output,
                }),
            });
        } else if (status === 'failed') {
            events.push({
                type: 'tool-failed',
                toolCallId: spec.id,
                toolName: 'Task',
                error: output || 'Sub-agent failed',
            });
        } else {
            events.push({
                type: 'tool-complete',
                toolCallId: spec.id,
                toolName: 'Task',
                result: output,
            });
        }
    };

    for (const spec of specs) {
        emit(spec, spec.parentId);
    }
    return events;
}

// ---------------------------------------------------------------------------
// Preset
// ---------------------------------------------------------------------------

/**
 * Mock where `sendMessage` fires the sub-agent `ToolEvent[]` from
 * `createSubAgentToolEvents(specs)` via `onToolEvent`, then resolves success.
 * Parallel to `createStreamingMock`; lets a unit/integration test inject a
 * sub-agent-emitting service the same way other presets are injected.
 *
 * The `onToolEvent` handler is located by scanning the arguments for the
 * options object, so the preset works through the service's `sendMessage(opts)`
 * router (which forwards only the options arg) as well as any direct
 * `mockSendMessage(prompt, opts)` / `(sid, msg, opts)` call shape.
 */
export function createSubAgentMock(
    specs: SubAgentSpec[],
    fn?: MockFnFactory,
): MockSDKServiceResult {
    const result = createMockSDKService(undefined, fn);
    const events = createSubAgentToolEvents(specs);

    const impl = async (...args: unknown[]) => {
        const opts = args.find(
            (a): a is { onToolEvent?: (event: ToolEvent) => void } =>
                !!a && typeof a === 'object' && 'onToolEvent' in a,
        );
        if (opts?.onToolEvent) {
            for (const event of events) {
                opts.onToolEvent(event);
            }
        }
        return { success: true, response: '', sessionId: 'session-subagent' };
    };

    result.mockSendMessage.mockImplementation(impl);
    return result;
}
