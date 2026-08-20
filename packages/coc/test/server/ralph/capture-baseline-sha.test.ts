/**
 * Tests for captureRalphBaselineSha / gitHeadSha (AC-01).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import {
    captureRalphBaselineSha,
    gitHeadSha,
} from '../../../src/server/ralph/capture-baseline-sha';

let repoDir: string;
let nonGitDir: string;
let headSha: string;

function git(dir: string, ...args: string[]): string {
    return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf-8' }).replace(/\r?\n$/, '');
}

beforeAll(() => {
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-baseline-repo-'));
    nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-baseline-nongit-'));
    git(repoDir, 'init', '-q');
    git(repoDir, 'config', 'user.email', 'test@test.com');
    git(repoDir, 'config', 'user.name', 'Test');
    git(repoDir, 'config', 'commit.gpgsign', 'false');
    fs.writeFileSync(path.join(repoDir, 'a.txt'), 'hello\n', 'utf-8');
    git(repoDir, 'add', '-A');
    git(repoDir, 'commit', '-q', '-m', 'init');
    headSha = git(repoDir, 'rev-parse', 'HEAD');
});

afterAll(() => {
    for (const dir of [repoDir, nonGitDir]) {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
});

describe('gitHeadSha', () => {
    it('returns the repo HEAD SHA', async () => {
        await expect(gitHeadSha(repoDir)).resolves.toBe(headSha);
    });

    it('returns undefined for a non-git directory', async () => {
        await expect(gitHeadSha(nonGitDir)).resolves.toBeUndefined();
    });

    it('returns undefined for a missing directory', async () => {
        await expect(gitHeadSha(path.join(nonGitDir, 'does-not-exist'))).resolves.toBeUndefined();
    });
});

describe('captureRalphBaselineSha', () => {
    it('captures from an explicit workingDirectory', async () => {
        await expect(
            captureRalphBaselineSha({ workingDirectory: repoDir }),
        ).resolves.toBe(headSha);
    });

    it('falls back to the workspace rootPath from the store', async () => {
        const store = {
            getWorkspaces: async () => [{ id: 'ws-1', rootPath: repoDir }],
        } as any;

        await expect(
            captureRalphBaselineSha({ store, workspaceId: 'ws-1' }),
        ).resolves.toBe(headSha);
    });

    it('prefers the explicit workingDirectory over the store rootPath', async () => {
        const store = {
            getWorkspaces: async () => [{ id: 'ws-1', rootPath: nonGitDir }],
        } as any;

        await expect(
            captureRalphBaselineSha({ workingDirectory: repoDir, store, workspaceId: 'ws-1' }),
        ).resolves.toBe(headSha);
    });

    it('returns undefined when no directory can be resolved', async () => {
        await expect(captureRalphBaselineSha({})).resolves.toBeUndefined();
    });

    it('returns undefined when the workspace is not registered', async () => {
        const store = {
            getWorkspaces: async () => [{ id: 'other', rootPath: repoDir }],
        } as any;

        await expect(
            captureRalphBaselineSha({ store, workspaceId: 'ws-1' }),
        ).resolves.toBeUndefined();
    });

    it('returns undefined when the store throws', async () => {
        const store = {
            getWorkspaces: async () => { throw new Error('boom'); },
        } as any;

        await expect(
            captureRalphBaselineSha({ store, workspaceId: 'ws-1' }),
        ).resolves.toBeUndefined();
    });

    it('returns undefined for a non-git working directory', async () => {
        await expect(
            captureRalphBaselineSha({ workingDirectory: nonGitDir }),
        ).resolves.toBeUndefined();
    });
});
