/**
 * `readGitOriginRemote` against real repositories.
 *
 * It used to spawn `git remote get-url origin`; it now reads
 * `remote.origin.url` out of the repository with `gix` and starts no child
 * process at all. Reading a remote is a configuration lookup, so there is
 * nothing for a CLI to add — but "the same answer" is the whole contract here,
 * and only a real repository can prove it. Every case below asserts the port
 * against what the command it replaced actually prints.
 *
 * The casing case is the one that matters most: `gix` re-renders a parsed URL
 * with the host lowercased, and a repo sidebar that groups by that string would
 * split one repository into two if the raw configured value were lost.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execGitAsync } from '@plusplusoneplusplus/forge';
import {
    readGitOriginRemote,
    resolveGitHubWorkItemSyncRepo,
} from '../../../src/server/work-items/work-item-sync-github-repo';

let tmpDir: string;

/** A repository whose `origin` is `remoteUrl`, or one with no remote at all. */
async function makeRepo(name: string, remoteUrl?: string): Promise<string> {
    const dir = path.join(tmpDir, name);
    fs.mkdirSync(dir, { recursive: true });
    await execGitAsync(['init', '-q', '-b', 'main', '.'], dir);
    if (remoteUrl) {
        await execGitAsync(['remote', 'add', 'origin', remoteUrl], dir);
    }
    return dir;
}

/** What `git remote get-url origin` prints, or `undefined` when it fails. */
async function viaCli(dir: string): Promise<string | undefined> {
    try {
        const out = (await execGitAsync(['remote', 'get-url', 'origin'], dir)).trim();
        return out.length > 0 ? out : undefined;
    } catch {
        return undefined;
    }
}

beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'origin-remote-'));
});

afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('readGitOriginRemote', () => {
    it('reads an https origin, and agrees with git remote get-url', async () => {
        const dir = await makeRepo('https-origin', 'https://github.com/octo-org/octo-repo.git');
        expect(await readGitOriginRemote(dir)).toBe('https://github.com/octo-org/octo-repo.git');
        expect(await readGitOriginRemote(dir)).toBe(await viaCli(dir));
    });

    it('reads an scp-style SSH origin verbatim', async () => {
        const dir = await makeRepo('ssh-origin', 'git@github.com:octo-org/octo-repo.git');
        expect(await readGitOriginRemote(dir)).toBe('git@github.com:octo-org/octo-repo.git');
        expect(await readGitOriginRemote(dir)).toBe(await viaCli(dir));
    });

    it('preserves the configured URL casing rather than a lowercased re-render', async () => {
        const configured = 'https://Org.visualstudio.com/Project/_git/Repo';
        const dir = await makeRepo('cased-origin', configured);
        expect(await readGitOriginRemote(dir)).toBe(configured);
        expect(await readGitOriginRemote(dir)).toBe(await viaCli(dir));
    });

    it('answers undefined for a repository with no origin', async () => {
        const dir = await makeRepo('no-origin');
        expect(await readGitOriginRemote(dir)).toBeUndefined();
        expect(await viaCli(dir)).toBeUndefined();
    });

    it('answers undefined when only a differently-named remote exists', async () => {
        const dir = await makeRepo('other-remote');
        await execGitAsync(['remote', 'add', 'upstream', 'https://github.com/o/r.git'], dir);
        expect(await readGitOriginRemote(dir)).toBeUndefined();
        expect(await viaCli(dir)).toBeUndefined();
    });

    it('answers undefined for a directory that is not a repository', async () => {
        const dir = path.join(tmpDir, 'plain-dir');
        fs.mkdirSync(dir, { recursive: true });
        expect(await readGitOriginRemote(dir)).toBeUndefined();
    });

    it('answers undefined for a path that does not exist', async () => {
        expect(await readGitOriginRemote(path.join(tmpDir, 'nope'))).toBeUndefined();
    });

    it('answers undefined for a repository with no commits but an origin — the remote is config, not history', async () => {
        const dir = await makeRepo('empty-with-origin', 'https://github.com/octo-org/empty.git');
        expect(await readGitOriginRemote(dir)).toBe('https://github.com/octo-org/empty.git');
    });
});

describe('resolveGitHubWorkItemSyncRepo through the shipped reader', () => {
    // Every other case in this area injects `readOriginRemote`, so nothing
    // exercised the default the server actually runs.
    it('defaults owner and repo from a real repository origin', async () => {
        const dir = await makeRepo('resolve-origin', 'git@github.com:octo-org/octo-repo.git');
        await expect(resolveGitHubWorkItemSyncRepo({ workspace: { rootPath: dir } })).resolves.toEqual({
            available: true,
            provider: 'github',
            owner: 'octo-org',
            repo: 'octo-repo',
            url: 'https://github.com/octo-org/octo-repo',
            source: 'origin',
        });
    });

    it('reports missing-origin for a real repository without one', async () => {
        const dir = await makeRepo('resolve-no-origin');
        await expect(resolveGitHubWorkItemSyncRepo({ workspace: { rootPath: dir } })).resolves.toEqual({
            available: false,
            provider: 'github',
            reason: 'missing-origin',
        });
    });

    it('reports non-github-origin for a real repository pointed elsewhere', async () => {
        const dir = await makeRepo('resolve-other-host', 'https://gitlab.com/octo-org/octo-repo.git');
        await expect(resolveGitHubWorkItemSyncRepo({ workspace: { rootPath: dir } })).resolves.toEqual({
            available: false,
            provider: 'github',
            reason: 'non-github-origin',
        });
    });
});
