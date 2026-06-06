/**
 * Tests for the Team coworker roster store.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    addPullRequestCoworkerToRoster,
    listPullRequestCoworkerRoster,
    pullRequestCoworkerRosterPaths,
    removePullRequestCoworkerFromRoster,
    validatePullRequestCoworkerRosterInput,
} from '../../src/server/repos/pr-coworker-roster-store';

let tmpDir: string;
let dataDir: string;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-coworker-roster-store-test-'));
    dataDir = path.join(tmpDir, 'data');
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('listPullRequestCoworkerRoster', () => {
    it('returns an empty roster when no file exists', () => {
        expect(listPullRequestCoworkerRoster(dataDir, 'ws-1', 'repo-1')).toEqual([]);
    });

    it('ignores corrupt or invalid entries', () => {
        const paths = pullRequestCoworkerRosterPaths(dataDir, 'ws-1', 'repo-1');
        fs.mkdirSync(paths.dir, { recursive: true });
        fs.writeFileSync(paths.filePath, JSON.stringify({
            entries: [
                { id: '1', displayName: 'Valid Dev', addedAt: '2026-06-05T00:00:00.000Z' },
                { id: '2', addedAt: '2026-06-05T00:00:00.000Z' },
            ],
        }), 'utf-8');

        expect(listPullRequestCoworkerRoster(dataDir, 'ws-1', 'repo-1')).toEqual([
            { id: '1', displayName: 'Valid Dev', addedAt: '2026-06-05T00:00:00.000Z' },
        ]);
    });
});

describe('addPullRequestCoworkerToRoster', () => {
    it('persists coworkers under the repo-scoped data layout', () => {
        const entries = addPullRequestCoworkerToRoster(dataDir, 'ws-1', 'repo/one', {
            id: '123',
            displayName: 'Mona Dev',
            email: 'mona@example.invalid',
            avatarUrl: 'https://avatars.example.invalid/u/123',
        }, { addedAt: '2026-06-05T00:00:00.000Z' });

        expect(entries).toEqual([
            {
                id: '123',
                displayName: 'Mona Dev',
                email: 'mona@example.invalid',
                avatarUrl: 'https://avatars.example.invalid/u/123',
                addedAt: '2026-06-05T00:00:00.000Z',
            },
        ]);
        const paths = pullRequestCoworkerRosterPaths(dataDir, 'ws-1', 'repo/one');
        expect(paths.filePath.endsWith(path.join('pr-coworker-roster', 'repo_one.json'))).toBe(true);
        expect(JSON.parse(fs.readFileSync(paths.filePath, 'utf-8'))).toEqual({ entries });
        expect(fs.readdirSync(dataDir)).toEqual(['repos']);
    });

    it('dedupes by provider id and preserves the original addedAt', () => {
        addPullRequestCoworkerToRoster(dataDir, 'ws-1', 'repo-1', {
            id: 'ABC',
            displayName: 'Old Name',
        }, { addedAt: '2026-06-05T00:00:00.000Z' });

        const entries = addPullRequestCoworkerToRoster(dataDir, 'ws-1', 'repo-1', {
            id: 'abc',
            displayName: 'New Name',
            email: 'new@example.invalid',
        }, { addedAt: '2026-06-06T00:00:00.000Z' });

        expect(entries).toEqual([
            {
                id: 'abc',
                displayName: 'New Name',
                email: 'new@example.invalid',
                addedAt: '2026-06-05T00:00:00.000Z',
            },
        ]);
    });

    it('dedupes displayName-keyed entries when id is empty', () => {
        addPullRequestCoworkerToRoster(dataDir, 'ws-1', 'repo-1', {
            id: '',
            displayName: 'Pat Dev',
        }, { addedAt: '2026-06-05T00:00:00.000Z' });

        const entries = addPullRequestCoworkerToRoster(dataDir, 'ws-1', 'repo-1', {
            id: '',
            displayName: 'pat dev',
            avatarUrl: 'https://avatars.example.invalid/pat',
        }, { addedAt: '2026-06-06T00:00:00.000Z' });

        expect(entries).toEqual([
            {
                id: '',
                displayName: 'pat dev',
                avatarUrl: 'https://avatars.example.invalid/pat',
                addedAt: '2026-06-05T00:00:00.000Z',
            },
        ]);
    });

    it('keeps workspace and repo rosters isolated', () => {
        addPullRequestCoworkerToRoster(dataDir, 'ws-a', 'repo-1', { id: '1', displayName: 'Workspace A' });
        addPullRequestCoworkerToRoster(dataDir, 'ws-b', 'repo-1', { id: '1', displayName: 'Workspace B' });
        addPullRequestCoworkerToRoster(dataDir, 'ws-a', 'repo-2', { id: '1', displayName: 'Repo 2' });

        expect(listPullRequestCoworkerRoster(dataDir, 'ws-a', 'repo-1')).toMatchObject([{ displayName: 'Workspace A' }]);
        expect(listPullRequestCoworkerRoster(dataDir, 'ws-b', 'repo-1')).toMatchObject([{ displayName: 'Workspace B' }]);
        expect(listPullRequestCoworkerRoster(dataDir, 'ws-a', 'repo-2')).toMatchObject([{ displayName: 'Repo 2' }]);
    });
});

describe('removePullRequestCoworkerFromRoster', () => {
    it('removes coworkers by provider id or displayName fallback key', () => {
        addPullRequestCoworkerToRoster(dataDir, 'ws-1', 'repo-1', { id: '123', displayName: 'Mona Dev' });
        addPullRequestCoworkerToRoster(dataDir, 'ws-1', 'repo-1', { id: '', displayName: 'Pat Dev' });

        expect(removePullRequestCoworkerFromRoster(dataDir, 'ws-1', 'repo-1', '123')).toMatchObject([
            { displayName: 'Pat Dev' },
        ]);
        expect(removePullRequestCoworkerFromRoster(dataDir, 'ws-1', 'repo-1', 'pat dev')).toEqual([]);
    });
});

describe('validatePullRequestCoworkerRosterInput', () => {
    it('trims identity fields and strips avatar URL query data', () => {
        expect(validatePullRequestCoworkerRosterInput({
            id: '  123  ',
            displayName: '  Mona Dev  ',
            email: '  mona@example.invalid  ',
            avatarUrl: 'https://avatars.example.invalid/u/123?token=drop#frag',
        })).toEqual({
            ok: true,
            entry: {
                id: '123',
                displayName: 'Mona Dev',
                email: 'mona@example.invalid',
                avatarUrl: 'https://avatars.example.invalid/u/123',
            },
        });
    });

    it('allows empty ids for displayName-keyed coworkers', () => {
        expect(validatePullRequestCoworkerRosterInput({
            id: '   ',
            displayName: 'Pat Dev',
        })).toEqual({
            ok: true,
            entry: {
                id: '',
                displayName: 'Pat Dev',
            },
        });
    });

    it('rejects invalid display names and avatar URLs', () => {
        expect(validatePullRequestCoworkerRosterInput({ id: '1', displayName: '   ' })).toEqual({
            ok: false,
            error: 'displayName must be a non-empty string',
        });
        expect(validatePullRequestCoworkerRosterInput({
            id: '1',
            displayName: 'Mona Dev',
            avatarUrl: 'https://user:token@avatars.example.invalid/u/123',
        })).toEqual({
            ok: false,
            error: 'avatarUrl must not contain credentials',
        });
    });
});
