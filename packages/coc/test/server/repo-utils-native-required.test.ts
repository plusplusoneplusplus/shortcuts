/** Forge load failures must reach callers so queue partitioning never silently collapses. */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, describe, expect, it, vi } from 'vitest';

const LOAD_ERROR = new Error(
    'coc-native.node loaded but does not export the git capability.\n' +
        'The binary predates the git capability, or a part of it — rebuild it with ' +
        '`npm run build:native -w packages/coc-native`.',
);

vi.mock('@plusplusoneplusplus/forge', async importOriginal => ({
    ...(await importOriginal<typeof import('@plusplusoneplusplus/forge')>()),
    discoverGitRepoRoot: async () => { throw LOAD_ERROR; },
}));

import { extractRepoId, findGitRoot } from '../../src/server/git/repo-utils';

const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coc-repo-utils-required-')));

afterAll(() => {
    fs.rmSync(repo, { recursive: true, force: true });
});

const REBUILD = 'npm run build:native -w packages/coc-native';

describe('git-root discovery without a usable addon', () => {
    it('rejects instead of reporting the path is not in a repository', async () => {
        await expect(findGitRoot(repo)).rejects.toThrow(REBUILD);
    });

    it('rejects for a path that really is outside a repository too', async () => {
        // The honest `null` and the load failure must not be the same answer.
        await expect(findGitRoot(path.join(repo, 'nope'))).rejects.toThrow(REBUILD);
    });

    it('rejects the repo id rather than leaving the task unpartitioned', async () => {
        await expect(extractRepoId({ workingDirectory: repo } as never)).rejects.toThrow(REBUILD);
    });
});
