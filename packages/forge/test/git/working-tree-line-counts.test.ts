import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkingTreeService } from '../../src/git/working-tree-service';
import * as patches from '../../src/diff/local-patch';

const roots: string[] = [];
const service = new WorkingTreeService();
function git(root: string, ...args: string[]) {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}
function repo(commit = true) {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'line-counts-')));
    roots.push(root);
    git(root, 'init', '-q');
    git(root, 'config', 'user.name', 'Test');
    git(root, 'config', 'user.email', 'test@example.com');
    git(root, 'config', 'commit.gpgsign', 'false');
    git(root, 'config', 'core.autocrlf', 'false');
    if (commit) {
        for (const file of ['partial.txt', 'delete.txt', 'rename.txt']) fs.writeFileSync(path.join(root, file), file === 'partial.txt' ? 'one\ntwo\n' : `${file} one\n${file} two\n`);
        git(root, 'add', '.');
        git(root, 'commit', '-qm', 'base');
    }
    return root;
}
afterEach(() => {
    vi.restoreAllMocks();
    roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true }));
});

describe('working-tree section line counts', () => {
    it('batches each section and preserves edits, additions, deletions, renames and unavailable counts', async () => {
        const root = repo();
        const write = (file: string, text: string | Buffer) => fs.writeFileSync(path.join(root, file), text);
        write('partial.txt', 'one\ntwo\nstaged\n');
        write('added.txt', 'new\n');
        write('empty.txt', '');
        write('binary.dat', Buffer.from([0, 1, 2]));
        git(root, 'mv', 'rename.txt', 'renamed.txt');
        fs.unlinkSync(path.join(root, 'delete.txt'));
        git(root, 'add', '.');
        write('partial.txt', 'one\nunstaged\n');
        write('untracked.txt', 'untracked\n');
        const load = vi.spyOn(patches, 'loadWorkingTreePatch');
        const changes = await service.getAllChanges(root, { includeStats: true });
        const row = (file: string, stage = 'staged') => changes.find(c => c.filePath === path.join(root, file) && c.stage === stage);
        expect(row('partial.txt')).toMatchObject({ additions: 1, deletions: 0 });
        expect(row('partial.txt', 'unstaged')).toMatchObject({ additions: 1, deletions: 2 });
        expect(row('added.txt')).toMatchObject({ additions: 1, deletions: 0 });
        expect(row('delete.txt')).toMatchObject({ additions: 0, deletions: 2 });
        expect(row('renamed.txt')).toMatchObject({ additions: 0, deletions: 0, originalPath: path.join(root, 'rename.txt') });
        expect(row('empty.txt')).toMatchObject({ additions: 0, deletions: 0 });
        expect(row('binary.dat')).toMatchObject({ isBinary: true });
        expect(row('binary.dat')?.additions).toBeUndefined();
        expect(row('binary.dat')?.deletions).toBeUndefined();
        expect(row('untracked.txt', 'untracked')?.additions).toBeUndefined();
        expect(load.mock.calls.map(call => call.slice(0, 3))).toEqual([[root, 'staged', undefined], [root, 'unstaged', undefined]]);
        load.mockClear();
        await service.getAllChanges(root);
        expect(load).not.toHaveBeenCalled();
    });

    it('supports unborn HEAD and refresh without retaining old counts across workspaces', async () => {
        const root = repo(false);
        fs.writeFileSync(path.join(root, 'fresh.txt'), 'a\nb\n');
        git(root, 'add', '.');
        expect(await service.getAllChanges(root, { includeStats: true })).toEqual([
            expect.objectContaining({ additions: 2, deletions: 0, stage: 'staged' }),
        ]);
        fs.writeFileSync(path.join(root, 'fresh.txt'), 'a\nb\nc\n');
        expect((await service.getAllChanges(root, { includeStats: true })).find(c => c.stage === 'unstaged')).toMatchObject({ additions: 1, deletions: 0 });
        expect(await service.getAllChanges(repo(), { includeStats: true })).toEqual([]);
    });

    it('keeps rows and omits counts when one section read fails or its path is missing', async () => {
        const root = repo();
        fs.writeFileSync(path.join(root, 'partial.txt'), 'staged\n');
        git(root, 'add', '.');
        fs.writeFileSync(path.join(root, 'partial.txt'), 'disk\n');
        vi.spyOn(patches, 'loadWorkingTreePatch')
            .mockRejectedValueOnce(new Error('stats unavailable'))
            .mockResolvedValueOnce({ files: [], contentByPath: new Map(), content: { raw: '', totalLines: 0, truncated: false }, summary: { filesChanged: 0, additions: 0, deletions: 0 } });
        const changes = await service.getAllChanges(root, { includeStats: true });
        expect(changes).toHaveLength(2);
        expect(changes.every(c => c.additions === undefined && c.deletions === undefined)).toBe(true);
    });
});
