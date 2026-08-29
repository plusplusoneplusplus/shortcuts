/**
 * Server-side PR-chat binding pass (AC-02).
 *
 * The tool call in `SUBMIT_PR_TOOL_CALL` is the real record from
 * `queue_1787803606663-vctyaxx`, the chat that opened PR #654 and was never
 * bound because nobody opened it in the dashboard.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
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
    name: 'Bash',
    status: 'completed',
    args: { command: 'python3 .github/skills/submit-commits-as-pr/scripts/submit_commits_as_pr.py --range HEAD~1..HEAD' },
    result: [
        'Cherry-picking 1 commit onto pr/d35c13e92-...',
        'Pushing branch...',
        'Creating pull request...',
        'JSON: {"commits_count": 1, "pr_url": "https://github.com/plusplusoneplusplus/shortcuts/pull/654", "status": "done"}',
    ].join('\n'),
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
    let db: Database.Database;

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

    it('binds a PR created by the submit_commits_as_pr wrapper', async () => {
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
                result: 'JSON: {"commits_count": 1, "pr_url": "https://github.com/someone/other-repo/pull/654", "status": "done"}',
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
