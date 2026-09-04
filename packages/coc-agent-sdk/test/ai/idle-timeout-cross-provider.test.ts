/**
 * Cross-provider idle timeout — one suite, the same four behaviours asserted
 * against Claude, Codex and OpenCode (Copilot's own implementation is covered
 * by test/copilot-sdk-wrapper/streaming-session.test.ts, which is the reference
 * these three are modelled on):
 *
 *   1. Any provider event is activity, so a busy stream is never killed.
 *   2. Suppressed while a tool call is in flight (the `ask_user` widget case).
 *   3. `idleTimeoutMs` of 0/undefined disables the timer.
 *   4. On fire the turn settles as a failure with the shared error text.
 *
 * Regression gate for "idleTimeoutMs is honoured only by the Copilot path".
 *
 * Real timers with a short window: the providers drive genuinely async streams,
 * so fake timers would need to interleave with microtask draining. The windows
 * are small and the gaps generous multiples of them.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../src/sdk-esm-loader', () => ({
    dynamicImportModule: vi.fn(),
}));

import { ClaudeSDKService } from '../../src/claude-sdk-service';
import { CodexSDKService } from '../../src/codex-sdk-service';
import { OpenCodeSDKService } from '../../src/opencode-sdk-service';
import { dynamicImportModule } from '../../src/sdk-esm-loader';
import type { IInvocationResult } from '../../src/sdk-service-interface';
import { resetSDKLogger } from '../../src/logger';

const mockDynamicImport = vi.mocked(dynamicImportModule);

const IDLE_MS = 80;
/** Comfortably longer than the idle window, so a quiet stream is provably idle. */
const QUIET_MS = 400;

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** A pushable async stream that also ends when `signal` aborts. */
function channel<T>() {
    const queue: T[] = [];
    let wake: (() => void) | null = null;
    let ended = false;
    const bump = () => { wake?.(); wake = null; };
    return {
        push(value: T) { queue.push(value); bump(); },
        end() { ended = true; bump(); },
        async *stream(signal?: AbortSignal): AsyncGenerator<T> {
            const onAbort = () => bump();
            signal?.addEventListener('abort', onAbort);
            try {
                for (;;) {
                    if (queue.length > 0) { yield queue.shift()!; continue; }
                    if (ended || signal?.aborted) return;
                    await new Promise<void>(resolve => { wake = resolve; });
                }
            } finally {
                signal?.removeEventListener('abort', onAbort);
            }
        },
    };
}

/**
 * What a provider harness exposes to the shared assertions: a turn in flight
 * plus the handful of stream pokes the behaviours need.
 */
interface Harness {
    result: Promise<IInvocationResult>;
    /** Emit a plain assistant-text frame (activity). */
    activity(): void;
    /** Emit a tool-start frame with no completion (the blocked-agent case). */
    startTool(): void;
    /** Complete the tool started by {@link startTool}. */
    finishTool(): void;
    /** Emit the provider's terminal frame(s) so the turn settles successfully. */
    finish(): void;
    dispose(): void;
}

type HarnessFactory = (idleTimeoutMs: number | undefined) => Harness;

// ── Claude ───────────────────────────────────────────────────────────────────

const claudeHarness: HarnessFactory = idleTimeoutMs => {
    const svc = new ClaudeSDKService();
    const ch = channel<object>();
    const queryFn = vi.fn((callOptions: { prompt: AsyncIterable<unknown>; abortController?: AbortController }) => {
        // The SDK drains stdin; consume it so closing the gate never deadlocks.
        void (async () => { try { for await (const _ of callOptions.prompt) { /* drain */ } } catch { /* ignore */ } })();
        return ch.stream(callOptions.abortController?.signal);
    });
    mockDynamicImport.mockResolvedValue({ query: queryFn });

    const result = svc.sendMessage({ prompt: 'hi', idleTimeoutMs });
    return {
        result,
        activity: () => ch.push({
            type: 'assistant',
            message: { role: 'assistant', content: [{ type: 'text', text: 'tick' }] },
        }),
        startTool: () => ch.push({
            type: 'assistant',
            message: {
                role: 'assistant',
                content: [{ type: 'tool_use', id: 'tool-1', name: 'ask_user', input: {} }],
            },
        }),
        finishTool: () => ch.push({
            type: 'user',
            message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'ok' }] },
        }),
        finish: () => {
            ch.push({ type: 'result', subtype: 'success', is_error: false, result: 'done' });
            ch.end();
        },
        dispose: () => svc.dispose(),
    };
};

// ── Codex ────────────────────────────────────────────────────────────────────

const codexHarness: HarnessFactory = idleTimeoutMs => {
    const svc = new CodexSDKService();
    const ch = channel<object>();
    const thread = {
        id: 'thread-1',
        runStreamed: vi.fn(async (_input: unknown, opts?: { signal?: AbortSignal }) => ({
            events: ch.stream(opts?.signal),
        })),
    };
    (svc as unknown as { sdk: unknown }).sdk = { startThread: () => thread, resumeThread: () => thread };
    (svc as unknown as { availabilityCache: unknown }).availabilityCache = { available: true };

    const result = svc.sendMessage({ prompt: 'hi', idleTimeoutMs });
    return {
        result,
        activity: () => ch.push({ type: 'item.completed', item: { id: 'msg-x', type: 'agent_message', text: '' } }),
        startTool: () => ch.push({
            type: 'item.started',
            item: { id: 'tool-1', type: 'mcp_tool_call', tool: 'ask_user', status: 'in_progress' },
        }),
        finishTool: () => ch.push({
            type: 'item.completed',
            item: { id: 'tool-1', type: 'mcp_tool_call', tool: 'ask_user', status: 'completed' },
        }),
        finish: () => {
            ch.push({ type: 'item.completed', item: { id: 'msg-1', type: 'agent_message', text: 'done' } });
            ch.end();
        },
        dispose: () => svc.dispose(),
    };
};

// ── OpenCode (streaming path) ────────────────────────────────────────────────

const openCodeHarness: HarnessFactory = idleTimeoutMs => {
    const svc = new OpenCodeSDKService();
    const ch = channel<Record<string, unknown>>();
    let settlePrompt: (() => void) | null = null;
    const sessionAbort = vi.fn().mockResolvedValue({ data: true });
    const client = {
        global: { health: vi.fn().mockResolvedValue({ data: { healthy: true } }) },
        session: {
            create: vi.fn().mockResolvedValue({ data: { id: 'session-1' } }),
            get: vi.fn().mockResolvedValue({ data: { id: 'session-1' } }),
            abort: sessionAbort,
            // Like the real long-poll prompt call: resolves only when the turn
            // ends. It carries no abort signal, so the provider must race it.
            prompt: vi.fn(async () => {
                await new Promise<void>(resolve => { settlePrompt = resolve; });
                return { data: { info: { id: 'msg-1' }, parts: [] } };
            }),
        },
        event: { subscribe: vi.fn(async () => ({ stream: ch.stream() })) },
    };
    (svc as unknown as { client: unknown }).client = client;
    (svc as unknown as { availabilityCache: unknown }).availabilityCache = { available: true };

    const result = svc.sendMessage({
        prompt: 'hi',
        idleTimeoutMs,
        // onStreamingChunk selects the streaming path, which is where OpenCode
        // arms the idle watchdog.
        onStreamingChunk: () => {},
        onToolEvent: () => {},
    });

    return {
        result,
        activity: () => ch.push({ type: 'message.chunk', sessionID: 'session-1', content: '' }),
        startTool: () => ch.push({
            type: 'tool.start',
            sessionID: 'session-1',
            part: { type: 'tool-invocation', toolCallID: 'tool-1', toolName: 'ask_user', state: 'running' },
        }),
        finishTool: () => ch.push({
            type: 'tool.complete',
            sessionID: 'session-1',
            part: { type: 'tool-invocation', toolCallID: 'tool-1', toolName: 'ask_user', state: 'completed' },
        }),
        finish: () => {
            ch.push({ type: 'message.chunk', sessionID: 'session-1', content: 'done' });
            ch.push({ type: 'message.complete', sessionID: 'session-1' });
            ch.end();
            settlePrompt?.();
        },
        dispose: () => svc.dispose(),
    };
};

const PROVIDERS: Array<[name: string, factory: HarnessFactory]> = [
    ['Claude', claudeHarness],
    ['Codex', codexHarness],
    ['OpenCode', openCodeHarness],
];

describe.each(PROVIDERS)('%s idle timeout', (_name, makeHarness) => {
    beforeEach(() => {
        mockDynamicImport.mockReset();
        resetSDKLogger();
    });
    afterEach(() => {
        resetSDKLogger();
    });

    it('fails with the shared idle-timeout error when the stream goes quiet', async () => {
        const h = makeHarness(IDLE_MS);
        try {
            const result = await h.result;
            expect(result.success).toBe(false);
            expect(result.error).toBe(`Request idle-timed out after ${IDLE_MS}ms with no activity`);
        } finally {
            h.dispose();
        }
    });

    it('is reset by provider events, so a busy stream survives past the window', async () => {
        const h = makeHarness(IDLE_MS);
        try {
            for (let i = 0; i < 8; i++) {
                h.activity();
                await sleep(IDLE_MS / 2);
            }
            h.finish();
            const result = await h.result;
            expect(result.error).toBeUndefined();
            expect(result.success).toBe(true);
        } finally {
            h.dispose();
        }
    });

    it('is suppressed while a tool call is in flight (ask_user widget)', async () => {
        const h = makeHarness(IDLE_MS);
        try {
            h.startTool();
            // Far longer than the window with no events at all: the agent is
            // blocked on a human reply, not idle.
            await sleep(QUIET_MS);
            h.finishTool();
            h.finish();
            const result = await h.result;
            expect(result.error).toBeUndefined();
            expect(result.success).toBe(true);
        } finally {
            h.dispose();
        }
    });

    it('fires once the tool completes and the stream then goes quiet', async () => {
        const h = makeHarness(IDLE_MS);
        try {
            h.startTool();
            await sleep(QUIET_MS);
            h.finishTool();
            const result = await h.result;
            expect(result.success).toBe(false);
            expect(result.error).toBe(`Request idle-timed out after ${IDLE_MS}ms with no activity`);
        } finally {
            h.dispose();
        }
    });

    it('is disabled when idleTimeoutMs is 0', async () => {
        const h = makeHarness(0);
        try {
            await sleep(QUIET_MS);
            h.finish();
            const result = await h.result;
            expect(result.success).toBe(true);
        } finally {
            h.dispose();
        }
    });

    it('is disabled when idleTimeoutMs is not set', async () => {
        const h = makeHarness(undefined);
        try {
            await sleep(QUIET_MS);
            h.finish();
            const result = await h.result;
            expect(result.success).toBe(true);
        } finally {
            h.dispose();
        }
    });
});
