/**
 * `SyncGitRepository` against real repositories, now that every command runs in
 * the native addon.
 *
 * The suite exists because the port changed two things a mocked runner cannot
 * check. Blob reads no longer go through `git show`'s stdout, so byte-exactness
 * has to be proven against a file that is not text; and a conflicted merge is
 * no longer recognised by the words git printed on stdout — which no runner
 * keeps once a command has failed — but by the unmerged entries it left in the
 * index. Both are exercised by making the mirror do the thing, not by asserting
 * which child process was asked for.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { SyncGitRepository } from '../../src/server/sync/sync-git';

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

let tmpDir: string;
let remote: string;

function git(cwd: string, args: string[]): string {
    return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

/** A working clone of the shared bare remote, with an identity configured. */
function clone(name: string): string {
    const dir = path.join(tmpDir, name);
    git(tmpDir, ['clone', '--quiet', remote, name]);
    git(dir, ['config', 'user.email', 'sync-test@example.test']);
    git(dir, ['config', 'user.name', 'Sync Test']);
    git(dir, ['config', 'commit.gpgsign', 'false']);
    return dir;
}

function repo(dir: string): SyncGitRepository {
    return new SyncGitRepository(dir, silentLogger);
}

/** Commit `files` in `dir` and push them to the shared remote. */
function commitAndPush(dir: string, files: Record<string, string | Buffer>, message: string): void {
    for (const [name, content] of Object.entries(files)) {
        const target = path.join(dir, name);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content);
    }
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-m', message]);
    git(dir, ['push', '--quiet', 'origin', 'HEAD']);
}

beforeEach(() => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coc-sync-git-')));
    remote = path.join(tmpDir, 'remote.git');
    git(tmpDir, ['init', '--quiet', '--bare', '--initial-branch=main', 'remote.git']);
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('SyncGitRepository.readTree', () => {
    it('reads a blob byte for byte, including bytes that are not UTF-8', async () => {
        // The mirror writes what it reads back to disk, so a lossy decode here
        // would corrupt every image the user syncs with their notes.
        const image = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0xff, 0xfe, 0x00, 0x1a]);
        const source = clone('source');
        commitAndPush(source, { 'logo.png': image, 'note.md': '# note\n\n\n' }, 'first');

        const tree = await repo(source).readTree('HEAD', new Set());

        expect(tree.get('logo.png')).toEqual(image);
        // And the trailing newlines a command would have cut back to two.
        expect(tree.get('note.md')?.toString('utf8')).toBe('# note\n\n\n');
    });

    it('keeps a nested path and one holding a space', async () => {
        const source = clone('source');
        commitAndPush(source, { 'a/b/deep.md': 'deep\n', 'a note.md': 'spaced\n' }, 'first');

        const tree = await repo(source).readTree('HEAD', new Set());

        expect([...tree.keys()].sort()).toEqual(['a note.md', 'a/b/deep.md']);
        expect(tree.get('a/b/deep.md')?.toString('utf8')).toBe('deep\n');
    });

    it('never returns a name the caller asked to ignore', async () => {
        const source = clone('source');
        commitAndPush(source, { 'note.md': 'keep\n', '.lock': '123', 'sub/.lock': '456' }, 'first');

        const tree = await repo(source).readTree('HEAD', new Set(['.lock']));

        expect([...tree.keys()]).toEqual(['note.md']);
    });

    it('reads the tree of an older commit, not of HEAD', async () => {
        const source = clone('source');
        commitAndPush(source, { 'note.md': 'first\n' }, 'first');
        const first = git(source, ['rev-parse', 'HEAD']).trim();
        commitAndPush(source, { 'note.md': 'second\n', 'later.md': 'new\n' }, 'second');

        const tree = await repo(source).readTree(first, new Set());

        expect([...tree.keys()]).toEqual(['note.md']);
        expect(tree.get('note.md')?.toString('utf8')).toBe('first\n');
    });
});

describe('SyncGitRepository.pull', () => {
    it('reports a conflicting merge from the index git left behind', async () => {
        // The regression this suite is really for: the old code read the words
        // "CONFLICT"/"Automatic merge failed" off the failure, and git prints
        // those on stdout, which the native runner does not keep. A conflict
        // read as a hard error never reaches the resolver, and the sync wedges.
        const source = clone('source');
        commitAndPush(source, { 'note.md': 'base\n' }, 'first');

        const mirror = clone('mirror');
        commitAndPush(source, { 'note.md': 'theirs\n' }, 'theirs');
        fs.writeFileSync(path.join(mirror, 'note.md'), 'ours\n');
        git(mirror, ['commit', '-am', 'ours']);

        await expect(repo(mirror).pull()).resolves.toBe(true);
        expect(fs.readFileSync(path.join(mirror, 'note.md'), 'utf8')).toContain('<<<<<<<');
    });

    it('lists the conflicted paths after that pull', async () => {
        const source = clone('source');
        commitAndPush(source, { 'a.md': 'base\n', 'b.md': 'base\n' }, 'first');

        const mirror = clone('mirror');
        commitAndPush(source, { 'a.md': 'theirs\n' }, 'theirs');
        fs.writeFileSync(path.join(mirror, 'a.md'), 'ours\n');
        git(mirror, ['commit', '-am', 'ours']);

        const kernel = repo(mirror);
        expect(await kernel.pull()).toBe(true);
        expect(await kernel.conflictedFiles()).toEqual(['a.md']);
    });

    it('merges cleanly without reporting a conflict', async () => {
        const source = clone('source');
        commitAndPush(source, { 'a.md': 'base\n' }, 'first');

        const mirror = clone('mirror');
        commitAndPush(source, { 'b.md': 'theirs\n' }, 'theirs');
        fs.writeFileSync(path.join(mirror, 'c.md'), 'ours\n');
        git(mirror, ['add', '-A']);
        git(mirror, ['commit', '-m', 'ours']);

        await expect(repo(mirror).pull()).resolves.toBe(false);
        expect(fs.existsSync(path.join(mirror, 'b.md'))).toBe(true);
    });

    it('reports a conflict for a tick that starts mid-merge, rather than wedging', async () => {
        // A divergence worth naming: reading the index rather than the failure
        // text means a repository left mid-merge by an earlier tick reports its
        // leftover conflict instead of throwing "You have not concluded your
        // merge". The resolver is exactly what should run next, so the sync
        // heals where it used to back off.
        const source = clone('source');
        commitAndPush(source, { 'note.md': 'base\n' }, 'first');

        const mirror = clone('mirror');
        commitAndPush(source, { 'note.md': 'theirs\n' }, 'theirs');
        fs.writeFileSync(path.join(mirror, 'note.md'), 'ours\n');
        git(mirror, ['commit', '-am', 'ours']);

        const kernel = repo(mirror);
        expect(await kernel.pull()).toBe(true);
        // Still mid-merge — nothing resolved the conflict.
        expect(fs.existsSync(path.join(mirror, '.git', 'MERGE_HEAD'))).toBe(true);

        expect(await kernel.pull()).toBe(true);
        expect(await kernel.conflictedFiles()).toEqual(['note.md']);
    });

    it('reports nothing pulled for an empty remote', async () => {
        const mirror = clone('mirror');
        await expect(repo(mirror).pull()).resolves.toBe(false);
    });

    it('throws for a failure that is not a conflict', async () => {
        // Unrelated histories: the caller has to decide whether to heal, so this
        // must not be flattened into "conflicts" or into "nothing to pull".
        const source = clone('source');
        commitAndPush(source, { 'note.md': 'remote\n' }, 'first');

        const orphan = path.join(tmpDir, 'orphan');
        fs.mkdirSync(orphan);
        git(orphan, ['init', '--quiet', '--initial-branch=main']);
        git(orphan, ['config', 'user.email', 'sync-test@example.test']);
        git(orphan, ['config', 'user.name', 'Sync Test']);
        git(orphan, ['config', 'commit.gpgsign', 'false']);
        git(orphan, ['remote', 'add', 'origin', remote]);
        fs.writeFileSync(path.join(orphan, 'own.md'), 'own\n');
        git(orphan, ['add', '-A']);
        git(orphan, ['commit', '-m', 'own']);

        await expect(repo(orphan).pull()).rejects.toThrow(/^git pull .* failed: /);
    });
});

describe('SyncGitRepository mirror lifecycle', () => {
    it('clones into a directory that is not a repository yet', async () => {
        // `-C <dir>` addresses the mirror now, where the old runner used `cwd`.
        // Clone is the one command that runs before the repository exists.
        const source = clone('source');
        commitAndPush(source, { 'note.md': 'hello\n' }, 'first');

        const fresh = path.join(tmpDir, 'fresh');
        fs.mkdirSync(fresh);
        const kernel = repo(fresh);
        expect(await kernel.isUsable()).toBe(false);

        await kernel.clone(remote);

        expect(await kernel.isUsable()).toBe(true);
        expect(fs.readFileSync(path.join(fresh, 'note.md'), 'utf8')).toBe('hello\n');
    });

    it('calls a mirror whose refs no longer resolve unusable', async () => {
        const mirror = clone('mirror');
        commitAndPush(mirror, { 'note.md': 'hello\n' }, 'first');
        expect(await repo(mirror).isUsable()).toBe(true);

        // Point main at an object the repository does not hold — the damage
        // `for-each-ref` exists to catch.
        fs.writeFileSync(
            path.join(mirror, '.git', 'refs', 'heads', 'main'),
            `${'0'.repeat(39)}1\n`,
        );

        expect(await repo(mirror).isUsable()).toBe(false);
    });

    it('calls a fresh clone of an empty remote usable', async () => {
        // Unborn HEAD is healthy: mistaking it for damage rebuilds every tick.
        expect(await repo(clone('mirror')).isUsable()).toBe(true);
    });

    it('adds origin when there is none and updates it when it drifted', async () => {
        const bare = path.join(tmpDir, 'other.git');
        git(tmpDir, ['init', '--quiet', '--bare', 'other.git']);

        const plain = path.join(tmpDir, 'plain');
        fs.mkdirSync(plain);
        git(plain, ['init', '--quiet', '--initial-branch=main']);

        const kernel = repo(plain);
        await kernel.ensureRemote(remote);
        expect(git(plain, ['remote', 'get-url', 'origin']).trim()).toBe(remote);

        await kernel.ensureRemote(bare);
        expect(git(plain, ['remote', 'get-url', 'origin']).trim()).toBe(bare);
    });

    it('stages everything but the ignored names, and reports whether it staged', async () => {
        const mirror = clone('mirror');
        commitAndPush(mirror, { 'note.md': 'hello\n' }, 'first');
        const kernel = repo(mirror);

        expect(await kernel.stageAll(new Set(['.lock']))).toBe(false);

        fs.writeFileSync(path.join(mirror, 'new note.md'), 'added\n');
        fs.writeFileSync(path.join(mirror, '.lock'), '123');

        expect(await kernel.stageAll(new Set(['.lock']))).toBe(true);
        expect(git(mirror, ['diff', '--cached', '--name-only']).trim()).toBe('new note.md');
    });

    it('tracks the remote through headSha, fetchHeadSha and hasRemoteChanges', async () => {
        const source = clone('source');
        const mirror = clone('mirror'); // cloned while the remote was still empty
        const kernel = repo(mirror);
        expect(await kernel.hasRemoteCommits()).toBe(false);

        commitAndPush(source, { 'note.md': 'first\n' }, 'first');
        expect(await kernel.hasRemoteCommits()).toBe(true);
        expect(await kernel.hasRemoteChanges()).toBe(true); // no local commits yet
        expect(await kernel.pull()).toBe(false);
        expect(await kernel.hasRemoteChanges()).toBe(false);

        commitAndPush(source, { 'note.md': 'second\n' }, 'second');
        expect(await kernel.hasRemoteChanges()).toBe(true);
        expect(await kernel.fetchHeadSha()).toBe(git(source, ['rev-parse', 'HEAD']).trim());
        expect(await kernel.headSha()).not.toBe(await kernel.fetchHeadSha());
    });

    it('reads the remote default branch, and answers null when there is no remote', async () => {
        const source = clone('source');
        commitAndPush(source, { 'note.md': 'hello\n' }, 'first');
        git(remote, ['symbolic-ref', 'HEAD', 'refs/heads/main']);

        expect(await repo(clone('mirror')).defaultBranch()).toBe('main');

        const plain = path.join(tmpDir, 'plain');
        fs.mkdirSync(plain);
        git(plain, ['init', '--quiet', '--initial-branch=main']);
        expect(await repo(plain).defaultBranch()).toBeNull();
        expect(await repo(plain).hasRemoteCommits()).toBe(false);
        expect(await repo(plain).hasRemoteChanges()).toBe(false);
    });

    it('commits, tags, pushes the tag, and moves HEAD without touching the tree', async () => {
        const mirror = clone('mirror');
        git(mirror, ['config', 'user.email', 'sync-test@example.test']);
        fs.writeFileSync(path.join(mirror, 'note.md'), 'hello\n');
        const kernel = repo(mirror);

        await kernel.stageAll(new Set());
        await kernel.commit('sync from a test');
        await kernel.push();
        await kernel.tag('backup-1', 'HEAD');
        await kernel.pushTag('backup-1');

        expect(git(remote, ['tag']).trim()).toBe('backup-1');
        expect(git(mirror, ['log', '-1', '--pretty=%s']).trim()).toBe('sync from a test');

        git(mirror, ['branch', 'other']);
        await kernel.setHeadToBranch('other');
        expect(git(mirror, ['symbolic-ref', 'HEAD']).trim()).toBe('refs/heads/other');
    });

    it('resetMixed moves the branch and leaves the working tree alone', async () => {
        const mirror = clone('mirror');
        commitAndPush(mirror, { 'note.md': 'first\n' }, 'first');
        const first = git(mirror, ['rev-parse', 'HEAD']).trim();
        commitAndPush(mirror, { 'note.md': 'second\n' }, 'second');

        await repo(mirror).resetMixed(first);

        expect(git(mirror, ['rev-parse', 'HEAD']).trim()).toBe(first);
        expect(fs.readFileSync(path.join(mirror, 'note.md'), 'utf8')).toBe('second\n');
    });

    it('takes the remote side of a conflicted path and stages it', async () => {
        const source = clone('source');
        commitAndPush(source, { 'note.md': 'base\n' }, 'first');
        const mirror = clone('mirror');
        commitAndPush(source, { 'note.md': 'theirs\n' }, 'theirs');
        fs.writeFileSync(path.join(mirror, 'note.md'), 'ours\n');
        git(mirror, ['commit', '-am', 'ours']);

        const kernel = repo(mirror);
        expect(await kernel.pull()).toBe(true);
        await kernel.checkoutTheirs('note.md');

        expect(fs.readFileSync(path.join(mirror, 'note.md'), 'utf8')).toBe('theirs\n');
        expect(await kernel.conflictedFiles()).toEqual([]);
    });
});
