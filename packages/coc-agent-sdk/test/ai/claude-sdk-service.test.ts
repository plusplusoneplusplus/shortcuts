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
    addClaudeContextUsage,
    extractClaudeAccessToken,
    fetchClaudeOAuthQuota,
    mapClaudeAccountInfoToQuota,
    mapClaudeRateLimitInfoToQuota,
    mapOAuthUsageToQuota,
    readKeychainCredentials,
    resolveClaudeCredentialsRaw,
    registerClaudeSDKService,
} from '../../src/claude-sdk-service';
import {
    CLAUDE_PROVIDER,
    SDK_PROVIDER_CLAUDE,
    sdkServiceRegistry,
} from '../../src/sdk-service-registry';
import { RewindUnsupportedError, isRewindUnsupportedError, CompactUnsupportedError, isCompactUnsupportedError } from '../../src/sdk-service-interface';
import type { TokenUsage } from '../../src/types';
import { initSDKLogger, resetSDKLogger } from '../../src/logger';

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

/**
 * Reads the text of the first user message yielded by a streaming-input prompt.
 * The Claude provider now always hands the SDK an open async-iterable input
 * (the keep-alive gate) instead of a bare string prompt, so prompt assertions
 * read the first message's text from either plain string or block content.
 */
async function firstUserText(prompt: unknown): Promise<string> {
    if (typeof prompt === 'string') return prompt;
    for await (const message of prompt as AsyncIterable<any>) {
        const content = (message as any)?.message?.content;
        if (typeof content === 'string') return content;
        if (Array.isArray(content)) {
            const textBlock = content.find((b: any) => b?.type === 'text');
            return typeof textBlock?.text === 'string' ? textBlock.text : '';
        }
        return '';
    }
    return '';
}

/**
 * Builds an input-aware query handle that faithfully models the keep-alive
 * contract: the SDK only delivers the post-`result` continuation while the
 * streaming-input session stays open. A single-shot input (a bare string, the
 * pre-fix behavior) yields just `beforeResult` and ends; an open async-iterable
 * input also yields `continuation`, then drains the input until the provider
 * closes the gate. `onInput` lets a test observe provider state mid-window.
 */
function makeKeepAliveQuery(
    beforeResult: object[],
    continuation: object[] = [],
    onInput?: () => void,
) {
    return (queryOptions: { prompt: unknown }) => {
        const input = queryOptions.prompt;
        const inputOpen =
            !!input &&
            typeof input !== 'string' &&
            typeof (input as any)[Symbol.asyncIterator] === 'function';
        return {
            async *[Symbol.asyncIterator]() {
                for (const msg of beforeResult) yield msg;
                if (!inputOpen) return; // single-shot input -> no async resume
                onInput?.();
                for (const msg of continuation) yield msg;
                // Block until the provider settles the turn by closing the gate.
                for await (const _ of input as AsyncIterable<unknown>) { void _; }
            },
            accountInfo: async () => ({}),
            return: async (value?: unknown) => ({ done: true as const, value }),
        };
    };
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

/**
 * Builds a query handle that faithfully models the real SDK teardown race for
 * `getContextUsage()`: the control request only succeeds while the streaming
 * input gate is still open (subprocess alive). Once the provider closes the gate
 * (end-of-input), the fake iterator drains the input and marks the subprocess as
 * torn down, so any later `getContextUsage()` rejects — exactly like the real SDK
 * cleanup that rejects pending control responses. A correct provider therefore
 * has to query context usage BEFORE it closes the gate.
 */
function makeTeardownAfterCloseQuery(messages: object[], contextPayload: object) {
    return (queryOptions: { prompt: unknown }) => {
        const input = queryOptions.prompt as AsyncIterable<unknown>;
        let tornDown = false;
        return {
            async *[Symbol.asyncIterator]() {
                for (const msg of messages) yield msg;
                // Stay alive until the provider closes the input gate, then
                // tear the "subprocess" down.
                for await (const _ of input) { void _; }
                tornDown = true;
            },
            accountInfo: async () => ({}),
            supportedModels: async () => [],
            getContextUsage: async () => {
                if (tornDown) throw new Error('Query closed before response received');
                return contextPayload;
            },
            return: async (value?: unknown) => ({ done: true as const, value }),
        };
    };
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

function createCapturingLogger() {
    const logs: Array<{ level: string; fields: Record<string, unknown>; message: string; args: unknown[] }> = [];

    function makeCapture(bindings: Record<string, unknown> = {}) {
        const capture = (level: string, ...args: unknown[]) => {
            const [firstArg, secondArg, ...restArgs] = args;
            const fields = typeof firstArg === 'object' && firstArg !== null && !Array.isArray(firstArg)
                ? { ...bindings, ...(firstArg as Record<string, unknown>) }
                : { ...bindings };
            const message = typeof firstArg === 'string'
                ? firstArg
                : typeof secondArg === 'string'
                    ? secondArg
                    : '';
            logs.push({
                level,
                fields,
                message,
                args: typeof firstArg === 'string' ? args.slice(1) : restArgs,
            });
        };
        return {
            debug: (...args: unknown[]) => capture('debug', ...args),
            info: (...args: unknown[]) => capture('info', ...args),
            warn: (...args: unknown[]) => capture('warn', ...args),
            error: (...args: unknown[]) => capture('error', ...args),
            child: (childBindings: Record<string, unknown>) => makeCapture({ ...bindings, ...childBindings }),
        };
    }

    return {
        logs,
        logger: makeCapture(),
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
        resetSDKLogger();
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

    it('maps model descriptions so alias/family catalog matching can use them', async () => {
        const child = mockClaudeCliSpawn();
        const modelsPromise = svc.listModels();
        await waitForClaudeCliSpawn(child);

        child.writeStdoutLine(JSON.stringify({
            type: 'control_response',
            request_id: 'init-1',
            response: {
                response: {
                    models: [
                        { value: 'default', displayName: 'Default (recommended)', description: 'Sonnet 4.6 · Best for everyday tasks' },
                        { value: 'opus', displayName: 'Opus', description: '  Opus 4.8 · Most capable  ' },
                        { value: 'haiku', displayName: 'Haiku', description: '' },
                    ],
                },
            },
        }));

        const models = await modelsPromise;

        expect(models).toEqual([
            { id: 'default', name: 'Default (recommended)', description: 'Sonnet 4.6 · Best for everyday tasks' },
            { id: 'opus', name: 'Opus', description: 'Opus 4.8 · Most capable' },
            { id: 'haiku', name: 'Haiku' },
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

        expect(models).toContainEqual({ id: 'claude-opus-4-7', name: 'Claude Opus 4.7', supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'] });
        expect(models).toContainEqual({ id: 'claude-opus-4-6', name: 'Claude Opus 4.6', supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'] });
        expect(models).toContainEqual({ id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', supportedReasoningEfforts: ['low', 'medium', 'high'] });
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
        resetSDKLogger();
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

    it('maps append systemMessage to the claude_code preset systemPrompt without mutating the prompt', async () => {
        queryFn.mockReturnValueOnce(makeMessages([
            { type: 'result', subtype: 'success', result: 'ok' },
        ]));

        const result = await svc.sendMessage({
            prompt: 'user prompt',
            systemMessage: { mode: 'append', content: 'CoC system prompt' },
        });

        expect(result.success).toBe(true);
        const call = queryFn.mock.calls[0][0];
        expect(await firstUserText(call.prompt)).toBe('user prompt');
        expect(call.options?.systemPrompt).toEqual({
            type: 'preset',
            preset: 'claude_code',
            append: 'CoC system prompt',
        });
        // Regression: claude-agent-sdk >= 0.1 silently ignores these legacy options.
        expect(call.options).not.toHaveProperty('appendSystemPrompt');
        expect(call.options).not.toHaveProperty('customSystemPrompt');
    });

    it('maps replace systemMessage to a custom string systemPrompt without the preset', async () => {
        queryFn.mockReturnValueOnce(makeMessages([
            { type: 'result', subtype: 'success', result: 'ok' },
        ]));

        const result = await svc.sendMessage({
            prompt: 'generator prompt',
            systemMessage: { mode: 'replace', content: 'Strict generator system prompt' },
        });

        expect(result.success).toBe(true);
        const call = queryFn.mock.calls[0][0];
        expect(await firstUserText(call.prompt)).toBe('generator prompt');
        expect(call.options?.systemPrompt).toBe('Strict generator system prompt');
        expect(call.options).not.toHaveProperty('appendSystemPrompt');
        expect(call.options).not.toHaveProperty('customSystemPrompt');
    });

    it('omits the systemPrompt option when systemMessage is absent', async () => {
        queryFn.mockReturnValueOnce(makeMessages([
            { type: 'result', subtype: 'success', result: 'ok' },
        ]));

        const result = await svc.sendMessage({ prompt: 'plain prompt' });

        expect(result.success).toBe(true);
        const call = queryFn.mock.calls[0][0];
        expect(call.options).not.toHaveProperty('systemPrompt');
    });

    it('omits the systemPrompt option for blank append and replace messages', async () => {
        for (const mode of ['append', 'replace'] as const) {
            queryFn.mockReturnValueOnce(makeMessages([
                { type: 'result', subtype: 'success', result: 'ok' },
            ]));

            const result = await svc.sendMessage({
                prompt: `blank ${mode}`,
                systemMessage: { mode, content: '  \n\t  ' },
            });

            expect(result.success).toBe(true);
            const call = queryFn.mock.calls[queryFn.mock.calls.length - 1][0];
            expect(call.options).not.toHaveProperty('systemPrompt');
        }
    });

    it('keeps append system prompts on resumed Claude sessions', async () => {
        queryFn.mockReturnValueOnce(makeMessages([
            { type: 'result', subtype: 'success', result: 'ok', session_id: 'provider-session' },
        ]));

        const result = await svc.sendMessage({
            prompt: 'follow-up prompt',
            sessionId: 'provider-session',
            systemMessage: { mode: 'append', content: 'history plus CoC system prompt' },
        });

        expect(result.success).toBe(true);
        const call = queryFn.mock.calls[0][0];
        expect(call.options?.resume).toBe('provider-session');
        expect(call.options).not.toHaveProperty('sessionId');
        expect(call.options?.systemPrompt).toEqual({
            type: 'preset',
            preset: 'claude_code',
            append: 'history plus CoC system prompt',
        });
        expect(await firstUserText(call.prompt)).toBe('follow-up prompt');
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
            actualUsdCost: 0.0123,
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

    it('returns Claude context-window quota fields when getContextUsage has no token totals', async () => {
        queryFn.mockReturnValueOnce(makeQueryHandle([
            { type: 'result', subtype: 'success', result: 'done' },
        ], undefined, undefined, async () => ({
            totalTokens: 400,
            maxTokens: 2000,
            systemPromptSections: [{ tokens: 50 }],
            systemTools: [{ tokens: 20 }],
            mcpTools: [{ tokens: 10 }],
            messageBreakdown: {
                assistantMessageTokens: 120,
                userMessageTokens: 80,
            },
        })));

        const result = await svc.sendMessage({ prompt: 'test' });

        expect(result.success).toBe(true);
        expect(result.tokenUsage).toEqual({
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: 0,
            turnCount: 0,
            tokenLimit: 2000,
            currentTokens: 400,
            systemTokens: 50,
            toolDefinitionsTokens: 30,
            conversationTokens: 200,
        });
    });

    it('keeps Claude result usage when context usage lookup fails and logs a warning', async () => {
        const capLogger = createCapturingLogger();
        initSDKLogger(capLogger.logger as any);
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
        const warning = capLogger.logs.find(log =>
            log.level === 'warn' && log.fields.event === 'claude_context_usage_error');
        expect(warning).toBeDefined();
        expect(warning?.fields).toMatchObject({
            provider: 'claude',
            error: 'context unavailable',
        });
    });

    it('captures context usage at turn end while the subprocess is still alive (teardown race)', async () => {
        // Regression guard: the provider must query getContextUsage BEFORE it
        // closes the input gate. This handle rejects the control request once the
        // gate closes, so the previous "fetch after the message loop" behavior
        // would drop the context-window fields entirely.
        queryFn.mockImplementationOnce(makeTeardownAfterCloseQuery(
            [
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
            ],
            {
                totalTokens: 2400,
                maxTokens: 200000,
                rawMaxTokens: 1000000,
                systemPromptSections: [{ name: 'core', tokens: 100 }, { name: 'policy', tokens: 25 }],
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
            },
        ));

        const result = await svc.sendMessage({ prompt: 'test' });

        expect(result.success).toBe(true);
        expect(result.tokenUsage).toEqual({
            inputTokens: 10,
            outputTokens: 5,
            cacheReadTokens: 3,
            cacheWriteTokens: 2,
            totalTokens: 15,
            turnCount: 1,
            // Populated because usage is fetched before the gate closes; maps
            // maxTokens (not rawMaxTokens) to tokenLimit.
            tokenLimit: 200000,
            currentTokens: 2400,
            systemTokens: 125,
            toolDefinitionsTokens: 75,
            conversationTokens: 98,
        });
    });

    it('does not stall or fail the turn when getContextUsage never resolves, and logs a warning', async () => {
        const previousTimeout = process.env.COC_CLAUDE_CONTEXT_USAGE_TIMEOUT_MS;
        process.env.COC_CLAUDE_CONTEXT_USAGE_TIMEOUT_MS = '40';
        const capLogger = createCapturingLogger();
        initSDKLogger(capLogger.logger as any);
        try {
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
            ], undefined, undefined, () => new Promise<object>(() => { /* never resolves */ })));

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
            const warning = capLogger.logs.find(log =>
                log.level === 'warn' && log.fields.event === 'claude_context_usage_timeout');
            expect(warning).toBeDefined();
            expect(warning?.fields).toMatchObject({ provider: 'claude', timeoutMs: 40 });
        } finally {
            if (previousTimeout === undefined) {
                delete process.env.COC_CLAUDE_CONTEXT_USAGE_TIMEOUT_MS;
            } else {
                process.env.COC_CLAUDE_CONTEXT_USAGE_TIMEOUT_MS = previousTimeout;
            }
        }
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

    it('normalizes Claude Agent tool calls to task and preserves subagent child nesting', async () => {
        queryFn.mockReturnValueOnce(makeMessages([
            {
                type: 'assistant',
                parent_tool_use_id: null,
                message: {
                    content: [
                        {
                            type: 'tool_use',
                            id: 'agent-tool',
                            name: 'Agent',
                            input: {
                                description: 'Get time',
                                prompt: 'Run date -u',
                                subagent_type: 'general-purpose',
                            },
                        },
                    ],
                },
            },
            {
                type: 'assistant',
                parent_tool_use_id: 'agent-tool',
                message: {
                    content: [
                        {
                            type: 'tool_use',
                            id: 'bash-child',
                            name: 'Bash',
                            input: { command: 'date -u' },
                        },
                    ],
                },
            },
            {
                type: 'user',
                message: {
                    content: [
                        {
                            type: 'tool_result',
                            tool_use_id: 'bash-child',
                            content: 'Sat Jun 13 23:35:39 UTC 2026',
                        },
                    ],
                },
            },
            {
                type: 'user',
                message: {
                    content: [
                        {
                            type: 'tool_result',
                            tool_use_id: 'agent-tool',
                            content: 'done\nagentId: af43d1cb10a1f5b7d',
                        },
                    ],
                },
            },
            { type: 'result', subtype: 'success' },
        ]));

        const toolEvents: object[] = [];
        const result = await svc.sendMessage({
            prompt: 'ask a subagent',
            onToolEvent: (e) => toolEvents.push(e),
        });

        expect(result.toolCalls).toHaveLength(2);
        expect(result.toolCalls?.[0]).toMatchObject({
            id: 'agent-tool',
            name: 'task',
            status: 'completed',
            args: {
                description: 'Get time',
                prompt: 'Run date -u',
                subagent_type: 'general-purpose',
                agent_type: 'general-purpose',
                agent_id: 'af43d1cb10a1f5b7d',
                agent_ids: ['af43d1cb10a1f5b7d'],
            },
            result: 'done\nagentId: af43d1cb10a1f5b7d',
        });
        expect(result.toolCalls?.[1]).toMatchObject({
            id: 'bash-child',
            name: 'Bash',
            status: 'completed',
            parentToolCallId: 'agent-tool',
            args: { command: 'date -u' },
            result: 'Sat Jun 13 23:35:39 UTC 2026',
        });
        expect(toolEvents).toEqual([
            expect.objectContaining({
                type: 'tool-start',
                toolCallId: 'agent-tool',
                toolName: 'task',
                parameters: expect.objectContaining({
                    agent_type: 'general-purpose',
                    description: 'Get time',
                }),
            }),
            expect.objectContaining({
                type: 'tool-start',
                toolCallId: 'bash-child',
                toolName: 'Bash',
                parentToolCallId: 'agent-tool',
            }),
            expect.objectContaining({
                type: 'tool-complete',
                toolCallId: 'bash-child',
                parentToolCallId: 'agent-tool',
                result: 'Sat Jun 13 23:35:39 UTC 2026',
            }),
            expect.objectContaining({
                type: 'tool-complete',
                toolCallId: 'agent-tool',
                toolName: 'task',
                parameters: expect.objectContaining({
                    agent_id: 'af43d1cb10a1f5b7d',
                    agent_ids: ['af43d1cb10a1f5b7d'],
                }),
                result: 'done\nagentId: af43d1cb10a1f5b7d',
            }),
        ]);
    });

    it('captures structured Claude Agent output metadata on task tool calls', async () => {
        queryFn.mockReturnValueOnce(makeMessages([
            {
                type: 'assistant',
                message: {
                    content: [
                        {
                            type: 'tool_use',
                            id: 'agent-structured',
                            name: 'Agent',
                            input: {
                                description: 'Review patch',
                                prompt: 'Review the diff',
                            },
                        },
                    ],
                },
            },
            {
                type: 'user',
                message: {
                    content: [
                        {
                            type: 'tool_result',
                            tool_use_id: 'agent-structured',
                            content: {
                                status: 'completed',
                                agentId: 'agent-42',
                                agentType: 'reviewer',
                                content: [{ type: 'text', text: 'all done' }],
                                totalToolUseCount: 1,
                                totalDurationMs: 12,
                                totalTokens: 34,
                                usage: {
                                    input_tokens: 10,
                                    output_tokens: 24,
                                    cache_creation_input_tokens: null,
                                    cache_read_input_tokens: null,
                                    server_tool_use: null,
                                    service_tier: null,
                                    cache_creation: null,
                                },
                                prompt: 'Review the diff',
                            },
                        },
                    ],
                },
            },
            { type: 'result', subtype: 'success' },
        ]));

        const result = await svc.sendMessage({ prompt: 'review with subagent' });

        expect(result.toolCalls?.[0]).toMatchObject({
            id: 'agent-structured',
            name: 'task',
            status: 'completed',
            args: {
                description: 'Review patch',
                prompt: 'Review the diff',
                agent_type: 'reviewer',
                agent_id: 'agent-42',
                agent_ids: ['agent-42'],
                agent_status: 'completed',
            },
            result: 'all done',
        });
    });

    it('normalizes Claude TaskOutput calls to read_agent with wait metadata', async () => {
        queryFn.mockReturnValueOnce(makeMessages([
            {
                type: 'assistant',
                message: {
                    content: [
                        {
                            type: 'tool_use',
                            id: 'task-output',
                            name: 'TaskOutput',
                            input: {
                                task_id: 'agent-bg',
                                block: true,
                                timeout: 120000,
                            },
                        },
                    ],
                },
            },
            {
                type: 'user',
                message: {
                    content: [
                        {
                            type: 'tool_result',
                            tool_use_id: 'task-output',
                            content: 'background done',
                        },
                    ],
                },
            },
            { type: 'result', subtype: 'success' },
        ]));

        const result = await svc.sendMessage({ prompt: 'wait for background agent' });

        expect(result.toolCalls?.[0]).toMatchObject({
            id: 'task-output',
            name: 'read_agent',
            status: 'completed',
            args: {
                task_id: 'agent-bg',
                agent_id: 'agent-bg',
                block: true,
                wait: true,
                timeout: 120,
                timeout_ms: 120000,
            },
            result: 'background done',
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

    it('logs sanitized metadata when Claude returns error_during_execution without a result body', async () => {
        const capLogger = createCapturingLogger();
        initSDKLogger(capLogger.logger as any);
        queryFn.mockReturnValueOnce(makeMessages([
            {
                type: 'result',
                subtype: 'error_during_execution',
                is_error: true,
                session_id: 'provider-session',
                duration_ms: 1234,
                num_turns: 2,
                api_error_status: 429,
                terminal_reason: 'api_error',
                stop_reason: 'rate_limit',
            },
        ]));

        const result = await svc.sendMessage({
            prompt: 'SECRET_PROMPT_TEXT',
            model: 'opus',
            workingDirectory: '/safe/project',
            mode: 'autopilot',
            systemMessage: { mode: 'append', content: 'SECRET_SYSTEM_PROMPT' },
            mcpServers: {
                safe_server: {
                    command: 'node',
                    args: ['bridge.js', '--token', 'SECRET_MCP_TOKEN'],
                    env: { TOKEN: 'SECRET_MCP_TOKEN' },
                },
            },
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe('Claude returned error_during_execution');

        const warning = capLogger.logs.find(log =>
            log.level === 'warn' &&
            log.message === 'Claude SDK result message reported failure'
        );
        expect(warning?.fields).toMatchObject({
            store: 'coc-agent-sdk',
            provider: 'claude',
            event: 'claude_result_failure',
            subtype: 'error_during_execution',
            is_error: true,
            session_id: 'provider-session',
            duration_ms: 1234,
            num_turns: 2,
            api_error_status: 429,
            terminal_reason: 'api_error',
            stop_reason: 'rate_limit',
            requestedModel: 'opus',
            effectiveModel: 'opus',
            workingDirectory: '/safe/project',
            permissionMode: 'bypassPermissions',
            mcpConfigured: true,
            mcpServerNames: ['safe_server'],
        });
        const serializedLog = JSON.stringify(warning);
        expect(serializedLog).not.toContain('SECRET_PROMPT_TEXT');
        expect(serializedLog).not.toContain('SECRET_SYSTEM_PROMPT');
        expect(serializedLog).not.toContain('SECRET_MCP_TOKEN');
    });

    it('logs sanitized exception diagnostics when the Claude SDK throws', async () => {
        const capLogger = createCapturingLogger();
        initSDKLogger(capLogger.logger as any);
        const cause = Object.assign(
            new Error('cause saw SECRET_PROMPT_TEXT and SECRET_MCP_TOKEN'),
            { code: 'rate_limited', status: 429 },
        );
        const sdkError = new Error('SDK rejected SECRET_PROMPT_TEXT SECRET_SYSTEM_PROMPT SECRET_MCP_TOKEN');
        sdkError.name = 'ClaudeSDKError';
        sdkError.stack = [
            'ClaudeSDKError: SDK rejected SECRET_PROMPT_TEXT SECRET_SYSTEM_PROMPT SECRET_MCP_TOKEN',
            '    at query (claude-sdk.js:10:5)',
            '    at bridge (SECRET_MCP_TOKEN.js:20:5)',
        ].join('\n');
        (sdkError as Error & { cause?: unknown }).cause = cause;
        queryFn.mockImplementationOnce(() => {
            throw sdkError;
        });

        const result = await svc.sendMessage({
            prompt: 'SECRET_PROMPT_TEXT',
            model: 'opus',
            workingDirectory: '/safe/project',
            mode: 'interactive',
            systemMessage: { mode: 'append', content: 'SECRET_SYSTEM_PROMPT' },
            mcpServers: {
                safe_server: {
                    command: 'node',
                    args: ['bridge.js', '--token', 'SECRET_MCP_TOKEN'],
                    env: { TOKEN: 'SECRET_MCP_TOKEN' },
                },
            },
        });

        expect(result).toMatchObject({
            success: false,
            error: 'SDK rejected SECRET_PROMPT_TEXT SECRET_SYSTEM_PROMPT SECRET_MCP_TOKEN',
            effectiveModel: 'opus',
        });

        const errorLog = capLogger.logs.find(log =>
            log.level === 'error' &&
            log.message === 'Claude SDK sendMessage threw'
        );
        expect(errorLog?.fields).toMatchObject({
            store: 'coc-agent-sdk',
            provider: 'claude',
            event: 'claude_sdk_exception',
            name: 'ClaudeSDKError',
            message: 'SDK rejected [redacted] [redacted] [redacted]',
            requestedModel: 'opus',
            effectiveModel: 'opus',
            workingDirectory: '/safe/project',
            permissionMode: 'acceptEdits',
            mcpConfigured: true,
            mcpServerNames: ['safe_server'],
            cause: {
                name: 'Error',
                message: 'cause saw [redacted] and [redacted]',
                code: 'rate_limited',
                status: 429,
            },
        });
        expect(errorLog?.fields.stack).toContain('at query (claude-sdk.js:10:5)');
        const serializedLog = JSON.stringify(errorLog);
        expect(serializedLog).not.toContain('SECRET_PROMPT_TEXT');
        expect(serializedLog).not.toContain('SECRET_SYSTEM_PROMPT');
        expect(serializedLog).not.toContain('SECRET_MCP_TOKEN');
    });

    it('correlates the latest in-call rate_limit_event with a later failed result', async () => {
        const capLogger = createCapturingLogger();
        initSDKLogger(capLogger.logger as any);
        queryFn.mockReturnValueOnce(makeMessages([
            {
                type: 'rate_limit_event',
                rate_limit_info: {
                    status: 'allowed_warning',
                    rateLimitType: 'five_hour',
                    utilization: 0.75,
                    resetsAt: 1700000000,
                },
            },
            {
                type: 'rate_limit_event',
                rate_limit_info: {
                    status: 'rejected',
                    rateLimitType: 'seven_day_opus',
                    utilization: 0.99,
                    surpassedThreshold: 1,
                    resetsAt: 1700500000000,
                    overageStatus: 'rejected',
                    overageResetsAt: 1700600000,
                    isUsingOverage: false,
                },
            },
            {
                type: 'result',
                subtype: 'error_during_execution',
                is_error: true,
                session_id: 'provider-session',
            },
        ]));

        const result = await svc.sendMessage({
            prompt: 'SECRET_PROMPT_TEXT',
            model: 'opus',
            workingDirectory: '/safe/project',
            mode: 'ask',
        });

        expect(result).toMatchObject({
            success: false,
            error: 'Claude returned error_during_execution',
            sessionId: 'provider-session',
            effectiveModel: 'opus',
        });

        const warning = capLogger.logs.find(log =>
            log.level === 'warn' &&
            log.message === 'Claude SDK result message reported failure'
        );
        expect(warning?.fields).toMatchObject({
            event: 'claude_result_failure',
            rateLimitType: 'seven_day_opus',
            rateLimitStatus: 'rejected',
            rateLimitUtilization: 0.99,
            rateLimitSurpassedThreshold: 1,
            rateLimitResetsAt: 1700500000000,
            rateLimitResetDate: new Date(1700500000000).toISOString(),
            rateLimitOverageStatus: 'rejected',
            rateLimitOverageResetsAt: 1700600000,
            rateLimitOverageResetDate: new Date(1700600000 * 1000).toISOString(),
            rateLimitIsUsingOverage: false,
        });
        expect(JSON.stringify(warning)).not.toContain('SECRET_PROMPT_TEXT');
    });

    it('treats allowed rate_limit_event messages as successful-session metadata', async () => {
        const capLogger = createCapturingLogger();
        initSDKLogger(capLogger.logger as any);
        queryFn.mockReturnValueOnce(makeMessages([
            {
                type: 'rate_limit_event',
                rate_limit_info: {
                    status: 'allowed',
                    rateLimitType: 'five_hour',
                    utilization: 0.12,
                    resetsAt: 1700000000,
                },
            },
            { type: 'result', subtype: 'success', result: 'ok' },
        ]));

        const result = await svc.sendMessage({ prompt: 'hello' });

        expect(result).toMatchObject({
            success: true,
            response: 'ok',
        });
        const debug = capLogger.logs.find(log =>
            log.level === 'debug' &&
            log.message === '[ClaudeQuota] session rate_limit_event — status=%s type=%s utilization=%s'
        );
        expect(debug?.args).toEqual(['allowed', 'five_hour', 0.12]);
        expect(capLogger.logs).not.toContainEqual(expect.objectContaining({
            level: 'warn',
            message: 'Claude SDK result message reported failure',
        }));
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

    // ── Background-task keep-alive (async resume) ───────────────────────────

    it('keeps the session open past the first result and surfaces the background resume (AC-01/AC-02)', async () => {
        queryFn.mockImplementationOnce(makeKeepAliveQuery(
            [
                { type: 'assistant', message: { content: [{ type: 'text', text: 'Starting background work.' }] } },
                {
                    type: 'assistant',
                    message: { content: [{ type: 'tool_use', id: 'bash-bg', name: 'Bash', input: { command: 'sleep 8 && echo done', run_in_background: true } }] },
                },
                { type: 'result', subtype: 'success', result: 'started' },
            ],
            [
                // Background completion arrives later in the SAME open session.
                { type: 'system', subtype: 'task_notification', task_id: 'task-1', tool_use_id: 'bash-bg', status: 'completed', summary: 'done' },
                { type: 'assistant', message: { content: [{ type: 'text', text: ' Background finished: done.' }] } },
                { type: 'result', subtype: 'success', result: 'all done' },
                { type: 'system', subtype: 'session_state_changed', state: 'idle' },
            ],
        ));

        const chunks: string[] = [];
        const toolEvents: object[] = [];
        const result = await svc.sendMessage({
            prompt: 'run a background command',
            onStreamingChunk: (c) => { if (c) chunks.push(c); },
            onToolEvent: (e) => toolEvents.push(e),
        });

        expect(result.success).toBe(true);
        // The post-result continuation is consumed and surfaced through callbacks.
        expect(chunks).toEqual(['Starting background work.', ' Background finished: done.']);
        expect(result.response).toBe('Starting background work. Background finished: done.');
        expect(toolEvents).toContainEqual(expect.objectContaining({ type: 'tool-start', toolName: 'Bash', toolCallId: 'bash-bg' }));
    }, 5000);

    it('fires onBackgroundTasksChanged with active>0 then active==0 (AC-05)', async () => {
        queryFn.mockImplementationOnce(makeKeepAliveQuery(
            [
                {
                    type: 'assistant',
                    message: { content: [{ type: 'tool_use', id: 'bash-bg', name: 'Bash', input: { command: 'sleep 5', run_in_background: true } }] },
                },
                { type: 'result', subtype: 'success', result: 'started' },
            ],
            [
                { type: 'system', subtype: 'task_notification', task_id: 'task-1', tool_use_id: 'bash-bg', status: 'completed' },
                { type: 'result', subtype: 'success', result: 'done' },
                { type: 'system', subtype: 'session_state_changed', state: 'idle' },
            ],
        ));

        const bgEvents: Array<{ backgroundTotalActive: number; backgroundWaitingForDrain: boolean; backgroundShells: Array<{ id: string }> }> = [];
        const result = await svc.sendMessage({
            prompt: 'bg',
            onBackgroundTasksChanged: (t) => bgEvents.push({
                backgroundTotalActive: t.backgroundTotalActive,
                backgroundWaitingForDrain: t.backgroundWaitingForDrain,
                backgroundShells: t.backgroundShells.map(s => ({ id: s.id })),
            }),
        });

        expect(result.success).toBe(true);
        const active = bgEvents.find(e => e.backgroundTotalActive > 0);
        expect(active).toBeDefined();
        expect(active!.backgroundWaitingForDrain).toBe(true);
        expect(active!.backgroundShells).toContainEqual({ id: 'bash-bg' });
        expect(bgEvents[bgEvents.length - 1]).toMatchObject({ backgroundTotalActive: 0, backgroundWaitingForDrain: false });
    }, 5000);

    it('settles exactly once at genuine idle and keeps the session alive meanwhile (AC-03)', async () => {
        let activeDuringWindow = -1;
        queryFn.mockImplementationOnce(makeKeepAliveQuery(
            [
                {
                    type: 'assistant',
                    message: { content: [{ type: 'tool_use', id: 'bash-bg', name: 'Bash', input: { command: 'sleep 5', run_in_background: true } }] },
                },
                { type: 'result', subtype: 'success', result: 'started' },
            ],
            [
                { type: 'system', subtype: 'task_notification', task_id: 't', tool_use_id: 'bash-bg', status: 'completed' },
                { type: 'result', subtype: 'success', result: 'done' },
                { type: 'system', subtype: 'session_state_changed', state: 'idle' },
            ],
            // Fires mid-window, after the first result but before the resume.
            () => { activeDuringWindow = svc.getActiveSessionCount(); },
        ));

        expect(svc.getActiveSessionCount()).toBe(0);
        const result = await svc.sendMessage({ prompt: 'bg' });

        expect(result.success).toBe(true);
        // The session (and its subprocess) stayed alive through the keep-alive window.
        expect(activeDuringWindow).toBeGreaterThanOrEqual(1);
        // Teardown ran exactly once at genuine idle: the session is now cleared.
        expect(svc.getActiveSessionCount()).toBe(0);
    }, 5000);

    it('aborts and tears down promptly during the keep-alive window (AC-03)', async () => {
        const controller = new AbortController();
        let sessionId = '';
        queryFn.mockImplementationOnce((opts: { abortController?: AbortController }) => {
            const ac = opts.abortController;
            return {
                async *[Symbol.asyncIterator]() {
                    yield {
                        type: 'assistant',
                        message: { content: [{ type: 'tool_use', id: 'bash-bg', name: 'Bash', input: { command: 'sleep 30', run_in_background: true } }] },
                    };
                    yield { type: 'result', subtype: 'success', result: 'started' };
                    // Background still pending → gate stays open. Block until aborted.
                    await new Promise<void>((_, reject) => {
                        if (ac?.signal.aborted) { reject(new Error('Aborted')); return; }
                        ac?.signal.addEventListener('abort', () => reject(new Error('Aborted')));
                    });
                },
                accountInfo: async () => ({}),
                return: async (value?: unknown) => ({ done: true as const, value }),
            };
        });

        const sendPromise = svc.sendMessage({
            prompt: 'bg',
            signal: controller.signal,
            onSessionCreated: (id) => { sessionId = id; },
        });

        await new Promise((r) => setTimeout(r, 0));
        expect(sessionId).toBeTruthy();
        expect(svc.hasActiveSession(sessionId)).toBe(true);

        controller.abort();
        const result = await sendPromise;
        expect(result).toBeDefined();
        expect(svc.hasActiveSession(sessionId)).toBe(false);
    }, 5000);

    it('settles promptly on the single result with no background work (AC-06)', async () => {
        // The input-aware mock blocks on the streaming input until the gate is
        // closed; if the no-background turn failed to settle on the result this
        // would hang and time out.
        queryFn.mockImplementationOnce(makeKeepAliveQuery([
            { type: 'assistant', message: { content: [{ type: 'text', text: 'Quick answer.' }] } },
            { type: 'result', subtype: 'success', result: 'Quick answer.' },
        ]));

        const result = await svc.sendMessage({ prompt: 'hello' });
        expect(result.success).toBe(true);
        expect(result.response).toBe('Quick answer.');
        expect(svc.getActiveSessionCount()).toBe(0);
    }, 5000);

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
        const allowedTools = queryFn.mock.calls[0][0].options.allowedTools ?? [];
        expect(allowedTools).not.toContain('Bash(gh:*)');
        expect(allowedTools).not.toContain('WebFetch');
    });

    it('uses acceptEdits permission mode for interactive mode', async () => {
        queryFn.mockReturnValueOnce(makeMessages([
            { type: 'result', subtype: 'success' },
        ]));

        await svc.sendMessage({ prompt: 'answer this', mode: 'interactive' });

        expect(queryFn.mock.calls[0][0].options.permissionMode).toBe('acceptEdits');
        expect(queryFn.mock.calls[0][0].options.allowDangerouslySkipPermissions).toBeUndefined();
    });

    it('auto-allows full Bash and WebFetch in interactive (ask) mode', async () => {
        queryFn.mockReturnValueOnce(makeMessages([
            { type: 'result', subtype: 'success' },
        ]));

        await svc.sendMessage({ prompt: 'investigate', mode: 'interactive' });

        const allowedTools = queryFn.mock.calls[0][0].options.allowedTools;
        expect(allowedTools).toContain('Bash');
        expect(allowedTools).toContain('WebFetch');
        expect(allowedTools).not.toContain('Bash(gh:*)');
    });

    it('uses acceptEdits permission mode when mode is undefined', async () => {
        queryFn.mockReturnValueOnce(makeMessages([
            { type: 'result', subtype: 'success' },
        ]));

        await svc.sendMessage({ prompt: 'answer this' });

        expect(queryFn.mock.calls[0][0].options.permissionMode).toBe('acceptEdits');
        expect(queryFn.mock.calls[0][0].options.allowDangerouslySkipPermissions).toBeUndefined();
    });

    it('auto-allows full Bash and WebFetch when mode is undefined', async () => {
        queryFn.mockReturnValueOnce(makeMessages([
            { type: 'result', subtype: 'success' },
        ]));

        await svc.sendMessage({ prompt: 'investigate' });

        const allowedTools = queryFn.mock.calls[0][0].options.allowedTools;
        expect(allowedTools).toContain('Bash');
        expect(allowedTools).toContain('WebFetch');
        expect(allowedTools).not.toContain('Bash(gh:*)');
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

        for (const alias of ['opus', 'sonnet', 'haiku', 'opus[1m]']) {
            queryFn.mockReset();
            queryFn.mockReturnValue(makeMessages([{ type: 'result', subtype: 'success' }]));
            await svc.sendMessage({ prompt: 'test', model: alias });
            expect(queryFn).toHaveBeenLastCalledWith(
                expect.objectContaining({ options: expect.objectContaining({ model: alias }) }),
            );
        }
    });

    it('keeps successful opus alias calls on the same response shape', async () => {
        queryFn.mockReturnValueOnce(makeMessages([
            { type: 'system', subtype: 'init', session_id: 'provider-session' },
            {
                type: 'assistant',
                message: { content: [{ type: 'text', text: 'CLAUDE_SDK_SMOKE_OK' }] },
            },
            {
                type: 'result',
                subtype: 'success',
                result: 'CLAUDE_SDK_SMOKE_OK',
                session_id: 'provider-session',
                duration_ms: 42,
                num_turns: 1,
                total_cost_usd: 0,
                usage: {
                    input_tokens: 2,
                    output_tokens: 3,
                    cache_creation_input_tokens: 0,
                    cache_read_input_tokens: 1,
                },
            },
        ]));

        const chunks: string[] = [];
        const createdSessionIds: string[] = [];
        const result = await svc.sendMessage({
            prompt: 'Reply exactly: CLAUDE_SDK_SMOKE_OK',
            model: 'opus',
            mode: 'ask',
            onStreamingChunk: (chunk) => chunks.push(chunk),
            onSessionCreated: (sessionId) => createdSessionIds.push(sessionId),
        });

        expect(result).toMatchObject({
            success: true,
            response: 'CLAUDE_SDK_SMOKE_OK',
            sessionId: 'provider-session',
            effectiveModel: 'opus',
            tokenUsage: {
                inputTokens: 2,
                outputTokens: 3,
                cacheReadTokens: 1,
                cacheWriteTokens: 0,
                totalTokens: 5,
                actualUsdCost: 0,
                duration: 42,
                turnCount: 1,
            },
        });
        expect(chunks).toEqual(['CLAUDE_SDK_SMOKE_OK', '']);
        expect(createdSessionIds[0]).toBeTruthy();
        expect(createdSessionIds[1]).toBe('provider-session');
        expect(queryFn).toHaveBeenCalledWith(
            expect.objectContaining({
                options: expect.objectContaining({
                    model: 'opus',
                    permissionMode: 'acceptEdits',
                }),
            }),
        );
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

    it('captures rate_limit_event messages for Windows quota fallback reporting', async () => {
        // Windows is the only platform that still uses the cached rate-limit
        // fallback; Linux and macOS route to the credential-backed OAuth path.
        const restorePlatform = stubProcessPlatform('win32');
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

describe('addClaudeContextUsage', () => {
    it('creates a context-only token usage envelope for Claude quota snapshots', () => {
        const usage = addClaudeContextUsage(undefined, {
            totalTokens: 1200,
            maxTokens: 200000,
            systemPromptSections: [{ tokens: 100 }, { tokens: 25 }],
            systemTools: [{ tokens: 40 }],
            mcpTools: [{ tokens: 30 }],
            deferredBuiltinTools: [{ tokens: 5 }],
            messageBreakdown: {
                toolCallTokens: 11,
                toolResultTokens: 12,
                attachmentTokens: 13,
                assistantMessageTokens: 14,
                userMessageTokens: 15,
                redirectedContextTokens: 16,
                unattributedTokens: 17,
            },
        });

        expect(usage).toEqual({
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: 0,
            turnCount: 0,
            tokenLimit: 200000,
            currentTokens: 1200,
            systemTokens: 125,
            toolDefinitionsTokens: 75,
            conversationTokens: 98,
        });
    });

    it('maps a full installed getContextUsage payload, using maxTokens (not rawMaxTokens) for tokenLimit', () => {
        // Mirrors the installed `@anthropic-ai/claude-agent-sdk`
        // `SDKControlGetContextUsageResponse` shape (sdk.d.ts:2802-2892): full
        // nested entries plus every sibling field the SDK returns. Assigned to a
        // `const` (not passed as a fresh literal) so the broader shape stays
        // structurally assignable to the local `ClaudeContextUsage` stub.
        //
        // `rawMaxTokens` is deliberately different from `maxTokens` so the test
        // fails if the mapping ever drifts onto the raw (uncapped) limit — the
        // effective `maxTokens` is the only correct source for `tokenLimit`.
        const response = {
            categories: [
                { name: 'System prompt', tokens: 125, color: 'blue' },
                { name: 'Messages', tokens: 98, color: 'green', isDeferred: false },
            ],
            totalTokens: 2400,
            maxTokens: 200000,
            rawMaxTokens: 1000000,
            percentage: 1.2,
            gridRows: [],
            model: 'claude-opus-4',
            memoryFiles: [{ path: 'CLAUDE.md', type: 'project', tokens: 42 }],
            mcpTools: [
                { name: 'search', serverName: 'coc', tokens: 30, isLoaded: true },
                { name: 'fetch', serverName: 'coc', tokens: 20, isLoaded: false },
            ],
            deferredBuiltinTools: [{ name: 'WebSearch', tokens: 5, isLoaded: false }],
            systemTools: [
                { name: 'Read', tokens: 40 },
                { name: 'Edit', tokens: 10 },
            ],
            systemPromptSections: [
                { name: 'identity', tokens: 100 },
                { name: 'tools', tokens: 25 },
            ],
            agents: [{ agentType: 'Explore', source: 'builtin', tokens: 12 }],
            slashCommands: { totalCommands: 5, includedCommands: 3, tokens: 8 },
            skills: { totalSkills: 2, includedSkills: 1, tokens: 4, skillFrontmatter: [] },
            autoCompactThreshold: 0.8,
            isAutoCompactEnabled: true,
            messageBreakdown: {
                toolCallTokens: 11,
                toolResultTokens: 12,
                attachmentTokens: 13,
                assistantMessageTokens: 14,
                userMessageTokens: 15,
                redirectedContextTokens: 16,
                unattributedTokens: 17,
                toolCallsByType: [{ name: 'Read', callTokens: 5, resultTokens: 6 }],
                attachmentsByType: [{ name: 'image', tokens: 13 }],
            },
            apiUsage: {
                input_tokens: 1000,
                output_tokens: 200,
                cache_creation_input_tokens: 50,
                cache_read_input_tokens: 80,
            },
        };

        const usage = addClaudeContextUsage(undefined, response);

        // tokenLimit maps from maxTokens (200000), never rawMaxTokens (1000000).
        expect(usage?.tokenLimit).toBe(200000);
        expect(usage?.currentTokens).toBe(2400);
        // systemPromptSections: 100 + 25
        expect(usage?.systemTokens).toBe(125);
        // systemTools (40 + 10) + mcpTools (30 + 20) + deferredBuiltinTools (5)
        expect(usage?.toolDefinitionsTokens).toBe(105);
        // messageBreakdown: 11 + 12 + 13 + 14 + 15 + 16 + 17
        expect(usage?.conversationTokens).toBe(98);
        // apiUsage seeds the per-turn envelope when there is no prior usage.
        expect(usage?.inputTokens).toBe(1000);
        expect(usage?.outputTokens).toBe(200);
        expect(usage?.cacheReadTokens).toBe(80);
        expect(usage?.cacheWriteTokens).toBe(50);
    });

    it('preserves per-turn counters while overwriting snapshot fields with the latest values (AC-03)', () => {
        // An existing per-turn usage already carrying counters, cost, and a
        // STALE context snapshot from an earlier refresh.
        const existing: TokenUsage = {
            inputTokens: 100,
            outputTokens: 40,
            cacheReadTokens: 7,
            cacheWriteTokens: 3,
            totalTokens: 140,
            turnCount: 2,
            actualUsdCost: 0.5,
            duration: 1234,
            tokenLimit: 200000,
            currentTokens: 1000,
            systemTokens: 10,
            toolDefinitionsTokens: 20,
            conversationTokens: 30,
        };

        const merged = addClaudeContextUsage(existing, {
            totalTokens: 2400,
            maxTokens: 200000,
            systemPromptSections: [{ tokens: 125 }],
            systemTools: [{ tokens: 75 }],
            messageBreakdown: { assistantMessageTokens: 60, userMessageTokens: 38 },
        });

        // Per-turn counters and cost/duration are preserved untouched.
        expect(merged?.inputTokens).toBe(100);
        expect(merged?.outputTokens).toBe(40);
        expect(merged?.cacheReadTokens).toBe(7);
        expect(merged?.cacheWriteTokens).toBe(3);
        expect(merged?.totalTokens).toBe(140);
        expect(merged?.turnCount).toBe(2);
        expect(merged?.actualUsdCost).toBe(0.5);
        expect(merged?.duration).toBe(1234);
        // Snapshot fields reflect the LATEST getContextUsage response.
        expect(merged?.tokenLimit).toBe(200000);
        expect(merged?.currentTokens).toBe(2400);
        expect(merged?.systemTokens).toBe(125);
        expect(merged?.toolDefinitionsTokens).toBe(75);
        expect(merged?.conversationTokens).toBe(98);
    });

    it('returns the current usage unchanged when the snapshot is undefined (AC-03)', () => {
        const existing: TokenUsage = {
            inputTokens: 12,
            outputTokens: 8,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: 20,
            turnCount: 1,
            tokenLimit: 100000,
            currentTokens: 500,
        };

        const merged = addClaudeContextUsage(existing, undefined);

        expect(merged).toEqual(existing);
    });

    it('returns undefined when both current usage and snapshot are missing (AC-03)', () => {
        expect(addClaudeContextUsage(undefined, undefined)).toBeUndefined();
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
        // Windows keeps the cached rate-limit/accountInfo fallback (Linux and
        // macOS route to the credential-backed OAuth path instead).
        restorePlatform = stubProcessPlatform('win32');
        svc = new ClaudeSDKService();
        mockDynamicImport.mockReset();
        queryFn.mockReset();
        mockDynamicImport.mockResolvedValue({ query: queryFn });
        // Point to a nonexistent file so any credential path stays deterministic
        // on machines that have Claude installed.
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

// ============================================================================
// readKeychainCredentials (macOS Keychain reader — injectable exec)
// ============================================================================

describe('readKeychainCredentials', () => {
    it('shells out to `security` with an argument array (no shell interpolation)', () => {
        const exec = vi.fn().mockReturnValue('{"access_token":"kc-tok"}\n');
        const result = readKeychainCredentials(exec as unknown as typeof import('child_process').execFileSync);

        expect(exec).toHaveBeenCalledWith(
            'security',
            ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
            { encoding: 'utf8' },
        );
        // Trailing newline from the CLI is stripped.
        expect(result).toBe('{"access_token":"kc-tok"}');
    });

    it('returns undefined when `security` exits non-zero / has no matching entry', () => {
        const exec = vi.fn(() => { throw new Error('SecKeychainSearchCopyNext: not found'); });
        expect(readKeychainCredentials(exec as unknown as typeof import('child_process').execFileSync)).toBeUndefined();
    });

    it('returns undefined when the `security` binary is absent (ENOENT)', () => {
        const exec = vi.fn(() => {
            const err = new Error('spawn security ENOENT') as NodeJS.ErrnoException;
            err.code = 'ENOENT';
            throw err;
        });
        expect(readKeychainCredentials(exec as unknown as typeof import('child_process').execFileSync)).toBeUndefined();
    });

    it('returns undefined for empty / whitespace-only output', () => {
        const empty = vi.fn().mockReturnValue('');
        const blank = vi.fn().mockReturnValue('   \n');
        expect(readKeychainCredentials(empty as unknown as typeof import('child_process').execFileSync)).toBeUndefined();
        expect(readKeychainCredentials(blank as unknown as typeof import('child_process').execFileSync)).toBeUndefined();
    });
});

// ============================================================================
// resolveClaudeCredentialsRaw (credential source resolution order)
// ============================================================================

describe('resolveClaudeCredentialsRaw', () => {
    it('uses $CLAUDE_CREDENTIALS_FILE when set and never reads the Keychain', () => {
        const readKeychain = vi.fn();
        const readFile = vi.fn((p: string) => (p === '/env/creds.json' ? '{"access_token":"env"}' : undefined));

        const raw = resolveClaudeCredentialsRaw({
            credentialsFileEnv: '/env/creds.json',
            homeDir: '/home/user',
            readFile,
            readKeychain,
        });

        expect(raw).toBe('{"access_token":"env"}');
        expect(readFile).toHaveBeenCalledWith('/env/creds.json');
        expect(readKeychain).not.toHaveBeenCalled();
    });

    it('returns undefined (and never reads the Keychain) when the env-var file is missing', () => {
        const readKeychain = vi.fn().mockReturnValue('{"access_token":"kc"}');
        const readFile = vi.fn(() => undefined);

        const raw = resolveClaudeCredentialsRaw({
            credentialsFileEnv: '/env/missing.json',
            homeDir: '/home/user',
            readFile,
            readKeychain,
        });

        expect(raw).toBeUndefined();
        expect(readKeychain).not.toHaveBeenCalled();
    });

    it('falls back to ~/.claude/.credentials.json when no env var is set', () => {
        const expected = path.join('/home/user', '.claude', '.credentials.json');
        const readKeychain = vi.fn();
        const readFile = vi.fn((p: string) => (p === expected ? '{"access_token":"file"}' : undefined));

        const raw = resolveClaudeCredentialsRaw({
            credentialsFileEnv: undefined,
            homeDir: '/home/user',
            readFile,
            readKeychain,
        });

        expect(raw).toBe('{"access_token":"file"}');
        expect(readKeychain).not.toHaveBeenCalled();
    });

    it('invokes the Keychain reader when there is no env var and no on-disk file', () => {
        const readKeychain = vi.fn().mockReturnValue('{"claudeAiOauth":{"accessToken":"kc-tok"}}');
        const readFile = vi.fn(() => undefined);

        const raw = resolveClaudeCredentialsRaw({
            credentialsFileEnv: undefined,
            homeDir: '/home/user',
            readFile,
            readKeychain,
        });

        expect(readFile).toHaveBeenCalledWith(path.join('/home/user', '.claude', '.credentials.json'));
        expect(readKeychain).toHaveBeenCalledOnce();
        expect(raw).toBe('{"claudeAiOauth":{"accessToken":"kc-tok"}}');
    });

    it('returns undefined when neither the file nor the Keychain yield content', () => {
        const raw = resolveClaudeCredentialsRaw({
            credentialsFileEnv: undefined,
            homeDir: '/home/user',
            readFile: () => undefined,
            readKeychain: () => undefined,
        });
        expect(raw).toBeUndefined();
    });
});

// ============================================================================
// getAccountQuota — macOS / Keychain integration
// ============================================================================

describe('ClaudeSDKService.getAccountQuota (macOS / Keychain)', () => {
    let svc: ClaudeSDKService;
    const queryFn = vi.fn();
    let fetchSpy: ReturnType<typeof vi.fn>;
    let tempCredFile: string;
    let restorePlatform: () => void;

    beforeEach(() => {
        restorePlatform = stubProcessPlatform('darwin');
        svc = new ClaudeSDKService();
        mockDynamicImport.mockReset();
        queryFn.mockReset();
        mockDynamicImport.mockResolvedValue({ query: queryFn });
        fetchSpy = vi.fn();
        vi.stubGlobal('fetch', fetchSpy);
        tempCredFile = path.join(os.tmpdir(), `coc-test-creds-darwin-${Date.now()}.json`);
        delete process.env['CLAUDE_CREDENTIALS_FILE'];
    });

    afterEach(() => {
        svc.dispose();
        restorePlatform();
        vi.unstubAllGlobals();
        delete process.env['CLAUDE_CREDENTIALS_FILE'];
        try { fs.unlinkSync(tempCredFile); } catch { /* already removed or never created */ }
    });

    it('routes the darwin branch to the credential-backed OAuth path (AC-01)', async () => {
        // With the env-var file present, getAccountQuota() must take the OAuth
        // path on darwin rather than the cached rate-limit fallback.
        process.env['CLAUDE_CREDENTIALS_FILE'] = tempCredFile;
        fs.writeFileSync(tempCredFile, JSON.stringify({ access_token: 'darwin-tok' }));
        fetchSpy.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ five_hour: { utilization: 55 }, seven_day: { utilization: 22 } }),
        });

        const quota = await svc.getAccountQuota();

        expect(fetchSpy).toHaveBeenCalledWith(
            'https://api.anthropic.com/api/oauth/usage',
            expect.objectContaining({ headers: expect.objectContaining({ 'Authorization': 'Bearer darwin-tok' }) }),
        );
        expect(quota.quotaSnapshots.five_hour.usedRequests).toBe(55);
        expect(quota.quotaSnapshots.seven_day.usedRequests).toBe(22);
    });

    it('populates five_hour/seven_day from valid Keychain credentials (AC-04)', async () => {
        const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-home-'));
        const readKeychain = vi.fn().mockReturnValue(JSON.stringify({
            claudeAiOauth: { accessToken: 'kc-access-tok', refreshToken: 'r', expiresAt: 9999999999999 },
        }));
        fetchSpy.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                five_hour: { utilization: 40, resets_at: '2026-06-04T12:00:00.000Z' },
                seven_day: { utilization: 18, resets_at: '2026-06-11T00:00:00.000Z' },
            }),
        });

        const quota = await fetchClaudeOAuthQuota({ readKeychain, homeDir: emptyHome });

        expect(readKeychain).toHaveBeenCalledOnce();
        expect(fetchSpy).toHaveBeenCalledWith(
            'https://api.anthropic.com/api/oauth/usage',
            expect.objectContaining({ headers: expect.objectContaining({ 'Authorization': 'Bearer kc-access-tok' }) }),
        );
        expect(quota.quotaSnapshots.five_hour.usedRequests).toBe(40);
        expect(quota.quotaSnapshots.seven_day.usedRequests).toBe(18);
        try { fs.rmSync(emptyHome, { recursive: true, force: true }); } catch { /* best effort */ }
    });

    it('returns empty snapshots when there is no Keychain entry (AC-04)', async () => {
        const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-home-'));
        const readKeychain = vi.fn().mockReturnValue(undefined);

        const quota = await fetchClaudeOAuthQuota({ readKeychain, homeDir: emptyHome });

        expect(quota).toEqual({ quotaSnapshots: {} });
        expect(fetchSpy).not.toHaveBeenCalled();
        try { fs.rmSync(emptyHome, { recursive: true, force: true }); } catch { /* best effort */ }
    });

    it('returns empty snapshots for a malformed Keychain payload (AC-04)', async () => {
        const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-home-'));
        const readKeychain = vi.fn().mockReturnValue('not-json{{{');

        const quota = await fetchClaudeOAuthQuota({ readKeychain, homeDir: emptyHome });

        expect(quota).toEqual({ quotaSnapshots: {} });
        expect(fetchSpy).not.toHaveBeenCalled();
        try { fs.rmSync(emptyHome, { recursive: true, force: true }); } catch { /* best effort */ }
    });

    it('returns empty snapshots on a 401 from the usage API with Keychain creds (AC-04)', async () => {
        const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-home-'));
        const readKeychain = vi.fn().mockReturnValue(JSON.stringify({ claudeAiOauth: { accessToken: 'kc-tok' } }));
        fetchSpy.mockResolvedValueOnce({ ok: false, status: 401 });

        const quota = await fetchClaudeOAuthQuota({ readKeychain, homeDir: emptyHome });

        expect(quota).toEqual({ quotaSnapshots: {} });
        try { fs.rmSync(emptyHome, { recursive: true, force: true }); } catch { /* best effort */ }
    });

    it('returns empty snapshots on a network error with Keychain creds (AC-04)', async () => {
        const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-home-'));
        const readKeychain = vi.fn().mockReturnValue(JSON.stringify({ claudeAiOauth: { accessToken: 'kc-tok' } }));
        fetchSpy.mockRejectedValueOnce(new Error('Network failure'));

        const quota = await fetchClaudeOAuthQuota({ readKeychain, homeDir: emptyHome });

        expect(quota).toEqual({ quotaSnapshots: {} });
        try { fs.rmSync(emptyHome, { recursive: true, force: true }); } catch { /* best effort */ }
    });

    it('prefers $CLAUDE_CREDENTIALS_FILE over the Keychain on darwin (AC-02)', async () => {
        process.env['CLAUDE_CREDENTIALS_FILE'] = tempCredFile;
        fs.writeFileSync(tempCredFile, JSON.stringify({ access_token: 'file-wins' }));
        const readKeychain = vi.fn().mockReturnValue(JSON.stringify({ claudeAiOauth: { accessToken: 'kc-loses' } }));
        fetchSpy.mockResolvedValueOnce({ ok: true, json: async () => ({ five_hour: { utilization: 5 } }) });

        const quota = await fetchClaudeOAuthQuota({ readKeychain });

        expect(readKeychain).not.toHaveBeenCalled();
        expect(fetchSpy).toHaveBeenCalledWith(
            'https://api.anthropic.com/api/oauth/usage',
            expect.objectContaining({ headers: expect.objectContaining({ 'Authorization': 'Bearer file-wins' }) }),
        );
        expect(quota.quotaSnapshots.five_hour.usedRequests).toBe(5);
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

    it('rewindSession throws the typed RewindUnsupportedError (AC-02)', async () => {
        await expect(svc.rewindSession('any-id', 'evt-1')).rejects.toBeInstanceOf(RewindUnsupportedError);
        await expect(svc.rewindSession('any-id', 'evt-1')).rejects.toMatchObject({
            code: 'REWIND_UNSUPPORTED',
            provider: CLAUDE_PROVIDER,
        });
        const err = await svc.rewindSession('any-id', 'evt-1').catch((e) => e);
        expect(isRewindUnsupportedError(err)).toBe(true);
    });

    // compactSession is now supported for Claude via the native `/compact`
    // slash command — its success / capability-absent / no-op behavior is
    // covered by the dedicated 'ClaudeSDKService.compactSession' block below.

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
// compactSession — native `/compact` slash command (AC-01/02/03/04)
// ============================================================================

/** Captures what the provider sent to the mocked `query()` for a compaction turn. */
interface CompactCapture {
    prompt?: string;
    resume?: string;
}

/**
 * Builds a `queryFn` that models a resumed `/compact` turn:
 *  - exposes `supportedCommands()` for the AC-04 capability gate (unless
 *    `supportedCommandsMissing`/`supportedCommandsError` is set);
 *  - fires any registered `PostCompact` hook with `compact_summary` (AC-02),
 *    then yields the compaction message stream;
 *  - records the `/compact <instructions>` prompt and `resume` id the provider
 *    sent (AC-03) without prematurely finalizing the streaming-input gate.
 */
function makeCompactQuery(config: {
    messages: object[];
    supportedCommands?: Array<{ name?: string; aliases?: string[] }>;
    supportedCommandsMissing?: boolean;
    supportedCommandsError?: Error;
    postCompactSummary?: string;
    capture?: CompactCapture;
}) {
    return (queryOptions: { prompt: unknown; options?: { hooks?: any; resume?: string } }) => {
        if (config.capture) config.capture.resume = queryOptions.options?.resume;
        const postCompactHook = queryOptions.options?.hooks?.PostCompact?.[0]?.hooks?.[0];
        const handle: Record<string, unknown> = {
            async *[Symbol.asyncIterator]() {
                const iterator = (queryOptions.prompt as AsyncIterable<any>)[Symbol.asyncIterator]();
                // Record the first user message (the `/compact …` prompt) without
                // finalizing the gate, so the provider can still close it later.
                const first = await iterator.next();
                if (config.capture && !first.done) {
                    const content = first.value?.message?.content;
                    config.capture.prompt = typeof content === 'string'
                        ? content
                        : Array.isArray(content)
                            ? (content.find((b: any) => b?.type === 'text')?.text ?? '')
                            : '';
                }
                if (postCompactHook && config.postCompactSummary !== undefined) {
                    await postCompactHook({
                        hook_event_name: 'PostCompact',
                        trigger: 'manual',
                        compact_summary: config.postCompactSummary,
                    });
                }
                for (const msg of config.messages) yield msg;
                // Safety drain: block until the provider closes the input gate
                // (only reached if a test omits a terminal `result` message).
                for (;;) {
                    const next = await iterator.next();
                    if (next.done) break;
                }
            },
            accountInfo: async () => ({}),
            return: async (value?: unknown) => ({ done: true as const, value }),
        };
        if (config.supportedCommandsError) {
            handle.supportedCommands = async () => { throw config.supportedCommandsError; };
        } else if (!config.supportedCommandsMissing) {
            handle.supportedCommands = async () => config.supportedCommands ?? [{ name: 'compact', aliases: [] }];
        }
        return handle;
    };
}

/** A realistic manual-compaction success stream (status → boundary → summary → result). */
function compactSuccessMessages(pre: number, post: number): object[] {
    return [
        { type: 'system', subtype: 'status', status: 'compacting', session_id: 's1' },
        { type: 'system', subtype: 'status', status: null, compact_result: 'success', session_id: 's1' },
        { type: 'system', subtype: 'init', session_id: 's1' },
        {
            type: 'system',
            subtype: 'compact_boundary',
            compact_metadata: {
                trigger: 'manual',
                pre_tokens: pre,
                post_tokens: post,
                duration_ms: 14600,
                preserved_messages: { anchor_uuid: 'a', uuids: ['u1', 'u2'] },
            },
            session_id: 's1',
        },
        { type: 'user', message: { content: 'This session is being continued from a previous conversation…' } },
        { type: 'user', message: { content: '<local-command-stdout>Compacted.</local-command-stdout>' } },
        { type: 'result', subtype: 'success', result: '' },
    ];
}

describe('ClaudeSDKService.compactSession (native /compact)', () => {
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

    it('AC-01/02: maps a manual compact_boundary + PostCompact summary to CompactResult', async () => {
        queryFn.mockImplementation(
            makeCompactQuery({
                messages: compactSuccessMessages(23032, 2429),
                postCompactSummary: 'A concise summary of the conversation so far.',
            }),
        );

        const result = await svc.compactSession('session-abc');

        expect(result).toEqual({
            success: true,
            tokensRemoved: 20603, // pre - post
            messagesRemoved: 0, // best-effort fallback (not derivable from resume stream)
            summaryContent: 'A concise summary of the conversation so far.',
        });
    });

    it('AC-02: clamps tokensRemoved to 0 when post_tokens exceeds pre_tokens', async () => {
        queryFn.mockImplementation(
            makeCompactQuery({ messages: compactSuccessMessages(100, 500), postCompactSummary: 'x' }),
        );

        const result = await svc.compactSession('session-abc');

        expect(result.success).toBe(true);
        expect(result.tokensRemoved).toBe(0);
    });

    it('AC-02: falls back to the post-boundary user message when the PostCompact hook yields no summary', async () => {
        // No `postCompactSummary` → the hook never delivers one; the provider must
        // fall back to the first user message after the boundary.
        queryFn.mockImplementation(makeCompactQuery({ messages: compactSuccessMessages(23032, 2429) }));

        const result = await svc.compactSession('session-abc');

        expect(result.success).toBe(true);
        expect(result.summaryContent).toBe('This session is being continued from a previous conversation…');
    });

    it('AC-03: forwards custom instructions as the /compact argument and resumes the session', async () => {
        const capture: CompactCapture = {};
        queryFn.mockImplementation(
            makeCompactQuery({ messages: compactSuccessMessages(9000, 1000), postCompactSummary: 's', capture }),
        );

        await svc.compactSession('session-xyz', '  focus on the auth refactor  ');

        expect(capture.prompt).toBe('/compact focus on the auth refactor');
        expect(capture.resume).toBe('session-xyz');
    });

    it('AC-03: issues a bare /compact when no instructions are given', async () => {
        const capture: CompactCapture = {};
        queryFn.mockImplementation(
            makeCompactQuery({ messages: compactSuccessMessages(9000, 1000), postCompactSummary: 's', capture }),
        );

        await svc.compactSession('session-xyz');

        expect(capture.prompt).toBe('/compact');
    });

    it('reports a no-op (success:false) without throwing when compaction finds too few messages', async () => {
        queryFn.mockImplementation(
            makeCompactQuery({
                messages: [
                    { type: 'system', subtype: 'status', status: 'compacting', session_id: 's1' },
                    {
                        type: 'system',
                        subtype: 'status',
                        compact_result: 'failed',
                        compact_error: 'Not enough messages to compact.',
                        session_id: 's1',
                    },
                    { type: 'system', subtype: 'init', session_id: 's1' },
                    { type: 'assistant', message: { content: [{ type: 'text', text: 'Not enough messages to compact.' }] } },
                    { type: 'result', subtype: 'success', result: 'Not enough messages to compact.' },
                ],
            }),
        );

        const result = await svc.compactSession('session-abc');

        expect(result).toEqual({ success: false, tokensRemoved: 0, messagesRemoved: 0 });
    });

    it('AC-04: throws CompactUnsupportedError when the CLI does not advertise /compact', async () => {
        queryFn.mockImplementation(
            makeCompactQuery({ messages: [], supportedCommands: [{ name: 'help' }, { name: 'clear' }] }),
        );

        await expect(svc.compactSession('session-abc')).rejects.toBeInstanceOf(CompactUnsupportedError);
        const err = await svc.compactSession('session-abc').catch((e) => e);
        expect(isCompactUnsupportedError(err)).toBe(true);
        expect(err).toMatchObject({ code: 'COMPACT_UNSUPPORTED', provider: CLAUDE_PROVIDER });
    });

    it('AC-04: throws CompactUnsupportedError when the handle exposes no supportedCommands method', async () => {
        queryFn.mockImplementation(makeCompactQuery({ messages: [], supportedCommandsMissing: true }));

        await expect(svc.compactSession('session-abc')).rejects.toBeInstanceOf(CompactUnsupportedError);
    });

    it('AC-04: treats a supportedCommands() failure as unsupported (throws, does not hang)', async () => {
        queryFn.mockImplementation(
            makeCompactQuery({ messages: [], supportedCommandsError: new Error('control channel closed') }),
        );

        await expect(svc.compactSession('session-abc')).rejects.toBeInstanceOf(CompactUnsupportedError);
    });

    it('recognizes /compact advertised via an alias rather than the command name', async () => {
        queryFn.mockImplementation(
            makeCompactQuery({
                messages: compactSuccessMessages(5000, 1000),
                postCompactSummary: 's',
                supportedCommands: [{ name: 'summarize', aliases: ['compact'] }],
            }),
        );

        const result = await svc.compactSession('session-abc');

        expect(result.success).toBe(true);
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

    it('returns a structured success result with the response text', async () => {
        queryFn.mockReturnValueOnce(makeMessages([
            {
                type: 'assistant',
                message: { content: [{ type: 'text', text: 'parsed result' }] },
            },
            { type: 'result', subtype: 'success' },
        ]));

        const result = await svc.transform('give me the result');
        expect(result.success).toBe(true);
        expect(result.text).toBe('parsed result');
    });

    it('returns a failure result (does not throw) when sendMessage fails', async () => {
        mockDynamicImport.mockRejectedValueOnce(new Error("Cannot find module '@anthropic-ai/claude-agent-sdk'"));
        const result = await svc.transform('fail');
        expect(result.success).toBe(false);
        expect(result.error).toBeTruthy();
    });
});
