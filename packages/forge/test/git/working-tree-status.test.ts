/**
 * `WorkingTreeService.getAllChanges` against real repositories.
 *
 * The porcelain parser lives in Rust now, so there is no child process and no
 * text to mock: these drive real repositories and assert the rows the Git tab
 * renders. Deliberately a separate file — its sibling mocks `fs` module-wide,
 * which a suite that writes to a temp directory cannot live with.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';

import { WorkingTreeService } from '../../src/git/working-tree-service';

const service = new WorkingTreeService();
const repos: string[] = [];

function git(repo: string, ...args: string[]): string {
    return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf-8' });
}

/** A repo with one commit and an identity that does not read global config. */
function makeRepo(): string {
    const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'forge-worktree-')));
    repos.push(repo);
    git(repo, 'init', '--initial-branch=main');
    git(repo, 'config', 'user.email', 'ralph@example.com');
    git(repo, 'config', 'user.name', 'Ralph');
    git(repo, 'config', 'commit.gpgsign', 'false');
    fs.writeFileSync(path.join(repo, 'README.md'), 'hello\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-m', 'initial commit');
    return repo;
}

afterAll(() => {
    for (const repo of repos) fs.rmSync(repo, { recursive: true, force: true });
});

describe('WorkingTreeService.getAllChanges', () => {
    it('returns nothing for a clean repository', async () => {
        await expect(service.getAllChanges(makeRepo())).resolves.toEqual([]);
    });

    it('classifies staged, unstaged and untracked changes', async () => {
        const repo = makeRepo();
        fs.writeFileSync(path.join(repo, 'README.md'), 'changed\n');
        fs.writeFileSync(path.join(repo, 'fresh.txt'), 'fresh\n');
        git(repo, 'add', 'fresh.txt');

        const changes = await service.getAllChanges(repo);
        const byPath = (name: string) => changes.find(c => c.filePath === path.join(repo, name));

        expect(byPath('README.md')).toMatchObject({ status: 'modified', stage: 'unstaged' });
        expect(byPath('fresh.txt')).toMatchObject({ status: 'added', stage: 'staged' });
        // An unchanged path carries no original path, rather than a null one.
        expect(byPath('README.md')?.originalPath).toBeUndefined();
    });

    it('reports a file dirty in both columns once per stage', async () => {
        const repo = makeRepo();
        fs.writeFileSync(path.join(repo, 'README.md'), 'staged\n');
        git(repo, 'add', 'README.md');
        fs.writeFileSync(path.join(repo, 'README.md'), 'and then unstaged\n');

        const changes = await service.getAllChanges(repo);
        expect(changes.map(c => c.stage).sort()).toEqual(['staged', 'unstaged']);
        expect(changes.every(c => c.filePath === path.join(repo, 'README.md'))).toBe(true);
    });

    it('resolves a rename to absolute destination and original paths', async () => {
        const repo = makeRepo();
        git(repo, 'mv', 'README.md', 'READYOU.md');

        const changes = await service.getAllChanges(repo);
        expect(changes).toEqual([
            expect.objectContaining({
                filePath: path.join(repo, 'READYOU.md'),
                originalPath: path.join(repo, 'README.md'),
                status: 'renamed',
                stage: 'staged',
            }),
        ]);
    });

    it('surfaces a conflicted merge as a conflict', async () => {
        const repo = makeRepo();
        fs.writeFileSync(path.join(repo, 'shared.txt'), 'base\n');
        git(repo, 'add', 'shared.txt');
        git(repo, 'commit', '-m', 'base');
        git(repo, 'checkout', '-b', 'other');
        fs.writeFileSync(path.join(repo, 'shared.txt'), 'theirs\n');
        git(repo, 'commit', '-am', 'theirs');
        git(repo, 'checkout', 'main');
        fs.writeFileSync(path.join(repo, 'shared.txt'), 'ours\n');
        git(repo, 'commit', '-am', 'ours');
        try {
            git(repo, 'merge', 'other');
        } catch {
            // The conflict is the point of the test.
        }

        const changes = await service.getAllChanges(repo);
        expect(changes.some(c => c.status === 'conflict')).toBe(true);
    });

    it('lists untracked directory contents per file, never as a collapsed folder', async () => {
        const repo = makeRepo();
        fs.mkdirSync(path.join(repo, 'Plans', 'nested'), { recursive: true });
        fs.writeFileSync(path.join(repo, 'Plans', 'a.md'), 'a\n');
        fs.writeFileSync(path.join(repo, 'Plans', 'nested', 'deep.md'), 'deep\n');

        const changes = await service.getAllChanges(repo);
        expect(changes.map(c => c.filePath).sort()).toEqual(
            [path.join(repo, 'Plans', 'a.md'), path.join(repo, 'Plans', 'nested', 'deep.md')].sort(),
        );
        for (const change of changes) {
            expect(change.stage).toBe('untracked');
            // No trailing separator, so the client's tree builder never yields an empty leaf.
            expect(change.filePath.endsWith(path.sep)).toBe(false);
        }
    });

    it('leaves ignored files out of the change list', async () => {
        const repo = makeRepo();
        fs.writeFileSync(path.join(repo, '.gitignore'), 'ignored.log\n');
        git(repo, 'add', '.gitignore');
        git(repo, 'commit', '-m', 'ignore logs');
        fs.writeFileSync(path.join(repo, 'ignored.log'), 'noise\n');

        await expect(service.getAllChanges(repo)).resolves.toEqual([]);
    });

    it('stamps every change with the repository root and folder name', async () => {
        const repo = makeRepo();
        fs.writeFileSync(path.join(repo, 'README.md'), 'changed\n');

        const changes = await service.getAllChanges(repo);
        expect(changes[0].repositoryRoot).toBe(repo);
        expect(changes[0].repositoryName).toBe(path.basename(repo));
    });

    it('returns an empty array when the path is not a repository', async () => {
        const notARepo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'forge-not-a-repo-')));
        repos.push(notARepo);
        await expect(service.getAllChanges(notARepo)).resolves.toEqual([]);
    });
});
