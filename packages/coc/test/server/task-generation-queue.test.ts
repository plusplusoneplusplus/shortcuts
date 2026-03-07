/**
 * Task Generation Queue Tests
 *
 * Tests for the `task-generation` queue task type:
 * - isTaskGenerationPayload type guard
 * - CLITaskExecutor routing for task-generation tasks
 * - POST /api/workspaces/:id/queue/generate endpoint
 *
 * Uses mock CopilotSDKService to avoid real AI calls.
 * Uses port 0 (OS-assigned) for test isolation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ============================================================================
// Mock CopilotSDKService
// ============================================================================

import { createMockSDKService } from '../helpers/mock-sdk-service';
import { createMockProcessStore } from '../helpers/mock-process-store';

const sdkMocks = createMockSDKService();
const { mockSendMessage, mockIsAvailable } = sdkMocks;

vi.mock('@plusplusoneplusplus/pipeline-core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/pipeline-core')>();
    return {
        ...actual,
        getCopilotSDKService: () => sdkMocks.service,
    };
});

import {
    isChatPayload,
    hasTaskGenerationContext,
} from '@plusplusoneplusplus/coc-server';
import type {
    ChatPayload,
} from '@plusplusoneplusplus/coc-server';
import type { QueuedTask } from '@plusplusoneplusplus/pipeline-core';
import { CLITaskExecutor } from '../../src/server/queue-executor-bridge';
import { createExecutionServer } from '../../src/server/index';
import { FileProcessStore } from '@plusplusoneplusplus/pipeline-core';
import type { ExecutionServer } from '@plusplusoneplusplus/coc-server';

// ============================================================================
// Helpers
// ============================================================================

function request(
    url: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {}
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: options.method || 'GET',
                headers: options.headers,
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => {
                    resolve({
                        status: res.statusCode || 0,
                        headers: res.headers,
                        body: Buffer.concat(chunks).toString('utf-8'),
                    });
                });
            }
        );
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

function postJSON(url: string, data: unknown) {
    return request(url, {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    });
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function removeDirSafe(dir: string): void {
    try {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch (error: any) {
        if (error?.code !== 'ENOENT' && error?.code !== 'ENOTEMPTY') {
            throw error;
        }
    }
}

// ============================================================================
// Type Guard Tests
// ============================================================================

describe('isChatPayload / hasTaskGenerationContext', () => {
    it('should return true for a valid ChatPayload with task generation context', () => {
        const payload: ChatPayload = {
            kind: 'chat',
            mode: 'autopilot',
            prompt: 'Create a login feature',
            workingDirectory: '/tmp/workspace',
            context: {
                taskGeneration: {
                    targetFolder: undefined,
                    name: undefined,
                },
            },
        };
        expect(isChatPayload(payload as any)).toBe(true);
        expect(hasTaskGenerationContext(payload as any)).toBe(true);
    });

    it('should return true for ChatPayload with all optional task generation fields', () => {
        const payload: ChatPayload = {
            kind: 'chat',
            mode: 'autopilot',
            prompt: 'Create a login feature',
            workingDirectory: '/tmp/workspace',
            workspaceId: 'ws-1',
            model: 'gpt-4',
            context: {
                taskGeneration: {
                    targetFolder: 'auth',
                    name: 'login-feature',
                    depth: 'deep',
                    mode: 'from-feature',
                },
            },
        };
        expect(isChatPayload(payload as any)).toBe(true);
        expect(hasTaskGenerationContext(payload as any)).toBe(true);
    });

    it('should return false for hasTaskGenerationContext on a plain chat payload', () => {
        const payload: ChatPayload = {
            kind: 'chat',
            mode: 'autopilot',
            prompt: 'Follow this prompt',
        };
        expect(isChatPayload(payload as any)).toBe(true);
        expect(hasTaskGenerationContext(payload as any)).toBe(false);
    });

    it('should return false for hasTaskGenerationContext on an ask chat payload', () => {
        const payload: ChatPayload = {
            kind: 'chat',
            mode: 'ask',
            prompt: 'Explain this code',
            workingDirectory: '/tmp',
        };
        expect(isChatPayload(payload as any)).toBe(true);
        expect(hasTaskGenerationContext(payload as any)).toBe(false);
    });

    it('should return false for isChatPayload on non-chat payload', () => {
        const payload = {
            kind: 'run-workflow',
            workflowPath: '/tmp/workflow.yaml',
        };
        expect(isChatPayload(payload as any)).toBe(false);
        expect(hasTaskGenerationContext(payload as any)).toBe(false);
    });
});

// ============================================================================
// CLITaskExecutor — task-generation routing
// ============================================================================

describe('CLITaskExecutor — task-generation', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        sdkMocks.resetAll();
    });

    function makeTaskGenerationTask(overrides: Record<string, any> = {}): QueuedTask {
        const workDir = overrides.workingDirectory || os.tmpdir();
        return {
            id: 'tg-1',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: {
                kind: 'chat',
                mode: 'autopilot',
                prompt: overrides.prompt || 'Build a user auth module',
                workingDirectory: workDir,
                context: {
                    taskGeneration: {
                        targetFolder: overrides.targetFolder,
                        name: overrides.name,
                        depth: overrides.depth,
                        mode: overrides.mode,
                    },
                },
                ...(overrides.workspaceId && { workspaceId: overrides.workspaceId }),
                ...(overrides.model && { model: overrides.model }),
            } as unknown as Record<string, unknown>,
            config: { timeoutMs: 30000 },
            displayName: 'Generate auth task',
        };
    }

    it('should execute a basic task-generation task via AI', async () => {
        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service as any });
        const task = makeTaskGenerationTask();

        const result = await executor.execute(task);

        expect(result.success).toBe(true);
        expect(mockSendMessage).toHaveBeenCalledTimes(1);
        // Verify the prompt contains the user's feature description
        const callArgs = mockSendMessage.mock.calls[0][0];
        expect(callArgs.prompt).toContain('Build a user auth module');
    });

    it('should use buildCreateTaskPromptWithName when name is provided', async () => {
        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service as any });
        const task = makeTaskGenerationTask({ name: 'auth-module' });

        const result = await executor.execute(task);

        expect(result.success).toBe(true);
        const callArgs = mockSendMessage.mock.calls[0][0];
        // buildCreateTaskPromptWithName includes the name in the prompt
        expect(callArgs.prompt).toContain('auth-module');
        expect(callArgs.prompt).toContain('Build a user auth module');
    });

    it('should handle from-feature mode with simple depth', async () => {
        const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-feature-'));
        // Create minimal .vscode/tasks structure for gatherFeatureContext
        const tasksDir = path.join(workDir, '.vscode', 'tasks');
        fs.mkdirSync(tasksDir, { recursive: true });

        try {
            const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service as any });
            const task = makeTaskGenerationTask({
                workingDirectory: workDir,
                mode: 'from-feature',
                targetFolder: undefined,
            });

            const result = await executor.execute(task);

            expect(result.success).toBe(true);
            expect(mockSendMessage).toHaveBeenCalledTimes(1);
        } finally {
            removeDirSafe(workDir);
        }
    });

    it('should handle from-feature mode with deep depth', async () => {
        const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-deep-'));
        const tasksDir = path.join(workDir, '.vscode', 'tasks');
        fs.mkdirSync(tasksDir, { recursive: true });

        try {
            const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service as any });
            const task = makeTaskGenerationTask({
                workingDirectory: workDir,
                mode: 'from-feature',
                depth: 'deep',
            });

            const result = await executor.execute(task);

            expect(result.success).toBe(true);
            expect(mockSendMessage).toHaveBeenCalledTimes(1);
        } finally {
            removeDirSafe(workDir);
        }
    });

    it('should use workingDirectory from payload', async () => {
        const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-wd-'));
        try {
            const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service as any });
            const task = makeTaskGenerationTask({ workingDirectory: workDir });

            await executor.execute(task);

            const callArgs = mockSendMessage.mock.calls[0][0];
            expect(callArgs.workingDirectory).toBe(workDir);
        } finally {
            removeDirSafe(workDir);
        }
    });
});

// ============================================================================
// Queue Endpoint Tests
// ============================================================================

describe('POST /api/workspaces/:id/queue/generate', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;
    let workspaceDir: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-queue-test-'));
        workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-queue-ws-'));
        sdkMocks.resetAll();
    });

    afterEach(async () => {
        if (server) {
            await server.close();
            server = undefined;
        }
        removeDirSafe(dataDir);
        removeDirSafe(workspaceDir);
    });

    async function startServer(): Promise<ExecutionServer> {
        const store = new FileProcessStore({ dataDir });
        server = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir });
        return server;
    }

    async function registerWorkspace(srv: ExecutionServer, rootPath: string): Promise<string> {
        const id = 'test-ws-' + Date.now();
        const res = await postJSON(`${srv.url}/api/workspaces`, {
            id,
            name: 'Test Workspace',
            rootPath,
        });
        expect(res.status).toBe(201);
        return id;
    }

    it('should return 201 with taskId and queuedAt', async () => {
        const srv = await startServer();
        const wsId = await registerWorkspace(srv, workspaceDir);

        const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/queue/generate`, {
            prompt: 'Create a caching layer',
        });

        expect(res.status).toBe(201);
        const body = JSON.parse(res.body);
        expect(body.taskId).toBeDefined();
        expect(typeof body.taskId).toBe('string');
        expect(body.queuedAt).toBeDefined();
        expect(typeof body.queuedAt).toBe('number');
    });

    it('should enqueue a task of type task-generation', async () => {
        const srv = await startServer();
        const wsId = await registerWorkspace(srv, workspaceDir);

        const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/queue/generate`, {
            prompt: 'Create a caching layer',
            name: 'cache-feature',
            model: 'gpt-4',
            depth: 'simple',
        });

        expect(res.status).toBe(201);
        const body = JSON.parse(res.body);

        // Verify the task appears in the queue
        const queueRes = await request(`${srv.url}/api/queue`);
        const queueBody = JSON.parse(queueRes.body);
        const allTasks = [...(queueBody.queued || []), ...(queueBody.running || [])];
        const task = allTasks.find((t: any) => t.id === body.taskId);
        expect(task).toBeDefined();
        expect(task.type).toBe('chat');
        expect(task.payload.kind).toBe('chat');
        expect(task.payload.prompt).toBe('Create a caching layer');
        expect(task.payload.context.taskGeneration.name).toBe('cache-feature');
    });

    it('should return 400 for missing prompt', async () => {
        const srv = await startServer();
        const wsId = await registerWorkspace(srv, workspaceDir);

        const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/queue/generate`, {});

        expect(res.status).toBe(400);
        const body = JSON.parse(res.body);
        expect(body.error).toContain('prompt');
    });

    it('should return 400 for empty prompt', async () => {
        const srv = await startServer();
        const wsId = await registerWorkspace(srv, workspaceDir);

        const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/queue/generate`, {
            prompt: '   ',
        });

        expect(res.status).toBe(400);
    });

    it('should return 404 for unknown workspace', async () => {
        const srv = await startServer();

        const res = await postJSON(`${srv.url}/api/workspaces/nonexistent/queue/generate`, {
            prompt: 'Create a task',
        });

        expect(res.status).toBe(404);
        const body = JSON.parse(res.body);
        expect(body.error).toBe('Workspace not found');
    });

    it('should use displayName from name field when provided', async () => {
        const srv = await startServer();
        const wsId = await registerWorkspace(srv, workspaceDir);

        const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/queue/generate`, {
            prompt: 'Very long prompt that should be truncated if no name is provided because displayName falls back to prompt',
            name: 'short-name',
        });

        expect(res.status).toBe(201);
        const body = JSON.parse(res.body);

        const queueRes = await request(`${srv.url}/api/queue`);
        const queueBody = JSON.parse(queueRes.body);
        const allTasks = [...(queueBody.queued || []), ...(queueBody.running || [])];
        const task = allTasks.find((t: any) => t.id === body.taskId);
        expect(task).toBeDefined();
        expect(task.displayName).toBe('short-name');
    });

    it('should enqueue task with image metadata in payload', async () => {
        const srv = await startServer();
        const wsId = await registerWorkspace(srv, workspaceDir);

        const images = ['data:image/png;base64,iVBOR', 'data:image/jpeg;base64,/9j/4'];
        const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/queue/generate`, {
            prompt: 'Create a caching layer',
            images,
        });

        expect(res.status).toBe(201);
        const body = JSON.parse(res.body);

        const queueRes = await request(`${srv.url}/api/queue`);
        const queueBody = JSON.parse(queueRes.body);
        const allTasks = [...(queueBody.queued || []), ...(queueBody.running || [])];
        const task = allTasks.find((t: any) => t.id === body.taskId);
        expect(task).toBeDefined();
        // Images are stored in context.taskGeneration, not at payload level
        expect(task.payload.context.taskGeneration.images).toHaveLength(images.length);
    });

    it('should filter non-string images and cap at 10', async () => {
        const srv = await startServer();
        const wsId = await registerWorkspace(srv, workspaceDir);

        const images = Array.from({ length: 12 }, (_, i) => `data:image/png;base64,img${i}`);
        (images as any[]).push(123, null);
        const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/queue/generate`, {
            prompt: 'Create a task',
            images,
        });

        expect(res.status).toBe(201);
        const body = JSON.parse(res.body);

        const queueRes = await request(`${srv.url}/api/queue`);
        const queueBody = JSON.parse(queueRes.body);
        const allTasks = [...(queueBody.queued || []), ...(queueBody.running || [])];
        const task = allTasks.find((t: any) => t.id === body.taskId);
        expect(task).toBeDefined();
        // Images are stored in context.taskGeneration; non-strings filtered, capped at 10
        expect(task.payload.context.taskGeneration.images).toHaveLength(10);
    });

    it('should not include images field when images array is empty', async () => {
        const srv = await startServer();
        const wsId = await registerWorkspace(srv, workspaceDir);

        const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/queue/generate`, {
            prompt: 'Create a task',
            images: [],
        });

        expect(res.status).toBe(201);
        const body = JSON.parse(res.body);

        const queueRes = await request(`${srv.url}/api/queue`);
        const queueBody = JSON.parse(queueRes.body);
        const allTasks = [...(queueBody.queued || []), ...(queueBody.running || [])];
        const task = allTasks.find((t: any) => t.id === body.taskId);
        expect(task.payload.context.taskGeneration.images).toBeUndefined();
    });

    it('should not include images field when images is not provided', async () => {
        const srv = await startServer();
        const wsId = await registerWorkspace(srv, workspaceDir);

        const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/queue/generate`, {
            prompt: 'Create a task',
        });

        expect(res.status).toBe(201);
        const body = JSON.parse(res.body);

        const queueRes = await request(`${srv.url}/api/queue`);
        const queueBody = JSON.parse(queueRes.body);
        const allTasks = [...(queueBody.queued || []), ...(queueBody.running || [])];
        const task = allTasks.find((t: any) => t.id === body.taskId);
        expect(task.payload.context.taskGeneration.images).toBeUndefined();
    });
});
