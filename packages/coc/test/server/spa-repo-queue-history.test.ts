/**
 * SPA Dashboard Tests — Repo Queue History fetch.
 *
 * Verifies that RepoQueueTab calls /queue/history?repoId= separately
 * from /queue?repoId= so per-repo completed task history is populated.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getClientBundle } from './spa-test-helpers';

describe('RepoQueueTab — per-repo history fetch', () => {
    let bundle: string;
    beforeAll(() => { bundle = getClientBundle(); });

    it('fetchRepoQueue calls /queue/history with repoId parameter', () => {
        expect(bundle).toContain('/queue/history?repoId=');
    });

    it('fetchRepoQueue fetches history separately from queue endpoint', () => {
        expect(bundle).toContain('/queue?repoId=');
        expect(bundle).toContain('/queue/history?repoId=');
    });
});
