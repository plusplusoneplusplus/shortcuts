/**
 * Unit tests for the DevTunnel CLI host-side configuration (AC-02).
 *
 * `devtunnel-cli.ts` is electron-free and runs every `devtunnel` invocation
 * through an injectable {@link DevTunnelCliRunner}, so the resolution and
 * create/reuse/reconcile algorithm is asserted here under plain Node with a
 * recording fake runner — no real CLI is ever spawned (except the one focused
 * test that proves the default runner maps a missing binary to `cli-missing`).
 */

import { describe, it, expect } from 'vitest';
import * as path from 'path';
import {
    DevTunnelCliResult,
    DevTunnelCliRunner,
    configureDevTunnel,
    defaultDevTunnelCliRunner,
    defaultDevTunnelMessage,
    ensureDevTunnelHttpBinding,
    parseDevTunnelHttpPorts,
    resolveDevTunnelCliPath,
} from '../src/devtunnel-cli';

const TUNNEL = 'box-coc';
const CLI = '/opt/devtunnel';
const PORT = 4000;

/** Build a full command result from a partial (exit 0 + empty output default). */
function res(partial: Partial<DevTunnelCliResult> = {}): DevTunnelCliResult {
    return { exitCode: 0, stdout: '', stderr: '', ...partial };
}

/** A recording runner that routes each invocation by subcommand. */
function makeRunner(responses: {
    create?: DevTunnelCliResult;
    list?: DevTunnelCliResult;
    del?: DevTunnelCliResult;
    portCreate?: DevTunnelCliResult;
}): { runner: DevTunnelCliRunner; calls: string[][] } {
    const calls: string[][] = [];
    const runner: DevTunnelCliRunner = async (_cliPath, args) => {
        calls.push(args);
        if (args[0] === 'create') {
            return responses.create ?? res();
        }
        if (args[0] === 'port' && args[1] === 'list') {
            return responses.list ?? res();
        }
        if (args[0] === 'port' && args[1] === 'delete') {
            return responses.del ?? res();
        }
        if (args[0] === 'port' && args[1] === 'create') {
            return responses.portCreate ?? res();
        }
        return res();
    };
    return { runner, calls };
}

function configure(
    responses: Parameters<typeof makeRunner>[0],
    port = PORT,
): Promise<{ result: Awaited<ReturnType<typeof configureDevTunnel>>; calls: string[][] }> {
    const { runner, calls } = makeRunner(responses);
    return configureDevTunnel({ tunnelId: TUNNEL, port, cliPath: CLI, runner }).then((result) => ({ result, calls }));
}

describe('resolveDevTunnelCliPath', () => {
    it('resolves devtunnel from a PATH directory', () => {
        const hit = path.join('/opt/dt', 'devtunnel');
        const resolved = resolveDevTunnelCliPath({
            platform: 'linux',
            env: { PATH: '/usr/bin:/opt/dt' },
            homeDir: '/home/u',
            fileExists: (p) => p === hit,
        });
        expect(resolved).toBe(hit);
    });

    it('falls back to ~/.coc/bin/devtunnel.exe on Windows when PATH misses', () => {
        const fallback = path.join('C:\\Users\\me', '.coc', 'bin', 'devtunnel.exe');
        const resolved = resolveDevTunnelCliPath({
            platform: 'win32',
            env: { PATH: 'C:\\Windows;C:\\tools' },
            homeDir: 'C:\\Users\\me',
            fileExists: (p) => p === fallback,
        });
        expect(resolved).toBe(fallback);
    });

    it('prefers a PATH hit over the ~/.coc/bin fallback', () => {
        const pathHit = path.join('C:\\tools', 'devtunnel.exe');
        const fallback = path.join('C:\\Users\\me', '.coc', 'bin', 'devtunnel.exe');
        const resolved = resolveDevTunnelCliPath({
            platform: 'win32',
            env: { PATH: 'C:\\tools' },
            homeDir: 'C:\\Users\\me',
            fileExists: (p) => p === pathHit || p === fallback,
        });
        expect(resolved).toBe(pathHit);
    });

    it('returns undefined when the CLI is nowhere to be found', () => {
        expect(
            resolveDevTunnelCliPath({
                platform: 'win32',
                env: { PATH: 'C:\\Windows' },
                homeDir: 'C:\\Users\\me',
                fileExists: () => false,
            }),
        ).toBeUndefined();
    });
});

describe('parseDevTunnelHttpPorts', () => {
    it('parses a JSON array of ports, keeping only HTTP', () => {
        const out = JSON.stringify([
            { port: 4000, protocol: 'http' },
            { port: 22, protocol: 'ssh' },
            { port: 8443, protocol: 'https' },
        ]);
        expect(parseDevTunnelHttpPorts(out)).toEqual([4000]);
    });

    it('parses a JSON object with a "ports" array', () => {
        const out = JSON.stringify({ ports: [{ portNumber: 5000, protocol: 'http' }] });
        expect(parseDevTunnelHttpPorts(out)).toEqual([5000]);
    });

    it('parses table output and de-duplicates ports', () => {
        const out = [
            'Port  Protocol  Port URI',
            '----  --------  --------',
            '4000  http      https://x-4000.devtunnels.ms/',
            '4000  http      https://x-4000.devtunnels.ms/',
            '2222  ssh',
        ].join('\n');
        expect(parseDevTunnelHttpPorts(out)).toEqual([4000]);
    });

    it('reports every distinct HTTP port when several exist', () => {
        const out = JSON.stringify([
            { port: 4000, protocol: 'http' },
            { port: 6000, protocol: 'http' },
        ]);
        expect(parseDevTunnelHttpPorts(out)).toEqual([4000, 6000]);
    });

    it('returns an empty list for empty or non-HTTP output', () => {
        expect(parseDevTunnelHttpPorts('')).toEqual([]);
        expect(parseDevTunnelHttpPorts(JSON.stringify([{ port: 22, protocol: 'ssh' }]))).toEqual([]);
    });
});

describe('configureDevTunnel — create/reuse and HTTP-port reconciliation', () => {
    it('creates a new tunnel and binds the active port when none exists', async () => {
        const { result, calls } = await configure({ create: res(), list: res() });
        expect(result).toEqual({ ok: true, port: PORT });
        expect(calls).toContainEqual(['create', TUNNEL]);
        expect(calls).toContainEqual(['port', 'create', TUNNEL, '-p', String(PORT), '--protocol', 'http']);
        // Nothing was deleted while creating a fresh binding.
        expect(calls.some((c) => c[1] === 'delete')).toBe(false);
    });

    it('reuses an existing tunnel whose HTTP port already matches (no writes)', async () => {
        const { result, calls } = await configure({
            create: res({ exitCode: 1, stdout: `Tunnel "${TUNNEL}" already exists` }),
            list: res({ stdout: JSON.stringify([{ port: PORT, protocol: 'http' }]) }),
        });
        expect(result).toEqual({ ok: true, port: PORT });
        expect(calls).toEqual([
            ['create', TUNNEL],
            ['port', 'list', TUNNEL],
        ]);
    });

    it('binds an HTTP port while preserving unrelated non-HTTP ports', async () => {
        const { result, calls } = await configure({
            create: res(),
            list: res({ stdout: ['Port  Protocol', '----  --------', '2222  ssh'].join('\n') }),
        });
        expect(result).toEqual({ ok: true, port: PORT });
        expect(calls).toContainEqual(['port', 'create', TUNNEL, '-p', String(PORT), '--protocol', 'http']);
        // The unrelated ssh port is never deleted.
        expect(calls.some((c) => c[1] === 'delete')).toBe(false);
    });

    it('replaces a single stale HTTP port with the active CoC port', async () => {
        const { result, calls } = await configure({
            create: res({ exitCode: 1, stdout: 'already exists' }),
            list: res({ stdout: JSON.stringify([{ port: 5000, protocol: 'http' }]) }),
        });
        expect(result).toEqual({ ok: true, port: PORT });
        const deleteIdx = calls.findIndex((c) => c[1] === 'delete');
        const createIdx = calls.findIndex((c) => c[1] === 'create' && c[0] === 'port');
        expect(calls[deleteIdx]).toEqual(['port', 'delete', TUNNEL, '-p', '5000']);
        expect(calls[createIdx]).toEqual(['port', 'create', TUNNEL, '-p', String(PORT), '--protocol', 'http']);
        // Delete the stale binding before creating the new one.
        expect(deleteIdx).toBeLessThan(createIdx);
    });

    it('fails on multiple HTTP ports without deleting or guessing', async () => {
        const { result, calls } = await configure({
            create: res(),
            list: res({
                stdout: JSON.stringify([
                    { port: 4000, protocol: 'http' },
                    { port: 6000, protocol: 'http' },
                ]),
            }),
        });
        expect(result.ok).toBe(false);
        if (result.ok) {
            throw new Error('expected failure');
        }
        expect(result.category).toBe('multiple-http-ports');
        // Never touched the ambiguous bindings.
        expect(calls.some((c) => c[1] === 'delete' || (c[0] === 'port' && c[1] === 'create'))).toBe(false);
    });
});

describe('configureDevTunnel — normalized failure categories', () => {
    it('classifies unauthenticated CLI output', async () => {
        const { result } = await configure({
            create: res({ exitCode: 1, stderr: 'Authentication required: you are not logged in.' }),
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.category).toBe('unauthenticated');
        }
    });

    it('classifies an inaccessible / not-owned tunnel (precedence over auth)', async () => {
        const { result, calls } = await configure({
            create: res({ exitCode: 1, stderr: 'Error: unauthorized tunnel access' }),
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.category).toBe('not-owned');
        }
        // Stopped at create — never listed or bound ports.
        expect(calls).toEqual([['create', TUNNEL]]);
    });

    it('classifies a generic create command failure as reconcile-failed', async () => {
        const { result } = await configure({
            create: res({ exitCode: 3, stdout: 'unexpected server error' }),
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.category).toBe('reconcile-failed');
        }
    });

    it('classifies a port-create failure as reconcile-failed', async () => {
        const { result } = await configure({
            create: res(),
            list: res(),
            portCreate: res({ exitCode: 1, stdout: 'quota exceeded' }),
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.category).toBe('reconcile-failed');
        }
    });

    it('classifies a stale-port delete failure as reconcile-failed', async () => {
        const { result } = await configure({
            create: res(),
            list: res({ stdout: JSON.stringify([{ port: 5000, protocol: 'http' }]) }),
            del: res({ exitCode: 1, stdout: 'delete failed' }),
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.category).toBe('reconcile-failed');
        }
    });

    it('surfaces auth failure that appears at the port-list stage', async () => {
        const { result } = await configure({
            create: res(),
            list: res({ exitCode: 1, stderr: '401 Unauthorized' }),
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.category).toBe('unauthenticated');
        }
    });

    it('every failure result is ok:false so AC-03 never starts devtunnel host', async () => {
        const failures = await Promise.all([
            configure({ create: res({ exitCode: 1, stderr: 'not logged in' }) }),
            configure({ create: res({ exitCode: 1, stderr: 'tunnel not found' }) }),
            configure({ create: res({ exitCode: 2, stdout: 'boom' }) }),
        ]);
        expect(failures.every((f) => f.result.ok === false)).toBe(true);
    });
});

describe('configureDevTunnel — no anonymous / install / login commands', () => {
    it('issues only create + port list/create/delete, never anonymous access, install, or login', async () => {
        // A stale replacement exercises create, list, delete, and port create.
        const { calls } = await configure({
            create: res(),
            list: res({ stdout: JSON.stringify([{ port: 5000, protocol: 'http' }]) }),
        });
        const forbidden = ['anonymous', '--allow-anonymous', 'access', 'user', 'login', 'install', 'winget', 'download', 'host', 'connect'];
        const flat = calls.flat().map((a) => a.toLowerCase());
        for (const token of forbidden) {
            expect(flat).not.toContain(token);
        }
        // The only subcommands issued.
        expect(calls.map((c) => c.slice(0, 2).join(' '))).toEqual([
            'create box-coc',
            'port list',
            'port delete',
            'port create',
        ]);
    });
});

describe('failure messages are concise and never leak raw output', () => {
    it('keeps user-facing message free of unbounded CLI output and bounds the detail', async () => {
        const secret = 'SECRET-TOKEN-'.repeat(500); // > 2000 chars
        const { result } = await configure({
            create: res({ exitCode: 1, stdout: secret }),
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.message).not.toContain('SECRET-TOKEN');
            expect(result.message).toBe(`Failed to create dev tunnel "${TUNNEL}".`);
            expect(result.detail && result.detail.length).toBeLessThanOrEqual(2001);
        }
    });

    it('provides distinct default guidance per category', () => {
        expect(defaultDevTunnelMessage('cli-missing')).toMatch(/not found/i);
        expect(defaultDevTunnelMessage('unauthenticated')).toMatch(/login/i);
        expect(defaultDevTunnelMessage('not-owned')).toMatch(/another account/i);
        expect(defaultDevTunnelMessage('multiple-http-ports')).toMatch(/multiple HTTP ports/i);
    });
});

describe('ensureDevTunnelHttpBinding', () => {
    it('returns cli-missing without running any command when the CLI is absent', async () => {
        let ran = false;
        const result = await ensureDevTunnelHttpBinding({
            tunnelId: TUNNEL,
            port: PORT,
            resolve: { platform: 'win32', env: { PATH: '' }, homeDir: 'C:\\u', fileExists: () => false },
            runner: async () => {
                ran = true;
                return res();
            },
        });
        expect(result).toEqual({ ok: false, category: 'cli-missing', message: defaultDevTunnelMessage('cli-missing') });
        expect(ran).toBe(false);
    });

    it('resolves the CLI then reconciles the binding', async () => {
        const hit = path.join('/opt/dt', 'devtunnel');
        const { runner, calls } = makeRunner({ create: res(), list: res() });
        const result = await ensureDevTunnelHttpBinding({
            tunnelId: TUNNEL,
            port: PORT,
            resolve: { platform: 'linux', env: { PATH: '/opt/dt' }, homeDir: '/home/u', fileExists: (p) => p === hit },
            runner,
        });
        expect(result).toEqual({ ok: true, port: PORT });
        expect(calls[0]).toEqual(['create', TUNNEL]);
    });
});

describe('defaultDevTunnelCliRunner', () => {
    it('maps a missing binary to a spawn ENOENT error rather than throwing', async () => {
        const result = await defaultDevTunnelCliRunner('___no_such_devtunnel_binary___', ['create', 'x']);
        expect(result.exitCode).toBe(-1);
        expect(result.spawnError?.code).toBe('ENOENT');
    });
});
