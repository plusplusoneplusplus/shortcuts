import { describe, expect, it, vi } from 'vitest';
import { Readable, Writable } from 'stream';
import {
    buildQueueSubmitRequest,
    executeQueueSubmit,
    resolveWorkspaceIdFromWorkspaces,
    type QueueSubmitDependencies,
} from '../../src/commands/queue';
import type { EnqueueTaskRequest, EnqueueTaskResponse, WorkspacesResponse } from '@plusplusoneplusplus/coc-client';

function memoryWritable() {
    let output = '';
    const writable = new Writable({
        write(chunk, _encoding, callback) {
            output += chunk.toString();
            callback();
        },
    });
    return {
        stream: writable,
        output: () => output,
    };
}

function makeClient(options: {
    workspaces?: WorkspacesResponse['workspaces'];
    enqueue?: (request: EnqueueTaskRequest) => Promise<EnqueueTaskResponse>;
} = {}): QueueSubmitDependencies['client'] {
    return {
        workspaces: {
            list: vi.fn().mockResolvedValue({ workspaces: options.workspaces ?? [] }),
        },
        queue: {
            enqueue: vi.fn(options.enqueue ?? (async () => ({ task: { id: 'queue-abc123', status: 'queued' } }))),
        },
    };
}

describe('queue command helpers', () => {
    describe('resolveWorkspaceIdFromWorkspaces', () => {
        it('selects the longest registered workspace root containing cwd', () => {
            const workspaceId = resolveWorkspaceIdFromWorkspaces('/repo/sub-project/src', [
                { id: 'root', name: 'Root', rootPath: '/repo' },
                { id: 'sub', name: 'Sub', rootPath: '/repo/sub-project' },
            ]);

            expect(workspaceId).toBe('sub');
        });

        it('returns undefined when cwd is outside every registered workspace', () => {
            const workspaceId = resolveWorkspaceIdFromWorkspaces('/other/repo', [
                { id: 'main', name: 'Main', rootPath: '/repo' },
            ]);

            expect(workspaceId).toBeUndefined();
        });
    });

    describe('buildQueueSubmitRequest', () => {
        it('builds a chat enqueue request with explicit submit options', async () => {
            const request = await buildQueueSubmitRequest('refactor auth', {
                mode: 'ask',
                provider: 'codex',
                effortTier: 'high',
                model: 'gpt-5.4',
                reasoningEffort: 'xhigh',
                workspaceId: 'ws-explicit',
                priority: 'high',
                displayName: 'Auth refactor',
            }, makeClient()!, process.cwd());

            expect(request).toEqual({
                type: 'chat',
                priority: 'high',
                payload: {
                    kind: 'chat',
                    prompt: 'refactor auth',
                    mode: 'ask',
                    provider: 'codex',
                    workspaceId: 'ws-explicit',
                },
                config: {
                    effortTier: 'high',
                    model: 'gpt-5.4',
                    reasoningEffort: 'xhigh',
                },
                displayName: 'Auth refactor',
            });
        });

        it('defaults mode and priority while resolving workspace ID from cwd', async () => {
            const request = await buildQueueSubmitRequest('implement feature', {}, makeClient({
                workspaces: [{ id: 'ws-main', name: 'Main', rootPath: process.cwd() }],
            })!, process.cwd());

            expect(request.priority).toBe('normal');
            expect(request.payload).toMatchObject({
                kind: 'chat',
                mode: 'autopilot',
                prompt: 'implement feature',
                workspaceId: 'ws-main',
            });
            expect(request.config).toBeUndefined();
        });

        it('rejects invalid mode values before enqueueing', async () => {
            await expect(buildQueueSubmitRequest('do work', {
                mode: 'plan',
                workspaceId: 'ws-main',
            }, makeClient()!, process.cwd())).rejects.toThrow("Invalid mode: 'plan'");
        });
    });
});

describe('executeQueueSubmit', () => {
    it('enqueues the provided message and prints the task ID as text', async () => {
        const stdout = memoryWritable();
        const stderr = memoryWritable();
        const client = makeClient();

        const exitCode = await executeQueueSubmit('hello queue', {
            workspaceId: 'ws-main',
        }, {
            client,
            stdout: stdout.stream,
            stderr: stderr.stream,
            env: {},
        });

        expect(exitCode).toBe(0);
        expect(stdout.output()).toBe('Task queued: queue-abc123\n');
        expect(stderr.output()).toBe('');
        expect(client!.queue.enqueue).toHaveBeenCalledWith(expect.objectContaining({
            type: 'chat',
            payload: expect.objectContaining({
                prompt: 'hello queue',
                mode: 'autopilot',
                workspaceId: 'ws-main',
            }),
        }));
    });

    it('reads the prompt from stdin when message is omitted', async () => {
        const stdout = memoryWritable();
        const client = makeClient();

        const exitCode = await executeQueueSubmit(undefined, {
            workspaceId: 'ws-main',
        }, {
            client,
            stdin: Readable.from(['from stdin\n']),
            stdout: stdout.stream,
            stderr: memoryWritable().stream,
            env: {},
        });

        expect(exitCode).toBe(0);
        expect(client!.queue.enqueue).toHaveBeenCalledWith(expect.objectContaining({
            payload: expect.objectContaining({ prompt: 'from stdin' }),
        }));
    });

    it('prints compact JSON output when requested', async () => {
        const stdout = memoryWritable();

        const exitCode = await executeQueueSubmit('json task', {
            workspaceId: 'ws-main',
            output: 'json',
        }, {
            client: makeClient(),
            stdout: stdout.stream,
            stderr: memoryWritable().stream,
            env: {},
        });

        expect(exitCode).toBe(0);
        expect(stdout.output()).toBe('{"taskId":"queue-abc123","status":"queued"}\n');
    });

    it('prints a clear error and exits 1 when enqueue fails', async () => {
        const stdout = memoryWritable();
        const stderr = memoryWritable();

        const exitCode = await executeQueueSubmit('bad task', {
            workspaceId: 'ws-main',
        }, {
            client: makeClient({
                enqueue: async () => {
                    throw new Error('server rejected task');
                },
            }),
            stdout: stdout.stream,
            stderr: stderr.stream,
            env: {},
        });

        expect(exitCode).toBe(1);
        expect(stdout.output()).toBe('');
        expect(stderr.output()).toBe('server rejected task\n');
    });
});
