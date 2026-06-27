/**
 * @vitest-environment jsdom
 *
 * Integration tests for ChatPrStatusCard + usePrChatStatusItems — the runtime
 * wiring that closes AC-01 (detect + persist + union) and AC-02 (card visible
 * with deep-link) at runtime.
 *
 * Covers:
 *   - AC-01 DoD #1 / AC-02 DoD #1: a PR detected in a `gh pr create` turn is
 *     unioned, its detail fetched, the row rendered, and a binding upserted.
 *   - AC-01 DoD #2: with no turns, a persisted binding alone surfaces the PR
 *     (reload with the creating turn collapsed) and is NOT re-posted.
 *   - AC-02 error state: a failed detail fetch shows an inline error + retry,
 *     and retry recovers.
 *   - empty: no detected PRs and no bindings → the card stays hidden.
 *   - mapPrDetailToCardPr pure-mapper edge cases.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor, act, within } from '@testing-library/react';
import React from 'react';
import type { ClientConversationTurn } from '../../../src/server/spa/client/react/types/dashboard';
import { PR_STATUS_POLL_INTERVAL_MS } from '../../../src/server/spa/client/react/features/chat/conversation/prStatusFreshness';

const mocks = vi.hoisted(() => ({
    pullRequests: {
        listChatBindingsForOrigin: vi.fn(),
        createChatBindingForOrigin: vi.fn(),
        getForOrigin: vi.fn(),
        getReviewersForOrigin: vi.fn(),
        getChecksForOrigin: vi.fn(),
    },
    getCocClientForWorkspace: vi.fn(),
}));

vi.mock('../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({ pullRequests: mocks.pullRequests }),
    getSpaCocClientErrorMessage: (err: unknown, fallback: string) =>
        (err instanceof Error && err.message) || fallback,
}));

// The hook routes every workspace-scoped REST call through getCocClientForWorkspace
// so a remote-owned chat resolves the PR against the server that owns it. The
// default maps any workspace to the shared local client; the remote-routing test
// below overrides it to assert a remote workspace never hits the local client.
vi.mock('../../../src/server/spa/client/react/repos/cloneRegistry', () => ({
    getCocClientForWorkspace: mocks.getCocClientForWorkspace,
}));

import { ChatPrStatusCard } from '../../../src/server/spa/client/react/features/chat/conversation/ChatPrStatusCard';
import { mapPrDetailToCardPr, parseAutoMerge } from '../../../src/server/spa/client/react/features/chat/conversation/usePrChatStatusItems';

const GH_URL = 'https://github.com/owner/repo/pull/42';
const GH_REMOTE = 'https://github.com/owner/repo';
const GH_ORIGIN = 'gh_owner_repo';

function turnWithPrCreate(url: string, id = 'tc1'): ClientConversationTurn {
    return {
        role: 'assistant',
        content: '',
        timeline: [
            {
                type: 'tool-complete',
                timestamp: '2024-01-01T00:00:00Z',
                toolCall: {
                    id,
                    toolName: 'bash',
                    args: { command: 'gh pr create --fill' },
                    result: `Creating pull request...\n${url}\n`,
                    status: 'completed',
                },
            },
        ],
    };
}

describe('ChatPrStatusCard / usePrChatStatusItems', () => {
    beforeEach(() => {
        mocks.pullRequests.listChatBindingsForOrigin.mockReset();
        mocks.pullRequests.createChatBindingForOrigin.mockReset();
        mocks.pullRequests.getForOrigin.mockReset();
        mocks.pullRequests.getReviewersForOrigin.mockReset();
        mocks.pullRequests.getChecksForOrigin.mockReset();
        mocks.pullRequests.createChatBindingForOrigin.mockResolvedValue({ prId: '42', taskId: 't1' });
        // Eager reviewers fetch fires on detail-ready, so every test needs a default.
        mocks.pullRequests.getReviewersForOrigin.mockResolvedValue({ reviewers: [] });
        // Eager checks fetch fires on detail-ready, so every test needs a default.
        mocks.pullRequests.getChecksForOrigin.mockResolvedValue({ checks: [] });
        // Default: every workspace resolves to the shared local client.
        mocks.getCocClientForWorkspace.mockReset();
        mocks.getCocClientForWorkspace.mockReturnValue({ pullRequests: mocks.pullRequests });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('AC-01/AC-02: detected PR is unioned, fetched, rendered, and persisted', async () => {
        mocks.pullRequests.listChatBindingsForOrigin.mockResolvedValue({ bindings: {} });
        mocks.pullRequests.getForOrigin.mockResolvedValue({
            number: 42,
            title: 'Add PR status card',
            status: 'open',
            sourceBranch: 'feature/card',
            targetBranch: 'main',
            createdAt: '2024-01-01T00:00:00Z',
            url: GH_URL,
        });

        const { findByText, findByTestId, getByTestId } = render(
            <ChatPrStatusCard turns={[turnWithPrCreate(GH_URL)]} workspaceId="ws1" remoteUrl={GH_REMOTE} taskId="t1" />,
        );

        const toggle = await findByTestId('pr-status-card-toggle');
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(toggle.textContent).toContain('1 pull request');
        fireEvent.click(toggle);

        // Row renders with the fetched title + branches (AC-02 DoD #1).
        await findByText('Add PR status card');
        expect(getByTestId('pr-status-card')).toBeTruthy();
        expect(getByTestId(`pr-status-card-branches-${GH_ORIGIN}:42`).textContent).toContain('feature/card → main');

        // Detail fetched against the detected PR's canonical origin.
        expect(mocks.pullRequests.getForOrigin).toHaveBeenCalledWith(GH_ORIGIN, '42', { workspaceId: 'ws1' });

        // Deep-link points at the PR detail view for this repo.
        const link = getByTestId(`pr-status-card-open-${GH_ORIGIN}:42`) as HTMLAnchorElement;
        expect(link.getAttribute('href')).toBe('#repos/ws1/pull-requests/42/overview');

        // Fresh detection persists a binding so it survives a later reload (AC-01).
        await waitFor(() =>
            expect(mocks.pullRequests.createChatBindingForOrigin).toHaveBeenCalledWith(GH_ORIGIN, '42', 't1'),
        );
    });

    it('AC-03: eagerly fetches checks on load (inline summary), expanding shows the list deduped', async () => {
        mocks.pullRequests.listChatBindingsForOrigin.mockResolvedValue({ bindings: {} });
        mocks.pullRequests.getForOrigin.mockResolvedValue({
            number: 42,
            title: 'Add PR status card',
            status: 'open',
            sourceBranch: 'feature/card',
            targetBranch: 'main',
            createdAt: '2024-01-01T00:00:00Z',
            url: GH_URL,
        });
        mocks.pullRequests.getChecksForOrigin.mockResolvedValue({
            checks: [
                { id: 'c1', name: 'build', status: 'success', source: 'check', detailsUrl: 'https://ci/build' },
                { id: 'c2', name: 'unit', status: 'failure', source: 'check' },
                { id: 'c3', name: 'e2e', status: 'pending', source: 'check' },
            ],
        });

        const { findByText, findByTestId, getByTestId } = render(
            <ChatPrStatusCard turns={[turnWithPrCreate(GH_URL)]} workspaceId="ws1" remoteUrl={GH_REMOTE} taskId="t1" />,
        );

        fireEvent.click(await findByTestId('pr-status-card-toggle'));
        await findByText('Add PR status card');

        // Checks are fetched eagerly once the detail is ready — no toggle needed.
        await waitFor(() =>
            expect(mocks.pullRequests.getChecksForOrigin).toHaveBeenCalledWith(GH_ORIGIN, '42', { workspaceId: 'ws1' }),
        );

        // The inline summary chips render on the Checks line without expanding.
        const inlinePassing = await waitFor(() =>
            getByTestId(`pr-status-card-checks-inline-${GH_ORIGIN}:42-count-passing`),
        );
        expect(inlinePassing.getAttribute('data-count')).toBe('1');
        expect(getByTestId(`pr-status-card-checks-inline-${GH_ORIGIN}:42-count-failing`).getAttribute('data-count')).toBe('1');
        expect(getByTestId(`pr-status-card-checks-inline-${GH_ORIGIN}:42-count-pending`).getAttribute('data-count')).toBe('1');

        // Expanding reveals the full per-check list and does NOT refetch (deduped).
        fireEvent.click(getByTestId(`pr-status-card-checks-toggle-${GH_ORIGIN}:42`));
        const panel = getByTestId(`pr-status-card-checks-${GH_ORIGIN}:42`);
        expect(within(panel).getAllByTestId(`pr-checks-compact-${GH_ORIGIN}:42-row`)).toHaveLength(3);
        expect(mocks.pullRequests.getChecksForOrigin).toHaveBeenCalledTimes(1);

        // Collapsing then re-expanding still does not refetch.
        fireEvent.click(getByTestId(`pr-status-card-checks-toggle-${GH_ORIGIN}:42`));
        fireEvent.click(getByTestId(`pr-status-card-checks-toggle-${GH_ORIGIN}:42`));
        expect(mocks.pullRequests.getChecksForOrigin).toHaveBeenCalledTimes(1);
    });

    it('AC-01 DoD #2: a persisted binding alone surfaces the PR on reload (no re-post)', async () => {
        mocks.pullRequests.listChatBindingsForOrigin.mockResolvedValue({
            bindings: { '42': { taskId: 't1', createdAt: '2024-01-01T00:00:00Z' } },
        });
        mocks.pullRequests.getForOrigin.mockResolvedValue({
            number: 42,
            title: 'Persisted PR',
            status: 'merged',
            sourceBranch: 'feature/x',
            targetBranch: 'main',
            mergedAt: '2024-01-02T00:00:00Z',
            createdAt: '2024-01-01T00:00:00Z',
        });

        // No turns → nothing detected; the binding is the only source.
        const { findByText, findByTestId } = render(
            <ChatPrStatusCard turns={[]} workspaceId="ws1" remoteUrl={GH_REMOTE} taskId="t1" />,
        );

        fireEvent.click(await findByTestId('pr-status-card-toggle'));
        await findByText('Persisted PR');
        expect(mocks.pullRequests.getForOrigin).toHaveBeenCalledWith(GH_ORIGIN, '42', { workspaceId: 'ws1' });
        // Already bound → no upsert.
        expect(mocks.pullRequests.createChatBindingForOrigin).not.toHaveBeenCalled();
    });

    it('AC-02 error state: failed detail fetch shows error + retry, retry recovers', async () => {
        mocks.pullRequests.listChatBindingsForOrigin.mockResolvedValue({ bindings: {} });
        mocks.pullRequests.getForOrigin
            .mockRejectedValueOnce(new Error('network down'))
            .mockResolvedValueOnce({
                number: 42,
                title: 'Recovered PR',
                status: 'open',
                sourceBranch: 'feature/card',
                targetBranch: 'main',
                createdAt: '2024-01-01T00:00:00Z',
            });

        const { findByText, findByTestId, getByTestId } = render(
            <ChatPrStatusCard turns={[turnWithPrCreate(GH_URL)]} workspaceId="ws1" remoteUrl={GH_REMOTE} taskId="t1" />,
        );

        fireEvent.click(await findByTestId('pr-status-card-toggle'));
        const errorRow = await waitFor(() => getByTestId(`pr-status-card-error-${GH_ORIGIN}:42`));
        expect(errorRow.textContent).toContain('network down');

        fireEvent.click(getByTestId(`pr-status-card-retry-${GH_ORIGIN}:42`));
        await findByText('Recovered PR');
        expect(mocks.pullRequests.getForOrigin).toHaveBeenCalledTimes(2);
    });

    it('AC-05: manual refresh force-refreshes every row, bypassing the cache', async () => {
        mocks.pullRequests.listChatBindingsForOrigin.mockResolvedValue({ bindings: {} });
        mocks.pullRequests.getForOrigin.mockResolvedValue({
            number: 42,
            title: 'Add PR status card',
            status: 'open',
            sourceBranch: 'feature/card',
            targetBranch: 'main',
            createdAt: '2024-01-01T00:00:00Z',
            url: GH_URL,
        });

        const { findByText, findByTestId, getByTestId } = render(
            <ChatPrStatusCard turns={[turnWithPrCreate(GH_URL)]} workspaceId="ws1" remoteUrl={GH_REMOTE} taskId="t1" />,
        );

        fireEvent.click(await findByTestId('pr-status-card-toggle'));
        await findByText('Add PR status card');
        // Initial load is not forced.
        expect(mocks.pullRequests.getForOrigin).toHaveBeenCalledTimes(1);
        expect(mocks.pullRequests.getForOrigin).toHaveBeenLastCalledWith(GH_ORIGIN, '42', { workspaceId: 'ws1' });

        fireEvent.click(getByTestId('pr-status-card-refresh'));

        // Manual refresh re-fetches with force=true to bypass the server cache.
        await waitFor(() => expect(mocks.pullRequests.getForOrigin).toHaveBeenCalledTimes(2));
        expect(mocks.pullRequests.getForOrigin).toHaveBeenLastCalledWith(GH_ORIGIN, '42', { workspaceId: 'ws1', force: true });
        // The row content survives the refresh (no skeleton flash).
        expect(getByTestId(`pr-status-card-branches-${GH_ORIGIN}:42`).textContent).toContain('feature/card → main');
    });

    it('AC-05: a pending PR auto-polls then stops once it merges', async () => {
        vi.useFakeTimers();
        try {
            mocks.pullRequests.listChatBindingsForOrigin.mockResolvedValue({ bindings: {} });
            mocks.pullRequests.getForOrigin
                .mockResolvedValueOnce({
                    number: 42,
                    title: 'Pending PR',
                    status: 'open',
                    sourceBranch: 'feature/card',
                    targetBranch: 'main',
                    createdAt: '2024-01-01T00:00:00Z',
                    url: GH_URL,
                    // submit-commits-as-pr arms auto-merge → the poll predicate is active.
                    autoMerge: { enabled: true, state: 'armed', mergeMethod: 'squash' },
                })
                .mockResolvedValue({
                    number: 42,
                    title: 'Pending PR',
                    status: 'merged',
                    sourceBranch: 'feature/card',
                    targetBranch: 'main',
                    mergedAt: '2024-01-02T00:00:00Z',
                    createdAt: '2024-01-01T00:00:00Z',
                    url: GH_URL,
                    autoMerge: { enabled: true, state: 'armed', mergeMethod: 'squash' },
                });

            render(
                <ChatPrStatusCard turns={[turnWithPrCreate(GH_URL)]} workspaceId="ws1" remoteUrl={GH_REMOTE} taskId="t1" />,
            );

            // Flush the initial bindings + detail fetch.
            await act(async () => { await vi.advanceTimersByTimeAsync(0); });
            expect(mocks.pullRequests.getForOrigin).toHaveBeenCalledTimes(1);

            // One poll interval → a forced re-fetch, which now reports a merge.
            await act(async () => { await vi.advanceTimersByTimeAsync(PR_STATUS_POLL_INTERVAL_MS); });
            expect(mocks.pullRequests.getForOrigin).toHaveBeenCalledTimes(2);
            expect(mocks.pullRequests.getForOrigin).toHaveBeenLastCalledWith(GH_ORIGIN, '42', { workspaceId: 'ws1', force: true });

            // Now terminal → polling stops; further time advances do not re-fetch.
            await act(async () => { await vi.advanceTimersByTimeAsync(PR_STATUS_POLL_INTERVAL_MS * 3); });
            expect(mocks.pullRequests.getForOrigin).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it('AC-05: eager-loaded pending checks keep a never-expanded PR polling', async () => {
        vi.useFakeTimers();
        try {
            mocks.pullRequests.listChatBindingsForOrigin.mockResolvedValue({ bindings: {} });
            mocks.pullRequests.getForOrigin.mockResolvedValue({
                number: 42,
                title: 'Pending checks PR',
                status: 'open',
                sourceBranch: 'feature/card',
                targetBranch: 'main',
                createdAt: '2024-01-01T00:00:00Z',
                url: GH_URL,
                // No auto-merge — only the eager-loaded pending check keeps it active.
            });
            mocks.pullRequests.getChecksForOrigin.mockResolvedValue({
                checks: [{ id: 'c1', name: 'e2e', status: 'pending', source: 'check' }],
            });

            render(
                <ChatPrStatusCard turns={[turnWithPrCreate(GH_URL)]} workspaceId="ws1" remoteUrl={GH_REMOTE} taskId="t1" />,
            );

            // Flush the initial bindings + detail + eager-checks fetches.
            await act(async () => { await vi.advanceTimersByTimeAsync(0); });
            expect(mocks.pullRequests.getForOrigin).toHaveBeenCalledTimes(1);
            // Checks were loaded eagerly even though the row was never expanded.
            expect(mocks.pullRequests.getChecksForOrigin).toHaveBeenCalledWith(GH_ORIGIN, '42', { workspaceId: 'ws1' });

            // The pending check keeps the smart poll active → a forced re-fetch.
            await act(async () => { await vi.advanceTimersByTimeAsync(PR_STATUS_POLL_INTERVAL_MS); });
            expect(mocks.pullRequests.getForOrigin).toHaveBeenCalledTimes(2);
            expect(mocks.pullRequests.getForOrigin).toHaveBeenLastCalledWith(GH_ORIGIN, '42', { workspaceId: 'ws1', force: true });
        } finally {
            vi.useRealTimers();
        }
    });

    it('empty: no detection and no bindings keeps the card hidden', async () => {
        mocks.pullRequests.listChatBindingsForOrigin.mockResolvedValue({ bindings: {} });
        const { container } = render(
            <ChatPrStatusCard turns={[]} workspaceId="ws1" remoteUrl={GH_REMOTE} taskId="t1" />,
        );
        await waitFor(() => expect(mocks.pullRequests.listChatBindingsForOrigin).toHaveBeenCalled());
        expect(container.querySelector('[data-testid="pr-status-card"]')).toBeNull();
        expect(mocks.pullRequests.getForOrigin).not.toHaveBeenCalled();
    });

    it('AC-03: defers the bindings round-trip past the synchronous mount', async () => {
        vi.useFakeTimers();
        try {
            mocks.pullRequests.listChatBindingsForOrigin.mockResolvedValue({ bindings: {} });
            // Empty turns → no detected PRs → no detail fetch; isolates the
            // bindings probe itself for the deferral assertion.
            render(
                <ChatPrStatusCard turns={[]} workspaceId="ws1" remoteUrl={GH_REMOTE} taskId="t1" />,
            );
            // The bindings probe is non-critical chrome: it must NOT fire during
            // the synchronous mount/effect commit — it is deferred to browser
            // idle so the conversation paints first.
            expect(mocks.pullRequests.listChatBindingsForOrigin).not.toHaveBeenCalled();
            // Once the browser idles (macrotask fallback in jsdom), it loads.
            await act(async () => { await vi.advanceTimersByTimeAsync(0); });
            expect(mocks.pullRequests.listChatBindingsForOrigin).toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it('regression: a remote workspace routes through getCocClientForWorkspace, never the local client', async () => {
        // A remote-owned chat: the workspace id only resolves on its remote server.
        // Resolving it against the local client 404s with "Repo <ws> not found".
        const REMOTE_WS = 'ws-xjvuoc';
        const remotePullRequests = {
            listChatBindingsForOrigin: vi.fn().mockResolvedValue({ bindings: {} }),
            createChatBindingForOrigin: vi.fn().mockResolvedValue({ prId: '42', taskId: 't1' }),
            getForOrigin: vi.fn().mockResolvedValue({
                number: 42,
                title: 'Remote PR',
                status: 'open',
                sourceBranch: 'feature/card',
                targetBranch: 'main',
                createdAt: '2024-01-01T00:00:00Z',
                url: GH_URL,
            }),
            getReviewersForOrigin: vi.fn().mockResolvedValue({ reviewers: [] }),
            getChecksForOrigin: vi.fn().mockResolvedValue({ checks: [] }),
        };
        mocks.getCocClientForWorkspace.mockImplementation((wsId: string) =>
            wsId === REMOTE_WS ? { pullRequests: remotePullRequests } : { pullRequests: mocks.pullRequests },
        );

        const { findByText, findByTestId } = render(
            <ChatPrStatusCard turns={[turnWithPrCreate(GH_URL)]} workspaceId={REMOTE_WS} remoteUrl={GH_REMOTE} taskId="t1" />,
        );

        fireEvent.click(await findByTestId('pr-status-card-toggle'));
        await findByText('Remote PR');

        // Routed to the workspace's owning (remote) server, keyed by its id.
        expect(mocks.getCocClientForWorkspace).toHaveBeenCalledWith(REMOTE_WS);
        expect(remotePullRequests.getForOrigin).toHaveBeenCalledWith(GH_ORIGIN, '42', { workspaceId: REMOTE_WS });
        expect(remotePullRequests.getReviewersForOrigin).toHaveBeenCalledWith(GH_ORIGIN, '42', { workspaceId: REMOTE_WS });
        // The default local client is never used for a remote workspace.
        expect(mocks.pullRequests.getForOrigin).not.toHaveBeenCalled();
        expect(mocks.pullRequests.listChatBindingsForOrigin).not.toHaveBeenCalled();
    });
});

describe('mapPrDetailToCardPr', () => {
    it('maps a canonical PR detail to the card subset', () => {
        const pr = mapPrDetailToCardPr({
            number: 7,
            title: 'A PR',
            status: 'merged',
            sourceBranch: 'feat',
            targetBranch: 'main',
            mergedAt: '2024-01-02T00:00:00Z',
            url: 'https://example/pr/7',
        });
        expect(pr).toEqual({
            number: 7,
            title: 'A PR',
            status: 'merged',
            sourceBranch: 'feat',
            targetBranch: 'main',
            mergedAt: '2024-01-02T00:00:00Z',
            closedAt: undefined,
            url: 'https://example/pr/7',
        });
    });

    it('returns undefined for non-objects or payloads missing title/status', () => {
        expect(mapPrDetailToCardPr(null)).toBeUndefined();
        expect(mapPrDetailToCardPr('nope')).toBeUndefined();
        expect(mapPrDetailToCardPr({ title: 'no status' })).toBeUndefined();
        expect(mapPrDetailToCardPr({ status: 'open' })).toBeUndefined();
    });

    it('defaults missing branch fields to empty strings', () => {
        const pr = mapPrDetailToCardPr({ title: 'T', status: 'open' });
        expect(pr).toMatchObject({ title: 'T', status: 'open', sourceBranch: '', targetBranch: '' });
    });

    it('extracts the canonical auto-merge payload (AC-04)', () => {
        const pr = mapPrDetailToCardPr({
            title: 'T',
            status: 'open',
            autoMerge: {
                enabled: true,
                state: 'armed',
                mergeMethod: 'squash',
                enabledBy: { id: 'u1', displayName: 'Carol' },
                blockedReason: undefined,
            },
        });
        expect(pr?.autoMerge).toEqual({
            enabled: true,
            state: 'armed',
            mergeMethod: 'squash',
            enabledBy: { displayName: 'Carol' },
            blockedReason: undefined,
        });
    });

    it('leaves auto-merge undefined when the detail omits it', () => {
        const pr = mapPrDetailToCardPr({ title: 'T', status: 'open' });
        expect(pr?.autoMerge).toBeUndefined();
    });
});

describe('parseAutoMerge', () => {
    it('returns undefined for non-objects or payloads missing state', () => {
        expect(parseAutoMerge(undefined)).toBeUndefined();
        expect(parseAutoMerge(null)).toBeUndefined();
        expect(parseAutoMerge('nope')).toBeUndefined();
        expect(parseAutoMerge({ enabled: true })).toBeUndefined();
    });

    it('maps a blocked auto-merge, narrowing enabledBy to displayName', () => {
        expect(
            parseAutoMerge({
                enabled: true,
                state: 'blocked',
                blockedReason: 'conflicts',
                enabledBy: { id: 'u2', displayName: 'Dana', email: 'd@x.io' },
            }),
        ).toEqual({
            enabled: true,
            state: 'blocked',
            blockedReason: 'conflicts',
            mergeMethod: undefined,
            enabledBy: { displayName: 'Dana' },
        });
    });

    it('treats a missing/false enabled flag and absent enabledBy gracefully', () => {
        expect(parseAutoMerge({ state: 'not-enabled' })).toEqual({
            enabled: false,
            state: 'not-enabled',
            blockedReason: undefined,
            mergeMethod: undefined,
            enabledBy: undefined,
        });
    });
});
