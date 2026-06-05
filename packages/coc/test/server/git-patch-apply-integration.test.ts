import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import { createRouter } from '../../src/server/shared/router';
import { registerApiRoutes } from '../../src/server/core/api-handler';
import type { Route } from '../../src/server/types';
import { createMockProcessStore } from './helpers/mock-process-store';

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
        if (options.body) req.write(options.body);
        req.end();
    });
}

function git(repoRoot: string, args: string[], env?: NodeJS.ProcessEnv): string {
    return execFileSync('git', args, {
        cwd: repoRoot,
        encoding: 'utf-8',
        env: {
            ...process.env,
            GIT_TERMINAL_PROMPT: '0',
            ...env,
        },
    }).trim();
}

async function writeRepoFile(repoRoot: string, relativePath: string, content: string): Promise<void> {
    const filePath = path.join(repoRoot, relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf-8');
}

async function createRepos(): Promise<{ root: string; dataDir: string; source: string; target: string }> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'coc-git-patch-apply-'));
    const dataDir = path.join(root, 'data');
    const source = path.join(root, 'source');
    const target = path.join(root, 'target');

    await fs.mkdir(source, { recursive: true });
    git(source, ['init', '-b', 'main']);
    git(source, ['config', 'user.name', 'Source Committer']);
    git(source, ['config', 'user.email', 'source-committer@example.test']);
    await writeRepoFile(source, 'shared.txt', 'base\n');
    git(source, ['add', 'shared.txt']);
    git(source, ['commit', '-m', 'Base commit'], {
        GIT_AUTHOR_NAME: 'Base Author',
        GIT_AUTHOR_EMAIL: 'base-author@example.test',
        GIT_AUTHOR_DATE: '2026-06-04T04:00:00+00:00',
        GIT_COMMITTER_DATE: '2026-06-04T04:00:00+00:00',
    });

    execFileSync('git', ['clone', source, target], { cwd: root, stdio: 'pipe' });
    git(target, ['config', 'user.name', 'Target Committer']);
    git(target, ['config', 'user.email', 'target-committer@example.test']);

    await writeRepoFile(source, 'shared.txt', 'source change\n');
    git(source, ['add', 'shared.txt']);
    git(source, ['commit', '-m', 'Apply transferred patch'], {
        GIT_AUTHOR_NAME: 'Patch Author',
        GIT_AUTHOR_EMAIL: 'patch-author@example.test',
        GIT_AUTHOR_DATE: '2026-06-04T04:01:00+00:00',
        GIT_COMMITTER_DATE: '2026-06-04T04:01:00+00:00',
    });

    return { root, dataDir, source, target };
}

describe('git patch apply API integration', () => {
    let server: http.Server;
    let port: number;
    let tmpRoot: string;
    let sourceRoot: string;
    let targetRoot: string;
    let broadcastGitChanged: ReturnType<typeof vi.fn>;

    const SOURCE_WS = 'ws-source-patch';
    const TARGET_WS = 'ws-target-patch';
    const base = () => `http://127.0.0.1:${port}`;

    beforeEach(async () => {
        const repos = await createRepos();
        tmpRoot = repos.root;
        sourceRoot = repos.source;
        targetRoot = repos.target;
        broadcastGitChanged = vi.fn();

        const store = createMockProcessStore({
            initialWorkspaces: [
                {
                    id: SOURCE_WS,
                    name: 'Source Clone',
                    rootPath: sourceRoot,
                    remoteUrl: 'https://example.test/org/repo.git',
                },
                {
                    id: TARGET_WS,
                    name: 'Target Clone',
                    rootPath: targetRoot,
                    remoteUrl: 'https://example.test/org/repo.git',
                },
            ],
        });
        const routes: Route[] = [];
        registerApiRoutes(
            routes,
            store,
            undefined,
            repos.dataDir,
            () => ({ broadcastGitChanged }) as any,
        );
        server = http.createServer(createRouter({ routes, spaHtml: '<html></html>' }));
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        port = (server.address() as any).port;
    });

    afterEach(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await fs.rm(tmpRoot, { recursive: true, force: true });
    });

    async function exportSourcePatch(): Promise<any> {
        const sourceHash = git(sourceRoot, ['rev-parse', 'HEAD']);
        const exportRes = await request(`${base()}/api/workspaces/${SOURCE_WS}/git/patch/export`, {
            method: 'POST',
            body: JSON.stringify({ hash: sourceHash }),
        });
        expect(exportRes.status).toBe(200);
        return exportRes.json();
    }

    it('applies a patch from one registered local clone to another and preserves source author/message', async () => {
        const exportBody = await exportSourcePatch();

        const applyRes = await request(`${base()}/api/workspaces/${TARGET_WS}/git/patch/apply`, {
            method: 'POST',
            body: JSON.stringify(exportBody),
        });

        expect(applyRes.status, applyRes.body).toBe(200);
        const applyBody = applyRes.json();
        expect(applyBody.targetWorkspace).toEqual({ id: TARGET_WS, name: 'Target Clone' });
        expect(applyBody.targetBranch).toBe('main');
        expect(applyBody.newCommitHash).toMatch(/^[a-f0-9]{40}$/);
        expect(applyBody.targetHead).toBe(applyBody.newCommitHash);
        expect(applyBody.operation).toMatchObject({
            workspaceId: TARGET_WS,
            op: 'cherry-pick-transfer',
            status: 'success',
            metadata: {
                kind: 'patch-transfer',
                sourceWorkspace: { id: SOURCE_WS, name: 'Source Clone' },
                sourceCommit: {
                    hash: exportBody.sourceCommit.hash,
                    subject: 'Apply transferred patch',
                    author: {
                        name: 'Patch Author',
                        email: 'patch-author@example.test',
                    },
                },
                normalizedSourceRemoteUrl: 'example.test/org/repo',
                targetWorkspace: { id: TARGET_WS, name: 'Target Clone' },
                targetBranch: 'main',
                newCommitHash: applyBody.newCommitHash,
            },
        });

        const [subject, authorName, authorEmail] = git(targetRoot, ['log', '-1', '--format=%s%x00%an%x00%ae']).split('\0');
        expect(subject).toBe('Apply transferred patch');
        expect(authorName).toBe('Patch Author');
        expect(authorEmail).toBe('patch-author@example.test');
        expect(broadcastGitChanged).toHaveBeenCalledWith(TARGET_WS, 'patch-apply');

        const latestRes = await request(`${base()}/api/workspaces/${TARGET_WS}/git/ops/latest?op=cherry-pick-transfer`);
        expect(latestRes.status, latestRes.body).toBe(200);
        const latest = latestRes.json();
        expect(latest.id).toBe(applyBody.operation.id);
        expect(latest).toMatchObject({
            workspaceId: TARGET_WS,
            op: 'cherry-pick-transfer',
            status: 'success',
            metadata: {
                sourceWorkspace: { id: SOURCE_WS, name: 'Source Clone' },
                sourceCommit: { hash: exportBody.sourceCommit.hash },
                targetWorkspace: { id: TARGET_WS, name: 'Target Clone' },
                targetBranch: 'main',
                newCommitHash: applyBody.newCommitHash,
            },
        });
        expect(JSON.stringify(latest)).not.toContain(sourceRoot);
        expect(JSON.stringify(latest)).not.toContain(targetRoot);
    });

    it('blocks dirty targets by default and applies after explicit stashAndContinue', async () => {
        const { patch } = await exportSourcePatch();
        const originalHead = git(targetRoot, ['rev-parse', 'HEAD']);
        await writeRepoFile(targetRoot, 'local-notes.txt', 'local dirty work\n');

        const blockedRes = await request(`${base()}/api/workspaces/${TARGET_WS}/git/patch/apply`, {
            method: 'POST',
            body: JSON.stringify({ patch }),
        });
        expect(blockedRes.status, blockedRes.body).toBe(409);
        expect(blockedRes.json().dirty).toBe(true);
        expect(git(targetRoot, ['rev-parse', 'HEAD'])).toBe(originalHead);

        const stashRes = await request(`${base()}/api/workspaces/${TARGET_WS}/git/patch/apply`, {
            method: 'POST',
            body: JSON.stringify({ patch, stashAndContinue: true }),
        });
        expect(stashRes.status, stashRes.body).toBe(200);
        expect(stashRes.json().stashed).toBe(true);
        expect(git(targetRoot, ['log', '-1', '--format=%s'])).toBe('Apply transferred patch');
        expect(git(targetRoot, ['stash', 'list'])).toContain('CoC patch-transfer cherry-pick');
    });

    it('returns conflict-style 409 and leaves git am state in progress on patch conflicts', async () => {
        const { patch } = await exportSourcePatch();
        await writeRepoFile(targetRoot, 'shared.txt', 'target change\n');
        git(targetRoot, ['add', 'shared.txt']);
        git(targetRoot, ['commit', '-m', 'Target conflicting change']);

        const conflictRes = await request(`${base()}/api/workspaces/${TARGET_WS}/git/patch/apply`, {
            method: 'POST',
            body: JSON.stringify({ patch }),
        });

        expect(conflictRes.status, conflictRes.body).toBe(409);
        const body = conflictRes.json();
        expect(body.conflicts).toBe(true);
        expect(body.gitState).toMatchObject({ operation: 'cherry-pick', gitOperation: 'am' });
        await expect(fs.access(path.join(targetRoot, '.git', 'rebase-apply'))).resolves.toBeUndefined();
    });
});
