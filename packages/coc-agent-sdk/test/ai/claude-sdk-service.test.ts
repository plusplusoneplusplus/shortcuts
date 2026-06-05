/**
 * ClaudeSDKService tests
 *
 * Unit tests for the Claude SDK provider adapter, covering:
 * - Availability detection when SDK is not installed
 * - Availability detection when SDK is installed
 * - sendMessage streaming text
 * - sendMessage tool_use events
 * - sendMessage abort
 * - Unsupported operations (forkSession)
 * - Registry export and constants
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PassThrough, Writable } from 'stream';
import {
    ClaudeSDKService,
    extractClaudeAccessToken,
    mapClaudeAccountInfoToQuota,
    mapClaudeRateLimitInfoToQuota,
    mapOAuthUsageToQuota,
    registerClaudeSDKService,
} from '../../src/claude-sdk-service';
import {
    CLAUDE_PROVIDER,
    SDK_PROVIDER_CLAUDE,
    sdkServiceRegistry,
} from '../../src/sdk-service-registry';

// ============================================================================
// Module mock for @anthropic-ai/claude-agent-sdk
// ============================================================================

// The mock factory is hoisted; we control what dynamicImportModule returns.
vi.mock('../../src/sdk-esm-loader', () => ({
    dynamicImportModule: vi.fn(),
}));

vi.mock('child_process', () => ({
    spawn: vi.fn(),
}));

import { dynamicImportModule } from '../../src/sdk-esm-loader';
const mockDynamicImport = vi.mocked(dynamicImportModule);
const mockSpawn = vi.mocked(spawn);

// ============================================================================
// Helper: build an async generator from an array of messages
// ============================================================================

async function* makeMessages(messages: object[]): AsyncIterable<object> {
    for (const msg of messages) {
        yield msg;
    }
}

/** Wraps a message array as a query handle with optional control-method spies. */
function makeQueryHandle(
    messages: object[],
    accountInfoFn?: () => Promise<object>,
    supportedModelsFn?: () => Promise<object[]>,
    contextUsageFn?: () => Promise<object>,
) {
    const handle = {
        [Symbol.asyncIterator]() { return makeMessages(messages)[Symbol.asyncIterator](); },
        accountInfo: accountInfoFn ?? vi.fn<[], Promise<object>>().mockResolvedValue({}),
        supportedModels: supportedModelsFn ?? vi.fn<[], Promise<object[]>>().mockResolvedValue([]),
        return: vi.fn(async (value?: unknown) => ({ done: true as const, value })),
    } as {
        [Symbol.asyncIterator](): AsyncIterator<object>;
        accountInfo: () => Promise<object>;
        supportedModels: () => Promise<object[]>;
        getContextUsage?: () => Promise<object>;
        return: (value?: unknown) => Promise<{ done: true; value: unknown }>;
    };
    if (contextUsageFn) {
        handle.getContextUsage = contextUsageFn;
    }
    return handle;
}

class MockClaudeCliChild extends EventEmitter {
    public readonly stdout = new PassThrough();
    public readonly stdinWrites: string[] = [];
    public readonly stdin: Writable;
    public readonly kill = vi.fn(() => true);

    public constructor() {
        super();
        this.stdin = new Writable({
            write: (chunk, _encoding, callback) => {
                this.stdinWrites.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
                callback();
            },
        });
    }

    public writeStdoutLine(line: string): void {
        this.stdout.write(line + '\n');
    }
}

function mockClaudeCliSpawn(): MockClaudeCliChild {
    const child = new MockClaudeCliChild();
    mockSpawn.mockReturnValueOnce(child as any);
    return child;
}

async function waitForClaudeCliSpawn(child?: MockClaudeCliChild): Promise<void> {
    for (let i = 0; i < 10; i++) {
        await Promise.resolve();
        if (!child || child.listenerCount('error') > 0) return;
    }
}

function stubProcessPlatform(platform: NodeJS.Platform): () => void {
    const original = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: platform, configurable: true });
    return () => {
        if (original) {
            Object.defineProperty(process, 'platform', original);
        }
    };
}

// ============================================================================
// Registry Constants
// ============================================================================

describe('Claude provider constants', () => {
    it('CLAUDE_PROVIDER is "claude"', () => {
        expect(CLAUDE_PROVIDER).toBe('claude');
    });

    it('SDK_PROVIDER_CLAUDE equals CLAUDE_PROVIDER', () => {
        expect(SDK_PROVIDER_CLAUDE).toBe(CLAUDE_PROVIDER);
    });
});

// ============================================================================
// registerClaudeSDKService
// ============================================================================

describe('registerClaudeSDKService', () => {
    afterEach(() => {
        sdkServiceRegistry.unregister(CLAUDE_PROVIDER);
    });

    it('registers a ClaudeSDKService under "claude"', () => {
        const svc = registerClaudeSDKService();
        expect(sdkServiceRegistry.has(CLAUDE_PROVIDER)).toBe(true);
        expect(sdkServiceRegistry.get(CLAUDE_PROVIDER)).toBe(svc);
    });

    it('returns a ClaudeSDKService instance', () => {
        const svc = registerClaudeSDKService();
        expect(svc).toBeInstanceOf(ClaudeSDKService);
    });
});

// ============================================================================
// isAvailable
// ============================================================================

describe('ClaudeSDKService.isAvailable', () => {
    let svc: ClaudeSDKService;

    beforeEach(() => {
        svc = new ClaudeSDKService();
        mockDynamicImport.mockReset();
    });

    afterEach(() => {
        svc.dispose();
    });

    it('returns unavailable with install guidance when SDK is not installed', async () => {
        mockDynamicImport.mockRejectedValueOnce(new Error("Cannot find module '@anthropic-ai/claude-agent-sdk'"));
        const result = await svc.isAvailable();
        expect(result.available).toBe(false);
        expect(result.error).toMatch(/@anthropic-ai\/claude-agent-sdk/);
        expect(result.error).toMatch(/npm install/);
    });

    it('imports the Claude Agent SDK package name', async () => {
        const queryFn = vi.fn();
        mockDynamicImport.mockResolvedValueOnce({ query: queryFn });
        await svc.isAvailable();
        expect(mockDynamicImport).toHaveBeenCalledWith('@anthropic-ai/claude-agent-sdk');
    });

    it('returns unavailable when SDK does not export query', async () => {
        mockDynamicImport.mockResolvedValueOnce({ notQuery: 'foo' });
        const result = await svc.isAvailable();
        expect(result.available).toBe(false);
        // When SDK loads but has no query fn, the error message mentions `query`
        expect(result.error).toMatch(/query/i);
    });

    it('returns available when SDK exports query as named export', async () => {
        const queryFn = vi.fn();
        mockDynamicImport.mockResolvedValueOnce({ query: queryFn });
        const result = await svc.isAvailable();
        expect(result.available).toBe(true);
    });

    it('returns available when SDK exports query via default.query', async () => {
        const queryFn = vi.fn();
        mockDynamicImport.mockResolvedValueOnce({ default: { query: queryFn } });
        const result = await svc.isAvailable();
        expect(result.available).toBe(true);
    });

    it('caches availability result on subsequent calls', async () => {
        const queryFn = vi.fn();
        mockDynamicImport.mockResolvedValueOnce({ query: queryFn });
        await svc.isAvailable();
        await svc.isAvailable();
        expect(mockDynamicImport).toHaveBeenCalledTimes(1);
    });

    it('clearAvailabilityCache forces re-check', async () => {
        const queryFn = vi.fn();
        mockDynamicImport.mockResolvedValue({ query: queryFn });
        await svc.isAvailable();
        svc.clearAvailabilityCache();
        await svc.isAvailable();
        expect(mockDynamicImport).toHaveBeenCalledTimes(2);
    });

    it('returns unavailable after dispose', async () => {
        svc.dispose();
        const result = await svc.isAvailable();
        expect(result.available).toBe(false);
        expect(result.error).toMatch(/disposed/);
    });
});

// ============================================================================
// listModels
// ============================================================================

describe('ClaudeSDKService.listModels', () => {
    let svc: ClaudeSDKService;
    const queryFn = vi.fn();

    beforeEach(() => {
        svc = new ClaudeSDKService();
        mockDynamicImport.mockReset();
        mockSpawn.mockReset();
        queryFn.mockReset();
        mockDynamicImport.mockResolvedValue({ query: queryFn });
    });

    afterEach(() => {
        svc.dispose();
    });

    it('spawns Claude CLI stream protocol and maps initialize models', async () => {
        const child = mockClaudeCliSpawn();
        const modelsPromise = svc.listModels();
        await waitForClaudeCliSpawn(child);

        child.writeStdoutLine('Claude Code starting');
        child.writeStdoutLine(JSON.stringify({
            type: 'control_response',
            request_id: 'init-1',
            response: {
                response: {
                    models: [
                        { value: 'claude-opus-4-7', displayName: 'Claude Opus 4.7' },
                        { value: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6' },
                    ],
                },
            },
        }));

        const models = await modelsPromise;

        expect(mockSpawn).toHaveBeenCalledWith(expect.stringMatching(/claude(\.exe)?$/), [
            '--output-format',
            'stream-json',
            '--verbose',
            '--input-format',
            'stream-json',
            '--setting-sources=',
            '--tools',
            '',
        ], expect.objectContaining({ stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true }));
        expect(child.stdinWrites.join('')).toBe(
            JSON.stringify({
                type: 'control_request',
                request_id: 'init-1',
                request: { subtype: 'initialize' },
            }) + '\n',
        );
        expect(models).toContainEqual({ id: 'claude-opus-4-7', name: 'Claude Opus 4.7' });
        expect(models).toContainEqual({ id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' });
        expect(models).not.toContainEqual({ id: 'claude-provider-default', name: 'Claude Provider Default' });
        expect(queryFn).not.toHaveBeenCalled();
        expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('maps initialize models when the CLI nests request_id inside response', async () => {
        // Regression: the real Claude CLI returns the init reply with `request_id`
        // and `subtype` nested inside `response`, not at the top level.
        const child = mockClaudeCliSpawn();
        const modelsPromise = svc.listModels();
        await waitForClaudeCliSpawn(child);

        child.writeStdoutLine(JSON.stringify({
            type: 'control_response',
            response: {
                subtype: 'success',
                request_id: 'init-1',
                response: {
                    models: [
                        { value: 'default', displayName: 'Default (recommended)' },
                        { value: 'opus', displayName: 'Opus' },
                        { value: 'haiku', displayName: 'Haiku' },
                    ],
                },
            },
        }));

        const models = await modelsPromise;

        expect(models).toEqual([
            { id: 'default', name: 'Default (recommended)' },
            { id: 'opus', name: 'Opus' },
            { id: 'haiku', name: 'Haiku' },
        ]);
        expect(models).not.toContainEqual({ id: 'claude-provider-default', name: 'Claude Provider Default' });
        expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('ignores control responses whose nested request_id does not match init-1', async () => {
        const child = mockClaudeCliSpawn();
        const modelsPromise = svc.listModels();
        await waitForClaudeCliSpawn(child);

        // Nested request_id for a different request must not be treated as init-1.
        child.writeStdoutLine(JSON.stringify({
            type: 'control_response',
            response: {
                request_id: 'other-request',
                response: { models: [{ value: 'ignored', displayName: 'Ignored' }] },
            },
        }));
        child.writeStdoutLine(JSON.stringify({
            type: 'control_response',
            response: {
                request_id: 'init-1',
                response: { models: [{ value: 'opus', displayName: 'Opus' }] },
            },
        }));

        await expect(modelsPromise).resolves.toEqual([
            { id: 'opus', name: 'Opus' },
        ]);
    });

    it('maps supportedEffortLevels into supportedReasoningEfforts (dropping max/unknown)', async () => {
        const child = mockClaudeCliSpawn();
        const modelsPromise = svc.listModels();
        await waitForClaudeCliSpawn(child);

        child.writeStdoutLine(JSON.stringify({
            type: 'control_response',
            request_id: 'init-1',
            response: {
                response: {
                    models: [
                        // Opus advertises xhigh + max; max is dropped, order canonicalized.
                        { value: 'opus', displayName: 'Opus', supportedEffortLevels: ['max', 'high', 'low', 'medium', 'xhigh'] },
                        // Sonnet/default advertises max but not xhigh.
                        { value: 'default', displayName: 'Default (recommended)', supportedEffortLevels: ['low', 'medium', 'high', 'max'] },
                        // Haiku advertises none → field omitted.
                        { value: 'haiku', displayName: 'Haiku' },
                        // Unknown levels are filtered out entirely → field omitted.
                        { value: 'weird', displayName: 'Weird', supportedEffortLevels: ['turbo', 'max'] },
                    ],
                },
            },
        }));

        const models = await modelsPromise;

        expect(models).toEqual([
            { id: 'opus', name: 'Opus', supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'] },
            { id: 'default', name: 'Default (recommended)', supportedReasoningEfforts: ['low', 'medium', 'high'] },
            { id: 'haiku', name: 'Haiku' },
            { id: 'weird', name: 'Weird' },
        ]);
    });

    it('ignores malformed stdout until the matching initialize response arrives', async () => {
        const child = mockClaudeCliSpawn();
        const modelsPromise = svc.listModels();
        await waitForClaudeCliSpawn(child);

        child.writeStdoutLine('{not-json');
        child.writeStdoutLine(JSON.stringify({
            type: 'control_response',
            request_id: 'other-request',
            response: { response: { models: [{ value: 'ignored', displayName: 'Ignored' }] } },
        }));
        child.writeStdoutLine(JSON.stringify({
            type: 'control_response',
            request_id: 'init-1',
            response: {
                response: {
                    models: [{ value: 'claude-haiku-4-5', displayName: 'Claude Haiku 4.5' }],
                },
            },
        }));

        await expect(modelsPromise).resolves.toEqual([
            { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' },
        ]);
    });

    it('falls back to curated models when Claude CLI spawn fails', async () => {
        const child = mockClaudeCliSpawn();
        const modelsPromise = svc.listModels();
        await waitForClaudeCliSpawn(child);
        child.emit('error', new Error('spawn failed'));

        const models = await modelsPromise;

        expect(models).toContainEqual({ id: 'claude-opus-4-7', name: 'Claude Opus 4.7' });
        expect(models).toContainEqual({ id: 'claude-opus-4-6', name: 'Claude Opus 4.6' });
        expect(models).toContainEqual({ id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' });
        expect(models).toContainEqual({ id: 'claude-provider-default', name: 'Claude Provider Default' });
        expect(queryFn).not.toHaveBeenCalledWith({ prompt: '' });
        expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('falls back to curated models when Claude CLI initialize response is malformed', async () => {
        const child = mockClaudeCliSpawn();
        const modelsPromise = svc.listModels();
        await waitForClaudeCliSpawn(child);

        child.writeStdoutLine(JSON.stringify({
            type: 'control_response',
            request_id: 'init-1',
            response: { response: { models: [{ value: '', displayName: '' }] } },
        }));

        const models = await modelsPromise;

        expect(models).toContainEqual({ id: 'claude-provider-default', name: 'Claude Provider Default' });
        expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('falls back to curated models and cleans up when Claude CLI times out', async () => {
        vi.useFakeTimers();
        try {
            const child = mockClaudeCliSpawn();
            const modelsPromise = svc.listModels();
            await waitForClaudeCliSpawn(child);

            await vi.advanceTimersByTimeAsync(15_000);
            const models = await modelsPromise;

            expect(models).toContainEqual({ id: 'claude-provider-default', name: 'Claude Provider Default' });
            expect(child.kill).toHaveBeenCalledWith('SIGTERM');
        } finally {
            vi.useRealTimers();
        }
    });
});

// ============================================================================
// sendMessage
// ============================================================================

describe('ClaudeSDKService.sendMessage', () => {
    let svc: ClaudeSDKService;
    const queryFn = vi.fn();

    beforeEach(() => {
        svc = new ClaudeSDKService();
        mockDynamicImport.mockReset();
        queryFn.mockReset();
        mockDynamicImport.mockResolvedValue({ query: queryFn });
    });

    afterEach(() => {
        svc.dispose();
    });

    it('streams text chunks from assistant messages', async () => {
        queryFn.mockReturnValueOnce(makeMessages([
            {
                type: 'assistant',
                message: { content: [{ type: 'text', text: 'Hello' }, { type: 'text', text: ' world' }] },
            },
            { type: 'result', subtype: 'success', result: 'Hello world' },
        ]));

        const chunks: string[] = [];
        const result = await svc.sendMessage({
            prompt: 'say hello',
            onStreamingChunk: (c) => { if (c) chunks.push(c); },
        });

        expect(result.success).toBe(true);
        expect(chunks).toEqual(['Hello', ' world']);
        expect(result.response).toBe('Hello world');
    });

    it('maps Claude result usage into the shared TokenUsage shape', async () => {
        queryFn.mockReturnValueOnce(makeMessages([
            {
                type: 'assistant',
                message: { content: [{ type: 'text', text: 'Hello' }] },
            },
            {
                type: 'result',
                subtype: 'success',
                result: 'Hello',
                total_cost_usd: 0.0123,
                duration_ms: 1400,
                num_turns: 2,
                usage: {
                    input_tokens: 100,
                    output_tokens: 35,
                    cache_creation_input_tokens: 12,
                    cache_read_input_tokens: 50,
                },
            },
        ]));

        const result = await svc.sendMessage({ prompt: 'say hello' });

        expect(result.success).toBe(true);
        expect(result.tokenUsage).toEqual({
            inputTokens: 100,
            outputTokens: 35,
            cacheReadTokens: 50,
            cacheWriteTokens: 12,
            totalTokens: 135,
            cost: 0.0123,
            duration: 1400,
            turnCount: 2,
        });
    });

    it('enriches Claude token usage with context window breakdown when available', async () => {
        queryFn.mockReturnValueOnce(makeQueryHandle([
            {
                type: 'result',
                subtype: 'success',
                result: 'done',
                usage: {
                    input_tokens: 10,
                    output_tokens: 5,
                    cache_creation_input_tokens: 2,
                    cache_read_input_tokens: 3,
                },
            },
        ], undefined, undefined, async () => ({
            totalTokens: 2400,
            maxTokens: 200000,
            systemPromptSections: [
                { name: 'core', tokens: 100 },
                { name: 'policy', tokens: 25 },
            ],
            systemTools: [{ name: 'Read', tokens: 40 }],
            mcpTools: [{ name: 'ask_user', tokens: 30 }],
            deferredBuiltinTools: [{ name: 'Bash', tokens: 5 }],
            messageBreakdown: {
                toolCallTokens: 11,
                toolResultTokens: 12,
                attachmentTokens: 13,
                assistantMessageTokens: 14,
                userMessageTokens: 15,
                redirectedContextTokens: 16,
                unattributedTokens: 17,
            },
        })));

        const result = await svc.sendMessage({ prompt: 'test' });

        expect(result.success).toBe(true);
        expect(result.tokenUsage).toEqual({
            inputTokens: 10,
            outputTokens: 5,
            cacheReadTokens: 3,
            cacheWriteTokens: 2,
            totalTokens: 15,
            turnCount: 1,
            tokenLimit: 200000,
            currentTokens: 2400,
            systemTokens: 125,
            toolDefinitionsTokens: 75,
            conversationTokens: 98,
        });
    });

    it('uses Claude context apiUsage when the result event omits usage totals', async () => {
        queryFn.mockReturnValueOnce(makeQueryHandle([
            { type: 'result', subtype: 'success', result: 'done' },
        ], undefined, undefined, async () => ({
            totalTokens: 300,
            maxTokens: 1000,
            apiUsage: {
                input_tokens: 20,
                output_tokens: 10,
                cache_creation_input_tokens: 4,
                cache_read_input_tokens: 6,
            },
        })));

        const result = await svc.sendMessage({ prompt: 'test' });

        expect(result.success).toBe(true);
        expect(result.tokenUsage).toEqual({
            inputTokens: 20,
            outputTokens: 10,
            cacheReadTokens: 6,
            cacheWriteTokens: 4,
            totalTokens: 30,
            turnCount: 1,
            tokenLimit: 1000,
            currentTokens: 300,
        });
    });

    it('keeps Claude result usage when context usage lookup fails', async () => {
        queryFn.mockReturnValueOnce(makeQueryHandle([
            {
                type: 'result',
                subtype: 'success',
                result: 'done',
                usage: {
                    input_tokens: 5,
                    output_tokens: 7,
                    cache_creation_input_tokens: 0,
                    cache_read_input_tokens: 0,
                },
            },
        ], undefined, undefined, async () => {
            throw new Error('context unavailable');
        }));

        const result = await svc.sendMessage({ prompt: 'test' });

        expect(result.success).toBe(true);
        expect(result.tokenUsage).toEqual({
            inputTokens: 5,
            outputTokens: 7,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: 12,
            turnCount: 1,
        });
    });

    it('emits tool-start for tool_use blocks without fabricating argument JSON as the result', async () => {
        queryFn.mockReturnValueOnce(makeMessages([
            {
                type: 'assistant',
                message: {
                    content: [
                        { type: 'tool_use', id: 'tc-1', name: 'read_file', input: { path: '/foo.ts' } },
                    ],
                },
            },
            { type: 'result', subtype: 'success' },
        ]));

        const toolEvents: object[] = [];
        await svc.sendMessage({
            prompt: 'read file',
            onToolEvent: (e) => toolEvents.push(e),
        });

        expect(toolEvents).toHaveLength(1);
        expect((toolEvents[0] as any).type).toBe('tool-start');
        expect((toolEvents[0] as any).toolName).toBe('read_file');
    });

    it('completes Claude tools from tool_result blocks with real output text', async () => {
        queryFn.mockReturnValueOnce(makeMessages([
            {
                type: 'assistant',
                message: {
                    content: [
                        { type: 'tool_use', id: 'tc-commit', name: 'Bash', input: { command: 'git commit -m "fix: stuff"' } },
                    ],
                },
            },
            {
                type: 'user',
                message: {
                    content: [
                        {
                            type: 'tool_result',
                            tool_use_id: 'tc-commit',
                            content: '[main abc1234] fix: stuff\n 1 file changed, 1 insertion(+)',
                        },
                    ],
                },
            },
            { type: 'result', subtype: 'success' },
        ]));

        const toolEvents: object[] = [];
        const result = await svc.sendMessage({
            prompt: 'commit',
            onToolEvent: (e) => toolEvents.push(e),
        });

        expect(toolEvents).toHaveLength(2);
        expect(toolEvents[0]).toMatchObject({
            type: 'tool-start',
            toolCallId: 'tc-commit',
            toolName: 'Bash',
            parameters: { command: 'git commit -m "fix: stuff"' },
        });
        expect(toolEvents[1]).toMatchObject({
            type: 'tool-complete',
            toolCallId: 'tc-commit',
            toolName: 'Bash',
            result: '[main abc1234] fix: stuff\n 1 file changed, 1 insertion(+)',
        });
        expect(result.toolCalls?.[0]).toMatchObject({
            id: 'tc-commit',
            name: 'Bash',
            status: 'completed',
            args: { command: 'git commit -m "fix: stuff"' },
            result: '[main abc1234] fix: stuff\n 1 file changed, 1 insertion(+)',
        });
    });

    it('stringifies structured Claude Bash tool results from stdout and stderr', async () => {
        queryFn.mockReturnValueOnce(makeMessages([
            {
                type: 'assistant',
                message: {
                    content: [
                        { type: 'tool_use', id: 'tc-bash', name: 'Bash', input: { command: 'npm test' } },
                    ],
                },
            },
            {
                type: 'user',
                message: {
                    content: [
                        {
                            type: 'tool_result',
                            tool_use_id: 'tc-bash',
                            content: { stdout: 'tests passed', stderr: 'warning only', interrupted: false },
                        },
                    ],
                },
            },
            { type: 'result', subtype: 'success' },
        ]));

        const toolEvents: object[] = [];
        const result = await svc.sendMessage({
            prompt: 'run tests',
            onToolEvent: (e) => toolEvents.push(e),
        });

        expect(toolEvents[1]).toMatchObject({
            type: 'tool-complete',
            result: 'tests passed\nwarning only',
        });
        expect(result.toolCalls?.[0].result).toBe('tests passed\nwarning only');
    });

    it('completes Claude tools from top-level tool_use_result payloads', async () => {
        queryFn.mockReturnValueOnce(makeMessages([
            {
                type: 'assistant',
                message: {
                    content: [
                        { type: 'tool_use', id: 'tc-top-level', name: 'Bash', input: { command: 'git status' } },
                    ],
                },
            },
            {
                type: 'user',
                parent_tool_use_id: 'tc-top-level',
                tool_use_result: { stdout: 'nothing to commit', stderr: '', interrupted: false },
            },
            { type: 'result', subtype: 'success' },
        ]));

        const result = await svc.sendMessage({ prompt: 'status' });

        expect(result.toolCalls?.[0]).toMatchObject({
            id: 'tc-top-level',
            status: 'completed',
            result: 'nothing to commit',
        });
    });

    it('marks Claude tool_result blocks with is_error as failed', async () => {
        queryFn.mockReturnValueOnce(makeMessages([
            {
                type: 'assistant',
                message: {
                    content: [
                        { type: 'tool_use', id: 'tc-fail', name: 'Bash', input: { command: 'false' } },
                    ],
                },
            },
            {
                type: 'user',
                message: {
                    content: [
                        {
                            type: 'tool_result',
                            tool_use_id: 'tc-fail',
                            content: 'Command failed with exit code 1',
                            is_error: true,
                        },
                    ],
                },
            },
            { type: 'result', subtype: 'success' },
        ]));

        const toolEvents: object[] = [];
        const result = await svc.sendMessage({
            prompt: 'fail',
            onToolEvent: (e) => toolEvents.push(e),
        });

        expect(toolEvents[1]).toMatchObject({
            type: 'tool-failed',
            toolCallId: 'tc-fail',
            error: 'Command failed with exit code 1',
        });
        expect(result.toolCalls?.[0]).toMatchObject({
            status: 'failed',
            error: 'Command failed with exit code 1',
        });
    });

    it('returns failure when result subtype is not success', async () => {
        queryFn.mockReturnValueOnce(makeMessages([
            { type: 'result', subtype: 'error_during_execution', result: 'something went wrong' },
        ]));

        const result = await svc.sendMessage({ prompt: 'fail me' });
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/something went wrong/);
    });

    it('returns failure when request is already aborted', async () => {
        const controller = new AbortController();
        controller.abort();

        const result = await svc.sendMessage({ prompt: 'test', signal: controller.signal });
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/aborted/i);
    });

    it('aborts the running session when abortSession is called', async () => {
        let sessionId = '';

        queryFn.mockImplementationOnce((callOptions: { abortController?: AbortController }) => {
            const ac = callOptions.abortController;
            return {
                [Symbol.asyncIterator]: async function* () {
                    // Yield once so sendMessage enters the loop and fires onSessionCreated.
                    yield { type: 'system', subtype: 'init' };
                    // Block until the AbortController fires, then throw so the loop exits.
                    await new Promise<void>((_, reject) => {
                        if (ac?.signal.aborted) { reject(new Error('Aborted')); return; }
                        ac?.signal.addEventListener('abort', () => reject(new Error('Aborted')));
                    });
                },
            };
        });

        const sendPromise = svc.sendMessage({
            prompt: 'hang',
            onSessionCreated: (id) => { sessionId = id; },
        });

        // Yield control so onSessionCreated fires.
        await new Promise((r) => setTimeout(r, 0));
        expect(sessionId).toBeTruthy();

        // Now abort the session.
        const aborted = await svc.abortSession(sessionId);
        expect(aborted).toBe(true);
        expect(svc.hasActiveSession(sessionId)).toBe(false);

        // The send should resolve (with an error since the generator threw).
        const result = await sendPromise;
        expect(result).toBeDefined();
    }, 5000);

    it('returns unavailable error when SDK is not installed', async () => {
        mockDynamicImport.mockRejectedValueOnce(new Error("Cannot find module '@anthropic-ai/claude-agent-sdk'"));
        const result = await svc.sendMessage({ prompt: 'hi' });
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/npm install/);
    });

    it('passes workingDirectory through to the query options', async () => {
        queryFn.mockReturnValueOnce(makeMessages([
            { type: 'result', subtype: 'success' },
        ]));

        await svc.sendMessage({ prompt: 'test', workingDirectory: '/my/project' });

        expect(queryFn).toHaveBeenCalledWith(
            expect.objectContaining({
                options: expect.objectContaining({ cwd: '/my/project' }),
            }),
        );
    });

    it('always grants access to ~/.coc and the system temp dir via additionalDirectories', async () => {
        queryFn.mockReturnValueOnce(makeMessages([
            { type: 'result', subtype: 'success' },
        ]));

        await svc.sendMessage({ prompt: 'test', workingDirectory: '/my/project' });

        const dirs: string[] = queryFn.mock.calls[0][0].options.additionalDirectories;
        expect(dirs).toContain(path.join(os.homedir(), '.coc'));
        expect(dirs).toContain(path.resolve(os.tmpdir()));
    });

    it('includes caller-provided additionalDirectories and de-duplicates them', async () => {
        queryFn.mockReturnValueOnce(makeMessages([
            { type: 'result', subtype: 'success' },
        ]));

        const cocDir = path.join(os.homedir(), '.coc');
        await svc.sendMessage({
            prompt: 'test',
            additionalDirectories: ['/extra/dir', cocDir],
        });

        const dirs: string[] = queryFn.mock.calls[0][0].options.additionalDirectories;
        expect(dirs).toContain(path.resolve('/extra/dir'));
        expect(dirs).toContain(cocDir);
        expect(dirs).toContain(path.resolve(os.tmpdir()));
        // ~/.coc supplied by caller must not be duplicated by the auto-injected entry.
        expect(dirs.filter((d) => d === cocDir)).toHaveLength(1);
    });

    it('creates new Claude sessions with the caller-visible sessionId', async () => {
        queryFn.mockReturnValueOnce(makeMessages([
            { type: 'result', subtype: 'success' },
        ]));

        let createdSessionId = '';
        const result = await svc.sendMessage({
            prompt: 'start session',
            onSessionCreated: (id) => { createdSessionId = id; },
        });

        const callOptions = queryFn.mock.calls[0][0].options;
        expect(result.success).toBe(true);
        expect(createdSessionId).toBeTruthy();
        expect(callOptions.sessionId).toBe(createdSessionId);
        expect(callOptions.resume).toBeUndefined();
        expect(result.sessionId).toBe(createdSessionId);
    });

    it('resumes existing Claude sessions instead of starting a fresh transcript', async () => {
        queryFn.mockReturnValueOnce(makeMessages([
            { type: 'result', subtype: 'success', session_id: 'existing-session' },
        ]));

        const result = await svc.sendMessage({
            prompt: 'follow up',
            sessionId: 'existing-session',
        });

        const callOptions = queryFn.mock.calls[0][0].options;
        expect(result.success).toBe(true);
        expect(callOptions.resume).toBe('existing-session');
        expect(callOptions.sessionId).toBeUndefined();
        expect(result.sessionId).toBe('existing-session');
    });

    it('persists the provider-emitted session_id when Claude returns one', async () => {
        queryFn.mockReturnValueOnce(makeMessages([
            { type: 'system', subtype: 'init', session_id: 'provider-session' },
            { type: 'result', subtype: 'success', session_id: 'provider-session' },
        ]));

        const createdSessionIds: string[] = [];
        const result = await svc.sendMessage({
            prompt: 'start session',
            onSessionCreated: (id) => { createdSessionIds.push(id); },
        });

        expect(result.success).toBe(true);
        expect(createdSessionIds).toHaveLength(2);
        expect(createdSessionIds[0]).toBeTruthy();
        expect(createdSessionIds[1]).toBe('provider-session');
        expect(result.sessionId).toBe('provider-session');
    });

    it('uses Claude bypass permissions for autopilot mode', async () => {
        queryFn.mockReturnValueOnce(makeMessages([
            { type: 'result', subtype: 'success' },
        ]));

        await svc.sendMessage({ prompt: 'do the work', mode: 'autopilot' });

        expect(queryFn).toHaveBeenCalledWith(
            expect.objectContaining({
                options: expect.objectContaining({
                    permissionMode: 'bypassPermissions',
                    allowDangerouslySkipPermissions: true,
                }),
            }),
        );
    });

    it('uses Claude plan permission mode for plan mode', async () => {
        queryFn.mockReturnValueOnce(makeMessages([
            { type: 'result', subtype: 'success' },
        ]));

        await svc.sendMessage({ prompt: 'make a plan', mode: 'plan' });

        expect(queryFn).toHaveBeenCalledWith(
            expect.objectContaining({
                options: expect.objectContaining({
                    permissionMode: 'plan',
                }),
            }),
        );
        expect(queryFn.mock.calls[0][0].options.allowDangerouslySkipPermissions).toBeUndefined();
    });

    it('uses acceptEdits permission mode for interactive mode', async () => {
        queryFn.mockReturnValueOnce(makeMessages([
            { type: 'result', subtype: 'success' },
        ]));

        await svc.sendMessage({ prompt: 'answer this', mode: 'interactive' });

        expect(queryFn.mock.calls[0][0].options.permissionMode).toBe('acceptEdits');
        expect(queryFn.mock.calls[0][0].options.allowDangerouslySkipPermissions).toBeUndefined();
    });

    it('uses acceptEdits permission mode when mode is undefined', async () => {
        queryFn.mockReturnValueOnce(makeMessages([
            { type: 'result', subtype: 'success' },
        ]));

        await svc.sendMessage({ prompt: 'answer this' });

        expect(queryFn.mock.calls[0][0].options.permissionMode).toBe('acceptEdits');
        expect(queryFn.mock.calls[0][0].options.allowDangerouslySkipPermissions).toBeUndefined();
    });

    it('passes Claude model IDs through but drops Copilot model IDs', async () => {
        queryFn.mockReturnValue(makeMessages([
            { type: 'result', subtype: 'success' },
        ]));

        await svc.sendMessage({ prompt: 'test', model: 'claude-sonnet-4-5' });
        expect(queryFn).toHaveBeenCalledWith(
            expect.objectContaining({ options: expect.objectContaining({ model: 'claude-sonnet-4-5' }) }),
        );

        queryFn.mockReset();
        queryFn.mockReturnValue(makeMessages([{ type: 'result', subtype: 'success' }]));

        await svc.sendMessage({ prompt: 'test', model: 'gpt-4.1' });
        const callArgs = queryFn.mock.calls[0][0];
        expect(callArgs.options?.model).toBeUndefined();
    });

    it('passes short Claude Code family aliases through unchanged', async () => {
        queryFn.mockReturnValue(makeMessages([{ type: 'result', subtype: 'success' }]));

        for (const alias of ['opus', 'sonnet', 'haiku']) {
            queryFn.mockReset();
            queryFn.mockReturnValue(makeMessages([{ type: 'result', subtype: 'success' }]));
            await svc.sendMessage({ prompt: 'test', model: alias });
            expect(queryFn).toHaveBeenLastCalledWith(
                expect.objectContaining({ options: expect.objectContaining({ model: alias }) }),
            );
        }
    });

    it('drops non-Claude short words that are not valid aliases', async () => {
        queryFn.mockReturnValue(makeMessages([{ type: 'result', subtype: 'success' }]));

        await svc.sendMessage({ prompt: 'test', model: 'gpt' });
        const callArgs = queryFn.mock.calls[0][0];
        expect(callArgs.options?.model).toBeUndefined();
    });

    it('normalizes dotted CoC Claude model IDs to Claude Code model IDs', async () => {
        queryFn.mockReturnValue(makeMessages([
            { type: 'result', subtype: 'success' },
        ]));

        await svc.sendMessage({ prompt: 'test', model: 'claude-sonnet-4.6' });
        expect(queryFn).toHaveBeenLastCalledWith(
            expect.objectContaining({ options: expect.objectContaining({ model: 'claude-sonnet-4-6' }) }),
        );

        await svc.sendMessage({ prompt: 'test', model: 'claude-haiku-4.5' });
        expect(queryFn).toHaveBeenLastCalledWith(
            expect.objectContaining({ options: expect.objectContaining({ model: 'claude-haiku-4-5' }) }),
        );

        await svc.sendMessage({ prompt: 'test', model: 'claude-opus-4.6' });
        expect(queryFn).toHaveBeenLastCalledWith(
            expect.objectContaining({ options: expect.objectContaining({ model: 'claude-opus-4-6' }) }),
        );
    });

    it('forwards each supported reasoning effort as the query effort option', async () => {
        for (const effort of ['low', 'medium', 'high', 'xhigh'] as const) {
            queryFn.mockReset();
            queryFn.mockReturnValue(makeMessages([{ type: 'result', subtype: 'success' }]));
            await svc.sendMessage({ prompt: 'test', reasoningEffort: effort });
            expect(queryFn).toHaveBeenLastCalledWith(
                expect.objectContaining({ options: expect.objectContaining({ effort }) }),
            );
        }
    });

    it('normalizes reasoning effort casing/whitespace before forwarding', async () => {
        queryFn.mockReturnValue(makeMessages([{ type: 'result', subtype: 'success' }]));

        await svc.sendMessage({ prompt: 'test', reasoningEffort: '  XHigh ' as never });
        expect(queryFn).toHaveBeenLastCalledWith(
            expect.objectContaining({ options: expect.objectContaining({ effort: 'xhigh' }) }),
        );
    });

    it('omits the effort option when no reasoning effort is requested', async () => {
        queryFn.mockReturnValue(makeMessages([{ type: 'result', subtype: 'success' }]));

        await svc.sendMessage({ prompt: 'test' });
        const callOptions = queryFn.mock.calls[0][0].options;
        expect(callOptions.effort).toBeUndefined();
        expect('effort' in callOptions).toBe(false);
    });

    it('drops unsupported reasoning efforts (including max) instead of forwarding them', async () => {
        for (const effort of ['max', 'ultra', '']) {
            queryFn.mockReset();
            queryFn.mockReturnValue(makeMessages([{ type: 'result', subtype: 'success' }]));
            await svc.sendMessage({ prompt: 'test', reasoningEffort: effort as never });
            const callOptions = queryFn.mock.calls[0][0].options;
            expect(callOptions.effort).toBeUndefined();
        }
    });

    it('captures rate_limit_event messages for non-Linux quota fallback reporting', async () => {
        const restorePlatform = stubProcessPlatform('darwin');
        try {
            queryFn.mockReturnValueOnce(makeMessages([
                {
                    type: 'rate_limit_event',
                    rate_limit_info: {
                        status: 'allowed_warning',
                        rateLimitType: 'five_hour',
                        utilization: 0.72,
                        resetsAt: 1700000000,
                        overageStatus: 'allowed',
                    },
                },
                { type: 'result', subtype: 'success' },
            ]));

            const result = await svc.sendMessage({ prompt: 'test' });
            const quota = await svc.getAccountQuota();

            expect(result.success).toBe(true);
            expect(quota.quotaSnapshots).toHaveProperty('five_hour');
            expect(quota.quotaSnapshots.five_hour.usedRequests).toBe(72);
            expect(quota.quotaSnapshots.five_hour.remainingPercentage).toBeCloseTo(0.28);
            expect(quota.quotaSnapshots.five_hour.resetDate).toBe(new Date(1700000000 * 1000).toISOString());
            expect(quota.quotaSnapshots.five_hour.usageAllowedWithExhaustedQuota).toBe(true);
        } finally {
            restorePlatform();
        }
    });
});

// ============================================================================
// getAccountQuota
// ============================================================================

describe('ClaudeSDKService.getAccountQuota', () => {
    let svc: ClaudeSDKService;
    const queryFn = vi.fn();
    let restorePlatform: () => void;

    beforeEach(() => {
        restorePlatform = stubProcessPlatform('darwin');
        svc = new ClaudeSDKService();
        mockDynamicImport.mockReset();
        queryFn.mockReset();
        mockDynamicImport.mockResolvedValue({ query: queryFn });
        // Point to a nonexistent file so the OAuth path fails gracefully and
        // tests are deterministic on machines that have Claude installed.
        process.env['CLAUDE_CREDENTIALS_FILE'] = '/nonexistent/__test_credentials__.json';
    });

    afterEach(() => {
        svc.dispose();
        restorePlatform();
        delete process.env['CLAUDE_CREDENTIALS_FILE'];
    });

    it('returns empty quota snapshots before Claude emits rate-limit info or accountInfo is observed', async () => {
        const quota = await svc.getAccountQuota();
        expect(quota).toEqual({ quotaSnapshots: {} });
    });

    it('caches accountInfo() from a real sendMessage() call so getAccountQuota returns a snapshot', async () => {
        const accountInfoFn = vi.fn().mockResolvedValue({ subscriptionType: 'pro' });
        queryFn.mockReturnValueOnce(makeQueryHandle([
            { type: 'result', subtype: 'success' },
        ], accountInfoFn));

        await svc.sendMessage({ prompt: 'hello' });
        const quota = await svc.getAccountQuota();
        expect(accountInfoFn).toHaveBeenCalled();
        expect(quota.quotaSnapshots).toHaveProperty('pro');
        expect(quota.quotaSnapshots.pro.remainingPercentage).toBe(1);
    });

    it('throws an availability error when the Claude SDK cannot be loaded', async () => {
        mockDynamicImport.mockRejectedValueOnce(new Error("Cannot find module '@anthropic-ai/claude-agent-sdk'"));
        await expect(svc.getAccountQuota()).rejects.toThrow(/Claude Agent SDK not installed/);
    });
});

describe('mapClaudeRateLimitInfoToQuota', () => {
    it('maps Claude rate-limit utilization into the common quota shape', () => {
        const result = mapClaudeRateLimitInfoToQuota({
            status: 'allowed_warning',
            rateLimitType: 'seven_day_sonnet',
            utilization: 86,
            resetsAt: 1700500000000,
        });

        const snap = result.quotaSnapshots.seven_day_sonnet;
        expect(snap.isUnlimitedEntitlement).toBe(false);
        expect(snap.entitlementRequests).toBe(100);
        expect(snap.usedRequests).toBe(86);
        expect(snap.remainingPercentage).toBeCloseTo(0.14);
        expect(snap.resetDate).toBe(new Date(1700500000000).toISOString());
    });

    it('treats rejected events without utilization as exhausted quota', () => {
        const result = mapClaudeRateLimitInfoToQuota({
            status: 'rejected',
        });

        const snap = result.quotaSnapshots.claude;
        expect(snap.usedRequests).toBe(100);
        expect(snap.remainingPercentage).toBe(0);
    });

    it('clamps out-of-range utilization values', () => {
        const result = mapClaudeRateLimitInfoToQuota({
            status: 'allowed',
            rateLimitType: 'five_hour',
            utilization: 120,
        });

        const snap = result.quotaSnapshots.five_hour;
        expect(snap.usedRequests).toBe(100);
        expect(snap.remainingPercentage).toBe(0);
    });
});

describe('mapClaudeAccountInfoToQuota', () => {
    it('keys the snapshot off subscriptionType when present', () => {
        const result = mapClaudeAccountInfoToQuota({ subscriptionType: 'pro' });
        expect(Object.keys(result.quotaSnapshots)).toEqual(['pro']);
        const snap = result.quotaSnapshots.pro;
        expect(snap.isUnlimitedEntitlement).toBe(false);
        expect(snap.entitlementRequests).toBe(100);
        expect(snap.usedRequests).toBe(0);
        expect(snap.remainingPercentage).toBe(1);
        expect(snap.overage).toBe(0);
        expect(snap.usageAllowedWithExhaustedQuota).toBe(false);
    });

    it('passes through claude-prefixed subscription tiers like claude_max', () => {
        const result = mapClaudeAccountInfoToQuota({ subscriptionType: 'claude_max' });
        expect(Object.keys(result.quotaSnapshots)).toEqual(['claude_max']);
    });

    it('keys the snapshot off apiProvider for 3P providers when no subscription is set', () => {
        const result = mapClaudeAccountInfoToQuota({ apiProvider: 'vertex' });
        expect(Object.keys(result.quotaSnapshots)).toEqual(['vertex']);
    });

    it('ignores firstParty apiProvider and falls back to the generic "subscription" key', () => {
        const result = mapClaudeAccountInfoToQuota({ apiProvider: 'firstParty' });
        expect(Object.keys(result.quotaSnapshots)).toEqual(['subscription']);
    });

    it('falls back to the generic "subscription" key when accountInfo is empty', () => {
        const result = mapClaudeAccountInfoToQuota({});
        expect(Object.keys(result.quotaSnapshots)).toEqual(['subscription']);
    });

    it('trims whitespace-only subscriptionType values', () => {
        const result = mapClaudeAccountInfoToQuota({ subscriptionType: '   ' });
        expect(Object.keys(result.quotaSnapshots)).toEqual(['subscription']);
    });
});

// ============================================================================
// mapOAuthUsageToQuota
// ============================================================================

describe('mapOAuthUsageToQuota', () => {
    it('maps both five_hour and seven_day windows into quota snapshots', () => {
        const result = mapOAuthUsageToQuota({
            five_hour: { utilization: 72, resets_at: '2026-06-04T12:00:00.000Z' },
            seven_day: { utilization: 45, resets_at: '2026-06-11T00:00:00.000Z' },
        });

        expect(Object.keys(result.quotaSnapshots)).toEqual(['five_hour', 'seven_day']);

        const fiveHour = result.quotaSnapshots.five_hour;
        expect(fiveHour.isUnlimitedEntitlement).toBe(false);
        expect(fiveHour.entitlementRequests).toBe(100);
        expect(fiveHour.usedRequests).toBe(72);
        expect(fiveHour.remainingPercentage).toBeCloseTo(0.28);
        expect(fiveHour.usageAllowedWithExhaustedQuota).toBe(false);
        expect(fiveHour.overage).toBe(0);
        expect(fiveHour.resetDate).toBe('2026-06-04T12:00:00.000Z');

        const sevenDay = result.quotaSnapshots.seven_day;
        expect(sevenDay.usedRequests).toBe(45);
        expect(sevenDay.remainingPercentage).toBeCloseTo(0.55);
        expect(sevenDay.resetDate).toBe('2026-06-11T00:00:00.000Z');
    });

    it('omits resetDate when resets_at is absent', () => {
        const result = mapOAuthUsageToQuota({
            five_hour: { utilization: 30 },
        });
        expect(result.quotaSnapshots.five_hour.resetDate).toBeUndefined();
    });

    it('skips a window when utilization is missing or non-numeric', () => {
        const result = mapOAuthUsageToQuota({
            five_hour: { resets_at: '2026-06-04T12:00:00.000Z' },
            seven_day: { utilization: 'notanumber', resets_at: '2026-06-11T00:00:00.000Z' },
        });
        expect(Object.keys(result.quotaSnapshots)).toHaveLength(0);
    });

    it('clamps utilization over 100% and computes overage correctly', () => {
        const result = mapOAuthUsageToQuota({
            five_hour: { utilization: 110 },
        });
        const snap = result.quotaSnapshots.five_hour;
        expect(snap.remainingPercentage).toBe(0);
        expect(snap.usedRequests).toBe(110);
        expect(snap.overage).toBe(10);
    });

    it('returns empty snapshots for an empty API response object', () => {
        const result = mapOAuthUsageToQuota({});
        expect(result).toEqual({ quotaSnapshots: {} });
    });

    it('returns only the windows present in the response', () => {
        const result = mapOAuthUsageToQuota({
            seven_day: { utilization: 20 },
        });
        expect(Object.keys(result.quotaSnapshots)).toEqual(['seven_day']);
        expect(result.quotaSnapshots.seven_day.usedRequests).toBe(20);
    });
});

// ============================================================================
// extractClaudeAccessToken
// ============================================================================

describe('extractClaudeAccessToken', () => {
    it('reads the Claude Code nested claudeAiOauth.accessToken shape', () => {
        expect(extractClaudeAccessToken({
            claudeAiOauth: { accessToken: 'nested-tok', refreshToken: 'r' },
        })).toBe('nested-tok');
    });

    it('reads the flat access_token shape', () => {
        expect(extractClaudeAccessToken({ access_token: 'flat-tok' })).toBe('flat-tok');
    });

    it('prefers the nested token over a flat token', () => {
        expect(extractClaudeAccessToken({
            claudeAiOauth: { accessToken: 'nested-tok' },
            access_token: 'flat-tok',
        })).toBe('nested-tok');
    });

    it('falls back to the flat token when the nested token is empty', () => {
        expect(extractClaudeAccessToken({
            claudeAiOauth: { accessToken: '' },
            access_token: 'flat-tok',
        })).toBe('flat-tok');
    });

    it('returns undefined when no token is present', () => {
        expect(extractClaudeAccessToken({})).toBeUndefined();
        expect(extractClaudeAccessToken({ claudeAiOauth: {} })).toBeUndefined();
        expect(extractClaudeAccessToken({ claudeAiOauth: { accessToken: 123 } })).toBeUndefined();
        expect(extractClaudeAccessToken({ access_token: '' })).toBeUndefined();
        expect(extractClaudeAccessToken({ claudeAiOauth: null })).toBeUndefined();
    });
});

// ============================================================================
// getAccountQuota — Linux OAuth integration
// ============================================================================

describe('ClaudeSDKService.getAccountQuota (Linux OAuth)', () => {
    let svc: ClaudeSDKService;
    const queryFn = vi.fn();
    let fetchSpy: ReturnType<typeof vi.fn>;
    let tempCredFile: string;
    let restorePlatform: () => void;

    beforeEach(() => {
        restorePlatform = stubProcessPlatform('linux');
        svc = new ClaudeSDKService();
        mockDynamicImport.mockReset();
        queryFn.mockReset();
        mockDynamicImport.mockResolvedValue({ query: queryFn });
        fetchSpy = vi.fn();
        vi.stubGlobal('fetch', fetchSpy);
        tempCredFile = path.join(os.tmpdir(), `coc-test-creds-${Date.now()}.json`);
        process.env['CLAUDE_CREDENTIALS_FILE'] = tempCredFile;
    });

    afterEach(() => {
        svc.dispose();
        restorePlatform();
        vi.unstubAllGlobals();
        delete process.env['CLAUDE_CREDENTIALS_FILE'];
        try { fs.unlinkSync(tempCredFile); } catch { /* already removed or never created */ }
    });

    it('fetches quota from OAuth API on Linux with valid credentials', async () => {
        fs.writeFileSync(tempCredFile, JSON.stringify({ access_token: 'tok-123' }));
        fetchSpy.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                five_hour: { utilization: 72, resets_at: '2026-06-04T12:00:00.000Z' },
                seven_day: { utilization: 45, resets_at: '2026-06-11T00:00:00.000Z' },
            }),
        });

        const quota = await svc.getAccountQuota();

        expect(fetchSpy).toHaveBeenCalledWith(
            'https://api.anthropic.com/api/oauth/usage',
            expect.objectContaining({ headers: expect.objectContaining({ 'Authorization': 'Bearer tok-123' }) })
        );
        expect(quota.quotaSnapshots).toHaveProperty('five_hour');
        expect(quota.quotaSnapshots).toHaveProperty('seven_day');
        expect(quota.quotaSnapshots.five_hour.usedRequests).toBe(72);
        expect(quota.quotaSnapshots.seven_day.usedRequests).toBe(45);
    });

    it('fetches quota using the Claude Code nested claudeAiOauth.accessToken credential shape', async () => {
        // Regression: `claude login` writes credentials as
        // { claudeAiOauth: { accessToken, refreshToken, ... } }, not a flat
        // { access_token }. The quota lookup must read the nested token.
        fs.writeFileSync(tempCredFile, JSON.stringify({
            claudeAiOauth: {
                accessToken: 'nested-tok-456',
                refreshToken: 'refresh-789',
                expiresAt: 9999999999999,
                scopes: ['user:inference'],
                subscriptionType: 'max',
                rateLimitTier: 'default',
            },
        }));
        fetchSpy.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                five_hour: { utilization: 30, resets_at: '2026-06-04T12:00:00.000Z' },
                seven_day: { utilization: 12, resets_at: '2026-06-11T00:00:00.000Z' },
            }),
        });

        const quota = await svc.getAccountQuota();

        expect(fetchSpy).toHaveBeenCalledWith(
            'https://api.anthropic.com/api/oauth/usage',
            expect.objectContaining({ headers: expect.objectContaining({ 'Authorization': 'Bearer nested-tok-456' }) })
        );
        expect(quota.quotaSnapshots.five_hour.usedRequests).toBe(30);
        expect(quota.quotaSnapshots.seven_day.usedRequests).toBe(12);
    });

    it('returns empty snapshots when the credentials file is missing', async () => {
        // tempCredFile is never written — it does not exist
        const quota = await svc.getAccountQuota();
        expect(quota).toEqual({ quotaSnapshots: {} });
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('returns empty snapshots when the credentials file contains invalid JSON', async () => {
        fs.writeFileSync(tempCredFile, 'not-json{{{');

        const quota = await svc.getAccountQuota();
        expect(quota).toEqual({ quotaSnapshots: {} });
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('returns empty snapshots when access_token is missing from credentials', async () => {
        fs.writeFileSync(tempCredFile, JSON.stringify({ refresh_token: 'refresh-only' }));

        const quota = await svc.getAccountQuota();
        expect(quota).toEqual({ quotaSnapshots: {} });
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('returns empty snapshots on a non-2xx API response', async () => {
        fs.writeFileSync(tempCredFile, JSON.stringify({ access_token: 'tok-bad' }));
        fetchSpy.mockResolvedValueOnce({ ok: false, status: 401 });

        const quota = await svc.getAccountQuota();
        expect(quota).toEqual({ quotaSnapshots: {} });
    });

    it('returns empty snapshots on a network error', async () => {
        fs.writeFileSync(tempCredFile, JSON.stringify({ access_token: 'tok-net' }));
        fetchSpy.mockRejectedValueOnce(new Error('Network failure'));

        const quota = await svc.getAccountQuota();
        expect(quota).toEqual({ quotaSnapshots: {} });
    });

    it('returns empty snapshots when the API response JSON is malformed', async () => {
        fs.writeFileSync(tempCredFile, JSON.stringify({ access_token: 'tok-bad-body' }));
        fetchSpy.mockResolvedValueOnce({
            ok: true,
            json: async () => { throw new SyntaxError('Unexpected token'); },
        });

        const quota = await svc.getAccountQuota();
        expect(quota).toEqual({ quotaSnapshots: {} });
    });

    it('prefers fresh OAuth API usage over cached rate-limit and accountInfo data on Linux', async () => {
        fs.writeFileSync(tempCredFile, JSON.stringify({ access_token: 'tok-123' }));
        fetchSpy.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ five_hour: { utilization: 10 } }),
        });
        const accountInfoFn = vi.fn().mockResolvedValue({ subscriptionType: 'pro' });

        queryFn.mockReturnValueOnce(makeQueryHandle([
            {
                type: 'rate_limit_event',
                rate_limit_info: {
                    status: 'allowed_warning',
                    rateLimitType: 'five_hour',
                    utilization: 0.90,
                },
            },
            { type: 'result', subtype: 'success' },
        ], accountInfoFn));
        await svc.sendMessage({ prompt: 'hello' });
        await Promise.resolve();

        const quota = await svc.getAccountQuota();

        expect(accountInfoFn).toHaveBeenCalled();
        expect(fetchSpy).toHaveBeenCalledOnce();
        expect(quota.quotaSnapshots.five_hour.usedRequests).toBe(10);
    });
});

describe('ClaudeSDKService session operations', () => {
    let svc: ClaudeSDKService;
    const forkSessionFn = vi.fn();

    beforeEach(() => {
        svc = new ClaudeSDKService();
        mockDynamicImport.mockReset();
        forkSessionFn.mockReset();
        mockDynamicImport.mockResolvedValue({ query: vi.fn(), forkSession: forkSessionFn });
    });

    afterEach(() => {
        svc.dispose();
    });

    it('forkSession delegates to the Claude SDK forkSession export', async () => {
        forkSessionFn.mockResolvedValueOnce({ sessionId: 'forked-id' });

        const result = await svc.forkSession('source-id');

        expect(forkSessionFn).toHaveBeenCalledWith('source-id');
        expect(result).toBe('forked-id');
    });

    it('forkSession throws an explicit error when the installed SDK lacks fork support', async () => {
        mockDynamicImport.mockReset();
        mockDynamicImport.mockResolvedValue({ query: vi.fn() });
        const unsupportedSvc = new ClaudeSDKService();

        await expect(unsupportedSvc.forkSession('any-id')).rejects.toThrow(/does not export forkSession/);

        unsupportedSvc.dispose();
    });

    it('steerSession returns false (unsupported, not silent success)', async () => {
        const result = await svc.steerSession('any-id', 'steer prompt');
        expect(result).toBe(false);
    });

    it('softAbortSession delegates to abortSession (no-op for missing session)', async () => {
        const result = await svc.softAbortSession('nonexistent');
        expect(result).toBe(false);
    });
});

// ============================================================================
// Session tracking
// ============================================================================

describe('ClaudeSDKService session tracking', () => {
    let svc: ClaudeSDKService;

    beforeEach(() => {
        svc = new ClaudeSDKService();
        mockDynamicImport.mockReset();
        mockDynamicImport.mockResolvedValue({ query: vi.fn() });
    });

    afterEach(() => {
        svc.dispose();
    });

    it('getActiveSessionCount returns 0 when no sessions are active', () => {
        expect(svc.getActiveSessionCount()).toBe(0);
    });

    it('hasActiveSession returns false for unknown session', () => {
        expect(svc.hasActiveSession('unknown')).toBe(false);
    });

    it('abortSession returns false for unknown session', async () => {
        expect(await svc.abortSession('unknown')).toBe(false);
    });
});

// ============================================================================
// transform
// ============================================================================

describe('ClaudeSDKService.transform', () => {
    let svc: ClaudeSDKService;
    const queryFn = vi.fn();

    beforeEach(() => {
        svc = new ClaudeSDKService();
        mockDynamicImport.mockReset();
        queryFn.mockReset();
        mockDynamicImport.mockResolvedValue({ query: queryFn });
    });

    afterEach(() => {
        svc.dispose();
    });

    it('returns raw string by default', async () => {
        queryFn.mockReturnValueOnce(makeMessages([
            {
                type: 'assistant',
                message: { content: [{ type: 'text', text: 'parsed result' }] },
            },
            { type: 'result', subtype: 'success' },
        ]));

        const raw = await svc.transform('give me the result');
        expect(raw).toBe('parsed result');
    });

    it('applies parse function when provided', async () => {
        queryFn.mockReturnValueOnce(makeMessages([
            {
                type: 'assistant',
                message: { content: [{ type: 'text', text: '42' }] },
            },
            { type: 'result', subtype: 'success' },
        ]));

        const num = await svc.transform('give me a number', (s) => parseInt(s, 10));
        expect(num).toBe(42);
    });

    it('throws when sendMessage fails', async () => {
        mockDynamicImport.mockRejectedValueOnce(new Error("Cannot find module '@anthropic-ai/claude-agent-sdk'"));
        await expect(svc.transform('fail')).rejects.toThrow();
    });
});
