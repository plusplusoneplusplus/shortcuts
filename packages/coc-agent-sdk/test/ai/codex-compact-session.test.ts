/**
 * Codex SDK Service — conversation compaction over the app-server JSON-RPC.
 *
 * `CodexSDKService.compactSession()` has no high-level SDK API, so it drives
 * `codex app-server --listen stdio://` directly: `thread/read` to baseline token
 * usage, `thread/compact/start` to rewrite the rollout in place, then it waits
 * for a `thread/compacted` notification (or a forward-compatible
 * `context_compaction` `item/completed`) while tracking `thread/tokenUsage/updated`.
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

    it('drives the full handshake → thread/read → compact/start flow and reports tokensRemoved', async () => {
        const child = new MockCodexAppServerChild();
        mockSpawn.mockReturnValueOnce(child as never);

        const svc = makeAvailableService();
        const promise = svc.compactSession(THREAD_ID);
        await flushMicrotasks();

        // The RPC session runs over the explicit stdio app-server.
        expect(mockSpawn).toHaveBeenCalledTimes(1);
        const appServerArgs = mockSpawn.mock.calls[0][1] as string[];
        expect(appServerArgs.slice(-3)).toEqual(['app-server', '--listen', 'stdio://']);

        // Baseline usage → triggers thread/compact/start.
        child.writeStdoutLine({ id: 1, result: { tokenUsage: { total: 1000 } } });
        await flushMicrotasks();

        // Post-compaction total, then completion.
        child.writeStdoutLine({ method: 'thread/tokenUsage/updated', params: { threadId: THREAD_ID, tokenUsage: { total: 300 } } });
        child.writeStdoutLine({ method: 'thread/compacted', params: { threadId: THREAD_ID, turnId: 't1' } });

        const result = await promise;
        expect(result).toEqual({ success: true, tokensRemoved: 700, messagesRemoved: 0 });

        const messages = child.sentMessages();
        for (const msg of messages) expect(msg.jsonrpc).toBe('2.0');
        expect(messages.map(m => m.method)).toEqual([
            'initialize',
            'initialized',
            'thread/read',
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

        // thread/read with no usable usage; no tokenUsage/updated frames.
        child.writeStdoutLine({ id: 1, result: {} });
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

        child.writeStdoutLine({ id: 1, result: { tokenUsage: { total: 800 } } });
        await flushMicrotasks();
        child.writeStdoutLine({ method: 'thread/tokenUsage/updated', params: { threadId: THREAD_ID, tokenUsage: { total: 200 } } });
        child.writeStdoutLine({ method: 'item/completed', params: { threadId: THREAD_ID, item: { type: 'context_compaction' } } });

        const result = await promise;
        expect(result).toEqual({ success: true, tokensRemoved: 600, messagesRemoved: 0 });
    });

    it('rejects with a thread-id-naming error when thread/read fails (unknown thread)', async () => {
        const child = new MockCodexAppServerChild();
        mockSpawn.mockReturnValueOnce(child as never);

        const svc = makeAvailableService();
        const promise = svc.compactSession(THREAD_ID);
        await flushMicrotasks();

        child.writeStdoutLine({ id: 1, error: { code: -32000, message: 'no such thread' } });

        await expect(promise).rejects.toThrow(new RegExp(`thread/read failed for thread ${THREAD_ID}.*no such thread`));
        // Never advanced to compact/start.
        expect(child.sentMessages().map(m => m.method)).not.toContain('thread/compact/start');
    });

    it('maps a -32601 method-not-found on compact/start to CompactUnsupportedError', async () => {
        const child = new MockCodexAppServerChild();
        mockSpawn.mockReturnValueOnce(child as never);

        const svc = makeAvailableService();
        const promise = svc.compactSession(THREAD_ID);
        await flushMicrotasks();

        child.writeStdoutLine({ id: 1, result: { tokenUsage: { total: 100 } } });
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

        child.writeStdoutLine({ id: 1, result: { tokenUsage: { total: 100 } } });
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

        child.writeStdoutLine({ id: 1, result: { tokenUsage: { total: 500 } } });
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
