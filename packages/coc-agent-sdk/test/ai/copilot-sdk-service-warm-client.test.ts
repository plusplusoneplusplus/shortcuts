/**
 * CopilotSDKService — warm-client keep-alive wiring (AC-01).
 *
 * Verifies the service reuses a live client process across warm-eligible turns
 * (`keepWarm: true`), parks it on clean completion, tears it down on TTL expiry
 * and on error, keeps exactly one warm client per `(provider, warmKey)`
 * key, and stays cold for one-shot turns and caller-supplied clients.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CopilotSDKService, resetCopilotSDKService } from '../../src/copilot-sdk-service';
import { initSDKLogger, resetSDKLogger } from '../../src/logger';
import { createMockSDKModule, createMockSession } from '../helpers/mock-sdk';

// vi.mock factories must be inline (hoisted before imports)
vi.mock('../../src/trusted-folder', async () => {
    const actual = await vi.importActual('../../src/trusted-folder');
    return { ...actual, ensureFolderTrusted: vi.fn() };
});

vi.mock('../../src/mcp-config-loader', () => ({
    loadDefaultMcpConfig: vi.fn().mockReturnValue({ success: false, fileExists: false, mcpServers: {} }),
    loadEffectiveMcpConfig: vi.fn().mockReturnValue({ success: true, fileExists: false, configPath: '', mcpServers: {} }),
    mergeMcpConfigs: vi.fn().mockImplementation((base: Record<string, any>, override?: Record<string, any>) => ({ ...base, ...override })),
}));

// Mock sdk-client-factory so tests control CopilotClient instantiation.
const createSdkClientMock = vi.fn();
vi.mock('../../src/sdk-client-factory', () => ({
    createSdkClient: (...args: any[]) => createSdkClientMock(...args),
}));

const WD = '/test/project';
const PROCESS_A = 'process-a';
const PROCESS_B = 'process-b';

/** A non-streaming send that resolves quickly via sendAndWait. */
function warmSend(service: CopilotSDKService, overrides?: Record<string, unknown>) {
    return service.sendMessage({
        prompt: 'hello',
        workingDirectory: WD,
        warmKey: PROCESS_A,
        timeoutMs: 10000, // non-streaming path (<= 120000)
        loadDefaultMcpConfig: false,
        keepWarm: true,
        ...overrides,
    });
}

// ============================================================================
// Default TTL (warming enabled)
// ============================================================================

describe('CopilotSDKService — warm-client reuse (AC-01)', () => {
    let service: CopilotSDKService;

    beforeEach(() => {
        resetCopilotSDKService();
        service = CopilotSDKService.getInstance();
        vi.clearAllMocks();
    });

    afterEach(() => {
        service.dispose();
        resetCopilotSDKService();
        resetSDKLogger();
    });

    function wireMock() {
        const mod = createMockSDKModule(() => createMockSession());
        createSdkClientMock.mockImplementation((opts: any) => new mod.MockCopilotClient(opts));
        (service as any).availabilityCache = { available: true, sdkPath: '/fake/sdk' };
        return mod;
    }

    it('two warm-eligible sends reuse one client (one createClient, one start)', async () => {
        const { mockClient } = wireMock();

        const r1 = await warmSend(service);
        const r2 = await warmSend(service);

        expect(r1.success).toBe(true);
        expect(r2.success).toBe(true);
        // The client process is created and started exactly once across both turns…
        expect(createSdkClientMock).toHaveBeenCalledTimes(1);
        expect(mockClient.start).toHaveBeenCalledTimes(1);
        // …but a fresh session is created per turn (continuity preserved).
        expect(mockClient.createSession).toHaveBeenCalledTimes(2);
        // The warm client is NOT stopped between turns.
        expect(mockClient.stop).not.toHaveBeenCalled();
    });

    it('keeps exactly one warm client per key', async () => {
        wireMock();

        await warmSend(service);
        await warmSend(service);

        expect((service as any).warmRegistry.size()).toBe(1);
    });

    it('keeps separate warm clients for different process warm keys in the same cwd', async () => {
        wireMock();

        await warmSend(service, { warmKey: PROCESS_A });
        await warmSend(service, { warmKey: PROCESS_B });

        expect(createSdkClientMock).toHaveBeenCalledTimes(2);
        expect((service as any).warmRegistry.size()).toBe(2);
    });

    it('logs a per-turn cold-miss then warm-hit line', async () => {
        wireMock();

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

        await warmSend(service);
        await warmSend(service);

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
        const { mockClient } = wireMock();

        await warmSend(service);
        expect((service as any).warmRegistry.size()).toBe(1);

        await service.cleanup();

        expect(mockClient.stop).toHaveBeenCalledTimes(1);
        expect((service as any).warmRegistry.size()).toBe(0);
    });

    it('tears down the warm client when the turn fails (keep: false)', async () => {
        const mod = createMockSDKModule(() => createMockSession());
        // Make every session creation fail so the turn errors out.
        mod.mockClient.createSession = vi.fn().mockRejectedValue(new Error('boom'));
        createSdkClientMock.mockImplementation((opts: any) => new mod.MockCopilotClient(opts));
        (service as any).availabilityCache = { available: true, sdkPath: '/fake/sdk' };

        const result = await warmSend(service);

        expect(result.success).toBe(false);
        expect(mod.mockClient.stop).toHaveBeenCalledTimes(1);
        expect((service as any).warmRegistry.size()).toBe(0);
    });
});

// ============================================================================
// Cold paths (no warm entry left behind)
// ============================================================================

describe('CopilotSDKService — cold paths leave no warm entry (AC-01)', () => {
    let service: CopilotSDKService;

    beforeEach(() => {
        resetCopilotSDKService();
        service = CopilotSDKService.getInstance();
        vi.clearAllMocks();
    });

    afterEach(() => {
        service.dispose();
        resetCopilotSDKService();
        resetSDKLogger();
    });

    it('does not warm when keepWarm is unset (one-shot turns stay cold)', async () => {
        const mod = createMockSDKModule(() => createMockSession());
        createSdkClientMock.mockImplementation((opts: any) => new mod.MockCopilotClient(opts));
        (service as any).availabilityCache = { available: true, sdkPath: '/fake/sdk' };

        await warmSend(service, { keepWarm: false });
        await warmSend(service, { keepWarm: false });

        // Each cold turn creates and stops its own client; nothing is parked.
        expect(createSdkClientMock).toHaveBeenCalledTimes(2);
        expect(mod.mockClient.stop).toHaveBeenCalledTimes(2);
        expect((service as any).warmRegistry.size()).toBe(0);
    });

    it('bypasses the warm registry when the caller supplies its own client', async () => {
        const externalClient = {
            createSession: vi.fn().mockResolvedValue(createMockSession()),
            start: vi.fn().mockResolvedValue(undefined),
            stop: vi.fn().mockResolvedValue(undefined),
        };
        (service as any).availabilityCache = { available: true, sdkPath: '/fake/sdk' };

        const result = await warmSend(service, { client: externalClient as any });

        expect(result.success).toBe(true);
        // Warm path never engaged: no client spawned, registry untouched, caller's
        // client lifecycle respected (not stopped by us).
        expect(createSdkClientMock).not.toHaveBeenCalled();
        expect(externalClient.stop).not.toHaveBeenCalled();
        expect((service as any).warmRegistry.size()).toBe(0);
    });

    it('runs cold and logs when keepWarm is true without a warmKey', async () => {
        const mod = createMockSDKModule(() => createMockSession());
        createSdkClientMock.mockImplementation((opts: any) => new mod.MockCopilotClient(opts));
        (service as any).availabilityCache = { available: true, sdkPath: '/fake/sdk' };
        const warnSpy = vi.fn();
        const spyLogger: any = {
            debug: vi.fn(),
            info: vi.fn(),
            warn: warnSpy,
            error: vi.fn(),
            fatal: vi.fn(),
            trace: vi.fn(),
            level: 'debug',
            child: () => spyLogger,
        };
        initSDKLogger(spyLogger);

        const result = await warmSend(service, { warmKey: undefined });

        expect(result.success).toBe(true);
        expect(createSdkClientMock).toHaveBeenCalledTimes(1);
        expect(mod.mockClient.stop).toHaveBeenCalledTimes(1);
        expect((service as any).warmRegistry.size()).toBe(0);
        expect(warnSpy).toHaveBeenCalledWith(
            expect.objectContaining({ provider: 'copilot', workingDirectory: WD }),
            expect.stringContaining('without warmKey'),
        );
    });
});

// ============================================================================
// TTL expiry
// ============================================================================

describe('CopilotSDKService — warm client TTL expiry (AC-01)', () => {
    let service: CopilotSDKService;

    beforeEach(() => {
        process.env.COC_WARM_CLIENT_TTL_MS = '40';
        resetCopilotSDKService();
        service = CopilotSDKService.getInstance();
        vi.clearAllMocks();
    });

    afterEach(() => {
        delete process.env.COC_WARM_CLIENT_TTL_MS;
        service.dispose();
        resetCopilotSDKService();
    });

    it('stops the client and removes the entry after the idle TTL elapses', async () => {
        const mod = createMockSDKModule(() => createMockSession());
        createSdkClientMock.mockImplementation((opts: any) => new mod.MockCopilotClient(opts));
        (service as any).availabilityCache = { available: true, sdkPath: '/fake/sdk' };

        await warmSend(service);
        // Parked, idle TTL ticking.
        expect((service as any).warmRegistry.size()).toBe(1);
        expect(mod.mockClient.stop).not.toHaveBeenCalled();

        // Wait past the 40ms TTL for the idle timer + async evict to settle.
        await new Promise((r) => setTimeout(r, 150));

        expect(mod.mockClient.stop).toHaveBeenCalledTimes(1);
        expect((service as any).warmRegistry.size()).toBe(0);
    });
});

// ============================================================================
// TTL = 0 disables warming entirely (AC-06)
// ============================================================================

describe('CopilotSDKService — TTL=0 disables warming on the send path (AC-06)', () => {
    let service: CopilotSDKService;

    beforeEach(() => {
        process.env.COC_WARM_CLIENT_TTL_MS = '0';
        resetCopilotSDKService();
        service = CopilotSDKService.getInstance();
        vi.clearAllMocks();
    });

    afterEach(() => {
        delete process.env.COC_WARM_CLIENT_TTL_MS;
        service.dispose();
        resetCopilotSDKService();
        resetSDKLogger();
    });

    it('stops the client immediately on release and parks no entry, even with keepWarm:true', async () => {
        const mod = createMockSDKModule(() => createMockSession());
        createSdkClientMock.mockImplementation((opts: any) => new mod.MockCopilotClient(opts));
        (service as any).availabilityCache = { available: true, sdkPath: '/fake/sdk' };

        const r1 = await warmSend(service);

        expect(r1.success).toBe(true);
        // keepWarm:true was requested, but TTL=0 forces cold behaviour: the client
        // is torn down immediately on release — nothing is parked.
        expect(mod.mockClient.stop).toHaveBeenCalledTimes(1);
        expect((service as any).warmRegistry.size()).toBe(0);

        // A second send cold-starts a brand-new client (no warm reuse possible).
        const r2 = await warmSend(service);

        expect(r2.success).toBe(true);
        expect(createSdkClientMock).toHaveBeenCalledTimes(2);
        expect(mod.mockClient.stop).toHaveBeenCalledTimes(2);
        expect((service as any).warmRegistry.size()).toBe(0);
    });
});

// ============================================================================
// Abort / interrupt teardown (AC-03)
// ============================================================================

describe('CopilotSDKService — abort/interrupt tears down the warm client (AC-03)', () => {
    let service: CopilotSDKService;

    beforeEach(() => {
        resetCopilotSDKService();
        service = CopilotSDKService.getInstance();
        vi.clearAllMocks();
    });

    afterEach(() => {
        service.dispose();
        resetCopilotSDKService();
        resetSDKLogger();
    });

    function wireMock() {
        const mod = createMockSDKModule(() => createMockSession());
        createSdkClientMock.mockImplementation((opts: any) => new mod.MockCopilotClient(opts));
        (service as any).availabilityCache = { available: true, sdkPath: '/fake/sdk' };
        return mod;
    }

    it('stops the warm client and removes the entry when the turn is aborted', async () => {
        const { mockClient } = wireMock();
        const controller = new AbortController();
        controller.abort();

        const result = await warmSend(service, { signal: controller.signal });

        // The abort surfaces as a failed turn…
        expect(result.success).toBe(false);
        // …and the warm client that was spun up for the turn is torn down, not parked.
        expect(createSdkClientMock).toHaveBeenCalledTimes(1);
        expect(mockClient.start).toHaveBeenCalledTimes(1);
        expect(mockClient.stop).toHaveBeenCalledTimes(1);
        expect((service as any).warmRegistry.size()).toBe(0);
    });

    it('tears down even when the send reports success but the signal aborted', async () => {
        const { mockClient } = wireMock();
        // Isolate the defensive guard `keepWarm = success && !signal.aborted`:
        // force a successful send while the caller's signal is already aborted, so
        // the only reason to tear down is the aborted signal (not a failed result).
        const sendSpy = vi
            .spyOn((service as any).requestRunner, 'send')
            .mockResolvedValue({ success: true, response: 'ok', sessionId: 's1' });
        const controller = new AbortController();
        controller.abort();

        const result = await warmSend(service, { signal: controller.signal });

        expect(result.success).toBe(true);
        expect(sendSpy).toHaveBeenCalledTimes(1);
        // An aborted signal forces teardown regardless of the (racy) success result.
        expect(mockClient.stop).toHaveBeenCalledTimes(1);
        expect((service as any).warmRegistry.size()).toBe(0);
    });
});
