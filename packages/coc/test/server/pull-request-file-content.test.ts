import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadNativeGit, NativeAddonLoadError } from '@plusplusoneplusplus/coc-native';
import type { ProviderPullRequest } from '@plusplusoneplusplus/forge';
import {
    clearPullRequestFileContentCache,
    loadPullRequestFileContent,
    PullRequestFileContentError,
    type PullRequestFileCliRunner,
} from '../../src/server/git/pull-request-file-content';
import { MAX_WORKING_TREE_CONTENT_BYTES } from '../../src/server/git/working-tree-file-content';

const BASE_SHA = '1111111111111111111111111111111111111111';
const HEAD_SHA = '2222222222222222222222222222222222222222';
const GITHUB_REMOTE = 'https://github.com/acme/widgets.git';
const ADO_REMOTE = 'https://dev.azure.com/acme/widgets/_git/api';

const tempDirs: string[] = [];

function tempRepo(): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'coc-pr-content-'));
    tempDirs.push(dir);
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: dir });
    return dir;
}

function writeRepoFile(repo: string, filePath: string, content: string): void {
    const absolutePath = path.join(repo, filePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content);
}

function commit(repo: string, message: string): string {
    execFileSync('git', ['add', '.'], { cwd: repo });
    execFileSync('git', ['commit', '-qm', message], { cwd: repo });
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
}

function pullRequest(baseSha = BASE_SHA, headSha = HEAD_SHA): ProviderPullRequest {
    return { baseSha, headSha } as ProviderPullRequest;
}

function diffFor(filePath: string, options?: { status?: 'added' | 'deleted'; oldPath?: string }): string {
    const oldPath = options?.oldPath ?? filePath;
    const header = [
        `diff --git a/${oldPath} b/${filePath}`,
        ...(options?.oldPath ? [`similarity index 100%`, `rename from ${oldPath}`, `rename to ${filePath}`] : []),
        ...(options?.status === 'added' ? ['new file mode 100644', '--- /dev/null', `+++ b/${filePath}`] : []),
        ...(options?.status === 'deleted' ? ['deleted file mode 100644', `--- a/${filePath}`, '+++ /dev/null'] : []),
        ...(!options?.status && !options?.oldPath ? [`--- a/${filePath}`, `+++ b/${filePath}`, '@@ -1 +1 @@', '-old', '+new'] : []),
    ];
    return header.join('\n');
}

function request(
    repoRoot: string,
    overrides: Partial<Parameters<typeof loadPullRequestFileContent>[0]> = {},
): Parameters<typeof loadPullRequestFileContent>[0] {
    return {
        repoRoot,
        remoteUrl: GITHUB_REMOTE,
        originId: 'origin-a',
        prId: '42',
        filePath: 'src/file.ts',
        pullRequest: pullRequest(),
        getProviderDiff: async () => diffFor('src/file.ts'),
        ...overrides,
    };
}

beforeEach(() => clearPullRequestFileContentCache());

afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('pull request file content', () => {
    it('reads both sides from local git objects without calling the provider', async () => {
        const repo = tempRepo();
        writeRepoFile(repo, 'src/file.ts', 'before\r\n');
        const baseSha = commit(repo, 'base');
        writeRepoFile(repo, 'src/file.ts', 'after\r\n');
        const headSha = commit(repo, 'head');
        const getProviderDiff = vi.fn(async () => '');
        const runCommand = vi.fn<PullRequestFileCliRunner>();

        const result = await loadPullRequestFileContent(request(repo, {
            pullRequest: pullRequest(baseSha, headSha),
            getProviderDiff,
            runCommand,
        }));

        expect(result.base).toEqual({ content: 'before\r\n', ref: baseSha, exists: true });
        expect(result.head).toEqual({ content: 'after\r\n', ref: headSha, exists: true });
        expect(getProviderDiff).not.toHaveBeenCalled();
        expect(runCommand).not.toHaveBeenCalled();
    });

    it('falls back to gh for missing local objects', async () => {
        const repo = tempRepo();
        const runCommand = vi.fn<PullRequestFileCliRunner>(async (_command, args) => ({
            stdout: Buffer.from(args.includes(`ref=${BASE_SHA}`) ? 'base\r\n' : 'head\r\n'),
            stderr: '',
        }));

        const result = await loadPullRequestFileContent(request(repo, { runCommand }));

        expect(result.base.content).toBe('base\r\n');
        expect(result.head.content).toBe('head\r\n');
        expect(runCommand).toHaveBeenCalledTimes(2);
        expect(runCommand.mock.calls[0][0]).toBe('gh');
        expect(runCommand.mock.calls[0][1]).toContain('repos/acme/widgets/contents/src/file.ts');
    });

    it('falls back to Azure CLI for missing local objects', async () => {
        const repo = tempRepo();
        const runCommand = vi.fn<PullRequestFileCliRunner>(async (_command, args) => ({
            stdout: JSON.stringify({
                content: args.includes(`versionDescriptor.version=${BASE_SHA}`) ? 'base\r\n' : 'head\r\n',
                contentMetadata: { isBinary: false },
            }),
            stderr: '',
        }));

        const result = await loadPullRequestFileContent(request(repo, {
            remoteUrl: ADO_REMOTE,
            runCommand,
        }));

        expect(result.base.content).toBe('base\r\n');
        expect(result.head.content).toBe('head\r\n');
        expect(runCommand.mock.calls.every(call => call[0] === 'az')).toBe(true);
        expect(runCommand.mock.calls[0][1].slice(0, 2)).toEqual(['devops', 'invoke']);
        expect(runCommand.mock.calls[0][1]).toContain('repositoryId=api');
    });

    it('returns a typed failure when local and provider reads fail', async () => {
        const repo = tempRepo();
        const runCommand = vi.fn<PullRequestFileCliRunner>(async () => {
            throw new Error('provider unavailable');
        });

        await expect(loadPullRequestFileContent(request(repo, { runCommand }))).rejects.toMatchObject({
            name: 'PullRequestFileContentError',
            code: 'content-unavailable',
        } satisfies Partial<PullRequestFileContentError>);
    });

    it('uses the original path for the base side of a renamed file', async () => {
        const repo = tempRepo();
        const paths: string[] = [];
        const runCommand = vi.fn<PullRequestFileCliRunner>(async (_command, args) => {
            paths.push(args.find(arg => arg.startsWith('repos/')) ?? '');
            return { stdout: Buffer.from('same\n'), stderr: '' };
        });

        const result = await loadPullRequestFileContent(request(repo, {
            filePath: 'src/new.ts',
            getProviderDiff: async () => diffFor('src/new.ts', { oldPath: 'src/old.ts' }),
            runCommand,
        }));

        expect(result.base.content).toBe('same\n');
        expect(result.head.content).toBe('same\n');
        expect(paths).toEqual([
            'repos/acme/widgets/contents/src/old.ts',
            'repos/acme/widgets/contents/src/new.ts',
        ]);
    });

    it('decodes quoted rename paths before fetching either snapshot', async () => {
        const repo = tempRepo();
        const runCommand = vi.fn<PullRequestFileCliRunner>(async () => ({ stdout: Buffer.from('same\n'), stderr: '' }));
        const result = await loadPullRequestFileContent(request(repo, {
            filePath: 'src/new café.ts',
            getProviderDiff: async () => [
                'diff --git "a/src/old caf\\303\\251.ts" "b/src/new caf\\303\\251.ts"',
                'similarity index 100%',
                'rename from "src/old caf\\303\\251.ts"',
                'rename to "src/new caf\\303\\251.ts"',
                '',
            ].join('\n'),
            runCommand,
        }));
        expect(result.base).toEqual({ content: 'same\n', ref: BASE_SHA, exists: true });
        expect(result.head).toEqual({ content: 'same\n', ref: HEAD_SHA, exists: true });
        expect(runCommand.mock.calls.map(call => call[1].find(arg => arg.startsWith('repos/')))).toEqual([
            'repos/acme/widgets/contents/src/old%20caf%C3%A9.ts',
            'repos/acme/widgets/contents/src/new%20caf%C3%A9.ts',
        ]);
    });

    it.each(['added', 'deleted'] as const)('recognizes an empty %s file without fetching its absent side', async status => {
        const repo = tempRepo();
        const runCommand = vi.fn<PullRequestFileCliRunner>(async () => ({ stdout: Buffer.alloc(0), stderr: '' }));
        const result = await loadPullRequestFileContent(request(repo, {
            getProviderDiff: async () => `diff --git a/src/file.ts b/src/file.ts\n${status === 'added' ? 'new' : 'deleted'} file mode 100644\n`,
            runCommand,
        }));
        expect(result.base.exists).toBe(status === 'deleted');
        expect(result.head.exists).toBe(status === 'added');
        expect(result.base.content).toBe('');
        expect(result.head.content).toBe('');
        expect(result.binary).toBe(false);
        expect(runCommand).toHaveBeenCalledTimes(1);
        expect(runCommand.mock.calls[0][1]).toContain(`ref=${status === 'added' ? HEAD_SHA : BASE_SHA}`);
    });

    it('loads both text snapshots for a mode-only change', async () => {
        const repo = tempRepo();
        const runCommand = vi.fn<PullRequestFileCliRunner>(async () => ({ stdout: Buffer.from('text\n'), stderr: '' }));
        const result = await loadPullRequestFileContent(request(repo, {
            getProviderDiff: async () => 'diff --git a/src/file.ts b/src/file.ts\nold mode 100644\nnew mode 100755\n',
            runCommand,
        }));
        expect(result.binary).toBe(false);
        expect(result.base.content).toBe('text\n');
        expect(result.head.content).toBe('text\n');
        expect(runCommand).toHaveBeenCalledTimes(2);
    });

    it('propagates unavailable native patch processing before fetching content', async () => {
        const repo = tempRepo();
        const runCommand = vi.fn<PullRequestFileCliRunner>();
        const error = new NativeAddonLoadError('Missing patch capability; npm run build:native -w packages/coc-native');
        vi.spyOn(loadNativeGit(), 'parseGitPatch').mockRejectedValueOnce(error);
        await expect(loadPullRequestFileContent(request(repo, { runCommand }))).rejects.toBe(error);
        expect(runCommand).not.toHaveBeenCalled();
    });

    it('returns empty content for binary provider files', async () => {
        const repo = tempRepo();
        const runCommand = vi.fn<PullRequestFileCliRunner>(async () => ({
            stdout: Buffer.from([0, 1, 2, 3]),
            stderr: '',
        }));

        const result = await loadPullRequestFileContent(request(repo, { runCommand }));

        expect(result.binary).toBe(true);
        expect(result.tooLarge).toBe(false);
        expect(result.base.content).toBe('');
        expect(result.head.content).toBe('');
    });

    it('returns empty content for provider files over the 10MB guard', async () => {
        const repo = tempRepo();
        const bytes = Buffer.alloc(MAX_WORKING_TREE_CONTENT_BYTES + 1, 65);
        const runCommand = vi.fn<PullRequestFileCliRunner>(async () => ({ stdout: bytes, stderr: '' }));

        const result = await loadPullRequestFileContent(request(repo, { runCommand }));

        expect(result.tooLarge).toBe(true);
        expect(result.binary).toBe(false);
        expect(result.base.content).toBe('');
        expect(result.head.content).toBe('');
    });

    it('handles added and deleted files without fetching the absent side', async () => {
        const repo = tempRepo();
        const addedRunner = vi.fn<PullRequestFileCliRunner>(async () => ({ stdout: Buffer.from('added\n'), stderr: '' }));
        const added = await loadPullRequestFileContent(request(repo, {
            filePath: 'added.ts',
            getProviderDiff: async () => diffFor('added.ts', { status: 'added' }),
            runCommand: addedRunner,
        }));
        expect(added.base.exists).toBe(false);
        expect(added.head.content).toBe('added\n');
        expect(addedRunner).toHaveBeenCalledTimes(1);

        const deletedRunner = vi.fn<PullRequestFileCliRunner>(async () => ({ stdout: Buffer.from('deleted\n'), stderr: '' }));
        const deleted = await loadPullRequestFileContent(request(repo, {
            filePath: 'deleted.ts',
            getProviderDiff: async () => diffFor('deleted.ts', { status: 'deleted' }),
            runCommand: deletedRunner,
        }));
        expect(deleted.base.content).toBe('deleted\n');
        expect(deleted.head.exists).toBe(false);
        expect(deletedRunner).toHaveBeenCalledTimes(1);
    });

    it('keys the cache by origin, PR id, head SHA, and path', async () => {
        const repo = tempRepo();
        const runCommand = vi.fn<PullRequestFileCliRunner>(async () => ({ stdout: Buffer.from('text\n'), stderr: '' }));
        const base = request(repo, { runCommand });

        await loadPullRequestFileContent(base);
        await loadPullRequestFileContent(base);
        expect(runCommand).toHaveBeenCalledTimes(2);

        await loadPullRequestFileContent({ ...base, originId: 'origin-b' });
        await loadPullRequestFileContent({ ...base, prId: '43' });
        await loadPullRequestFileContent({ ...base, pullRequest: pullRequest(BASE_SHA, '3333333333333333333333333333333333333333') });
        await loadPullRequestFileContent({ ...base, filePath: 'src/other.ts', getProviderDiff: async () => diffFor('src/other.ts') });
        expect(runCommand).toHaveBeenCalledTimes(10);
    });
});
