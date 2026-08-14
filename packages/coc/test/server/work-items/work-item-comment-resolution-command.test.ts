import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { APIError } from '../../../src/server/errors';
import { DiffCommentsManager } from '../../../src/server/tasks/comments/diff-comments-manager';
import { TaskCommentsManager } from '../../../src/server/tasks/comments/task-comments-manager';
import { FileWorkItemStore } from '../../../src/server/work-items/work-item-store';
import type { WorkItem } from '../../../src/server/work-items/types';
import {
    parseCommentResolutionType,
    planCommentDocumentPath,
    resolveWorkItemCommentsCommand,
    type WorkItemCommentResolutionContext,
} from '../../../src/server/work-items/work-item-comment-resolution-command';

const REPO_ID = 'resolve-repo';
const WORK_ITEM_ID = 'wi-resolve';
const COMMIT_SHA = 'f'.repeat(40);

let tmpDir: string;
let store: FileWorkItemStore;
let enqueue: ReturnType<typeof vi.fn>;
let enqueued: any;
let taskCommentsManager: TaskCommentsManager;
let diffCommentsManager: DiffCommentsManager;
let ctx: WorkItemCommentResolutionContext;

async function addItem(overrides: Partial<WorkItem> = {}): Promise<void> {
    const now = new Date().toISOString();
    await store.addWorkItem({
        id: WORK_ITEM_ID,
        repoId: REPO_ID,
        title: 'Resolve me',
        description: '',
        status: 'inProgress',
        type: 'work-item',
        source: 'manual',
        createdAt: now,
        updatedAt: now,
        plan: { version: 1, currentVersion: 1, content: '## Plan\nLine one\nLine two', updatedAt: now },
        currentContentVersion: 1,
        ...overrides,
    } as WorkItem);
}

async function addPlanComment(text: string, status: 'open' | 'resolved' = 'open'): Promise<void> {
    await taskCommentsManager.addComment(REPO_ID, planCommentDocumentPath(WORK_ITEM_ID), {
        filePath: planCommentDocumentPath(WORK_ITEM_ID),
        selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 5 },
        selectedText: 'Plan',
        comment: text,
        status,
    } as any);
}

async function addDiffComment(filePath: string, text: string, status: 'open' | 'resolved' = 'open'): Promise<void> {
    await diffCommentsManager.addComment(REPO_ID, {
        repositoryId: REPO_ID,
        filePath,
        oldRef: `${COMMIT_SHA}^`,
        newRef: COMMIT_SHA,
    }, {
        context: {
            repositoryId: REPO_ID,
            filePath,
            oldRef: `${COMMIT_SHA}^`,
            newRef: COMMIT_SHA,
        },
        selection: { startLine: 1, endLine: 1, side: 'new' },
        selectedText: 'const a = 1;',
        comment: text,
        status,
    } as any);
}

function resolve(input: Record<string, unknown>) {
    return resolveWorkItemCommentsCommand(ctx, {
        workItemId: WORK_ITEM_ID,
        storageRepoId: REPO_ID,
        commandRepoId: REPO_ID,
        type: 'plan',
        ...input,
    } as any);
}

describe('resolveWorkItemCommentsCommand', () => {
    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'coc-wi-resolve-cmd-'));
        store = new FileWorkItemStore({ dataDir: tmpDir });
        taskCommentsManager = new TaskCommentsManager(tmpDir);
        diffCommentsManager = new DiffCommentsManager(tmpDir);
        enqueued = undefined;
        enqueue = vi.fn(async (task: any) => { enqueued = task; return 'task-resolve-1'; });
        ctx = {
            workItemStore: store,
            processStore: {
                getWorkspaces: vi.fn().mockResolvedValue([{ id: REPO_ID, rootPath: path.join(tmpDir, 'checkout') }]),
            } as any,
            enqueue: enqueue as any,
            dataDir: tmpDir,
            taskCommentsManager,
            diffCommentsManager,
        };
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    describe('plan comments', () => {
        it('builds a plan resolve session from the open comments and the current plan content', async () => {
            await addItem();
            await addPlanComment('Tighten this section');
            await addPlanComment('Already handled', 'resolved');

            await resolve({ type: 'plan', model: 'claude-opus-5' });

            const planPath = planCommentDocumentPath(WORK_ITEM_ID);
            expect(enqueued.payload.context.files).toEqual([planPath]);
            expect(enqueued.payload.context.resolveComments.documentUri).toBe(planPath);
            expect(enqueued.payload.context.resolveComments.filePath).toBe(planPath);
            expect(enqueued.payload.context.resolveComments.wsId).toBe(REPO_ID);
            expect(enqueued.payload.context.resolveComments.documentContent).toContain('Line one');
            expect(enqueued.payload.context.resolveComments.commentIds).toHaveLength(1);
            expect(enqueued.payload.prompt).toContain('Tighten this section');
            expect(enqueued.payload.prompt).not.toContain('Already handled');
        });

        it('rejects when there are no open plan comments', async () => {
            await addItem();
            await addPlanComment('Already handled', 'resolved');

            await expect(resolve({ type: 'plan' })).rejects.toThrow('No open plan comments to resolve');
            expect(enqueue).not.toHaveBeenCalled();
        });

        it('records the resolve run in execution history on the storage scope', async () => {
            await addItem();
            await addPlanComment('Tighten this section');

            await resolve({ type: 'plan' });

            const updated = await store.getWorkItem(WORK_ITEM_ID, REPO_ID);
            expect(updated?.executionHistory?.some(e => e.taskId === 'task-resolve-1')).toBe(true);
        });
    });

    describe('commit comments', () => {
        it('groups comments by storage key and resolves file paths against the workspace root', async () => {
            await addItem();
            await addDiffComment('src/a.ts', 'Rename this');
            await addDiffComment('src/a.ts', 'And this');
            await addDiffComment('src/b.ts', 'Guard the null case');
            await addDiffComment('src/b.ts', 'Done already', 'resolved');

            await resolve({ type: 'commit', commitSha: COMMIT_SHA, sourceRunIndex: 2 });

            const multi = enqueued.payload.context.resolveDiffCommentsMulti;
            expect(multi.wsId).toBe(REPO_ID);
            expect(multi.oldRef).toBe(`${COMMIT_SHA}^`);
            expect(multi.newRef).toBe(COMMIT_SHA);
            expect(multi.files).toHaveLength(2);
            const byPath = Object.fromEntries(multi.files.map((f: any) => [f.filePath, f]));
            expect(byPath['src/a.ts'].commentIds).toHaveLength(2);
            expect(byPath['src/b.ts'].commentIds).toHaveLength(1);
            expect(new Set(multi.files.map((f: any) => f.storageKey)).size).toBe(2);

            const root = path.join(tmpDir, 'checkout');
            expect(enqueued.payload.context.files.sort()).toEqual([
                path.resolve(root, 'src/a.ts'),
                path.resolve(root, 'src/b.ts'),
            ].sort());
            expect(enqueued.payload.prompt).toContain('Rename this');
            expect(enqueued.payload.prompt).toContain('Guard the null case');
            expect(enqueued.payload.prompt).not.toContain('Done already');
        });

        it('falls back to the server cwd when the workspace root is unknown', async () => {
            await addItem();
            await addDiffComment('src/a.ts', 'Rename this');
            (ctx.processStore.getWorkspaces as any).mockResolvedValue([]);

            await resolve({ type: 'commit', commitSha: COMMIT_SHA });

            expect(enqueued.payload.context.files).toEqual([path.resolve(process.cwd(), 'src/a.ts')]);
        });

        it('requires a commitSha', async () => {
            await addItem();

            await expect(resolve({ type: 'commit' })).rejects.toThrow('Missing required field: commitSha');
            expect(enqueue).not.toHaveBeenCalled();
        });

        it('rejects when no open diff comments exist for the commit', async () => {
            await addItem();
            await addDiffComment('src/a.ts', 'Done already', 'resolved');

            await expect(resolve({ type: 'commit', commitSha: COMMIT_SHA })).rejects.toThrow('No open diff comments');
        });

        it('ignores comments recorded against a different commit', async () => {
            await addItem();
            await diffCommentsManager.addComment(REPO_ID, {
                repositoryId: REPO_ID,
                filePath: 'src/other.ts',
                oldRef: 'deadbeef^',
                newRef: 'deadbeef',
            }, {
                context: { repositoryId: REPO_ID, filePath: 'src/other.ts', oldRef: 'deadbeef^', newRef: 'deadbeef' },
                selection: { startLine: 1, endLine: 1, side: 'new' },
                selectedText: 'x',
                comment: 'Other commit',
                status: 'open',
            } as any);

            await expect(resolve({ type: 'commit', commitSha: COMMIT_SHA })).rejects.toThrow('No open diff comments');
        });
    });

    it('keeps the storage scope for history and the command scope for comment lookup', async () => {
        const originId = 'gh_example_repo';
        await addItem({ repoId: originId } as Partial<WorkItem>);
        await taskCommentsManager.addComment('clone-a', planCommentDocumentPath(WORK_ITEM_ID), {
            filePath: planCommentDocumentPath(WORK_ITEM_ID),
            selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 5 },
            selectedText: 'Plan',
            comment: 'Scoped to the clone',
            status: 'open',
        } as any);

        await resolveWorkItemCommentsCommand(ctx, {
            workItemId: WORK_ITEM_ID,
            storageRepoId: originId,
            commandRepoId: 'clone-a',
            type: 'plan',
        });

        expect(enqueued.repoId).toBe('clone-a');
        expect(enqueued.payload.prompt).toContain('Scoped to the clone');
        expect((await store.getWorkItem(WORK_ITEM_ID, originId))?.executionHistory?.[0].taskId).toBe('task-resolve-1');
    });

    it('rejects container types before touching comment storage', async () => {
        await addItem({ type: 'epic' } as Partial<WorkItem>);

        await expect(resolve({ type: 'plan' })).rejects.toThrow('planning container');
    });

    it('returns 404 for a missing work item', async () => {
        await expect(resolve({ type: 'plan' })).rejects.toMatchObject({ statusCode: 404 });
    });
});

describe('parseCommentResolutionType', () => {
    it('accepts the two supported types', () => {
        expect(parseCommentResolutionType('plan')).toBe('plan');
        expect(parseCommentResolutionType('commit')).toBe('commit');
    });

    it('rejects anything else with a 400', () => {
        for (const value of [undefined, null, '', 'diff', 3, {}]) {
            let thrown: unknown;
            try { parseCommentResolutionType(value); } catch (err) { thrown = err; }
            expect(thrown).toBeInstanceOf(APIError);
            expect((thrown as APIError).statusCode).toBe(400);
            expect((thrown as APIError).message).toContain('type');
        }
    });
});
