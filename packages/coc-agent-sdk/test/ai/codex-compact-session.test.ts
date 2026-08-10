/**
 * Codex SDK Service — conversation compaction over the app-server JSON-RPC.
 *
 * `CodexSDKService.compactSession()` has no high-level SDK API, so it drives
 * `codex app-server --listen stdio://` directly: `thread/resume` to load the
 * persisted thread into the freshly-spawned app-server, `thread/compact/start`
 * to rewrite the rollout in place, then it waits for a `thread/compacted`
 * notification (or a forward-compatible `context_compaction` `item/completed`)
 * while tracking `thread/tokenUsage/updated` (`tokenUsage.total.totalTokens`).
 *
 * These tests fake the spawned child so no real binary runs (keeps Windows CI
 * unaffected) and assert the outgoing JSON-RPC frames, not just wrapper args.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { PassThrough, Writable } from 'node:stream';
import { CodexSDKService } from '../../src/codex-sdk-service';
import { resolveCodexExecutablePath } from '../../src/codex-exec-path';
import { CompactUnsupportedError, isCompactUnsupportedError } from '../../src/sdk-service-interface';
import { CODEX_PROVIDER } from '../../src/sdk-service-registry';

vi.mock('child_process', () => ({
    spawn: vi.fn(),
}));

vi.mock('../../src/codex-exec-path', () => ({
    resolveCodexExecutablePath: vi.fn(),
}));

const mockSpawn = vi.mocked(spawn);
const mockResolveCodexExec = vi.mocked(resolveCodexExecutablePath);

const THREAD_ID = 'thread-abc123';

/** Minimal stand-in for the spawned `codex app-server --listen stdio://` child process. */
class MockCodexAppServerChild extends EventEmitter {
    public readonly stdout = new PassThrough();
    public readonly stderr = new PassThrough();
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

    public writeStdoutLine(msg: Record<string, unknown>): void {
        this.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
    }

    /** Parsed JSON-RPC messages this child received on stdin. */
    public sentMessages(): Array<Record<string, unknown>> {
        return this.stdinWrites
            .join('')
            .split('\n')
            .filter(Boolean)
            .map(line => JSON.parse(line) as Record<string, unknown>);
    }
}

async function flushMicrotasks(): Promise<void> {
    for (let i = 0; i < 20; i++) await Promise.resolve();
}

/** A `thread/tokenUsage/updated` notification frame with the nested total shape. */
function usageFrame(totalTokens: number): Record<string, unknown> {
    return {
        method: 'thread/tokenUsage/updated',
        params: { threadId: THREAD_ID, tokenUsage: { total: { totalTokens } } },
    };
}

/** A successful `thread/resume` ack (id 1). */
const RESUME_ACK = { id: 1, result: { thread: { id: THREAD_ID } } } as const;

/** Build a service whose availability is forced true (no real SDK load). */
function makeAvailableService(): CodexSDKService {
    const svc = new CodexSDKService();
    vi.spyOn(svc, 'isAvailable').mockResolvedValue({ available: true });
    return svc;
}

describe('CodexSDKService.compactSession — app-server stdio RPC', () => {
    beforeEach(() => {
        mockSpawn.mockReset();
        mockResolveCodexExec.mockReset();
        // Default: no unpacked native binary (dev / global install).
        mockResolveCodexExec.mockReturnValue(undefined);
        // Keep the timeout comfortably long for the non-timeout tests.
        process.env.COC_CODEX_COMPACT_TIMEOUT_MS = '5000';
    });

    afterEach(() => {
        delete process.env.COC_CODEX_COMPACT_TIMEOUT_MS;
        vi.restoreAllMocks();
    });

    it('drives the full handshake → thread/resume → compact/start flow and reports tokensRemoved', async () => {
        const child = new MockCodexAppServerChild();
        mockSpawn.mockReturnValueOnce(child as never);

        const svc = makeAvailableService();
        const promise = svc.compactSession(THREAD_ID);
        await flushMicrotasks();

        // The RPC session runs over the explicit stdio app-server.
        expect(mockSpawn).toHaveBeenCalledTimes(1);
        const appServerArgs = mockSpawn.mock.calls[0][1] as string[];
        expect(appServerArgs.slice(-3)).toEqual(['app-server', '--listen', 'stdio://']);

        // Resume ack (loads the thread) + baseline usage → triggers compact.
        child.writeStdoutLine(RESUME_ACK);
        child.writeStdoutLine(usageFrame(1000));
        await flushMicrotasks();

        // Post-compaction total, then completion.
        child.writeStdoutLine(usageFrame(300));
        child.writeStdoutLine({ method: 'thread/compacted', params: { threadId: THREAD_ID, turnId: 't1' } });

        const result = await promise;
        expect(result).toEqual({
            success: true,
            tokensRemoved: 700,
            messagesRemoved: 0,
            // The last observed total is the post-compaction usage snapshot.
            contextUsage: { currentTokens: 300 },
        });

        const messages = child.sentMessages();
        for (const msg of messages) expect(msg.jsonrpc).toBe('2.0');
        expect(messages.map(m => m.method)).toEqual([
            'initialize',
            'initialized',
            'thread/resume',
            'thread/compact/start',
        ]);
        expect(messages[2].params).toEqual({ threadId: THREAD_ID });
        expect(messages[3].params).toEqual({ threadId: THREAD_ID });
        expect(child.kill).toHaveBeenCalled();
    });

    it('reports tokensRemoved: 0 (never negative) when token usage is unavailable', async () => {
        const child = new MockCodexAppServerChild();
        mockSpawn.mockReturnValueOnce(child as never);

        const svc = makeAvailableService();
        const promise = svc.compactSession(THREAD_ID);
        await flushMicrotasks();

        // Resume ack but no tokenUsage/updated frames at all.
        child.writeStdoutLine(RESUME_ACK);
        await flushMicrotasks();
        child.writeStdoutLine({ method: 'thread/compacted', params: { threadId: THREAD_ID } });

        const result = await promise;
        expect(result).toEqual({ success: true, tokensRemoved: 0, messagesRemoved: 0 });
    });

    it('settles on a forward-compatible context_compaction item/completed (no thread/compacted)', async () => {
        const child = new MockCodexAppServerChild();
        mockSpawn.mockReturnValueOnce(child as never);

        const svc = makeAvailableService();
        const promise = svc.compactSession(THREAD_ID);
        await flushMicrotasks();

        child.writeStdoutLine(RESUME_ACK);
        child.writeStdoutLine(usageFrame(800));
        await flushMicrotasks();
        child.writeStdoutLine(usageFrame(200));
        child.writeStdoutLine({ method: 'item/completed', params: { threadId: THREAD_ID, item: { type: 'context_compaction' } } });

        const result = await promise;
        expect(result).toEqual({
            success: true,
            tokensRemoved: 600,
            messagesRemoved: 0,
            contextUsage: { currentTokens: 200 },
        });
    });

    // `settleSuccess` keeps both the first and the LAST observed total
    // (codex-sdk-service.ts:2148-2163). With more than two usage frames the last
    // one is the true post-compaction total; today it is used only as the
    // subtrahend for tokensRemoved and is not surfaced on the CompactResult.
    it('tracks the LAST tokenUsage frame as the post-compaction total across many frames', async () => {
        const child = new MockCodexAppServerChild();
        mockSpawn.mockReturnValueOnce(child as never);

        const svc = makeAvailableService();
        const promise = svc.compactSession(THREAD_ID);
        await flushMicrotasks();

        child.writeStdoutLine(RESUME_ACK);
        child.writeStdoutLine(usageFrame(12_000)); // baseline (first wins)
        await flushMicrotasks();
        // The summarization turn itself reports intermediate totals before the
        // rollout settles; only the final one describes the compacted thread.
        child.writeStdoutLine(usageFrame(9_500));
        child.writeStdoutLine(usageFrame(4_200));
        child.writeStdoutLine(usageFrame(3_400)); // post-compaction total (last wins)
        child.writeStdoutLine({ method: 'thread/compacted', params: { threadId: THREAD_ID } });

        const result = await promise;
        // first - last, not first - any intermediate.
        expect(result.tokensRemoved).toBe(8_600);
        // Frames for other threads are ignored entirely, so the totals above are
        // the only ones considered.
        expect(result).toEqual({
            success: true,
            tokensRemoved: 8_600,
            messagesRemoved: 0,
            // The last frame's total — not an intermediate one — is surfaced as
            // the post-compaction snapshot the compact route persists. Codex has
            // no per-segment breakdown, so only the total travels.
            contextUsage: { currentTokens: 3_400 },
        });
    });

    it('ignores tokenUsage frames belonging to another thread', async () => {
        const child = new MockCodexAppServerChild();
        mockSpawn.mockReturnValueOnce(child as never);

        const svc = makeAvailableService();
        const promise = svc.compactSession(THREAD_ID);
        await flushMicrotasks();

        child.writeStdoutLine(RESUME_ACK);
        child.writeStdoutLine(usageFrame(1_000));
        await flushMicrotasks();
        child.writeStdoutLine({
            method: 'thread/tokenUsage/updated',
            params: { threadId: 'some-other-thread', tokenUsage: { total: { totalTokens: 999_999 } } },
        });
        child.writeStdoutLine(usageFrame(400));
        child.writeStdoutLine({ method: 'thread/compacted', params: { threadId: THREAD_ID } });

        const result = await promise;
        expect(result.tokensRemoved).toBe(600);
    });

    it('rejects with a thread-id-naming error when thread/resume fails (unknown thread)', async () => {
        const child = new MockCodexAppServerChild();
        mockSpawn.mockReturnValueOnce(child as never);

        const svc = makeAvailableService();
        const promise = svc.compactSession(THREAD_ID);
        await flushMicrotasks();

        child.writeStdoutLine({ id: 1, error: { code: -32000, message: 'thread not found' } });

        await expect(promise).rejects.toThrow(new RegExp(`thread/resume failed for thread ${THREAD_ID}.*thread not found`));
        // Never advanced to compact/start.
        expect(child.sentMessages().map(m => m.method)).not.toContain('thread/compact/start');
    });

    it('maps a -32601 method-not-found on compact/start to CompactUnsupportedError', async () => {
        const child = new MockCodexAppServerChild();
        mockSpawn.mockReturnValueOnce(child as never);

        const svc = makeAvailableService();
        const promise = svc.compactSession(THREAD_ID);
        await flushMicrotasks();

        child.writeStdoutLine(RESUME_ACK);
        await flushMicrotasks();
        child.writeStdoutLine({ id: 2, error: { code: -32601, message: 'Method not found' } });

        const err = await promise.catch(e => e);
        expect(err).toBeInstanceOf(CompactUnsupportedError);
        expect(isCompactUnsupportedError(err)).toBe(true);
        expect(err.provider).toBe(CODEX_PROVIDER);
    });

    it('rejects and kills the child on compaction timeout', async () => {
        process.env.COC_CODEX_COMPACT_TIMEOUT_MS = '40';
        const child = new MockCodexAppServerChild();
        mockSpawn.mockReturnValueOnce(child as never);

        const svc = makeAvailableService();
        const promise = svc.compactSession(THREAD_ID);
        await flushMicrotasks();

        child.writeStdoutLine(RESUME_ACK);
        // No completion notification — let the timer fire.

        await expect(promise).rejects.toThrow(/compaction timed out after 40ms/);
        expect(child.kill).toHaveBeenCalled();
    });

    it('rejects with captured stderr + exit code when the child exits before completing', async () => {
        const child = new MockCodexAppServerChild();
        mockSpawn.mockReturnValueOnce(child as never);

        const svc = makeAvailableService();
        const promise = svc.compactSession(THREAD_ID);
        await flushMicrotasks();

        child.stderr.write('error: not authenticated\n');
        await new Promise(resolve => setImmediate(resolve));
        child.emit('exit', 1);

        await expect(promise).rejects.toThrow(
            /exited before completing compaction \(exit code 1\): error: not authenticated/,
        );
    });

    it('ignores customInstructions: sends { threadId } only and warns', async () => {
        const child = new MockCodexAppServerChild();
        mockSpawn.mockReturnValueOnce(child as never);

        const svc = makeAvailableService();
        const promise = svc.compactSession(THREAD_ID, 'focus on the auth flow');
        await flushMicrotasks();

        child.writeStdoutLine(RESUME_ACK);
        await flushMicrotasks();
        child.writeStdoutLine({ method: 'thread/compacted', params: { threadId: THREAD_ID } });

        await promise;
        const compactStart = child.sentMessages().find(m => m.method === 'thread/compact/start');
        expect(compactStart?.params).toEqual({ threadId: THREAD_ID });
    });

    it('rejects when disposed', async () => {
        const svc = new CodexSDKService();
        svc.dispose();
        await expect(svc.compactSession(THREAD_ID)).rejects.toThrow(/disposed/);
        expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('rejects when the SDK is unavailable', async () => {
        const svc = new CodexSDKService();
        vi.spyOn(svc, 'isAvailable').mockResolvedValue({ available: false, error: 'Codex SDK not installed' });
        await expect(svc.compactSession(THREAD_ID)).rejects.toThrow(/Codex SDK not installed/);
        expect(mockSpawn).not.toHaveBeenCalled();
        svc.dispose();
    });
});
