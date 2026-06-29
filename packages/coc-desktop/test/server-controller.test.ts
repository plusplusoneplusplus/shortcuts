/**
 * Unit tests for the AC-02 attach-or-start server controller.
 *
 * These exercise the pure orchestration + helpers without Electron: the fork,
 * health probe, and free-port lookup are injected so we can assert the
 * attach-vs-start decision, the child env (`ELECTRON_RUN_AS_NODE`, shared
 * `~/.coc` dataDir, non-4000 port), and the `listening` handshake.
 */

import { EventEmitter } from 'events';
import * as http from 'http';
import { describe, it, expect, afterEach } from 'vitest';
import type { ChildProcess } from 'child_process';
import {
    attachOrStart,
    probeHealth,
    findFreePort,
    formatUrl,
    defaultDataDir,
    CLI_DEFAULT_PORT,
    DEFAULT_HOST,
} from '../src/server-controller';

/** A fake forked child: an EventEmitter that records kill() and can be driven. */
class FakeChild extends EventEmitter {
    public killed = false;
    kill(): boolean {
        this.killed = true;
        return true;
    }
    emitListening(port: number): void {
        // Emit after the caller has subscribed (next tick).
        setImmediate(() => this.emit('message', { type: 'listening', port }));
    }
}

const servers: http.Server[] = [];
afterEach(async () => {
    await Promise.all(
        servers.splice(0).map((s) => new Promise<void>((resolve) => s.close(() => resolve()))),
    );
});

/** Spin up a throwaway HTTP server with a given /api/health response. */
function startHealthServer(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<number> {
    return new Promise((resolve) => {
        const srv = http.createServer(handler);
        servers.push(srv);
        srv.listen(0, DEFAULT_HOST, () => {
            const addr = srv.address();
            resolve(typeof addr === 'object' && addr ? addr.port : 0);
        });
    });
}

describe('formatUrl', () => {
    it('builds a loopback http url', () => {
        expect(formatUrl('127.0.0.1', 4000)).toBe('http://127.0.0.1:4000');
    });
    it('brackets IPv6 hosts and rewrites wildcard binds', () => {
        expect(formatUrl('::1', 8080)).toBe('http://[::1]:8080');
        expect(formatUrl('0.0.0.0', 5000)).toBe('http://127.0.0.1:5000');
    });
});

describe('defaultDataDir', () => {
    it('resolves to ~/.coc (shared with the CLI)', () => {
        expect(defaultDataDir().endsWith(`${require('path').sep}.coc`)).toBe(true);
    });
});

describe('probeHealth', () => {
    it('is true when the server answers /api/health with status ok', async () => {
        const port = await startHealthServer((_req, res) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', uptime: 1, processCount: 0 }));
        });
        await expect(probeHealth(DEFAULT_HOST, port)).resolves.toBe(true);
    });

    it('is false on a non-200 status', async () => {
        const port = await startHealthServer((_req, res) => {
            res.writeHead(503);
            res.end('nope');
        });
        await expect(probeHealth(DEFAULT_HOST, port)).resolves.toBe(false);
    });

    it('is false when the body is not {status:"ok"}', async () => {
        const port = await startHealthServer((_req, res) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'degraded' }));
        });
        await expect(probeHealth(DEFAULT_HOST, port)).resolves.toBe(false);
    });

    it('is false when nothing is listening', async () => {
        const free = await findFreePort();
        await expect(probeHealth(DEFAULT_HOST, free, 300)).resolves.toBe(false);
    });
});

describe('findFreePort', () => {
    it('returns a bindable ephemeral port', async () => {
        const port = await findFreePort();
        expect(port).toBeGreaterThan(0);
        // The port must actually be free to bind right now.
        await new Promise<void>((resolve, reject) => {
            const srv = http.createServer();
            srv.on('error', reject);
            srv.listen(port, DEFAULT_HOST, () => srv.close(() => resolve()));
        });
    });
});

describe('attachOrStart', () => {
    it('ATTACHES to an existing healthy server without forking', async () => {
        let forkCalled = false;
        const handle = await attachOrStart({
            deps: {
                probeHealth: async () => true,
                findFreePort: async () => 55555,
                fork: () => {
                    forkCalled = true;
                    return new FakeChild() as unknown as ChildProcess;
                },
            },
        });

        expect(forkCalled).toBe(false);
        expect(handle.started).toBe(false);
        expect(handle.port).toBe(CLI_DEFAULT_PORT);
        expect(handle.url).toBe(formatUrl(DEFAULT_HOST, CLI_DEFAULT_PORT));
        expect(handle.child).toBeUndefined();
    });

    it('STARTS a forked server on a free non-4000 port with the right child env', async () => {
        const child = new FakeChild();
        let forkedPath = '';
        let forkedEnv: NodeJS.ProcessEnv = {};
        const handle = await attachOrStart({
            dataDir: '/tmp/shared-coc',
            serverEntryPath: '/abs/dist/server-entry.js',
            deps: {
                probeHealth: async () => false,
                findFreePort: async () => 49222,
                fork: (modulePath, env) => {
                    forkedPath = modulePath;
                    forkedEnv = env;
                    child.emitListening(49222);
                    return child as unknown as ChildProcess;
                },
            },
        });

        expect(forkedPath).toBe('/abs/dist/server-entry.js');
        expect(forkedEnv.ELECTRON_RUN_AS_NODE).toBe('1');
        expect(forkedEnv.COC_DESKTOP_HOST).toBe(DEFAULT_HOST);
        expect(forkedEnv.COC_DESKTOP_PORT).toBe('49222');
        expect(forkedEnv.COC_DESKTOP_DATA_DIR).toBe('/tmp/shared-coc');
        expect(Number(forkedEnv.COC_DESKTOP_PORT)).not.toBe(4000);

        expect(handle.started).toBe(true);
        expect(handle.port).toBe(49222);
        expect(handle.url).toBe(formatUrl(DEFAULT_HOST, 49222));
        expect(handle.child).toBe(child as unknown as ChildProcess);
    });

    it('trusts the port the child actually bound, even if it differs', async () => {
        const child = new FakeChild();
        const handle = await attachOrStart({
            deps: {
                probeHealth: async () => false,
                findFreePort: async () => 40000,
                fork: () => {
                    child.emitListening(40123); // bound a different port than requested
                    return child as unknown as ChildProcess;
                },
            },
        });
        expect(handle.port).toBe(40123);
    });

    it('rejects and kills the child when it reports an error', async () => {
        const child = new FakeChild();
        await expect(
            attachOrStart({
                deps: {
                    probeHealth: async () => false,
                    findFreePort: async () => 41000,
                    fork: () => {
                        setImmediate(() => child.emit('message', { type: 'error', message: 'boom' }));
                        return child as unknown as ChildProcess;
                    },
                },
            }),
        ).rejects.toThrow('boom');
        expect(child.killed).toBe(true);
    });

    it('rejects and kills the child when it exits before listening', async () => {
        const child = new FakeChild();
        await expect(
            attachOrStart({
                deps: {
                    probeHealth: async () => false,
                    findFreePort: async () => 42000,
                    fork: () => {
                        setImmediate(() => child.emit('exit', 1, null));
                        return child as unknown as ChildProcess;
                    },
                },
            }),
        ).rejects.toThrow(/exited before listening/);
        expect(child.killed).toBe(true);
    });

    it('rejects on start timeout', async () => {
        const child = new FakeChild(); // never emits listening
        await expect(
            attachOrStart({
                startTimeoutMs: 50,
                deps: {
                    probeHealth: async () => false,
                    findFreePort: async () => 43000,
                    fork: () => child as unknown as ChildProcess,
                },
            }),
        ).rejects.toThrow(/Timed out/);
        expect(child.killed).toBe(true);
    });
});
