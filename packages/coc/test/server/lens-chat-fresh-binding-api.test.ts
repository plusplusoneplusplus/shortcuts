import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as http from 'http';
import Database from 'better-sqlite3';
import { initializeDatabase } from '@plusplusoneplusplus/forge';
import { createRouter } from '../../src/server/shared/router';
import { registerApiRoutes } from '../../src/server/core/api-handler';
import type { Route } from '../../src/server/types';
import { createMockProcessStore } from './helpers/mock-process-store';
import type { MockProcessStore } from './helpers/mock-process-store';

vi.mock('child_process', function () { return ({
    execSync: vi.fn(() => ''),
    execFileSync: vi.fn(() => ''),
}); });

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return {
        ...actual,
        BranchService: vi.fn().mockImplementation(function () { return ({
            getBranchStatus: vi.fn(),
            hasUncommittedChanges: vi.fn(),
        }); }),
        GitRangeService: vi.fn().mockImplementation(function () { return ({
            getCurrentBranch: vi.fn(),
            detectCommitRange: vi.fn(),
        }); }),
    };
});

function request(
    url: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: string; json: () => any }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: options.method || 'GET',
                headers: { 'Content-Type': 'application/json', ...options.headers },
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => {
                    const bodyStr = Buffer.concat(chunks).toString('utf-8');
                    resolve({
                        status: res.statusCode || 0,
                        body: bodyStr,
                        json: () => JSON.parse(bodyStr),
                    });
                });
            },
        );
        req.on('error', reject);
        if (options.body) { req.write(options.body); }
        req.end();
    });
}

describe('Lens chat fresh binding API endpoints', () => {
    let server: http.Server;
    let port: number;
    let store: MockProcessStore;
    let db: Database.Database;

    const WORKSPACE_A = 'ws-lens-a';
    const WORKSPACE_B = 'ws-lens-b';

    beforeAll(async () => {
        db = new Database(':memory:');
        initializeDatabase(db);

        store = createMockProcessStore();
        vi.mocked(store.getWorkspaces).mockResolvedValue([
            { id: WORKSPACE_A, name: 'Lens Repo A', rootPath: '/test/repo-a' },
            { id: WORKSPACE_B, name: 'Lens Repo B', rootPath: '/test/repo-b' },
        ]);

        const routes: Route[] = [];
        registerApiRoutes(routes, store, undefined, undefined, undefined, db);
        const handleRequest = createRouter({ routes, spaHtml: '<html></html>' });
        server = http.createServer(handleRequest);
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        if (!address || typeof address === 'string') {
            throw new Error('Expected test server to listen on a TCP port');
        }
        port = address.port;
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        db.close();
    });

    beforeEach(() => {
        db.prepare('DELETE FROM commit_chat_bindings').run();
        db.prepare('DELETE FROM pull_request_chat_bindings').run();
        db.prepare('DELETE FROM work_item_chat_bindings').run();
        store.processes.clear();
        vi.mocked(store.archiveProcess).mockClear();
    });

    const base = () => `http://127.0.0.1:${port}`;
    const workspaceApi = (workspaceId: string, path: string) => `${base()}/api/workspaces/${workspaceId}/${path}`;
    const localOriginId = (workspaceId: string) => `local_${workspaceId}`;
    const bindingApi = (workspaceId: string, lens: { originScoped: boolean }, path: string) => {
        if (!lens.originScoped) return workspaceApi(workspaceId, path);
        return `${base()}/api/origins/${localOriginId(workspaceId)}/${path}?workspaceId=${encodeURIComponent(workspaceId)}`;
    };

    async function seedProcess(workspaceId: string, taskId: string): Promise<void> {
        await store.addProcess({
            id: taskId,
            type: 'chat',
            status: 'completed',
            startTime: new Date(),
            promptPreview: 'previous lens chat',
            fullPrompt: 'previous lens chat full prompt',
            metadata: { workspaceId },
            conversationTurns: [
                { role: 'user', content: 'old user turn', timestamp: new Date(), turnIndex: 0, timeline: [] },
                { role: 'assistant', content: 'old assistant turn', timestamp: new Date(), turnIndex: 1, timeline: [] },
            ],
        });
    }

    it.each([
        {
            name: 'Commit',
            originScoped: false,
            createPath: 'commit-chat-bindings',
            targetPath: 'commit-chat-bindings/abcd1234',
            createBody: { commitHash: 'abcd1234', taskId: 'task-commit-old' },
            archivedResponse: { commitHash: 'abcd1234', archivedTaskId: 'task-commit-old' },
            taskId: 'task-commit-old',
        },
        {
            name: 'Pull Request',
            originScoped: true,
            createPath: 'pull-request-chat-bindings',
            targetPath: 'pull-request-chat-bindings/PR-42',
            createBody: { prId: 'PR-42', taskId: 'task-pr-old' },
            archivedResponse: { prId: 'PR-42', archivedTaskId: 'task-pr-old' },
            taskId: 'task-pr-old',
        },
        {
            name: 'Work Item',
            originScoped: false,
            createPath: 'work-item-chat-bindings',
            targetPath: 'work-item-chat-bindings/WI%2F42',
            createBody: { workItemId: 'WI/42', taskId: 'task-work-item-old' },
            archivedResponse: { workItemId: 'WI/42', archivedTaskId: 'task-work-item-old' },
            taskId: 'task-work-item-old',
        },
    ])('archives and clears the current $name binding without creating a copied conversation', async (lens) => {
        await seedProcess(WORKSPACE_A, lens.taskId);
        await request(bindingApi(WORKSPACE_A, lens, lens.createPath), {
            method: 'POST',
            body: JSON.stringify(lens.createBody),
        });

        const res = await request(bindingApi(WORKSPACE_A, lens, `${lens.targetPath}/fresh`), { method: 'POST', body: '{}' });

        expect(res.status).toBe(200);
        expect(res.json()).toEqual(lens.archivedResponse);
        expect(store.processes.get(lens.taskId)?.archived).toBe(true);
        expect(store.processes.get(lens.taskId)?.conversationTurns).toHaveLength(2);
        expect(store.processes).toHaveLength(1);

        const bindingRes = await request(bindingApi(WORKSPACE_A, lens, lens.targetPath));
        expect(bindingRes.status).toBe(404);
    });

    it.each([
        {
            name: 'Commit',
            originScoped: false,
            createPath: 'commit-chat-bindings',
            targetPath: 'commit-chat-bindings/deadbeef',
            bodyA: { commitHash: 'deadbeef', taskId: 'task-a' },
            bodyB: { commitHash: 'deadbeef', taskId: 'task-b' },
        },
        {
            name: 'Pull Request',
            originScoped: true,
            createPath: 'pull-request-chat-bindings',
            targetPath: 'pull-request-chat-bindings/777',
            bodyA: { prId: '777', taskId: 'task-a' },
            bodyB: { prId: '777', taskId: 'task-b' },
        },
        {
            name: 'Work Item',
            originScoped: false,
            createPath: 'work-item-chat-bindings',
            targetPath: 'work-item-chat-bindings/WI-777',
            bodyA: { workItemId: 'WI-777', taskId: 'task-a' },
            bodyB: { workItemId: 'WI-777', taskId: 'task-b' },
        },
    ])('keeps same-target $name bindings isolated by workspace or origin', async (lens) => {
        await seedProcess(WORKSPACE_A, 'task-a');
        await seedProcess(WORKSPACE_B, 'task-b');
        await request(bindingApi(WORKSPACE_A, lens, lens.createPath), {
            method: 'POST',
            body: JSON.stringify(lens.bodyA),
        });
        await request(bindingApi(WORKSPACE_B, lens, lens.createPath), {
            method: 'POST',
            body: JSON.stringify(lens.bodyB),
        });

        const res = await request(bindingApi(WORKSPACE_A, lens, `${lens.targetPath}/fresh`), { method: 'POST', body: '{}' });

        expect(res.status).toBe(200);
        expect(store.processes.get('task-a')?.archived).toBe(true);
        expect(store.processes.get('task-b')?.archived).toBeUndefined();

        const bindingA = await request(bindingApi(WORKSPACE_A, lens, lens.targetPath));
        const bindingB = await request(bindingApi(WORKSPACE_B, lens, lens.targetPath));
        expect(bindingA.status).toBe(404);
        expect(bindingB.status).toBe(200);
        expect(bindingB.json().taskId).toBe('task-b');
    });

    it.each([
        {
            name: 'Commit',
            originScoped: false,
            createPath: 'commit-chat-bindings',
            targetPath: 'commit-chat-bindings/badf00d',
            staleBody: { commitHash: 'badf00d', taskId: 'missing-commit-task' },
            freshResponse: { commitHash: 'badf00d', archivedTaskId: null },
            replacementTaskId: 'replacement-commit-task',
            replacementBody: { commitHash: 'badf00d', taskId: 'replacement-commit-task' },
        },
        {
            name: 'Pull Request',
            originScoped: true,
            createPath: 'pull-request-chat-bindings',
            targetPath: 'pull-request-chat-bindings/stale-pr',
            staleBody: { prId: 'stale-pr', taskId: 'missing-pr-task' },
            freshResponse: { prId: 'stale-pr', archivedTaskId: null },
            replacementTaskId: 'replacement-pr-task',
            replacementBody: { prId: 'stale-pr', taskId: 'replacement-pr-task' },
        },
        {
            name: 'Work Item',
            originScoped: false,
            createPath: 'work-item-chat-bindings',
            targetPath: 'work-item-chat-bindings/WI%2Fstale',
            staleBody: { workItemId: 'WI/stale', taskId: 'missing-work-item-task' },
            freshResponse: { workItemId: 'WI/stale', archivedTaskId: null },
            replacementTaskId: 'replacement-work-item-task',
            replacementBody: { workItemId: 'WI/stale', taskId: 'replacement-work-item-task' },
        },
    ])('clears a stale $name binding whose process is already missing', async (lens) => {
        await request(bindingApi(WORKSPACE_A, lens, lens.createPath), {
            method: 'POST',
            body: JSON.stringify(lens.staleBody),
        });

        const res = await request(bindingApi(WORKSPACE_A, lens, `${lens.targetPath}/fresh`), { method: 'POST', body: '{}' });

        expect(res.status).toBe(200);
        expect(res.json()).toEqual(lens.freshResponse);
        expect(store.archiveProcess).not.toHaveBeenCalled();

        const clearedBinding = await request(bindingApi(WORKSPACE_A, lens, lens.targetPath));
        expect(clearedBinding.status).toBe(404);

        await seedProcess(WORKSPACE_A, lens.replacementTaskId);
        const replacement = await request(bindingApi(WORKSPACE_A, lens, lens.createPath), {
            method: 'POST',
            body: JSON.stringify(lens.replacementBody),
        });
        expect(replacement.status).toBe(201);

        const reboundBinding = await request(bindingApi(WORKSPACE_A, lens, lens.targetPath));
        expect(reboundBinding.status).toBe(200);
        expect(reboundBinding.json().taskId).toBe(lens.replacementTaskId);
    });
});
