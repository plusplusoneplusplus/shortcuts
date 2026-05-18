import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebApi, getPersonalAccessTokenHandler } from 'azure-devops-node-api';
import type { GitPullRequestChange, GitPullRequestIteration } from 'azure-devops-node-api/interfaces/GitInterfaces';
import { AdoPullRequestsAdapter } from '../../../src/ado/ado-pull-requests-adapter';
import { AdoPullRequestsService, VersionControlChangeType } from '../../../src/ado/pull-requests-service';
import { createPullRequestDiffProviderFromParams, parseFullDiff } from '../../../src/diff';
import { nullLogger, setLogger } from '../../../src/logger';
import { changesKey, fileKey, MockAdoServer } from './mock-ado-server';

const PROJECT = 'mock-project';
const REAL_REPO = 'real-repo';
const WORKSPACE_REPO = 'workspace-id';
const PR_ID = 42;
const BASE_SHA = 'base-sha';
const HEAD_SHA = 'head-sha';

describe('Mock ADO server diff integration', () => {
    let server: MockAdoServer;

    beforeEach(async () => {
        server = new MockAdoServer();
        await server.start();
        setLogger(nullLogger);
    });

    afterEach(async () => {
        await server.stop();
        setLogger(nullLogger);
    });

    it('drives the real ADO service and adapter through happy-path PR tab calls', async () => {
        server.setScenario({
            expectedRepositoryId: REAL_REPO,
            prs: new Map([[PR_ID, { pullRequestId: PR_ID, title: 'Mock PR' }]]),
            threads: new Map([[PR_ID, [{ id: 7, comments: [{ id: 1, content: 'Looks good' }] }]]]),
            iterations: latestIteration(),
            changes: new Map([[changesKey(PR_ID, 2), [
                change('/src/modified.ts', VersionControlChangeType.Edit),
                change('/src/added.ts', VersionControlChangeType.Add),
                change('/src/deleted.ts', VersionControlChangeType.Delete),
                change('/src/renamed.ts', VersionControlChangeType.Rename, '/src/original.ts'),
            ]]]),
            files: new Map([
                [fileKey(BASE_SHA, '/src/modified.ts'), 'old line\nsame\n'],
                [fileKey(HEAD_SHA, '/src/modified.ts'), 'new line\nsame\n'],
                [fileKey(HEAD_SHA, '/src/added.ts'), 'added\nfile\n'],
                [fileKey(BASE_SHA, '/src/deleted.ts'), 'deleted\nfile\n'],
                [fileKey(BASE_SHA, '/src/renamed.ts'), 'before rename\n'],
                [fileKey(HEAD_SHA, '/src/renamed.ts'), 'after rename\n'],
            ]),
        });

        const adapter = makeAdapter(REAL_REPO);

        await expect(adapter.getPullRequest(WORKSPACE_REPO, PR_ID)).resolves.toMatchObject({
            id: PR_ID,
            title: 'Mock PR',
        });
        await expect(adapter.getThreads(WORKSPACE_REPO, PR_ID)).resolves.toHaveLength(1);

        const diff = await adapter.getDiff(WORKSPACE_REPO, PR_ID);
        const { files } = parseFullDiff(diff);

        expect(files).toHaveLength(4);
        expect(files).toEqual(expect.arrayContaining([
            expect.objectContaining({ path: 'src/added.ts', status: 'added', additions: 2, deletions: 0 }),
            expect.objectContaining({ path: 'src/deleted.ts', status: 'deleted', additions: 0, deletions: 2 }),
            expect.objectContaining({ path: 'src/modified.ts', status: 'modified', additions: 1, deletions: 1 }),
            expect.objectContaining({ path: 'src/renamed.ts', originalPath: 'src/original.ts' }),
        ]));
        expect(requestedRepositories()).toEqual(expect.arrayContaining([REAL_REPO]));
        expect(requestedRepositories()).not.toContain(WORKSPACE_REPO);
    });

    it('uses the latest iteration and pins current empty-diff behavior when commonRefCommit is missing', async () => {
        server.setScenario({
            expectedRepositoryId: REAL_REPO,
            iterations: new Map([[PR_ID, [
                iteration(1, 'head-1', 'base-1'),
                { id: 2, sourceRefCommit: { commitId: HEAD_SHA } },
            ]]]),
        });

        const diff = await makeAdapter(REAL_REPO).getDiff(WORKSPACE_REPO, PR_ID);

        expect(diff).toBe('');
        expect(server.requests.some(r => r.path.toLowerCase().includes('/changes'))).toBe(false);
    });

    it('pins current empty-diff behavior when ADO reports no change entries', async () => {
        server.setScenario({
            expectedRepositoryId: REAL_REPO,
            iterations: latestIteration(),
            changes: new Map([[changesKey(PR_ID, 2), []]]),
        });

        const diff = await makeAdapter(REAL_REPO).getDiff(WORKSPACE_REPO, PR_ID);

        expect(diff).toBe('');
        expect(server.requests.some(r => r.path.toLowerCase().includes('/items'))).toBe(false);
    });

    it('preserves current getItemText transport error swallowing as empty file content', async () => {
        server.setScenario({
            expectedRepositoryId: REAL_REPO,
            iterations: latestIteration(),
            changes: new Map([[changesKey(PR_ID, 2), [
                change('/src/protected.ts', VersionControlChangeType.Edit),
            ]]]),
            files: new Map([
                [fileKey(BASE_SHA, '/src/protected.ts'), { reset: true }],
                [fileKey(HEAD_SHA, '/src/protected.ts'), 'visible head\n'],
            ]),
        });

        const diff = await makeAdapter(REAL_REPO).getDiff(WORKSPACE_REPO, PR_ID);
        const { files } = parseFullDiff(diff);

        expect(files).toEqual([
            expect.objectContaining({ path: 'src/protected.ts', status: 'added', additions: 1, deletions: 0 }),
        ]);
    });

    it('handles large files and provider-level line truncation without losing file boundaries', async () => {
        const base = makeLargeFile('base', 5_000, new Map([[100, 'base changed'], [2500, 'base middle']]));
        const head = makeLargeFile('base', 5_000, new Map([[100, 'head changed'], [2500, 'head middle']]));
        server.setScenario({
            expectedRepositoryId: REAL_REPO,
            iterations: latestIteration(),
            changes: new Map([[changesKey(PR_ID, 2), [
                change('/src/large.ts', VersionControlChangeType.Edit),
            ]]]),
            files: new Map([
                [fileKey(BASE_SHA, '/src/large.ts'), base],
                [fileKey(HEAD_SHA, '/src/large.ts'), head],
            ]),
        });

        const adapter = makeAdapter(REAL_REPO);
        const provider = createPullRequestDiffProviderFromParams(
            'ado',
            'mock-root',
            WORKSPACE_REPO,
            PR_ID,
            adapter,
        );

        const files = await provider.listFiles();
        const content = await provider.getFileDiff('src/large.ts', { maxLines: 20 });

        expect(files).toEqual([expect.objectContaining({ path: 'src/large.ts' })]);
        expect(content.truncated).toBe(true);
        expect(content.totalLines).toBeGreaterThan(20);
        expect(content.raw.split('\n')).toHaveLength(20);
    });

    it('regresses multi-repo routing by failing without a configured remote repo and succeeding with one', async () => {
        server.setScenario({
            expectedRepositoryId: REAL_REPO,
            iterations: latestIteration(),
            changes: new Map([[changesKey(PR_ID, 2), [
                change('/src/file.ts', VersionControlChangeType.Edit),
            ]]]),
            files: new Map([
                [fileKey(BASE_SHA, '/src/file.ts'), 'before\n'],
                [fileKey(HEAD_SHA, '/src/file.ts'), 'after\n'],
            ]),
        });

        await expect(makeAdapter().getDiff(WORKSPACE_REPO, PR_ID)).resolves.toBe('');
        await expect(makeAdapter(REAL_REPO).getDiff(WORKSPACE_REPO, PR_ID)).resolves.toContain('src/file.ts');
    });

    function makeAdapter(repoOverride?: string): AdoPullRequestsAdapter {
        const connection = new WebApi(server.url, getPersonalAccessTokenHandler('fake'));
        const service = new AdoPullRequestsService(connection);
        return new AdoPullRequestsAdapter(service, PROJECT, repoOverride);
    }

    function requestedRepositories(): string[] {
        return server.requests
            .map(r => r.path.match(/\/repositories\/([^/]+)/i)?.[1])
            .filter((repo): repo is string => Boolean(repo))
            .map(decodeURIComponent);
    }
});

function latestIteration(): Map<number, GitPullRequestIteration[]> {
    return new Map([[PR_ID, [
        iteration(1, 'previous-head', 'previous-base'),
        iteration(2, HEAD_SHA, BASE_SHA),
    ]]]);
}

function iteration(id: number, headSha: string, baseSha: string): GitPullRequestIteration {
    return {
        id,
        sourceRefCommit: { commitId: headSha },
        commonRefCommit: { commitId: baseSha },
    };
}

function change(path: string, changeType: VersionControlChangeType, originalPath?: string): GitPullRequestChange {
    return {
        item: { path, originalPath },
        changeType,
    } as GitPullRequestChange;
}

function makeLargeFile(prefix: string, lineCount: number, replacements: Map<number, string>): string {
    return Array.from({ length: lineCount }, (_, i) => replacements.get(i + 1) ?? `${prefix} line ${i + 1}`).join('\n') + '\n';
}
