/**
 * SDK Session Keep-Alive Tests
 *
 * Tests for the CopilotSDKService session keep-alive lifecycle:
 * preserving sessions, follow-up messaging, streaming follow-ups,
 * explicit destroy, idle timeout cleanup, and error handling for
 * expired sessions.
 *
 * Complements the lower-level tests in test/ai/copilot-sdk-service-keep-alive.test.ts
 * with consumer-oriented API contract tests.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CopilotSDKService, resetCopilotSDKService } from '../src/copilot-sdk-wrapper/copilot-sdk-service';
import { setLogger, nullLogger } from '../src/logger';

// Suppress logger output during tests
setLogger(nullLogger);

// Mock the trusted-folder module
vi.mock('../src/copilot-sdk-wrapper/trusted-folder', async () => {
    const actual = await vi.importActual('../src/copilot-sdk-wrapper/trusted-folder');
    return {
        ...actual,
        ensureFolderTrusted: vi.fn(),
    };
});

// Mock the mcp-config-loader module
vi.mock('../src/copilot-sdk-wrapper/mcp-config-loader', () => ({
    loadDefaultMcpConfig: vi.fn().mockReturnValue({
        success: false,
        fileExists: false,
        mcpServers: {},
    }),
    mergeMcpConfigs: vi.fn().mockImplementation(
        (base: Record<string, any>, override?: Record<string, any>) => ({
            ...base,
            ...override,
        }),
    ),
}));

// ============================================================================
// Mock Helpers
// ============================================================================

function createMockSession(overrides?: Partial<{
    sessionId: string;
    sendAndWaitResponse: any;
    sendAndWaitError: Error;
}>) {
    const sessionId = overrides?.sessionId ?? 'sess-' + Math.random().toString(36).substring(7);
    return {
        sessionId,
        sendAndWait: overrides?.sendAndWaitError
            ? vi.fn().mockRejectedValue(overrides.sendAndWaitError)
            : vi.fn().mockResolvedValue(
                overrides?.sendAndWaitResponse ?? { data: { content: 'mock response' } }
            ),
        destroy: vi.fn().mockResolvedValue(undefined),
    };
}

function createMockSDKModule(sessionOrFactory: any) {
    const mockClient = {
        createSession: typeof sessionOrFactory === 'function'
            ? vi.fn().mockImplementation(() => Promise.resolve(sessionOrFactory()))
            : vi.fn().mockResolvedValue(sessionOrFactory),
        stop: vi.fn().mockResolvedValue(undefined),
    };

    class MockCopilotClient {
        constructor() {
            Object.assign(this, mockClient);
        }
    }
    return { MockCopilotClient, mockClient };
}

function setupService(service: CopilotSDKService, session: any) {
    const { MockCopilotClient } = createMockSDKModule(session);
    const serviceAny = service as any;
    serviceAny.sdkModule = { CopilotClient: MockCopilotClient };
    serviceAny.availabilityCache = { available: true, sdkPath: '/fake/sdk' };
}

// ============================================================================
// Tests
// ============================================================================

describe('keepAlive session management', () => {
    let service: CopilotSDKService;

    beforeEach(() => {
        resetCopilotSDKService();
        service = CopilotSDKService.getInstance();
        vi.clearAllMocks();
    });

    afterEach(async () => {
        await service.cleanup();
        resetCopilotSDKService();
    });

    it('should preserve session when keepAlive=true (session not destroyed after sendMessage)', async () => {
        const mockSession = createMockSession();
        setupService(service, mockSession);

        const result = await service.sendMessage({
            prompt: 'Hello',
            workingDirectory: '/test',
            keepAlive: true,
            loadDefaultMcpConfig: false,
        });

        expect(result.success).toBe(true);
        expect(result.sessionId).toBe(mockSession.sessionId);
        expect(mockSession.destroy).not.toHaveBeenCalled();
    });

    it('should destroy session normally when keepAlive is false/undefined', async () => {
        const mockSession = createMockSession();
        setupService(service, mockSession);

        await service.sendMessage({
            prompt: 'Hello',
            workingDirectory: '/test',
            loadDefaultMcpConfig: false,
        });

        expect(mockSession.destroy).toHaveBeenCalled();
        expect(service.hasKeptAliveSession(mockSession.sessionId)).toBe(false);
    });
});

describe('sendFollowUp', () => {
    let service: CopilotSDKService;

    beforeEach(() => {
        resetCopilotSDKService();
        service = CopilotSDKService.getInstance();
        vi.clearAllMocks();
    });

    afterEach(async () => {
        await service.cleanup();
        resetCopilotSDKService();
    });

    it('should find and reuse an existing session by sessionId', async () => {
        const mockSession = createMockSession();
        setupService(service, mockSession);

        const first = await service.sendMessage({
            prompt: 'Hello', workingDirectory: '/test',
            keepAlive: true, loadDefaultMcpConfig: false,
        });

        mockSession.sendAndWait.mockResolvedValueOnce({ data: { content: 'follow-up reply' } });
        const followUp = await service.sendFollowUp(first.sessionId!, 'Next question');

        expect(followUp.success).toBe(true);
        // sendAndWait called twice: initial + follow-up
        expect(mockSession.sendAndWait).toHaveBeenCalledTimes(2);
    });

    it('should send the follow-up prompt on the existing session', async () => {
        const mockSession = createMockSession();
        setupService(service, mockSession);

        const first = await service.sendMessage({
            prompt: 'Hello', workingDirectory: '/test',
            keepAlive: true, loadDefaultMcpConfig: false,
        });

        mockSession.sendAndWait.mockResolvedValueOnce({ data: { content: 'answer' } });
        await service.sendFollowUp(first.sessionId!, 'Tell me more');

        // The follow-up should have been sent on the same session's sendAndWait
        const lastCall = mockSession.sendAndWait.mock.calls[1];
        expect(lastCall[0]).toEqual(expect.objectContaining({ prompt: 'Tell me more' }));
    });

    it('should return the AI response from the follow-up', async () => {
        const mockSession = createMockSession();
        setupService(service, mockSession);

        const first = await service.sendMessage({
            prompt: 'Hello', workingDirectory: '/test',
            keepAlive: true, loadDefaultMcpConfig: false,
        });

        mockSession.sendAndWait.mockResolvedValueOnce({ data: { content: 'detailed answer' } });
        const result = await service.sendFollowUp(first.sessionId!, 'Details?');

        expect(result.success).toBe(true);
        expect(result.response).toBe('detailed answer');
        expect(result.sessionId).toBe(first.sessionId);
    });

    it('should return error for sendFollowUp on unknown sessionId', async () => {
        const result = await service.sendFollowUp('non-existent', 'Hello');

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/not found|expired/);
    });

    it('should return error for sendFollowUp on expired/destroyed session', async () => {
        const mockSession = createMockSession();
        setupService(service, mockSession);

        const first = await service.sendMessage({
            prompt: 'Hello', workingDirectory: '/test',
            keepAlive: true, loadDefaultMcpConfig: false,
        });

        // Destroy the session
        await service.destroyKeptAliveSession(first.sessionId!);

        const result = await service.sendFollowUp(first.sessionId!, 'Follow-up');
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/not found|expired/);
    });
});

describe('destroySession', () => {
    let service: CopilotSDKService;

    beforeEach(() => {
        resetCopilotSDKService();
        service = CopilotSDKService.getInstance();
        vi.clearAllMocks();
    });

    afterEach(async () => {
        await service.cleanup();
        resetCopilotSDKService();
    });

    it('should clean up a kept-alive session by sessionId', async () => {
        const mockSession = createMockSession();
        setupService(service, mockSession);

        const first = await service.sendMessage({
            prompt: 'Hello', workingDirectory: '/test',
            keepAlive: true, loadDefaultMcpConfig: false,
        });

        const destroyed = await service.destroyKeptAliveSession(first.sessionId!);
        expect(destroyed).toBe(true);
        expect(mockSession.destroy).toHaveBeenCalled();
        expect(service.hasKeptAliveSession(first.sessionId!)).toBe(false);
    });

    it('should be a no-op for an unknown sessionId', async () => {
        const result = await service.destroyKeptAliveSession('unknown-session');
        expect(result).toBe(false);
    });
});

describe('idle timeout', () => {
    let service: CopilotSDKService;

    beforeEach(() => {
        resetCopilotSDKService();
        service = CopilotSDKService.getInstance();
        vi.clearAllMocks();
    });

    afterEach(async () => {
        await service.cleanup();
        resetCopilotSDKService();
    });

    it('should clean up session after idle timeout expires', async () => {
        const mockSession = createMockSession();
        setupService(service, mockSession);

        const first = await service.sendMessage({
            prompt: 'Hello', workingDirectory: '/test',
            keepAlive: true, loadDefaultMcpConfig: false,
        });

        // Simulate session being idle for 11 minutes (timeout is 10 min)
        const entry = (service as any).keptAliveSessions.get(first.sessionId);
        entry.lastUsedAt = Date.now() - (11 * 60 * 1000);

        const cleaned = await (service as any).cleanupIdleKeptAliveSessions();
        expect(cleaned).toBe(1);
        expect(service.hasKeptAliveSession(first.sessionId!)).toBe(false);
    });

    it('should reset idle timer on follow-up activity', async () => {
        const mockSession = createMockSession();
        setupService(service, mockSession);

        const first = await service.sendMessage({
            prompt: 'Hello', workingDirectory: '/test',
            keepAlive: true, loadDefaultMcpConfig: false,
        });

        // Simulate session being idle for 9 minutes (under threshold)
        const entry = (service as any).keptAliveSessions.get(first.sessionId);
        entry.lastUsedAt = Date.now() - (9 * 60 * 1000);

        // Send follow-up — should update lastUsedAt
        mockSession.sendAndWait.mockResolvedValueOnce({ data: { content: 'still alive' } });
        await service.sendFollowUp(first.sessionId!, 'ping');

        // lastUsedAt should be refreshed to recent
        const updatedEntry = (service as any).keptAliveSessions.get(first.sessionId);
        expect(updatedEntry.lastUsedAt).toBeGreaterThan(Date.now() - 5000);

        // Cleanup should find nothing expired
        const cleaned = await (service as any).cleanupIdleKeptAliveSessions();
        expect(cleaned).toBe(0);
    });
});

describe('error handling', () => {
    let service: CopilotSDKService;

    beforeEach(() => {
        resetCopilotSDKService();
        service = CopilotSDKService.getInstance();
        vi.clearAllMocks();
    });

    afterEach(async () => {
        await service.cleanup();
        resetCopilotSDKService();
    });

    it('should destroy session when follow-up encounters an error', async () => {
        const mockSession = createMockSession();
        setupService(service, mockSession);

        const first = await service.sendMessage({
            prompt: 'Hello', workingDirectory: '/test',
            keepAlive: true, loadDefaultMcpConfig: false,
        });

        mockSession.sendAndWait.mockRejectedValueOnce(new Error('Connection lost'));
        const result = await service.sendFollowUp(first.sessionId!, 'Follow-up');

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/Connection lost/);
        expect(service.hasKeptAliveSession(first.sessionId!)).toBe(false);
    });
});
