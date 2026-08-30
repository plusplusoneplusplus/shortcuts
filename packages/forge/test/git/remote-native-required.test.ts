/**
 * The native addon is a hard dependency of the remote lookups.
 *
 * Both functions answer every git failure with an absence — `null` from
 * `getRemoteUrl`, `undefined` from `detectRemoteUrl` — and for a repository
 * with no remote that is the right answer. For a binary that is missing or too
 * old it is the wrong one, and a badly wrong one: "no remote" is what decides a
 * workspace's canonical origin id, so a swallowed load error would quietly
 * re-file every repository on the server as a local-only one.
 *
 * Hence the load happening outside the try/catch, and hence this suite.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, describe, expect, it, vi } from 'vitest';

const LOAD_ERROR = new Error(
    'coc-native.node loaded but does not export the git capability.\n' +
        'The binary predates the git capability, or a part of it — rebuild it with ' +
        '`npm run build:native -w packages/coc-native`.',
);

vi.mock('@plusplusoneplusplus/coc-native', () => ({
    loadNativeGit: () => {
        throw LOAD_ERROR;
    },
}));

import { detectRemoteUrl, getRemoteUrl } from '../../src/git/remote';

const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'forge-git-remote-required-')));

afterAll(() => {
    fs.rmSync(repo, { recursive: true, force: true });
});

const REBUILD = 'npm run build:native -w packages/coc-native';

describe('the remote lookups without a usable addon', () => {
    it('rejects the primary remote instead of reporting there is none', async () => {
        await expect(detectRemoteUrl(repo)).rejects.toThrow(REBUILD);
    });

    it('rejects a named remote instead of reporting it absent', async () => {
        await expect(getRemoteUrl(repo, 'origin')).rejects.toThrow(REBUILD);
    });
});
