/**
 * CodexSDKService.prewarm() — warm-client prewarming (AC-04).
 *
 * Verifies Codex prewarm constructs/parks a base client WITHOUT starting a
 * thread, is idempotent, reuses the prewarmed client on the next send, no-ops
 * when the SDK is unavailable, and no-ops entirely when warming is disabled
 * (TTL <= 0). Codex routes through the same shared WarmClientRegistry as
 * Copilot, so this mirrors the Copilot prewarm contract.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodexSDKService } from '../../src/codex-sdk-service';
import { cocToolBridgeServer } from '../../src/llm-tools/bridge-server';
import { resetSDKLogger } from '../../src/logger';
import { makeWarmKey } from '../../src/warm-client-registry';
import { CODEX_PROVIDER } from '../../src/sdk-service-registry';

const WD = '/test/project';
const PROCESS_A = 'process-a';
const PROCESS_B = 'process-b';
const KEY = makeWarmKey(CODEX_PROVIDER, PROCESS_A);
const KEY_B = makeWarmKey(CODEX_PROVIDER, PROCESS_B);

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

/** A recording Codex client constructor; each `new` pushes a client with spies. */
function makeRecordingCtor() {
    const clients: Array<{ startThread: ReturnType<typeof vi.fn>; resumeThread: ReturnType<typeof vi.fn> }> = [];
    const ctor = vi.fn(function () {
        const client = {
            startThread: vi.fn(() => makeThread()),
            resumeThread: vi.fn(() => makeThread()),
        };
        clients.push(client);
        return client;
    }) as unknown as new () => unknown;
    return { ctor, clients };
}

function makeService(opts: { ctor?: unknown; sdk?: unknown; available?: boolean }): CodexSDKService {
    const svc = new CodexSDKService();
    if (opts.sdk) (svc as unknown as { sdk: unknown }).sdk = opts.sdk;
    if (opts.ctor) (svc as unknown as { codexCtor: unknown }).codexCtor = opts.ctor;
    (svc as unknown as { availabilityCache: unknown }).availabilityCache =
        opts.available === false ? { available: false, error: 'not installed' } : { available: true };
    return svc;
}

function registry(svc: CodexSDKService): { size(): number; isWarm(key: string): boolean } {
    return (svc as unknown as { warmRegistry: { size(): number; isWarm(key: string): boolean } }).warmRegistry;
}

function registryFull(svc: CodexSDKService): { evict(key: string): Promise<void> } {
    return (svc as unknown as { warmRegistry: { evict(key: string): Promise<void> } }).warmRegistry;
}

describe('CodexSDKService.prewarm — warms without a session (AC-04)', () => {
    let svc: CodexSDKService | undefined;

    afterEach(() => {
        svc?.dispose();
        svc = undefined;
        cocToolBridgeServer.closeAll();
        resetSDKLogger();
    });

    it('warms the base client once and parks it, starting no thread', async () => {
        const { ctor, clients } = makeRecordingCtor();
        svc = makeService({ ctor, sdk: { startThread: vi.fn(() => makeThread()), resumeThread: vi.fn() } });

        await svc.prewarm({ warmKey: PROCESS_A, workingDirectory: WD });

        // The base client is constructed but NO thread is started (no session).
        expect(ctor).toHaveBeenCalledTimes(1);
        expect(clients).toHaveLength(1);
        expect(clients[0].startThread).not.toHaveBeenCalled();
        expect(registry(svc).isWarm(KEY)).toBe(true);
        expect(registry(svc).size()).toBe(1);
    });

    it('is idempotent — repeated prewarms do not duplicate the client', async () => {
        const { ctor } = makeRecordingCtor();
        svc = makeService({ ctor, sdk: { startThread: vi.fn(() => makeThread()), resumeThread: vi.fn() } });

        await svc.prewarm({ warmKey: PROCESS_A, workingDirectory: WD });
        await svc.prewarm({ warmKey: PROCESS_A, workingDirectory: WD });
        await svc.prewarm({ warmKey: PROCESS_A, workingDirectory: WD });

        expect(ctor).toHaveBeenCalledTimes(1);
        expect(registry(svc).size()).toBe(1);
    });

    it('reuses the prewarmed base client on the next send (no second construction)', async () => {
        const { ctor, clients } = makeRecordingCtor();
        const defaultSdk = { startThread: vi.fn(() => makeThread()), resumeThread: vi.fn() };
        svc = makeService({ ctor, sdk: defaultSdk });

        await svc.prewarm({ warmKey: PROCESS_A, workingDirectory: WD });
        const result = await svc.sendMessage({ prompt: 'hello', workingDirectory: WD, keepWarm: true, warmKey: PROCESS_A });

        expect(result.success).toBe(true);
        // Still one base client across prewarm + send, with one thread started by the send.
        expect(ctor).toHaveBeenCalledTimes(1);
        expect(clients[0].startThread).toHaveBeenCalledTimes(1);
        // The shared singleton client is never touched on the warm path.
        expect(defaultSdk.startThread).not.toHaveBeenCalled();
        expect(registry(svc).size()).toBe(1);
    });

    it('concurrent prewarm and send construct exactly one base client', async () => {
        const { ctor } = makeRecordingCtor();
        svc = makeService({ ctor, sdk: { startThread: vi.fn(() => makeThread()), resumeThread: vi.fn() } });

        const [, sendResult] = await Promise.all([
            svc.prewarm({ warmKey: PROCESS_A, workingDirectory: WD }),
            svc.sendMessage({ prompt: 'hello', workingDirectory: WD, keepWarm: true, warmKey: PROCESS_A }),
        ]);

        expect(sendResult.success).toBe(true);
        expect(ctor).toHaveBeenCalledTimes(1);
    });

    it('prewarming one process does not warm another process in the same cwd', async () => {
        const { ctor } = makeRecordingCtor();
        svc = makeService({ ctor, sdk: { startThread: vi.fn(() => makeThread()), resumeThread: vi.fn() } });

        await svc.prewarm({ warmKey: PROCESS_A, workingDirectory: WD });

        expect(registry(svc).isWarm(KEY)).toBe(true);
        expect(registry(svc).isWarm(KEY_B)).toBe(false);
    });

    it('no-ops when the Codex SDK is unavailable (no client constructed)', async () => {
        const { ctor } = makeRecordingCtor();
        svc = makeService({ ctor, sdk: { startThread: vi.fn(() => makeThread()), resumeThread: vi.fn() }, available: false });

        await svc.prewarm({ warmKey: PROCESS_A, workingDirectory: WD });

        expect(ctor).not.toHaveBeenCalled();
        expect(registry(svc).size()).toBe(0);
    });
});

describe('CodexSDKService.onWarmStatusChange — bridges registry transitions (AC-01b)', () => {
    let svc: CodexSDKService | undefined;

    afterEach(() => {
        svc?.dispose();
        svc = undefined;
        cocToolBridgeServer.closeAll();
        resetSDKLogger();
    });

    it('delivers warming→warm for the conversation key on prewarm', async () => {
        const { ctor } = makeRecordingCtor();
        svc = makeService({ ctor, sdk: { startThread: vi.fn(() => makeThread()), resumeThread: vi.fn() } });
        const seen: Array<[string, string]> = [];
        svc.onWarmStatusChange((key, status) => seen.push([key, status]));

        await svc.prewarm({ warmKey: PROCESS_A, workingDirectory: WD });

        expect(seen).toEqual([[KEY, 'warming'], [KEY, 'warm']]);
    });

    it('unsubscribe stops further deliveries', async () => {
        const { ctor } = makeRecordingCtor();
        svc = makeService({ ctor, sdk: { startThread: vi.fn(() => makeThread()), resumeThread: vi.fn() } });
        const seen: Array<[string, string]> = [];
        const unsub = svc.onWarmStatusChange((key, status) => seen.push([key, status]));

        await svc.prewarm({ warmKey: PROCESS_A, workingDirectory: WD }); // warming, warm
        unsub();
        await registryFull(svc).evict(KEY); // cold — not delivered

        expect(seen).toEqual([[KEY, 'warming'], [KEY, 'warm']]);
    });
});

describe('CodexSDKService.getWarmStatus — current warm snapshot (AC-02)', () => {
    let svc: CodexSDKService | undefined;

    afterEach(() => {
        svc?.dispose();
        svc = undefined;
        cocToolBridgeServer.closeAll();
        resetSDKLogger();
    });

    it('returns cold for a never-warmed conversation', () => {
        const { ctor } = makeRecordingCtor();
        svc = makeService({ ctor, sdk: { startThread: vi.fn(() => makeThread()), resumeThread: vi.fn() } });
        expect(svc.getWarmStatus({ warmKey: PROCESS_A, workingDirectory: WD })).toBe('cold');
    });

    it('returns warm after a prewarm — same key as prewarm()', async () => {
        const { ctor } = makeRecordingCtor();
        svc = makeService({ ctor, sdk: { startThread: vi.fn(() => makeThread()), resumeThread: vi.fn() } });

        await svc.prewarm({ warmKey: PROCESS_A, workingDirectory: WD });

        expect(svc.getWarmStatus({ warmKey: PROCESS_A, workingDirectory: WD })).toBe('warm');
        // A different process key in the same cwd is still cold.
        expect(svc.getWarmStatus({ warmKey: PROCESS_B, workingDirectory: WD })).toBe('cold');
    });

    it('returns warm after a warm-eligible send parks the client', async () => {
        const { ctor } = makeRecordingCtor();
        svc = makeService({ ctor, sdk: { startThread: vi.fn(() => makeThread()), resumeThread: vi.fn() } });

        const result = await svc.sendMessage({ prompt: 'hello', workingDirectory: WD, keepWarm: true, warmKey: PROCESS_A });

        expect(result.success).toBe(true);
        expect(svc.getWarmStatus({ warmKey: PROCESS_A, workingDirectory: WD })).toBe('warm');
    });
});

describe('CodexSDKService.prewarm — TTL=0 disables warming (AC-04/AC-06)', () => {
    let svc: CodexSDKService | undefined;

    afterEach(() => {
        delete process.env.COC_WARM_CLIENT_TTL_MS;
        svc?.dispose();
        svc = undefined;
        cocToolBridgeServer.closeAll();
        resetSDKLogger();
    });

    it('prewarm is a no-op: no client constructed, no entry parked', async () => {
        process.env.COC_WARM_CLIENT_TTL_MS = '0';
        const { ctor } = makeRecordingCtor();
        svc = makeService({ ctor, sdk: { startThread: vi.fn(() => makeThread()), resumeThread: vi.fn() } });

        await svc.prewarm({ warmKey: PROCESS_A, workingDirectory: WD });

        expect(ctor).not.toHaveBeenCalled();
        expect(registry(svc).size()).toBe(0);
        // The snapshot read also reports cold when warming is disabled.
        expect(svc.getWarmStatus({ warmKey: PROCESS_A, workingDirectory: WD })).toBe('cold');
    });
});
