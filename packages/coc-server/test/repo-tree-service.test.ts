import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as childProcess from 'child_process';
import { RepoTreeService } from '../src/repos/tree-service';

let tmpDir: string;
let dataDir: string;
let repoDir: string;
let service: RepoTreeService;

const REPO_ID = 'test-repo-id';
const REPO_NAME = 'test-repo';

function seedWorkspacesJson(workspaces: Array<{ id: string; name: string; rootPath: string; remoteUrl?: string }>) {
    fs.writeFileSync(
        path.join(dataDir, 'workspaces.json'),
        JSON.stringify(workspaces, null, 2),
        'utf-8',
    );
}

function seedDefaultRepo() {
    fs.mkdirSync(repoDir, { recursive: true });
    seedWorkspacesJson([{ id: REPO_ID, name: REPO_NAME, rootPath: repoDir }]);
}

function isGitAvailable(): boolean {
    try {
        childProcess.execSync('git --version', { stdio: 'pipe' });
        return true;
    } catch {
        return false;
    }
}

function initGitRepo(dir: string): void {
    childProcess.execSync('git init', { cwd: dir, stdio: 'pipe' });
    childProcess.execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' });
    childProcess.execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' });
}

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-tree-test-'));
    dataDir = path.join(tmpDir, 'data');
    repoDir = path.join(tmpDir, 'repo');
    fs.mkdirSync(dataDir, { recursive: true });
    service = new RepoTreeService(dataDir);
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('RepoTreeService.listDirectory', () => {
    it('lists files and directories in a flat directory', async () => {
        seedDefaultRepo();
        fs.writeFileSync(path.join(repoDir, 'a.txt'), 'hello');
        fs.writeFileSync(path.join(repoDir, 'b.ts'), 'world');
        fs.mkdirSync(path.join(repoDir, 'src'));
        fs.mkdirSync(path.join(repoDir, 'lib'));

        const result = await service.listDirectory(REPO_ID, '.');
        expect(result.entries).toHaveLength(4);

        const names = result.entries.map(e => e.name);
        expect(names).toContain('a.txt');
        expect(names).toContain('b.ts');
        expect(names).toContain('src');
        expect(names).toContain('lib');

        const fileEntry = result.entries.find(e => e.name === 'a.txt')!;
        expect(fileEntry.type).toBe('file');
        expect(fileEntry.path).toBe('a.txt');

        const dirEntry = result.entries.find(e => e.name === 'src')!;
        expect(dirEntry.type).toBe('dir');
        expect(dirEntry.path).toBe('src');
    });

    it('sorts directories before files, then alphabetically', async () => {
        seedDefaultRepo();
        fs.writeFileSync(path.join(repoDir, 'z-file.txt'), '');
        fs.mkdirSync(path.join(repoDir, 'a-dir'));
        fs.writeFileSync(path.join(repoDir, 'm-file.ts'), '');
        fs.mkdirSync(path.join(repoDir, 'b-dir'));

        const result = await service.listDirectory(REPO_ID, '.');
        const names = result.entries.map(e => e.name);
        expect(names).toEqual(['a-dir', 'b-dir', 'm-file.ts', 'z-file.txt']);
    });

    it('returns correct size for files and undefined for directories', async () => {
        seedDefaultRepo();
        fs.writeFileSync(path.join(repoDir, 'hello.txt'), 'hello');
        fs.mkdirSync(path.join(repoDir, 'subdir'));

        const result = await service.listDirectory(REPO_ID, '.');
        const fileEntry = result.entries.find(e => e.name === 'hello.txt')!;
        expect(fileEntry.size).toBe(5);

        const dirEntry = result.entries.find(e => e.name === 'subdir')!;
        expect(dirEntry.size).toBeUndefined();
    });

    it('populates path field relative to repo root', async () => {
        seedDefaultRepo();
        fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
        fs.writeFileSync(path.join(repoDir, 'src', 'index.ts'), '');

        const result = await service.listDirectory(REPO_ID, 'src');
        const entry = result.entries.find(e => e.name === 'index.ts')!;
        expect(entry.path).toBe('src/index.ts');
    });

    it('throws for paths outside repo root (traversal guard)', async () => {
        seedDefaultRepo();
        await expect(service.listDirectory(REPO_ID, '../../../etc')).rejects.toThrow(
            /path traversal detected/i,
        );
    });

    it('throws for non-existent relative path', async () => {
        seedDefaultRepo();
        await expect(service.listDirectory(REPO_ID, 'no-such-dir')).rejects.toThrow(
            /does not exist/i,
        );
    });

    it('truncates when entries exceed maxEntries', async () => {
        seedDefaultRepo();
        for (let i = 0; i < 10; i++) {
            fs.writeFileSync(path.join(repoDir, `file-${String(i).padStart(2, '0')}.txt`), '');
        }
        const smallService = new RepoTreeService(dataDir, { maxEntries: 3 });
        const result = await smallService.listDirectory(REPO_ID, '.');
        expect(result.entries).toHaveLength(3);
        expect(result.truncated).toBe(true);
    });

    it('sets truncated to false when entries are within limit', async () => {
        seedDefaultRepo();
        fs.writeFileSync(path.join(repoDir, 'a.txt'), '');
        fs.writeFileSync(path.join(repoDir, 'b.txt'), '');

        const result = await service.listDirectory(REPO_ID, '.');
        expect(result.truncated).toBe(false);
    });

    it('includes hidden (dot) files in results', async () => {
        seedDefaultRepo();
        fs.writeFileSync(path.join(repoDir, '.env'), '');
        fs.writeFileSync(path.join(repoDir, '.gitignore'), '');
        fs.mkdirSync(path.join(repoDir, 'src'));

        const result = await service.listDirectory(REPO_ID, '.');
        const names = result.entries.map(e => e.name);
        expect(names).toContain('.env');
        expect(names).toContain('.gitignore');
        expect(names).toContain('src');
    });

    it('handles empty relative path as root', async () => {
        seedDefaultRepo();
        fs.writeFileSync(path.join(repoDir, 'readme.md'), 'hi');

        const result = await service.listDirectory(REPO_ID, '');
        expect(result.entries).toHaveLength(1);
        expect(result.entries[0].name).toBe('readme.md');
    });

    it('treats "/" as repo root instead of filesystem root', async () => {
        seedDefaultRepo();
        fs.writeFileSync(path.join(repoDir, 'readme.md'), 'hi');

        const result = await service.listDirectory(REPO_ID, '/');
        expect(result.entries).toHaveLength(1);
        expect(result.entries[0].name).toBe('readme.md');
    });

    it('strips leading slashes from relative paths', async () => {
        seedDefaultRepo();
        fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
        fs.writeFileSync(path.join(repoDir, 'src', 'index.ts'), '');

        const result = await service.listDirectory(REPO_ID, '/src');
        expect(result.entries).toHaveLength(1);
        expect(result.entries[0].name).toBe('index.ts');
    });

    it('throws for unknown repoId', async () => {
        seedDefaultRepo();
        await expect(service.listDirectory('nonexistent', '.')).rejects.toThrow(/repo not found/i);
    });
});

describe('RepoTreeService.listRepos', () => {
    it('returns repos from workspaces.json', async () => {
        fs.mkdirSync(repoDir, { recursive: true });
        if (isGitAvailable()) {
            initGitRepo(repoDir);
            fs.writeFileSync(path.join(repoDir, 'init.txt'), 'init');
            childProcess.execSync('git add . && git commit -m "init"', { cwd: repoDir, stdio: 'pipe' });
        }
        seedWorkspacesJson([{ id: REPO_ID, name: REPO_NAME, rootPath: repoDir }]);

        const repos = await service.listRepos();
        expect(repos).toHaveLength(1);
        expect(repos[0].id).toBe(REPO_ID);
        expect(repos[0].name).toBe(REPO_NAME);
        expect(repos[0].localPath).toBe(repoDir);
        if (isGitAvailable()) {
            expect(repos[0].headSha).toBeTruthy();
        }
    });

    it('returns empty array when workspaces.json is missing', async () => {
        const repos = await service.listRepos();
        expect(repos).toEqual([]);
    });
});

describe('RepoTreeService.resolveRepo', () => {
    it('returns RepoInfo for known repoId', async () => {
        fs.mkdirSync(repoDir, { recursive: true });
        seedWorkspacesJson([{ id: REPO_ID, name: REPO_NAME, rootPath: repoDir }]);

        const repo = await service.resolveRepo(REPO_ID);
        expect(repo).toBeDefined();
        expect(repo!.id).toBe(REPO_ID);
        expect(repo!.name).toBe(REPO_NAME);
        expect(repo!.localPath).toBe(repoDir);
    });

    it('returns undefined for unknown repoId', async () => {
        seedWorkspacesJson([{ id: REPO_ID, name: REPO_NAME, rootPath: repoDir }]);
        const repo = await service.resolveRepo('nonexistent');
        expect(repo).toBeUndefined();
    });
});

describe('RepoTreeService.readBlob', () => {
    it('reads text file as utf-8', async () => {
        seedDefaultRepo();
        fs.writeFileSync(path.join(repoDir, 'hello.ts'), 'const x = 1;');

        const blob = await service.readBlob(REPO_ID, 'hello.ts');
        expect(blob.content).toBe('const x = 1;');
        expect(blob.encoding).toBe('utf-8');
        expect(blob.mimeType).toBe('application/typescript');
    });

    it('reads binary file as base64', async () => {
        seedDefaultRepo();
        // Write a buffer with null bytes to simulate binary
        const binaryContent = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00, 0x01]);
        fs.writeFileSync(path.join(repoDir, 'image.png'), binaryContent);

        const blob = await service.readBlob(REPO_ID, 'image.png');
        expect(blob.encoding).toBe('base64');
        expect(blob.mimeType).toBe('image/png');
        // Verify round-trip
        const decoded = Buffer.from(blob.content, 'base64');
        expect(decoded).toEqual(binaryContent);
    });

    it('throws for files exceeding 1 MB', async () => {
        seedDefaultRepo();
        // Write a file slightly over 1 MB
        const largeContent = Buffer.alloc(1024 * 1024 + 1, 'a');
        fs.writeFileSync(path.join(repoDir, 'large.bin'), largeContent);

        await expect(service.readBlob(REPO_ID, 'large.bin')).rejects.toThrow(/exceeds maximum size/i);
    });

    it('throws for path traversal', async () => {
        seedDefaultRepo();
        await expect(service.readBlob(REPO_ID, '../outside')).rejects.toThrow(
            /path traversal detected/i,
        );
    });

    it('throws for non-existent file', async () => {
        seedDefaultRepo();
        await expect(service.readBlob(REPO_ID, 'missing.txt')).rejects.toThrow(/file not found/i);
    });

    it('throws for unknown repoId', async () => {
        seedDefaultRepo();
        await expect(service.readBlob('nonexistent', 'a.txt')).rejects.toThrow(/repo not found/i);
    });

    it('returns correct mimeType for various extensions', async () => {
        seedDefaultRepo();
        const files: Array<[string, string]> = [
            ['style.css', 'text/css'],
            ['readme.md', 'text/markdown'],
            ['data.json', 'application/json'],
            ['config.yaml', 'application/x-yaml'],
        ];
        for (const [name] of files) {
            fs.writeFileSync(path.join(repoDir, name), 'content');
        }
        for (const [name, expectedMime] of files) {
            const blob = await service.readBlob(REPO_ID, name);
            expect(blob.mimeType).toBe(expectedMime);
        }
    });
});

describe('RepoTreeService.writeBlob', () => {
    it('writes text content to an existing file', async () => {
        seedDefaultRepo();
        fs.writeFileSync(path.join(repoDir, 'hello.ts'), 'old content');

        await service.writeBlob(REPO_ID, 'hello.ts', 'new content');

        const written = fs.readFileSync(path.join(repoDir, 'hello.ts'), 'utf-8');
        expect(written).toBe('new content');
    });

    it('creates a new file if it does not exist', async () => {
        seedDefaultRepo();

        await service.writeBlob(REPO_ID, 'new-file.txt', 'brand new');

        const written = fs.readFileSync(path.join(repoDir, 'new-file.txt'), 'utf-8');
        expect(written).toBe('brand new');
    });

    it('creates parent directories if needed', async () => {
        seedDefaultRepo();

        await service.writeBlob(REPO_ID, 'deep/nested/dir/file.ts', 'content');

        const written = fs.readFileSync(path.join(repoDir, 'deep', 'nested', 'dir', 'file.ts'), 'utf-8');
        expect(written).toBe('content');
    });

    it('writes empty string content', async () => {
        seedDefaultRepo();
        fs.writeFileSync(path.join(repoDir, 'file.txt'), 'non-empty');

        await service.writeBlob(REPO_ID, 'file.txt', '');

        const written = fs.readFileSync(path.join(repoDir, 'file.txt'), 'utf-8');
        expect(written).toBe('');
    });

    it('throws for path traversal', async () => {
        seedDefaultRepo();
        await expect(service.writeBlob(REPO_ID, '../outside.txt', 'evil')).rejects.toThrow(
            /path traversal detected/i,
        );
    });

    it('throws for unknown repoId', async () => {
        seedDefaultRepo();
        await expect(service.writeBlob('nonexistent', 'a.txt', 'data')).rejects.toThrow(/repo not found/i);
    });
});

describe('RepoTreeService.listDirectory — gitignore integration', () => {
    const gitAvailable = isGitAvailable();

    it('filters gitignored entries by default', async () => {
        if (!gitAvailable) return;

        seedDefaultRepo();
        initGitRepo(repoDir);
        fs.writeFileSync(path.join(repoDir, '.gitignore'), 'dist/\n');
        fs.mkdirSync(path.join(repoDir, 'dist'));
        fs.writeFileSync(path.join(repoDir, 'dist', 'bundle.js'), '');
        fs.mkdirSync(path.join(repoDir, 'src'));
        fs.writeFileSync(path.join(repoDir, 'src', 'index.ts'), '');

        const result = await service.listDirectory(REPO_ID, '.');
        const names = result.entries.map(e => e.name);
        expect(names).not.toContain('dist');
        expect(names).toContain('src');
        expect(names).toContain('.gitignore');
    });

    it('includes all entries when showIgnored is true', async () => {
        if (!gitAvailable) return;

        seedDefaultRepo();
        initGitRepo(repoDir);
        fs.writeFileSync(path.join(repoDir, '.gitignore'), 'dist/\n');
        fs.mkdirSync(path.join(repoDir, 'dist'));
        fs.writeFileSync(path.join(repoDir, 'dist', 'bundle.js'), '');
        fs.mkdirSync(path.join(repoDir, 'src'));

        const result = await service.listDirectory(REPO_ID, '.', { showIgnored: true });
        const names = result.entries.map(e => e.name);
        expect(names).toContain('dist');
        expect(names).toContain('src');
    });
});

describe('RepoTreeService.toRepoInfo', () => {
    it('maps WorkspaceInfo fields to RepoInfo', () => {
        const workspace = {
            id: 'ws-123',
            name: 'my-project',
            rootPath: tmpDir,
        };

        const info = RepoTreeService.toRepoInfo(workspace);
        expect(info.id).toBe('ws-123');
        expect(info.name).toBe('my-project');
        expect(info.localPath).toBe(tmpDir);
        expect(info.clonedAt).toBeTruthy();
        // headSha may be empty string (tmpDir is not a git repo)
        expect(typeof info.headSha).toBe('string');
    });

    it('resolves headSha from a git repo', () => {
        if (!isGitAvailable()) return;

        const gitDir = path.join(tmpDir, 'git-repo');
        fs.mkdirSync(gitDir, { recursive: true });
        initGitRepo(gitDir);
        fs.writeFileSync(path.join(gitDir, 'file.txt'), 'init');
        childProcess.execSync('git add . && git commit -m "init"', { cwd: gitDir, stdio: 'pipe' });

        const info = RepoTreeService.toRepoInfo({
            id: 'git-id',
            name: 'git-project',
            rootPath: gitDir,
        });
        expect(info.headSha).toMatch(/^[0-9a-f]{7,}$/);
    });

    it('preserves remoteUrl from WorkspaceInfo', () => {
        const workspace = {
            id: 'ws-remote',
            name: 'remote-project',
            rootPath: tmpDir,
            remoteUrl: 'https://github.com/test/repo.git',
        };

        const info = RepoTreeService.toRepoInfo(workspace);
        expect(info.remoteUrl).toBe('https://github.com/test/repo.git');
    });
});

describe('RepoTreeService.listFilesRecursive', () => {
    it('returns all files recursively as flat paths', async () => {
        seedDefaultRepo();
        fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
        fs.writeFileSync(path.join(repoDir, 'readme.md'), '');
        fs.writeFileSync(path.join(repoDir, 'src', 'index.ts'), '');
        fs.writeFileSync(path.join(repoDir, 'src', 'util.ts'), '');

        const result = await service.listFilesRecursive(REPO_ID, '.');
        expect(result.files).toContain('readme.md');
        expect(result.files).toContain('src/index.ts');
        expect(result.files).toContain('src/util.ts');
        expect(result.truncated).toBe(false);
    });

    it('does not include directories in the output', async () => {
        seedDefaultRepo();
        fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
        fs.writeFileSync(path.join(repoDir, 'src', 'main.ts'), '');

        const result = await service.listFilesRecursive(REPO_ID, '.');
        for (const f of result.files) {
            expect(f).not.toBe('src');
        }
    });

    it('handles deeply nested directories', async () => {
        seedDefaultRepo();
        fs.mkdirSync(path.join(repoDir, 'a', 'b', 'c'), { recursive: true });
        fs.writeFileSync(path.join(repoDir, 'a', 'b', 'c', 'deep.txt'), '');

        const result = await service.listFilesRecursive(REPO_ID, '.');
        expect(result.files).toContain('a/b/c/deep.txt');
    });

    it('truncates when files exceed maxEntries', async () => {
        seedDefaultRepo();
        for (let i = 0; i < 10; i++) {
            fs.writeFileSync(path.join(repoDir, `file-${String(i).padStart(2, '0')}.txt`), '');
        }
        const smallService = new RepoTreeService(dataDir, { maxEntries: 3 });
        const result = await smallService.listFilesRecursive(REPO_ID, '.');
        expect(result.files).toHaveLength(3);
        expect(result.truncated).toBe(true);
    });

    it('returns sorted files alphabetically', async () => {
        seedDefaultRepo();
        fs.writeFileSync(path.join(repoDir, 'z.txt'), '');
        fs.writeFileSync(path.join(repoDir, 'a.txt'), '');
        fs.writeFileSync(path.join(repoDir, 'm.txt'), '');

        const result = await service.listFilesRecursive(REPO_ID, '.');
        expect(result.files).toEqual(['a.txt', 'm.txt', 'z.txt']);
    });

    it('scopes to subdirectory when relativePath is given', async () => {
        seedDefaultRepo();
        fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
        fs.writeFileSync(path.join(repoDir, 'root.txt'), '');
        fs.writeFileSync(path.join(repoDir, 'src', 'main.ts'), '');

        const result = await service.listFilesRecursive(REPO_ID, 'src');
        expect(result.files).toEqual(['src/main.ts']);
    });

    it('throws for unknown repoId', async () => {
        seedDefaultRepo();
        await expect(service.listFilesRecursive('nonexistent', '.')).rejects.toThrow(/repo not found/i);
    });

    it('throws for path traversal', async () => {
        seedDefaultRepo();
        await expect(service.listFilesRecursive(REPO_ID, '../../../etc')).rejects.toThrow(/path traversal detected/i);
    });

    it('returns empty array for empty directory', async () => {
        seedDefaultRepo();
        const result = await service.listFilesRecursive(REPO_ID, '.');
        expect(result.files).toEqual([]);
        expect(result.truncated).toBe(false);
    });

    it('filters gitignored files by default', async () => {
        if (!isGitAvailable()) return;
        seedDefaultRepo();
        initGitRepo(repoDir);
        fs.writeFileSync(path.join(repoDir, '.gitignore'), 'dist/\n');
        fs.mkdirSync(path.join(repoDir, 'dist'));
        fs.writeFileSync(path.join(repoDir, 'dist', 'bundle.js'), '');
        fs.mkdirSync(path.join(repoDir, 'src'));
        fs.writeFileSync(path.join(repoDir, 'src', 'index.ts'), '');

        const result = await service.listFilesRecursive(REPO_ID, '.');
        expect(result.files).not.toContain('dist/bundle.js');
        expect(result.files).toContain('src/index.ts');
    });
});

describe('RepoTreeService.fuzzyScore', () => {
    it('exact match scores higher than a partial match', () => {
        const exact = RepoTreeService.fuzzyScore('index', 'index.ts');
        const partial = RepoTreeService.fuzzyScore('index', 'src/some-index-utils.ts');
        expect(exact).toBeGreaterThan(partial);
    });

    it('returns 0 when not all query characters appear in order', () => {
        const score = RepoTreeService.fuzzyScore('zzz', 'index.ts');
        expect(score).toBe(0);
    });

    it('returns 0 for query longer than any realistic target', () => {
        const score = RepoTreeService.fuzzyScore('abcdefghijklmnopqrstuvwxyz0123456789', 'a.ts');
        expect(score).toBe(0);
    });

    it('does not throw for special characters in query', () => {
        expect(() => RepoTreeService.fuzzyScore('*.ts?', 'src/index.ts')).not.toThrow();
    });

    it('awards bonus for separator-adjacent matches', () => {
        // Same-length targets: 's' at start vs 's' in middle
        const startBonus = RepoTreeService.fuzzyScore('s', 'super.ts');  // 's' at position 0 → separator bonus
        const midMatch = RepoTreeService.fuzzyScore('s', 'masks.ts');    // 's' at position 2 → no bonus
        expect(startBonus).toBeGreaterThan(midMatch);
    });

    it('returns 0 for empty query', () => {
        expect(RepoTreeService.fuzzyScore('', 'index.ts')).toBe(0);
    });
});

describe('RepoTreeService.searchFiles', () => {
    it('returns results sorted by score descending', async () => {
        seedDefaultRepo();
        fs.writeFileSync(path.join(repoDir, 'index.ts'), '');
        fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
        fs.writeFileSync(path.join(repoDir, 'src', 'some-index-utils.ts'), '');

        const result = await service.searchFiles(REPO_ID, 'index');
        expect(result.results.length).toBeGreaterThan(0);
        for (let i = 1; i < result.results.length; i++) {
            expect(result.results[i - 1].score).toBeGreaterThanOrEqual(result.results[i].score);
        }
    });

    it('returns empty results when query matches nothing', async () => {
        seedDefaultRepo();
        fs.writeFileSync(path.join(repoDir, 'index.ts'), '');

        const result = await service.searchFiles(REPO_ID, 'zzzzzzzzzzzzz');
        expect(result.results).toEqual([]);
    });

    it('respects limit option', async () => {
        seedDefaultRepo();
        for (let i = 0; i < 10; i++) {
            fs.writeFileSync(path.join(repoDir, `file${i}.ts`), '');
        }

        const result = await service.searchFiles(REPO_ID, 'file', { limit: 3 });
        expect(result.results.length).toBeLessThanOrEqual(3);
    });

    it('clamps limit to [1, 200]', async () => {
        seedDefaultRepo();
        for (let i = 0; i < 5; i++) {
            fs.writeFileSync(path.join(repoDir, `a${i}.ts`), '');
        }

        // limit=0 should behave as 1
        const resultMin = await service.searchFiles(REPO_ID, 'a', { limit: 0 });
        expect(resultMin.results.length).toBeLessThanOrEqual(1);

        // limit=9999 should be clamped to 200
        const resultMax = await service.searchFiles(REPO_ID, 'a', { limit: 9999 });
        expect(resultMax.results.length).toBeLessThanOrEqual(200);
    });

    it('does not throw for special characters in query', async () => {
        seedDefaultRepo();
        fs.writeFileSync(path.join(repoDir, 'index.ts'), '');
        await expect(service.searchFiles(REPO_ID, '*.?ts!')).resolves.toBeDefined();
    });

    it('propagates truncated flag from listFilesRecursive', async () => {
        seedDefaultRepo();
        for (let i = 0; i < 10; i++) {
            fs.writeFileSync(path.join(repoDir, `file${i}.ts`), '');
        }
        const smallService = new RepoTreeService(dataDir, { maxEntries: 3 });
        const result = await smallService.searchFiles(REPO_ID, 'file');
        expect(result.truncated).toBe(true);
    });
});
