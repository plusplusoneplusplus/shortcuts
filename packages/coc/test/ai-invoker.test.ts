/**
 * AI Invoker Tests
 *
 * Tests for the CLI AI invoker factory, dry-run invoker, and availability checking.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
    createDryRunAIInvoker,
    createCLIAIInvoker,
    checkAIAvailability,
} from '../src/ai-invoker';
import type { CLIAIInvokerOptions, AIAvailabilityResult } from '../src/ai-invoker';

// Module-level mock for getCopilotSDKService to capture SendMessageOptions
const mockSendMessageCapture = vi.fn().mockResolvedValue({ success: true, response: 'ok' });
const mockIsAvailableCapture = vi.fn().mockResolvedValue({ available: true });
const mockServiceCapture = {
    sendMessage: mockSendMessageCapture,
    isAvailable: mockIsAvailableCapture,
};

// Spy to track ToolCallCapture constructor calls
const mockCaptureConstructor = vi.fn();

vi.mock('@plusplusoneplusplus/pipeline-core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/pipeline-core')>();
    const RealCapture = actual.ToolCallCapture;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpyToolCallCapture = class extends RealCapture {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        constructor(...args: any[]) {
            super(...(args as ConstructorParameters<typeof RealCapture>));
            mockCaptureConstructor(...args);
        }
    };
    return {
        ...actual,
        getCopilotSDKService: () => mockServiceCapture,
        ToolCallCapture: SpyToolCallCapture,
    };
});

describe('AI Invoker', () => {
    // ========================================================================
    // Dry Run Invoker
    // ========================================================================

    describe('createDryRunAIInvoker', () => {
        it('should create an invoker function', () => {
            const invoker = createDryRunAIInvoker();
            expect(typeof invoker).toBe('function');
        });

        it('should return success for any prompt', async () => {
            const invoker = createDryRunAIInvoker();
            const result = await invoker('Test prompt');
            expect(result.success).toBe(true);
        });

        it('should return JSON response', async () => {
            const invoker = createDryRunAIInvoker();
            const result = await invoker('Test prompt');
            const parsed = JSON.parse(result.response);
            expect(parsed._dryRun).toBe(true);
        });

        it('should include prompt length in response', async () => {
            const invoker = createDryRunAIInvoker();
            const prompt = 'Hello, World!';
            const result = await invoker(prompt);
            const parsed = JSON.parse(result.response);
            expect(parsed._promptLength).toBe(prompt.length);
        });

        it('should include dry run message', async () => {
            const invoker = createDryRunAIInvoker();
            const result = await invoker('test');
            const parsed = JSON.parse(result.response);
            expect(parsed._message).toContain('Dry run');
        });

        it('should handle empty prompt', async () => {
            const invoker = createDryRunAIInvoker();
            const result = await invoker('');
            expect(result.success).toBe(true);
            const parsed = JSON.parse(result.response);
            expect(parsed._promptLength).toBe(0);
        });

        it('should handle long prompts', async () => {
            const invoker = createDryRunAIInvoker();
            const longPrompt = 'x'.repeat(100000);
            const result = await invoker(longPrompt);
            expect(result.success).toBe(true);
            const parsed = JSON.parse(result.response);
            expect(parsed._promptLength).toBe(100000);
        });

        it('should ignore invoker options', async () => {
            const invoker = createDryRunAIInvoker();
            const result = await invoker('test', { model: 'gpt-4', timeoutMs: 5000 });
            expect(result.success).toBe(true);
        });
    });

    // ========================================================================
    // CLI AI Invoker
    // ========================================================================

    describe('createCLIAIInvoker', () => {
        it('should create an invoker function', () => {
            const invoker = createCLIAIInvoker();
            expect(typeof invoker).toBe('function');
        });

        it('should create an invoker with options', () => {
            const options: CLIAIInvokerOptions = {
                model: 'gpt-4',
                approvePermissions: true,
                workingDirectory: '/tmp',
                timeoutMs: 30000,
                loadMcpConfig: false,
            };
            const invoker = createCLIAIInvoker(options);
            expect(typeof invoker).toBe('function');
        });

        it('should accept mcpServers option', () => {
            const options: CLIAIInvokerOptions = {
                loadMcpConfig: false,
                mcpServers: {
                    github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] },
                },
            };
            const invoker = createCLIAIInvoker(options);
            expect(typeof invoker).toBe('function');
        });

        it('should create an invoker with empty options', () => {
            const invoker = createCLIAIInvoker({});
            expect(typeof invoker).toBe('function');
        });

        // Note: Actually calling the invoker would require Copilot SDK to be available,
        // which won't be the case in CI/CD. The creation tests above verify the factory works.
    });

    // ========================================================================
    // AI Availability
    // ========================================================================

    describe('checkAIAvailability', () => {
        it('should return an availability result', async () => {
            const result = await checkAIAvailability();
            expect(result).toHaveProperty('available');
            expect(typeof result.available).toBe('boolean');
        });

        it('should include reason when not available', async () => {
            const result = await checkAIAvailability();
            // In test environment, SDK is likely not available
            if (!result.available) {
                expect(typeof result.reason).toBe('string');
            }
        });
    });

    // ========================================================================
    // mcpServers and loadDefaultMcpConfig SendMessageOptions
    // ========================================================================

    describe('mcpServers and loadDefaultMcpConfig in SendMessageOptions', () => {
        beforeEach(() => {
            mockSendMessageCapture.mockReset();
            mockSendMessageCapture.mockResolvedValue({ success: true, response: 'ok' });
        });

        it('should set loadDefaultMcpConfig=false and forward mcpServers when mcpServers is defined', async () => {
            const mcpServers = {
                github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] },
            };
            const invoker = createCLIAIInvoker({ mcpServers });
            await invoker('test prompt');

            expect(mockSendMessageCapture).toHaveBeenCalledOnce();
            const [sendOptions] = mockSendMessageCapture.mock.calls[0];
            expect(sendOptions.loadDefaultMcpConfig).toBe(false);
            expect(sendOptions.mcpServers).toEqual(mcpServers);
        });

        it('should set loadDefaultMcpConfig=false and forward empty mcpServers when mcpServers is {}', async () => {
            const invoker = createCLIAIInvoker({ mcpServers: {} });
            await invoker('test prompt');

            const [sendOptions] = mockSendMessageCapture.mock.calls[0];
            expect(sendOptions.loadDefaultMcpConfig).toBe(false);
            expect(sendOptions.mcpServers).toEqual({});
        });

        it('should preserve loadDefaultMcpConfig=true when mcpServers is undefined and loadMcpConfig is not set', async () => {
            const invoker = createCLIAIInvoker({});
            await invoker('test prompt');

            const [sendOptions] = mockSendMessageCapture.mock.calls[0];
            expect(sendOptions.loadDefaultMcpConfig).toBe(true);
            expect(sendOptions.mcpServers).toBeUndefined();
        });

        it('should respect loadMcpConfig=false when mcpServers is undefined', async () => {
            const invoker = createCLIAIInvoker({ loadMcpConfig: false });
            await invoker('test prompt');

            const [sendOptions] = mockSendMessageCapture.mock.calls[0];
            expect(sendOptions.loadDefaultMcpConfig).toBe(false);
            expect(sendOptions.mcpServers).toBeUndefined();
        });

        it('should override loadMcpConfig with loadDefaultMcpConfig=false when mcpServers is defined', async () => {
            // Even if loadMcpConfig is explicitly true, mcpServers presence takes precedence
            const mcpServers = { server1: { command: 'npx', args: ['server1'] } };
            const invoker = createCLIAIInvoker({ mcpServers, loadMcpConfig: true });
            await invoker('test prompt');

            const [sendOptions] = mockSendMessageCapture.mock.calls[0];
            expect(sendOptions.loadDefaultMcpConfig).toBe(false);
            expect(sendOptions.mcpServers).toEqual(mcpServers);
        });
    });

    // ========================================================================
    // onToolEvent forwarding
    // ========================================================================

    describe('onToolEvent forwarding', () => {
        beforeEach(() => {
            mockSendMessageCapture.mockReset();
            mockSendMessageCapture.mockResolvedValue({ success: true, response: 'ok' });
        });

        it('should forward onToolEvent from invokerOptions to SendMessageOptions', async () => {
            const handler = vi.fn();
            const invoker = createCLIAIInvoker({});
            await invoker('prompt', { onToolEvent: handler });

            expect(mockSendMessageCapture).toHaveBeenCalledOnce();
            const [sendOptions] = mockSendMessageCapture.mock.calls[0];
            // onToolEvent is now a composed function; verify caller's handler is invoked
            expect(typeof sendOptions.onToolEvent).toBe('function');
            const mockEvent = { type: 'tool-start' as const, toolName: 'grep', toolCallId: 'c1', parameters: {} };
            sendOptions.onToolEvent(mockEvent);
            expect(handler).toHaveBeenCalledWith(mockEvent);
        });

        it('should pass onToolEvent as capture handler to SendMessageOptions when not provided', async () => {
            const invoker = createCLIAIInvoker({});
            await invoker('prompt');

            expect(mockSendMessageCapture).toHaveBeenCalledOnce();
            const [sendOptions] = mockSendMessageCapture.mock.calls[0];
            // onToolEvent is now always set to the captureHandler
            expect(typeof sendOptions.onToolEvent).toBe('function');
        });

        it('should forward onToolEvent when other invokerOptions fields are also set', async () => {
            const handler = vi.fn();
            const invoker = createCLIAIInvoker({});
            await invoker('prompt', { model: 'gpt-4', onToolEvent: handler });

            expect(mockSendMessageCapture).toHaveBeenCalledOnce();
            const [sendOptions] = mockSendMessageCapture.mock.calls[0];
            expect(sendOptions.model).toBe('gpt-4');
            // onToolEvent is composed; verify caller's handler is invoked
            expect(typeof sendOptions.onToolEvent).toBe('function');
            const mockEvent = { type: 'tool-start' as const, toolName: 'grep', toolCallId: 'c1', parameters: {} };
            sendOptions.onToolEvent(mockEvent);
            expect(handler).toHaveBeenCalledWith(mockEvent);
        });
    });

    // ========================================================================
    // ToolCallCapture wiring
    // ========================================================================

    describe('ToolCallCapture wiring', () => {
        let tmpDir: string;

        beforeEach(async () => {
            mockSendMessageCapture.mockReset();
            mockSendMessageCapture.mockResolvedValue({ success: true, response: 'ok' });
            mockCaptureConstructor.mockReset();
            tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-invoker-capture-'));
        });

        afterEach(async () => {
            await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
        });

        it('ToolCallCapture is instantiated once per factory call', () => {
            createCLIAIInvoker({ cacheDataDir: tmpDir });
            createCLIAIInvoker({ cacheDataDir: tmpDir });
            expect(mockCaptureConstructor).toHaveBeenCalledTimes(2);
        });

        it('explore tool-complete event writes a raw file', async () => {
            const invoker = createCLIAIInvoker({ cacheDataDir: tmpDir });
            await invoker('test prompt');

            const [sendOptions] = mockSendMessageCapture.mock.calls[0];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const onToolEvent = sendOptions.onToolEvent as (e: any) => void;

            onToolEvent({ type: 'tool-start', toolName: 'task', toolCallId: 'tc1', parameters: { prompt: 'foo' } });
            onToolEvent({ type: 'tool-complete', toolName: 'task', toolCallId: 'tc1', result: 'some result' });

            await new Promise(r => setTimeout(r, 200));

            const rawDir = path.join(tmpDir, 'explore-cache', 'raw');
            const files = await fs.readdir(rawDir);
            expect(files.filter(f => f.endsWith('.json')).length).toBeGreaterThan(0);
        });

        it('non-explore tool events are NOT written', async () => {
            const invoker = createCLIAIInvoker({ cacheDataDir: tmpDir });
            await invoker('test prompt');

            const [sendOptions] = mockSendMessageCapture.mock.calls[0];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const onToolEvent = sendOptions.onToolEvent as (e: any) => void;

            onToolEvent({ type: 'tool-start', toolName: 'edit_file', toolCallId: 'tc2', parameters: { path: '/tmp/f.txt' } });
            onToolEvent({ type: 'tool-complete', toolName: 'edit_file', toolCallId: 'tc2', result: 'done' });

            await new Promise(r => setTimeout(r, 200));

            const rawDir = path.join(tmpDir, 'explore-cache', 'raw');
            let files: string[] = [];
            try { files = await fs.readdir(rawDir); } catch { /* dir may not exist */ }
            expect(files.filter(f => f.endsWith('.json')).length).toBe(0);
        });

        it('caller-supplied onToolEvent is also called and raw file is written', async () => {
            const callerHandler = vi.fn();
            const invoker = createCLIAIInvoker({ cacheDataDir: tmpDir });
            await invoker('test prompt', { onToolEvent: callerHandler });

            const [sendOptions] = mockSendMessageCapture.mock.calls[0];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const onToolEvent = sendOptions.onToolEvent as (e: any) => void;

            onToolEvent({ type: 'tool-start', toolName: 'task', toolCallId: 'tc3', parameters: { prompt: 'bar' } });
            onToolEvent({ type: 'tool-complete', toolName: 'task', toolCallId: 'tc3', result: 'result' });

            expect(callerHandler).toHaveBeenCalledTimes(2);

            await new Promise(r => setTimeout(r, 200));

            const rawDir = path.join(tmpDir, 'explore-cache', 'raw');
            const files = await fs.readdir(rawDir);
            expect(files.filter(f => f.endsWith('.json')).length).toBeGreaterThan(0);
        });

        it('createDryRunAIInvoker has no capture', () => {
            createDryRunAIInvoker();
            expect(mockCaptureConstructor).not.toHaveBeenCalled();
        });

        it('gitHash is forwarded to ToolCallCapture constructor options', () => {
            const gitHash = 'abc123deadbeef';
            createCLIAIInvoker({ cacheDataDir: tmpDir, gitHash });
            expect(mockCaptureConstructor).toHaveBeenCalledOnce();
            const constructorOptions = mockCaptureConstructor.mock.calls[0][2];
            expect(constructorOptions).toMatchObject({ gitHash });
        });
    });
});

