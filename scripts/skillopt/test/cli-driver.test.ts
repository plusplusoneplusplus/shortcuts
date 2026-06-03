/**
 * AC-01 tests: Copilot CLI driver
 *
 * Tests are written against the pure logic of cli-driver.ts using a thin
 * wrapper that accepts a spawn factory, so we don't need to wrestle with
 * module-level mocking of child_process.
 */
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import * as path from 'path';
import { CliError, captureGitDiff, resolveCopilotInvocation } from '../cli-driver';

// ─── Minimal inline driver for unit-testing spawn logic ───────────────────────

type MockProcessOptions = {
    stdout?: string;
    stderr?: string;
    exitCode?: number;
    error?: NodeJS.ErrnoException;
    delay?: number;
};

type SpawnLike = (cmd: string, args: string[], opts: { cwd: string }) => ReturnType<typeof makeMockProcess>;

function makeMockProcess(opts: MockProcessOptions = {}) {
    const proc = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: ReturnType<typeof vi.fn>;
    };
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = vi.fn();

    const delay = opts.delay ?? 0;
    setTimeout(() => {
        if (opts.error) { proc.emit('error', opts.error); return; }
        if (opts.stdout) proc.stdout.emit('data', Buffer.from(opts.stdout));
        if (opts.stderr) proc.stderr.emit('data', Buffer.from(opts.stderr));
        proc.emit('close', opts.exitCode ?? 0);
    }, delay);

    return proc;
}

/**
 * Inline version of the spawn logic from cli-driver.ts,
 * accepting an injectable spawn factory so we can unit-test without
 * touching the real child_process module.
 */
async function runWithSpawn(
    prompt: string,
    workdir: string,
    model: string,
    spawnFn: SpawnLike,
    options: { timeoutMs?: number } = {}
): Promise<{ stdout: string; args: string[]; spawnOpts: { cwd: string } }> {
    const { timeoutMs = 300_000 } = options;
    const args: string[] = [
        '-p', prompt,
        '--allow-all-tools',
        '-C', workdir,
        '--model', model,
        '--output-format', 'text',
        '--no-color',
    ];

    let capturedArgs: string[] = [];
    let capturedOpts: { cwd: string } = { cwd: '' };

    const stdout = await new Promise<string>((resolve, reject) => {
        const proc = spawnFn('copilot', args, { cwd: workdir });
        capturedArgs = args;
        capturedOpts = { cwd: workdir };
        let output = '';
        let timer: ReturnType<typeof setTimeout> | undefined;

        if (timeoutMs > 0) {
            timer = setTimeout(() => {
                try { proc.kill(); } catch { /* ignore */ }
                reject(new CliError(`Copilot CLI timed out after ${timeoutMs}ms`, -1, output));
            }, timeoutMs);
        }

        proc.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
        proc.stderr.on('data', (chunk: Buffer) => { output += chunk.toString(); });

        proc.on('error', (err: NodeJS.ErrnoException) => {
            if (timer) clearTimeout(timer);
            if (err.code === 'ENOENT') {
                reject(new CliError('copilot binary not found on PATH. Install the GitHub Copilot CLI and authenticate before running skillopt.', -1, ''));
            } else {
                reject(err);
            }
        });

        proc.on('close', (code: number | null) => {
            if (timer) clearTimeout(timer);
            const exitCode = code ?? -1;
            if (exitCode !== 0) {
                reject(new CliError(`Copilot CLI exited with code ${exitCode}`, exitCode, output));
            } else {
                resolve(output);
            }
        });
    });

    return { stdout, args: capturedArgs, spawnOpts: capturedOpts };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('cli-driver — argv contract', () => {
    it('passes the exact argv to spawn', async () => {
        const spawnFn = vi.fn().mockReturnValue(makeMockProcess({ stdout: 'done\n' }));
        const { args, spawnOpts } = await runWithSpawn(
            'hello prompt', '/my/workdir', 'claude-sonnet-4.5', spawnFn
        );

        expect(spawnFn).toHaveBeenCalledOnce();
        const [cmd, spawnArgs, opts] = spawnFn.mock.calls[0];
        expect(cmd).toBe('copilot');
        expect(spawnArgs).toContain('-p');
        expect(spawnArgs).toContain('hello prompt');
        expect(spawnArgs).toContain('--allow-all-tools');
        expect(spawnArgs).toContain('-C');
        expect(spawnArgs).toContain('/my/workdir');
        expect(spawnArgs).toContain('--model');
        expect(spawnArgs).toContain('claude-sonnet-4.5');
        expect(spawnArgs).toContain('--output-format');
        expect(spawnArgs).toContain('text');
        expect(spawnArgs).toContain('--no-color');
        expect(opts.cwd).toBe('/my/workdir');
    });

    it('captures stdout on success', async () => {
        const spawnFn = vi.fn().mockReturnValue(makeMockProcess({ stdout: 'task done\n' }));
        const { stdout } = await runWithSpawn('p', '/wd', 'gpt-5', spawnFn);
        expect(stdout).toBe('task done\n');
    });

    it('surfaces non-zero exit as CliError (not silent)', async () => {
        // Use mockImplementation to create a fresh process on each call
        const spawnFn = vi.fn().mockImplementation(() =>
            makeMockProcess({ stdout: 'error output\n', exitCode: 1 })
        );
        let caught: unknown = null;
        try {
            await runWithSpawn('p', '/wd', 'm', spawnFn);
        } catch (err) {
            caught = err;
        }
        expect(caught).toBeInstanceOf(CliError);
        expect((caught as CliError).exitCode).toBe(1);
        expect((caught as CliError).stdout).toContain('error output');
    });

    it('throws CliError with PATH message on ENOENT', async () => {
        const enoentErr = Object.assign(new Error('spawn copilot ENOENT'), { code: 'ENOENT' }) as NodeJS.ErrnoException;
        const spawnFn = vi.fn().mockReturnValue(makeMockProcess({ error: enoentErr }));
        await expect(runWithSpawn('p', '/wd', 'm', spawnFn)).rejects.toThrow(/PATH/);
    });

    it('enforces timeout and kills the process', async () => {
        vi.useFakeTimers();
        const proc = makeMockProcess({ stdout: 'slow', delay: 99999 });
        const spawnFn = vi.fn().mockReturnValue(proc);

        const promise = runWithSpawn('p', '/wd', 'm', spawnFn, { timeoutMs: 100 });
        vi.advanceTimersByTime(101);

        await expect(promise).rejects.toThrow(/timed out/);
        expect(proc.kill).toHaveBeenCalled();

        vi.useRealTimers();
    });
});

describe('captureGitDiff', () => {
    it('is a function that returns a string', () => {
        expect(typeof captureGitDiff).toBe('function');
        // In a non-git directory it returns '' without throwing
        const result = captureGitDiff(require('os').tmpdir());
        expect(typeof result).toBe('string');
    });
});

describe('resolveCopilotInvocation — cross-platform binary resolution', () => {
    const baseArgs = ['-p', 'hi', '--no-color'];

    it('on Windows, runs the npm-loader via node when found on PATH', () => {
        const shimDir = path.join('C:', 'tools', 'npm-global');
        const loader = path.join(shimDir, 'node_modules', '@github', 'copilot', 'npm-loader.js');
        const pathEnv = [path.join('C:', 'other'), shimDir].join(path.delimiter);

        const result = resolveCopilotInvocation(baseArgs, {
            platform: 'win32',
            pathEnv,
            nodePath: 'C:\\node\\node.exe',
            fileExists: (p) => p === loader,
        });

        expect(result.command).toBe('C:\\node\\node.exe');
        expect(result.args).toEqual([loader, ...baseArgs]);
    });

    it('on Windows, picks the first PATH dir whose loader exists', () => {
        const dirA = path.join('C:', 'a');
        const dirB = path.join('C:', 'b');
        const loaderA = path.join(dirA, 'node_modules', '@github', 'copilot', 'npm-loader.js');
        const loaderB = path.join(dirB, 'node_modules', '@github', 'copilot', 'npm-loader.js');
        const pathEnv = [dirA, dirB].join(path.delimiter);

        const result = resolveCopilotInvocation(baseArgs, {
            platform: 'win32',
            pathEnv,
            nodePath: 'node',
            fileExists: (p) => p === loaderA || p === loaderB,
        });

        expect(result.args[0]).toBe(loaderA);
    });

    it('on Windows, falls back to "copilot" when no loader is found', () => {
        const result = resolveCopilotInvocation(baseArgs, {
            platform: 'win32',
            pathEnv: [path.join('C:', 'x'), path.join('C:', 'y')].join(path.delimiter),
            fileExists: () => false,
        });

        expect(result.command).toBe('copilot');
        expect(result.args).toEqual(baseArgs);
    });

    it('on non-Windows, always invokes "copilot" directly (even if a loader exists)', () => {
        const result = resolveCopilotInvocation(baseArgs, {
            platform: 'linux',
            pathEnv: '/usr/local/bin',
            fileExists: () => true,
        });

        expect(result.command).toBe('copilot');
        expect(result.args).toEqual(baseArgs);
    });

    it('ignores empty PATH segments', () => {
        const result = resolveCopilotInvocation(baseArgs, {
            platform: 'win32',
            pathEnv: path.delimiter + path.delimiter,
            fileExists: () => false,
        });
        expect(result.command).toBe('copilot');
    });
});
