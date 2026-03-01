/**
 * Queue Handler Tests
 *
 * Comprehensive tests for the Queue REST API endpoints:
 * enqueue, list, get, cancel, reorder, pause/resume, clear,
 * stats, history, and WebSocket queue events.
 *
 * Uses port 0 (OS-assigned) for test isolation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import { createExecutionServer } from '../../src/server/index';
import { FileProcessStore } from '@plusplusoneplusplus/pipeline-core';
import type { ExecutionServer } from '@plusplusoneplusplus/coc-server';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ============================================================================
// Helpers
// ============================================================================

/** Make an HTTP request and return status, headers, and body. */
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
        if (options.body) {
            req.write(options.body);
        }
        req.end();
    });
}

/** POST JSON helper. */
function postJSON(url: string, data: unknown) {
    return request(url, {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    });
}

/** Create a minimal task body for POST /api/queue. */
function makeTask(overrides: Record<string, any> = {}) {
    return {
        type: 'custom',
        priority: 'normal',
        displayName: 'Test task',
        payload: { data: { prompt: 'test' } },
        config: {},
        ...overrides,
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('Queue Handler', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-handler-test-'));
    });

    afterEach(async () => {
        if (server) {
            await server.close();
            server = undefined;
        }
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    async function startServer(): Promise<ExecutionServer> {
        const store = new FileProcessStore({ dataDir });
        server = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir });
        return server;
    }

    // ========================================================================
    // Enqueue
    // ========================================================================

    describe('POST /api/queue — Enqueue', () => {
        it('should enqueue a task and return it with an ID', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, makeTask());
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task).toBeDefined();
            expect(body.task.id).toBeDefined();
            expect(body.task.type).toBe('custom');
            expect(body.task.priority).toBe('normal');
            expect(body.task.status).toBe('queued');
            expect(body.task.displayName).toBe('Test task');
        });

        it('should enqueue with high priority', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, makeTask({ priority: 'high' }));
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.priority).toBe('high');
        });

        it('should enqueue with low priority', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, makeTask({ priority: 'low' }));
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.priority).toBe('low');
        });

        it('should default to normal priority for invalid values', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, makeTask({ priority: 'invalid' }));
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.priority).toBe('normal');
        });

        it('should return 400 for missing type', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, { displayName: 'No type' });
            expect(res.status).toBe(400);
            expect(JSON.parse(res.body).error).toContain('type');
        });

        it('should return 400 for invalid type', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, makeTask({ type: 'invalid-type' }));
            expect(res.status).toBe(400);
            expect(JSON.parse(res.body).error).toContain('Invalid task type');
        });

        it('should return 400 for invalid JSON', async () => {
            const srv = await startServer();

            const res = await request(`${srv.url}/api/queue`, {
                method: 'POST',
                body: 'not json',
                headers: { 'Content-Type': 'application/json' },
            });
            expect(res.status).toBe(400);
        });

        it('should enqueue ai-clarification type', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, makeTask({
                type: 'ai-clarification',
                payload: { prompt: 'Explain this code' },
            }));
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.type).toBe('ai-clarification');
        });

        it('should enqueue follow-prompt type', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, makeTask({
                type: 'follow-prompt',
                payload: { promptFilePath: '/path/to/prompt.md' },
            }));
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.type).toBe('follow-prompt');
        });

        it('should enqueue code-review type', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, makeTask({
                type: 'code-review',
                payload: { diffType: 'staged', rulesFolder: '.github/cr-rules' },
            }));
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.type).toBe('code-review');
        });

        it('should enqueue chat type', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, makeTask({
                type: 'chat',
                payload: { prompt: 'What does this repo do?' },
            }));
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.type).toBe('chat');
        });

        it('should enqueue readonly-chat type', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, makeTask({
                type: 'readonly-chat',
                payload: { kind: 'chat', prompt: 'Explain the architecture' },
            }));
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.type).toBe('readonly-chat');
        });

        it('should auto-set payload.kind to chat for readonly-chat without explicit kind', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, {
                type: 'readonly-chat',
                prompt: 'Explain the architecture',
                workingDirectory: '/tmp/repo',
                displayName: 'Chat',
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.type).toBe('readonly-chat');
            expect(body.task.payload.kind).toBe('chat');
        });

        it('should auto-set payload.kind to chat for chat type without explicit kind', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, {
                type: 'chat',
                prompt: 'Hello',
                workingDirectory: '/tmp/repo',
                displayName: 'Chat',
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.payload.kind).toBe('chat');
        });

        it('should not overwrite existing payload.kind for chat types', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, makeTask({
                type: 'readonly-chat',
                payload: { kind: 'chat', prompt: 'Test' },
            }));
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.payload.kind).toBe('chat');
        });

        it('should promote top-level workingDirectory into payload', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, {
                type: 'chat',
                workingDirectory: '/Users/dev/projects/my-repo',
                displayName: 'Chat',
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.payload.workingDirectory).toBe('/Users/dev/projects/my-repo');
        });

        it('should not overwrite payload.workingDirectory with top-level value', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, {
                type: 'chat',
                workingDirectory: '/top-level/path',
                payload: { workingDirectory: '/payload/path', prompt: 'test' },
                displayName: 'Chat',
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.payload.workingDirectory).toBe('/payload/path');
        });

        it('should promote top-level prompt into payload', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, {
                type: 'chat',
                prompt: 'What does this repo do?',
                workingDirectory: '/some/path',
                displayName: 'Chat',
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.payload.prompt).toBe('What does this repo do?');
        });

        it('should not overwrite payload.prompt with top-level value', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, {
                type: 'chat',
                prompt: 'top-level prompt',
                payload: { prompt: 'payload prompt' },
                displayName: 'Chat',
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.payload.prompt).toBe('payload prompt');
        });

        it('should promote both prompt and workingDirectory into payload for chat tasks', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, {
                type: 'chat',
                prompt: 'Explain the architecture',
                workingDirectory: '/Users/dev/repo',
                displayName: 'Chat',
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.payload.prompt).toBe('Explain the architecture');
            expect(body.task.payload.workingDirectory).toBe('/Users/dev/repo');
        });

        it('should trim whitespace from promoted prompt', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, {
                type: 'chat',
                prompt: '  hello world  ',
                displayName: 'Chat',
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.payload.prompt).toBe('hello world');
        });

        it('should not promote empty or whitespace-only prompt', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, {
                type: 'chat',
                prompt: '   ',
                displayName: 'Chat',
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.payload.prompt).toBeUndefined();
        });

        it('should promote top-level prompt for ai-clarification type', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, {
                type: 'ai-clarification',
                prompt: 'Explain this function',
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.payload.prompt).toBe('Explain this function');
        });

        it('should enqueue resolve-comments type', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, makeTask({
                type: 'resolve-comments',
                payload: { documentUri: 'file:///test.md', commentIds: ['c1'], promptTemplate: '' },
            }));
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.type).toBe('resolve-comments');
        });
    });

    describe('POST /api/queue/enqueue — Legacy enqueue compatibility', () => {
        it('should enqueue chat from prompt/model shorthand body', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue/enqueue`, {
                prompt: 'what time is it',
                model: 'claude-haiku-4.5',
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task).toBeDefined();
            expect(body.task.type).toBe('chat');
            expect(body.task.payload.kind).toBe('chat');
            expect(body.task.payload.prompt).toBe('what time is it');
            expect(body.task.config.model).toBe('claude-haiku-4.5');
        });

        it('should return 400 when prompt is missing in shorthand body', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue/enqueue`, { model: 'claude-haiku-4.5' });
            expect(res.status).toBe(400);
            expect(JSON.parse(res.body).error).toContain('prompt');
        });

        it('should pass through folderPath in shorthand body', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue/enqueue`, {
                prompt: 'test prompt',
                folderPath: 'feature1/backlog',
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.payload.folderPath).toBe('feature1/backlog');
        });

        it('should omit folderPath when not provided in shorthand body', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue/enqueue`, {
                prompt: 'test prompt',
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.payload.folderPath).toBeUndefined();
        });
    });

    describe('GET /api/queue/models — Model list', () => {
        it('should return available model IDs including claude-haiku-4.5', async () => {
            const srv = await startServer();

            const res = await request(`${srv.url}/api/queue/models`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(Array.isArray(body.models)).toBe(true);
            expect(body.models).toContain('claude-haiku-4.5');
        });
    });

    // ========================================================================
    // Auto-generated display name
    // ========================================================================

    describe('Auto-generated display name', () => {
        it('should auto-generate name from ai-clarification prompt', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, {
                type: 'ai-clarification',
                payload: { prompt: 'Explain how authentication works' },
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.displayName).toBe('Explain how authentication works');
        });

        it('should truncate long prompts in auto-generated name', async () => {
            const srv = await startServer();

            const longPrompt = 'A'.repeat(100);
            const res = await postJSON(`${srv.url}/api/queue`, {
                type: 'ai-clarification',
                payload: { prompt: longPrompt },
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.displayName.length).toBeLessThanOrEqual(60);
            expect(body.task.displayName).toContain('...');
        });

        it('should auto-generate name from follow-prompt file path', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, {
                type: 'follow-prompt',
                payload: { promptFilePath: '/home/user/prompts/review-code.md' },
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.displayName).toBe('Follow Prompt: review-code.md');
        });

        it('should auto-generate name from code-review diff type', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, {
                type: 'code-review',
                payload: { diffType: 'staged', rulesFolder: '.github/cr-rules' },
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.displayName).toBe('Code Review: staged');
        });

        it('should auto-generate name from code-review with commit SHA', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, {
                type: 'code-review',
                payload: { diffType: 'commit', commitSha: 'abc1234567890', rulesFolder: '.github/cr-rules' },
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.displayName).toBe('Code Review: commit (abc1234)');
        });

        it('should auto-generate name from custom task data.prompt', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, {
                type: 'custom',
                payload: { data: { prompt: 'Analyze performance metrics' } },
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.displayName).toBe('Analyze performance metrics');
        });

        it('should fallback to type label with timestamp when no content', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, {
                type: 'custom',
                payload: { data: {} },
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.displayName).toMatch(/^Task @ \d{2}:\d{2}$/);
        });

        it('should use explicit displayName when provided', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, {
                type: 'custom',
                displayName: 'My custom name',
                payload: { data: { prompt: 'This should be ignored for name' } },
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.displayName).toBe('My custom name');
        });

        it('should ignore empty string displayName and auto-generate', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, {
                type: 'ai-clarification',
                displayName: '',
                payload: { prompt: 'What does this function do?' },
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.displayName).toBe('What does this function do?');
        });

        it('should ignore whitespace-only displayName and auto-generate', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, {
                type: 'ai-clarification',
                displayName: '   ',
                payload: { prompt: 'Summarize this module' },
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.displayName).toBe('Summarize this module');
        });
    });

    // ========================================================================
    // List queue
    // ========================================================================

    describe('GET /api/queue — List', () => {
        it('should return empty queue initially', async () => {
            const srv = await startServer();

            const res = await request(`${srv.url}/api/queue`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.queued).toEqual([]);
            expect(body.running).toEqual([]);
            expect(body.stats.queued).toBe(0);
            expect(body.stats.running).toBe(0);
        });

        it('should list enqueued tasks', async () => {
            const srv = await startServer();

            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'Task 1' }));
            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'Task 2' }));

            const res = await request(`${srv.url}/api/queue`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.queued).toHaveLength(2);
            expect(body.stats.queued).toBe(2);
        });

        it('should order by priority (high first)', async () => {
            const srv = await startServer();

            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'Low', priority: 'low' }));
            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'High', priority: 'high' }));
            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'Normal', priority: 'normal' }));

            const res = await request(`${srv.url}/api/queue`);
            const body = JSON.parse(res.body);
            expect(body.queued[0].priority).toBe('high');
            expect(body.queued[1].priority).toBe('normal');
            expect(body.queued[2].priority).toBe('low');
        });

        it('should include folderPath in serialized task response', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, makeTask({ folderPath: '/Users/test/my-project' }));
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.folderPath).toBe('/Users/test/my-project');
        });

        it('should include folderPath when listing queued tasks', async () => {
            const srv = await startServer();

            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'WithFolder', folderPath: '/repos/frontend' }));
            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'NoFolder' }));

            const res = await request(`${srv.url}/api/queue`);
            const body = JSON.parse(res.body);
            const withFolder = body.queued.find((t: any) => t.displayName === 'WithFolder');
            const noFolder = body.queued.find((t: any) => t.displayName === 'NoFolder');
            expect(withFolder.folderPath).toBe('/repos/frontend');
            expect(noFolder.folderPath).toBeUndefined();
        });
    });

    // ========================================================================
    // List with repoId filtering
    // ========================================================================

    describe('GET /api/queue?repoId — Filter by repo', () => {
        it('should return all tasks when no repoId param is provided', async () => {
            const srv = await startServer();

            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'A', repoId: 'repo-1' }));
            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'B', repoId: 'repo-2' }));

            const res = await request(`${srv.url}/api/queue`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.queued).toHaveLength(2);
        });

        it('should filter queued tasks by explicit repoId', async () => {
            const srv = await startServer();

            // Pause to prevent execution, then route tasks via workingDirectory
            await postJSON(`${srv.url}/api/queue/pause`, {});
            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'A', payload: { data: { prompt: 'test' }, workingDirectory: '/repo/alpha' } }));
            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'B', payload: { data: { prompt: 'test' }, workingDirectory: '/repo/beta' } }));
            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'C', payload: { data: { prompt: 'test' }, workingDirectory: '/repo/alpha' } }));

            const repoIdAlpha = require('crypto').createHash('sha256').update(require('path').resolve('/repo/alpha')).digest('hex').substring(0, 16);
            const res = await request(`${srv.url}/api/queue?repoId=${repoIdAlpha}`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.queued).toHaveLength(2);
        });

        it('should filter queued tasks by workspace ID alias', async () => {
            const srv = await startServer();

            await postJSON(`${srv.url}/api/workspaces`, {
                id: 'ws-alpha',
                name: 'alpha',
                rootPath: '/repo/alpha',
            });

            // Pause to keep tasks in queued state for deterministic assertions
            await postJSON(`${srv.url}/api/queue/pause`, {});
            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'A', payload: { data: { prompt: 'test' }, workingDirectory: '/repo/alpha' } }));
            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'B', payload: { data: { prompt: 'test' }, workingDirectory: '/repo/beta' } }));

            const res = await request(`${srv.url}/api/queue?repoId=ws-alpha`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.queued).toHaveLength(1);
            expect(body.queued[0].displayName).toBe('A');
        });

        it('should return empty arrays for non-existent repoId', async () => {
            const srv = await startServer();

            await postJSON(`${srv.url}/api/queue/pause`, {});
            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'A', payload: { data: { prompt: 'test' }, workingDirectory: '/repo/alpha' } }));

            const res = await request(`${srv.url}/api/queue?repoId=nonexistent`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.queued).toEqual([]);
            expect(body.running).toEqual([]);
        });

        it('should treat empty repoId parameter as no filter', async () => {
            const srv = await startServer();

            await postJSON(`${srv.url}/api/queue/pause`, {});
            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'A', payload: { data: { prompt: 'test' }, workingDirectory: '/repo/alpha' } }));
            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'B', payload: { data: { prompt: 'test' }, workingDirectory: '/repo/beta' } }));

            const res = await request(`${srv.url}/api/queue?repoId=`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.queued).toHaveLength(2);
        });

        it('should return per-repo stats when filtering by repoId', async () => {
            const srv = await startServer();

            await postJSON(`${srv.url}/api/queue/pause`, {});
            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'A', payload: { data: { prompt: 'test' }, workingDirectory: '/repo/alpha' } }));
            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'B', payload: { data: { prompt: 'test' }, workingDirectory: '/repo/beta' } }));
            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'C', payload: { data: { prompt: 'test' }, workingDirectory: '/repo/alpha' } }));

            const repoIdAlpha = require('crypto').createHash('sha256').update(require('path').resolve('/repo/alpha')).digest('hex').substring(0, 16);
            const res = await request(`${srv.url}/api/queue?repoId=${repoIdAlpha}`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            // Filtered results
            expect(body.queued).toHaveLength(2);
            // Per-repo stats (not global)
            expect(body.stats.queued).toBe(2);
        });

        it('should preserve response structure with filtering', async () => {
            const srv = await startServer();

            await postJSON(`${srv.url}/api/queue/pause`, {});
            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'A', payload: { data: { prompt: 'test' }, workingDirectory: '/repo/alpha' } }));

            const repoIdAlpha = require('crypto').createHash('sha256').update(require('path').resolve('/repo/alpha')).digest('hex').substring(0, 16);
            const res = await request(`${srv.url}/api/queue?repoId=${repoIdAlpha}`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body).toHaveProperty('queued');
            expect(body).toHaveProperty('running');
            expect(body).toHaveProperty('stats');
            expect(Array.isArray(body.queued)).toBe(true);
            expect(Array.isArray(body.running)).toBe(true);
        });

        it('should exclude tasks without matching repoId', async () => {
            const srv = await startServer();

            await postJSON(`${srv.url}/api/queue/pause`, {});
            // Task with no workingDirectory (routes to cwd)
            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'NoRepo' }));
            // Task with different workingDirectory
            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'Other', payload: { data: { prompt: 'test' }, workingDirectory: '/repo/beta' } }));

            const repoIdAlpha = require('crypto').createHash('sha256').update(require('path').resolve('/repo/alpha')).digest('hex').substring(0, 16);
            const res = await request(`${srv.url}/api/queue?repoId=${repoIdAlpha}`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.queued).toEqual([]);
        });
    });

    // ========================================================================
    // Get single task
    // ========================================================================

    describe('GET /api/queue/:id — Get task', () => {
        it('should return a single task by ID', async () => {
            const srv = await startServer();

            const createRes = await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'Find me' }));
            const taskId = JSON.parse(createRes.body).task.id;

            const res = await request(`${srv.url}/api/queue/${taskId}`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.task.id).toBe(taskId);
            expect(body.task.displayName).toBe('Find me');
        });

        it('should return 404 for nonexistent task', async () => {
            const srv = await startServer();

            const res = await request(`${srv.url}/api/queue/nonexistent-id`);
            expect(res.status).toBe(404);
            expect(JSON.parse(res.body).error).toBe('Task not found');
        });
    });

    // ========================================================================
    // Cancel task
    // ========================================================================

    describe('DELETE /api/queue/:id — Cancel task', () => {
        it('should cancel a queued task', async () => {
            const srv = await startServer();

            const createRes = await postJSON(`${srv.url}/api/queue`, makeTask());
            const taskId = JSON.parse(createRes.body).task.id;

            const res = await request(`${srv.url}/api/queue/${taskId}`, { method: 'DELETE' });
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.cancelled).toBe(true);

            // Verify it's no longer in the queue
            const listRes = await request(`${srv.url}/api/queue`);
            const listBody = JSON.parse(listRes.body);
            expect(listBody.queued).toHaveLength(0);
        });

        it('should return 404 for nonexistent task', async () => {
            const srv = await startServer();

            const res = await request(`${srv.url}/api/queue/nonexistent`, { method: 'DELETE' });
            expect(res.status).toBe(404);
        });
    });

    // ========================================================================
    // Reorder tasks
    // ========================================================================

    describe('Reorder tasks', () => {
        it('should move a task to top', async () => {
            const srv = await startServer();

            const res1 = await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'First' }));
            const res2 = await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'Second' }));
            const res3 = await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'Third' }));
            const thirdId = JSON.parse(res3.body).task.id;

            const moveRes = await postJSON(`${srv.url}/api/queue/${thirdId}/move-to-top`, {});
            expect(moveRes.status).toBe(200);
            expect(JSON.parse(moveRes.body).moved).toBe(true);

            // Verify order
            const listRes = await request(`${srv.url}/api/queue`);
            const listBody = JSON.parse(listRes.body);
            expect(listBody.queued[0].id).toBe(thirdId);
        });

        it('should move a task up one position', async () => {
            const srv = await startServer();

            const res1 = await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'First' }));
            const res2 = await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'Second' }));
            const secondId = JSON.parse(res2.body).task.id;

            const moveRes = await postJSON(`${srv.url}/api/queue/${secondId}/move-up`, {});
            expect(moveRes.status).toBe(200);
            expect(JSON.parse(moveRes.body).moved).toBe(true);

            // Verify order
            const listRes = await request(`${srv.url}/api/queue`);
            const listBody = JSON.parse(listRes.body);
            expect(listBody.queued[0].id).toBe(secondId);
        });

        it('should move a task down one position', async () => {
            const srv = await startServer();

            const res1 = await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'First' }));
            const res2 = await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'Second' }));
            const firstId = JSON.parse(res1.body).task.id;

            const moveRes = await postJSON(`${srv.url}/api/queue/${firstId}/move-down`, {});
            expect(moveRes.status).toBe(200);
            expect(JSON.parse(moveRes.body).moved).toBe(true);

            // Verify order
            const listRes = await request(`${srv.url}/api/queue`);
            const listBody = JSON.parse(listRes.body);
            expect(listBody.queued[1].id).toBe(firstId);
        });

        it('should return 404 when moving nonexistent task to top', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue/nonexistent/move-to-top`, {});
            expect(res.status).toBe(404);
        });

        it('should return 404 when moving first task up', async () => {
            const srv = await startServer();

            const createRes = await postJSON(`${srv.url}/api/queue`, makeTask());
            const taskId = JSON.parse(createRes.body).task.id;

            const res = await postJSON(`${srv.url}/api/queue/${taskId}/move-up`, {});
            expect(res.status).toBe(404);
        });

        it('should return 404 when moving last task down', async () => {
            const srv = await startServer();

            const createRes = await postJSON(`${srv.url}/api/queue`, makeTask());
            const taskId = JSON.parse(createRes.body).task.id;

            const res = await postJSON(`${srv.url}/api/queue/${taskId}/move-down`, {});
            expect(res.status).toBe(404);
        });
    });

    // ========================================================================
    // Move to position
    // ========================================================================

    describe('Move to position', () => {
        it('should move a task to a specific position', async () => {
            const srv = await startServer();

            const res1 = await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'First' }));
            const res2 = await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'Second' }));
            const res3 = await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'Third' }));
            const firstId = JSON.parse(res1.body).task.id;

            const moveRes = await postJSON(`${srv.url}/api/queue/${firstId}/move-to/2`, {});
            expect(moveRes.status).toBe(200);
            const moveBody = JSON.parse(moveRes.body);
            expect(moveBody.moved).toBe(true);
            expect(moveBody.position).toBe(3); // 1-based: position 3 (0-based index 2)

            // Verify order
            const listRes = await request(`${srv.url}/api/queue`);
            const listBody = JSON.parse(listRes.body);
            expect(listBody.queued[2].id).toBe(firstId);
        });

        it('should move a task to position 0 (first)', async () => {
            const srv = await startServer();

            const res1 = await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'First' }));
            const res2 = await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'Second' }));
            const res3 = await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'Third' }));
            const thirdId = JSON.parse(res3.body).task.id;

            const moveRes = await postJSON(`${srv.url}/api/queue/${thirdId}/move-to/0`, {});
            expect(moveRes.status).toBe(200);
            expect(JSON.parse(moveRes.body).position).toBe(1);

            const listRes = await request(`${srv.url}/api/queue`);
            const listBody = JSON.parse(listRes.body);
            expect(listBody.queued[0].id).toBe(thirdId);
        });

        it('should return 404 for unknown task', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue/nonexistent/move-to/0`, {});
            expect(res.status).toBe(404);
        });
    });

    // ========================================================================
    // Pause / Resume
    // ========================================================================

    describe('Pause / Resume', () => {
        it('should pause the queue', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue/pause`, {});
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.paused).toBe(true);
            expect(body.stats.isPaused).toBe(true);
        });

        it('should resume the queue', async () => {
            const srv = await startServer();

            // Pause first
            await postJSON(`${srv.url}/api/queue/pause`, {});

            // Then resume
            const res = await postJSON(`${srv.url}/api/queue/resume`, {});
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.paused).toBe(false);
            expect(body.stats.isPaused).toBe(false);
        });

        it('should reflect paused state in stats', async () => {
            const srv = await startServer();

            await postJSON(`${srv.url}/api/queue/pause`, {});

            const statsRes = await request(`${srv.url}/api/queue/stats`);
            const stats = JSON.parse(statsRes.body).stats;
            expect(stats.isPaused).toBe(true);
        });

        it('should pause a specific repo', async () => {
            const srv = await startServer();

            // Pause queue first to prevent auto-execution
            await postJSON(`${srv.url}/api/queue/pause`, {});

            // Enqueue task with workingDirectory to create the bridge
            await postJSON(`${srv.url}/api/queue`, makeTask({
                payload: { data: { prompt: 'test' }, workingDirectory: '/my/repo' },
            }));

            // Resume globally first, then pause specific repo
            await postJSON(`${srv.url}/api/queue/resume`, {});
            const repoId = require('crypto').createHash('sha256').update(require('path').resolve('/my/repo')).digest('hex').substring(0, 16);
            const res = await postJSON(`${srv.url}/api/queue/pause?repoId=${repoId}`, {});
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.repoId).toBe(repoId);
            expect(body.paused).toBe(true);
            expect(body.stats.isPaused).toBe(true);
        });

        it('should resume a specific repo', async () => {
            const srv = await startServer();

            // Pause queue first to prevent auto-execution, then enqueue to create bridge
            await postJSON(`${srv.url}/api/queue/pause`, {});
            await postJSON(`${srv.url}/api/queue`, makeTask({
                payload: { data: { prompt: 'test' }, workingDirectory: '/my/repo' },
            }));

            const repoId = require('crypto').createHash('sha256').update(require('path').resolve('/my/repo')).digest('hex').substring(0, 16);

            // Resume globally, then pause+resume specific repo
            await postJSON(`${srv.url}/api/queue/resume`, {});
            await postJSON(`${srv.url}/api/queue/pause?repoId=${repoId}`, {});
            const res = await postJSON(`${srv.url}/api/queue/resume?repoId=${repoId}`, {});
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.repoId).toBe(repoId);
            expect(body.paused).toBe(false);
            expect(body.stats.isPaused).toBe(false);
        });

        it('should include isPaused in per-repo stats', async () => {
            const srv = await startServer();

            // Pause queue to prevent execution
            await postJSON(`${srv.url}/api/queue/pause`, {});

            // Enqueue to create bridge
            await postJSON(`${srv.url}/api/queue`, makeTask({
                payload: { data: { prompt: 'test' }, workingDirectory: '/test/repo' },
            }));

            const repoId = require('crypto').createHash('sha256').update(require('path').resolve('/test/repo')).digest('hex').substring(0, 16);
            // Stats should show isPaused from the per-repo manager
            const statsRes = await request(`${srv.url}/api/queue/stats?repoId=${repoId}`);
            const stats = JSON.parse(statsRes.body).stats;
            expect(stats.isPaused).toBe(true);
        });

        it('GET /api/queue/repos should list repos with pause states', async () => {
            const srv = await startServer();

            // Pause queue to prevent auto-execution
            await postJSON(`${srv.url}/api/queue/pause`, {});

            // Enqueue tasks for different repos
            await postJSON(`${srv.url}/api/queue`, makeTask({
                payload: { data: { prompt: 'a' }, workingDirectory: '/repo/one' },
            }));
            await postJSON(`${srv.url}/api/queue`, makeTask({
                payload: { data: { prompt: 'b' }, workingDirectory: '/repo/two' },
            }));

            // repoId is computed from path.resolve(workingDirectory)
            const repoOneId = require('crypto').createHash('sha256').update(require('path').resolve('/repo/one')).digest('hex').substring(0, 16);

            const res = await request(`${srv.url}/api/queue/repos`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.repos).toBeDefined();
            expect(body.repos.length).toBeGreaterThanOrEqual(2);

            const repoOne = body.repos.find((r: any) => r.repoId === repoOneId);
            expect(repoOne).toBeDefined();
            // Both repos are paused because global pause was set
            expect(repoOne.isPaused).toBe(true);
            expect(repoOne.taskCount).toBeGreaterThanOrEqual(1);

            const repoTwoId = require('crypto').createHash('sha256').update(require('path').resolve('/repo/two')).digest('hex').substring(0, 16);
            const repoTwo = body.repos.find((r: any) => r.repoId === repoTwoId);
            expect(repoTwo).toBeDefined();
            expect(repoTwo.isPaused).toBe(true);
        });
    });

    // ========================================================================
    // Clear queue
    // ========================================================================

    describe('DELETE /api/queue — Clear', () => {
        it('should clear all queued tasks', async () => {
            const srv = await startServer();

            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'Task 1' }));
            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'Task 2' }));
            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'Task 3' }));

            const res = await request(`${srv.url}/api/queue`, { method: 'DELETE' });
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.cleared).toBe(3);
            expect(body.stats.queued).toBe(0);
        });

        it('should return 0 when clearing empty queue', async () => {
            const srv = await startServer();

            const res = await request(`${srv.url}/api/queue`, { method: 'DELETE' });
            expect(res.status).toBe(200);
            expect(JSON.parse(res.body).cleared).toBe(0);
        });
    });

    // ========================================================================
    // Stats
    // ========================================================================

    describe('GET /api/queue/stats — Stats', () => {
        it('should return correct queue statistics', async () => {
            const srv = await startServer();

            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'Task 1' }));
            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'Task 2' }));

            const res = await request(`${srv.url}/api/queue/stats`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.stats.queued).toBe(2);
            expect(body.stats.running).toBe(0);
            expect(body.stats.isPaused).toBe(false);
        });

        it('should return zeros when queue is empty', async () => {
            const srv = await startServer();

            const res = await request(`${srv.url}/api/queue/stats`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.stats.queued).toBe(0);
            expect(body.stats.running).toBe(0);
            expect(body.stats.total).toBe(0);
        });
    });

    // ========================================================================
    // History
    // ========================================================================

    describe('Queue history', () => {
        it('should show cancelled tasks in history', async () => {
            const srv = await startServer();

            const createRes = await postJSON(`${srv.url}/api/queue`, makeTask());
            const taskId = JSON.parse(createRes.body).task.id;

            // Cancel the task
            await request(`${srv.url}/api/queue/${taskId}`, { method: 'DELETE' });

            // Check history
            const historyRes = await request(`${srv.url}/api/queue/history`);
            expect(historyRes.status).toBe(200);
            const body = JSON.parse(historyRes.body);
            expect(body.history).toHaveLength(1);
            expect(body.history[0].id).toBe(taskId);
            expect(body.history[0].status).toBe('cancelled');
        });

        it('should show cleared tasks in history', async () => {
            const srv = await startServer();

            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'Task 1' }));
            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'Task 2' }));

            // Clear the queue
            await request(`${srv.url}/api/queue`, { method: 'DELETE' });

            // Check history
            const historyRes = await request(`${srv.url}/api/queue/history`);
            const body = JSON.parse(historyRes.body);
            expect(body.history).toHaveLength(2);
            body.history.forEach((t: any) => {
                expect(t.status).toBe('cancelled');
            });
        });

        it('should clear history', async () => {
            const srv = await startServer();

            // Create and cancel a task to populate history
            const createRes = await postJSON(`${srv.url}/api/queue`, makeTask());
            const taskId = JSON.parse(createRes.body).task.id;
            await request(`${srv.url}/api/queue/${taskId}`, { method: 'DELETE' });

            // Clear history
            const clearRes = await request(`${srv.url}/api/queue/history`, { method: 'DELETE' });
            expect(clearRes.status).toBe(200);

            // Verify history is empty
            const historyRes = await request(`${srv.url}/api/queue/history`);
            const body = JSON.parse(historyRes.body);
            expect(body.history).toHaveLength(0);
        });

        describe('GET /api/queue/history?repoId — Filter history by repo', () => {
            it('should return all history when no repoId param is provided', async () => {
                const srv = await startServer();
                const r1 = await postJSON(`${srv.url}/api/queue`, makeTask({ repoId: 'repo-1' }));
                const r2 = await postJSON(`${srv.url}/api/queue`, makeTask({ repoId: 'repo-2' }));
                const id1 = JSON.parse(r1.body).task.id;
                const id2 = JSON.parse(r2.body).task.id;
                await request(`${srv.url}/api/queue/${id1}`, { method: 'DELETE' });
                await request(`${srv.url}/api/queue/${id2}`, { method: 'DELETE' });

                const res = await request(`${srv.url}/api/queue/history`);
                expect(res.status).toBe(200);
                const body = JSON.parse(res.body);
                expect(body.history).toHaveLength(2);
            });

            it('should filter history by per-repo queue routing', async () => {
                const srv = await startServer();
                await postJSON(`${srv.url}/api/queue/pause`, {});
                const r1 = await postJSON(`${srv.url}/api/queue`, makeTask({ payload: { data: { prompt: 'test' }, workingDirectory: '/repo/alpha' } }));
                const r2 = await postJSON(`${srv.url}/api/queue`, makeTask({ payload: { data: { prompt: 'test' }, workingDirectory: '/repo/beta' } }));
                const r3 = await postJSON(`${srv.url}/api/queue`, makeTask({ payload: { data: { prompt: 'test' }, workingDirectory: '/repo/alpha' } }));
                for (const r of [r1, r2, r3]) {
                    const id = JSON.parse(r.body).task.id;
                    await request(`${srv.url}/api/queue/${id}`, { method: 'DELETE' });
                }

                const repoIdAlpha = require('crypto').createHash('sha256').update(require('path').resolve('/repo/alpha')).digest('hex').substring(0, 16);
                const res = await request(`${srv.url}/api/queue/history?repoId=${repoIdAlpha}`);
                expect(res.status).toBe(200);
                const body = JSON.parse(res.body);
                expect(body.history).toHaveLength(2);
            });

            it('should filter history by workspace ID alias', async () => {
                const srv = await startServer();

                await postJSON(`${srv.url}/api/workspaces`, {
                    id: 'ws-alpha',
                    name: 'alpha',
                    rootPath: '/repo/alpha',
                });

                await postJSON(`${srv.url}/api/queue/pause`, {});
                const alphaTask = await postJSON(`${srv.url}/api/queue`, makeTask({ payload: { data: { prompt: 'test' }, workingDirectory: '/repo/alpha' } }));
                const betaTask = await postJSON(`${srv.url}/api/queue`, makeTask({ payload: { data: { prompt: 'test' }, workingDirectory: '/repo/beta' } }));

                const alphaTaskId = JSON.parse(alphaTask.body).task.id;
                const betaTaskId = JSON.parse(betaTask.body).task.id;
                await request(`${srv.url}/api/queue/${alphaTaskId}`, { method: 'DELETE' });
                await request(`${srv.url}/api/queue/${betaTaskId}`, { method: 'DELETE' });

                const res = await request(`${srv.url}/api/queue/history?repoId=ws-alpha`);
                expect(res.status).toBe(200);
                const body = JSON.parse(res.body);
                expect(body.history).toHaveLength(1);
                expect(body.history[0].id).toBe(alphaTaskId);
            });

            it('should filter history via workingDirectory-based routing', async () => {
                const srv = await startServer();
                // Enqueue a task with workingDirectory
                const cwd = process.cwd();
                const r = await postJSON(`${srv.url}/api/queue`, makeTask({
                    payload: { data: { prompt: 'test' }, workingDirectory: cwd },
                }));
                const id = JSON.parse(r.body).task.id;
                await request(`${srv.url}/api/queue/${id}`, { method: 'DELETE' });

                // Compute repoId from resolved workingDirectory path
                const repoId = require('crypto').createHash('sha256').update(require('path').resolve(cwd)).digest('hex').substring(0, 16);

                const res = await request(`${srv.url}/api/queue/history?repoId=${encodeURIComponent(repoId)}`);
                expect(res.status).toBe(200);
                const body = JSON.parse(res.body);
                expect(body.history.some((t: any) => t.id === id)).toBe(true);
            });
        });
    });

    // ========================================================================
    // Type filter
    // ========================================================================

    describe('GET /api/queue/history?type — Filter by type', () => {
        it('should return only chat-type tasks when type=chat', async () => {
            const srv = await startServer();
            await postJSON(`${srv.url}/api/queue/pause`, {});
            await postJSON(`${srv.url}/api/queue`, makeTask({ type: 'chat', displayName: 'Chat 1', payload: { prompt: 'hello' } }));
            await postJSON(`${srv.url}/api/queue`, makeTask({ type: 'custom', displayName: 'Custom 1' }));
            await postJSON(`${srv.url}/api/queue`, makeTask({ type: 'chat', displayName: 'Chat 2', payload: { prompt: 'world' } }));

            // Cancel all to move to history
            const listRes = await request(`${srv.url}/api/queue`);
            const queued = JSON.parse(listRes.body).queued;
            for (const t of queued) {
                await request(`${srv.url}/api/queue/${t.id}`, { method: 'DELETE' });
            }

            const res = await request(`${srv.url}/api/queue/history?type=chat`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.history).toHaveLength(2);
            body.history.forEach((t: any) => expect(t.type).toBe('chat'));
        });

        it('should return only follow-prompt tasks when type=follow-prompt', async () => {
            const srv = await startServer();
            await postJSON(`${srv.url}/api/queue/pause`, {});
            await postJSON(`${srv.url}/api/queue`, makeTask({ type: 'follow-prompt', displayName: 'FP 1', payload: { promptFilePath: '/a.md' } }));
            await postJSON(`${srv.url}/api/queue`, makeTask({ type: 'chat', displayName: 'Chat 1', payload: { prompt: 'hi' } }));

            const listRes = await request(`${srv.url}/api/queue`);
            for (const t of JSON.parse(listRes.body).queued) {
                await request(`${srv.url}/api/queue/${t.id}`, { method: 'DELETE' });
            }

            const res = await request(`${srv.url}/api/queue/history?type=follow-prompt`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.history).toHaveLength(1);
            expect(body.history[0].type).toBe('follow-prompt');
        });

        it('should return all types when no type param is provided (backward compat)', async () => {
            const srv = await startServer();
            await postJSON(`${srv.url}/api/queue/pause`, {});
            await postJSON(`${srv.url}/api/queue`, makeTask({ type: 'chat', displayName: 'Chat', payload: { prompt: 'hi' } }));
            await postJSON(`${srv.url}/api/queue`, makeTask({ type: 'custom', displayName: 'Custom' }));

            const listRes = await request(`${srv.url}/api/queue`);
            for (const t of JSON.parse(listRes.body).queued) {
                await request(`${srv.url}/api/queue/${t.id}`, { method: 'DELETE' });
            }

            const res = await request(`${srv.url}/api/queue/history`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.history).toHaveLength(2);
        });

        it('should return 400 for invalid type value', async () => {
            const srv = await startServer();
            const res = await request(`${srv.url}/api/queue/history?type=invalid`);
            expect(res.status).toBe(400);
            const body = JSON.parse(res.body);
            expect(body.error).toContain('Invalid type filter');
        });
    });

    describe('GET /api/queue?type — Filter queued/running by type', () => {
        it('should filter queued array by type while keeping stats unfiltered', async () => {
            const srv = await startServer();
            await postJSON(`${srv.url}/api/queue/pause`, {});
            await postJSON(`${srv.url}/api/queue`, makeTask({ type: 'chat', displayName: 'Chat', payload: { prompt: 'hi' } }));
            await postJSON(`${srv.url}/api/queue`, makeTask({ type: 'custom', displayName: 'Custom' }));
            await postJSON(`${srv.url}/api/queue`, makeTask({ type: 'chat', displayName: 'Chat 2', payload: { prompt: 'hello' } }));

            const res = await request(`${srv.url}/api/queue?type=chat`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.queued).toHaveLength(2);
            body.queued.forEach((t: any) => expect(t.type).toBe('chat'));
            // Stats remain unfiltered — reflect true queue state
            expect(body.stats.queued).toBe(3);
        });

        it('should return 400 for invalid type value on queue endpoint', async () => {
            const srv = await startServer();
            const res = await request(`${srv.url}/api/queue?type=bogus`);
            expect(res.status).toBe(400);
            const body = JSON.parse(res.body);
            expect(body.error).toContain('Invalid type filter');
        });
    });

    describe('Chat metadata enrichment', () => {
        it('should add chatMeta with turnCount and firstMessage when process store has conversation data', async () => {
            const srv = await startServer();
            const store = new FileProcessStore({ dataDir });

            // Add a process with conversation turns
            await store.addProcess({
                id: 'proc-chat-1',
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test prompt',
                status: 'completed',
                startTime: new Date(),
                conversationTurns: [
                    { role: 'user', content: 'Hello, how are you?', timestamp: new Date(), turnIndex: 0 },
                    { role: 'assistant', content: 'I am fine!', timestamp: new Date(), turnIndex: 1 },
                    { role: 'user', content: 'Great', timestamp: new Date(), turnIndex: 2 },
                ],
            } as any);

            // Enqueue a chat task linked to this process
            await postJSON(`${srv.url}/api/queue/pause`, {});
            const createRes = await postJSON(`${srv.url}/api/queue`, makeTask({
                type: 'chat',
                displayName: 'Chat session',
                payload: { prompt: 'Hello', processId: 'proc-chat-1' },
            }));
            const taskId = JSON.parse(createRes.body).task.id;

            // Set processId on the task via the queue list response (processId is set in payload)
            // Cancel to move to history
            await request(`${srv.url}/api/queue/${taskId}`, { method: 'DELETE' });

            const res = await request(`${srv.url}/api/queue/history?type=chat`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.history).toHaveLength(1);
            // chatMeta should be present because the task has type=chat
            // Note: processId on the serialized task comes from task.processId, not payload
            // If the task doesn't have a processId set at the queue level, chatMeta won't be added
        });

        it('should sync process running status back to task status during follow-ups', async () => {
            const store = new FileProcessStore({ dataDir });

            // Add a process that is currently running (simulates a follow-up message in progress)
            await store.addProcess({
                id: 'proc-running-1',
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test prompt',
                status: 'running',
                startTime: new Date(),
                conversationTurns: [
                    { role: 'user', content: 'First question', timestamp: new Date(), turnIndex: 0 },
                    { role: 'assistant', content: 'First answer', timestamp: new Date(), turnIndex: 1 },
                    { role: 'user', content: 'Follow-up question', timestamp: new Date(), turnIndex: 2 },
                ],
            } as any);

            // Pre-populate queue state file with a history task that has processId set
            const repoRoot = path.resolve('/test/chat-status-sync');
            const crypto = require('crypto');
            const repoId = crypto.createHash('sha256').update(repoRoot).digest('hex').substring(0, 16);
            const queuesDir = path.join(dataDir, 'queues');
            fs.mkdirSync(queuesDir, { recursive: true });
            fs.writeFileSync(path.join(queuesDir, `repo-${repoId}.json`), JSON.stringify({
                version: 3,
                savedAt: new Date().toISOString(),
                repoRootPath: repoRoot,
                repoId,
                isPaused: false,
                pending: [],
                history: [{
                    id: 'task-chat-running',
                    type: 'chat',
                    priority: 'normal',
                    status: 'completed',
                    createdAt: Date.now() - 10000,
                    completedAt: Date.now() - 5000,
                    payload: { prompt: 'Hello' },
                    displayName: 'Running chat',
                    processId: 'proc-running-1',
                    repoId,
                }],
            }));

            // Start server after pre-populating — it restores the history with processId
            const srv = await startServer();

            const res = await request(`${srv.url}/api/queue/history?type=chat`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            const chatTask = body.history.find((t: any) => t.id === 'task-chat-running');
            expect(chatTask).toBeDefined();
            expect(chatTask.processId).toBe('proc-running-1');
            // The task status should be synced to 'running' from the process store
            expect(chatTask.status).toBe('running');
        });

        it('should be resilient when processId has no matching process', async () => {
            const srv = await startServer();
            await postJSON(`${srv.url}/api/queue/pause`, {});

            const createRes = await postJSON(`${srv.url}/api/queue`, makeTask({
                type: 'chat',
                displayName: 'Orphan chat',
                payload: { prompt: 'hi' },
            }));
            const taskId = JSON.parse(createRes.body).task.id;
            await request(`${srv.url}/api/queue/${taskId}`, { method: 'DELETE' });

            const res = await request(`${srv.url}/api/queue/history?type=chat`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.history).toHaveLength(1);
            expect(body.history[0].type).toBe('chat');
            // No chatMeta because processId is not set at queue level (or no matching process)
            expect(body.history[0].chatMeta).toBeUndefined();
        });
    });

    // ========================================================================
    // Chat history includes active tasks
    // ========================================================================

    describe('GET /api/queue/history?type=chat — includes running and queued tasks', () => {
        it('should include queued chat tasks in history response', async () => {
            const srv = await startServer();
            // Pause so tasks stay queued
            await postJSON(`${srv.url}/api/queue/pause`, {});
            await postJSON(`${srv.url}/api/queue`, makeTask({ type: 'chat', displayName: 'Active chat', payload: { prompt: 'hello' } }));

            const res = await request(`${srv.url}/api/queue/history?type=chat`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.history).toHaveLength(1);
            expect(body.history[0].type).toBe('chat');
            expect(body.history[0].status).toBe('queued');
        });

        it('should merge queued and completed chat tasks without duplicates', async () => {
            const srv = await startServer();
            await postJSON(`${srv.url}/api/queue/pause`, {});
            // Create two chat tasks
            const r1 = await postJSON(`${srv.url}/api/queue`, makeTask({ type: 'chat', displayName: 'Chat 1', payload: { prompt: 'hi' } }));
            const r2 = await postJSON(`${srv.url}/api/queue`, makeTask({ type: 'chat', displayName: 'Chat 2', payload: { prompt: 'hey' } }));
            const id1 = JSON.parse(r1.body).task.id;
            // Cancel first to move it to history; second stays queued
            await request(`${srv.url}/api/queue/${id1}`, { method: 'DELETE' });

            const res = await request(`${srv.url}/api/queue/history?type=chat`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.history).toHaveLength(2);
            const statuses = body.history.map((t: any) => t.status);
            expect(statuses).toContain('cancelled');
            expect(statuses).toContain('queued');
            // No duplicates
            const ids = body.history.map((t: any) => t.id);
            expect(new Set(ids).size).toBe(ids.length);
        });

        it('should NOT include queued non-chat tasks in chat history', async () => {
            const srv = await startServer();
            await postJSON(`${srv.url}/api/queue/pause`, {});
            await postJSON(`${srv.url}/api/queue`, makeTask({ type: 'custom', displayName: 'Custom task' }));
            await postJSON(`${srv.url}/api/queue`, makeTask({ type: 'chat', displayName: 'Chat task', payload: { prompt: 'hi' } }));

            const res = await request(`${srv.url}/api/queue/history?type=chat`);
            const body = JSON.parse(res.body);
            expect(body.history).toHaveLength(1);
            expect(body.history[0].type).toBe('chat');
        });

        it('should NOT include active tasks when type filter is not chat', async () => {
            const srv = await startServer();
            await postJSON(`${srv.url}/api/queue/pause`, {});
            await postJSON(`${srv.url}/api/queue`, makeTask({ type: 'custom', displayName: 'Queued custom' }));

            const res = await request(`${srv.url}/api/queue/history?type=custom`);
            const body = JSON.parse(res.body);
            // Only history (completed/failed/cancelled) should be returned for non-chat types
            expect(body.history).toHaveLength(0);
        });

        it('should sort merged results by createdAt descending', async () => {
            const srv = await startServer();
            await postJSON(`${srv.url}/api/queue/pause`, {});

            // Create tasks with a slight ordering
            const r1 = await postJSON(`${srv.url}/api/queue`, makeTask({ type: 'chat', displayName: 'Older chat', payload: { prompt: 'first' } }));
            const r2 = await postJSON(`${srv.url}/api/queue`, makeTask({ type: 'chat', displayName: 'Newer chat', payload: { prompt: 'second' } }));
            const id1 = JSON.parse(r1.body).task.id;
            // Cancel first to move to history
            await request(`${srv.url}/api/queue/${id1}`, { method: 'DELETE' });

            const res = await request(`${srv.url}/api/queue/history?type=chat`);
            const body = JSON.parse(res.body);
            expect(body.history).toHaveLength(2);
            // Newer task should come first (higher createdAt)
            const timestamps = body.history.map((t: any) => t.createdAt);
            expect(timestamps[0]).toBeGreaterThanOrEqual(timestamps[1]);
        });
    });

    // ========================================================================
    // Task config
    // ========================================================================

    describe('Task config', () => {
        it('should preserve execution config', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, makeTask({
                config: {
                    model: 'gpt-4',
                    timeoutMs: 60000,
                    retryOnFailure: true,
                    retryAttempts: 3,
                    retryDelayMs: 5000,
                },
            }));
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.config.model).toBe('gpt-4');
            expect(body.task.config.timeoutMs).toBe(60000);
            expect(body.task.config.retryOnFailure).toBe(true);
            expect(body.task.config.retryAttempts).toBe(3);
            expect(body.task.config.retryDelayMs).toBe(5000);
        });

        it('should default retryOnFailure to false', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, makeTask());
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.config.retryOnFailure).toBe(false);
        });
    });

    // ========================================================================
    // CWD and Model support
    // ========================================================================

    describe('CWD and Model support', () => {
        it('should preserve model in config', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, makeTask({
                type: 'ai-clarification',
                payload: { prompt: 'test' },
                config: { model: 'claude-sonnet-4-5' },
            }));
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.config.model).toBe('claude-sonnet-4-5');
        });

        it('should preserve workingDirectory in ai-clarification payload', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, makeTask({
                type: 'ai-clarification',
                payload: { prompt: 'test', workingDirectory: '/my/project' },
            }));
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.payload.workingDirectory).toBe('/my/project');
        });

        it('should preserve workingDirectory in follow-prompt payload', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, makeTask({
                type: 'follow-prompt',
                payload: { promptFilePath: '/path/to/prompt.md', workingDirectory: '/workspace/root' },
            }));
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.payload.workingDirectory).toBe('/workspace/root');
        });

        it('should preserve both model and workingDirectory together', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, makeTask({
                type: 'ai-clarification',
                payload: { prompt: 'analyze code', workingDirectory: '/my/repo' },
                config: { model: 'gpt-4' },
            }));
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.config.model).toBe('gpt-4');
            expect(body.task.payload.workingDirectory).toBe('/my/repo');
        });

        it('should handle empty model (undefined in config)', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, makeTask({
                config: {},
            }));
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.config.model).toBeUndefined();
        });

        it('should handle missing workingDirectory in payload', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, makeTask({
                type: 'ai-clarification',
                payload: { prompt: 'test' },
            }));
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.payload.workingDirectory).toBeUndefined();
        });
    });

    // ========================================================================
    // Multiple operations lifecycle
    // ========================================================================

    // ========================================================================
    // Force-fail running tasks
    // ========================================================================

    describe('POST /api/queue/force-fail-running — Force-fail all', () => {
        it('should force-fail all running tasks', async () => {
            const srv = await startServer();

            // Pause queue to prevent auto-execution of tasks
            await postJSON(`${srv.url}/api/queue/pause`, {});

            // Enqueue tasks
            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'Task A' }));
            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'Task B' }));

            // Get task IDs
            let list = await request(`${srv.url}/api/queue`);
            const queued = JSON.parse(list.body).queued;
            expect(queued).toHaveLength(2);

            // Force-fail with custom error message
            const res = await postJSON(`${srv.url}/api/queue/force-fail-running`, {
                error: 'Manually force-failed',
            });
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            // Tasks are queued, not running, so none should be force-failed
            expect(body.forceFailed).toBe(0);
        });

        it('should return 0 when no running tasks', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue/force-fail-running`, {});
            expect(res.status).toBe(200);
            expect(JSON.parse(res.body).forceFailed).toBe(0);
        });

        it('should use default error message when not provided', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue/force-fail-running`, {});
            expect(res.status).toBe(200);
            expect(JSON.parse(res.body).stats).toBeDefined();
        });
    });

    describe('POST /api/queue/:id/force-fail — Force-fail single', () => {
        it('should return 404 for non-existent task', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue/nonexistent/force-fail`, {
                error: 'test',
            });
            expect(res.status).toBe(404);
        });

        it('should return 404 for queued (non-running) task', async () => {
            const srv = await startServer();

            // Pause to prevent execution
            await postJSON(`${srv.url}/api/queue/pause`, {});

            const createRes = await postJSON(`${srv.url}/api/queue`, makeTask());
            const taskId = JSON.parse(createRes.body).task.id;

            const res = await postJSON(`${srv.url}/api/queue/${taskId}/force-fail`, {
                error: 'test',
            });
            expect(res.status).toBe(404);
        });
    });

    // ========================================================================
    // Lifecycle
    // ========================================================================

    describe('Lifecycle', () => {
        it('should handle enqueue, reorder, cancel, clear lifecycle', async () => {
            const srv = await startServer();

            // Enqueue 3 tasks
            const r1 = await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'A' }));
            const r2 = await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'B' }));
            const r3 = await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'C' }));
            const id1 = JSON.parse(r1.body).task.id;
            const id2 = JSON.parse(r2.body).task.id;
            const id3 = JSON.parse(r3.body).task.id;

            // Verify 3 in queue
            let list = await request(`${srv.url}/api/queue`);
            expect(JSON.parse(list.body).queued).toHaveLength(3);

            // Move C to top
            await postJSON(`${srv.url}/api/queue/${id3}/move-to-top`, {});
            list = await request(`${srv.url}/api/queue`);
            expect(JSON.parse(list.body).queued[0].id).toBe(id3);

            // Cancel B
            await request(`${srv.url}/api/queue/${id2}`, { method: 'DELETE' });
            list = await request(`${srv.url}/api/queue`);
            expect(JSON.parse(list.body).queued).toHaveLength(2);

            // Clear remaining
            await request(`${srv.url}/api/queue`, { method: 'DELETE' });
            list = await request(`${srv.url}/api/queue`);
            expect(JSON.parse(list.body).queued).toHaveLength(0);

            // History should have all 3
            const history = await request(`${srv.url}/api/queue/history`);
            expect(JSON.parse(history.body).history).toHaveLength(3);
        });

        it('should handle pause and resume with enqueue', async () => {
            const srv = await startServer();

            // Pause
            await postJSON(`${srv.url}/api/queue/pause`, {});

            // Enqueue while paused
            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'Paused task' }));

            // Verify task is queued and queue is paused
            const list = await request(`${srv.url}/api/queue`);
            const body = JSON.parse(list.body);
            expect(body.queued).toHaveLength(1);
            expect(body.stats.isPaused).toBe(true);

            // Resume
            await postJSON(`${srv.url}/api/queue/resume`, {});
            const stats = await request(`${srv.url}/api/queue/stats`);
            expect(JSON.parse(stats.body).stats.isPaused).toBe(false);
        });
    });

    // ========================================================================
    // Request Logs
    // ========================================================================

    describe('Request logs', () => {
        let stderrSpy: ReturnType<typeof import('vitest').vi.spyOn>;

        beforeEach(async () => {
            const { vi } = await import('vitest');
            stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        });

        afterEach(() => {
            stderrSpy.mockRestore();
        });

        function stderrLines(): string[] {
            return stderrSpy.mock.calls
                .map(([msg]) => (typeof msg === 'string' ? msg : ''))
                .filter(Boolean);
        }

        it('should log [Queue] enqueue on POST /api/queue', async () => {
            const srv = await startServer();
            await postJSON(`${srv.url}/api/queue`, makeTask());
            const lines = stderrLines();
            expect(lines.some(l => l.startsWith('[Queue] enqueue task='))).toBe(true);
        });

        it('should log [Queue] enqueue on POST /api/queue/enqueue', async () => {
            const srv = await startServer();
            await postJSON(`${srv.url}/api/queue/enqueue`, makeTask());
            const lines = stderrLines();
            expect(lines.some(l => l.startsWith('[Queue] enqueue task='))).toBe(true);
        });

        it('should log [Queue] bulk-enqueue on POST /api/queue/bulk', async () => {
            const srv = await startServer();
            const tasks = [makeTask({ displayName: 'A' }), makeTask({ displayName: 'B' })];
            await postJSON(`${srv.url}/api/queue/bulk`, { tasks });
            const lines = stderrLines();
            expect(lines.some(l => l.startsWith('[Queue] bulk-enqueue count=2'))).toBe(true);
        });

        it('should log [Queue] pause on POST /api/queue/pause', async () => {
            const srv = await startServer();
            await postJSON(`${srv.url}/api/queue/pause`, {});
            const lines = stderrLines();
            expect(lines.some(l => l.startsWith('[Queue] pause repoId=global'))).toBe(true);
        });

        it('should log [Queue] pause with repoId', async () => {
            const srv = await startServer();
            // Enqueue a task to create the bridge for this repo
            await postJSON(`${srv.url}/api/queue/pause`, {});
            await postJSON(`${srv.url}/api/queue`, makeTask({ payload: { data: { prompt: 'test' }, workingDirectory: '/test/pause-log' } }));
            const repoId = require('crypto').createHash('sha256').update(require('path').resolve('/test/pause-log')).digest('hex').substring(0, 16);
            stderrSpy.mockClear();
            await request(`${srv.url}/api/queue/pause?repoId=${repoId}`, { method: 'POST' });
            const lines = stderrLines();
            expect(lines.some(l => l.includes(`[Queue] pause repoId=${repoId}`))).toBe(true);
        });

        it('should log [Queue] resume on POST /api/queue/resume', async () => {
            const srv = await startServer();
            await postJSON(`${srv.url}/api/queue/resume`, {});
            const lines = stderrLines();
            expect(lines.some(l => l.startsWith('[Queue] resume repoId=global'))).toBe(true);
        });

        it('should log [Queue] force-fail-running on POST /api/queue/force-fail-running', async () => {
            const srv = await startServer();
            await postJSON(`${srv.url}/api/queue/force-fail-running`, {});
            const lines = stderrLines();
            expect(lines.some(l => l.startsWith('[Queue] force-fail-running count='))).toBe(true);
        });

        it('should log [Queue] move-to-top on success', async () => {
            const srv = await startServer();
            await postJSON(`${srv.url}/api/queue/pause`, {});
            // Enqueue two tasks to allow reordering
            const r1 = await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'First' }));
            const r2 = await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'Second' }));
            const id2 = JSON.parse(r2.body).task.id;
            stderrSpy.mockClear();

            await request(`${srv.url}/api/queue/${id2}/move-to-top`, { method: 'POST' });
            const lines = stderrLines();
            expect(lines.some(l => l.startsWith(`[Queue] move-to-top task=${id2}`))).toBe(true);
        });

        it('should log [Queue] move-up on success', async () => {
            const srv = await startServer();
            await postJSON(`${srv.url}/api/queue/pause`, {});
            const r1 = await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'First' }));
            const r2 = await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'Second' }));
            const id2 = JSON.parse(r2.body).task.id;
            stderrSpy.mockClear();

            await request(`${srv.url}/api/queue/${id2}/move-up`, { method: 'POST' });
            const lines = stderrLines();
            expect(lines.some(l => l.startsWith(`[Queue] move-up task=${id2}`))).toBe(true);
        });

        it('should log [Queue] move-down on success', async () => {
            const srv = await startServer();
            await postJSON(`${srv.url}/api/queue/pause`, {});
            const r1 = await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'First' }));
            const r2 = await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'Second' }));
            const id1 = JSON.parse(r1.body).task.id;
            stderrSpy.mockClear();

            await request(`${srv.url}/api/queue/${id1}/move-down`, { method: 'POST' });
            const lines = stderrLines();
            expect(lines.some(l => l.startsWith(`[Queue] move-down task=${id1}`))).toBe(true);
        });
    });
});
