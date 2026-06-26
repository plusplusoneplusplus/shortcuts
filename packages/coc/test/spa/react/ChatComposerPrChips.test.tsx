/**
 * @vitest-environment jsdom
 *
 * Integration tests for ChatComposerPrChips + usePrChatStatusItems — the runtime
 * wiring behind the in-composer PR chip (design 01·B). The chip stack reuses the
 * same detect + persist + fetch hook as the legacy top-of-thread card, so these
 * cover the composer-specific presentation: a detected PR renders one chip with
 * provider links, the ✕ dismisses it for the session, the +adds/−dels diff
 * surfaces from the detail's diffStats, and an empty association set renders
 * nothing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';
import type { ClientConversationTurn } from '../../../src/server/spa/client/react/types/dashboard';

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

vi.mock('../../../src/server/spa/client/react/repos/cloneRegistry', () => ({
    getCocClientForWorkspace: mocks.getCocClientForWorkspace,
}));

import { ChatComposerPrChips } from '../../../src/server/spa/client/react/features/chat/conversation/ChatComposerPrChips';

const GH_URL = 'https://github.com/owner/repo/pull/42';
const GH_URL_2 = 'https://github.com/owner/repo/pull/99';
const GH_REMOTE = 'https://github.com/owner/repo';
const GH_ORIGIN = 'gh_owner_repo';
const ADO_URL = 'https://dev.azure.com/contoso/MyProject/_git/repo/pullrequest/380';
const ADO_REMOTE = 'https://dev.azure.com/contoso/MyProject';
const ADO_ORIGIN = 'ado_contoso_myproject';

function turnWithPrCreate(url: string, id = 'tc1', command = 'gh pr create --fill'): ClientConversationTurn {
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
                    args: { command },
                    result: `Creating pull request...\n${url}\n`,
                    status: 'completed',
                },
            },
        ],
    };
}

/** A plain tool turn that introduces no PR — stands in for an ongoing tool call. */
function plainToolTurn(id: string, command: string): ClientConversationTurn {
    return {
        role: 'assistant',
        content: '',
        timeline: [
            {
                type: 'tool-complete',
                timestamp: '2024-01-01T00:00:05Z',
                toolCall: {
                    id,
                    toolName: 'bash',
                    args: { command },
                    result: 'ok\n',
                    status: 'completed',
                },
            },
        ],
    };
}

/** Flush pending microtasks so any errant effect/async fetch would have fired. */
async function flushMicrotasks(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

describe('ChatComposerPrChips / usePrChatStatusItems', () => {
    beforeEach(() => {
        mocks.pullRequests.listChatBindingsForOrigin.mockReset();
        mocks.pullRequests.createChatBindingForOrigin.mockReset();
        mocks.pullRequests.getForOrigin.mockReset();
        mocks.pullRequests.getReviewersForOrigin.mockReset();
        mocks.pullRequests.getChecksForOrigin.mockReset();
        mocks.pullRequests.createChatBindingForOrigin.mockResolvedValue({ prId: '42', taskId: 't1' });
        mocks.pullRequests.getReviewersForOrigin.mockResolvedValue({ reviewers: [] });
        mocks.pullRequests.getChecksForOrigin.mockResolvedValue({ checks: [] });
        mocks.getCocClientForWorkspace.mockReset();
        mocks.getCocClientForWorkspace.mockReturnValue({ pullRequests: mocks.pullRequests });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('renders one composer chip for a detected GitHub PR, with title, diff, and provider links', async () => {
        mocks.pullRequests.listChatBindingsForOrigin.mockResolvedValue({ bindings: {} });
        mocks.pullRequests.getForOrigin.mockResolvedValue({
            number: 42,
            title: 'Dark mode: settings schedules',
            status: 'open',
            sourceBranch: 'feat/dark-settings',
            targetBranch: 'main',
            createdAt: '2024-01-01T00:00:00Z',
            url: GH_URL,
            diffStats: { additions: 142, deletions: 38, changedFiles: 3 },
        });

        const { findByText, getByTestId } = render(
            <ChatComposerPrChips turns={[turnWithPrCreate(GH_URL)]} workspaceId="ws1" remoteUrl={GH_REMOTE} taskId="t1" />,
        );

        await findByText('Dark mode: settings schedules');
        expect(getByTestId('composer-pr-chips')).toBeTruthy();
        expect(getByTestId('composer-pr-chip').getAttribute('data-state')).toBe('ready');

        const view = getByTestId(`composer-pr-chip-view-${GH_ORIGIN}:42`) as HTMLAnchorElement;
        expect(view.getAttribute('href')).toBe(GH_URL);
        expect(view.getAttribute('target')).toBe('_blank');
        expect(view.getAttribute('rel')).toBe('noopener noreferrer');
        const num = getByTestId(`composer-pr-chip-num-${GH_ORIGIN}:42`) as HTMLAnchorElement;
        expect(num.getAttribute('href')).toBe(GH_URL);
        expect(num.getAttribute('target')).toBe('_blank');
        expect(getByTestId('composer-pr-chip-diff').textContent).toContain('+142');
    });

    it('clicking the refresh button force-refreshes the PR detail (bypasses the cache)', async () => {
        mocks.pullRequests.listChatBindingsForOrigin.mockResolvedValue({ bindings: {} });
        mocks.pullRequests.getForOrigin.mockResolvedValue({
            number: 42,
            title: 'Refreshable PR',
            status: 'open',
            sourceBranch: 'feat/x',
            targetBranch: 'main',
            createdAt: '2024-01-01T00:00:00Z',
            url: GH_URL,
        });

        const { findByText, getByTestId } = render(
            <ChatComposerPrChips turns={[turnWithPrCreate(GH_URL)]} workspaceId="ws1" remoteUrl={GH_REMOTE} taskId="t1" />,
        );

        await findByText('Refreshable PR');
        // Initial detail load did not force a cache bypass.
        expect(mocks.pullRequests.getForOrigin).toHaveBeenLastCalledWith(GH_ORIGIN, '42', { workspaceId: 'ws1' });

        fireEvent.click(getByTestId(`composer-pr-chip-refresh-${GH_ORIGIN}:42`));

        await waitFor(() =>
            expect(mocks.pullRequests.getForOrigin).toHaveBeenLastCalledWith(GH_ORIGIN, '42', {
                workspaceId: 'ws1',
                force: true,
            }),
        );
    });

    it('clicking one chip refresh refreshes only that PR and spins only its control', async () => {
        // Regression: the refresh state was a single shared boolean and the
        // handler force-refreshed every association, so clicking one chip's
        // refresh spun every chip and re-fetched every PR. It must be per-row now —
        // only the clicked PR is force-refreshed and only its icon spins.
        mocks.pullRequests.listChatBindingsForOrigin.mockResolvedValue({ bindings: {} });

        const detailFor = (n: number) => ({
            number: n,
            title: n === 42 ? 'First PR' : 'Second PR',
            status: 'open' as const,
            sourceBranch: 'feat/x',
            targetBranch: 'main',
            createdAt: '2024-01-01T00:00:00Z',
            url: n === 42 ? GH_URL : GH_URL_2,
        });

        // Hold the forced #42 re-fetch open so we can observe the in-flight spinner.
        let resolveForced42: (() => void) | undefined;
        mocks.pullRequests.getForOrigin.mockImplementation(
            (_origin: string, prId: string, opts?: { force?: boolean }) => {
                const n = prId === '42' ? 42 : 99;
                if (n === 42 && opts?.force) {
                    return new Promise(resolve => {
                        resolveForced42 = () => resolve(detailFor(42));
                    });
                }
                return Promise.resolve(detailFor(n));
            },
        );

        const { findByText, getByTestId } = render(
            <ChatComposerPrChips
                turns={[turnWithPrCreate(GH_URL), turnWithPrCreate(GH_URL_2, 'tc-pr2')]}
                workspaceId="ws1"
                remoteUrl={GH_REMOTE}
                taskId="t1"
            />,
        );

        await findByText('First PR');
        await findByText('Second PR');
        const forcedBefore = mocks.pullRequests.getForOrigin.mock.calls.filter(
            ([, , opts]) => (opts as { force?: boolean } | undefined)?.force,
        ).length;
        expect(forcedBefore).toBe(0);

        fireEvent.click(getByTestId(`composer-pr-chip-refresh-${GH_ORIGIN}:42`));

        // Only the clicked chip's control shows busy while its refresh is in flight.
        await waitFor(() =>
            expect(getByTestId(`composer-pr-chip-refresh-${GH_ORIGIN}:42`).getAttribute('data-refreshing')).toBe('true'),
        );
        expect(getByTestId(`composer-pr-chip-refresh-${GH_ORIGIN}:99`).getAttribute('data-refreshing')).toBe('false');

        // Only PR #42 was force-refreshed; #99 was never re-fetched with force=true.
        expect(mocks.pullRequests.getForOrigin).toHaveBeenCalledWith(GH_ORIGIN, '42', { workspaceId: 'ws1', force: true });
        expect(mocks.pullRequests.getForOrigin).not.toHaveBeenCalledWith(GH_ORIGIN, '99', { workspaceId: 'ws1', force: true });

        // Once the in-flight refresh settles, the clicked chip's spinner clears.
        await act(async () => {
            resolveForced42?.();
            await Promise.resolve();
        });
        await waitFor(() =>
            expect(getByTestId(`composer-pr-chip-refresh-${GH_ORIGIN}:42`).getAttribute('data-refreshing')).toBe('false'),
        );
    });

    it('does not refetch (or flash loading) when turns change but the detected PR set is unchanged', async () => {
        // Regression: the fetch effect used to take the `detected` array as a
        // dependency. Since `detected` is a fresh reference on every `turns`
        // change, the effect re-ran after every tool call — reseting each chip to
        // 'loading' and refetching detail — even though the PR set was unchanged.
        mocks.pullRequests.listChatBindingsForOrigin.mockResolvedValue({ bindings: {} });
        mocks.pullRequests.getForOrigin.mockResolvedValue({
            number: 42,
            title: 'Stable PR',
            status: 'open',
            sourceBranch: 'feat/x',
            targetBranch: 'main',
            createdAt: '2024-01-01T00:00:00Z',
            url: GH_URL,
        });

        const { findByText, getByTestId, rerender } = render(
            <ChatComposerPrChips turns={[turnWithPrCreate(GH_URL)]} workspaceId="ws1" remoteUrl={GH_REMOTE} taskId="t1" />,
        );

        await findByText('Stable PR');
        expect(mocks.pullRequests.getForOrigin).toHaveBeenCalledTimes(1);
        const detailCalls = mocks.pullRequests.getForOrigin.mock.calls.length;
        const bindingCalls = mocks.pullRequests.listChatBindingsForOrigin.mock.calls.length;

        // Simulate an ongoing conversation: a new tool call appends a turn (fresh
        // `turns` array reference) that introduces no new PR.
        rerender(
            <ChatComposerPrChips
                turns={[turnWithPrCreate(GH_URL), plainToolTurn('tc-2', 'git status')]}
                workspaceId="ws1"
                remoteUrl={GH_REMOTE}
                taskId="t1"
            />,
        );
        await flushMicrotasks();

        // The pipeline must not re-run: no extra binding list, no extra detail
        // fetch, and the chip stays 'ready' (never flashes back to 'loading').
        expect(mocks.pullRequests.listChatBindingsForOrigin.mock.calls.length).toBe(bindingCalls);
        expect(mocks.pullRequests.getForOrigin.mock.calls.length).toBe(detailCalls);
        expect(getByTestId('composer-pr-chip').getAttribute('data-state')).toBe('ready');
    });

    it('does refetch when a genuinely new PR is detected in a later turn', async () => {
        // Guards the regression fix from over-correcting: a new PR URL changes
        // `detectedKey`, so the pipeline must still re-run and surface both chips.
        mocks.pullRequests.listChatBindingsForOrigin.mockResolvedValue({ bindings: {} });
        mocks.pullRequests.getForOrigin.mockImplementation((_origin: string, prId: string) =>
            Promise.resolve({
                number: prId === '42' ? 42 : 99,
                title: prId === '42' ? 'First PR' : 'Second PR',
                status: 'open',
                sourceBranch: 'feat/x',
                targetBranch: 'main',
                createdAt: '2024-01-01T00:00:00Z',
                url: prId === '42' ? GH_URL : GH_URL_2,
            }),
        );

        const { findByText, rerender } = render(
            <ChatComposerPrChips turns={[turnWithPrCreate(GH_URL)]} workspaceId="ws1" remoteUrl={GH_REMOTE} taskId="t1" />,
        );
        await findByText('First PR');

        rerender(
            <ChatComposerPrChips
                turns={[turnWithPrCreate(GH_URL), turnWithPrCreate(GH_URL_2, 'tc-pr2')]}
                workspaceId="ws1"
                remoteUrl={GH_REMOTE}
                taskId="t1"
            />,
        );

        await findByText('Second PR');
        expect(mocks.pullRequests.getForOrigin).toHaveBeenCalledWith(GH_ORIGIN, '99', { workspaceId: 'ws1' });
    });

    it('renders detected Azure DevOps PR links directly to Azure DevOps', async () => {
        mocks.pullRequests.listChatBindingsForOrigin.mockResolvedValue({ bindings: {} });
        mocks.pullRequests.getForOrigin.mockResolvedValue({
            number: 380,
            title: 'Route git review popout calls',
            status: 'merged',
            sourceBranch: 'fix/spa',
            targetBranch: 'main',
            createdAt: '2024-01-01T00:00:00Z',
            url: ADO_URL,
        });

        const { findByText, getByTestId } = render(
            <ChatComposerPrChips
                turns={[turnWithPrCreate(ADO_URL, 'tc-ado', 'az repos pr create')]}
                workspaceId="ws-ado"
                remoteUrl={ADO_REMOTE}
                taskId="t-ado"
            />,
        );

        await findByText('Route git review popout calls');
        expect(mocks.pullRequests.getForOrigin).toHaveBeenCalledWith(ADO_ORIGIN, '380', { workspaceId: 'ws-ado' });
        expect((getByTestId(`composer-pr-chip-num-${ADO_ORIGIN}:380`) as HTMLAnchorElement).getAttribute('href')).toBe(ADO_URL);
        const view = getByTestId(`composer-pr-chip-view-${ADO_ORIGIN}:380`) as HTMLAnchorElement;
        expect(view.getAttribute('href')).toBe(ADO_URL);
        expect(view.getAttribute('target')).toBe('_blank');
        expect(view.getAttribute('rel')).toBe('noopener noreferrer');
    });

    it('eager-loaded checks surface as a passing/total count on the chip', async () => {
        mocks.pullRequests.listChatBindingsForOrigin.mockResolvedValue({ bindings: {} });
        mocks.pullRequests.getForOrigin.mockResolvedValue({
            number: 42,
            title: 'PR with checks',
            status: 'open',
            sourceBranch: 'feat/x',
            targetBranch: 'main',
            createdAt: '2024-01-01T00:00:00Z',
            url: GH_URL,
        });
        mocks.pullRequests.getChecksForOrigin.mockResolvedValue({
            checks: [
                { id: 'c1', name: 'build', status: 'success', source: 'check' },
                { id: 'c2', name: 'unit', status: 'success', source: 'check' },
                { id: 'c3', name: 'e2e', status: 'pending', source: 'check' },
            ],
        });

        const { findByText, findByTestId } = render(
            <ChatComposerPrChips turns={[turnWithPrCreate(GH_URL)]} workspaceId="ws1" remoteUrl={GH_REMOTE} taskId="t1" />,
        );

        await findByText('PR with checks');
        const badge = await findByTestId('composer-pr-chip-checks');
        expect(badge.getAttribute('data-passing')).toBe('2');
        expect(badge.getAttribute('data-total')).toBe('3');
        expect(badge.textContent).toContain('2/3');
    });

    it('loads reviewer status through the origin reviewers route and force-refreshes it with the chip', async () => {
        mocks.pullRequests.listChatBindingsForOrigin.mockResolvedValue({ bindings: {} });
        mocks.pullRequests.getForOrigin.mockResolvedValue({
            number: 42,
            title: 'PR with reviewers',
            status: 'open',
            sourceBranch: 'feat/x',
            targetBranch: 'main',
            createdAt: '2024-01-01T00:00:00Z',
            url: GH_URL,
        });
        mocks.pullRequests.getReviewersForOrigin.mockResolvedValue({
            reviewers: [
                { identity: { displayName: 'Approved Reviewer' }, vote: 'approved' },
                { identity: { displayName: 'Waiting Reviewer' }, vote: 'noVote', isRequired: true },
            ],
        });

        const { findByText, findByTestId, getByTestId } = render(
            <ChatComposerPrChips turns={[turnWithPrCreate(GH_URL)]} workspaceId="ws1" remoteUrl={GH_REMOTE} taskId="t1" />,
        );

        await findByText('PR with reviewers');
        const badge = await findByTestId('composer-pr-chip-reviewers');
        expect(badge.textContent).toContain('1/2 reviewers');
        expect(badge.getAttribute('data-approved')).toBe('1');
        expect(badge.getAttribute('data-waiting')).toBe('1');
        expect(mocks.pullRequests.getReviewersForOrigin).toHaveBeenCalledWith(GH_ORIGIN, '42', { workspaceId: 'ws1' });

        fireEvent.click(getByTestId(`composer-pr-chip-refresh-${GH_ORIGIN}:42`));

        await waitFor(() =>
            expect(mocks.pullRequests.getReviewersForOrigin).toHaveBeenLastCalledWith(GH_ORIGIN, '42', {
                workspaceId: 'ws1',
                force: true,
            }),
        );
    });

    it('keeps the PR chip ready when reviewer fetching fails', async () => {
        mocks.pullRequests.listChatBindingsForOrigin.mockResolvedValue({ bindings: {} });
        mocks.pullRequests.getForOrigin.mockResolvedValue({
            number: 42,
            title: 'Reviewer failure does not hide me',
            status: 'open',
            sourceBranch: 'feat/x',
            targetBranch: 'main',
            createdAt: '2024-01-01T00:00:00Z',
            url: GH_URL,
        });
        mocks.pullRequests.getReviewersForOrigin.mockRejectedValueOnce(new Error('reviewers down'));

        const { findByText, getByTestId, queryByTestId } = render(
            <ChatComposerPrChips turns={[turnWithPrCreate(GH_URL)]} workspaceId="ws1" remoteUrl={GH_REMOTE} taskId="t1" />,
        );

        await findByText('Reviewer failure does not hide me');
        await waitFor(() => expect(mocks.pullRequests.getReviewersForOrigin).toHaveBeenCalled());
        expect(getByTestId('composer-pr-chip').getAttribute('data-state')).toBe('ready');
        expect(queryByTestId('composer-pr-chip-reviewers')).toBeNull();
    });

    it('dismissing a chip with ✕ hides it for the session', async () => {
        mocks.pullRequests.listChatBindingsForOrigin.mockResolvedValue({ bindings: {} });
        mocks.pullRequests.getForOrigin.mockResolvedValue({
            number: 42,
            title: 'Dismissable PR',
            status: 'open',
            sourceBranch: 'feat/x',
            targetBranch: 'main',
            createdAt: '2024-01-01T00:00:00Z',
            url: GH_URL,
        });

        const { findByText, getByTestId, queryByTestId } = render(
            <ChatComposerPrChips turns={[turnWithPrCreate(GH_URL)]} workspaceId="ws1" remoteUrl={GH_REMOTE} taskId="t1" />,
        );

        await findByText('Dismissable PR');
        fireEvent.click(getByTestId(`composer-pr-chip-dismiss-${GH_ORIGIN}:42`));
        await waitFor(() => expect(queryByTestId('composer-pr-chips')).toBeNull());
    });

    it('renders nothing when no PR is detected and no binding exists', async () => {
        mocks.pullRequests.listChatBindingsForOrigin.mockResolvedValue({ bindings: {} });
        const { container } = render(
            <ChatComposerPrChips turns={[]} workspaceId="ws1" remoteUrl={GH_REMOTE} taskId="t1" />,
        );
        await waitFor(() => expect(mocks.pullRequests.listChatBindingsForOrigin).toHaveBeenCalled());
        expect(container.querySelector('[data-testid="composer-pr-chips"]')).toBeNull();
        expect(mocks.pullRequests.getForOrigin).not.toHaveBeenCalled();
    });
});
