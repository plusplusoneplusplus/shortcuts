import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { APIError } from '../../../src/server/errors';
import { FileWorkItemStore } from '../../../src/server/work-items/work-item-store';
import type { WorkItem } from '../../../src/server/work-items/types';
import type {
    WorkItemCommandRunner,
    WorkItemExecutionCommandContext,
} from '../../../src/server/work-items/work-item-execution-shared';
import {
    findSubmitPrChange,
    parsePrUrl,
    submitWorkItemPrCommand,
} from '../../../src/server/work-items/work-item-pr-submission-command';

const REPO_ID = 'pr-command-repo';
const WORK_ITEM_ID = 'wi-pr-command';

let tmpDir: string;
let store: FileWorkItemStore;
let runCommand: ReturnType<typeof vi.fn>;
let broadcast: ReturnType<typeof vi.fn>;
let ctx: WorkItemExecutionCommandContext;

/** Default happy-path git/gh responses; individual tests override by command. */
function makeRunner(overrides: (command: string, args: string[]) => { stdout: string; stderr: string } | undefined = () => undefined) {
    return vi.fn(async (command: string, args: string[]) => {
        const override = overrides(command, args);
        if (override) return override;
        const line = `${command} ${args.join(' ')}`;
        if (line === 'git status --porcelain') return { stdout: '', stderr: '' };
        if (line === 'git rev-parse --abbrev-ref HEAD') return { stdout: 'feature/current\n', stderr: '' };
        if (line === 'git symbolic-ref --quiet --short refs/remotes/origin/HEAD') return { stdout: 'origin/main\n', stderr: '' };
        if (command === 'gh' && args[0] === 'pr' && args[1] === 'create') {
            return { stdout: 'https://github.com/example/repo/pull/321\n', stderr: '' };
        }
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

    it('creates the branch, cherry-picks newest-first, pushes and opens the PR', async () => {
        await addReviewItem();

        const result = await submit({ branchName: 'coc/work-items/pr-command' });

        expect(result.prUrl).toBe('https://github.com/example/repo/pull/321');
        expect(result.prNumber).toBe(321);
        expect(result.branchName).toBe('coc/work-items/pr-command');
        expect(result.changeId).toBe('change-pr-command');
        expect(result.prStatus).toBe('open');
        expect(commandLines()).toEqual([
            'git status --porcelain',
            'git rev-parse --abbrev-ref HEAD',
            'git symbolic-ref --quiet --short refs/remotes/origin/HEAD',
            'git fetch origin main',
            'git switch -c coc/work-items/pr-command origin/main',
            'git cherry-pick 2222222222222222222222222222222222222222',
            'git cherry-pick 1111111111111111111111111111111111111111',
            'git push -u origin coc/work-items/pr-command',
            'gh pr create --title Submit PR item --body ' + [
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
            ].join('\n') + ' --base main --head coc/work-items/pr-command',
            'git switch feature/current',
        ]);
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

    it('falls back to main when origin/HEAD is unavailable', async () => {
        await addReviewItem();
        runCommand = makeRunner((command, args) => {
            if (command === 'git' && args[0] === 'symbolic-ref') throw new Error('no origin/HEAD');
            return undefined;
        });
        ctx.runCommand = runCommand as unknown as WorkItemCommandRunner;

        await submit({ branchName: 'coc/work-items/pr-command' });

        expect(commandLines()).toContain('git switch -c coc/work-items/pr-command origin/main');
    });

    it('generates a branch name from the title when none is supplied', async () => {
        await addReviewItem({ title: 'Fix the  Broken!! Thing' } as Partial<WorkItem>);

        const result = await submit();

        expect(result.branchName).toMatch(/^coc\/work-items\/fix-the-broken-thing-[a-z0-9]+$/);
    });

    it('refuses to submit from a dirty workspace before touching any branch', async () => {
        await addReviewItem();
        runCommand = makeRunner((command, args) => {
            if (command === 'git' && args.join(' ') === 'status --porcelain') return { stdout: ' M src/a.ts\n', stderr: '' };
            return undefined;
        });
        ctx.runCommand = runCommand as unknown as WorkItemCommandRunner;

        await expectFailure(submit(), 'uncommitted changes');
        expect(commandLines()).toEqual(['git status --porcelain']);
        expect((await store.getWorkItem(WORK_ITEM_ID, REPO_ID))?.status).toBe('aiDone');
    });

    it('refuses to submit from a detached HEAD', async () => {
        await addReviewItem();
        runCommand = makeRunner((command, args) => {
            if (command === 'git' && args.join(' ') === 'rev-parse --abbrev-ref HEAD') return { stdout: 'HEAD\n', stderr: '' };
            return undefined;
        });
        ctx.runCommand = runCommand as unknown as WorkItemCommandRunner;

        await expectFailure(submit(), 'detached HEAD');
        expect(commandLines()).not.toContain('git fetch origin main');
    });

    it('rejects an unsafe base branch and an unsafe head branch', async () => {
        await addReviewItem();

        await expectFailure(submit({ baseBranch: 'main;rm -rf /' }), 'Invalid baseBranch');
        await expectFailure(submit({ branchName: 'feature/../escape' }), 'Invalid branchName');
        expect(commandLines()).not.toContain('git fetch origin main');
    });

    it('aborts the cherry-pick and restores the original branch on failure', async () => {
        await addReviewItem();
        runCommand = makeRunner((command, args) => {
            if (command === 'git' && args[0] === 'cherry-pick' && args[1] === '1111111111111111111111111111111111111111') {
                throw new Error('cherry-pick conflict');
            }
            return undefined;
        });
        ctx.runCommand = runCommand as unknown as WorkItemCommandRunner;

        await expectFailure(submit({ branchName: 'coc/work-items/pr-command' }), 'cherry-pick conflict');

        const lines = commandLines();
        expect(lines).toContain('git cherry-pick --abort');
        expect(lines).toContain('git switch feature/current');
        expect(lines.indexOf('git cherry-pick --abort')).toBeLessThan(lines.indexOf('git switch feature/current'));
        expect(lines).not.toContain('git push -u origin coc/work-items/pr-command');

        const untouched = await store.getWorkItem(WORK_ITEM_ID, REPO_ID);
        expect(untouched?.status).toBe('aiDone');
        expect(untouched?.changes?.[0].prUrl).toBeUndefined();
    });

    it('restores the original branch when the push fails', async () => {
        await addReviewItem();
        runCommand = makeRunner((command, args) => {
            if (command === 'git' && args[0] === 'push') throw new Error('remote rejected');
            return undefined;
        });
        ctx.runCommand = runCommand as unknown as WorkItemCommandRunner;

        await expectFailure(submit({ branchName: 'coc/work-items/pr-command' }), 'remote rejected');
        expect(commandLines()).toContain('git switch feature/current');
    });

    it('fails when gh pr create returns no pull request URL', async () => {
        await addReviewItem();
        runCommand = makeRunner((command, args) => {
            if (command === 'gh' && args[0] === 'pr') return { stdout: 'created something\n', stderr: '' };
            return undefined;
        });
        ctx.runCommand = runCommand as unknown as WorkItemCommandRunner;

        await expectFailure(submit({ branchName: 'coc/work-items/pr-command' }), 'did not return a pull request URL');
        expect((await store.getWorkItem(WORK_ITEM_ID, REPO_ID))?.status).toBe('aiDone');
    });

    it('reads the PR URL from stderr when gh writes it there', async () => {
        await addReviewItem();
        runCommand = makeRunner((command, args) => {
            if (command === 'gh' && args[0] === 'pr') {
                return { stdout: '', stderr: 'Creating pull request...\nhttps://github.example.com/org/repo/pull/9\n' };
            }
            return undefined;
        });
        ctx.runCommand = runCommand as unknown as WorkItemCommandRunner;

        const result = await submit({ branchName: 'coc/work-items/pr-command' });
        expect(result.prUrl).toBe('https://github.example.com/org/repo/pull/9');
        expect(result.prNumber).toBe(9);
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
        expect(runCommand.mock.calls.every(call => (call[2] as { cwd: string }).cwd === path.join(tmpDir, 'clone-a'))).toBe(true);
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

describe('parsePrUrl', () => {
    it('extracts the URL and number from gh output', () => {
        expect(parsePrUrl('https://github.com/org/repo/pull/42\n')).toEqual({
            prUrl: 'https://github.com/org/repo/pull/42',
            prNumber: 42,
        });
    });

    it('tolerates a trailing slash and surrounding noise', () => {
        expect(parsePrUrl('Creating pull request\nhttps://github.com/org/repo/pull/7/ done')).toEqual({
            prUrl: 'https://github.com/org/repo/pull/7/',
            prNumber: 7,
        });
    });

    it('returns undefined when no pull request URL is present', () => {
        expect(parsePrUrl('https://github.com/org/repo/issues/42')).toBeUndefined();
        expect(parsePrUrl('')).toBeUndefined();
    });
});
