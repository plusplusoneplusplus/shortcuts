/**
 * CodexSDKService — warm-client keep-alive wiring (AC-02).
 *
 * Verifies Codex reuses the SAME shared warm-client abstraction as Copilot
 * (`runWithWarmClient` + `WarmClientRegistry`): warm-eligible turns reuse a live
 * base client across turns, park it on clean completion, tear it down on failure
 * and on cleanup(), keep exactly one warm client per `(provider, workingDirectory)`
 * key, stay cold for one-shot turns, and transparently fall back to a cold run
 * when the warm client cannot be started (leaving no registry entry).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodexSDKService } from '../../src/codex-sdk-service';
import { cocToolBridgeServer } from '../../src/llm-tools/bridge-server';
import { initSDKLogger, resetSDKLogger } from '../../src/logger';

/** A thread mock that streams a single successful agent message. */
function makeThread(threadId = 'thread-1') {
    return {
        id: threadId,
        runStreamed: vi.fn(async () => ({
            events: (async function* () {
                yield { type: 'thread.started' as const, thread_id: threadId };
                yield { type: 'item.completed' as const, item: { id: 'i1', type: 'agent_message', text: 'ok' } };
            })(),
        })),
    };
}

/** A thread mock whose turn fails, forcing an unclean (keep: false) outcome. */
function makeFailingThread(threadId = 'thread-fail') {
    return {
        id: threadId,
        runStreamed: vi.fn(async () => ({
            events: (async function* () {
                yield { type: 'thread.started' as const, thread_id: threadId };
                yield { type: 'turn.failed' as const, error: { message: 'boom' } };
            })(),
        })),
    };
}

/** A recording Codex client constructor; each `new` pushes a client with spies. */
function makeRecordingCtor(threadFactory: () => ReturnType<typeof makeThread> = makeThread) {
    const clients: Array<{ startThread: ReturnType<typeof vi.fn>; resumeThread: ReturnType<typeof vi.fn> }> = [];
    const ctor = vi.fn(function () {
        const client = {
            startThread: vi.fn(() => threadFactory()),
            resumeThread: vi.fn(() => threadFactory()),
        };
        clients.push(client);
        return client;
    }) as unknown as new () => unknown;
    return { ctor, clients };
}

function makeService(opts: { ctor?: unknown; sdk?: unknown }): CodexSDKService {
    const svc = new CodexSDKService();
    if (opts.sdk) (svc as unknown as { sdk: unknown }).sdk = opts.sdk;
    if (opts.ctor) (svc as unknown as { codexCtor: unknown }).codexCtor = opts.ctor;
    (svc as unknown as { availabilityCache: unknown }).availabilityCache = { available: true };
    return svc;
}

function registrySize(svc: CodexSDKService): number {
    return (svc as unknown as { warmRegistry: { size(): number } }).warmRegistry.size();
}

describe('CodexSDKService — warm-client reuse (AC-02)', () => {
    let svc: CodexSDKService | undefined;

    afterEach(() => {
        svc?.dispose();
        svc = undefined;
        cocToolBridgeServer.closeAll();
        resetSDKLogger();
    });

    it('two warm-eligible sends reuse one base client (one construction, fresh thread per turn)', async () => {
        const { ctor, clients } = makeRecordingCtor();
        const defaultSdk = { startThread: vi.fn(() => makeThread()), resumeThread: vi.fn() };
        svc = makeService({ ctor, sdk: defaultSdk });

        const r1 = await svc.sendMessage({ prompt: 'hello', keepWarm: true });
        const r2 = await svc.sendMessage({ prompt: 'again', keepWarm: true });

        expect(r1.success).toBe(true);
        expect(r2.success).toBe(true);
        // The warm base client is constructed once and reused across both turns…
        expect(ctor).toHaveBeenCalledTimes(1);
        expect(clients).toHaveLength(1);
        // …with a fresh thread started per turn (continuity preserved).
        expect(clients[0].startThread).toHaveBeenCalledTimes(2);
        // The shared singleton client is never touched on the warm path.
        expect(defaultSdk.startThread).not.toHaveBeenCalled();
        // Exactly one warm client parked for this key.
        expect(registrySize(svc)).toBe(1);
    });

    it('logs a per-turn cold-miss then warm-hit line', async () => {
        const { ctor } = makeRecordingCtor();
        svc = makeService({ ctor, sdk: { startThread: vi.fn(() => makeThread()), resumeThread: vi.fn() } });

        const debugSpy = vi.fn();
        const spyLogger: any = {
            debug: debugSpy,
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            fatal: vi.fn(),
            trace: vi.fn(),
            level: 'debug',
            child: () => spyLogger,
        };
        initSDKLogger(spyLogger);

        await svc.sendMessage({ prompt: 'hello', keepWarm: true });
        await svc.sendMessage({ prompt: 'again', keepWarm: true });

        const warmHitFlags = debugSpy.mock.calls
            .map(([obj]) => obj)
            .filter((obj) => obj && typeof obj === 'object' && 'warmHit' in obj);
        expect(warmHitFlags.map((o: any) => o.warmHit)).toEqual([false, true]);

        const messages = debugSpy.mock.calls
            .filter(([obj]) => obj && typeof obj === 'object' && 'warmHit' in obj)
            .map(([, msg]) => msg as string);
        expect(messages[0]).toMatch(/cold/i);
        expect(messages[1]).toMatch(/hit/i);
    });

    it('tears down every warm client on cleanup()', async () => {
        const { ctor } = makeRecordingCtor();
        svc = makeService({ ctor, sdk: { startThread: vi.fn(() => makeThread()), resumeThread: vi.fn() } });

        await svc.sendMessage({ prompt: 'hello', keepWarm: true });
        expect(registrySize(svc)).toBe(1);

        await svc.cleanup();

        expect(registrySize(svc)).toBe(0);
    });

    it('tears down the warm entry when the turn fails (keep: false)', async () => {
        const { ctor } = makeRecordingCtor(makeFailingThread);
        svc = makeService({ ctor, sdk: { startThread: vi.fn(() => makeFailingThread()), resumeThread: vi.fn() } });

        const result = await svc.sendMessage({ prompt: 'hello', keepWarm: true });

        expect(result.success).toBe(false);
        // No warm entry left behind after an unclean outcome.
        expect(registrySize(svc)).toBe(0);
    });
});

describe('CodexSDKService — cold paths leave no warm entry (AC-02)', () => {
    let svc: CodexSDKService | undefined;

    afterEach(() => {
        svc?.dispose();
        svc = undefined;
        cocToolBridgeServer.closeAll();
    });

    it('does not warm when keepWarm is unset (one-shot turns stay cold)', async () => {
        const { ctor } = makeRecordingCtor();
        const defaultSdk = { startThread: vi.fn(() => makeThread()), resumeThread: vi.fn() };
        svc = makeService({ ctor, sdk: defaultSdk });

        await svc.sendMessage({ prompt: 'hello' });
        await svc.sendMessage({ prompt: 'again' });

        // Each cold turn runs on the shared singleton; the warm factory is never
        // invoked and nothing is parked.
        expect(ctor).not.toHaveBeenCalled();
        expect(defaultSdk.startThread).toHaveBeenCalledTimes(2);
        expect(registrySize(svc)).toBe(0);
    });

    it('falls back to a cold run when the warm client cannot start, leaving no entry', async () => {
        // A constructor that throws simulates a provider client that won't spawn.
        const throwingCtor = vi.fn(function () {
            throw new Error('spawn failed');
        }) as unknown as new () => unknown;
        const defaultSdk = { startThread: vi.fn(() => makeThread()), resumeThread: vi.fn() };
        svc = makeService({ ctor: throwingCtor, sdk: defaultSdk });

        const result = await svc.sendMessage({ prompt: 'hello', keepWarm: true });

        expect(result.success).toBe(true);
        // Warm acquisition failed → cold fallback ran the turn on the singleton…
        expect(defaultSdk.startThread).toHaveBeenCalledTimes(1);
        // …and the registry rolled its entry back — no leak.
        expect(registrySize(svc)).toBe(0);
    });
});

describe('CodexSDKService — abort/interrupt tears down the warm entry (AC-03)', () => {
    let svc: CodexSDKService | undefined;

    afterEach(() => {
        svc?.dispose();
        svc = undefined;
        cocToolBridgeServer.closeAll();
        resetSDKLogger();
    });

    it('does not keep the base client warm when the turn is aborted mid-stream', async () => {
        const controller = new AbortController();
        // A thread whose run aborts the caller's signal mid-turn, then still
        // completes successfully. This exercises the guard
        // `keepWarm = success && !signal.aborted` distinctly from the turn.failed
        // path: the turn produces a response, but the abort must still tear down
        // the warm entry. (The signal is NOT aborted at sendMessage entry, so the
        // early abort guard is bypassed and the warm path is engaged.)
        const abortingThread = () => ({
            id: 'thread-1',
            runStreamed: vi.fn(async () => {
                controller.abort();
                return {
                    events: (async function* () {
                        yield { type: 'thread.started' as const, thread_id: 'thread-1' };
                        yield { type: 'item.completed' as const, item: { id: 'i1', type: 'agent_message', text: 'ok' } };
                    })(),
                };
            }),
        });
        const { ctor, clients } = makeRecordingCtor(abortingThread as unknown as () => ReturnType<typeof makeThread>);
        svc = makeService({ ctor, sdk: { startThread: vi.fn(() => makeThread()), resumeThread: vi.fn() } });

        const result = await svc.sendMessage({ prompt: 'hello', keepWarm: true, signal: controller.signal });

        // The turn itself produced a response on a freshly cold-started warm client…
        expect(result.success).toBe(true);
        expect(clients).toHaveLength(1);
        // …but because the signal was aborted, the base client is not parked — the
        // abort tears the warm entry down (Codex's `stop` is a no-op by design, so
        // entry removal is the observable teardown).
        expect(registrySize(svc)).toBe(0);
    });
});
