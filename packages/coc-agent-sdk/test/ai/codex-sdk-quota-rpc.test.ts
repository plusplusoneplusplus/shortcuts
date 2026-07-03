/**
 * Codex SDK Service — Account quota JSON-RPC handshake tests.
 *
 * Regression coverage for the `@openai/codex` ≥ 0.133.0 change that turned
 * `codex app-server` into a subcommand group. The bare invocation now prints
 * help and exits immediately, so the quota query must instead run
 * `app-server daemon start` (idempotent) followed by `app-server proxy`, and
 * every JSON-RPC message must carry the `jsonrpc: "2.0"` envelope.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { PassThrough, Writable } from 'stream';
import { CodexSDKService } from '../../src/codex-sdk-service';
import { execFileAsync } from '../../src/internal/exec-utils';

vi.mock('child_process', () => ({
    spawn: vi.fn(),
}));

vi.mock('../../src/internal/exec-utils', () => ({
    execFileAsync: vi.fn(),
}));

const mockSpawn = vi.mocked(spawn);
const mockExecFileAsync = vi.mocked(execFileAsync);

/** Minimal stand-in for the spawned `codex app-server proxy` child process. */
class MockCodexProxyChild extends EventEmitter {
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

    /** Parsed JSON-RPC messages this child received on stdin. */
    public sentMessages(): Array<Record<string, unknown>> {
        return this.stdinWrites
            .join('')
            .split('\n')
            .filter(Boolean)
            .map(line => JSON.parse(line) as Record<string, unknown>);
    }
}

const RATE_LIMITS_RESULT = {
    rateLimits: {
        limitId: 'codex',
        limitName: null,
        primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: 1700000000 },
        secondary: { usedPercent: 0, windowDurationMins: 10080, resetsAt: 1700500000 },
        credits: { hasCredits: false, unlimited: false, balance: '0' },
        planType: 'plus',
        rateLimitReachedType: null,
    },
};

async function flushMicrotasks(): Promise<void> {
    for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe('CodexSDKService.getAccountQuota — app-server daemon/proxy handshake', () => {
    beforeEach(() => {
        mockSpawn.mockReset();
        mockExecFileAsync.mockReset();
        mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' });
    });

    it('starts the daemon then proxies JSON-RPC and returns mapped quota', async () => {
        const child = new MockCodexProxyChild();
        mockSpawn.mockReturnValueOnce(child as never);

        const svc = new CodexSDKService();
        const promise = svc.getAccountQuota();

        // Let the daemon-start await settle and the proxy spawn/stdin writes run.
        await flushMicrotasks();

        // AC-01: the daemon is started (idempotent) before the proxy opens.
        expect(mockExecFileAsync).toHaveBeenCalledTimes(1);
        const daemonArgs = mockExecFileAsync.mock.calls[0][1] as string[];
        expect(daemonArgs.slice(-3)).toEqual(['app-server', 'daemon', 'start']);

        // AC-01: the RPC session runs over `app-server proxy`, not bare `app-server`.
        expect(mockSpawn).toHaveBeenCalledTimes(1);
        const proxyArgs = mockSpawn.mock.calls[0][1] as string[];
        expect(proxyArgs.slice(-2)).toEqual(['app-server', 'proxy']);

        // Deliver the rateLimits response (id: 2) the code waits for.
        child.writeStdoutLine(JSON.stringify({ jsonrpc: '2.0', id: 2, result: RATE_LIMITS_RESULT }));

        const result = await promise;
        expect(Object.keys(result.quotaSnapshots).sort()).toEqual(['five_hour', 'seven_day']);
        expect(result.quotaSnapshots['five_hour'].usedRequests).toBe(10);
    });

    it('normalizes the missing managed standalone install error before it reaches the quota UI', async () => {
        mockExecFileAsync.mockRejectedValueOnce(new Error(
            'Command failed: /path/to/codex app-server daemon start Error: managed standalone Codex install not found at /Users/test/.codex/packages/standalone/current/codex This command requires the standalone install managed by the Codex installer, because the daemon starts and updates app-server from that fixed path.',
        ));

        const svc = new CodexSDKService();

        let thrown: unknown;
        try {
            await svc.getAccountQuota();
        } catch (error: unknown) {
            thrown = error;
        }

        expect(thrown).toBeInstanceOf(Error);
        const message = (thrown as Error).message;
        expect(message).toContain(
            'Codex app-server daemon requires the installer-managed standalone Codex at /Users/test/.codex/packages/standalone/current/codex.',
        );
        expect(message).toContain('PATH installs such as Homebrew are not enough for this daemon.');
        expect(message).toContain('curl -fsSL https://chatgpt.com/codex/install.sh | sh');
        expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('sends every JSON-RPC message with the jsonrpc 2.0 envelope (AC-02)', async () => {
        const child = new MockCodexProxyChild();
        mockSpawn.mockReturnValueOnce(child as never);

        const svc = new CodexSDKService();
        const promise = svc.getAccountQuota();
        await flushMicrotasks();

        const messages = child.sentMessages();
        expect(messages.length).toBe(3);
        for (const msg of messages) {
            expect(msg.jsonrpc).toBe('2.0');
        }
        expect(messages.map(m => m.method)).toEqual([
            'initialize',
            'initialized',
            'account/rateLimits/read',
        ]);

        child.writeStdoutLine(JSON.stringify({ jsonrpc: '2.0', id: 2, result: RATE_LIMITS_RESULT }));
        await promise;
    });

    it('rejects with a proxy-specific error when the proxy exits early', async () => {
        const child = new MockCodexProxyChild();
        mockSpawn.mockReturnValueOnce(child as never);

        const svc = new CodexSDKService();
        const promise = svc.getAccountQuota();
        await flushMicrotasks();

        child.emit('exit', 0);

        await expect(promise).rejects.toThrow(/app-server proxy exited before returning rate limits/);
    });
});
