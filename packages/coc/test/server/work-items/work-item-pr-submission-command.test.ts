import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { NativeDatabase as Database } from '@plusplusoneplusplus/coc-native';
import { initializeDatabase, resolveCanonicalOriginId } from '@plusplusoneplusplus/forge';
import { APIError } from '../../../src/server/errors';
import { FileWorkItemStore } from '../../../src/server/work-items/work-item-store';
import type { WorkItem } from '../../../src/server/work-items/types';
import type {
    WorkItemCommandRunner,
    WorkItemExecutionCommandContext,
} from '../../../src/server/work-items/work-item-execution-shared';
import {
    findSubmitPrChange,
    submitWorkItemPrCommand,
} from '../../../src/server/work-items/work-item-pr-submission-command';

const REPO_ID = 'pr-command-repo';
const WORK_ITEM_ID = 'wi-pr-command';

let tmpDir: string;
let store: FileWorkItemStore;
let runCommand: ReturnType<typeof vi.fn>;
let broadcast: ReturnType<typeof vi.fn>;
let ctx: WorkItemExecutionCommandContext;

const GH_URL = 'https://github.com/example/repo.git';
const SHA_1 = '1111111111111111111111111111111111111111';
const SHA_2 = '2222222222222222222222222222222222222222';

/** Default happy-path git/gh responses for the create-PR service; tests override by command. */
function makeRunner(overrides: (command: string, args: string[]) => { stdout: string; stderr: string } | undefined = () => undefined) {
    return vi.fn(async (command: string, args: string[]) => {
        const override = overrides(command, args);
        if (override) return override;
        const line = `${command} ${args.join(' ')}`;
        if (line === 'git config --get remote.origin.url') return { stdout: `${GH_URL}\n`, stderr: '' };
        if (line === 'git symbolic-ref --quiet --short refs/remotes/origin/HEAD') return { stdout: 'origin/main\n', stderr: '' };
        const verify = /^git rev-parse --verify (\w+)\^\{commit\}$/.exec(line);
        if (verify) return { stdout: `${verify[1]}\n`, stderr: '' };
        if (line.startsWith('git rev-list --reverse --topo-order')) return { stdout: `${SHA_1}\n${SHA_2}\n`, stderr: '' };
        // No branch exists yet, locally or on origin.
        if (line.startsWith('git rev-parse --verify --quiet refs/')) throw new Error('missing ref');
        if (line.startsWith('gh pr list')) return { stdout: '[]', stderr: '' };
        if (line.startsWith('gh pr create')) return { stdout: 'https://github.com/example/repo/pull/321\n', stderr: '' };
        return { stdout: '', stderr: '' };
    });
}

function commandLines(): string[] {
    return runCommand.mock.calls.map(call => `${call[0]} ${(call[1] as string[]).join(' ')}`);
}

async function addReviewItem(overrides: Partial<WorkItem> = {}): Promise<void> {
    const now = new Date().toISOString();
    await store.addWorkItem({
        id: WORK_ITEM_ID,
        repoId: REPO_ID,
        title: 'Submit PR item',
        description: 'Create a PR from this work item.',
        status: 'aiDone',
        type: 'work-item',
        source: 'manual',
        tracker: { kind: 'local-only' },
        createdAt: now,
        updatedAt: now,
        plan: { version: 2, currentVersion: 2, content: '## Plan', updatedAt: now },
        currentContentVersion: 2,
        executionHistory: [{
            taskId: 'task-pr-command',
            status: 'completed',
            startedAt: now,
            completedAt: now,
            planVersion: 2,
            title: 'Code Implement',
        }],
        changes: [{
            id: 'change-pr-command',
            planVersion: 2,
            taskId: 'task-pr-command',
            startedAt: now,
            completedAt: now,
            status: 'closed',
            commits: [
                { sha: '1111111111111111111111111111111111111111', message: 'First commit' },
                { sha: '2222222222222222222222222222222222222222', message: 'Second commit' },
            ],
        }],
        ...overrides,
    } as WorkItem);
}

function submit(input: Record<string, unknown> = {}) {
    return submitWorkItemPrCommand(ctx, {
        workItemId: WORK_ITEM_ID,
        storageRepoId: REPO_ID,
        commandRepoId: REPO_ID,
        ...input,
    });
}

/**
 * Assert the command rejected with `messageFragment`. Pass `status` for the
 * policy failures the command raises as APIErrors; git/gh failures surface as
 * plain Errors that routes render as 400.
 */
async function expectFailure(promise: Promise<unknown>, messageFragment: string, status?: number): Promise<void> {
    let thrown: unknown;
    await promise.catch(err => { thrown = err; });
    expect(thrown, 'expected the command to reject').toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain(messageFragment);
    if (status !== undefined) {
        expect(thrown).toBeInstanceOf(APIError);
        expect((thrown as APIError).statusCode).toBe(status);
    }
}

describe('submitWorkItemPrCommand', () => {
    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'coc-wi-pr-command-'));
        store = new FileWorkItemStore({ dataDir: tmpDir });
        runCommand = makeRunner();
        broadcast = vi.fn();
        ctx = {
            workItemStore: store,
            processStore: {
                getWorkspaces: vi.fn().mockResolvedValue([{ id: REPO_ID, rootPath: path.join(tmpDir, 'repo') }]),
            } as any,
            runCommand: runCommand as unknown as WorkItemCommandRunner,
            getWsServer: () => ({ broadcastProcessEvent: broadcast }) as any,
        };
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('opens the PR from a temporary worktree without touching the workspace branch', async () => {
        await addReviewItem();

        const result = await submit({ branchName: 'coc/work-items/pr-command' });

        expect(result.prUrl).toBe('https://github.com/example/repo/pull/321');
        expect(result.prNumber).toBe(321);
        expect(result.branchName).toBe('coc/work-items/pr-command');
        expect(result.changeId).toBe('change-pr-command');
        expect(result.prStatus).toBe('open');
        const lines = commandLines();
        // Commits go oldest-first; the workspace branch/HEAD is never switched.
        expect(lines.indexOf(`git cherry-pick ${SHA_1}`)).toBeLessThan(lines.indexOf(`git cherry-pick ${SHA_2}`));
        expect(lines.some(l => /^git (switch|checkout|reset|status)/.test(l))).toBe(false);
        expect(lines.some(l => l.startsWith('git worktree add -b coc/work-items/pr-command '))).toBe(true);
        expect(lines).toContain('git push -u origin coc/work-items/pr-command');
        expect(lines.some(l => l.startsWith('git worktree remove --force'))).toBe(true);
        // Work Item PRs never turned auto-merge on.
        expect(lines.some(l => l.startsWith('gh pr merge'))).toBe(false);
        const create = runCommand.mock.calls.find(call => call[0] === 'gh' && (call[1] as string[])[1] === 'create')!;
        const args = create[1] as string[];
        expect(args[args.indexOf('--base') + 1]).toBe('main');
        expect(args[args.indexOf('--head') + 1]).toBe('coc/work-items/pr-command');
        expect(args[args.indexOf('--title') + 1]).toBe('Submit PR item');
        expect(args[args.indexOf('--body') + 1]).toBe([
            'Work Item: #1',
            '',
            'Create a PR from this work item.',
            '',
            '## Execution',
            '- Version: v2',
            '- Run: task-pr-command',
            '',
            '## Commits',
            '- 111111111111 First commit',
            '- 222222222222 Second commit',
        ].join('\n'));
    });

    it('settles the work item, change and execution after a successful submission', async () => {
        await addReviewItem();

        await submit({ branchName: 'coc/work-items/pr-command' });

        const updated = await store.getWorkItem(WORK_ITEM_ID, REPO_ID);
        expect(updated?.status).toBe('done');
        expect(updated?.completedAt).toBeTruthy();
        expect(updated?.changes?.[0]).toMatchObject({
            branchName: 'coc/work-items/pr-command',
            prNumber: 321,
            prUrl: 'https://github.com/example/repo/pull/321',
            prStatus: 'open',
        });
        expect(updated?.executionHistory?.[0].prUrl).toBe('https://github.com/example/repo/pull/321');
        expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({
            type: 'work-item-updated',
            workspaceId: REPO_ID,
        }));
    });

    it('binds the execution chat to the new PR', async () => {
        const db = new Database(':memory:');
        initializeDatabase(db);
        ctx.processStore = {
            getDatabase: () => db,
            getWorkspaces: vi.fn().mockResolvedValue([{ id: REPO_ID, rootPath: path.join(tmpDir, 'repo'), remoteUrl: GH_URL }]),
        } as any;
        await addReviewItem();

        await submit({ branchName: 'coc/work-items/pr-command' });

        expect(db.prepare('SELECT workspace_id, pr_id, task_id FROM pull_request_chat_bindings').all()).toEqual([{
            workspace_id: resolveCanonicalOriginId({ workspaceId: REPO_ID, remoteUrl: GH_URL }),
            pr_id: '321',
            task_id: 'task-pr-command',
        }]);
    });

    it('falls back to main when origin/HEAD is unavailable', async () => {
        await addReviewItem();
        runCommand = makeRunner((command, args) => {
            if (command === 'git' && (args[0] === 'symbolic-ref' || args[0] === 'ls-remote')) throw new Error('no origin/HEAD');
            return undefined;
        });
        ctx.runCommand = runCommand as unknown as WorkItemCommandRunner;

        await submit({ branchName: 'coc/work-items/pr-command' });

        expect(commandLines()).toContain('git fetch origin main');
    });

    it('generates a branch name from the title when none is supplied', async () => {
        await addReviewItem({ title: 'Fix the  Broken!! Thing' } as Partial<WorkItem>);

        const result = await submit();

        expect(result.branchName).toMatch(/^coc\/work-items\/fix-the-broken-thing-[a-z0-9]+$/);
    });

    it('submits from a dirty workspace, since the PR is built in a temporary worktree', async () => {
        await addReviewItem();
        runCommand = makeRunner((command, args) => {
            if (command === 'git' && args.join(' ') === 'status --porcelain') return { stdout: ' M src/a.ts\n', stderr: '' };
            return undefined;
        });
        ctx.runCommand = runCommand as unknown as WorkItemCommandRunner;

        const result = await submit();
        expect(result.prNumber).toBe(321);
    });

    it('rejects an unsafe base branch and an unsafe head branch', async () => {
        await addReviewItem();

        await expectFailure(submit({ baseBranch: 'main;rm -rf /' }), 'Invalid baseBranch');
        await expectFailure(submit({ branchName: 'feature/../escape' }), 'Invalid branchName');
        expect(runCommand).not.toHaveBeenCalled();
    });

    it('aborts on a cherry-pick conflict, cleans up, and leaves the work item untouched', async () => {
        await addReviewItem();
        runCommand = makeRunner((command, args) => {
            const line = `${command} ${args.join(' ')}`;
            if (line === `git cherry-pick ${SHA_2}`) throw new Error('cherry-pick conflict');
            if (line === 'git rev-parse --verify --quiet CHERRY_PICK_HEAD') return { stdout: `${SHA_2}\n`, stderr: '' };
            if (line === 'git status --porcelain') return { stdout: 'UU a.ts\n', stderr: '' };
            return undefined;
        });
        ctx.runCommand = runCommand as unknown as WorkItemCommandRunner;

        await expectFailure(submit({ branchName: 'coc/work-items/pr-command' }), `Cherry-picking ${SHA_2}`);

        const lines = commandLines();
        expect(lines).toContain('git cherry-pick --abort');
        expect(lines.some(l => l.startsWith('git worktree remove --force'))).toBe(true);
        expect(lines).toContain('git branch -D coc/work-items/pr-command');
        expect(lines.some(l => l.startsWith('git push'))).toBe(false);

        const untouched = await store.getWorkItem(WORK_ITEM_ID, REPO_ID);
        expect(untouched?.status).toBe('aiDone');
        expect(untouched?.changes?.[0].prUrl).toBeUndefined();
    });

    it('surfaces a push failure and deletes the temporary branch', async () => {
        await addReviewItem();
        runCommand = makeRunner((command, args) => {
            if (command === 'git' && args[0] === 'push') throw Object.assign(new Error('push failed'), { stderr: 'remote rejected' });
            return undefined;
        });
        ctx.runCommand = runCommand as unknown as WorkItemCommandRunner;

        await expectFailure(submit({ branchName: 'coc/work-items/pr-command' }), 'remote rejected');
        expect(commandLines()).toContain('git branch -D coc/work-items/pr-command');
    });

    it('fails when gh pr create returns no pull request URL', async () => {
        await addReviewItem();
        runCommand = makeRunner((command, args) => {
            if (command === 'gh' && args[1] === 'create') return { stdout: 'created something\n', stderr: '' };
            return undefined;
        });
        ctx.runCommand = runCommand as unknown as WorkItemCommandRunner;

        await expectFailure(submit({ branchName: 'coc/work-items/pr-command' }), 'did not return the created pull request');
        expect((await store.getWorkItem(WORK_ITEM_ID, REPO_ID))?.status).toBe('aiDone');
    });

    it('opens an Azure DevOps PR when origin is an ADO remote', async () => {
        await addReviewItem();
        const adoUrl = 'https://dev.azure.com/org/proj/_git/repo';
        runCommand = makeRunner((command, args) => {
            const line = `${command} ${args.join(' ')}`;
            if (line === 'git config --get remote.origin.url') return { stdout: `${adoUrl}\n`, stderr: '' };
            if (line.startsWith('az repos pr list')) return { stdout: '[]', stderr: '' };
            if (line.startsWith('az repos pr create')) {
                return { stdout: JSON.stringify({ pullRequestId: 55, repository: { webUrl: adoUrl } }), stderr: '' };
            }
            return undefined;
        });
        ctx.runCommand = runCommand as unknown as WorkItemCommandRunner;

        const result = await submit({ branchName: 'coc/work-items/pr-command' });

        expect(result.prNumber).toBe(55);
        expect(result.prUrl).toBe(`${adoUrl}/pullrequest/55`);
        expect(commandLines().some(l => l.startsWith('gh '))).toBe(false);
    });

    it('rejects items that are not local-only workflow leaves', async () => {
        await addReviewItem({ tracker: { kind: 'github', github: { issueNumber: 4 } } } as Partial<WorkItem>);
        await expectFailure(submit(), 'only available for local-only', 400);
    });

    it('rejects items that are not in Review', async () => {
        await addReviewItem({ status: 'inProgress' } as Partial<WorkItem>);
        await expectFailure(submit(), "Cannot submit PR in status 'inProgress'", 400);
    });

    it('returns 404 when the work item does not exist', async () => {
        await expectFailure(submit(), 'Work item', 404);
    });

    it('rejects a change that already has a PR', async () => {
        await addReviewItem();
        await store.updateChange(WORK_ITEM_ID, 'change-pr-command', { prUrl: 'https://github.com/example/repo/pull/1' }, REPO_ID);
        await expectFailure(submit({ changeId: 'change-pr-command' }), 'already has a submitted PR', 400);
    });

    it('rejects when the workspace root cannot be resolved', async () => {
        await addReviewItem();
        (ctx.processStore.getWorkspaces as any).mockResolvedValue([]);
        await expectFailure(submit(), 'Workspace root is not available', 400);
    });

    it('uses the storage scope for persistence and the command scope for git', async () => {
        const originId = 'gh_example_repo';
        store = new FileWorkItemStore({ dataDir: tmpDir });
        ctx.workItemStore = store;
        (ctx.processStore.getWorkspaces as any).mockResolvedValue([
            { id: 'clone-a', rootPath: path.join(tmpDir, 'clone-a') },
            { id: originId, rootPath: path.join(tmpDir, 'origin-checkout') },
        ]);
        await addReviewItem({ repoId: originId } as Partial<WorkItem>);

        const result = await submitWorkItemPrCommand(ctx, {
            workItemId: WORK_ITEM_ID,
            storageRepoId: originId,
            commandRepoId: 'clone-a',
            branchName: 'coc/work-items/pr-command',
        });

        expect(result.prUrl).toBe('https://github.com/example/repo/pull/321');
        const repoCalls = runCommand.mock.calls.filter(call => {
            const args = call[1] as string[];
            return args[0] === 'config' || args[0] === 'worktree';
        });
        expect(repoCalls.length).toBeGreaterThan(0);
        expect(repoCalls.every(call => (call[2] as { cwd: string }).cwd === path.join(tmpDir, 'clone-a'))).toBe(true);
        expect((await store.getWorkItem(WORK_ITEM_ID, originId))?.status).toBe('done');
        expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: originId }));
    });
});

describe('findSubmitPrChange', () => {
    const base = { planVersion: 1, startedAt: 'now', status: 'closed' as const };

    it('returns the newest closed change with commits and no PR', () => {
        const item = {
            changes: [
                { ...base, id: 'a', commits: [{ sha: 'a1', message: 'a' }] },
                { ...base, id: 'b', commits: [{ sha: 'b1', message: 'b' }] },
            ],
        } as unknown as WorkItem;
        expect(findSubmitPrChange(item, undefined)?.id).toBe('b');
    });

    it('skips open changes, empty changes and already-submitted changes', () => {
        const item = {
            changes: [
                { ...base, id: 'a', commits: [{ sha: 'a1', message: 'a' }] },
                { ...base, id: 'b', status: 'open', commits: [{ sha: 'b1', message: 'b' }] },
                { ...base, id: 'c', commits: [] },
                { ...base, id: 'd', commits: [{ sha: 'd1', message: 'd' }], prUrl: 'https://x/pull/1' },
            ],
        } as unknown as WorkItem;
        expect(findSubmitPrChange(item, undefined)?.id).toBe('a');
    });

    it('honors an explicit change id even when it would not be eligible by default', () => {
        const item = {
            changes: [{ ...base, id: 'a', status: 'open', commits: [] }],
        } as unknown as WorkItem;
        expect(findSubmitPrChange(item, 'a')?.id).toBe('a');
        expect(findSubmitPrChange(item, 'missing')).toBeUndefined();
    });

    it('returns undefined when there are no changes', () => {
        expect(findSubmitPrChange({} as WorkItem, undefined)).toBeUndefined();
    });
});
