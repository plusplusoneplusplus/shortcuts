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
import { ClaudeSDKService, registerClaudeSDKService } from '../../src/claude-sdk-service';
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

import { dynamicImportModule } from '../../src/sdk-esm-loader';
const mockDynamicImport = vi.mocked(dynamicImportModule);

// ============================================================================
// Helper: build an async generator from an array of messages
// ============================================================================

async function* makeMessages(messages: object[]): AsyncIterable<object> {
    for (const msg of messages) {
        yield msg;
    }
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

    it('emits tool-start and tool-complete events for tool_use blocks', async () => {
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

        expect(toolEvents).toHaveLength(2);
        expect((toolEvents[0] as any).type).toBe('tool-start');
        expect((toolEvents[0] as any).toolName).toBe('read_file');
        expect((toolEvents[1] as any).type).toBe('tool-complete');
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
});

// ============================================================================
// Unsupported operations
// ============================================================================

describe('ClaudeSDKService unsupported operations', () => {
    let svc: ClaudeSDKService;

    beforeEach(() => {
        svc = new ClaudeSDKService();
        mockDynamicImport.mockReset();
        mockDynamicImport.mockResolvedValue({ query: vi.fn() });
    });

    afterEach(() => {
        svc.dispose();
    });

    it('forkSession throws an explicit unsupported error', async () => {
        await expect(svc.forkSession('any-id')).rejects.toThrow(/does not support session forking/);
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
