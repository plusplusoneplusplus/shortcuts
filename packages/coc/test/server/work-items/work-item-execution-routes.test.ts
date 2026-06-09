import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { Route } from '../../../src/server/types';
import { createRouter } from '../../../src/server/shared/router';
import { registerWorkItemRoutes } from '../../../src/server/routes/work-item-routes';
import { registerWorkItemExecutionRoutes } from '../../../src/server/routes/work-item-execution-routes';
import { FileWorkItemStore } from '../../../src/server/work-items/work-item-store';

let tmpDir: string;
let store: FileWorkItemStore;
let server: http.Server;
let baseUrl: string;

const mockProcessStore = {
    getProcess: vi.fn(),
    getWorkspaces: vi.fn(),
} as any;

function makeServer(enqueue?: any, opts: { dataDir?: string; workflowEnabled?: boolean; runCommand?: any } = {}): http.Server {
    const routes: Route[] = [];
    registerWorkItemRoutes({ routes, workItemStore: store });
    registerWorkItemExecutionRoutes({
        routes,
        workItemStore: store,
        processStore: mockProcessStore,
        enqueue,
        dataDir: opts.dataDir,
        getWorkflowEnabled: () => opts.workflowEnabled === true,
        runCommand: opts.runCommand,
    });
    const handler = createRouter({ routes, spaHtml: '' });
    return http.createServer(handler);
}

async function startServer(): Promise<void> {
    return new Promise((resolve, reject) => {
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address() as any;
            baseUrl = `http://127.0.0.1:${addr.port}`;
            resolve();
        });
    });
}

async function stopServer(): Promise<void> {
    return new Promise(resolve => server.close(() => resolve()));
}

async function request(
    method: string,
    urlPath: string,
    body?: unknown,
): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(urlPath, baseUrl);
        const opts: http.RequestOptions = {
            hostname: urlObj.hostname,
            port: urlObj.port,
            path: urlObj.pathname + urlObj.search,
            method,
            headers: body ? { 'Content-Type': 'application/json' } : {},
        };
        const req = http.request(opts, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('end', () => {
                const raw = Buffer.concat(chunks).toString('utf-8');
                let parsed: any = null;
                try { parsed = JSON.parse(raw); } catch { parsed = raw; }
                resolve({ status: res.statusCode!, body: parsed });
            });
        });
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

const REPO_ID = 'test-repo';

describe('Work Item Execution Routes', () => {
    beforeEach(() => {
        mockProcessStore.getProcess.mockReset();
        mockProcessStore.getWorkspaces.mockReset();
    });

    describe('POST /execute', () => {
        beforeEach(async () => {
            tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'coc-wi-exec-routes-'));
            store = new FileWorkItemStore({ dataDir: tmpDir });
            const enqueue = vi.fn().mockResolvedValue('task-abc');
            server = makeServer(enqueue);
            await startServer();
        });

        afterEach(async () => {
            await stopServer();
            await fs.rm(tmpDir, { recursive: true, force: true });
        });

        it('executes a ready work item', async () => {
            // Create a work item in ready state
            await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                title: 'Execute me',
            });
            const list = await request('GET', `/api/workspaces/${REPO_ID}/work-items`);
            const id = list.body.items[0].id;

            // Transition to readyToExecute
            await request('PATCH', `/api/workspaces/${REPO_ID}/work-items/${id}`, { status: 'readyToExecute' });

            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/${id}/execute`, {});

            expect(res.status).toBe(200);
            expect(res.body.taskId).toBe('task-abc');
        });

        it('rejects non-ready work items', async () => {
            await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                title: 'Not ready',
            });
            const list = await request('GET', `/api/workspaces/${REPO_ID}/work-items`);
            const id = list.body.items[0].id;

            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/${id}/execute`, {});
            expect(res.status).toBe(400);
            expect(res.body.error).toContain('Cannot execute');
        });

        it('returns 404 for non-existent work item', async () => {
            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/nonexistent/execute`, {});
            expect(res.status).toBe(404);
        });

        it('rejects execution of epic (container type)', async () => {
            const epicId = `epic-test-${Date.now()}`;
            await store.addWorkItem({
                id: epicId, repoId: REPO_ID, title: 'My epic', type: 'epic',
                description: '', status: 'readyToExecute', source: 'manual',
                createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
            });

            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/${epicId}/execute`, {});
            expect(res.status).toBe(400);
            expect(res.body.error).toContain('planning container');
        });

        it('rejects execution of feature (container type)', async () => {
            const featureId = `feature-test-${Date.now()}`;
            await store.addWorkItem({
                id: featureId, repoId: REPO_ID, title: 'My feature', type: 'feature',
                description: '', status: 'readyToExecute', source: 'manual',
                createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
            });

            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/${featureId}/execute`, {});
            expect(res.status).toBe(400);
            expect(res.body.error).toContain('planning container');
        });

        it('rejects execution of pbi (container type)', async () => {
            const pbiId = `pbi-test-${Date.now()}`;
            await store.addWorkItem({
                id: pbiId, repoId: REPO_ID, title: 'My pbi', type: 'pbi',
                description: '', status: 'readyToExecute', source: 'manual',
                createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
            });

            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/${pbiId}/execute`, {});
            expect(res.status).toBe(400);
            expect(res.body.error).toContain('planning container');
        });
    });

    describe('POST /execute with skillNames', () => {
        let enqueueMock: ReturnType<typeof vi.fn>;

        beforeEach(async () => {
            tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'coc-wi-exec-skill-'));
            store = new FileWorkItemStore({ dataDir: tmpDir });
            enqueueMock = vi.fn().mockResolvedValue('task-skill');
            server = makeServer(enqueueMock);
            await startServer();
        });

        afterEach(async () => {
            await stopServer();
            await fs.rm(tmpDir, { recursive: true, force: true });
        });

        it('forwards skillNames to the executor', async () => {
            await request('POST', `/api/workspaces/${REPO_ID}/work-items`, { title: 'With skill' });
            const list = await request('GET', `/api/workspaces/${REPO_ID}/work-items`);
            const id = list.body.items[0].id;
            await request('PATCH', `/api/workspaces/${REPO_ID}/work-items/${id}`, { status: 'readyToExecute' });

            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/${id}/execute`, {
                skillNames: ['impl', 'code-review'],
                model: 'gpt-4',
            });

            expect(res.status).toBe(200);
            const call = enqueueMock.mock.calls[0][0];
            expect(call.payload.context.skills).toEqual(['impl', 'code-review']);
            expect(call.config.model).toBe('gpt-4');
        });

        it('forwards provider and reasoning effort to the queued execution task', async () => {
            await request('POST', `/api/workspaces/${REPO_ID}/work-items`, { title: 'With AI controls' });
            const list = await request('GET', `/api/workspaces/${REPO_ID}/work-items`);
            const id = list.body.items[0].id;
            await request('PATCH', `/api/workspaces/${REPO_ID}/work-items/${id}`, { status: 'readyToExecute' });

            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/${id}/execute`, {
                provider: 'claude',
                model: 'claude-sonnet-4.6',
                reasoningEffort: 'medium',
                skillNames: ['impl'],
            });

            expect(res.status).toBe(200);
            const call = enqueueMock.mock.calls[0][0];
            expect(call.payload.provider).toBe('claude');
            expect(call.payload.reasoningEffort).toBe('medium');
            expect(call.config.model).toBe('claude-sonnet-4.6');
            expect(call.config.reasoningEffort).toBe('medium');
        });

        it('rejects invalid provider and reasoning effort values', async () => {
            await request('POST', `/api/workspaces/${REPO_ID}/work-items`, { title: 'Reject AI controls' });
            const list = await request('GET', `/api/workspaces/${REPO_ID}/work-items`);
            const id = list.body.items[0].id;
            await request('PATCH', `/api/workspaces/${REPO_ID}/work-items/${id}`, { status: 'readyToExecute' });

            const invalidProvider = await request('POST', `/api/workspaces/${REPO_ID}/work-items/${id}/execute`, {
                provider: 'bogus',
            });
            expect(invalidProvider.status).toBe(400);
            expect(invalidProvider.body.error).toContain('Invalid provider');

            const invalidEffort = await request('POST', `/api/workspaces/${REPO_ID}/work-items/${id}/execute`, {
                reasoningEffort: 'extreme',
            });
            expect(invalidEffort.status).toBe(400);
            expect(invalidEffort.body.error).toContain('Invalid reasoningEffort');
        });

        it('filters out non-string and empty skillNames', async () => {
            await request('POST', `/api/workspaces/${REPO_ID}/work-items`, { title: 'Filter test' });
            const list = await request('GET', `/api/workspaces/${REPO_ID}/work-items`);
            const id = list.body.items[0].id;
            await request('PATCH', `/api/workspaces/${REPO_ID}/work-items/${id}`, { status: 'readyToExecute' });

            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/${id}/execute`, {
                skillNames: ['impl', '', 42, null, 'test'],
            });

            expect(res.status).toBe(200);
            const call = enqueueMock.mock.calls[0][0];
            expect(call.payload.context.skills).toEqual(['impl', 'test']);
        });

        it('defaults local-only Goals to Ralph execution when the workflow flag is enabled', async () => {
            await stopServer();
            server = makeServer(enqueueMock, { dataDir: tmpDir, workflowEnabled: true });
            await startServer();

            await store.addWorkItem({
                id: 'goal-route-1',
                repoId: REPO_ID,
                title: 'Ralph Goal',
                description: '',
                status: 'readyToExecute',
                type: 'goal',
                source: 'manual',
                tracker: { kind: 'local-only' },
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                plan: { version: 1, currentVersion: 1, content: '## Goal\nShip it', updatedAt: new Date().toISOString() },
                currentContentVersion: 1,
            });

            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/goal-route-1/execute`, {
                skillNames: ['impl'],
            });

            expect(res.status).toBe(200);
            expect(res.body.ralphSessionId).toMatch(/^ralph-/);
            const call = enqueueMock.mock.calls[0][0];
            expect(call.type).toBe('chat');
            expect(call.payload.mode).toBe('ralph');
            expect(call.payload.workItemId).toBe('goal-route-1');
            expect(call.payload.context.ralph.sessionId).toBe(res.body.ralphSessionId);

            const updated = await store.getWorkItem('goal-route-1', REPO_ID);
            expect(updated!.executionHistory![0].executionMode).toBe('ralph');
            expect(updated!.executionHistory![0].ralphSessionId).toBe(res.body.ralphSessionId);
        });

        it('rejects Ralph execution when the workflow flag is disabled', async () => {
            await request('POST', `/api/workspaces/${REPO_ID}/work-items`, { title: 'Flag gated' });
            const list = await request('GET', `/api/workspaces/${REPO_ID}/work-items`);
            const id = list.body.items[0].id;
            await request('PATCH', `/api/workspaces/${REPO_ID}/work-items/${id}`, { status: 'readyToExecute' });

            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/${id}/execute`, {
                executionMode: 'ralph',
            });

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('workItems.workflow.enabled');
            expect(enqueueMock).not.toHaveBeenCalled();
        });

        it('rejects Ralph execution for remote-backed items', async () => {
            await stopServer();
            server = makeServer(enqueueMock, { dataDir: tmpDir, workflowEnabled: true });
            await startServer();
            await store.addWorkItem({
                id: 'wi-remote-ralph',
                repoId: REPO_ID,
                title: 'Remote item',
                description: '',
                status: 'readyToExecute',
                type: 'work-item',
                source: 'manual',
                tracker: { kind: 'github-backed', provider: 'github', github: { issueNumber: 1 } },
                githubMirror: { issueNumber: 1 },
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            });

            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/wi-remote-ralph/execute`, {
                executionMode: 'ralph',
            });

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('local-only');
            expect(enqueueMock).not.toHaveBeenCalled();
        });
    });

    describe('POST /from-chat', () => {
        beforeEach(async () => {
            tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'coc-wi-fromchat-'));
            store = new FileWorkItemStore({ dataDir: tmpDir });
            server = makeServer();
            await startServer();
        });

        afterEach(async () => {
            await stopServer();
            await fs.rm(tmpDir, { recursive: true, force: true });
        });

        it('creates work item from chat process', async () => {
            mockProcessStore.getProcess.mockResolvedValue({
                id: 'proc-1',
                title: 'Chat about auth refactor',
                promptPreview: 'Can you help me refactor...',
                fullPrompt: 'Can you help me refactor the auth module?',
            });

            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/from-chat`, {
                processId: 'proc-1',
                title: 'Auth refactor task',
            });

            expect(res.status).toBe(201);
            expect(res.body.title).toBe('Auth refactor task');
            expect(res.body.source).toBe('chat');
            expect(res.body.sourceId).toBe('proc-1');
        });

        it('auto-generates a plan template for chat-created work items', async () => {
            mockProcessStore.getProcess.mockResolvedValue({
                id: 'proc-auto',
                title: 'Implement dark mode',
                fullPrompt: 'Add dark mode support to the dashboard.',
            });

            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/from-chat`, {
                processId: 'proc-auto',
            });

            expect(res.status).toBe(201);
            expect(res.body.plan).toBeDefined();
            expect(res.body.plan.content).toContain('## Objective');
            expect(res.body.plan.content).toContain('## Steps');
            expect(res.body.plan.version).toBe(1);
            expect(res.body.status).toBe('planning');
        });

        it('auto-generated plan uses work item title as objective', async () => {
            mockProcessStore.getProcess.mockResolvedValue({
                id: 'proc-title',
                title: 'Refactor auth module',
                fullPrompt: 'Refactor the authentication module for clarity.',
            });

            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/from-chat`, {
                processId: 'proc-title',
                title: 'Refactor auth module',
            });

            expect(res.status).toBe(201);
            expect(res.body.plan.content).toContain('Refactor auth module');
        });

        it('extracts title from chat process when not provided', async () => {
            mockProcessStore.getProcess.mockResolvedValue({
                id: 'proc-2',
                title: 'Discuss caching strategy',
                promptPreview: 'What caching...',
                fullPrompt: 'What caching strategy should we use?',
            });

            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/from-chat`, {
                processId: 'proc-2',
            });

            expect(res.status).toBe(201);
            expect(res.body.title).toBe('Discuss caching strategy');
            // Always starts as 'planning' now (auto-plan template is generated)
            expect(res.body.status).toBe('planning');
        });

        it('extracts plan from chat result when extractPlan is true', async () => {
            mockProcessStore.getProcess.mockResolvedValue({
                id: 'proc-3',
                title: 'Plan for feature',
                promptPreview: 'Create a plan...',
                fullPrompt: 'Create a plan for implementing caching',
                result: '# Caching Plan\n1. Add Redis\n2. Implement cache layer',
            });

            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/from-chat`, {
                processId: 'proc-3',
                extractPlan: true,
            });

            expect(res.status).toBe(201);
            expect(res.body.plan).toBeDefined();
            expect(res.body.plan.content).toContain('Caching Plan');
            expect(res.body.status).toBe('planning');
        });

        it('rejects missing processId', async () => {
            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/from-chat`, {
                title: 'No process',
            });
            expect(res.status).toBe(400);
            expect(res.body.error).toContain('processId');
        });

        it('returns 404 for non-existent process', async () => {
            mockProcessStore.getProcess.mockResolvedValue(undefined);

            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/from-chat`, {
                processId: 'nonexistent',
            });
            expect(res.status).toBe(404);
        });
    });

    describe('POST /submit-pr', () => {
        let runCommand: ReturnType<typeof vi.fn>;

        beforeEach(async () => {
            tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'coc-wi-submit-pr-'));
            store = new FileWorkItemStore({ dataDir: tmpDir });
            mockProcessStore.getWorkspaces.mockResolvedValue([{ id: REPO_ID, rootPath: path.join(tmpDir, 'repo') }]);
            runCommand = vi.fn(async (command: string, args: string[]) => {
                if (command === 'git' && args.join(' ') === 'status --porcelain') return { stdout: '', stderr: '' };
                if (command === 'git' && args.join(' ') === 'rev-parse --abbrev-ref HEAD') return { stdout: 'feature/current\n', stderr: '' };
                if (command === 'git' && args.join(' ') === 'symbolic-ref --quiet --short refs/remotes/origin/HEAD') return { stdout: 'origin/main\n', stderr: '' };
                if (command === 'gh' && args[0] === 'pr' && args[1] === 'create') return { stdout: 'https://github.com/example/repo/pull/123\n', stderr: '' };
                return { stdout: '', stderr: '' };
            });
            server = makeServer(undefined, { workflowEnabled: true, runCommand });
            await startServer();
        });

        afterEach(async () => {
            await stopServer();
            await fs.rm(tmpDir, { recursive: true, force: true });
        });

        async function addReviewItem(overrides: Partial<Parameters<typeof store.addWorkItem>[0]> = {}) {
            const now = new Date().toISOString();
            await store.addWorkItem({
                id: 'wi-submit-pr',
                repoId: REPO_ID,
                title: 'Submit PR item',
                description: 'Create a PR from this work item.',
                status: 'aiDone',
                type: 'work-item',
                source: 'manual',
                tracker: { kind: 'local-only' },
                createdAt: now,
                updatedAt: now,
                plan: { version: 2, currentVersion: 2, content: '## Plan\nShip it', updatedAt: now },
                currentContentVersion: 2,
                executionHistory: [{
                    taskId: 'task-submit-pr',
                    status: 'completed',
                    startedAt: now,
                    completedAt: now,
                    planVersion: 2,
                    title: 'Code Implement',
                }],
                changes: [{
                    id: 'change-submit-pr',
                    planVersion: 2,
                    taskId: 'task-submit-pr',
                    startedAt: now,
                    completedAt: now,
                    status: 'closed',
                    commits: [
                        { sha: '1111111111111111111111111111111111111111', message: 'First commit' },
                        { sha: '2222222222222222222222222222222222222222', message: 'Second commit' },
                    ],
                }],
                ...overrides,
            });
        }

        it('submits eligible Review commits as an explicit PR and records metadata', async () => {
            await addReviewItem();

            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/wi-submit-pr/submit-pr`, {
                branchName: 'coc/work-items/submit-pr-item',
            });

            expect(res.status).toBe(200);
            expect(res.body.prUrl).toBe('https://github.com/example/repo/pull/123');
            expect(res.body.prNumber).toBe(123);
            expect(res.body.branchName).toBe('coc/work-items/submit-pr-item');
            const commands = runCommand.mock.calls.map(call => `${call[0]} ${call[1].join(' ')}`);
            expect(commands).toContain('git switch -c coc/work-items/submit-pr-item origin/main');
            expect(commands).toContain('git cherry-pick 2222222222222222222222222222222222222222');
            expect(commands).toContain('git cherry-pick 1111111111111111111111111111111111111111');
            expect(commands).toContain('git switch feature/current');

            const updated = await store.getWorkItem('wi-submit-pr', REPO_ID);
            expect(updated?.status).toBe('done');
            expect(updated?.changes?.[0].prUrl).toBe('https://github.com/example/repo/pull/123');
            expect(updated?.changes?.[0].prNumber).toBe(123);
            expect(updated?.changes?.[0].branchName).toBe('coc/work-items/submit-pr-item');
            expect(updated?.executionHistory?.[0].prUrl).toBe('https://github.com/example/repo/pull/123');
        });

        it('rejects PR submission when the workflow flag is disabled', async () => {
            await stopServer();
            server = makeServer(undefined, { workflowEnabled: false, runCommand });
            await startServer();
            await addReviewItem();

            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/wi-submit-pr/submit-pr`, {});

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('workItems.workflow.enabled');
            expect(runCommand).not.toHaveBeenCalled();
        });

        it('rejects remote-backed items even when commits exist', async () => {
            await addReviewItem({
                tracker: { kind: 'github-backed', provider: 'github', github: { issueNumber: 1 } },
                githubMirror: { issueNumber: 1 },
            });

            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/wi-submit-pr/submit-pr`, {});

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('local-only');
            expect(runCommand).not.toHaveBeenCalled();
        });

        it('rejects Review items without eligible commits', async () => {
            await addReviewItem({
                changes: [{
                    id: 'change-empty',
                    planVersion: 2,
                    taskId: 'task-submit-pr',
                    startedAt: new Date().toISOString(),
                    completedAt: new Date().toISOString(),
                    status: 'closed',
                    commits: [],
                }],
            });

            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/wi-submit-pr/submit-pr`, {});

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('No eligible execution commits');
            expect(runCommand).not.toHaveBeenCalled();
        });

        it('rejects already-submitted changes', async () => {
            await addReviewItem({
                changes: [{
                    id: 'change-submitted',
                    planVersion: 2,
                    taskId: 'task-submit-pr',
                    startedAt: new Date().toISOString(),
                    completedAt: new Date().toISOString(),
                    status: 'closed',
                    commits: [{ sha: '3333333333333333333333333333333333333333', message: 'Existing PR commit' }],
                    prUrl: 'https://github.com/example/repo/pull/5',
                    prNumber: 5,
                    prStatus: 'open',
                }],
            });

            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/wi-submit-pr/submit-pr`, {
                changeId: 'change-submitted',
            });

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('already has a submitted PR');
            expect(runCommand).not.toHaveBeenCalled();
        });

        it('rejects dirty workspaces before creating a PR branch', async () => {
            await addReviewItem();
            runCommand.mockImplementation(async (command: string, args: string[]) => {
                if (command === 'git' && args.join(' ') === 'status --porcelain') return { stdout: ' M file.ts\n', stderr: '' };
                return { stdout: '', stderr: '' };
            });

            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/wi-submit-pr/submit-pr`, {});

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('uncommitted changes');
            expect(runCommand).toHaveBeenCalledTimes(1);
        });
    });

    describe('POST /ai-review', () => {
        let enqueue: ReturnType<typeof vi.fn>;

        beforeEach(async () => {
            tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'coc-wi-ai-review-'));
            store = new FileWorkItemStore({ dataDir: tmpDir });
            enqueue = vi.fn().mockResolvedValue('task-ai-review');
            server = makeServer(enqueue, { workflowEnabled: true });
            await startServer();
        });

        afterEach(async () => {
            await stopServer();
            await fs.rm(tmpDir, { recursive: true, force: true });
        });

        async function addReviewItem(overrides: Partial<Parameters<typeof store.addWorkItem>[0]> = {}) {
            const now = new Date().toISOString();
            await store.addWorkItem({
                id: 'wi-ai-review',
                repoId: REPO_ID,
                title: 'AI review item',
                description: 'Review this result.',
                status: 'aiDone',
                type: 'work-item',
                source: 'manual',
                tracker: { kind: 'local-only' },
                createdAt: now,
                updatedAt: now,
                plan: { version: 4, currentVersion: 4, content: '## Plan\nCheck the result', updatedAt: now },
                currentContentVersion: 4,
                executionHistory: [{
                    taskId: 'task-impl',
                    processId: 'proc-impl',
                    status: 'completed',
                    startedAt: now,
                    completedAt: now,
                    planVersion: 4,
                    executionMode: 'one-shot',
                    sessionCategory: 'generating-code',
                    title: 'Code Implement',
                }],
                changes: [{
                    id: 'change-ai-review',
                    planVersion: 4,
                    taskId: 'task-impl',
                    startedAt: now,
                    completedAt: now,
                    status: 'closed',
                    commits: [{ sha: 'abcabcabcabcabcabcabcabcabcabcabcabcabca', message: 'Implement AI review target' }],
                }],
                ...overrides,
            });
        }

        it('enqueues an explicit AI review and records it in execution history without leaving Review', async () => {
            await addReviewItem();

            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/wi-ai-review/ai-review`, {
                provider: 'claude',
                model: 'claude-sonnet-4.6',
                reasoningEffort: 'high',
            });

            expect(res.status).toBe(200);
            expect(res.body.taskId).toBe('task-ai-review');
            expect(enqueue).toHaveBeenCalledOnce();
            const call = enqueue.mock.calls[0][0];
            expect(call.displayName).toBe('Run #2: AI Review');
            expect(call.payload).toMatchObject({
                kind: 'chat',
                mode: 'ask',
                workspaceId: REPO_ID,
                workItemId: 'wi-ai-review',
                sessionCategory: 'work-item-ai-review',
                planVersion: 4,
                provider: 'claude',
                reasoningEffort: 'high',
            });
            expect(call.payload.prompt).toContain('abcabcabcabcabcabcabcabcabcabcabcabcabca');
            expect(call.payload.context.skills).toEqual(['code-review']);
            expect(call.payload.context.workItemReview).toMatchObject({
                workItemId: 'wi-ai-review',
                executionTaskId: 'task-impl',
                changeId: 'change-ai-review',
                commits: ['abcabcabcabcabcabcabcabcabcabcabcabcabca'],
            });
            expect(call.config.model).toBe('claude-sonnet-4.6');

            const updated = await store.getWorkItem('wi-ai-review', REPO_ID);
            expect(updated?.status).toBe('aiDone');
            expect(updated?.executionHistory?.[1]).toMatchObject({
                taskId: 'task-ai-review',
                status: 'running',
                sessionCategory: 'work-item-ai-review',
                title: 'AI Review',
                kind: 'ai-review',
                planVersion: 4,
                reviewedChangeId: 'change-ai-review',
                reviewedTaskId: 'task-impl',
                skillNames: ['code-review'],
                aiSettings: {
                    provider: 'claude',
                    model: 'claude-sonnet-4.6',
                    reasoningEffort: 'high',
                },
            });
        });

        it('rejects AI review when the workflow flag is disabled', async () => {
            await stopServer();
            server = makeServer(enqueue, { workflowEnabled: false });
            await startServer();
            await addReviewItem();

            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/wi-ai-review/ai-review`, {});

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('workItems.workflow.enabled');
            expect(enqueue).not.toHaveBeenCalled();
        });

        it('rejects AI review for remote-backed items', async () => {
            await addReviewItem({
                tracker: { kind: 'github-backed', provider: 'github', github: { issueNumber: 1 } },
                githubMirror: { issueNumber: 1 },
            });

            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/wi-ai-review/ai-review`, {});

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('local-only');
            expect(enqueue).not.toHaveBeenCalled();
        });
    });

    describe('POST /execute — task file creation', () => {
        let capturedEnqueuePayload: any;
        let enqueue: any;

        beforeEach(async () => {
            tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'coc-wi-taskfile-'));
            store = new FileWorkItemStore({ dataDir: tmpDir });
            capturedEnqueuePayload = undefined;
            enqueue = vi.fn().mockImplementation(async (task: any) => {
                capturedEnqueuePayload = task;
                return 'task-xyz';
            });
            // dataDir is set so the placeholder file mechanism is active
            server = makeServer(enqueue, { dataDir: tmpDir });
            await startServer();
        });

        afterEach(async () => {
            await stopServer();
            await fs.rm(tmpDir, { recursive: true, force: true });
        });

        async function createAndReadyWorkItem(title = 'Placeholder Test Item'): Promise<string> {
            await request('POST', `/api/workspaces/${REPO_ID}/work-items`, { title });
            const list = await request('GET', `/api/workspaces/${REPO_ID}/work-items`);
            const id = list.body.items[0].id;
            await request('PATCH', `/api/workspaces/${REPO_ID}/work-items/${id}`, {
                status: 'readyToExecute',
            });
            return id;
        }

        it('creates a placeholder .impl.md file when dataDir is provided', async () => {
            const id = await createAndReadyWorkItem('My Task');

            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/${id}/execute`, {});
            expect(res.status).toBe(200);

            const expectedPath = path.join(
                tmpDir, 'repos', REPO_ID, 'tasks', 'work-items', `${id}.impl.md`,
            );
            const contents = await fs.readFile(expectedPath, 'utf-8');
            expect(contents).toContain('status: in-progress');
            expect(contents).toContain('# My Task');
        });

        it('includes context.files[0] pointing to the task file in the enqueued payload', async () => {
            const id = await createAndReadyWorkItem('Context Files Test');

            await request('POST', `/api/workspaces/${REPO_ID}/work-items/${id}/execute`, {});

            expect(capturedEnqueuePayload).toBeDefined();
            const files: string[] = capturedEnqueuePayload.payload?.context?.files ?? [];
            expect(files.length).toBeGreaterThan(0);
            expect(files[0]).toContain(id);
            expect(files[0]).toContain('.impl.md');
        });

        it('does not create a task file when dataDir is not provided', async () => {
            // Rebuild server WITHOUT dataDir
            await stopServer();
            server = makeServer(enqueue);
            await startServer();

            const id = await createAndReadyWorkItem('No DataDir Task');

            await request('POST', `/api/workspaces/${REPO_ID}/work-items/${id}/execute`, {});

            const expectedPath = path.join(
                tmpDir, 'repos', REPO_ID, 'tasks', 'work-items', `${id}.impl.md`,
            );
            await expect(fs.access(expectedPath)).rejects.toThrow();
        });

        it('still executes successfully even if task file creation fails', async () => {
            // dataDir points to a non-existent read-only path — file creation will fail
            const readOnlyDir = path.join(tmpDir, 'nonexistent', 'no-perms');
            await stopServer();
            server = makeServer(enqueue, { dataDir: readOnlyDir });
            await startServer();

            const id = await createAndReadyWorkItem('Resilient Task');

            // Should still return 200 — file creation failure is non-fatal
            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/${id}/execute`, {});
            expect(res.status).toBe(200);
            expect(res.body.taskId).toBe('task-xyz');
        });
    });

    describe('POST /resolve-comments', () => {
        let capturedEnqueuePayload: any;
        let enqueue: any;

        beforeEach(async () => {
            tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'coc-wi-resolve-'));
            store = new FileWorkItemStore({ dataDir: tmpDir });
            capturedEnqueuePayload = undefined;
            enqueue = vi.fn().mockImplementation(async (task: any) => {
                capturedEnqueuePayload = task;
                return 'task-resolve-abc';
            });
            server = makeServer(enqueue, { dataDir: tmpDir });
            await startServer();
        });

        afterEach(async () => {
            await stopServer();
            await fs.rm(tmpDir, { recursive: true, force: true });
        });

        it('returns 404 for non-existent work item', async () => {
            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/nonexistent/resolve-comments`, {
                type: 'plan',
            });
            expect(res.status).toBe(404);
        });

        it('rejects resolve-comments on container types (epic, feature, pbi)', async () => {
            for (const containerType of ['epic', 'feature', 'pbi'] as const) {
                const itemId = `${containerType}-resolve-test-${Date.now()}`;
                await store.addWorkItem({
                    id: itemId, repoId: REPO_ID, title: `Container ${containerType}`, type: containerType,
                    description: '', status: 'created', source: 'manual',
                    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
                });

                const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/${itemId}/resolve-comments`, {
                    type: 'plan',
                });
                expect(res.status).toBe(400);
                expect(res.body.error).toContain('planning container');
            }
        });

        it('rejects missing type field', async () => {
            await request('POST', `/api/workspaces/${REPO_ID}/work-items`, { title: 'Resolve test' });
            const list = await request('GET', `/api/workspaces/${REPO_ID}/work-items`);
            const id = list.body.items[0].id;

            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/${id}/resolve-comments`, {});
            expect(res.status).toBe(400);
            expect(res.body.error).toContain('type');
        });

        it('rejects invalid type field', async () => {
            await request('POST', `/api/workspaces/${REPO_ID}/work-items`, { title: 'Resolve test' });
            const list = await request('GET', `/api/workspaces/${REPO_ID}/work-items`);
            const id = list.body.items[0].id;

            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/${id}/resolve-comments`, {
                type: 'invalid',
            });
            expect(res.status).toBe(400);
            expect(res.body.error).toContain('type');
        });

        it('rejects plan resolve when no open comments exist', async () => {
            await request('POST', `/api/workspaces/${REPO_ID}/work-items`, { title: 'No comments' });
            const list = await request('GET', `/api/workspaces/${REPO_ID}/work-items`);
            const id = list.body.items[0].id;

            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/${id}/resolve-comments`, {
                type: 'plan',
            });
            expect(res.status).toBe(400);
            expect(res.body.error).toContain('No open plan comments');
        });

        it('rejects commit resolve when commitSha is missing', async () => {
            await request('POST', `/api/workspaces/${REPO_ID}/work-items`, { title: 'No sha' });
            const list = await request('GET', `/api/workspaces/${REPO_ID}/work-items`);
            const id = list.body.items[0].id;

            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/${id}/resolve-comments`, {
                type: 'commit',
            });
            expect(res.status).toBe(400);
            expect(res.body.error).toContain('commitSha');
        });

        it('resolves plan comments and creates a Run# session', async () => {
            // Create work item
            await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                title: 'Plan resolve test',
                plan: { version: 1, content: 'Step 1: do stuff', updatedAt: new Date().toISOString() },
            });
            const list = await request('GET', `/api/workspaces/${REPO_ID}/work-items`);
            const id = list.body.items[0].id;

            // Add a plan comment using TaskCommentsManager
            const { TaskCommentsManager: TCM } = await import('../../../src/server/tasks/comments/task-comments-manager');
            const tcm = new TCM(tmpDir);
            await tcm.addComment(REPO_ID, `__wi-plan__/${id}`, {
                filePath: `__wi-plan__/${id}`,
                selection: { startLine: 1, startColumn: 0, endLine: 1, endColumn: 10 },
                selectedText: 'Step 1',
                comment: 'Please add more detail',
                status: 'open',
            });

            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/${id}/resolve-comments`, {
                type: 'plan',
            });

            expect(res.status).toBe(200);
            expect(res.body.taskId).toBe('task-resolve-abc');

            // Verify the enqueue payload
            expect(capturedEnqueuePayload).toBeDefined();
            expect(capturedEnqueuePayload.payload.sessionCategory).toBe('resolve-plan-comments');
            expect(capturedEnqueuePayload.payload.workItemId).toBe(id);
            expect(capturedEnqueuePayload.payload.tools).toEqual(['resolve-comments']);
            expect(capturedEnqueuePayload.displayName).toContain('Comment Resolve');

            // Verify execution history was updated
            const updated = await request('GET', `/api/workspaces/${REPO_ID}/work-items/${id}`);
            expect(updated.body.executionHistory).toHaveLength(1);
            expect(updated.body.executionHistory[0].sessionCategory).toBe('resolve-plan-comments');
            expect(updated.body.executionHistory[0].title).toBe('Comment Resolve');
        });
    });
});
