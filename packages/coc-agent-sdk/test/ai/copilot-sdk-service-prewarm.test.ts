/**
 * CopilotSDKService.prewarm() — warm-client prewarming (AC-04).
 *
 * Verifies prewarm warms the client process WITHOUT creating a session, is
 * idempotent (repeated calls don't duplicate the client), reuses the prewarmed
 * process on the next send, no-ops while a turn is active, no-ops when the SDK
 * is unavailable, and no-ops entirely when warming is disabled (TTL <= 0).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CopilotSDKService, resetCopilotSDKService } from '../../src/copilot-sdk-service';
import { resetSDKLogger } from '../../src/logger';
import { makeWarmKey } from '../../src/warm-client-registry';
import { COPILOT_PROVIDER } from '../../src/sdk-service-registry';
import { createMockSDKModule, createMockSession } from '../helpers/mock-sdk';

vi.mock('../../src/trusted-folder', async () => {
    const actual = await vi.importActual('../../src/trusted-folder');
    return { ...actual, ensureFolderTrusted: vi.fn() };
});

vi.mock('../../src/mcp-config-loader', () => ({
    loadDefaultMcpConfig: vi.fn().mockReturnValue({ success: false, fileExists: false, mcpServers: {} }),
    loadEffectiveMcpConfig: vi.fn().mockReturnValue({ success: true, fileExists: false, configPath: '', mcpServers: {} }),
    mergeMcpConfigs: vi.fn().mockImplementation((base: Record<string, any>, override?: Record<string, any>) => ({ ...base, ...override })),
}));

const createSdkClientMock = vi.fn();
vi.mock('../../src/sdk-client-factory', () => ({
    createSdkClient: (...args: any[]) => createSdkClientMock(...args),
}));

const WD = '/test/project';
const KEY = makeWarmKey(COPILOT_PROVIDER, WD);

function warmSend(service: CopilotSDKService, overrides?: Record<string, unknown>) {
    return service.sendMessage({
        prompt: 'hello',
        workingDirectory: WD,
        timeoutMs: 10000, // non-streaming path
        loadDefaultMcpConfig: false,
        keepWarm: true,
        ...overrides,
    });
}

// ============================================================================
// Warming enabled (default TTL)
// ============================================================================

describe('CopilotSDKService.prewarm — warms without a session (AC-04)', () => {
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

    it('warms the client once and parks it, creating no session', async () => {
        const { mockClient } = wireMock();

        await service.prewarm({ workingDirectory: WD });

        // The client process is created and started, but NO session is created.
        expect(createSdkClientMock).toHaveBeenCalledTimes(1);
        expect(mockClient.start).toHaveBeenCalledTimes(1);
        expect(mockClient.createSession).not.toHaveBeenCalled();
        // Parked and ready for reuse.
        expect((service as any).warmRegistry.isWarm(KEY)).toBe(true);
        expect((service as any).warmRegistry.size()).toBe(1);
    });

    it('is idempotent — repeated prewarms do not duplicate the client', async () => {
        wireMock();

        await service.prewarm({ workingDirectory: WD });
        await service.prewarm({ workingDirectory: WD });
        await service.prewarm({ workingDirectory: WD });

        expect(createSdkClientMock).toHaveBeenCalledTimes(1);
        expect((service as any).warmRegistry.size()).toBe(1);
    });

    it('reuses the prewarmed client on the next send (no second cold-start)', async () => {
        const { mockClient } = wireMock();

        await service.prewarm({ workingDirectory: WD });
        const result = await warmSend(service);

        expect(result.success).toBe(true);
        // Still one client created/started across prewarm + send…
        expect(createSdkClientMock).toHaveBeenCalledTimes(1);
        expect(mockClient.start).toHaveBeenCalledTimes(1);
        // …and the send created exactly one session on the warm client.
        expect(mockClient.createSession).toHaveBeenCalledTimes(1);
        expect(mockClient.stop).not.toHaveBeenCalled();
    });

    it('concurrent prewarm and send create exactly one client (mid-warm reuse)', async () => {
        const { mockClient } = wireMock();

        // Fire both without awaiting between them — whichever reaches the
        // registry first, the other attaches to the same warm client.
        const [, sendResult] = await Promise.all([
            service.prewarm({ workingDirectory: WD }),
            warmSend(service),
        ]);

        expect(sendResult.success).toBe(true);
        expect(createSdkClientMock).toHaveBeenCalledTimes(1);
        expect(mockClient.createSession).toHaveBeenCalledTimes(1);
    });

    it('no-ops while a turn is active on the same key', async () => {
        wireMock();

        // Launch a turn; acquire increments activeCount synchronously, so the
        // registry is active before prewarm runs.
        const sendP = warmSend(service);
        expect((service as any).warmRegistry.isActive(KEY)).toBe(true);

        await service.prewarm({ workingDirectory: WD });

        // Prewarm must not spawn a second client while a turn holds the key.
        expect(createSdkClientMock).toHaveBeenCalledTimes(1);

        await sendP;
    });

    it('no-ops when the SDK is unavailable (no client spawned)', async () => {
        const mod = createMockSDKModule(() => createMockSession());
        createSdkClientMock.mockImplementation((opts: any) => new mod.MockCopilotClient(opts));
        (service as any).availabilityCache = { available: false, error: 'SDK missing' };

        await service.prewarm({ workingDirectory: WD });

        expect(createSdkClientMock).not.toHaveBeenCalled();
        expect((service as any).warmRegistry.size()).toBe(0);
    });
});

// ============================================================================
// Warming disabled (TTL = 0)
// ============================================================================

describe('CopilotSDKService.prewarm — TTL=0 disables warming (AC-04/AC-06)', () => {
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

    it('prewarm is a no-op: no client spawned, no entry parked', async () => {
        const mod = createMockSDKModule(() => createMockSession());
        createSdkClientMock.mockImplementation((opts: any) => new mod.MockCopilotClient(opts));
        (service as any).availabilityCache = { available: true, sdkPath: '/fake/sdk' };

        await service.prewarm({ workingDirectory: WD });

        expect(createSdkClientMock).not.toHaveBeenCalled();
        expect((service as any).warmRegistry.size()).toBe(0);
    });
});
