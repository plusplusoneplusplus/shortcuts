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
            run: vi.fn(async (opts: { prompt: string; onChunk?: (c: string) => void }) => {
                record.runCalls.push(opts.prompt);
                if (overrides?.runError) throw overrides.runError;
                const text = overrides?.runResult?.text ?? `response to: ${opts.prompt}`;
                opts.onChunk?.(text);
                return { text };
            }),
            abort: vi.fn(),
        };
    }

    return {
        startThread: vi.fn(async () => makeThread(`thread-${++threadCounter}`)),
        resumeThread: vi.fn(async (id: string) => {
            // Return existing or create new for resumed id
            if (!threads.has(id)) {
                return makeThread(id);
            }
            const existing = threads.get(id)!;
            return {
                id: existing.id,
                run: vi.fn(async (opts: { prompt: string; onChunk?: (c: string) => void }) => {
                    existing.runCalls.push(opts.prompt);
                    const text = `resumed: ${opts.prompt}`;
                    opts.onChunk?.(text);
                    return { text };
                }),
                abort: vi.fn(),
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
        const models = await svc.listModels();
        expect(models.length).toBeGreaterThan(0);
        expect(models[0]).toHaveProperty('id');
        expect(models[0]).toHaveProperty('name');
    });

    it('sendMessage creates a new thread and returns response', async () => {
        const result = await svc.sendMessage({ prompt: 'write a sort function' });
        expect(result.success).toBe(true);
        expect(result.response).toContain('write a sort function');
        expect(result.sessionId).toBeTruthy();
    });

    it('sendMessage with explicit sessionId includes it in result', async () => {
        const result = await svc.sendMessage({ prompt: 'test', sessionId: 'my-session' });
        expect(result.sessionId).toBe('my-session');
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

    it('forkSession creates a new session ID', async () => {
        const newId = await svc.forkSession('original-session');
        expect(typeof newId).toBe('string');
        expect(newId).not.toBe('original-session');
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
});
