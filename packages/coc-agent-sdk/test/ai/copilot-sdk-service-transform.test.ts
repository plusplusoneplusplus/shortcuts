/**
 * CopilotSDKService.transform() Tests
 *
 * Tests for the one-shot transform primitive that runs a single isolated
 * request and returns a structured result. The primitive defaults to no
 * MCP/tools and denied permissions, owns no model default, and never throws on
 * provider failure (it returns `{ success: false }`).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CopilotSDKService, resetCopilotSDKService } from '../../src/copilot-sdk-service';
import { initSDKLogger, resetSDKLogger } from '../../src/logger';
import { denyAllPermissions } from '../../src/types';
import { createMockSDKModule } from '../helpers/mock-sdk';

initSDKLogger({ level: 'silent' });

vi.mock('../../src/trusted-folder', async () => {
    const actual = await vi.importActual('../../src/trusted-folder');
    return { ...actual, ensureFolderTrusted: vi.fn() };
});

vi.mock('../../src/mcp-config-loader', () => ({
    loadDefaultMcpConfig: vi.fn().mockReturnValue({
        success: false, fileExists: false, mcpServers: {},
    }),
    loadEffectiveMcpConfig: vi.fn().mockReturnValue({
        success: true, fileExists: false, configPath: '', mcpServers: {},
    }),
    mergeMcpConfigs: vi.fn().mockImplementation(
        (base: Record<string, any>, override?: Record<string, any>) => ({ ...base, ...override }),
    ),
}));

describe('CopilotSDKService.transform', () => {
    let service: CopilotSDKService;

    beforeEach(() => {
        resetCopilotSDKService();
        service = CopilotSDKService.getInstance();
        vi.clearAllMocks();
    });

    afterEach(async () => {
        service.dispose();
        resetCopilotSDKService();
        resetSDKLogger();
    });

    it('returns a structured success result with the response text', async () => {
        const sendMessageSpy = vi.spyOn(service, 'sendMessage').mockResolvedValue({
            success: true,
            response: 'Hello World',
            effectiveModel: 'gpt-5.4-mini',
        });

        const result = await service.transform('test prompt');
        expect(result.success).toBe(true);
        expect(result.text).toBe('Hello World');
        expect(result.effectiveModel).toBe('gpt-5.4-mini');
        sendMessageSpy.mockRestore();
    });

    it('owns no model default — passes through whatever model the caller supplies', async () => {
        const sendMessageSpy = vi.spyOn(service, 'sendMessage').mockResolvedValue({
            success: true,
            response: 'ok',
        });

        await service.transform('test', { model: 'gpt-5.4-mini' });
        expect(sendMessageSpy).toHaveBeenCalledWith(
            expect.objectContaining({ model: 'gpt-5.4-mini' }),
        );
        sendMessageSpy.mockRestore();
    });

    it('does not inject a model when the caller omits one', async () => {
        const sendMessageSpy = vi.spyOn(service, 'sendMessage').mockResolvedValue({
            success: true,
            response: 'ok',
        });

        await service.transform('test');
        const opts = sendMessageSpy.mock.calls[0][0];
        expect(opts.model).toBeUndefined();
        sendMessageSpy.mockRestore();
    });

    it('defaults to no MCP and denied permissions', async () => {
        const sendMessageSpy = vi.spyOn(service, 'sendMessage').mockResolvedValue({
            success: true,
            response: 'ok',
        });

        await service.transform('test');
        const opts = sendMessageSpy.mock.calls[0][0];
        expect(opts.loadDefaultMcpConfig).toBe(false);
        expect(opts.onPermissionRequest).toBe(denyAllPermissions);
        sendMessageSpy.mockRestore();
    });

    it('allows overriding MCP and permission defaults', async () => {
        const handler = vi.fn();
        const sendMessageSpy = vi.spyOn(service, 'sendMessage').mockResolvedValue({
            success: true,
            response: 'ok',
        });

        await service.transform('test', {
            loadDefaultMcpConfig: true,
            onPermissionRequest: handler as any,
        });
        const opts = sendMessageSpy.mock.calls[0][0];
        expect(opts.loadDefaultMcpConfig).toBe(true);
        expect(opts.onPermissionRequest).toBe(handler);
        sendMessageSpy.mockRestore();
    });

    it('returns a failure result (does not throw) when sendMessage fails', async () => {
        const sendMessageSpy = vi.spyOn(service, 'sendMessage').mockResolvedValue({
            success: false,
            error: 'AI unavailable',
        });

        const result = await service.transform('fail');
        expect(result.success).toBe(false);
        expect(result.text).toBe('');
        expect(result.error).toBe('AI unavailable');
        sendMessageSpy.mockRestore();
    });

    it('returns a failure result when sendMessage throws', async () => {
        const sendMessageSpy = vi.spyOn(service, 'sendMessage').mockRejectedValue(
            new Error('Network failure'),
        );

        const result = await service.transform('fail');
        expect(result.success).toBe(false);
        expect(result.error).toBe('Network failure');
        sendMessageSpy.mockRestore();
    });

    it('returns empty text when response is undefined', async () => {
        const sendMessageSpy = vi.spyOn(service, 'sendMessage').mockResolvedValue({
            success: true,
            response: undefined,
        });

        const result = await service.transform('test');
        expect(result.success).toBe(true);
        expect(result.text).toBe('');
        sendMessageSpy.mockRestore();
    });

    it('passes working directory via options.cwd', async () => {
        const sendMessageSpy = vi.spyOn(service, 'sendMessage').mockResolvedValue({
            success: true,
            response: 'ok',
        });

        await service.transform('test', { cwd: '/my/project' });
        expect(sendMessageSpy).toHaveBeenCalledWith(
            expect.objectContaining({ workingDirectory: '/my/project' }),
        );
        sendMessageSpy.mockRestore();
    });
});
