import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkingTreeDiffProvider } from '../../src/diff/git-diff-provider';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })));
function git(root: string, ...args: string[]) {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).replace(/\r?\n$/, '');
}
function fixture(marker = 'disk') {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'working-patch-')));
    roots.push(root);
    git(root, 'init', '-q');
    git(root, 'config', 'user.name', 'Test');
    git(root, 'config', 'user.email', 'test@example.com');
    git(root, 'config', 'commit.gpgsign', 'false');
    git(root, 'config', 'core.autocrlf', 'false');
    for (const file of ['same.txt', 'old.txt', '[ab].txt', 'a.txt']) fs.writeFileSync(path.join(root, file), 'before\n');
    git(root, 'add', '.');
    git(root, 'commit', '-qm', 'root');
    fs.writeFileSync(path.join(root, 'same.txt'), 'stage\n');
    fs.writeFileSync(path.join(root, 'empty.txt'), '');
    fs.writeFileSync(path.join(root, 'café.txt'), 'unicode\n');
    fs.writeFileSync(path.join(root, 'binary'), Buffer.from([0, 1]));
    fs.renameSync(path.join(root, 'old.txt'), path.join(root, 'new.txt'));
    git(root, 'add', '.');
    fs.writeFileSync(path.join(root, 'same.txt'), `${marker}\nextra\n`);
    fs.writeFileSync(path.join(root, '[ab].txt'), 'literal\n');
    fs.writeFileSync(path.join(root, 'a.txt'), 'glob\n');
    return root;
}

describe('Rust working-tree provider with real Git', () => {
    it('preserves comparisons, metadata precedence and all five operations', async () => {
        const root = fixture();
        for (const scope of ['staged', 'unstaged', 'all'] as const) {
            const provider = createWorkingTreeDiffProvider(root, scope);
            const staged = git(root, 'diff', '-M', '-C', '--cached');
            const unstaged = git(root, 'diff', '-M', '-C');
            const full = await provider.getFullDiff();
            expect(full.raw).toBe(scope === 'all' ? `${staged}\n${unstaged}` : scope === 'staged' ? staged : unstaged);
            const files = await provider.listFiles();
            expect(files.map(file => file.path)).toEqual(files.map(file => file.path).sort((a, b) => a.localeCompare(b)));
            expect(files.find(file => file.path === 'same.txt')).toMatchObject({ additions: scope === 'staged' ? 1 : 2, deletions: 1 });
            const prefetched = await provider.prefetchAll();
            expect(prefetched.get('same.txt')?.raw).toContain(scope === 'staged' ? '+stage' : '+disk');
            if (scope === 'all') expect(prefetched.get('same.txt')?.raw).toContain('+stage');
            for (const file of files) expect((await provider.getFileDiff(file.path)).raw).toBeTruthy();
            expect(await provider.getSummary()).toEqual({ filesChanged: files.length, additions: files.reduce((sum, file) => sum + (file.additions ?? 0), 0), deletions: files.reduce((sum, file) => sum + (file.deletions ?? 0), 0) });
            if (scope !== 'unstaged') {
                expect(files.find(file => file.path === 'empty.txt')?.isBinary).toBe(false);
                expect(files.find(file => file.path === 'binary')?.isBinary).toBe(true);
                expect(files.find(file => file.path === 'new.txt')).toMatchObject({ originalPath: 'old.txt', status: 'renamed' });
                // Old newline metadata output contains Git-quoted, rather than literal, Unicode paths.
                expect(git(root, 'diff', '--cached', '--name-status')).toContain('"caf\\303\\251.txt"');
                expect(files.map(file => file.path)).toContain('café.txt');
            }
        }
    });

    it('fixes literal glob selection and retains context/truncation contracts', async () => {
        const root = fixture();
        expect(git(root, 'diff', '--', '[ab].txt')).toContain('+glob');
        git(root, 'config', 'color.ui', 'always');
        git(root, 'config', 'diff.noprefix', 'true');
        const provider = createWorkingTreeDiffProvider(root);
        const full = await provider.getFileDiff('[ab].txt', { contextLines: 0 });
        expect(full.raw).toContain('+literal');
        expect(full.raw).not.toContain('+glob');
        expect(full.raw).not.toContain('\u001b[');
        expect(full.raw).toContain('diff --git a/');
        expect(await provider.getFileDiff('[ab].txt', { contextLines: 0, maxLines: 2 })).toEqual({ raw: full.raw.split('\n').slice(0, 2).join('\n'), totalLines: full.totalLines, truncated: true });
        expect((await provider.getFileDiff('missing')).raw).toBe('');
        expect(await provider.getFileDiff('[ab].txt', { full: true })).toEqual(await provider.getFileDiff('[ab].txt'));
    });

    it('retains unmerged paths and parses combined conflict patches', async () => {
        const root = fixture();
        const blobs = ['before', 'ours', 'theirs'].map(value => execFileSync('git', ['-C', root, 'hash-object', '-w', '--stdin'], { input: `${value}\n`, encoding: 'utf8' }).trim());
        execFileSync('git', ['-C', root, 'update-index', '--index-info'], {
            input: `0 ${'0'.repeat(blobs[0].length)}\tsame.txt\n` + blobs.map((sha, index) => `100644 ${sha} ${index + 1}\tsame.txt\n`).join(''),
        });
        fs.writeFileSync(path.join(root, 'same.txt'), '<<<<<<< ours\nours\n=======\ntheirs\n>>>>>>> theirs\n');
        expect(git(root, 'diff')).toContain('diff --cc same.txt');
        expect((await createWorkingTreeDiffProvider(root, 'staged').listFiles()).find(file => file.path === 'same.txt')).toMatchObject({ status: 'conflict', isBinary: false });
        for (const scope of ['unstaged', 'all'] as const) {
            const provider = createWorkingTreeDiffProvider(root, scope);
            expect((await provider.listFiles()).find(file => file.path === 'same.txt')).toMatchObject({ status: 'modified', additions: 4, deletions: 0 });
            expect((await provider.prefetchAll()).get('same.txt')?.raw).toContain('diff --cc same.txt');
        }
    });

    it('reads fresh index/disk state and isolates concurrent workspaces', async () => {
        const one = fixture('one'), two = fixture('two');
        const providers = [one, two].map(root => createWorkingTreeDiffProvider(root));
        const contents = await Promise.all(providers.map(provider => provider.getFileDiff('same.txt')));
        expect(contents[0].raw).toContain('+one');
        expect(contents[0].raw).not.toContain('+two');
        expect(contents[1].raw).toContain('+two');
        await providers[0].listFiles();
        git(one, 'add', '.');
        git(one, 'commit', '-qm', 'clean');
        expect(await providers[0].listFiles()).toEqual([]);
        fs.writeFileSync(path.join(one, 'same.txt'), 'fresh\n');
        expect((await providers[0].listFiles()).map(file => file.path)).toEqual(['same.txt']);
        expect((await providers[0].getFullDiff()).raw).toContain('+fresh');
        expect((await providers[1].getFullDiff()).raw).toContain('+two');
    });
});
