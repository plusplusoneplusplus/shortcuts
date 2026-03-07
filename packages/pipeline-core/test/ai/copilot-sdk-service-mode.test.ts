/**
 * Copilot SDK Service Mode Tests
 *
 * Tests for agent mode (interactive/plan/autopilot) support via session.rpc.mode.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CopilotSDKService, resetCopilotSDKService } from '../../src/copilot-sdk-wrapper/copilot-sdk-service';
import type { AgentMode } from '../../src/copilot-sdk-wrapper/types';
import { setLogger, nullLogger } from '../../src/logger';
import {
    createMockSession,
    createMockSDKModule,
    createStreamingMockSession,
    setupService,
} from '../helpers/mock-sdk';

setLogger(nullLogger);

vi.mock('../../src/copilot-sdk-wrapper/trusted-folder', async () => {
    const actual = await vi.importActual('../../src/copilot-sdk-wrapper/trusted-folder');
    return { ...actual, ensureFolderTrusted: vi.fn() };
});

vi.mock('../../src/copilot-sdk-wrapper/mcp-config-loader', () => ({
    loadDefaultMcpConfig: vi.fn().mockReturnValue({
        success: false, fileExists: false, mcpServers: {},
    }),
    mergeMcpConfigs: vi.fn().mockImplementation(
        (base: Record<string, any>, override?: Record<string, any>) => ({ ...base, ...override }),
    ),
}));

/** Create a mock session with rpc.mode support */
function createMockSessionWithRpc(overrides?: { sessionId?: string }) {
    const session = createMockSession({ sessionId: overrides?.sessionId });
    const modeState = { mode: 'interactive' };
    (session as any).rpc = {
        mode: {
            get: vi.fn().mockImplementation(() => Promise.resolve({ mode: modeState.mode })),
            set: vi.fn().mockImplementation(({ mode }: { mode: string }) => {
                modeState.mode = mode;
                return Promise.resolve();
            }),
        },
    };
    return { session, modeState };
}

describe('CopilotSDKService - Agent Mode', () => {
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

    // ========================================================================
    // sendMessage with mode
    // ========================================================================

    it('should set mode after session creation when mode option is provided', async () => {
        const { session } = createMockSessionWithRpc();
        setupService(service, session);

        const result = await service.sendMessage({
            prompt: 'Plan the work',
            workingDirectory: '/test',
            mode: 'plan',
            loadDefaultMcpConfig: false,
        });

        expect(result.success).toBe(true);
        expect((session as any).rpc.mode.set).toHaveBeenCalledWith({ mode: 'plan' });
    });

    it('should not call rpc.mode.set when mode option is not provided', async () => {
        const { session } = createMockSessionWithRpc();
        setupService(service, session);

        await service.sendMessage({
            prompt: 'Hello',
            workingDirectory: '/test',
            loadDefaultMcpConfig: false,
        });

        expect((session as any).rpc.mode.set).not.toHaveBeenCalled();
    });

    it('should gracefully skip mode setting when session has no rpc support', async () => {
        const session = createMockSession();
        setupService(service, session);

        // session has no .rpc property — should not throw
        const result = await service.sendMessage({
            prompt: 'Hello',
            workingDirectory: '/test',
            mode: 'autopilot',
            loadDefaultMcpConfig: false,
        });

        expect(result.success).toBe(true);
    });

    it('should set autopilot mode via sendMessage', async () => {
        const { session, modeState } = createMockSessionWithRpc();
        setupService(service, session);

        await service.sendMessage({
            prompt: 'Do everything',
            workingDirectory: '/test',
            mode: 'autopilot',
            loadDefaultMcpConfig: false,
        });

        expect((session as any).rpc.mode.set).toHaveBeenCalledWith({ mode: 'autopilot' });
        expect(modeState.mode).toBe('autopilot');
    });

    // ========================================================================
    // sendFollowUp with mode
    // ========================================================================

    it('should set mode on follow-up when mode option is provided', async () => {
        const { session } = createMockSessionWithRpc();
        setupService(service, session);

        // First message with keepAlive
        const firstResult = await service.sendMessage({
            prompt: 'Hello',
            workingDirectory: '/test',
            keepAlive: true,
            mode: 'interactive',
            loadDefaultMcpConfig: false,
        });
        expect(firstResult.success).toBe(true);

        // Clear mock call history from sendMessage
        (session as any).rpc.mode.set.mockClear();

        // Follow-up with different mode
        session.sendAndWait.mockResolvedValueOnce({ data: { content: 'planned' } });
        const followUp = await service.sendFollowUp(firstResult.sessionId!, 'Now plan', {
            mode: 'plan',
        });

        expect(followUp.success).toBe(true);
        expect((session as any).rpc.mode.set).toHaveBeenCalledWith({ mode: 'plan' });
    });

    it('should not call rpc.mode.set on follow-up when mode is not specified', async () => {
        const { session } = createMockSessionWithRpc();
        setupService(service, session);

        const firstResult = await service.sendMessage({
            prompt: 'Hello',
            workingDirectory: '/test',
            keepAlive: true,
            loadDefaultMcpConfig: false,
        });

        (session as any).rpc.mode.set.mockClear();

        session.sendAndWait.mockResolvedValueOnce({ data: { content: 'response' } });
        await service.sendFollowUp(firstResult.sessionId!, 'Follow-up');

        expect((session as any).rpc.mode.set).not.toHaveBeenCalled();
    });

    // ========================================================================
    // getMode / setMode on kept-alive sessions
    // ========================================================================

    it('should get current mode from a kept-alive session', async () => {
        const { session, modeState } = createMockSessionWithRpc();
        setupService(service, session);

        const firstResult = await service.sendMessage({
            prompt: 'Hello',
            workingDirectory: '/test',
            keepAlive: true,
            loadDefaultMcpConfig: false,
        });

        modeState.mode = 'autopilot';
        const mode = await service.getMode(firstResult.sessionId!);
        expect(mode).toBe('autopilot');
        expect((session as any).rpc.mode.get).toHaveBeenCalled();
    });

    it('should set mode on a kept-alive session', async () => {
        const { session, modeState } = createMockSessionWithRpc();
        setupService(service, session);

        const firstResult = await service.sendMessage({
            prompt: 'Hello',
            workingDirectory: '/test',
            keepAlive: true,
            loadDefaultMcpConfig: false,
        });

        await service.setMode(firstResult.sessionId!, 'plan');
        expect((session as any).rpc.mode.set).toHaveBeenCalledWith({ mode: 'plan' });
        expect(modeState.mode).toBe('plan');
    });

    it('should throw when getMode is called with unknown session ID', async () => {
        await expect(service.getMode('nonexistent')).rejects.toThrow(
            'Session nonexistent not found or has expired',
        );
    });

    it('should throw when setMode is called with unknown session ID', async () => {
        await expect(service.setMode('nonexistent', 'plan')).rejects.toThrow(
            'Session nonexistent not found or has expired',
        );
    });

    it('should return undefined from getMode when session has no rpc support', async () => {
        const session = createMockSession();
        setupService(service, session);

        const firstResult = await service.sendMessage({
            prompt: 'Hello',
            workingDirectory: '/test',
            keepAlive: true,
            loadDefaultMcpConfig: false,
        });

        const mode = await service.getMode(firstResult.sessionId!);
        expect(mode).toBeUndefined();
    });

    it('should throw from setMode when session has no rpc support', async () => {
        const session = createMockSession();
        setupService(service, session);

        const firstResult = await service.sendMessage({
            prompt: 'Hello',
            workingDirectory: '/test',
            keepAlive: true,
            loadDefaultMcpConfig: false,
        });

        await expect(service.setMode(firstResult.sessionId!, 'plan')).rejects.toThrow(
            'does not support rpc.mode',
        );
    });

    // ========================================================================
    // All three mode values
    // ========================================================================

    for (const mode of ['interactive', 'plan', 'autopilot'] as AgentMode[]) {
        it(`should accept '${mode}' as a valid mode value`, async () => {
            const { session, modeState } = createMockSessionWithRpc();
            setupService(service, session);

            await service.sendMessage({
                prompt: `Test ${mode}`,
                workingDirectory: '/test',
                mode,
                loadDefaultMcpConfig: false,
            });

            expect((session as any).rpc.mode.set).toHaveBeenCalledWith({ mode });
            expect(modeState.mode).toBe(mode);
        });
    }
});
