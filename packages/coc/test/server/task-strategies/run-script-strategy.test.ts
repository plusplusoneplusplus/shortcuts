/**
 * RunScriptStrategy Unit Tests
 *
 * Tests the extracted RunScriptStrategy and formatScriptResponse function
 * independently of CLITaskExecutor.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import type { QueuedTask } from '@plusplusoneplusplus/forge';
import type { ExecutionContext } from '../../../src/server/task-strategies/index';
import { RunScriptStrategy, formatScriptResponse } from '../../../src/server/task-strategies/run-script-strategy';

// ============================================================================
// Mock child_process
// ============================================================================

interface FakeChild extends EventEmitter {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
}

function makeFakeChild(): FakeChild {
    const child = new EventEmitter() as FakeChild;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn(() => {
        setImmediate(() => child.emit('close', null));
    });
    return child;
}

const mockSpawn = vi.fn();
vi.mock('child_process', () => ({
    spawn: (...args: any[]) => mockSpawn(...args),
}));

// ============================================================================
// Helpers
// ============================================================================

function makeTask(overrides?: Partial<QueuedTask>): QueuedTask {
    return {
        id: 'rs-1',
        type: 'run-script',
        priority: 'normal',
        status: 'running',
        createdAt: Date.now(),
        payload: { kind: 'run-script', script: 'echo hello' },
        config: {},
        ...overrides,
    };
}

function makeContext(overrides?: Partial<ExecutionContext>): ExecutionContext {
    return {
        processId: 'queue_rs-1',
        store: {} as any,
        approvePermissions: true,
        workingDirectory: undefined,
        ...overrides,
    };
}

// ============================================================================
// RunScriptStrategy.execute
// ============================================================================

describe('RunScriptStrategy', () => {
    beforeEach(() => {
        mockSpawn.mockReset();
    });

    it('happy path — exit 0, captures stdout', async () => {
        const child = makeFakeChild();
        mockSpawn.mockReturnValue(child);

        const strategy = new RunScriptStrategy();
        const task = makeTask();
        const ctx = makeContext();

        const resultPromise = strategy.execute(task, ctx);

        setImmediate(() => {
            child.stdout.emit('data', Buffer.from('hello\n'));
            child.emit('close', 0);
        });

        const result = await resultPromise as any;

        expect(result.success).toBe(true);
        expect(result.result.stdout).toBe('hello\n');
        expect(result.result.stderr).toBe('');
        expect(result.result.exitCode).toBe(0);
        expect(result.timedOut).toBe(false);
        expect(result.response).toContain('✅ Success');
        expect(result.response).toContain('hello');
    });

    it('non-zero exit — success false, captures stderr', async () => {
        const child = makeFakeChild();
        mockSpawn.mockReturnValue(child);

        const strategy = new RunScriptStrategy();
        const task = makeTask({ id: 'rs-2' });
        const ctx = makeContext({ processId: 'queue_rs-2' });

        const resultPromise = strategy.execute(task, ctx);

        setImmediate(() => {
            child.stderr.emit('data', Buffer.from('error output'));
            child.emit('close', 1);
        });

        const result = await resultPromise as any;

        expect(result.success).toBe(false);
        expect(result.result.exitCode).toBe(1);
        expect(result.result.stderr).toBe('error output');
        expect(result.response).toContain('❌ Failed');
        expect(result.response).toContain('error output');
    });

    it('timeout — kills process, timedOut true, exitCode null', async () => {
        const child = makeFakeChild();
        mockSpawn.mockReturnValue(child);

        const strategy = new RunScriptStrategy();
        const task = makeTask({ id: 'rs-3', config: { timeoutMs: 50 } });
        const ctx = makeContext({ processId: 'queue_rs-3' });

        const result = await strategy.execute(task, ctx) as any;

        expect(child.kill).toHaveBeenCalled();
        expect(result.timedOut).toBe(true);
        expect(result.success).toBe(false);
        expect(result.result.exitCode).toBeNull();
        expect(result.response).toContain('Timed out');
    }, 2000);

    it('uses workingDirectory from context', async () => {
        const child = makeFakeChild();
        mockSpawn.mockReturnValue(child);

        const strategy = new RunScriptStrategy();
        const task = makeTask({ payload: { kind: 'run-script', script: 'ls' } });
        const ctx = makeContext({ workingDirectory: '/custom/dir' });

        const resultPromise = strategy.execute(task, ctx);
        setImmediate(() => child.emit('close', 0));
        await resultPromise;

        expect(mockSpawn).toHaveBeenCalledWith('ls', [], expect.objectContaining({
            shell: true,
            cwd: '/custom/dir',
        }));
    });

    it('falls back to undefined cwd when workingDirectory is empty string', async () => {
        const child = makeFakeChild();
        mockSpawn.mockReturnValue(child);

        const strategy = new RunScriptStrategy();
        const task = makeTask({ payload: { kind: 'run-script', script: 'ls' } });
        const ctx = makeContext({ workingDirectory: '' });

        const resultPromise = strategy.execute(task, ctx);
        setImmediate(() => child.emit('close', 0));
        await resultPromise;

        // '' || undefined → undefined
        expect(mockSpawn).toHaveBeenCalledWith('ls', [], expect.objectContaining({
            cwd: undefined,
        }));
    });

    it('spawn error — rejects with error', async () => {
        const child = makeFakeChild();
        mockSpawn.mockReturnValue(child);

        const strategy = new RunScriptStrategy();
        const task = makeTask({ id: 'rs-err' });
        const ctx = makeContext();

        const resultPromise = strategy.execute(task, ctx);
        setImmediate(() => child.emit('error', new Error('spawn ENOENT')));

        await expect(resultPromise).rejects.toThrow('spawn ENOENT');
    });

    it('passes shell: true to spawn', async () => {
        const child = makeFakeChild();
        mockSpawn.mockReturnValue(child);

        const strategy = new RunScriptStrategy();
        const task = makeTask({ payload: { kind: 'run-script', script: 'git status' } });
        const ctx = makeContext();

        const resultPromise = strategy.execute(task, ctx);
        setImmediate(() => child.emit('close', 0));
        await resultPromise;

        expect(mockSpawn).toHaveBeenCalledWith('git status', [], expect.objectContaining({
            shell: true,
        }));
    });
});

// ============================================================================
// formatScriptResponse
// ============================================================================

describe('formatScriptResponse', () => {
    it('success — includes success status', () => {
        const out = formatScriptResponse('echo hi', undefined, true, 'hi\n', '', 0, false, 100);
        expect(out).toContain('✅ Success');
        expect(out).toContain('`echo hi`');
        expect(out).toContain('100ms');
        expect(out).toContain('hi');
    });

    it('failure — includes exit code', () => {
        const out = formatScriptResponse('bad-cmd', '/my/dir', false, '', 'err', 127, false, 50);
        expect(out).toContain('❌ Failed (exit code 127)');
        expect(out).toContain('`/my/dir`');
        expect(out).toContain('err');
    });

    it('timeout — shows timed out status', () => {
        const out = formatScriptResponse('sleep 100', undefined, false, '', '', null, true, 200);
        expect(out).toContain('Timed out');
    });

    it('omits working directory when undefined', () => {
        const out = formatScriptResponse('echo x', undefined, true, 'x', '', 0, false, 10);
        expect(out).not.toContain('Working directory');
    });

    it('omits empty stdout/stderr sections', () => {
        const out = formatScriptResponse('echo x', undefined, true, '', '', 0, false, 10);
        expect(out).not.toContain('stdout');
        expect(out).not.toContain('stderr');
    });
});
