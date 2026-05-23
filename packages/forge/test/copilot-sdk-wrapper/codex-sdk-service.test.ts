/**
 * Tests for CodexSDKService and SDK_PROVIDER_CODEX constant.
 *
 * Because `@openai/codex-sdk` is an optional peer dependency that is not
 * installed in this repo, all tests exercise the "SDK not available" branch
 * unless a mock is injected via module mocking.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { CodexSDKService, registerCodexSDKService } from '../../src/copilot-sdk-wrapper/codex-sdk-service';
import {
    sdkServiceRegistry,
    CODEX_PROVIDER,
    SDK_PROVIDER_CODEX,
} from '../../src/copilot-sdk-wrapper/sdk-service-registry';

// ---------------------------------------------------------------------------
// Helper: build a minimal mock @openai/codex-sdk module
// ---------------------------------------------------------------------------

function makeCodexSdkMock(overrides?: {
    runResult?: { text: string };
    runError?: Error;
    abortOnRun?: boolean;
}) {
    const threads = new Map<string, { id: string; runCalls: string[] }>();
    let threadCounter = 0;

    function makeThread(id: string) {
        const record = { id, runCalls: [] as string[] };
        threads.set(id, record);
        return {
            id,
            run: vi.fn(async (prompt: string) => {
                record.runCalls.push(prompt);
                if (overrides?.runError) throw overrides.runError;
                const text = overrides?.runResult?.text ?? `response to: ${prompt}`;
                return { finalResponse: text };
            }),
            runStreamed: vi.fn(async (prompt: string) => {
                record.runCalls.push(prompt);
                if (overrides?.runError) throw overrides.runError;
                const text = overrides?.runResult?.text ?? `response to: ${prompt}`;
                async function* events() {
                    yield { type: 'thread.started' as const, thread_id: id };
                    yield {
                        type: 'item.completed' as const,
                        item: { id: 'item-1', type: 'agent_message', text },
                    };
                    yield {
                        type: 'turn.completed' as const,
                        usage: {
                            input_tokens: 1,
                            cached_input_tokens: 0,
                            output_tokens: 1,
                            reasoning_output_tokens: 0,
                        },
                    };
                }
                return { events: events() };
            }),
        };
    }

    return {
        startThread: vi.fn(() => makeThread(`thread-${++threadCounter}`)),
        resumeThread: vi.fn((id: string) => {
            // Return existing or create new for resumed id
            if (!threads.has(id)) {
                return makeThread(id);
            }
            const existing = threads.get(id)!;
            return {
                id: existing.id,
                run: vi.fn(async (prompt: string) => {
                    existing.runCalls.push(prompt);
                    const text = `resumed: ${prompt}`;
                    return { finalResponse: text };
                }),
                runStreamed: vi.fn(async (prompt: string) => {
                    existing.runCalls.push(prompt);
                    const text = `resumed: ${prompt}`;
                    async function* events() {
                        yield { type: 'thread.started' as const, thread_id: existing.id };
                        yield {
                            type: 'item.completed' as const,
                            item: { id: 'item-1', type: 'agent_message', text },
                        };
                    }
                    return { events: events() };
                }),
            };
        }),
        _threads: threads,
    };
}

// ---------------------------------------------------------------------------
// Unit tests — SDK not installed (default)
// ---------------------------------------------------------------------------

describe('CodexSDKService — SDK not available', () => {
    let svc: CodexSDKService;

    beforeEach(() => {
        svc = new CodexSDKService();
    });

    afterEach(() => {
        svc.dispose();
    });

    it('isAvailable returns false when @openai/codex-sdk is not installed', async () => {
        const result = await svc.isAvailable();
        expect(result.available).toBe(false);
        expect(result.error).toContain('Codex SDK not found');
    });

    it('isAvailable caches the result on subsequent calls', async () => {
        const first = await svc.isAvailable();
        const second = await svc.isAvailable();
        expect(first).toBe(second);
    });

    it('clearAvailabilityCache resets the cache', async () => {
        await svc.isAvailable();
        svc.clearAvailabilityCache();
        const result = await svc.isAvailable();
        // Should re-check; still unavailable
        expect(result.available).toBe(false);
    });

    it('sendMessage returns failure when SDK is not available', async () => {
        const result = await svc.sendMessage({ prompt: 'hello' });
        expect(result.success).toBe(false);
        expect(result.error).toBeTruthy();
    });

    it('listModels throws when SDK is not available', async () => {
        await expect(svc.listModels()).rejects.toThrow('Codex SDK');
    });

    it('transform throws when SDK is not available', async () => {
        await expect(svc.transform('prompt')).rejects.toThrow('Codex SDK');
    });

    it('forkSession throws when SDK is not available', async () => {
        await expect(svc.forkSession('s1')).rejects.toThrow('Codex SDK');
    });

    it('abortSession returns false for unknown session', async () => {
        expect(await svc.abortSession('nonexistent')).toBe(false);
    });

    it('softAbortSession returns false for unknown session', async () => {
        expect(await svc.softAbortSession('nonexistent')).toBe(false);
    });

    it('steerSession always returns false', async () => {
        expect(await svc.steerSession('s1', 'steer')).toBe(false);
    });

    it('hasActiveSession returns false when no sessions are tracked', () => {
        expect(svc.hasActiveSession('s1')).toBe(false);
    });

    it('getActiveSessionCount returns 0 when idle', () => {
        expect(svc.getActiveSessionCount()).toBe(0);
    });

    it('cleanup resolves without error', async () => {
        await expect(svc.cleanup()).resolves.toBeUndefined();
    });

    it('dispose makes subsequent isAvailable return disposed error', async () => {
        svc.dispose();
        const result = await svc.isAvailable();
        expect(result.available).toBe(false);
        expect(result.error).toContain('disposed');
    });

    it('sendMessage after dispose returns disposed error', async () => {
        svc.dispose();
        const result = await svc.sendMessage({ prompt: 'test' });
        expect(result.success).toBe(false);
        expect(result.error).toContain('disposed');
    });
});

// ---------------------------------------------------------------------------
// Unit tests — SDK mocked as available
// ---------------------------------------------------------------------------

describe('CodexSDKService — SDK mocked', () => {
    let svc: CodexSDKService;

    beforeEach(async () => {
        svc = new CodexSDKService();
        // Inject the mock SDK directly to bypass the dynamic import
        const codexMock = makeCodexSdkMock();
        // @ts-expect-error — accessing private field in test
        svc['sdk'] = codexMock;
        // @ts-expect-error — bypass availability check
        svc['availabilityCache'] = { available: true };
    });

    afterEach(() => {
        svc.dispose();
    });

    it('listModels returns a non-empty list', async () => {
        const catalogModels = [
            {
                id: 'gpt-5.5',
                name: 'GPT-5.5',
                capabilities: {
                    supports: {
                        vision: false,
                        reasoningEffort: true,
                        reasoning_effort: ['low', 'medium', 'high', 'xhigh'],
                    },
                    limits: { max_context_window_tokens: 0 },
                },
                supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
                defaultReasoningEffort: 'medium',
            },
        ];
        // @ts-expect-error — private method override for deterministic test
        svc['loadModelCatalog'] = vi.fn().mockResolvedValue(catalogModels);

        const models = await svc.listModels();
        expect(models).toEqual(catalogModels);
    });

    it('maps only listable Codex catalog models', () => {
        const mapCatalogModel = svc['mapCatalogModel'].bind(svc);

        expect(mapCatalogModel({
            slug: 'gpt-5.5',
            display_name: 'GPT-5.5',
            visibility: 'list',
            default_reasoning_level: 'medium',
            supported_reasoning_levels: [
                { effort: 'low' },
                { effort: 'medium' },
                { effort: 'high' },
                { effort: 'xhigh' },
            ],
        })).toMatchObject({
            id: 'gpt-5.5',
            name: 'GPT-5.5',
            supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
            defaultReasoningEffort: 'medium',
            capabilities: {
                supports: {
                    reasoningEffort: true,
                    reasoning_effort: ['low', 'medium', 'high', 'xhigh'],
                },
            },
        });
        expect(mapCatalogModel({ slug: 'codex-auto-review', visibility: 'hide' })).toBeUndefined();
    });

    it('sendMessage creates a new thread and returns response', async () => {
        const result = await svc.sendMessage({ prompt: 'write a sort function' });
        expect(result.success).toBe(true);
        expect(result.response).toContain('write a sort function');
        expect(result.sessionId).toBeTruthy();
    });

    it('sendMessage returns thread.id as sessionId (not a synthetic id)', async () => {
        const result = await svc.sendMessage({ prompt: 'test' });
        // thread IDs from the mock are of the form "thread-N"
        expect(result.sessionId).toMatch(/^thread-\d+$/);
    });

    it('sendMessage with explicit sessionId resumes the thread and returns that threadId', async () => {
        // First call to get a thread ID
        const first = await svc.sendMessage({ prompt: 'first' });
        const threadId = first.sessionId!;
        // Follow-up: pass the thread ID back
        const result = await svc.sendMessage({ prompt: 'follow-up', sessionId: threadId });
        expect(result.success).toBe(true);
        // resumeThread is called → mock returns 'resumed: <prompt>'
        expect(result.response).toContain('resumed: follow-up');
        // sessionId should still be the same thread
        expect(result.sessionId).toBe(threadId);
    });

    it('sendMessage calls onSessionCreated with the thread ID', async () => {
        const createdIds: string[] = [];
        await svc.sendMessage({
            prompt: 'test session notification',
            onSessionCreated: (id) => { createdIds.push(id); },
        });
        expect(createdIds).toHaveLength(1);
        expect(createdIds[0]).toMatch(/^thread-\d+$/);
    });

    it('sendMessage calls onSessionCreated before streaming chunks arrive', async () => {
        const order: string[] = [];
        await svc.sendMessage({
            prompt: 'order test',
            onSessionCreated: () => { order.push('created'); },
            onStreamingChunk: (chunk) => { if (chunk) order.push(`chunk:${chunk}`); },
        });
        // onSessionCreated must fire before any chunk
        expect(order[0]).toBe('created');
    });

    it('sendMessage calls onStreamingChunk for each chunk', async () => {
        const chunks: string[] = [];
        await svc.sendMessage({
            prompt: 'stream test',
            onStreamingChunk: (chunk) => { chunks.push(chunk); },
        });
        // At least one non-empty chunk plus the final empty chunk
        expect(chunks.length).toBeGreaterThan(0);
    });

    it('sendMessage emits a final empty chunk to signal completion', async () => {
        const chunks: string[] = [];
        await svc.sendMessage({
            prompt: 'done flag test',
            onStreamingChunk: (chunk) => { chunks.push(chunk); },
        });
        // Last chunk should be empty string (end-of-stream sentinel)
        expect(chunks[chunks.length - 1]).toBe('');
    });

    it('sendMessage returns early when AbortSignal is already aborted', async () => {
        const ctrl = new AbortController();
        ctrl.abort();
        const result = await svc.sendMessage({ prompt: 'aborted', signal: ctrl.signal });
        expect(result.success).toBe(false);
        expect(result.error).toContain('aborted');
    });

    it('transform returns the raw response when no parse function given', async () => {
        const result = await svc.transform('hello codex');
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
    });

    it('transform applies parse function to the raw response', async () => {
        const length = await svc.transform<number>('input', (raw) => raw.length);
        expect(typeof length).toBe('number');
        expect(length).toBeGreaterThan(0);
    });

    it('forkSession returns a resumable session ID', async () => {
        const newId = await svc.forkSession('thread-42');
        expect(typeof newId).toBe('string');
        expect(newId).toBe('thread-42');
    });

    it('forkSession resumes the requested persisted thread', async () => {
        const codexMock = svc['sdk'] as ReturnType<typeof makeCodexSdkMock>;
        await svc.forkSession('thread-from-persist');
        expect(codexMock.resumeThread).toHaveBeenCalledWith(
            'thread-from-persist',
            expect.objectContaining({ skipGitRepoCheck: true }),
        );
    });

    it('forkSession registers the forked thread in sessions map for abort', async () => {
        const newId = await svc.forkSession('thread-42');
        expect(svc.getActiveSessionCount()).toBeGreaterThan(0);
        expect(svc.hasActiveSession(newId)).toBe(true);
    });

    it('abortSession returns false for unknown session', async () => {
        expect(await svc.abortSession('unknown')).toBe(false);
    });

    it('cleanup clears all sessions', async () => {
        // Start a fork to populate sessions map
        await svc.forkSession('base');
        expect(svc.getActiveSessionCount()).toBeGreaterThan(0);
        await svc.cleanup();
        expect(svc.getActiveSessionCount()).toBe(0);
    });

    it('sendMessage propagates SDK errors as failure result', async () => {
        const errMock = makeCodexSdkMock({ runError: new Error('network failure') });
        // @ts-expect-error — private
        svc['sdk'] = errMock;
        const result = await svc.sendMessage({ prompt: 'will fail' });
        expect(result.success).toBe(false);
        expect(result.error).toContain('network failure');
    });

    it('sendMessage omits Copilot-only model IDs when starting Codex threads', async () => {
        const codexMock = svc['sdk'] as ReturnType<typeof makeCodexSdkMock>;
        await svc.sendMessage({ prompt: 'test', model: 'claude-sonnet-4.6' });
        expect(codexMock.startThread).toHaveBeenCalledWith(
            expect.not.objectContaining({ model: 'claude-sonnet-4.6' }),
        );
    });

    it('sendMessage omits the Codex provider-default sentinel when starting threads', async () => {
        const codexMock = svc['sdk'] as ReturnType<typeof makeCodexSdkMock>;
        await svc.sendMessage({ prompt: 'test', model: 'codex-default' });
        expect(codexMock.startThread).toHaveBeenCalledWith(
            expect.not.objectContaining({ model: 'codex-default' }),
        );
    });
});

// ---------------------------------------------------------------------------
// SDK_PROVIDER_CODEX constant
// ---------------------------------------------------------------------------

describe('SDK_PROVIDER_CODEX constant', () => {
    it('equals "codex"', () => {
        expect(CODEX_PROVIDER).toBe('codex');
    });

    it('SDK_PROVIDER_CODEX is an alias for CODEX_PROVIDER', () => {
        expect(SDK_PROVIDER_CODEX).toBe(CODEX_PROVIDER);
    });
});

// ---------------------------------------------------------------------------
// registerCodexSDKService helper
// ---------------------------------------------------------------------------

describe('registerCodexSDKService', () => {
    afterEach(() => {
        sdkServiceRegistry.unregister(CODEX_PROVIDER);
    });

    it('registers a CodexSDKService under CODEX_PROVIDER', () => {
        const svc = registerCodexSDKService();
        expect(sdkServiceRegistry.has(CODEX_PROVIDER)).toBe(true);
        expect(sdkServiceRegistry.get(CODEX_PROVIDER)).toBe(svc);
        svc.dispose();
    });

    it('returns the registered instance', () => {
        const svc = registerCodexSDKService();
        expect(svc).toBeInstanceOf(CodexSDKService);
        svc.dispose();
    });

    it('re-registration replaces the previous instance', () => {
        const first = registerCodexSDKService();
        const second = registerCodexSDKService();
        expect(sdkServiceRegistry.get(CODEX_PROVIDER)).toBe(second);
        first.dispose();
        second.dispose();
    });

    it('injects auth checker when provided', () => {
        const checker = vi.fn(() => ({ authenticated: true }));
        const svc = registerCodexSDKService(checker);
        // @ts-expect-error — private
        expect(svc['authChecker']).toBe(checker);
        svc.dispose();
    });
});

// ---------------------------------------------------------------------------
// Auth checker (AC-08) tests
// ---------------------------------------------------------------------------

describe('CodexSDKService — auth checker (AC-08)', () => {
    let svc: CodexSDKService;

    beforeEach(() => {
        svc = new CodexSDKService();
    });

    afterEach(() => {
        svc.dispose();
    });

    it('sendMessage succeeds when no auth checker is set', async () => {
        // No checker → unauthenticated path still falls through to SDK availability check
        const result = await svc.sendMessage({ prompt: 'test' });
        // The SDK is not installed, so this returns an SDK-unavailable error — not an auth error
        expect(result.success).toBe(false);
        expect(result.error).not.toContain('authentication required');
    });

    it('sendMessage returns auth error when checker returns not authenticated', async () => {
        svc.setAuthChecker(() => ({ authenticated: false, authUrl: 'http://localhost:4000/api/codex-auth/start' }));
        const result = await svc.sendMessage({ prompt: 'hello' });
        expect(result.success).toBe(false);
        expect(result.error).toContain('authentication required');
        expect(result.error).toContain('http://localhost:4000/api/codex-auth/start');
    });

    it('sendMessage returns auth error without URL when no authUrl provided', async () => {
        svc.setAuthChecker(() => ({ authenticated: false }));
        const result = await svc.sendMessage({ prompt: 'hello' });
        expect(result.success).toBe(false);
        expect(result.error).toContain('authentication required');
        expect(result.error).toContain('/api/codex-auth/start');
    });

    it('sendMessage does not call auth checker when disposed', async () => {
        const checker = vi.fn(() => ({ authenticated: false }));
        svc.setAuthChecker(checker);
        svc.dispose();
        const result = await svc.sendMessage({ prompt: 'test' });
        expect(checker).not.toHaveBeenCalled();
        expect(result.success).toBe(false);
        expect(result.error).toContain('disposed');
    });

    it('sendMessage passes through to SDK when auth checker returns authenticated', async () => {
        // When authenticated, falls through to SDK unavailable (since SDK not installed)
        svc.setAuthChecker(() => ({ authenticated: true }));
        const result = await svc.sendMessage({ prompt: 'test' });
        // Should fail on SDK unavailability, NOT on auth
        expect(result.error).not.toContain('authentication required');
    });

    it('clearAuthChecker removes the auth check', async () => {
        svc.setAuthChecker(() => ({ authenticated: false }));
        svc.clearAuthChecker();
        const result = await svc.sendMessage({ prompt: 'test' });
        // Should now fail on SDK unavailability, not auth
        expect(result.error).not.toContain('authentication required');
    });

    it('preserves sessionId in auth error result', async () => {
        svc.setAuthChecker(() => ({ authenticated: false }));
        const result = await svc.sendMessage({ prompt: 'test', sessionId: 'sess-123' });
        expect(result.success).toBe(false);
        expect(result.sessionId).toBe('sess-123');
    });
});
