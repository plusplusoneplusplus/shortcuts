/**
 * `create_pull_request` LLM tool: calls the shared create-PR service with the
 * chat's own repo and writes the chat ↔ PR binding for the calling process.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NativeDatabase as Database } from '@plusplusoneplusplus/coc-native';
import { initializeDatabase, resolveCanonicalOriginId, type WorkspaceInfo } from '@plusplusoneplusplus/forge';
import { createCreatePullRequestTool } from '../../../src/server/llm-tools/create-pull-request-tool';
import {
    CreatePullRequestError,
    type CreatePullRequestInput,
    type CreatePullRequestResult,
} from '../../../src/server/git/create-pull-request-service';
import type { PrBindingWriterStore } from '../../../src/server/processes/record-pull-request-binding';

const WORKSPACE_ID = 'ws-shortcuts';
const REMOTE_URL = 'https://github.com/plusplusoneplusplus/shortcuts.git';
const ORIGIN_ID = resolveCanonicalOriginId({ workspaceId: WORKSPACE_ID, remoteUrl: REMOTE_URL });
const PROCESS_ID = 'queue_1790000000000-abc123';
const BARE_TASK_ID = '1790000000000-abc123';

const RESULT: CreatePullRequestResult = {
    url: 'https://github.com/plusplusoneplusplus/shortcuts/pull/77',
    id: 77,
    provider: 'github',
    branch: 'pr/abc1234-fix-thing',
    base: 'main',
    existing: false,
    autoMerge: { requested: false, enabled: false },
};

function workspace(overrides: Partial<WorkspaceInfo> = {}): WorkspaceInfo {
    return { id: WORKSPACE_ID, name: 'shortcuts', rootPath: '/repos/shortcuts', remoteUrl: REMOTE_URL, ...overrides } as WorkspaceInfo;
}

async function invoke(tool: { handler: (...a: any[]) => unknown }, args: unknown): Promise<any> {
    return tool.handler(args, { sessionId: 's', toolCallId: 't', toolName: 'create_pull_request', arguments: args } as any);
}

describe('create_pull_request tool', () => {
    let db: Database;
    let store: PrBindingWriterStore;

    function rows(): Array<{ workspace_id: string; pr_id: string; task_id: string }> {
        return db.prepare('SELECT workspace_id, pr_id, task_id FROM pull_request_chat_bindings').all() as any;
    }

    beforeEach(() => {
        db = new Database(':memory:');
        initializeDatabase(db);
        store = { getDatabase: () => db, getWorkspaces: async () => [workspace()] };
    });

    it('creates the PR through the service and binds it to the calling process', async () => {
        const service = vi.fn(async (_input: CreatePullRequestInput) => RESULT);
        const { tool } = createCreatePullRequestTool({
            workspaceId: WORKSPACE_ID,
            processId: PROCESS_ID,
            workingDirectory: '/repos/shortcuts-wt',
            store,
            createPullRequest: service,
        });

        const out = await invoke(tool, { title: 'Fix thing', body: 'Body', commits: ['abc1234'], autoMerge: true, mergeMethod: 'squash' });

        expect(out).toMatchObject({ success: true, url: RESULT.url, id: 77, provider: 'github', bound: true });
        expect(service).toHaveBeenCalledWith({
            repoRoot: '/repos/shortcuts-wt',
            title: 'Fix thing',
            body: 'Body',
            autoMerge: true,
            mergeMethod: 'squash',
            commits: ['abc1234'],
        });
        expect(rows()).toEqual([{ workspace_id: ORIGIN_ID, pr_id: '77', task_id: BARE_TASK_ID }]);
    });

    it.each([true, false, undefined])('forwards authorized autoMerge=%s without changing the general default', async autoMerge => {
        const service = vi.fn(async (_input: CreatePullRequestInput) => RESULT);
        const { tool } = createCreatePullRequestTool({ workspaceId: WORKSPACE_ID, processId: PROCESS_ID, store, createPullRequest: service });

        await invoke(tool, { title: 'Submit exact commits', body: 'Reviewed change', base: 'develop',
            commits: ['abc1234', 'def5678'], draft: true, mergeMethod: 'rebase',
            ...(autoMerge === undefined ? {} : { autoMerge }) });

        expect(service).toHaveBeenCalledWith({ repoRoot: '/repos/shortcuts', title: 'Submit exact commits',
            body: 'Reviewed change', base: 'develop', commits: ['abc1234', 'def5678'],
            draft: true, mergeMethod: 'rebase', ...(autoMerge === undefined ? {} : { autoMerge }) });
        expect(tool.parameters?.properties?.autoMerge.description).toContain('including invoking a skill');
    });

    it('falls back to the workspace root and current-branch mode when no working dir / commits', async () => {
        const service = vi.fn(async (_input: CreatePullRequestInput) => RESULT);
        const { tool } = createCreatePullRequestTool({ workspaceId: WORKSPACE_ID, processId: PROCESS_ID, store, createPullRequest: service });

        await invoke(tool, { title: 'T', commits: [] });

        expect(service).toHaveBeenCalledWith({ repoRoot: '/repos/shortcuts', title: 'T' });
    });

    it('binds an existing PR returned idempotently', async () => {
        const { tool } = createCreatePullRequestTool({
            workspaceId: WORKSPACE_ID,
            processId: 'chat-plain',
            store,
            createPullRequest: async () => ({ ...RESULT, existing: true }),
        });

        const out = await invoke(tool, { title: 'T' });

        expect(out).toMatchObject({ success: true, existing: true });
        expect(rows()).toEqual([{ workspace_id: ORIGIN_ID, pr_id: '77', task_id: 'chat-plain' }]);
    });

    it('reports service errors with code and conflicting commit, and writes no binding', async () => {
        const { tool } = createCreatePullRequestTool({
            workspaceId: WORKSPACE_ID,
            processId: PROCESS_ID,
            store,
            createPullRequest: async () => { throw new CreatePullRequestError('conflict', 'Cherry-pick of deadbee conflicted', 'deadbee'); },
        });

        const out = await invoke(tool, { title: 'T', commits: ['deadbee'] });

        expect(out).toEqual({ success: false, code: 'conflict', error: 'Cherry-pick of deadbee conflicted', commit: 'deadbee' });
        expect(rows()).toEqual([]);
    });

    it('rejects a missing title and a bad merge method without calling the service', async () => {
        const service = vi.fn(async () => RESULT);
        const { tool } = createCreatePullRequestTool({ workspaceId: WORKSPACE_ID, processId: PROCESS_ID, store, createPullRequest: service });

        expect(await invoke(tool, { title: '  ' })).toMatchObject({ success: false, code: 'invalid-input' });
        expect(await invoke(tool, { title: 'T', mergeMethod: 'fast-forward' })).toMatchObject({ success: false, code: 'invalid-input' });
        expect(service).not.toHaveBeenCalled();
    });

    it('still reports success when the binding cannot be written', async () => {
        const { tool } = createCreatePullRequestTool({
            workspaceId: WORKSPACE_ID,
            processId: PROCESS_ID,
            store: { getWorkspaces: async () => [workspace()] },
            createPullRequest: async () => RESULT,
        });

        const out = await invoke(tool, { title: 'T' });

        expect(out).toMatchObject({ success: true, url: RESULT.url, bound: false });
    });
});
