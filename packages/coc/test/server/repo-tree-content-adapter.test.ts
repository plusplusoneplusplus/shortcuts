import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadNativeRepoFiles, type NativeRepoFiles } from '@plusplusoneplusplus/coc-native';

const execution = vi.hoisted(() => ({ wsl: false, git: vi.fn() }));
vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
    return {
        ...actual,
        execGitAsync: execution.git,
        resolveWorkspaceExecutionContext: (root: string) => execution.wsl
            ? { kind: 'wsl' }
            : actual.resolveWorkspaceExecutionContext(root),
    };
});
import { RepoTreeService } from '../../src/server/repos/tree-service';

// Mandatory real addon: adapter-output fixtures cannot silently use a JS backend.
const native = loadNativeRepoFiles();
let tmp: string;
let data: string;
let roots: string[];
let service: RepoTreeService;
let handles: NativeRepoFiles[];

function register(entries = roots.map((rootPath, i) => ({ id: `repo-${i}`, rootPath }))) {
    fs.writeFileSync(path.join(data, 'workspaces.json'), JSON.stringify(entries));
}

beforeEach(() => {
    execution.wsl = false;
    execution.git.mockReset().mockResolvedValue('eligible.txt\0');
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-content-adapter-'));
    data = path.join(tmp, 'data');
    roots = [path.join(tmp, 'one'), path.join(tmp, 'two')];
    for (const dir of [data, ...roots]) fs.mkdirSync(dir);
    for (const [i, root] of roots.entries()) {
        fs.writeFileSync(path.join(root, 'eligible.txt'), `needle ${i}`);
        fs.writeFileSync(path.join(root, 'excluded.txt'), 'needle');
    }
    register();
    handles = [];
    service = new RepoTreeService(data, {
        nativeRepoFiles: {
            openRepoFiles(root, ttl) {
                const files = native.openRepoFiles(root, ttl);
                handles.push(files);
                return files;
            },
        },
    });
});
afterEach(() => {
    service.dispose();
    fs.rmSync(tmp, { recursive: true, force: true });
});

describe('content search workspace adapter', () => {
    it('executes Rust-prepared WSL argv and searches only supplied candidates', async () => {
        execution.wsl = true;
        for (const includeUntracked of [false, true]) {
            const result = await service.searchContent('repo-0', 'needle', { fileScope: 'tracked', includeUntracked });
            expect(result.matches.map(match => match.path)).toEqual(['eligible.txt']);
            expect(execution.git).toHaveBeenLastCalledWith(
                ['ls-files', '-z', '--cached', ...(includeUntracked ? ['--others', '--exclude-standard'] : [])],
                roots[0], { timeout: 15_000, maxBuffer: 64 * 1024 * 1024 },
            );
        }
    });

    it('passes empty WSL output without falling back to host Git', async () => {
        execution.wsl = true;
        execution.git.mockResolvedValue('');
        // Neither root is a Git repo: any host fallback would reject.
        expect(await service.searchContent('repo-0', 'needle', { fileScope: 'tracked' }))
            .toEqual({ matches: [], truncated: false });
    });

    it('rejects a missing WSL root before executing the candidate command', async () => {
        execution.wsl = true;
        fs.rmSync(roots[0], { recursive: true, force: true });
        await expect(service.searchContent('repo-0', 'needle', { fileScope: 'tracked' }))
            .rejects.toThrow(`Repo not found on disk: ${roots[0]}`);
        expect(execution.git).not.toHaveBeenCalled();
    });

    it('maps WSL and native tracked enumeration failures to the REST code', async () => {
        await expect(service.searchContent('repo-0', 'needle', { fileScope: 'tracked' }))
            .rejects.toMatchObject({ code: 'TRACKED_CONTENT_SEARCH_UNAVAILABLE', message: expect.stringMatching(/^Git-tracked search is unavailable:/) });
        execution.wsl = true;
        execution.git.mockRejectedValue(new Error('distro unavailable'));
        await expect(service.searchContent('repo-0', 'needle', { fileScope: 'tracked' }))
            .rejects.toMatchObject({ code: 'TRACKED_CONTENT_SEARCH_UNAVAILABLE', message: 'Git-tracked search is unavailable: distro unavailable' });
    });

    it('leaves InvalidArg errors intact and never invokes the TS Git adapter on host searches', async () => {
        await expect(service.searchContent('repo-0', '[', { regex: true })).rejects.toMatchObject({ code: 'InvalidArg' });
        await expect(service.searchContent('repo-0', 'needle', { path: '../two' })).rejects.toMatchObject({ code: 'InvalidArg' });
        await service.searchContent('repo-0', 'needle');
        expect(execution.git).not.toHaveBeenCalled();
    });

    it('uses isolated live handles and evicts content handles on root change and unregister', async () => {
        execution.wsl = true;
        const options = { fileScope: 'tracked' as const };
        const first = await service.searchContent('repo-0', 'needle', options);
        const second = await service.searchContent('repo-1', 'needle', options);
        expect(first.matches[0].text).toBe('needle 0');
        expect(second.matches[0].text).toBe('needle 1');
        expect(handles).toHaveLength(2);
        register([{ id: 'repo-0', rootPath: roots[1] }]);
        expect((await service.searchContent('repo-0', 'needle', options)).matches[0].text).toBe('needle 1');
        expect(execution.git).toHaveBeenLastCalledWith(expect.any(Array), roots[1], expect.any(Object));
        await expect(handles[0].searchContent('needle')).rejects.toMatchObject({ code: 'Closing' });
        await expect(service.searchContent('repo-1', 'needle', options)).rejects.toThrow('Repo not found: repo-1');
        await expect(handles[1].searchContent('needle')).rejects.toMatchObject({ code: 'Closing' });
        register([]);
        await expect(service.searchContent('repo-0', 'needle', options)).rejects.toThrow('Repo not found: repo-0');
        await expect(handles[2].searchContent('needle')).rejects.toMatchObject({ code: 'Closing' });
    });
});
