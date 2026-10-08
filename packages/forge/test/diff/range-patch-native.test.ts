import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createRangeDiffProvider } from '../../src/diff/git-diff-provider';
import { GitRangeService } from '../../src/git/git-range-service';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })));
function git(root: string, ...args: string[]) {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).replace(/\r?\n$/, '');
}
function fixture(marker = 'feature') {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'range-patch-')));
    roots.push(root);
    git(root, 'init', '-q');
    git(root, 'config', 'user.name', 'Test');
    git(root, 'config', 'user.email', 'test@example.com');
    git(root, 'config', 'core.autocrlf', 'false');
    fs.writeFileSync(path.join(root, 'shared.txt'), 'before\n');
    fs.writeFileSync(path.join(root, 'old.txt'), 'rename content\n');
    git(root, 'add', '.');
    git(root, 'commit', '-qm', 'initial');
    const initial = git(root, 'rev-parse', 'HEAD');
    fs.writeFileSync(path.join(root, 'shared.txt'), `${marker}\n`);
    fs.writeFileSync(path.join(root, 'café.txt'), '---body\n+++body\n');
    fs.writeFileSync(path.join(root, 'empty.txt'), '');
    fs.writeFileSync(path.join(root, 'bin.dat'), Buffer.from([0, 1, 2]));
    fs.renameSync(path.join(root, 'old.txt'), path.join(root, 'new.txt'));
    git(root, 'add', '.');
    git(root, 'commit', '-qm', 'feature');
    const head = git(root, 'rev-parse', 'HEAD');
    git(root, 'update-ref', 'refs/heads/feature', head);
    fs.writeFileSync(path.join(root, 'base-only.txt'), 'base only\n');
    git(root, 'add', '.');
    git(root, 'commit', '-qm', 'later tree');
    // Build a divergent base without changing the checked-out branch.
    const base = git(root, 'commit-tree', 'HEAD^{tree}', '-p', initial, '-m', 'divergent base');
    return { root, base, head, initial };
}

describe('Rust-owned range provider and production patch service', () => {
    it('compares all five operations against real three-dot Git output', async () => {
        const { root, base, head } = fixture();
        const provider = createRangeDiffProvider(root, base, head);
        const expected = git(root, '--literal-pathspecs', 'diff', '-M', '-C', `${base}...${head}`, '--');
        const files = await provider.listFiles();
        expect(files.map(file => file.path)).toEqual(['bin.dat', 'café.txt', 'empty.txt', 'new.txt', 'shared.txt'].sort((a, b) => a.localeCompare(b)));
        expect(files.find(file => file.path === 'bin.dat')?.isBinary).toBe(true);
        expect(files.find(file => file.path === 'empty.txt')).toMatchObject({ status: 'added', isBinary: false });
        expect(files.find(file => file.path === 'new.txt')).toMatchObject({ status: 'renamed', originalPath: 'old.txt', isBinary: false });
        expect(files.find(file => file.path === 'café.txt')).toMatchObject({ additions: 2, deletions: 0 });
        expect((await provider.getFullDiff()).raw).toBe(expected);
        const prefetched = await provider.prefetchAll();
        for (const file of files) {
            const content = await provider.getFileDiff(file.path);
            expect(content.raw).toBe(git(root, '--literal-pathspecs', 'diff', '-M', '-C', `${base}...${head}`, '--', file.path));
            // Git path filtering omits rename sources; combined chunks retain them.
            expect(prefetched.get(file.path)?.raw).toBeTruthy();
            if (file.status !== 'renamed') {
                expect(prefetched.get(file.path)?.raw.trimEnd()).toBe(content.raw.trimEnd());
            }
        }
        expect(await provider.getSummary()).toEqual({ filesChanged: 5, additions: 3, deletions: 1 });
        const service = new GitRangeService();
        expect(await service.getRangeDiff(root, base, head)).toBe(expected);
        expect(await service.getFileDiff(root, base, head, 'shared.txt')).toBe(
            git(root, '--literal-pathspecs', 'diff', '-M', '-C', '-U99999', `${base}...${head}`, '--', 'shared.txt'));
        service.dispose();
    });

    it('uses decoded patch paths and hunk counts for production range metadata', async () => {
        const { root, base, head } = fixture();
        const service = new GitRangeService();
        const files = await service.getChangedFiles(root, base, head);
        expect(files.find(file => file.path === 'café.txt')).toMatchObject({
            status: 'added', additions: 2, deletions: 0, repositoryRoot: root,
        });
        expect(files.find(file => file.path === 'new.txt')).toMatchObject({
            status: 'renamed', oldPath: 'old.txt', additions: 0, deletions: 0,
        });
        expect(files.find(file => file.path === 'empty.txt')).toMatchObject({ status: 'added', additions: 0 });
        expect(files.map(file => file.path)).toEqual((await createRangeDiffProvider(root, base, head).listFiles()).map(file => file.path));
        expect(await service.getDiffStats(root, base, head)).toEqual({ additions: 3, deletions: 1 });
        service.dispose();
    });

    it('preserves source and destination paths for a rename within a directory', async () => {
        const { root } = fixture();
        fs.mkdirSync(path.join(root, 'src'));
        fs.writeFileSync(path.join(root, 'src', 'old.txt'), 'rename content\n');
        git(root, 'add', '.');
        git(root, 'commit', '-qm', 'nested source');
        const base = git(root, 'rev-parse', 'HEAD');
        fs.renameSync(path.join(root, 'src', 'old.txt'), path.join(root, 'src', 'new.txt'));
        git(root, 'add', '.');
        git(root, 'commit', '-qm', 'nested rename');
        const service = new GitRangeService();
        expect(await service.getChangedFiles(root, base, 'HEAD')).toEqual([{
            path: 'src/new.txt', oldPath: 'src/old.txt', status: 'renamed',
            additions: 0, deletions: 0, repositoryRoot: root,
        }]);
        expect(await service.getDiffStats(root, base, 'HEAD')).toEqual({ additions: 0, deletions: 0 });
        service.dispose();
    });

    it('honors context and truncates without losing total line counts', async () => {
        const { root, initial, head } = fixture();
        const provider = createRangeDiffProvider(root, initial, head);
        const full = await provider.getFileDiff('shared.txt', { contextLines: 0 });
        expect(full.raw).toBe(git(root, '--literal-pathspecs', 'diff', '-M', '-C', '-U0', `${initial}...${head}`, '--', 'shared.txt'));
        expect(await provider.getFileDiff('shared.txt', { contextLines: 0, maxLines: 2 })).toEqual({
            raw: full.raw.split('\n').slice(0, 2).join('\n'), truncated: true, totalLines: full.totalLines,
        });
        expect(await provider.getFileDiff('shared.txt', { maxLines: 0 })).toMatchObject({ raw: '', truncated: true });
        expect((await provider.getFileDiff('shared.txt', { full: true })).raw).toBe((await provider.getFileDiff('shared.txt')).raw);
    });

    it('refreshes mutable refs without retaining a TypeScript patch cache', async () => {
        const { root, initial, head } = fixture();
        const provider = createRangeDiffProvider(root, initial, 'feature');
        const service = new GitRangeService();
        expect((await service.getChangedFiles(root, initial, 'feature')).some(file => file.path === 'base-only.txt')).toBe(false);
        expect((await provider.listFiles()).some(file => file.path === 'base-only.txt')).toBe(false);
        git(root, 'update-ref', 'refs/heads/feature', git(root, 'rev-parse', 'HEAD'));
        expect((await provider.listFiles()).some(file => file.path === 'base-only.txt')).toBe(true);
        expect((await provider.getSummary()).filesChanged).toBe(6);
        expect((await provider.getFullDiff()).raw).toContain('base-only.txt');
        expect((await service.getChangedFiles(root, initial, 'feature')).some(file => file.path === 'base-only.txt')).toBe(true);
        expect(await service.getDiffStats(root, initial, 'feature')).toEqual({ additions: 4, deletions: 1 });
        expect(head).not.toBe(git(root, 'rev-parse', 'feature'));
        service.dispose();
    });

    it('isolates concurrent workspaces with identical relative paths', async () => {
        const one = fixture('one'), two = fixture('two');
        const providers = [one, two].map(({ root, initial, head }) => createRangeDiffProvider(root, initial, head));
        const contents = await Promise.all(providers.map(provider => provider.getFileDiff('shared.txt')));
        expect(contents[0].raw).toContain('+one');
        expect(contents[0].raw).not.toContain('+two');
        expect(contents[1].raw).toContain('+two');
        const service = new GitRangeService();
        const metadata = await Promise.all([one, two].map(({ root, initial, head }) => service.getChangedFiles(root, initial, head)));
        metadata.forEach((files, index) => expect(files.find(file => file.path === 'shared.txt')).toMatchObject({
            repositoryRoot: [one, two][index].root, additions: 1, deletions: 1,
        }));
        service.dispose();
    });

    it('answers empty ranges/missing paths and exposes invalid revisions', async () => {
        const { root, initial, head } = fixture();
        const empty = createRangeDiffProvider(root, head, head);
        expect(await empty.listFiles()).toEqual([]);
        expect(await empty.getFullDiff()).toEqual({ raw: '', truncated: false, totalLines: 0 });
        expect(await empty.getSummary()).toEqual({ filesChanged: 0, additions: 0, deletions: 0 });
        expect(await empty.prefetchAll()).toEqual(new Map());
        expect((await createRangeDiffProvider(root, initial, head).getFileDiff('missing')).raw).toBe('');
        await expect(createRangeDiffProvider(root, 'missing-ref', head).listFiles()).rejects.toThrow('git');
    });

    it('parses patches independently of display color and prefix preferences', async () => {
        const { root, initial, head } = fixture();
        git(root, 'config', 'color.ui', 'always');
        git(root, 'config', 'diff.noprefix', 'true');
        const provider = createRangeDiffProvider(root, initial, head);
        expect((await provider.listFiles()).map(file => file.path)).toContain('café.txt');
        expect((await provider.getFullDiff()).raw).not.toContain('\u001b[');
        await expect(createRangeDiffProvider(root, '--output=oops', head).getFullDiff()).rejects.toThrow('git');
        expect(fs.existsSync(path.join(root, 'oops'))).toBe(false);
    });

    it('treats glob characters in a requested path literally', async () => {
        const { root, initial } = fixture();
        fs.writeFileSync(path.join(root, '[abc].txt'), 'literal\n');
        fs.writeFileSync(path.join(root, 'a.txt'), 'glob match\n');
        git(root, 'add', '.');
        git(root, 'commit', '-qm', 'literal paths');
        const provider = createRangeDiffProvider(root, initial, 'HEAD');
        const content = await provider.getFileDiff('[abc].txt');
        expect(content.raw).toContain('+literal');
        expect(content.raw).not.toContain('+glob match');
        const service = new GitRangeService();
        expect(await service.getFileDiff(root, initial, 'HEAD', '[abc].txt')).toBe(content.raw);
    });
});
