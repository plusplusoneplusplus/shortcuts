/**
 * Hierarchy link support in the create_update_work_item AI tool.
 *
 * Integration tests with a real FileWorkItemStore proving the tool can create
 * children, reparent, and unlink work items through the shared work-item
 * command service — with the same validation, provider sync, and broadcast
 * behavior as the Work Items REST routes.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import type { Route } from '../../../src/server/types';
import { createRouter } from '../../../src/server/shared/router';
import { registerWorkItemRoutes } from '../../../src/server/routes/work-item-routes';
import { FileWorkItemStore } from '../../../src/server/work-items/work-item-store';
import type { WorkItem } from '../../../src/server/work-items/types';
import {
    createCreateUpdateWorkItemTool,
    type CreateUpdateWorkItemToolDeps,
    type BroadcastWorkItemFn,
} from '../../../src/server/llm-tools/create-update-work-item-tool';
import type {
    GitHubWorkItemIssue,
    GitHubWorkItemIssueTransport,
    AvailableGitHubWorkItemSyncRepo,
} from '../../../src/server/work-items/work-item-sync-github-provider';
import { safeRm } from '../../helpers/safe-rm';

const REPO_ID = 'tool-links-repo';
const OWNER = 'plusplusoneplusplus';
const REPO = 'shortcuts';
const NOW = '2026-01-01T00:00:00.000Z';

let tmpDir: string;
let store: FileWorkItemStore;
let server: http.Server | undefined;
let baseUrl: string;

function makeWorkItem(overrides: Partial<WorkItem>): WorkItem {
    return {
        id: overrides.id ?? 'item-1',
        repoId: overrides.repoId ?? REPO_ID,
        title: overrides.title ?? 'Item',
        description: overrides.description ?? '',
        status: overrides.status ?? 'created',
        type: overrides.type,
        parentId: overrides.parentId,
        tracker: overrides.tracker,
        githubMirror: overrides.githubMirror,
        plan: overrides.plan,
        createdAt: overrides.createdAt ?? NOW,
        updatedAt: overrides.updatedAt ?? NOW,
        source: overrides.source ?? 'manual',
        tags: overrides.tags,
        priority: overrides.priority,
    };
}

async function seed(overrides: Partial<WorkItem>): Promise<WorkItem> {
    await store.addWorkItem(makeWorkItem(overrides));
    return (await store.getWorkItem(overrides.id!, REPO_ID))!;
}

function makeTool(opts?: {
    broadcast?: BroadcastWorkItemFn;
    deps?: Partial<CreateUpdateWorkItemToolDeps>;
}) {
    const { tool } = createCreateUpdateWorkItemTool(tmpDir, REPO_ID, opts?.broadcast, {
        workItemStore: store,
        getHierarchyEnabled: () => true,
        getSyncEnabled: () => false,
        ...opts?.deps,
    });
    return tool;
}

interface MockTransport {
    transport: GitHubWorkItemIssueTransport;
    issues: Map<number, GitHubWorkItemIssue>;
    calls: {
        createIssue: Array<{ title: string; body: string; labels: string[] }>;
        updateIssue: Array<{ issueNumber: number; title: string }>;
    };
}

function makeMockTransport(): MockTransport {
    let nextIssueNumber = 100;
    const issues = new Map<number, GitHubWorkItemIssue>();
    const calls: MockTransport['calls'] = { createIssue: [], updateIssue: [] };
    return {
        issues,
        calls,
        transport: {
            async getRepository(_repo: AvailableGitHubWorkItemSyncRepo) { /* reachable */ },
            async listIssues() {
                return [...issues.values()];
            },
            async getIssue(_repo: AvailableGitHubWorkItemSyncRepo, issueNumber: number) {
                return issues.get(issueNumber);
            },
            async createIssue(_repo: AvailableGitHubWorkItemSyncRepo, input) {
                calls.createIssue.push(input);
                const issue: GitHubWorkItemIssue = {
                    id: `I_${nextIssueNumber}`,
                    number: nextIssueNumber++,
                    title: input.title,
                    state: 'open',
                    htmlUrl: `https://github.com/${OWNER}/${REPO}/issues/${nextIssueNumber - 1}`,
                    url: `https://api.github.com/repos/${OWNER}/${REPO}/issues/${nextIssueNumber - 1}`,
                    body: input.body,
                    labels: input.labels,
                    updatedAt: NOW,
                };
                issues.set(issue.number, issue);
                return issue;
            },
            async updateIssue(_repo: AvailableGitHubWorkItemSyncRepo, issueNumber: number, input) {
                calls.updateIssue.push({ issueNumber, title: input.title });
                const existing = issues.get(issueNumber);
                if (!existing) throw new Error(`Missing mock issue #${issueNumber}`);
                const updated: GitHubWorkItemIssue = {
                    ...existing,
                    title: input.title,
                    state: input.state,
                    body: input.body,
                    labels: input.labels,
                    updatedAt: NOW,
                };
                issues.set(issueNumber, updated);
                return updated;
            },
        },
    };
}

const GITHUB_PROCESS_STORE = () => ({
    getWorkspaces: async () => [{
        id: REPO_ID,
        name: 'Tool Links Test',
        rootPath: tmpDir,
        remoteUrl: `https://github.com/${OWNER}/${REPO}.git`,
    }],
}) as any;

async function startRouteServer(): Promise<void> {
    const routes: Route[] = [];
    registerWorkItemRoutes({
        routes,
        workItemStore: store,
        processStore: { getWorkspaces: async () => [] } as any,
        getHierarchyEnabled: () => true,
        getSyncEnabled: () => false,
        dataDir: tmpDir,
    });
    server = http.createServer(createRouter({ routes, spaHtml: '' }));
    await new Promise<void>((resolve, reject) => {
        server!.on('error', reject);
        server!.listen(0, '127.0.0.1', () => {
            const addr = server!.address() as any;
            baseUrl = `http://127.0.0.1:${addr.port}`;
            resolve();
        });
    });
}

async function patchWorkItem(workItemId: string, body: unknown): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(body);
        const req = http.request({
            hostname: '127.0.0.1',
            port: new URL(baseUrl).port,
            path: `/api/workspaces/${encodeURIComponent(REPO_ID)}/work-items/${encodeURIComponent(workItemId)}`,
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
        }, res => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () => {
                const raw = Buffer.concat(chunks).toString('utf-8');
                let parsed: any = raw;
                try { parsed = raw ? JSON.parse(raw) : undefined; } catch { /* keep raw */ }
                resolve({ status: res.statusCode!, body: parsed });
            });
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tool-hierarchy-links-'));
    store = new FileWorkItemStore({ dataDir: tmpDir });
});

afterEach(async () => {
    if (server) {
        await new Promise<void>(resolve => server!.close(() => resolve()));
        server = undefined;
    }
    // Retry-with-backoff cleanup: the store writes work-item JSON under
    // repos/<id>/work-items concurrently, so a plain recursive rm can race and
    // throw ENOTEMPTY on macOS. safeRm retries and degrades to a warning.
    await safeRm(tmpDir);
});

describe('create_update_work_item hierarchy links — create mode', () => {
    it('creates a child work item under a PBI using parentId', async () => {
        const pbi = await seed({ id: 'pbi-1', title: 'A PBI', type: 'pbi' });
        const tool = makeTool();

        const result: any = await tool.handler({ title: 'Child item', parentId: pbi.id });

        expect(result.created).toBe(true);
        expect(result.parentId).toBe(pbi.id);
        expect(result.parentTitle).toBe('A PBI');
        const stored = await store.getWorkItem(result.id, REPO_ID);
        expect(stored?.parentId).toBe(pbi.id);
        expect(stored?.source).toBe('chat');
    });

    it('resolves the parent by parentTarget WI-N', async () => {
        const pbi = await seed({ id: 'pbi-1', title: 'A PBI', type: 'pbi' });
        const tool = makeTool();

        const result: any = await tool.handler({
            title: 'Child item',
            parentTarget: `WI-${pbi.workItemNumber}`,
        });

        expect(result.created).toBe(true);
        expect(result.parentId).toBe(pbi.id);
        expect(result.parentWorkItemNumber).toBe(pbi.workItemNumber);
        const stored = await store.getWorkItem(result.id, REPO_ID);
        expect(stored?.parentId).toBe(pbi.id);
    });

    it('resolves the parent by parentWorkItemNumber', async () => {
        const pbi = await seed({ id: 'pbi-1', title: 'A PBI', type: 'pbi' });
        const tool = makeTool();

        const result: any = await tool.handler({
            title: 'Child item',
            parentWorkItemNumber: pbi.workItemNumber,
        });

        expect(result.created).toBe(true);
        const stored = await store.getWorkItem(result.id, REPO_ID);
        expect(stored?.parentId).toBe(pbi.id);
    });

    it('creates a bug child under a PBI with an initial plan', async () => {
        const pbi = await seed({ id: 'pbi-1', title: 'A PBI', type: 'pbi' });
        const tool = makeTool();

        const result: any = await tool.handler({
            title: 'Bug child',
            type: 'bug',
            parentId: pbi.id,
            plan: '## Objective\n\nFix the bug.',
        });

        expect(result.created).toBe(true);
        const stored = await store.getWorkItem(result.id, REPO_ID);
        expect(stored?.parentId).toBe(pbi.id);
        expect(stored?.type).toBe('bug');
        expect(stored?.status).toBe('planning');
        expect(stored?.plan?.version).toBe(1);
    });

    it('rejects an unknown parent reference', async () => {
        const tool = makeTool();

        const result: any = await tool.handler({ title: 'Child item', parentTarget: 'WI-999' });

        expect(result.created).toBe(false);
        expect(result.error).toContain('Parent work item not found');
    });

    it('rejects an invalid parent-child type combination', async () => {
        const epic = await seed({ id: 'epic-1', title: 'An Epic', type: 'epic' });
        const tool = makeTool();

        // work-item children can only live under a PBI, not directly under an Epic
        const result: any = await tool.handler({ title: 'Child item', parentId: epic.id });

        expect(result.created).toBe(false);
        expect(result.error).toContain('Invalid parent-child type combination');
    });

    it('rejects a cross-workspace parent', async () => {
        await store.addWorkItem(makeWorkItem({ id: 'other-pbi', repoId: 'other-repo', type: 'pbi' }));
        const tool = makeTool();

        const result: any = await tool.handler({ title: 'Child item', parentId: 'other-pbi' });

        expect(result.created).toBe(false);
        expect(result.error).toContain('Parent work item not found');
    });

    it('rejects parent links when the hierarchy flag is disabled', async () => {
        const pbi = await seed({ id: 'pbi-1', title: 'A PBI', type: 'pbi' });
        const tool = makeTool({ deps: { getHierarchyEnabled: () => false } });

        const result: any = await tool.handler({ title: 'Child item', parentId: pbi.id });

        expect(result.created).toBe(false);
        expect(result.error).toContain('workItems.hierarchy');
    });
});

describe('create_update_work_item hierarchy links — update mode', () => {
    it('moves an existing work item to a different valid parent (link-only update)', async () => {
        await seed({ id: 'pbi-1', title: 'PBI One', type: 'pbi' });
        const pbi2 = await seed({ id: 'pbi-2', title: 'PBI Two', type: 'pbi' });
        const item = await seed({ id: 'leaf-1', title: 'Leaf', type: 'work-item', parentId: 'pbi-1', status: 'readyToExecute' });
        const broadcast = vi.fn();
        const tool = makeTool({ broadcast });

        const result: any = await tool.handler({ workItemId: item.id, parentTarget: `WI-${pbi2.workItemNumber}` });

        expect(result.updated).toBe(true);
        expect(result.id).toBe(item.id);
        expect(result.title).toBe('Leaf');
        expect(result.parentId).toBe(pbi2.id);
        expect(result.parentTitle).toBe('PBI Two');
        const stored = await store.getWorkItem(item.id, REPO_ID);
        expect(stored?.parentId).toBe(pbi2.id);
        // link-only update preserves status and plan history
        expect(stored?.status).toBe('readyToExecute');
        expect(stored?.plan).toBeUndefined();
        expect(broadcast).toHaveBeenCalledOnce();
        expect(broadcast.mock.calls[0][0].type).toBe('work-item-updated');
    });

    it('unlinks an existing work item with parentId: null', async () => {
        await seed({ id: 'pbi-1', title: 'PBI One', type: 'pbi' });
        const item = await seed({ id: 'leaf-1', title: 'Leaf', type: 'work-item', parentId: 'pbi-1' });
        const tool = makeTool();

        const result: any = await tool.handler({ workItemId: item.id, parentId: null });

        expect(result.updated).toBe(true);
        expect(result.parentId).toBeNull();
        const stored = await store.getWorkItem(item.id, REPO_ID);
        expect(stored?.parentId).toBeUndefined();
    });

    it('unlinks with an explicit empty parentTarget', async () => {
        await seed({ id: 'pbi-1', title: 'PBI One', type: 'pbi' });
        const item = await seed({ id: 'leaf-1', title: 'Leaf', type: 'work-item', parentId: 'pbi-1' });
        const tool = makeTool();

        const result: any = await tool.handler({ workItemId: item.id, parentTarget: '' });

        expect(result.updated).toBe(true);
        const stored = await store.getWorkItem(item.id, REPO_ID);
        expect(stored?.parentId).toBeUndefined();
    });

    it('applies a combined plan and link update with one broadcast', async () => {
        const pbi = await seed({ id: 'pbi-1', title: 'PBI One', type: 'pbi' });
        const item = await seed({
            id: 'leaf-1',
            title: 'Leaf',
            type: 'work-item',
            plan: { version: 1, currentVersion: 1, content: 'Old plan', updatedAt: NOW },
        });
        const broadcast = vi.fn();
        const tool = makeTool({ broadcast });

        const result: any = await tool.handler({
            workItemId: item.id,
            parentId: pbi.id,
            plan: '## Objective\n\nRevised plan.',
        });

        expect(result.updated).toBe(true);
        expect(result.parentId).toBe(pbi.id);
        expect(result.planVersion).toBe(2);
        expect(result.status).toBe('planning');
        const stored = await store.getWorkItem(item.id, REPO_ID);
        expect(stored?.parentId).toBe(pbi.id);
        expect(stored?.plan?.content).toBe('## Objective\n\nRevised plan.');
        expect(stored?.plan?.resolvedBy).toBe('ai');
        expect(broadcast).toHaveBeenCalledOnce();
    });

    it('applies a combined field and link update', async () => {
        const pbi = await seed({ id: 'pbi-1', title: 'PBI One', type: 'pbi' });
        const item = await seed({ id: 'leaf-1', title: 'Leaf', type: 'work-item' });
        const tool = makeTool();

        const result: any = await tool.handler({
            workItemId: item.id,
            parentId: pbi.id,
            title: 'Renamed leaf',
            priority: 'high',
        });

        expect(result.updated).toBe(true);
        const stored = await store.getWorkItem(item.id, REPO_ID);
        expect(stored?.parentId).toBe(pbi.id);
        expect(stored?.title).toBe('Renamed leaf');
        expect(stored?.priority).toBe('high');
    });

    it('rejects self-parenting', async () => {
        const item = await seed({ id: 'leaf-1', title: 'Leaf', type: 'pbi' });
        const tool = makeTool();

        const result: any = await tool.handler({ workItemId: item.id, parentId: item.id });

        expect(result.updated).toBe(false);
        expect(result.error).toContain('cannot be its own parent');
    });

    it('rejects an invalid parent-child type combination on reparent', async () => {
        const epic = await seed({ id: 'epic-1', title: 'An Epic', type: 'epic' });
        const item = await seed({ id: 'leaf-1', title: 'Leaf', type: 'work-item' });
        const tool = makeTool();

        const result: any = await tool.handler({ workItemId: item.id, parentId: epic.id });

        expect(result.updated).toBe(false);
        expect(result.error).toContain('Invalid parent-child type combination');
    });

    it('rejects a reparent that would create a hierarchy cycle', async () => {
        // Corrupted legacy data: a PBI whose parent chain points at the leaf.
        const item = await seed({ id: 'leaf-1', title: 'Leaf', type: 'work-item' });
        const pbi = await seed({ id: 'pbi-1', title: 'PBI', type: 'pbi', parentId: item.id });
        const tool = makeTool();

        const result: any = await tool.handler({ workItemId: item.id, parentId: pbi.id });

        expect(result.updated).toBe(false);
        expect(result.error).toContain('cycle');
        const stored = await store.getWorkItem(item.id, REPO_ID);
        expect(stored?.parentId).toBeUndefined();
    });

    it('rejects link updates when the hierarchy flag is disabled', async () => {
        const pbi = await seed({ id: 'pbi-1', title: 'PBI One', type: 'pbi' });
        const item = await seed({ id: 'leaf-1', title: 'Leaf', type: 'work-item' });
        const tool = makeTool({ deps: { getHierarchyEnabled: () => false } });

        const result: any = await tool.handler({ workItemId: item.id, parentId: pbi.id });

        expect(result.updated).toBe(false);
        expect(result.error).toContain('workItems.hierarchy');
    });

    it('rejects an unknown parent reference without touching the item', async () => {
        const item = await seed({ id: 'leaf-1', title: 'Leaf', type: 'work-item', parentId: undefined });
        const tool = makeTool();

        const result: any = await tool.handler({ workItemId: item.id, parentTarget: 'WI-424242' });

        expect(result.updated).toBe(false);
        expect(result.error).toContain('Parent work item not found');
        const stored = await store.getWorkItem(item.id, REPO_ID);
        expect(stored?.updatedAt).toBe(item.updatedAt);
    });

    it('still reports a no-op when neither fields, plan, nor link changes are supplied', async () => {
        const item = await seed({ id: 'leaf-1', title: 'Leaf', type: 'work-item' });
        const tool = makeTool();

        const result: any = await tool.handler({ workItemId: item.id });

        expect(result.updated).toBe(false);
        expect(result.error).toContain('No update requested');
    });
});

describe('create_update_work_item type change — update mode', () => {
    it('changes a PBI to a work-item and reparents it under another PBI in one call', async () => {
        // Manual demo: WI-34 (a PBI) becomes a work-item so WI-17 (a PBI) can parent it.
        const pbi17 = await seed({ id: 'pbi-17', title: 'PBI Seventeen', type: 'pbi' });
        const item = await seed({
            id: 'pbi-34',
            title: 'Item Thirty-Four',
            type: 'pbi',
            status: 'readyToExecute',
            plan: { version: 1, currentVersion: 1, content: 'Original plan', updatedAt: NOW },
        });
        const broadcast = vi.fn();
        const tool = makeTool({ broadcast });

        const result: any = await tool.handler({
            workItemId: item.id,
            type: 'work-item',
            parentWorkItemNumber: pbi17.workItemNumber,
        });

        expect(result.updated).toBe(true);
        const stored = await store.getWorkItem(item.id, REPO_ID);
        expect(stored?.type).toBe('work-item');
        expect(stored?.parentId).toBe(pbi17.id);
        // Plan and status are preserved (no new plan version, no reset to planning).
        expect(stored?.status).toBe('readyToExecute');
        expect(stored?.plan?.version).toBe(1);
        expect(stored?.plan?.content).toBe('Original plan');
        // A single coherent broadcast for the whole update.
        expect(broadcast).toHaveBeenCalledOnce();
        expect(broadcast.mock.calls[0][0].type).toBe('work-item-updated');
    });

    it('rejects changing a PBI with child work-items into a work-item, naming the blocking child', async () => {
        const pbi = await seed({ id: 'pbi-1', title: 'Parent PBI', type: 'pbi' });
        const child = await seed({ id: 'leaf-1', title: 'Child leaf', type: 'work-item', parentId: pbi.id });
        const tool = makeTool();

        const result: any = await tool.handler({ workItemId: pbi.id, type: 'work-item' });

        expect(result.updated).toBe(false);
        expect(result.error).toContain(`WI-${child.workItemNumber}`);
        expect(result.error).toContain('cannot parent');
        // No change: the item keeps its original type.
        const stored = await store.getWorkItem(pbi.id, REPO_ID);
        expect(stored?.type).toBe('pbi');
    });

    it('rejects a type change that leaves the existing parent invalid when no new parent is supplied', async () => {
        const pbi = await seed({ id: 'pbi-1', title: 'A PBI', type: 'pbi' });
        const item = await seed({ id: 'leaf-1', title: 'Leaf', type: 'work-item', parentId: pbi.id });
        const tool = makeTool();

        // work-item → feature: a feature must live under an epic, not a PBI.
        const result: any = await tool.handler({ workItemId: item.id, type: 'feature' });

        expect(result.updated).toBe(false);
        expect(result.error).toContain(`WI-${pbi.workItemNumber}`);
        expect(result.error).toContain("cannot be a parent of 'feature'");
        const stored = await store.getWorkItem(item.id, REPO_ID);
        expect(stored?.type).toBe('work-item');
        expect(stored?.parentId).toBe(pbi.id);
    });

    it('fixes an otherwise-invalid parent by reparenting in the same type-change call', async () => {
        const pbi = await seed({ id: 'pbi-1', title: 'A PBI', type: 'pbi' });
        const epic = await seed({ id: 'epic-1', title: 'An Epic', type: 'epic' });
        const item = await seed({ id: 'feat-candidate', title: 'Candidate', type: 'work-item', parentId: pbi.id });
        const tool = makeTool();

        // work-item → feature is invalid under the current PBI parent, but valid
        // when reparented to the Epic in the same call.
        const result: any = await tool.handler({
            workItemId: item.id,
            type: 'feature',
            parentId: epic.id,
        });

        expect(result.updated).toBe(true);
        const stored = await store.getWorkItem(item.id, REPO_ID);
        expect(stored?.type).toBe('feature');
        expect(stored?.parentId).toBe(epic.id);
    });

    it('changes the type of a standalone item, preserving plan and status', async () => {
        const item = await seed({
            id: 'solo-1',
            title: 'Standalone',
            type: 'work-item',
            status: 'readyToExecute',
            plan: { version: 2, currentVersion: 2, content: 'Solo plan', updatedAt: NOW },
        });
        const broadcast = vi.fn();
        const tool = makeTool({ broadcast });

        const result: any = await tool.handler({ workItemId: item.id, type: 'goal' });

        expect(result.updated).toBe(true);
        const stored = await store.getWorkItem(item.id, REPO_ID);
        expect(stored?.type).toBe('goal');
        expect(stored?.status).toBe('readyToExecute');
        expect(stored?.plan?.version).toBe(2);
        expect(stored?.plan?.content).toBe('Solo plan');
        expect(broadcast).toHaveBeenCalledOnce();
    });

    it('treats a same-type "change" as a no-op-eligible validation only', async () => {
        const item = await seed({ id: 'bug-1', title: 'A bug', type: 'bug' });
        const tool = makeTool();

        // type matches and nothing else is supplied → still a no-op.
        const result: any = await tool.handler({ workItemId: item.id, type: 'bug' });

        expect(result.updated).toBe(false);
        expect(result.error).toContain('No update requested');
    });
});

describe('REST/tool parity through the shared command service', () => {
    it('REST PATCH and the AI tool produce the same reparented state', async () => {
        const pbi1 = await seed({ id: 'pbi-1', title: 'PBI One', type: 'pbi' });
        const pbi2 = await seed({ id: 'pbi-2', title: 'PBI Two', type: 'pbi' });
        const viaRest = await seed({ id: 'wi-rest', title: 'Leaf', type: 'work-item', parentId: pbi1.id });
        const viaTool = await seed({ id: 'wi-tool', title: 'Leaf', type: 'work-item', parentId: pbi1.id });
        await startRouteServer();
        const tool = makeTool();

        const restResponse = await patchWorkItem(viaRest.id, { parentId: pbi2.id });
        const toolResult: any = await tool.handler({ workItemId: viaTool.id, parentId: pbi2.id });

        expect(restResponse.status).toBe(200);
        expect(toolResult.updated).toBe(true);
        const restStored = await store.getWorkItem(viaRest.id, REPO_ID);
        const toolStored = await store.getWorkItem(viaTool.id, REPO_ID);
        expect(restStored?.parentId).toBe(pbi2.id);
        expect(toolStored?.parentId).toBe(pbi2.id);
        expect(toolStored?.status).toBe(restStored?.status);
    });

    it('REST PATCH and the AI tool reject an invalid reparent with the same validation error', async () => {
        const epic = await seed({ id: 'epic-1', title: 'An Epic', type: 'epic' });
        const viaRest = await seed({ id: 'wi-rest', title: 'Leaf', type: 'work-item' });
        const viaTool = await seed({ id: 'wi-tool', title: 'Leaf', type: 'work-item' });
        await startRouteServer();
        const tool = makeTool();

        const restResponse = await patchWorkItem(viaRest.id, { parentId: epic.id });
        const toolResult: any = await tool.handler({ workItemId: viaTool.id, parentId: epic.id });

        expect(restResponse.status).toBe(400);
        expect(toolResult.updated).toBe(false);
        expect(toolResult.error).toBe(restResponse.body.error);
    });
});

describe('provider-backed hierarchy operations through the AI tool', () => {
    async function seedGitHubBackedTree(): Promise<{ epic: WorkItem; pbiA: WorkItem; pbiB: WorkItem; mock: MockTransport }> {
        const mock = makeMockTransport();
        mock.issues.set(10, {
            id: 'I_10', number: 10, title: 'GitHub Epic', state: 'open',
            htmlUrl: `https://github.com/${OWNER}/${REPO}/issues/10`,
            url: `https://api.github.com/repos/${OWNER}/${REPO}/issues/10`,
            body: '', labels: [], updatedAt: NOW,
        });
        mock.issues.set(11, {
            id: 'I_11', number: 11, title: 'PBI A', state: 'open',
            htmlUrl: `https://github.com/${OWNER}/${REPO}/issues/11`,
            url: `https://api.github.com/repos/${OWNER}/${REPO}/issues/11`,
            body: '', labels: [], updatedAt: NOW,
        });
        mock.issues.set(12, {
            id: 'I_12', number: 12, title: 'PBI B', state: 'open',
            htmlUrl: `https://github.com/${OWNER}/${REPO}/issues/12`,
            url: `https://api.github.com/repos/${OWNER}/${REPO}/issues/12`,
            body: '', labels: [], updatedAt: NOW,
        });
        const epic = await seed({
            id: 'epic-1', title: 'GitHub Epic', type: 'epic',
            tracker: {
                kind: 'github-backed', provider: 'github',
                github: { issueId: 'I_10', issueNumber: 10, issueUrl: `https://github.com/${OWNER}/${REPO}/issues/10`, lastPulledAt: NOW },
            },
            githubMirror: { issueId: 'I_10', issueNumber: 10, issueUrl: `https://github.com/${OWNER}/${REPO}/issues/10`, updatedAt: NOW, lastPulledAt: NOW },
        });
        const pbiA = await seed({
            id: 'pbi-a', title: 'PBI A', type: 'pbi', parentId: epic.id,
            githubMirror: { issueId: 'I_11', issueNumber: 11, issueUrl: `https://github.com/${OWNER}/${REPO}/issues/11`, updatedAt: NOW, lastPulledAt: NOW },
        });
        const pbiB = await seed({
            id: 'pbi-b', title: 'PBI B', type: 'pbi', parentId: epic.id,
            githubMirror: { issueId: 'I_12', issueNumber: 12, issueUrl: `https://github.com/${OWNER}/${REPO}/issues/12`, updatedAt: NOW, lastPulledAt: NOW },
        });
        return { epic, pbiA, pbiB, mock };
    }

    it('creating a child under a GitHub-backed PBI pushes a new issue and stores mirror metadata', async () => {
        const { pbiA, mock } = await seedGitHubBackedTree();
        const tool = makeTool({
            deps: {
                processStore: GITHUB_PROCESS_STORE(),
                githubTransport: mock.transport,
                getSyncEnabled: () => true,
            },
        });

        const result: any = await tool.handler({ title: 'GitHub child', parentId: pbiA.id });

        expect(result.created).toBe(true);
        expect(mock.calls.createIssue).toHaveLength(1);
        expect(mock.calls.createIssue[0].title).toBe('GitHub child');
        const stored = await store.getWorkItem(result.id, REPO_ID);
        expect(stored?.parentId).toBe(pbiA.id);
        expect(stored?.githubMirror?.issueNumber).toBe(100);
    });

    it('reparenting a GitHub-backed child pushes the move through the provider update flow', async () => {
        const { pbiA, pbiB, mock } = await seedGitHubBackedTree();
        const child = await seed({
            id: 'leaf-1', title: 'Mirrored leaf', type: 'work-item', parentId: pbiA.id,
            githubMirror: { issueId: 'I_50', issueNumber: 50, issueUrl: `https://github.com/${OWNER}/${REPO}/issues/50`, updatedAt: NOW, lastPulledAt: NOW },
        });
        mock.issues.set(50, {
            id: 'I_50', number: 50, title: 'Mirrored leaf', state: 'open',
            htmlUrl: `https://github.com/${OWNER}/${REPO}/issues/50`,
            url: `https://api.github.com/repos/${OWNER}/${REPO}/issues/50`,
            body: '', labels: [], updatedAt: NOW,
        });
        const tool = makeTool({
            deps: {
                processStore: GITHUB_PROCESS_STORE(),
                githubTransport: mock.transport,
                getSyncEnabled: () => true,
            },
        });

        const result: any = await tool.handler({ workItemId: child.id, parentId: pbiB.id });

        expect(result.updated).toBe(true);
        expect(result.parentId).toBe(pbiB.id);
        expect(mock.calls.updateIssue).toHaveLength(1);
        expect(mock.calls.updateIssue[0].issueNumber).toBe(50);
        const stored = await store.getWorkItem(child.id, REPO_ID);
        expect(stored?.parentId).toBe(pbiB.id);
    });

    it('surfaces provider errors when the parent is not mirrored', async () => {
        const { mock } = await seedGitHubBackedTree();
        // PBI in the GitHub-backed tree but missing its mirror metadata
        const orphanPbi = await seed({ id: 'pbi-x', title: 'Unmirrored PBI', type: 'pbi', parentId: 'epic-1' });
        const tool = makeTool({
            deps: {
                processStore: GITHUB_PROCESS_STORE(),
                githubTransport: mock.transport,
                getSyncEnabled: () => true,
            },
        });

        const result: any = await tool.handler({ title: 'Child', parentId: orphanPbi.id });

        expect(result.created).toBe(false);
        expect(result.error).toContain('not mirrored to GitHub');
        expect(mock.calls.createIssue).toHaveLength(0);
    });

    it('closing a GitHub-backed item via status pushes the mirror issue to closed', async () => {
        const mock = makeMockTransport();
        mock.issues.set(70, {
            id: 'I_70', number: 70, title: 'Standalone mirrored item', state: 'open',
            htmlUrl: `https://github.com/${OWNER}/${REPO}/issues/70`,
            url: `https://api.github.com/repos/${OWNER}/${REPO}/issues/70`,
            body: '', labels: [], updatedAt: NOW,
        });
        const item = await seed({
            id: 'mirror-1', title: 'Standalone mirrored item', type: 'work-item', status: 'readyToExecute',
            tracker: {
                kind: 'github-backed', provider: 'github',
                github: { issueId: 'I_70', issueNumber: 70, issueUrl: `https://github.com/${OWNER}/${REPO}/issues/70`, lastPulledAt: NOW },
            },
            githubMirror: { issueId: 'I_70', issueNumber: 70, issueUrl: `https://github.com/${OWNER}/${REPO}/issues/70`, updatedAt: NOW, lastPulledAt: NOW },
        });
        const tool = makeTool({
            deps: {
                processStore: GITHUB_PROCESS_STORE(),
                githubTransport: mock.transport,
                getSyncEnabled: () => true,
            },
        });

        const result: any = await tool.handler({ workItemId: item.id, status: 'done' });

        expect(result.updated).toBe(true);
        expect(result.status).toBe('done');
        expect(mock.calls.updateIssue).toHaveLength(1);
        expect(mock.calls.updateIssue[0].issueNumber).toBe(70);
        expect(mock.issues.get(70)?.state).toBe('closed');
        const stored = await store.getWorkItem(item.id, REPO_ID);
        expect(stored?.status).toBe('done');
    });
});
