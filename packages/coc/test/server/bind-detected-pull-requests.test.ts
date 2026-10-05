/** Server-side PR-chat binding from successful CoC creation results. */
import { describe, it, expect, beforeEach } from 'vitest';
import { normalizeToolResult } from '@plusplusoneplusplus/coc-agent-sdk';
import { createCreatePullRequestTool } from '../../src/server/llm-tools/create-pull-request-tool';
import { NativeDatabase as Database } from '@plusplusoneplusplus/coc-native';
import { initializeDatabase, resolveCanonicalOriginId, type ConversationTurn, type WorkspaceInfo } from '@plusplusoneplusplus/forge';
import {
    bindDetectedPullRequestsForProcess,
    bareTaskIdForProcess,
    type PrBindingProcessStore,
} from '../../src/server/processes/bind-detected-pull-requests';
import { PullRequestChatBindingStore } from '../../src/server/processes/pull-request-chat-binding-store';

const WORKSPACE_ID = 'ws-shortcuts';
const REMOTE_URL = 'https://github.com/plusplusoneplusplus/shortcuts.git';
const ORIGIN_ID = resolveCanonicalOriginId({ workspaceId: WORKSPACE_ID, remoteUrl: REMOTE_URL });
const PROCESS_ID = 'queue_1787803606663-vctyaxx';
const BARE_TASK_ID = '1787803606663-vctyaxx';

const SUBMIT_PR_TOOL_CALL = {
    id: 'toolu_submit_pr',
    name: 'create_pull_request',
    status: 'completed',
    args: { title: 'Fix PR binding', commits: ['d35c13e92'], autoMerge: true },
    result: JSON.stringify({ success: true, url: 'https://github.com/plusplusoneplusplus/shortcuts/pull/654',
        id: 654, provider: 'github', bound: false }),
};

function turn(toolCalls: unknown[]): ConversationTurn {
    return {
        role: 'assistant',
        content: '',
        timestamp: new Date(0),
        turnIndex: 0,
        timeline: [],
        toolCalls: toolCalls as ConversationTurn['toolCalls'],
    };
}

function workspace(overrides: Partial<WorkspaceInfo> = {}): WorkspaceInfo {
    return {
        id: WORKSPACE_ID,
        name: 'shortcuts',
        rootPath: '/repos/shortcuts',
        remoteUrl: REMOTE_URL,
        ...overrides,
    } as WorkspaceInfo;
}

describe('bindDetectedPullRequestsForProcess', () => {
    let db: Database;

    function makeStore(overrides: Partial<PrBindingProcessStore> = {}, turns: ConversationTurn[] = [turn([SUBMIT_PR_TOOL_CALL])]): PrBindingProcessStore {
        return {
            getDatabase: () => db,
            getConversationTurns: async () => turns,
            getWorkspaces: async () => [workspace()],
            ...overrides,
        };
    }

    function rows(): Array<{ workspace_id: string; pr_id: string; task_id: string }> {
        return db.prepare('SELECT workspace_id, pr_id, task_id FROM pull_request_chat_bindings').all() as any;
    }

    beforeEach(() => {
        db = new Database(':memory:');
        initializeDatabase(db);
    });

    it.each([
        ['github', REMOTE_URL, 'https://github.com/plusplusoneplusplus/shortcuts/pull/874'],
        ['ado', 'https://dev.azure.com/contoso/MyProject/_git/repo', 'https://dev.azure.com/contoso/MyProject/_git/repo/pullrequest/874'],
    ] as const)('persists actual %s tool/MCP output when the immediate binding was unavailable', async (provider, remoteUrl, url) => {
        const ws = workspace({ remoteUrl });
        const { tool } = createCreatePullRequestTool({
            workspaceId: WORKSPACE_ID, processId: PROCESS_ID,
            store: { getWorkspaces: async () => [ws] }, // Simulate a missing immediate binding writer.
            createPullRequest: async () => ({ url, id: 874, provider, branch: 'pr/abc1234-fix',
                base: 'main', existing: false, autoMerge: { requested: false, enabled: false } }),
        });
        const output = await tool.handler({ title: 'Fix composer' }, {
            sessionId: 's', toolCallId: 'created', toolName: 'create_pull_request', arguments: { title: 'Fix composer' },
        });
        expect(output).toMatchObject({ success: true, bound: false });
        const calls = [{ id: 'created', name: 'mcp__coc_llm_tools__create_pull_request', status: 'completed',
            result: JSON.stringify(normalizeToolResult(output)) }];
        const store = makeStore({ getWorkspaces: async () => [ws, workspace({ id: 'other', remoteUrl: 'https://github.com/other/repo' })] }, [turn(calls)]);
        expect(await bindDetectedPullRequestsForProcess(store, PROCESS_ID, WORKSPACE_ID)).toEqual(['874']);
        expect(await bindDetectedPullRequestsForProcess(store, PROCESS_ID, WORKSPACE_ID)).toEqual(['874']);
        expect(await bindDetectedPullRequestsForProcess(store, 'queue_other-task', 'other')).toEqual([]);
        const origin = resolveCanonicalOriginId({ workspaceId: WORKSPACE_ID, remoteUrl });
        expect(rows()).toEqual([{ workspace_id: origin, pr_id: '874', task_id: BARE_TASK_ID }]);
        // Fresh store instance recovers the binding without loading any turns.
        expect(new PullRequestChatBindingStore(db).listByTaskId(origin, BARE_TASK_ID)['874'].taskId).toBe(BARE_TASK_ID);
    });

    it.each([
        { success: false, url: 'https://github.com/plusplusoneplusplus/shortcuts/pull/874', error: 'Failed' },
        { content: [{ type: 'text', text: JSON.stringify({ success: true, url: 'https://github.com/plusplusoneplusplus/shortcuts/pull/874', id: 874 }) }], isError: true },
        { success: true, url: 'https://github.com/plusplusoneplusplus/shortcuts/issues/874', id: 874 },
    ])('does not persist a failed/malformed creation result %#', async result => {
        const store = makeStore({}, [turn([{ id: 'bad', name: 'create_pull_request', status: 'completed', result: JSON.stringify(result) }])]);
        expect(await bindDetectedPullRequestsForProcess(store, PROCESS_ID, WORKSPACE_ID)).toEqual([]);
        expect(rows()).toEqual([]);
    });

    it('binds a PR created by the CoC tool', async () => {
        const bound = await bindDetectedPullRequestsForProcess(makeStore(), PROCESS_ID, WORKSPACE_ID);

        expect(bound).toEqual(['654']);
        expect(rows()).toEqual([{ workspace_id: ORIGIN_ID, pr_id: '654', task_id: BARE_TASK_ID }]);
        expect(ORIGIN_ID).toBe('gh_plusplusoneplusplus_shortcuts');
        expect(new PullRequestChatBindingStore(db).get(ORIGIN_ID, '654')!.taskId).toBe(BARE_TASK_ID);
    });

    it('writes the bare task id, stripping the queue_ prefix', async () => {
        await bindDetectedPullRequestsForProcess(makeStore(), PROCESS_ID, WORKSPACE_ID);
        expect(rows()[0].task_id).toBe(BARE_TASK_ID);
        expect(rows()[0].task_id).not.toContain('queue_');
    });

    it('leaves a non-queue process id alone', async () => {
        await bindDetectedPullRequestsForProcess(makeStore(), 'chat-abc', WORKSPACE_ID);
        expect(rows()[0].task_id).toBe('chat-abc');
        expect(bareTaskIdForProcess('chat-abc')).toBe('chat-abc');
    });

    it('is idempotent — a second pass (follow-up turn) rewrites the same row', async () => {
        const store = makeStore();
        await bindDetectedPullRequestsForProcess(store, PROCESS_ID, WORKSPACE_ID);
        await bindDetectedPullRequestsForProcess(store, PROCESS_ID, WORKSPACE_ID);
        expect(rows()).toHaveLength(1);
    });

    it('reads tool calls from the timeline as well as the legacy flat list', async () => {
        const timelineTurn = {
            role: 'assistant',
            content: '',
            timestamp: new Date(0),
            turnIndex: 0,
            timeline: [{ type: 'tool-complete', timestamp: new Date(0), toolCall: SUBMIT_PR_TOOL_CALL }],
        } as unknown as ConversationTurn;

        await bindDetectedPullRequestsForProcess(makeStore({}, [timelineTurn]), PROCESS_ID, WORKSPACE_ID);
        expect(rows()).toEqual([{ workspace_id: ORIGIN_ID, pr_id: '654', task_id: BARE_TASK_ID }]);
    });

    it('binds a PR when timeline completion omits the creating arguments', async () => {
        const timelineTurn = {
            ...turn([SUBMIT_PR_TOOL_CALL]),
            timeline: [
                { type: 'tool-start', timestamp: new Date(0), toolCall: { ...SUBMIT_PR_TOOL_CALL, status: 'running', result: undefined } },
                { type: 'tool-complete', timestamp: new Date(0), toolCall: { ...SUBMIT_PR_TOOL_CALL, args: {} } },
            ],
        } as unknown as ConversationTurn;

        expect(await bindDetectedPullRequestsForProcess(makeStore({}, [timelineTurn]), PROCESS_ID, WORKSPACE_ID)).toEqual(['654']);
        expect(rows()).toEqual([{ workspace_id: ORIGIN_ID, pr_id: '654', task_id: BARE_TASK_ID }]);
    });

    describe('does not bind', () => {
        it('a chat that only mentions a PR URL', async () => {
            const turns = [turn([{
                id: 't1',
                name: 'Bash',
                status: 'completed',
                args: { command: 'gh pr view 654' },
                result: 'https://github.com/plusplusoneplusplus/shortcuts/pull/654',
            }])];
            expect(await bindDetectedPullRequestsForProcess(makeStore({}, turns), PROCESS_ID, WORKSPACE_ID)).toEqual([]);
            expect(rows()).toEqual([]);
        });

        it('a gh pr create that printed "already exists"', async () => {
            const turns = [turn([{
                id: 't1',
                name: 'Bash',
                status: 'completed',
                args: { command: 'gh pr create --fill' },
                result: 'a pull request for branch "feat" into branch "main" already exists:\nhttps://github.com/plusplusoneplusplus/shortcuts/pull/654',
            }])];
            expect(await bindDetectedPullRequestsForProcess(makeStore({}, turns), PROCESS_ID, WORKSPACE_ID)).toEqual([]);
            expect(rows()).toEqual([]);
        });

        it('a PR in a different repo than the workspace remote', async () => {
            const turns = [turn([{
                ...SUBMIT_PR_TOOL_CALL,
                result: JSON.stringify({ success: true, url: 'https://github.com/someone/other-repo/pull/654', id: 654, provider: 'github' }),
            }])];
            expect(await bindDetectedPullRequestsForProcess(makeStore({}, turns), PROCESS_ID, WORKSPACE_ID)).toEqual([]);
            expect(rows()).toEqual([]);
        });
    });

    describe('no-ops cleanly', () => {
        it('when the store has no getDatabase (e.g. FileProcessStore)', async () => {
            const store = makeStore({ getDatabase: undefined });
            await expect(bindDetectedPullRequestsForProcess(store, PROCESS_ID, WORKSPACE_ID)).resolves.toEqual([]);
        });

        it('when the store has no getConversationTurns', async () => {
            const store = makeStore({ getConversationTurns: undefined });
            await expect(bindDetectedPullRequestsForProcess(store, PROCESS_ID, WORKSPACE_ID)).resolves.toEqual([]);
            expect(rows()).toEqual([]);
        });

        it('when there are no turns', async () => {
            await expect(bindDetectedPullRequestsForProcess(makeStore({}, []), PROCESS_ID, WORKSPACE_ID)).resolves.toEqual([]);
        });

        it('when the task has no workspaceId', async () => {
            await expect(bindDetectedPullRequestsForProcess(makeStore(), PROCESS_ID, undefined)).resolves.toEqual([]);
            expect(rows()).toEqual([]);
        });

        it('when the workspace is not registered', async () => {
            const store = makeStore({ getWorkspaces: async () => [] });
            await expect(bindDetectedPullRequestsForProcess(store, PROCESS_ID, WORKSPACE_ID)).resolves.toEqual([]);
        });

        it('when the workspace has no remote (origin cannot match a GitHub PR)', async () => {
            const store = makeStore({
                getWorkspaces: async () => [workspace({ remoteUrl: undefined, rootPath: '' })],
            });
            await expect(bindDetectedPullRequestsForProcess(store, PROCESS_ID, WORKSPACE_ID)).resolves.toEqual([]);
            expect(rows()).toEqual([]);
        });

        it('when the store throws — the failure never propagates to the task', async () => {
            const store = makeStore({
                getConversationTurns: async () => { throw new Error('db is gone'); },
            });
            await expect(bindDetectedPullRequestsForProcess(store, PROCESS_ID, WORKSPACE_ID)).resolves.toEqual([]);
        });
    });
});
