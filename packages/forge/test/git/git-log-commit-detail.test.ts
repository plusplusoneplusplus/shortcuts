/**
 * `GitLogService`'s commit-detail half, against real temporary repositories.
 *
 * The suite that runs against this checkout can only assert shapes — it cannot
 * arrange a rename, a binary file, a root commit or an annotated tag. These are
 * the cases where the native port had to make a choice, so each one is pinned
 * against a repository built to trigger exactly it.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { GitLogService } from '../../src/git/git-log-service';

let repo: string;
let root: string;
let head: string;
let service: GitLogService;

function git(...args: string[]): string {
    return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf-8' });
}

beforeAll(() => {
    repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'forge-git-log-detail-')));
    git('init', '--initial-branch=main');
    git('config', 'user.email', 'ralph@example.com');
    git('config', 'user.name', 'Ralph');
    git('config', 'commit.gpgsign', 'false');

    fs.mkdirSync(path.join(repo, 'src'));
    fs.writeFileSync(path.join(repo, 'src', 'old.ts'), 'export const value = 1;\n');
    // Three trailing newlines: a command would hand back two.
    fs.writeFileSync(path.join(repo, 'keep.md'), 'body\n\n\n');
    fs.writeFileSync(path.join(repo, 'logo.bin'), Buffer.from([0, 1, 2, 3, 0xff]));
    fs.writeFileSync(path.join(repo, 'a file with spaces.md'), 'spaced\n');
    git('add', '-A');
    git('commit', '-m', 'first');
    root = git('rev-parse', 'HEAD').trim();

    fs.renameSync(path.join(repo, 'src', 'old.ts'), path.join(repo, 'src', 'new.ts'));
    fs.writeFileSync(path.join(repo, 'added.txt'), 'new file\n');
    fs.writeFileSync(path.join(repo, 'logo.bin'), Buffer.from([9, 9, 9, 0, 0xfe]));
    git('add', '-A');
    git('commit', '-m', 'second');
    head = git('rev-parse', 'HEAD').trim();

    service = new GitLogService();
});

afterAll(() => {
    service?.dispose();
    if (repo) fs.rmSync(repo, { recursive: true, force: true });
});

describe('getCommitFiles', () => {
    it('attaches the commit, parent and repository to every row', async () => {
        const files = await service.getCommitFiles(repo, head);
        expect(files.length).toBeGreaterThan(0);
        for (const file of files) {
            expect(file.commitHash).toBe(head);
            expect(file.parentHash).toBe(root);
            expect(file.repositoryRoot).toBe(repo);
        }
    });

    it('reports a rename with both ends', async () => {
        const files = await service.getCommitFiles(repo, head);
        const renamed = files.find(file => file.path === 'src/new.ts');
        expect(renamed).toMatchObject({ status: 'renamed', originalPath: 'src/old.ts' });
    });

    it('leaves originalPath absent on a plain change', async () => {
        const files = await service.getCommitFiles(repo, head);
        const added = files.find(file => file.path === 'added.txt');
        expect(added?.status).toBe('added');
        expect('originalPath' in (added as object)).toBe(false);
    });

    it('leaves the counts absent for a binary file rather than showing zero', async () => {
        const files = await service.getCommitFiles(repo, head);
        const binary = files.find(file => file.path === 'logo.bin');
        expect(binary).toBeDefined();
        expect('additions' in (binary as object)).toBe(false);
        expect('deletions' in (binary as object)).toBe(false);
    });

    it('carries the line counts for a text change', async () => {
        const files = await service.getCommitFiles(repo, head);
        const added = files.find(file => file.path === 'added.txt');
        expect(added?.additions).toBe(1);
        expect(added?.deletions).toBe(0);
    });

    // `diff-tree` compares a commit against its parents, so the first commit in
    // a repository has always shown an empty file list.
    it('reports the empty tree and no files for a root commit', async () => {
        const files = await service.getCommitFiles(repo, root);
        expect(files).toEqual([]);
    });
});

describe('getCommitDiff', () => {
    it('matches the diff the pre-change command produced', async () => {
        const native = await service.getCommitDiff(repo, head);
        const legacy = git('diff', root, head).replace(/\r?\n$/, '');
        expect(native).toBe(legacy);
        expect(native).toContain('rename from src/old.ts');
    });

    it('diffs a root commit against the empty tree', async () => {
        const diff = await service.getCommitDiff(repo, root);
        expect(diff).toContain('+export const value = 1;');
    });
});

describe('getFileContentAtCommit', () => {
    // The reason the content is read out of the object database: a command
    // loses one trailing newline crossing the native boundary, and a file's
    // bytes cannot afford to.
    it('keeps every trailing newline the file holds', async () => {
        await expect(service.getFileContentAtCommit(repo, head, 'keep.md')).resolves.toBe(
            'body\n\n\n',
        );
    });

    it('reads a path holding a space, with no shell to quote for', async () => {
        await expect(
            service.getFileContentAtCommit(repo, head, 'a file with spaces.md'),
        ).resolves.toBe('spaced\n');
    });

    it('normalises a backslash path before the lookup', async () => {
        await expect(service.getFileContentAtCommit(repo, head, 'src\\new.ts')).resolves.toBe(
            'export const value = 1;\n',
        );
    });

    it('reads the file as it stood at an older commit', async () => {
        await expect(service.getFileContentAtCommit(repo, root, 'src/old.ts')).resolves.toBe(
            'export const value = 1;\n',
        );
        // The rename means the old path is gone by HEAD.
        expect(await service.getFileContentAtCommit(repo, head, 'src/old.ts')).toBeUndefined();
    });

    it('answers undefined for a missing path and a directory', async () => {
        expect(await service.getFileContentAtCommit(repo, head, 'nope.txt')).toBeUndefined();
        expect(await service.getFileContentAtCommit(repo, head, 'src')).toBeUndefined();
    });
});

describe('fileExistsAtCommit', () => {
    it('follows the commit it is asked about', async () => {
        expect(await service.fileExistsAtCommit(repo, root, 'src/old.ts')).toBe(true);
        expect(await service.fileExistsAtCommit(repo, head, 'src/old.ts')).toBe(false);
        expect(await service.fileExistsAtCommit(repo, head, 'src/new.ts')).toBe(true);
    });
});

describe('validateRef', () => {
    it('resolves a lightweight tag and refuses an annotated one', async () => {
        git('tag', 'light');
        git('tag', '-a', 'heavy', '-m', 'annotated');

        // The quirk the port keeps: neither `rev-parse --verify` nor
        // `cat-file -t` peels, so an annotated tag reads back as a tag object.
        await expect(service.validateRef(repo, 'light')).resolves.toBe(head);
        await expect(service.validateRef(repo, 'heavy')).resolves.toBeUndefined();
    });
});

describe('working-tree questions', () => {
    it('reports a clean tree as clean and a dirty one as dirty', async () => {
        expect(await service.hasPendingChanges(repo)).toBe(false);
        fs.writeFileSync(path.join(repo, 'added.txt'), 'edited\n');
        try {
            expect(await service.hasPendingChanges(repo)).toBe(true);
            expect(await service.hasStagedChanges(repo)).toBe(false);
            git('add', 'added.txt');
            expect(await service.hasStagedChanges(repo)).toBe(true);
            expect(await service.getStagedChangesDiff(repo)).toContain('+edited');
            expect(await service.getPendingChangesDiff(repo)).toContain('# Staged Changes');
        } finally {
            git('reset', '--hard', 'HEAD');
        }
    });

    it('counts the commits behind hasMoreCommits', async () => {
        expect(await service.hasMoreCommits(repo, 1)).toBe(true);
        expect(await service.hasMoreCommits(repo, 2)).toBe(false);
    });
});

describe('getBranches', () => {
    it('lists local branches in refname order and caps the list at ten', async () => {
        for (let index = 0; index < 12; index += 1) {
            git('branch', `topic-${String(index).padStart(2, '0')}`);
        }
        const legacy = git('branch', '--format=%(refname:short)')
            .trim()
            .split('\n')
            .filter(name => name && !name.includes('HEAD'))
            .slice(0, 10);

        const branches = await service.getBranches(repo, true);
        expect(branches).toHaveLength(10);
        expect(branches).toEqual(legacy);
        // refname order, so `main` sorts ahead of every `topic-*`.
        expect(branches[0]).toBe('main');
    });
});
