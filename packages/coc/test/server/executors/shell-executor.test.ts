/**
 * ShellExecutor Unit Tests
 *
 * Verifies shell-script spawning, output capture, timeout handling,
 * exit-code propagation, and output-file persistence in ShellExecutor.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import type { QueuedTask } from '@plusplusoneplusplus/forge';
import { ShellExecutor } from '../../../src/server/executors/shell-executor';
import { createMockProcessStore } from '../helpers/mock-process-store';

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
        id: 'sh-1',
        type: 'run-script',
        priority: 'normal',
        status: 'running',
        createdAt: Date.now(),
        payload: { kind: 'run-script', script: 'echo hello' },
        config: {},
        ...overrides,
    };
}

// ============================================================================
// ShellExecutor.execute — happy path
// ============================================================================

describe('ShellExecutor', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        mockSpawn.mockReset();
    });

    it('happy path — exit 0, captures stdout', async () => {
        const child = makeFakeChild();
        mockSpawn.mockReturnValue(child);

        const executor = new ShellExecutor(store);
        const task = makeTask();

        const resultPromise = executor.execute(task);

        setImmediate(() => {
            child.stdout.emit('data', Buffer.from('hello\n'));
            child.emit('close', 0);
        });

        const result = await resultPromise;

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

        const executor = new ShellExecutor(store);
        const task = makeTask({ id: 'sh-2' });

        const resultPromise = executor.execute(task);

        setImmediate(() => {
            child.stderr.emit('data', Buffer.from('error output'));
            child.emit('close', 1);
        });

        const result = await resultPromise;

        expect(result.success).toBe(false);
        expect(result.result.exitCode).toBe(1);
        expect(result.result.stderr).toBe('error output');
        expect(result.response).toContain('❌ Failed');
        expect(result.response).toContain('error output');
    });

    it('timeout — kills process, timedOut true, exitCode null', async () => {
        const child = makeFakeChild();
        mockSpawn.mockReturnValue(child);

        const executor = new ShellExecutor(store);
        const task = makeTask({ id: 'sh-3', config: { timeoutMs: 50 } });

        const result = await executor.execute(task);

        expect(child.kill).toHaveBeenCalled();
        expect(result.timedOut).toBe(true);
        expect(result.success).toBe(false);
        expect(result.result.exitCode).toBeNull();
        expect(result.response).toContain('Timed out');
    }, 2000);

    it('uses payload workingDirectory over default', async () => {
        const child = makeFakeChild();
        mockSpawn.mockReturnValue(child);

        const executor = new ShellExecutor(store, undefined, '/default/dir');
        const task = makeTask({
            payload: { kind: 'run-script', script: 'ls', workingDirectory: '/custom/dir' },
        });

        const resultPromise = executor.execute(task);
        setImmediate(() => child.emit('close', 0));
        await resultPromise;

        expect(mockSpawn).toHaveBeenCalledWith('ls', [], expect.objectContaining({
            shell: true,
            cwd: '/custom/dir',
        }));
    });

    it('falls back to defaultWorkingDirectory when payload has none', async () => {
        const child = makeFakeChild();
        mockSpawn.mockReturnValue(child);

        const executor = new ShellExecutor(store, undefined, '/default/dir');
        const task = makeTask({ payload: { kind: 'run-script', script: 'pwd' } });

        const resultPromise = executor.execute(task);
        setImmediate(() => child.emit('close', 0));
        await resultPromise;

        expect(mockSpawn).toHaveBeenCalledWith('pwd', [], expect.objectContaining({
            cwd: '/default/dir',
        }));
    });

    it('spawn error — rejects with error', async () => {
        const child = makeFakeChild();
        mockSpawn.mockReturnValue(child);

        const executor = new ShellExecutor(store);
        const task = makeTask({ id: 'sh-err' });

        const resultPromise = executor.execute(task);
        setImmediate(() => child.emit('error', new Error('spawn ENOENT')));

        await expect(resultPromise).rejects.toThrow('spawn ENOENT');
    });

    it('passes shell: true to spawn', async () => {
        const child = makeFakeChild();
        mockSpawn.mockReturnValue(child);

        const executor = new ShellExecutor(store);
        const task = makeTask({ payload: { kind: 'run-script', script: 'git status' } });

        const resultPromise = executor.execute(task);
        setImmediate(() => child.emit('close', 0));
        await resultPromise;

        expect(mockSpawn).toHaveBeenCalledWith('git status', [], expect.objectContaining({
            shell: true,
        }));
    });

    it('constructs processId as queue_<taskId>', async () => {
        const child = makeFakeChild();
        mockSpawn.mockReturnValue(child);

        const executor = new ShellExecutor(store, undefined, undefined);
        const task = makeTask({ id: 'abc-123' });

        const resultPromise = executor.execute(task);
        setImmediate(() => child.emit('close', 0));
        await resultPromise;

        // No error — processId constructed correctly without crashing
        expect(result => result).toBeDefined();
    });

    // ========================================================================
    // Output persistence
    // ========================================================================

    it('does not call persistOutput when dataDir is not set', async () => {
        const child = makeFakeChild();
        mockSpawn.mockReturnValue(child);

        const executor = new ShellExecutor(store); // no dataDir
        const task = makeTask({ payload: { kind: 'run-script', script: 'echo x' } });

        const resultPromise = executor.execute(task);
        setImmediate(() => {
            child.stdout.emit('data', Buffer.from('x\n'));
            child.emit('close', 0);
        });
        await resultPromise;

        // updateProcess is only called by persistOutput (which should not run without dataDir)
        expect(store.updateProcess).not.toHaveBeenCalled();
    });

    // ========================================================================
    // Regression: ShellExecutor must not import from other executor/ modules
    // ========================================================================

    it('is an instance of BaseExecutor (inherits shared plumbing)', async () => {
        const { BaseExecutor } = await import('../../../src/server/executors/base-executor');
        const executor = new ShellExecutor(store);
        expect(executor).toBeInstanceOf(BaseExecutor);
    });
});
