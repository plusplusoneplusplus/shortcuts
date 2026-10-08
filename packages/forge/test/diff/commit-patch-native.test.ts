import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadCommitShowPatch } from '../../src/diff/local-patch';
import { createCommitDiffProvider } from '../../src/diff/git-diff-provider';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })));
function git(root: string, ...args: string[]) {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).replace(/\r?\n$/, '');
}
function fixture(marker = 'after') {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'commit-patch-')));
    roots.push(root);
    git(root, 'init', '-q');
    git(root, 'config', 'user.name', 'Test');
    git(root, 'config', 'user.email', 'test@example.com');
    git(root, 'config', 'commit.gpgsign', 'false');
    git(root, 'config', 'core.autocrlf', 'false');
    fs.writeFileSync(path.join(root, 'same.txt'), 'before\n');
    fs.writeFileSync(path.join(root, 'old.txt'), 'rename\n');
    git(root, 'add', '.');
    git(root, 'commit', '-qm', 'root');
    const initial = git(root, 'rev-parse', 'HEAD');
    fs.writeFileSync(path.join(root, 'same.txt'), `${marker}\n`);
    fs.writeFileSync(path.join(root, 'café.txt'), '---body\n+++body\n');
    fs.writeFileSync(path.join(root, 'empty.txt'), '');
    fs.writeFileSync(path.join(root, 'binary'), Buffer.from([0, 1, 2]));
    fs.renameSync(path.join(root, 'old.txt'), path.join(root, 'new.txt'));
    git(root, 'add', '.');
    git(root, 'commit', '-qm', 'ordinary');
    return { root, initial, head: git(root, 'rev-parse', 'HEAD') };
}

describe('Rust commit provider', () => {
    it('matches all five operations on ordinary and first-parent merge commits', async () => {
        const { root, initial, head } = fixture();
        const side = git(root, 'commit-tree', 'HEAD^{tree}', '-p', initial, '-m', 'side');
        const merge = git(root, 'commit-tree', 'HEAD^{tree}', '-p', initial, '-p', side, '-m', 'merge');
        for (const commit of [head, merge]) {
            const provider = createCommitDiffProvider(root, commit);
            expect(provider.source).toEqual({ kind: 'commit', repositoryRoot: root, commitHash: commit });
            const files = await provider.listFiles();
            expect(files.map(file => file.path)).toEqual(['binary', 'café.txt', 'empty.txt', 'new.txt', 'same.txt'].sort((a, b) => a.localeCompare(b)));
            expect(files.find(file => file.path === 'café.txt')).toMatchObject({ additions: 2, deletions: 0 });
            expect(files.find(file => file.path === 'empty.txt')).toMatchObject({ status: 'added', isBinary: false });
            expect(files.find(file => file.path === 'binary')?.isBinary).toBe(true);
            expect(files.find(file => file.path === 'new.txt')).toMatchObject({ status: 'renamed', originalPath: 'old.txt' });
            const full = await provider.getFullDiff();
            expect(full.raw).toBe(git(root, 'diff', '-M', '-C', initial, commit));
            expect(full.totalLines).toBe(full.raw.split('\n').length);
            expect(full.truncated).toBe(false);
            const prefetched = await provider.prefetchAll();
            for (const file of files) {
                expect(prefetched.get(file.path)?.raw).toBeTruthy();
                const content = await provider.getFileDiff(file.path);
                expect(content.raw).toBe(git(root, '--literal-pathspecs', 'diff', '-M', '-C', initial, commit, '--', file.path));
                if (file.status !== 'renamed') expect(prefetched.get(file.path)?.raw.trimEnd()).toBe(content.raw.trimEnd());
            }
            expect(await provider.getSummary()).toEqual({ filesChanged: 5, additions: 3, deletions: 1 });
        }
        expect(git(root, 'show', '--format=', '--patch', merge)).toBe('');
        for (const commit of [initial, head, merge]) {
            const result = await loadCommitShowPatch(root, commit);
            expect(result.content.raw).toBe(git(root, 'show', '--format=', '--patch', '-M', '-C', commit));
        }
        expect((await loadCommitShowPatch(root, merge)).content.raw).toBe('');
    });

    it('handles roots, absent paths and invalid revisions', async () => {
        const { root, initial } = fixture();
        const provider = createCommitDiffProvider(root, initial);
        expect((await provider.listFiles()).every(file => file.status === 'added')).toBe(true);
        expect(await provider.getSummary()).toEqual({ filesChanged: 2, additions: 2, deletions: 0 });
        expect((await provider.getFileDiff('missing')).raw).toBe('');
        await expect(createCommitDiffProvider(root, 'missing-ref').listFiles()).rejects.toThrow('git');
        await expect(createCommitDiffProvider(root, '--output=oops').getFullDiff()).rejects.toThrow('git');
        expect(fs.existsSync(path.join(root, 'oops'))).toBe(false);
    });

    it('honors literal paths, context and truncation independently of Git display config', async () => {
        const { root } = fixture();
        fs.writeFileSync(path.join(root, '[ab].txt'), 'literal\n');
        fs.writeFileSync(path.join(root, 'a.txt'), 'glob\n');
        git(root, 'add', '.');
        git(root, 'commit', '-qm', 'paths');
        git(root, 'config', 'color.ui', 'always');
        git(root, 'config', 'diff.noprefix', 'true');
        const provider = createCommitDiffProvider(root, 'HEAD');
        const full = await provider.getFileDiff('[ab].txt', { contextLines: 0 });
        expect(full.raw).toContain('+literal');
        expect(full.raw).not.toContain('+glob');
        expect(full.raw).not.toContain('\u001b[');
        expect(full.raw).toContain('diff --git a/');
        expect(await provider.getFileDiff('[ab].txt', { contextLines: 0, maxLines: 2 })).toEqual({
            raw: full.raw.split('\n').slice(0, 2).join('\n'), truncated: true, totalLines: full.totalLines,
        });
        expect((await provider.getFileDiff('[ab].txt', { maxLines: 0 })).raw).toBe('');
        const shown = await loadCommitShowPatch(root, 'HEAD', '[ab].txt', { contextLines: 0 });
        expect(shown.content.raw).toContain('+literal');
        expect(shown.content.raw).not.toContain('+glob');
        expect((await loadCommitShowPatch(root, 'HEAD', '[ab].txt', { contextLines: 0, maxLines: 2 })).content).toEqual({
            raw: shown.content.raw.split('\n').slice(0, 2).join('\n'), truncated: true, totalLines: shown.content.totalLines,
        });
        expect(await provider.getFileDiff('[ab].txt', { full: true })).toEqual(await provider.getFileDiff('[ab].txt'));
    });

    it('refreshes mutable commit refs and isolates concurrent roots with identical paths', async () => {
        const one = fixture('one'), two = fixture('two');
        const providers = [one, two].map(({ root }) => createCommitDiffProvider(root, 'HEAD'));
        const contents = await Promise.all(providers.map(provider => provider.getFileDiff('same.txt')));
        expect(contents[0].raw).toContain('+one');
        expect(contents[0].raw).not.toContain('+two');
        expect(contents[1].raw).toContain('+two');
        await providers[0].listFiles();
        fs.writeFileSync(path.join(one.root, 'later.txt'), 'later\n');
        git(one.root, 'add', '.');
        git(one.root, 'commit', '-qm', 'later');
        expect((await providers[0].listFiles()).map(file => file.path)).toEqual(['later.txt']);
        expect(await providers[0].getSummary()).toEqual({ filesChanged: 1, additions: 1, deletions: 0 });
        expect((await providers[1].listFiles()).map(file => file.path)).not.toContain('later.txt');
    });
});
