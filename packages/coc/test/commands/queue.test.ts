import { describe, expect, it, vi } from 'vitest';
import { Readable, Writable } from 'stream';
import {
    buildQueueSubmitRequest,
    executeQueueCancel,
    executeQueueList,
    executeQueueStatus,
    executeQueueSubmit,
    listQueueTasks,
    type QueueCancelDependencies,
    type QueueListDependencies,
    type QueueStatusDependencies,
    resolveWorkspaceIdFromWorkspaces,
    type QueueSubmitDependencies,
} from '../../src/commands/queue';
import type {
    EnqueueTaskRequest,
    EnqueueTaskResponse,
    QueueHistoryResponse,
    QueueListResponse,
    QueueTaskResponse,
    QueueTaskSummary,
    WorkspacesResponse,
} from '@plusplusoneplusplus/coc-client';

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

function makeListClient(options: {
    list?: () => Promise<QueueListResponse>;
    history?: () => Promise<QueueHistoryResponse>;
} = {}): QueueListDependencies['client'] {
    return {
        queue: {
            list: vi.fn(options.list ?? (async () => queueListResponse())),
            history: vi.fn(options.history ?? (async () => ({ history: [] }))),
        },
    };
}

function makeCancelClient(options: {
    cancel?: (taskId: string, options?: { reason?: string }) => Promise<unknown>;
} = {}): QueueCancelDependencies['client'] {
    return {
        queue: {
            cancel: vi.fn(options.cancel ?? (async () => ({ cancelled: true }))),
        },
    };
}

function makeStatusClient(options: {
    getTask?: (taskId: string) => Promise<QueueTaskResponse>;
} = {}): QueueStatusDependencies['client'] {
    return {
        queue: {
            getTask: vi.fn(options.getTask ?? (async () => ({ task: queueTask({ id: 'queue-abc123', status: 'running', displayName: 'Refactor auth' }) }))),
        },
    };
}

function queueListResponse(response: Partial<QueueListResponse> = {}): QueueListResponse {
    return {
        queued: [],
        running: [],
        stats: {
            queued: 0,
            running: 0,
            completed: 0,
            failed: 0,
            cancelled: 0,
            total: 0,
            isPaused: false,
            isDraining: false,
            isAutopilotPaused: false,
        },
        ...response,
    };
}

function queueTask(task: Partial<QueueTaskSummary> & { id: string; status: string }): QueueTaskSummary {
    return {
        type: 'chat',
        priority: 'normal',
        createdAt: Date.UTC(2026, 5, 2, 5, 40, 0),
        payload: {},
        ...task,
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

    describe('listQueueTasks', () => {
        it('uses queue history for terminal status filters', async () => {
            const completed = queueTask({ id: 'queue-done', status: 'completed', displayName: 'Done task' });
            const client = makeListClient({
                history: async () => ({ history: [completed] }),
            });

            const tasks = await listQueueTasks({
                repoId: 'repo-main',
                status: 'completed',
                limit: '5',
            }, client!);

            expect(tasks).toEqual([completed]);
            expect(client!.queue.history).toHaveBeenCalledWith(expect.objectContaining({
                repoId: 'repo-main',
                status: 'completed',
                limit: 5,
            }));
            expect(client!.queue.list).not.toHaveBeenCalled();
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

describe('executeQueueList', () => {
    it('prints active queue tasks as a table with workspace filtering and limit', async () => {
        const stdout = memoryWritable();
        const stderr = memoryWritable();
        const queued = queueTask({ id: 'queue-one', status: 'queued', displayName: 'First' });
        const running = queueTask({ id: 'queue-two', status: 'running', displayName: 'Second' });
        const client = makeListClient({
            list: async () => queueListResponse({
                queued: [
                    queued,
                    { kind: 'pause-marker', id: 'pause-one', createdAt: Date.UTC(2026, 5, 2, 5, 41, 0) },
                ],
                running: [running],
            }),
        });

        const exitCode = await executeQueueList({
            workspaceId: 'ws-main',
            limit: '2',
        }, {
            client,
            stdout: stdout.stream,
            stderr: stderr.stream,
            env: {},
        });

        expect(exitCode).toBe(0);
        expect(stderr.output()).toBe('');
        expect(stdout.output()).toContain('ID');
        expect(stdout.output()).toContain('Display Name');
        expect(stdout.output()).toContain('Created At');
        expect(stdout.output()).toContain('queue-one');
        expect(stdout.output()).toContain('queue-two');
        expect(stdout.output()).not.toContain('pause-one');
        expect(client!.queue.list).toHaveBeenCalledWith(expect.objectContaining({
            workspace: 'ws-main',
        }));
    });

    it('prints a raw JSON task array when requested', async () => {
        const stdout = memoryWritable();
        const queued = queueTask({ id: 'queue-one', status: 'queued' });
        const running = queueTask({ id: 'queue-two', status: 'running' });

        const exitCode = await executeQueueList({
            status: 'running',
            output: 'json',
        }, {
            client: makeListClient({
                list: async () => queueListResponse({
                    queued: [queued],
                    running: [running],
                }),
            }),
            stdout: stdout.stream,
            stderr: memoryWritable().stream,
            env: {},
        });

        expect(exitCode).toBe(0);
        expect(JSON.parse(stdout.output())).toEqual([running]);
    });

    it('prints a clear error and exits 1 for invalid filters', async () => {
        const stdout = memoryWritable();
        const stderr = memoryWritable();

        const exitCode = await executeQueueList({
            status: 'blocked',
        }, {
            client: makeListClient(),
            stdout: stdout.stream,
            stderr: stderr.stream,
            env: {},
        });

        expect(exitCode).toBe(1);
        expect(stdout.output()).toBe('');
        expect(stderr.output()).toContain("Invalid status: 'blocked'");
    });
});

describe('executeQueueCancel', () => {
    it('cancels the requested task and prints the task ID', async () => {
        const stdout = memoryWritable();
        const stderr = memoryWritable();
        const client = makeCancelClient();

        const exitCode = await executeQueueCancel('queue-abc123', {
            reason: 'no longer needed',
        }, {
            client,
            stdout: stdout.stream,
            stderr: stderr.stream,
            env: {},
        });

        expect(exitCode).toBe(0);
        expect(stdout.output()).toBe('Cancelled: queue-abc123\n');
        expect(stderr.output()).toBe('');
        expect(client!.queue.cancel).toHaveBeenCalledWith('queue-abc123', { reason: 'no longer needed' });
    });

    it('omits the cancellation reason when it is blank', async () => {
        const client = makeCancelClient();

        const exitCode = await executeQueueCancel('queue-abc123', {
            reason: '   ',
        }, {
            client,
            stdout: memoryWritable().stream,
            stderr: memoryWritable().stream,
            env: {},
        });

        expect(exitCode).toBe(0);
        expect(client!.queue.cancel).toHaveBeenCalledWith('queue-abc123', undefined);
    });

    it('prints a clear error and exits 1 when the task cannot be cancelled', async () => {
        const stdout = memoryWritable();
        const stderr = memoryWritable();

        const exitCode = await executeQueueCancel('queue-missing', {}, {
            client: makeCancelClient({
                cancel: async () => {
                    throw new Error('Task not found or not cancellable');
                },
            }),
            stdout: stdout.stream,
            stderr: stderr.stream,
            env: {},
        });

        expect(exitCode).toBe(1);
        expect(stdout.output()).toBe('');
        expect(stderr.output()).toBe('Task not found or not cancellable\n');
    });
});

describe('executeQueueStatus', () => {
    it('prints task details as text', async () => {
        const stdout = memoryWritable();
        const stderr = memoryWritable();
        const client = makeStatusClient({
            getTask: async () => ({
                task: queueTask({
                    id: 'queue-abc123',
                    status: 'running',
                    type: 'chat',
                    displayName: 'refactor src/auth.ts',
                    createdAt: Date.UTC(2026, 5, 2, 5, 40, 0),
                }),
            }),
        });

        const exitCode = await executeQueueStatus('queue-abc123', {}, {
            client,
            stdout: stdout.stream,
            stderr: stderr.stream,
            env: {},
        });

        expect(exitCode).toBe(0);
        expect(stderr.output()).toBe('');
        expect(stdout.output()).toBe([
            'ID:      queue-abc123',
            'Status:  running',
            'Type:    chat',
            'Name:    refactor src/auth.ts',
            'Created: 2026-06-02T05:40:00.000Z',
            '',
        ].join('\n'));
        expect(client!.queue.getTask).toHaveBeenCalledWith('queue-abc123');
    });

    it('prints raw task JSON when requested', async () => {
        const stdout = memoryWritable();

        const exitCode = await executeQueueStatus('queue-json', {
            output: 'json',
        }, {
            client: makeStatusClient({
                getTask: async () => ({
                    task: queueTask({
                        id: 'queue-json',
                        status: 'queued',
                        displayName: 'JSON task',
                    }),
                }),
            }),
            stdout: stdout.stream,
            stderr: memoryWritable().stream,
            env: {},
        });

        expect(exitCode).toBe(0);
        expect(JSON.parse(stdout.output())).toMatchObject({
            id: 'queue-json',
            status: 'queued',
            displayName: 'JSON task',
        });
    });

    it('prints a clear error and exits 1 for an unknown task', async () => {
        const stdout = memoryWritable();
        const stderr = memoryWritable();

        const exitCode = await executeQueueStatus('queue-missing', {}, {
            client: makeStatusClient({
                getTask: async () => {
                    throw new Error('Task not found');
                },
            }),
            stdout: stdout.stream,
            stderr: stderr.stream,
            env: {},
        });

        expect(exitCode).toBe(1);
        expect(stdout.output()).toBe('');
        expect(stderr.output()).toBe('Task not found\n');
    });
});
