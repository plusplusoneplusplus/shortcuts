/**
 * Git Utilities — native path, against real repositories.
 *
 * `git-utils.ts` used to build shell command lines and hand them to
 * `execAsync`. It now discovers the repository with `gix` and runs its three
 * remaining commands as argv arrays through the addon. Nothing here mocks: each
 * case drives a temp repository and compares the answer against what the same
 * git command actually prints, because that is the only way to tell a port from
 * a plausible rewrite.
 *
 * Three of these cases would have failed against the shell implementation, and
 * each says so where it is asserted.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    getGitRoot,
    getRepoHeadHash,
    getFolderHeadHash,
    getChangedFiles,
    hasChanges,
    isGitAvailable,
    isGitRepo,
} from '../../src/cache/git-utils';

const execAsync = promisify(exec);

/** A folder name whose `$` a POSIX shell expands and an argv array does not. */
const SPACED_FOLDER = 'spaced $folder';

let tempRoot: string;
let repo: string;
/** Commit that added `src/app.ts`. */
let srcCommit: string;
/** Commit that added `<SPACED_FOLDER>/note.md`. */
let spacedCommit: string;
/** The repository's HEAD — a commit that touches neither of the two above. */
let headCommit: string;
/** The first commit, used as a `--since` base. */
let baseCommit: string;

function git(args: string[], cwd: string): string {
    return execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        env: {
            ...process.env,
            GIT_AUTHOR_NAME: 'Wiki Test',
            GIT_AUTHOR_EMAIL: 'wiki@example.com',
            GIT_COMMITTER_NAME: 'Wiki Test',
            GIT_COMMITTER_EMAIL: 'wiki@example.com',
        },
    }).trim();
}

function commit(file: string, contents: string): string {
    const absolute = path.join(repo, file);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, contents, 'utf-8');
    git(['add', '--', file], repo);
    git(['commit', '-m', `add ${file}`], repo);
    return git(['rev-parse', 'HEAD'], repo);
}

beforeAll(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-wiki-git-native-'));
    repo = path.join(tempRoot, 'repo');
    fs.mkdirSync(repo, { recursive: true });
    git(['init'], repo);
    git(['config', 'user.name', 'Wiki Test'], repo);
    git(['config', 'user.email', 'wiki@example.com'], repo);
    // Windows would otherwise rewrite the line endings under us.
    git(['config', 'core.autocrlf', 'false'], repo);

    baseCommit = commit('README.md', '# wiki\n');
    srcCommit = commit('src/app.ts', 'export const a = 1;\n');
    spacedCommit = commit(`${SPACED_FOLDER}/note.md`, 'note\n');
    // HEAD deliberately touches neither `src/` nor the spaced folder, so a
    // folder-scoped hash that silently fell back to HEAD is visible.
    headCommit = commit('docs/guide.md', 'guide\n');
});

afterAll(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
});

// ============================================================================
// getGitRoot
// ============================================================================

describe('getGitRoot (gix discovery)', () => {
    it('agrees with git rev-parse --show-toplevel for the repository root', async () => {
        const discovered = await getGitRoot(repo);
        expect(discovered).not.toBeNull();
        // git prints the physical path and discovery reports the path it walked;
        // they differ wherever a symlink is involved, so canonicalise both.
        expect(fs.realpathSync(discovered!)).toBe(
            fs.realpathSync(git(['rev-parse', '--show-toplevel'], repo)),
        );
    });

    it('returns the same root from a nested subfolder', async () => {
        const fromRoot = await getGitRoot(repo);
        const fromNested = await getGitRoot(path.join(repo, 'src'));
        expect(fromNested).toBe(fromRoot);
    });

    it('returns null outside a repository and for a path that does not exist', async () => {
        expect(await getGitRoot(tempRoot)).toBeNull();
        expect(await getGitRoot(path.join(tempRoot, 'no-such-directory'))).toBeNull();
    });

    it("answers in the caller's own spelling when the repository is reached through a symlink", async () => {
        if (process.platform === 'win32') return; // needs privileges on Windows
        const link = path.join(tempRoot, 'link-to-repo');
        fs.symlinkSync(repo, link, 'dir');

        const discovered = await getGitRoot(path.join(link, 'src'));
        expect(discovered).toBe(link);

        // Non-vacuity: the physical path `--show-toplevel` prints is a different
        // string, and relativising the caller's subfolder against it walks out
        // of the repository — which is what used to make the hash below null.
        const physical = git(['rev-parse', '--show-toplevel'], repo);
        expect(physical).not.toBe(link);
        expect(path.relative(physical, path.join(link, 'src')).startsWith('..')).toBe(true);

        expect(await getFolderHeadHash(path.join(link, 'src'))).toBe(srcCommit);
    });
});

// ============================================================================
// getRepoHeadHash
// ============================================================================

describe('getRepoHeadHash', () => {
    it('returns exactly what git rev-parse HEAD prints', async () => {
        expect(await getRepoHeadHash(repo)).toBe(git(['rev-parse', 'HEAD'], repo));
    });

    it('returns null outside a repository, for a missing path, and for a repository with no commits', async () => {
        const empty = path.join(tempRoot, 'unborn');
        fs.mkdirSync(empty, { recursive: true });
        git(['init'], empty);

        expect(await getRepoHeadHash(tempRoot)).toBeNull();
        expect(await getRepoHeadHash(path.join(tempRoot, 'no-such-directory'))).toBeNull();
        expect(await getRepoHeadHash(empty)).toBeNull();
    });
});

// ============================================================================
// getFolderHeadHash
// ============================================================================

describe('getFolderHeadHash', () => {
    it('falls back to repo-wide HEAD when asked for the root itself', async () => {
        expect(await getFolderHeadHash(repo)).toBe(headCommit);
    });

    it('returns the last commit that touched a subfolder, not HEAD', async () => {
        const scoped = await getFolderHeadHash(path.join(repo, 'src'));
        expect(scoped).toBe(srcCommit);
        expect(scoped).not.toBe(headCommit);
        expect(scoped).toBe(git(['log', '-1', '--format=%H', '--', 'src'], repo));
    });

    it('scopes a folder whose name a shell would have rewritten', async () => {
        // The pathspec is an argv entry now. As a word inside
        // `git log … -- "spaced $folder"` a POSIX shell expanded `$folder` to
        // nothing, git matched no path, and the answer silently became HEAD.
        expect(await getFolderHeadHash(path.join(repo, SPACED_FOLDER))).toBe(spacedCommit);
    });

    it('the shell command this replaced really did lose that folder', async () => {
        if (process.platform === 'win32') return; // cmd.exe leaves `$folder` alone
        // The exact command line the old implementation built. The shell ate
        // `$folder`, git matched nothing and printed nothing, and the empty
        // string then failed the hash regex — which sent the old code down its
        // "no commits touching this folder" fallback to repo HEAD.
        const legacy = await execAsync(
            `git log -1 --format=%H -- "${SPACED_FOLDER}"`,
            { cwd: repo },
        );
        expect(legacy.stdout.trim()).toBe('');
        expect(await getFolderHeadHash(path.join(repo, SPACED_FOLDER))).not.toBe(headCommit);
    });

    it('falls back to repo HEAD for a folder no commit has touched', async () => {
        const untracked = path.join(repo, 'never-committed');
        fs.mkdirSync(untracked, { recursive: true });
        expect(await getFolderHeadHash(untracked)).toBe(headCommit);
    });

    it('returns null outside a repository and for a path that does not exist', async () => {
        expect(await getFolderHeadHash(tempRoot)).toBeNull();
        expect(await getFolderHeadHash(path.join(tempRoot, 'no-such-directory'))).toBeNull();
    });
});

// ============================================================================
// getChangedFiles / hasChanges
// ============================================================================

describe('getChangedFiles', () => {
    it('returns exactly the list git diff --name-only prints', async () => {
        const expected = git(['diff', '--name-only', baseCommit, 'HEAD'], repo)
            .split('\n')
            .filter(line => line.length > 0);

        expect(await getChangedFiles(repo, baseCommit)).toEqual(expected);
        expect(expected).toContain('src/app.ts');
    });

    it('is empty when HEAD is compared with itself', async () => {
        expect(await getChangedFiles(repo, headCommit)).toEqual([]);
        expect(await hasChanges(repo, headCommit)).toBe(false);
        expect(await hasChanges(repo, baseCommit)).toBe(true);
    });

    it('filters and remaps to a scope path', async () => {
        expect(await getChangedFiles(repo, baseCommit, path.join(repo, 'src'))).toEqual(['app.ts']);
    });

    it('does not filter when the scope path is the repository root', async () => {
        const unscoped = await getChangedFiles(repo, baseCommit);
        expect(await getChangedFiles(repo, baseCommit, repo)).toEqual(unscoped);
    });

    it('returns null for a hash that does not resolve and outside a repository', async () => {
        expect(await getChangedFiles(repo, 'not-a-real-revision')).toBeNull();
        expect(await getChangedFiles(tempRoot, baseCommit)).toBeNull();
        expect(await hasChanges(tempRoot, 'not-a-real-revision')).toBeNull();
    });

    it('treats a revision argument as an argument, not as shell input', async () => {
        // `sinceHash` used to be interpolated into a command line the shell then
        // re-read. It reaches git as one word now, so this is a failed revision
        // rather than a second command.
        expect(await getChangedFiles(repo, `${baseCommit}; touch pwned`)).toBeNull();
        expect(fs.existsSync(path.join(repo, 'pwned'))).toBe(false);
    });
});

// ============================================================================
// isGitRepo / isGitAvailable
// ============================================================================

describe('isGitRepo and isGitAvailable', () => {
    it('recognises a repository, a subfolder of one, and neither', async () => {
        expect(await isGitRepo(repo)).toBe(true);
        expect(await isGitRepo(path.join(repo, 'src'))).toBe(true);
        expect(await isGitRepo(tempRoot)).toBe(false);
        expect(await isGitRepo(path.join(tempRoot, 'no-such-directory'))).toBe(false);
    });

    it('reports git as available', async () => {
        expect(await isGitAvailable()).toBe(true);
    });
});
