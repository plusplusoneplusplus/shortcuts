/**
 * Tests for persisted Team roster pull-request eligibility.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { addPullRequestCoworkerToRoster } from '../../src/server/repos/pr-coworker-roster-store';
import {
    filterTeamEligiblePullRequests,
    listTeamEligiblePullRequests,
    type TeamEligiblePullRequest,
} from '../../src/server/repos/pr-team-eligibility';
import { getPrTeamIdentityKey } from '../../src/server/shared/pr-team-matching';

let tmpDir: string;
let dataDir: string;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-team-eligibility-test-'));
    dataDir = path.join(tmpDir, 'data');
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

function pr(overrides: Partial<TeamEligiblePullRequest> & { number?: number } = {}): TeamEligiblePullRequest & { number: number } {
    return {
        number: overrides.number ?? 1,
        status: 'open',
        author: { id: 'outside', displayName: 'Outside Author' },
        ...overrides,
    };
}

describe('filterTeamEligiblePullRequests', () => {
    it('matches open PRs by provider author id and skips non-open PRs', () => {
        const roster = [{ id: '12345', displayName: 'Original Name' }];
        const pullRequests = [
            pr({ number: 1, author: { id: 12345, displayName: 'Renamed User' } }),
            pr({ number: 2, status: 'closed', author: { id: '12345', displayName: 'Renamed User' } }),
            pr({ number: 3, author: { id: '99999', displayName: 'Original Name' } }),
        ];

        expect(filterTeamEligiblePullRequests(pullRequests, roster).map(item => item.number)).toEqual([1]);
    });

    it('falls back to display-name matching when either provider id is unavailable', () => {
        const roster = [{ id: '', displayName: 'Coworker One' }];
        const pullRequests = [
            pr({ number: 1, author: { displayName: '  coworker one  ' } }),
            pr({ number: 2, author: { displayName: 'Coworker Two' } }),
        ];

        expect(filterTeamEligiblePullRequests(pullRequests, roster).map(item => item.number)).toEqual([1]);
    });

    it('returns no eligible PRs for an empty roster', () => {
        expect(filterTeamEligiblePullRequests([
            pr({ number: 1, author: { id: '12345', displayName: 'Coworker One' } }),
        ], [])).toEqual([]);
    });
});

describe('listTeamEligiblePullRequests', () => {
    it('uses persisted roster membership and ignores transient inactive chip state', () => {
        addPullRequestCoworkerToRoster(dataDir, 'ws-1', 'repo-1', {
            id: 'coworker-1',
            displayName: 'Coworker One',
        });
        const inactiveChipKeys = new Set([
            getPrTeamIdentityKey({ id: 'coworker-1', displayName: 'Coworker One' }),
        ]);

        expect(inactiveChipKeys.has('coworker-1')).toBe(true);
        expect(listTeamEligiblePullRequests(dataDir, 'ws-1', 'repo-1', [
            pr({ number: 1, author: { id: 'coworker-1', displayName: 'Coworker One' } }),
        ]).pullRequests.map(item => item.number)).toEqual([1]);
    });

    it('keeps workspace and repo roster eligibility isolated', () => {
        addPullRequestCoworkerToRoster(dataDir, 'ws-a', 'repo-1', {
            id: 'team-a-repo-1',
            displayName: 'Workspace A Repo 1',
        });
        addPullRequestCoworkerToRoster(dataDir, 'ws-b', 'repo-1', {
            id: 'team-b-repo-1',
            displayName: 'Workspace B Repo 1',
        });
        addPullRequestCoworkerToRoster(dataDir, 'ws-a', 'repo-2', {
            id: 'team-a-repo-2',
            displayName: 'Workspace A Repo 2',
        });

        const pullRequests = [
            pr({ number: 1, author: { id: 'team-a-repo-1', displayName: 'Workspace A Repo 1' } }),
            pr({ number: 2, author: { id: 'team-b-repo-1', displayName: 'Workspace B Repo 1' } }),
            pr({ number: 3, author: { id: 'team-a-repo-2', displayName: 'Workspace A Repo 2' } }),
        ];

        expect(listTeamEligiblePullRequests(dataDir, 'ws-a', 'repo-1', pullRequests).pullRequests.map(item => item.number)).toEqual([1]);
        expect(listTeamEligiblePullRequests(dataDir, 'ws-b', 'repo-1', pullRequests).pullRequests.map(item => item.number)).toEqual([2]);
        expect(listTeamEligiblePullRequests(dataDir, 'ws-a', 'repo-2', pullRequests).pullRequests.map(item => item.number)).toEqual([3]);
    });
});
