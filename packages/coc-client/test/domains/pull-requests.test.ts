import { describe, expect, it } from 'vitest';
import { PullRequestsClient } from '../../src';
import { createMockAdapter } from './helpers';

describe('PullRequestsClient', () => {
  it('calls provider config endpoints with exact method, path, and body shapes', async () => {
    const adapter = createMockAdapter({ providers: {} });
    const client = new PullRequestsClient(adapter);

    await client.getProviderConfig();
    await client.saveProviderConfig({ github: { token: 'ghp_token' } });
    await client.saveProviderConfig({ ado: { orgUrl: 'https://dev.azure.com/org', token: 'ado-token' } });
    await client.saveProviderConfig({ tavily: { apiKey: 'tvly-key' } });

    expect(adapter.calls).toEqual([
      {
        path: '/providers/config',
        options: undefined,
      },
      {
        path: '/providers/config',
        options: {
          method: 'PUT',
          body: { github: { token: 'ghp_token' } },
        },
      },
      {
        path: '/providers/config',
        options: {
          method: 'PUT',
          body: { ado: { orgUrl: 'https://dev.azure.com/org', token: 'ado-token' } },
        },
      },
      {
        path: '/providers/config',
        options: {
          method: 'PUT',
          body: { tavily: { apiKey: 'tvly-key' } },
        },
      },
    ]);
  });

  it('lists and gets provider PR data through origin APIs with explicit workspace metadata', async () => {
    const adapter = createMockAdapter({});
    const client = new PullRequestsClient(adapter);
    const controller = new AbortController();

    await client.listForOrigin('gh_owner_repo', {
      workspaceId: 'ws/a',
      repoId: 'repo/a',
      status: 'open',
      scope: 'all',
      top: 10,
      skip: 5,
      force: true,
      author: 'me',
      search: 'fix',
    }, { signal: controller.signal });
    await client.getForOrigin('gh_owner_repo', 'pr/1', {
      workspaceId: 'ws/a',
      repoId: 'repo/a',
      force: true,
      signal: controller.signal,
    });

    expect(adapter.calls).toEqual([
      {
        path: '/origins/gh_owner_repo/pull-requests',
        options: {
          query: {
            workspaceId: 'ws/a',
            repoId: 'repo/a',
            status: 'open',
            scope: 'all',
            top: 10,
            skip: 5,
            force: 'true',
            author: 'me',
            search: 'fix',
          },
          signal: controller.signal,
        },
      },
      {
        path: '/origins/gh_owner_repo/pull-requests/pr%2F1',
        options: {
          query: {
            workspaceId: 'ws/a',
            repoId: 'repo/a',
            force: 'true',
          },
          signal: controller.signal,
        },
      },
    ]);
  });

  it('loads provider PR subresources through origin APIs with explicit workspace metadata', async () => {
    const adapter = createMockAdapter({});
    const client = new PullRequestsClient(adapter);
    const controller = new AbortController();
    const options = {
      workspaceId: 'ws/a',
      repoId: 'repo/a',
      signal: controller.signal,
    };

    await client.getThreadsForOrigin('gh_owner_repo', 'pr/1', options);
    await client.getReviewersForOrigin('gh_owner_repo', 'pr/1', options);
    await client.getCommitsForOrigin('gh_owner_repo', 'pr/1', options);
    await client.getDiffForOrigin('gh_owner_repo', 'pr/1', options);
    await client.getChecksForOrigin('gh_owner_repo', 'pr/1', options);

    expect(adapter.calls).toEqual([
      {
        path: '/origins/gh_owner_repo/pull-requests/pr%2F1/threads',
        options: { query: { workspaceId: 'ws/a', repoId: 'repo/a' }, signal: controller.signal },
      },
      {
        path: '/origins/gh_owner_repo/pull-requests/pr%2F1/reviewers',
        options: { query: { workspaceId: 'ws/a', repoId: 'repo/a' }, signal: controller.signal },
      },
      {
        path: '/origins/gh_owner_repo/pull-requests/pr%2F1/commits',
        options: { query: { workspaceId: 'ws/a', repoId: 'repo/a' }, signal: controller.signal },
      },
      {
        path: '/origins/gh_owner_repo/pull-requests/pr%2F1/diff',
        options: { query: { workspaceId: 'ws/a', repoId: 'repo/a' }, signal: controller.signal },
      },
      {
        path: '/origins/gh_owner_repo/pull-requests/pr%2F1/checks',
        options: { query: { workspaceId: 'ws/a', repoId: 'repo/a' }, signal: controller.signal },
      },
    ]);
  });

  it('lists, records, and removes recently opened PRs with origin scope', async () => {
    const adapter = createMockAdapter({ entries: [] });
    const client = new PullRequestsClient(adapter);
    const controller = new AbortController();

    await client.listRecentOpenedForOrigin('gh_owner_repo', {
      workspaceId: 'ws/a',
      repoId: 'repo/a',
      signal: controller.signal,
    });
    await client.recordRecentOpenedForOrigin('gh_owner_repo', {
      number: 42,
      title: 'Add recent list',
      webUrl: 'https://github.com/org/repo/pull/42',
    }, {
      workspaceId: 'ws/a',
      repoId: 'repo/a',
      signal: controller.signal,
    });
    await client.removeRecentOpenedForOrigin('gh_owner_repo', 42, {
      workspaceId: 'ws/a',
      repoId: 'repo/a',
      signal: controller.signal,
    });

    expect(adapter.calls).toEqual([
      {
        path: '/origins/gh_owner_repo/pull-requests/recent-opened',
        options: { query: { workspaceId: 'ws/a', repoId: 'repo/a' }, signal: controller.signal },
      },
      {
        path: '/origins/gh_owner_repo/pull-requests/recent-opened',
        options: {
          method: 'POST',
          body: {
            workspaceId: 'ws/a',
            repoId: 'repo/a',
            number: 42,
            title: 'Add recent list',
            webUrl: 'https://github.com/org/repo/pull/42',
          },
          signal: controller.signal,
        },
      },
      {
        path: '/origins/gh_owner_repo/pull-requests/recent-opened/42',
        options: { method: 'DELETE', query: { workspaceId: 'ws/a', repoId: 'repo/a' }, signal: controller.signal },
      },
    ]);
  });

  it('lists, adds, and removes Team coworker roster entries with origin scope', async () => {
    const adapter = createMockAdapter({ entries: [] });
    const client = new PullRequestsClient(adapter);
    const controller = new AbortController();

    await client.listCoworkerRosterForOrigin('gh_owner_repo', {
      workspaceId: 'ws/a',
      repoId: 'repo/a',
      signal: controller.signal,
    });
    await client.addCoworkerToRosterForOrigin('gh_owner_repo', {
      id: '123',
      displayName: 'Mona Dev',
      email: 'mona@example.invalid',
      avatarUrl: 'https://avatars.example.invalid/u/123',
    }, {
      workspaceId: 'ws/a',
      repoId: 'repo/a',
      signal: controller.signal,
    });
    await client.removeCoworkerFromRosterForOrigin('gh_owner_repo', 'Pat Dev', {
      workspaceId: 'ws/a',
      repoId: 'repo/a',
      signal: controller.signal,
    });

    expect(adapter.calls).toEqual([
      {
        path: '/origins/gh_owner_repo/pull-requests/coworker-roster',
        options: { query: { workspaceId: 'ws/a', repoId: 'repo/a' }, signal: controller.signal },
      },
      {
        path: '/origins/gh_owner_repo/pull-requests/coworker-roster',
        options: {
          method: 'POST',
          body: {
            workspaceId: 'ws/a',
            repoId: 'repo/a',
            id: '123',
            displayName: 'Mona Dev',
            email: 'mona@example.invalid',
            avatarUrl: 'https://avatars.example.invalid/u/123',
          },
          signal: controller.signal,
        },
      },
      {
        path: '/origins/gh_owner_repo/pull-requests/coworker-roster/Pat%20Dev',
        options: { method: 'DELETE', query: { workspaceId: 'ws/a', repoId: 'repo/a' }, signal: controller.signal },
      },
    ]);
  });

  it('encodes displayName fallback keys when removing Team roster entries by origin', async () => {
    const adapter = createMockAdapter({ entries: [] });
    const client = new PullRequestsClient(adapter);

    await client.removeCoworkerFromRosterForOrigin('gh_owner_repo', 'Pat Dev', {
      workspaceId: 'ws/a',
      repoId: 'repo/a',
    });

    expect(adapter.calls).toEqual([
      {
        path: '/origins/gh_owner_repo/pull-requests/coworker-roster/Pat%20Dev',
        options: { method: 'DELETE', query: { workspaceId: 'ws/a', repoId: 'repo/a' }, signal: undefined },
      },
    ]);
  });

  it('omits force query param when not true', async () => {
    const adapter = createMockAdapter({});
    const client = new PullRequestsClient(adapter);

    await client.listForOrigin('gh_owner_repo', { workspaceId: 'ws/a', repoId: 'repo/a', status: 'closed' });
    await client.listForOrigin('gh_owner_repo', { workspaceId: 'ws/a' });

    expect(adapter.calls[0].options).toMatchObject({ query: { workspaceId: 'ws/a', repoId: 'repo/a', status: 'closed' } });
    expect(adapter.calls[0].options?.query?.force).toBeUndefined();
    expect(adapter.calls[1].options).toMatchObject({ query: { workspaceId: 'ws/a', repoId: undefined } });
  });

  it('forwards abort signal to all data methods', async () => {
    const adapter = createMockAdapter({});
    const client = new PullRequestsClient(adapter);
    const controller = new AbortController();

    const options = { workspaceId: 'ws1', repoId: 'r1', signal: controller.signal };

    await client.listForOrigin('gh_owner_repo', { workspaceId: 'ws1', repoId: 'r1', status: 'open' }, { signal: controller.signal });
    await client.getForOrigin('gh_owner_repo', '10', options);
    await client.getThreadsForOrigin('gh_owner_repo', '10', options);
    await client.getReviewersForOrigin('gh_owner_repo', '10', options);
    await client.getCommitsForOrigin('gh_owner_repo', '10', options);
    await client.getDiffForOrigin('gh_owner_repo', '10', options);
    await client.getChecksForOrigin('gh_owner_repo', '10', options);

    for (const call of adapter.calls) {
      expect(call.options?.signal).toBe(controller.signal);
    }
  });

  it('does not pass signal when options are omitted', async () => {
    const adapter = createMockAdapter({});
    const client = new PullRequestsClient(adapter);

    const options = { workspaceId: 'ws1', repoId: 'r1' };

    await client.listForOrigin('gh_owner_repo', { workspaceId: 'ws1', repoId: 'r1' });
    await client.getForOrigin('gh_owner_repo', '1', options);
    await client.getThreadsForOrigin('gh_owner_repo', '1', options);
    await client.getReviewersForOrigin('gh_owner_repo', '1', options);
    await client.getCommitsForOrigin('gh_owner_repo', '1', options);
    await client.getDiffForOrigin('gh_owner_repo', '1', options);
    await client.getChecksForOrigin('gh_owner_repo', '1', options);

    for (const call of adapter.calls) {
      expect(call.options?.signal).toBeUndefined();
    }
  });

  it('exposes origin-scoped CRUD methods for pull-request chat bindings', async () => {
    const adapter = createMockAdapter({ bindings: {} });
    const client = new PullRequestsClient(adapter);

    await client.listChatBindingsForOrigin('gh_owner_repo');
    await client.getChatBindingForOrigin('gh_owner_repo', '142');
    await client.createChatBindingForOrigin('gh_owner_repo', '142', 'task-1');
    await client.deleteChatBindingForOrigin('gh_owner_repo', '142');
    await client.startFreshChatForOrigin('gh_owner_repo', '142', 'ws/a');

    expect(adapter.calls).toEqual([
      { path: '/origins/gh_owner_repo/pull-request-chat-bindings', options: undefined },
      { path: '/origins/gh_owner_repo/pull-request-chat-bindings/142', options: undefined },
      {
        path: '/origins/gh_owner_repo/pull-request-chat-bindings',
        options: { method: 'POST', body: { prId: '142', taskId: 'task-1' } },
      },
      {
        path: '/origins/gh_owner_repo/pull-request-chat-bindings/142',
        options: { method: 'DELETE' },
      },
      {
        path: '/origins/gh_owner_repo/pull-request-chat-bindings/142/fresh',
        options: { method: 'POST', body: {}, query: { workspaceId: 'ws/a' } },
      },
    ]);
  });

  it('classifyForOrigin sends POST with origin metadata and encoded PR identifier', async () => {
    const adapter = createMockAdapter({ status: 'started', taskId: 'task-1' });
    const client = new PullRequestsClient(adapter);

    await client.classifyForOrigin('gh_owner_repo', 'pr/1', { headSha: 'abc123', model: 'haiku' }, {
      workspaceId: 'ws/a',
      repoId: 'repo/a',
    });

    expect(adapter.calls).toEqual([
      {
        path: '/origins/gh_owner_repo/classify-diff',
        options: {
          method: 'POST',
          body: {
            workspaceId: 'ws/a',
            repoId: 'repo/a',
            type: 'pr',
            identifier: 'pr/1:abc123',
            model: 'haiku',
          },
          signal: undefined,
        },
      },
    ]);
  });

  it('classifyForOrigin forwards abort signal', async () => {
    const adapter = createMockAdapter({ status: 'started' });
    const client = new PullRequestsClient(adapter);
    const controller = new AbortController();

    await client.classifyForOrigin('gh_owner_repo', '10', { headSha: 'sha1' }, {
      workspaceId: 'ws1',
      signal: controller.signal,
    });

    expect(adapter.calls[0].options?.signal).toBe(controller.signal);
  });

  it('getClassificationForOrigin sends GET with origin metadata and PR identifier', async () => {
    const adapter = createMockAdapter({ status: 'none' });
    const client = new PullRequestsClient(adapter);

    await client.getClassificationForOrigin('gh_owner_repo', 'pr/1', 'abc123', {
      workspaceId: 'ws/a',
      repoId: 'repo/a',
    });

    expect(adapter.calls).toEqual([
      {
        path: '/origins/gh_owner_repo/classify-diff',
        options: {
          query: {
            type: 'pr',
            identifier: 'pr/1:abc123',
            workspaceId: 'ws/a',
            repoId: 'repo/a',
          },
          signal: undefined,
        },
      },
    ]);
  });

  it('getClassificationForOrigin forwards abort signal', async () => {
    const adapter = createMockAdapter({ status: 'ready' });
    const client = new PullRequestsClient(adapter);
    const controller = new AbortController();

    await client.getClassificationForOrigin('gh_owner_repo', '10', 'sha1', {
      workspaceId: 'ws1',
      signal: controller.signal,
    });

    expect(adapter.calls[0].options?.signal).toBe(controller.signal);
  });

  it('getClassificationBatchStatus sends encoded commit batch-status query params', async () => {
    const adapter = createMockAdapter({ statuses: {} });
    const client = new PullRequestsClient(adapter);
    const controller = new AbortController();

    await client.getClassificationBatchStatus('repo/a', {
      type: 'commit',
      identifiers: ['abc', 'def'],
      workspaceId: 'ws/a',
      repoId: 'repo/a',
    }, { signal: controller.signal });

    expect(adapter.calls).toEqual([
      {
        path: '/repos/repo%2Fa/classify-diff/batch-status',
        options: {
          query: {
            type: 'commit',
            identifiers: 'abc,def',
            workspaceId: 'ws/a',
            repoId: 'repo/a',
          },
          signal: controller.signal,
        },
      },
    ]);
  });

  it('getClassificationBatchStatusForOrigin sends encoded origin batch-status query params', async () => {
    const adapter = createMockAdapter({ statuses: {} });
    const client = new PullRequestsClient(adapter);
    const controller = new AbortController();

    await client.getClassificationBatchStatusForOrigin('gh_owner_repo', {
      type: 'pr',
      identifiers: ['1:abc', '2:def'],
      workspaceId: 'ws/a',
      repoId: 'repo/a',
    }, { signal: controller.signal });

    expect(adapter.calls).toEqual([
      {
        path: '/origins/gh_owner_repo/classify-diff/batch-status',
        options: {
          query: {
            type: 'pr',
            identifiers: '1:abc,2:def',
            workspaceId: 'ws/a',
            repoId: 'repo/a',
          },
          signal: controller.signal,
        },
      },
    ]);
  });

  it('autoClassifyTeamForOrigin sends POST with origin metadata and loaded PR payload', async () => {
    const adapter = createMockAdapter({ started: 1 });
    const client = new PullRequestsClient(adapter);

    await client.autoClassifyTeamForOrigin('gh_owner_repo', {
      pullRequests: [
        { number: 42, status: 'open', headSha: 'abc123', author: { id: 'u1', displayName: 'Mona Dev' } },
      ],
    }, {
      workspaceId: 'ws/a',
      repoId: 'repo/a',
    });

    expect(adapter.calls).toEqual([
      {
        path: '/origins/gh_owner_repo/pull-requests/team-auto-classification',
        options: {
          method: 'POST',
          body: {
            workspaceId: 'ws/a',
            repoId: 'repo/a',
            pullRequests: [
              { number: 42, status: 'open', headSha: 'abc123', author: { id: 'u1', displayName: 'Mona Dev' } },
            ],
          },
          signal: undefined,
        },
      },
    ]);
  });

  it('gets and saves review progress through origin routes', async () => {
    const adapter = createMockAdapter({ reviewedFiles: [], visitedFiles: [] });
    const client = new PullRequestsClient(adapter);
    const controller = new AbortController();

    await client.getReviewProgressForOrigin('gh_owner_repo', 'pr/1', 'abc123', {
      workspaceId: 'ws/a',
      repoId: 'repo/a',
      signal: controller.signal,
    });
    await client.saveReviewProgressForOrigin('gh_owner_repo', 'pr/1', {
      headSha: 'abc123',
      reviewedFiles: ['src/a.ts'],
      visitedFiles: ['src/a.ts', 'src/b.ts'],
      lastSelectedFile: 'src/b.ts',
    }, {
      workspaceId: 'ws/a',
      repoId: 'repo/a',
      signal: controller.signal,
    });

    expect(adapter.calls).toEqual([
      {
        path: '/origins/gh_owner_repo/pull-requests/pr%2F1/review-progress',
        options: {
          query: {
            workspaceId: 'ws/a',
            repoId: 'repo/a',
            headSha: 'abc123',
          },
          signal: controller.signal,
        },
      },
      {
        path: '/origins/gh_owner_repo/pull-requests/pr%2F1/review-progress',
        options: {
          method: 'PUT',
          body: {
            workspaceId: 'ws/a',
            repoId: 'repo/a',
            headSha: 'abc123',
            reviewedFiles: ['src/a.ts'],
            visitedFiles: ['src/a.ts', 'src/b.ts'],
            lastSelectedFile: 'src/b.ts',
          },
          signal: controller.signal,
        },
      },
    ]);
  });

  it('prFileDiffPath returns encoded per-file diff path', () => {
    const adapter = createMockAdapter({});
    const client = new PullRequestsClient(adapter);

    expect(client.prDiffPathForOrigin('gh_owner_repo', 'pr/1', {
      workspaceId: 'ws/a',
      repoId: 'repo/a',
    })).toBe(
      '/api/origins/gh_owner_repo/pull-requests/pr%2F1/diff?workspaceId=ws%2Fa&repoId=repo%2Fa',
    );
    expect(client.prFileDiffPathForOrigin('gh_owner_repo', 'pr/1', 'src/foo.ts', {
      workspaceId: 'ws/a',
      repoId: 'repo/a',
      fullContext: true,
    })).toBe(
      '/api/origins/gh_owner_repo/pull-requests/pr%2F1/diff/files/src%2Ffoo.ts?workspaceId=ws%2Fa&repoId=repo%2Fa&fullContext=true',
    );
  });

  // ── PR suggestions ──────────────────────────────────────────

  it('getSuggestionsForOrigin sends GET to origin suggestions endpoint', async () => {
    const adapter = createMockAdapter({ suggestions: [], rankedAt: null });
    const client = new PullRequestsClient(adapter);

    await client.getSuggestionsForOrigin('gh_owner_repo', {
      workspaceId: 'ws/a',
      repoId: 'repo/a',
    });

    expect(adapter.calls).toEqual([
      {
        path: '/origins/gh_owner_repo/pull-requests/suggestions',
        options: {
          query: {
            workspaceId: 'ws/a',
            repoId: 'repo/a',
          },
          signal: undefined,
        },
      },
    ]);
  });

  it('refreshSuggestionsForOrigin sends POST to origin suggestions/refresh endpoint', async () => {
    const adapter = createMockAdapter({ suggestions: [{ prNumber: 1, score: 90 }], rankedAt: '2026-01-01' });
    const client = new PullRequestsClient(adapter);

    await client.refreshSuggestionsForOrigin('gh_owner_repo', {
      workspaceId: 'ws/a',
      repoId: 'repo/a',
    });

    expect(adapter.calls).toEqual([
      {
        path: '/origins/gh_owner_repo/pull-requests/suggestions/refresh',
        options: {
          method: 'POST',
          query: {
            workspaceId: 'ws/a',
            repoId: 'repo/a',
          },
          signal: undefined,
        },
      },
    ]);
  });

  it('refreshReviewHistoryForOrigin sends POST to origin review-history/refresh endpoint', async () => {
    const adapter = createMockAdapter({ reviews: [], fetchedAt: '2026-01-01' });
    const client = new PullRequestsClient(adapter);

    await client.refreshReviewHistoryForOrigin('gh_owner_repo', {
      workspaceId: 'ws/a',
      repoId: 'repo/a',
    });

    expect(adapter.calls).toEqual([
      {
        path: '/origins/gh_owner_repo/pull-requests/review-history/refresh',
        options: {
          method: 'POST',
          query: {
            workspaceId: 'ws/a',
            repoId: 'repo/a',
          },
          signal: undefined,
        },
      },
    ]);
  });

  it('getSuggestionsForOrigin forwards abort signal', async () => {
    const adapter = createMockAdapter({ suggestions: [], rankedAt: null });
    const client = new PullRequestsClient(adapter);
    const controller = new AbortController();

    await client.getSuggestionsForOrigin('gh_owner_repo', { workspaceId: 'ws1', signal: controller.signal });

    expect(adapter.calls[0].options?.signal).toBe(controller.signal);
  });

  it('refreshSuggestionsForOrigin forwards abort signal', async () => {
    const adapter = createMockAdapter({ suggestions: [], rankedAt: null });
    const client = new PullRequestsClient(adapter);
    const controller = new AbortController();

    await client.refreshSuggestionsForOrigin('gh_owner_repo', { workspaceId: 'ws1', signal: controller.signal });

    expect(adapter.calls[0].options?.signal).toBe(controller.signal);
  });

  it('refreshReviewHistoryForOrigin forwards abort signal', async () => {
    const adapter = createMockAdapter({ reviews: [], fetchedAt: null });
    const client = new PullRequestsClient(adapter);
    const controller = new AbortController();

    await client.refreshReviewHistoryForOrigin('gh_owner_repo', { workspaceId: 'ws1', signal: controller.signal });

    expect(adapter.calls[0].options?.signal).toBe(controller.signal);
  });
});
