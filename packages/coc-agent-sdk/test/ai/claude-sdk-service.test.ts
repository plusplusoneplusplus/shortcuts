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
import {
    ClaudeSDKService,
    mapClaudeAccountInfoToQuota,
    mapClaudeRateLimitInfoToQuota,
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

/** Wraps a message array as a query handle with an optional accountInfo spy. */
function makeQueryHandle(messages: object[], accountInfoFn?: () => Promise<object>) {
    const handle = {
        [Symbol.asyncIterator]() { return makeMessages(messages)[Symbol.asyncIterator](); },
        accountInfo: accountInfoFn ?? vi.fn<[], Promise<object>>().mockResolvedValue({}),
        return: vi.fn(async (value?: unknown) => ({ done: true as const, value })),
    };
    return handle;
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

    it('captures rate_limit_event messages for quota reporting', async () => {
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
    });
});

// ============================================================================
// getAccountQuota
// ============================================================================

describe('ClaudeSDKService.getAccountQuota', () => {
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
