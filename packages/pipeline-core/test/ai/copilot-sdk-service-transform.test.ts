/**
 * CopilotSDKService.transform() Tests
 *
 * Tests for the one-shot transform method that sends a prompt and
 * returns a parsed typed result.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CopilotSDKService, resetCopilotSDKService } from '../../src/copilot-sdk-wrapper/copilot-sdk-service';
import { setLogger, nullLogger } from '../../src/logger';
import { createMockSDKModule } from '../helpers/mock-sdk';

// Suppress logger output during tests
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
    });

    it('should return raw string when no parse function is provided', async () => {
        const sendMessageSpy = vi.spyOn(service, 'sendMessage').mockResolvedValue({
            success: true,
            response: 'Hello World',
        });

        const result = await service.transform('test prompt');
        expect(result).toBe('Hello World');
        sendMessageSpy.mockRestore();
    });

    it('should apply parse function and return typed result', async () => {
        const sendMessageSpy = vi.spyOn(service, 'sendMessage').mockResolvedValue({
            success: true,
            response: '42',
        });

        const result = await service.transform<number>('parse me', (raw) => parseInt(raw, 10));
        expect(result).toBe(42);
        sendMessageSpy.mockRestore();
    });

    it('should use gpt-4.1 as the default model', async () => {
        const sendMessageSpy = vi.spyOn(service, 'sendMessage').mockResolvedValue({
            success: true,
            response: 'ok',
        });

        await service.transform('test');
        expect(sendMessageSpy).toHaveBeenCalledWith(
            expect.objectContaining({ model: 'gpt-4.1' }),
        );
        sendMessageSpy.mockRestore();
    });

    it('should allow overriding the model via options', async () => {
        const sendMessageSpy = vi.spyOn(service, 'sendMessage').mockResolvedValue({
            success: true,
            response: 'ok',
        });

        await service.transform('test', undefined, { model: 'claude-sonnet-4' });
        expect(sendMessageSpy).toHaveBeenCalledWith(
            expect.objectContaining({ model: 'claude-sonnet-4' }),
        );
        sendMessageSpy.mockRestore();
    });

    it('should pass keepAlive: false for stateless calls', async () => {
        const sendMessageSpy = vi.spyOn(service, 'sendMessage').mockResolvedValue({
            success: true,
            response: 'ok',
        });

        await service.transform('test');
        expect(sendMessageSpy).toHaveBeenCalledWith(
            expect.objectContaining({ keepAlive: false }),
        );
        sendMessageSpy.mockRestore();
    });

    it('should propagate error from sendMessage', async () => {
        const sendMessageSpy = vi.spyOn(service, 'sendMessage').mockResolvedValue({
            success: false,
            error: 'AI unavailable',
        });

        await expect(service.transform('fail')).rejects.toThrow('AI unavailable');
        sendMessageSpy.mockRestore();
    });

    it('should propagate thrown errors from sendMessage', async () => {
        const sendMessageSpy = vi.spyOn(service, 'sendMessage').mockRejectedValue(
            new Error('Network failure'),
        );

        await expect(service.transform('fail')).rejects.toThrow('Network failure');
        sendMessageSpy.mockRestore();
    });

    it('should return empty string when response is undefined', async () => {
        const sendMessageSpy = vi.spyOn(service, 'sendMessage').mockResolvedValue({
            success: true,
            response: undefined,
        });

        const result = await service.transform('test');
        expect(result).toBe('');
        sendMessageSpy.mockRestore();
    });

    it('should pass working directory via options.cwd', async () => {
        const sendMessageSpy = vi.spyOn(service, 'sendMessage').mockResolvedValue({
            success: true,
            response: 'ok',
        });

        await service.transform('test', undefined, { cwd: '/my/project' });
        expect(sendMessageSpy).toHaveBeenCalledWith(
            expect.objectContaining({ workingDirectory: '/my/project' }),
        );
        sendMessageSpy.mockRestore();
    });
});
