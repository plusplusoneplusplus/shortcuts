/**
 * Reading a repository's remotes, against real repositories.
 *
 * The lookup runs in the addon now, so there is no `execGitAsync` call sequence
 * left to assert on. What matters on this side of the boundary is what callers
 * actually depend on: the `null`/`undefined` shape each function answers a
 * missing remote with, and — the reason this suite is worth its runtime — that
 * the URL comes back byte-for-byte as it was configured.
 *
 * That last point is not cosmetic. `computeRemoteHash` and
 * `resolveCanonicalOrigin` turn this string into an id that is persisted, and
 * the repo sidebar groups clones by a key built from it without lowercasing, so
 * a URL that came back reshaped would split one repository into two.
 *
 * Rust owns the lookup semantics themselves — `rust/core/tests/git_remote.rs`
 * checks every URL form differentially against the real `git remote get-url`.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';

import { computeRemoteHash, detectRemoteUrl, getRemoteUrl, resolveCanonicalOriginId } from '../../src/git/remote';

const repos: string[] = [];

function git(repo: string, ...args: string[]): string {
    return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf-8' }).trim();
}

/** A repository with one commit and no remotes. */
function makeRepo(): string {
    const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'forge-git-remote-')));
    repos.push(repo);
    git(repo, 'init', '--initial-branch=main');
    git(repo, 'config', 'user.email', 'ralph@example.com');
    git(repo, 'config', 'user.name', 'Ralph');
    git(repo, 'config', 'commit.gpgsign', 'false');
    fs.writeFileSync(path.join(repo, 'README.md'), 'one\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-m', 'first');
    return repo;
}

function makeRepoWithOrigin(url: string): string {
    const repo = makeRepo();
    git(repo, 'remote', 'add', 'origin', url);
    return repo;
}

afterAll(() => {
    for (const repo of repos) {
        fs.rmSync(repo, { recursive: true, force: true });
    }
});

describe('getRemoteUrl', () => {
    it('reads the origin URL', async () => {
        const repo = makeRepoWithOrigin('https://github.com/owner/repo.git');
        await expect(getRemoteUrl(repo)).resolves.toBe('https://github.com/owner/repo.git');
    });

    it('reads a remote other than origin by name', async () => {
        const repo = makeRepoWithOrigin('https://github.com/owner/repo.git');
        git(repo, 'remote', 'add', 'upstream', 'https://github.com/other/repo.git');
        await expect(getRemoteUrl(repo, 'upstream')).resolves.toBe('https://github.com/other/repo.git');
    });

    it('returns null when the remote is not configured', async () => {
        const repo = makeRepo();
        await expect(getRemoteUrl(repo)).resolves.toBeNull();
    });

    it('returns null when the path is not a repository', async () => {
        const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'forge-git-remote-bare-')));
        repos.push(dir);
        await expect(getRemoteUrl(dir)).resolves.toBeNull();
    });
});

describe('detectRemoteUrl', () => {
    it('returns the origin URL when origin is configured', async () => {
        const repo = makeRepoWithOrigin('https://github.com/owner/repo.git');
        await expect(detectRemoteUrl(repo)).resolves.toBe('https://github.com/owner/repo.git');
    });

    it('prefers origin over an alphabetically earlier remote', async () => {
        const repo = makeRepoWithOrigin('https://github.com/owner/repo.git');
        git(repo, 'remote', 'add', 'alpha', 'https://example.com/alpha.git');
        await expect(detectRemoteUrl(repo)).resolves.toBe('https://github.com/owner/repo.git');
    });

    it('falls back to the first remote by name when origin is absent', async () => {
        const repo = makeRepo();
        git(repo, 'remote', 'add', 'zeta', 'https://example.com/zeta.git');
        git(repo, 'remote', 'add', 'upstream', 'https://example.com/upstream.git');
        await expect(detectRemoteUrl(repo)).resolves.toBe('https://example.com/upstream.git');
    });

    it('returns undefined when no remotes are configured', async () => {
        const repo = makeRepo();
        await expect(detectRemoteUrl(repo)).resolves.toBeUndefined();
    });

    it('returns undefined when the path is not a repository', async () => {
        const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'forge-git-remote-bare-')));
        repos.push(dir);
        await expect(detectRemoteUrl(dir)).resolves.toBeUndefined();
    });

    it('returns undefined when the path does not exist', async () => {
        await expect(detectRemoteUrl(path.join(os.tmpdir(), 'forge-git-remote-missing-xyz'))).resolves.toBeUndefined();
    });

    it('discovers the repository from a subdirectory', async () => {
        const repo = makeRepoWithOrigin('https://github.com/owner/repo.git');
        const nested = path.join(repo, 'src', 'deep');
        fs.mkdirSync(nested, { recursive: true });
        await expect(detectRemoteUrl(nested)).resolves.toBe('https://github.com/owner/repo.git');
    });
});

describe('the URL that reaches the hashes', () => {
    /**
     * Every form a real clone can carry, each one a different branch of the URL
     * parser the native path runs the value through.
     */
    const forms = [
        'https://github.com/owner/repo.git',
        'https://user:token@github.com/owner/repo.git',
        'git@github.com:owner/repo.git',
        'ssh://git@ssh.dev.azure.com/v3/org/project/repo',
        'git://github.com/owner/repo.git',
        'https://dev.azure.com/org/My%20Project/_git/Repo',
        'file:///srv/git/repo.git',
        '/srv/git/repo.git',
    ];

    it.each(forms)('hands %s back unchanged', async (url) => {
        const repo = makeRepoWithOrigin(url);
        await expect(detectRemoteUrl(repo)).resolves.toBe(url);
        await expect(getRemoteUrl(repo)).resolves.toBe(url);
    });

    it('keeps mixed-case hosts, which the grouping key does not lowercase', async () => {
        // The URL parser behind the native path lowercases a host when it
        // re-renders a parsed URL. `normalizeRemoteUrl`'s Azure DevOps rewrite
        // carries the org through with its casing intact, so a reshaped host
        // here would put this clone in a different sidebar group than one read
        // before the move.
        const url = 'https://Org.visualstudio.com/Project/_git/Repo';
        const repo = makeRepoWithOrigin(url);
        await expect(detectRemoteUrl(repo)).resolves.toBe(url);
    });

    it('produces the same origin id and hash the CLI path produced', async () => {
        const url = 'https://github.com/Owner/Repo.git';
        const repo = makeRepoWithOrigin(url);
        const detected = await detectRemoteUrl(repo);

        expect(detected).toBe(url);
        expect(computeRemoteHash(detected!)).toBe(computeRemoteHash(url));
        expect(resolveCanonicalOriginId({ remoteUrl: detected })).toBe('gh_owner_repo');
    });
});
