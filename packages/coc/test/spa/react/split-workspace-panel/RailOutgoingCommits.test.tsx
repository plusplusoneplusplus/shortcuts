/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CocClient, GitCommit, GitCommitListResponse, GitInfoResponse } from '@plusplusoneplusplus/coc-client';
import { RailOutgoingCommits } from '../../../../src/server/spa/client/react/features/repo-detail/RailOutgoingCommits';
import { outgoingCommits } from '../../../../src/server/spa/client/react/features/git/commits/outgoingCommits';

const info: GitInfoResponse = {
    branch: 'main', isGitRepo: true, upstream: 'origin/main', ahead: 2, behind: 0, detached: false,
    dirty: false, remoteUrl: null,
};
const commit = (n: number): GitCommit => ({
    hash: n.toString(16).padStart(40, '0'), shortHash: n.toString(16).padStart(7, '0'),
    subject: `Change ${n}`, author: 'Example', date: '2026-10-01T12:00:00Z', parentHashes: [],
});
function setup(baseUrl?: string) {
    const listCommits = vi.fn<(id: string, query: unknown) => Promise<GitCommitListResponse>>()
        .mockResolvedValue({ commits: [commit(2), commit(1), commit(0)], unpushedCount: 2 });
    const fake = { options: { baseUrl }, git: { listCommits } };
    const client = fake as typeof fake & CocClient;
    const props = { client, workspaceId: 'repo-a', routingRef: baseUrl ? 'remote:owner:repo-a' : 'repo-a',
        info, readAt: 1, loading: false, failed: false, onOpen: vi.fn(), onRetry: vi.fn() };
    return { props, listCommits };
}
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}
beforeEach(() => { window.matchMedia = vi.fn().mockReturnValue({ matches: false }); });
afterEach(cleanup);

describe('rail outgoing history', () => {
    it('uses the expanded outgoing prefix and shared SHA/subject formatting without sorting', async () => {
        const { props } = setup();
        const history = [commit(2), commit(1), commit(0)];
        expect(outgoingCommits(history, 2)).toEqual(history.slice(0, 2));
        render(<RailOutgoingCommits {...props} />);
        const rows = await screen.findAllByRole('button', { name: /^Open commit/ });
        expect(rows.map(row => row.textContent)).toEqual(['0000002Change 2', '0000001Change 1']);
        expect(screen.queryByText('Change 0')).toBeNull();
        expect(screen.getByTestId('commit-hash-0000002')).toHaveClass('font-mono', 'flex-shrink-0');
        expect(screen.getByText('Change 2')).toHaveClass('truncate', 'min-w-0');
        expect(screen.getByTestId('rail-outgoing-list')).toHaveClass('max-h-48', 'overflow-y-auto', 'overscroll-contain');
        fireEvent.click(rows[1]);
        expect(props.onOpen).toHaveBeenCalledWith(commit(1));
    });

    it('announces pending reads and discards results after unmount', async () => {
        const { props, listCommits } = setup();
        const pending = deferred<GitCommitListResponse>();
        listCommits.mockReturnValue(pending.promise);
        const view = render(<RailOutgoingCommits {...props} />);
        expect(screen.getByRole('status')).toHaveTextContent('Loading outgoing commits');
        expect(screen.getByRole('list')).toHaveAttribute('aria-busy', 'true');
        view.unmount();
        await act(async () => pending.resolve({ commits: [commit(99)], unpushedCount: 2 }));
        expect(screen.queryByText('Change 99')).toBeNull();
    });

    it.each([
        ['missing upstream', { info: { ...info, upstream: null } }, 'No upstream'],
        ['unknown upstream', { info: { ...info, upstream: undefined } }, 'unavailable'],
        ['detached', { info: { ...info, detached: true } }, 'detached HEAD'],
        ['not a repository', { info: { ...info, isGitRepo: false } }, 'unavailable'],
        ['status failed', { failed: true }, 'unavailable'],
        ['status pending', { loading: true }, 'Reading outgoing status'],
        ['unresolved remote', { routingRef: 'remote:missing:repo-a' }, 'unavailable'],
    ])('does not read history for %s', async (_name, patch, message) => {
        const { props, listCommits } = setup();
        render(<RailOutgoingCommits {...props} {...patch} />);
        expect(screen.getByRole('status')).toHaveTextContent(message);
        expect(listCommits).not.toHaveBeenCalled();
        expect(screen.queryByText('No outgoing commits.')).toBeNull();
    });

    it('shows no outgoing only after a successful zero-count history read', async () => {
        const { props, listCommits } = setup();
        listCommits.mockResolvedValue({ commits: [commit(0)], unpushedCount: 0 });
        render(<RailOutgoingCommits {...props} info={{ ...info, ahead: 0 }} />);
        expect(await screen.findByText('No outgoing commits.')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Open commit/ })).toBeNull();
    });

    it('omits confirmed zero outgoing sections in compact cards without reading history', () => {
        const { props, listCommits } = setup();
        const view = render(<RailOutgoingCommits {...props} compact info={{ ...info, ahead: 0, behind: 4, dirty: true }} />);
        expect(screen.queryByTestId('rail-outgoing')).toBeNull();
        expect(listCommits).not.toHaveBeenCalled();
        view.rerender(<RailOutgoingCommits {...props} compact />);
        expect(screen.getByTestId('rail-outgoing')).toHaveClass('mt-1');
        expect(screen.getByRole('status')).toHaveTextContent('Loading outgoing commits');
    });

    it.each([
        ['loading zero', { info: { ...info, ahead: 0 }, loading: true }, 'Reading outgoing status'],
        ['failed zero', { info: { ...info, ahead: 0 }, failed: true }, 'unavailable'],
        ['unknown comparison', { info: { ...info, ahead: 0, upstream: undefined } }, 'unavailable'],
        ['missing upstream', { info: { ...info, ahead: 0, upstream: null } }, 'No upstream'],
        ['detached zero', { info: { ...info, ahead: 0, detached: true } }, 'detached HEAD'],
        ['missing status', { info: null }, 'unavailable'],
        ['unresolved zero', { info: { ...info, ahead: 0 }, routingRef: 'remote:missing:repo-a' }, 'unavailable'],
    ])('keeps compact %s visible without a redundant heading', (_name, patch, message) => {
        const { props, listCommits } = setup();
        render(<RailOutgoingCommits {...props} {...patch} compact />);
        expect(screen.getByRole('status')).toHaveTextContent(message);
        expect(screen.getByRole('region', { name: 'Outgoing commits' })).toBeInTheDocument();
        expect(screen.queryByText('Outgoing commits')).toBeNull();
        expect(screen.queryByText('No outgoing commits.')).toBeNull();
        expect(listCommits).not.toHaveBeenCalled();
    });

    it('does not treat an omitted ahead count as confirmed zero in compact cards', async () => {
        const { props, listCommits } = setup();
        render(<RailOutgoingCommits {...props} compact info={{ ...info, ahead: undefined }} />);
        expect(await screen.findByRole('alert')).toHaveTextContent('history is unavailable');
        expect(listCommits).toHaveBeenCalledOnce();
    });

    it('keeps populated compact history, owner navigation and retryable errors', async () => {
        const { props, listCommits } = setup('https://owner.example');
        const view = render(<RailOutgoingCommits {...props} compact />);
        fireEvent.click(await screen.findByRole('button', { name: 'Open commit 0000002: Change 2' }));
        expect(props.onOpen).toHaveBeenCalledWith(commit(2));
        expect(listCommits).toHaveBeenCalledWith('repo-a', { limit: 50, skip: undefined, refresh: true });
        expect(screen.getByText('Outgoing commits')).not.toHaveClass('mb-1');
        listCommits.mockRejectedValue(new Error('History unavailable'));
        view.rerender(<RailOutgoingCommits {...props} compact readAt={2} />);
        expect(await screen.findByRole('alert')).toHaveTextContent('History unavailable');
        fireEvent.click(screen.getByRole('button', { name: 'Retry outgoing read' }));
        expect(props.onRetry).toHaveBeenCalledOnce();
        expect(screen.queryByText('No outgoing commits.')).toBeNull();
    });

    it('reports errors and retries through the owner status read', async () => {
        const { props, listCommits } = setup();
        listCommits.mockRejectedValue(new Error('Owner offline'));
        const view = render(<RailOutgoingCommits {...props} />);
        expect(await screen.findByRole('alert')).toHaveTextContent('Owner offline');
        expect(screen.queryByText('No outgoing commits.')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Retry outgoing read' }));
        expect(props.onRetry).toHaveBeenCalledOnce();
        listCommits.mockResolvedValue({ commits: [commit(2), commit(1)], unpushedCount: 2 });
        view.rerender(<RailOutgoingCommits {...props} readAt={2} />);
        await screen.findByText('Change 2');
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it.each([
        { commits: [], unpushedCount: 0 },
        { commits: [], unpushedCount: 2 },
    ])('does not disguise inconsistent or unavailable history as clean: %j', async result => {
        const { props, listCommits } = setup();
        listCommits.mockResolvedValue(result);
        render(<RailOutgoingCommits {...props} />);
        expect(await screen.findByRole('alert')).toHaveTextContent('history is unavailable');
        expect(screen.queryByText('No outgoing commits.')).toBeNull();
    });

    it.each(['workspace', 'branch', 'upstream', 'freshness', 'owner'] as const)('discards late history on a %s change', async change => {
        const { props, listCommits } = setup();
        const old = deferred<GitCommitListResponse>();
        listCommits.mockReturnValueOnce(old.promise);
        const view = render(<RailOutgoingCommits {...props} />);
        const next = setup('https://owner.example');
        const changed = {
            ...props,
            ...(change === 'workspace' ? { workspaceId: 'repo-b' } : {}),
            ...(change === 'branch' ? { info: { ...info, branch: 'topic' } } : {}),
            ...(change === 'upstream' ? { info: { ...info, upstream: 'origin/topic' } } : {}),
            ...(change === 'freshness' ? { readAt: 2 } : {}),
            ...(change === 'owner' ? { client: next.props.client, routingRef: next.props.routingRef } : {}),
        };
        view.rerender(<RailOutgoingCommits {...changed} />);
        await screen.findByText('Change 2');
        await act(async () => old.resolve({ commits: [commit(99)], unpushedCount: 2 }));
        expect(screen.queryByText('Change 99')).toBeNull();
        expect(screen.getAllByRole('button', { name: /^Open commit/ })).toHaveLength(2);
        if (change === 'owner') expect(next.listCommits).toHaveBeenCalledWith('repo-a', expect.any(Object));
    });

    it('clears visible history immediately on a branch change and blocks failed status reads', async () => {
        const { props, listCommits } = setup();
        const view = render(<RailOutgoingCommits {...props} />);
        await screen.findByText('Change 2');
        listCommits.mockReturnValue(new Promise(() => {}));
        view.rerender(<RailOutgoingCommits {...props} info={{ ...info, branch: 'topic' }} />);
        expect(screen.queryByText('Change 2')).toBeNull();
        expect(screen.getByRole('status')).toHaveTextContent('Loading outgoing');
        view.rerender(<RailOutgoingCommits {...props} failed />);
        expect(screen.getByRole('status')).toHaveTextContent('unavailable');
        expect(screen.queryByText('Change 2')).toBeNull();
    });

    it('loads further history pages only on request, excluding the pushed tail', async () => {
        const { props, listCommits } = setup();
        const history = Array.from({ length: 53 }, (_, index) => commit(53 - index));
        listCommits.mockResolvedValueOnce({ commits: history.slice(0, 50), unpushedCount: 52 })
            .mockResolvedValueOnce({ commits: history.slice(50), unpushedCount: 52 });
        render(<RailOutgoingCommits {...props} info={{ ...info, ahead: 52 }} />);
        const more = await screen.findByRole('button', { name: 'Load more outgoing commits (50 of 52)' });
        expect(listCommits).toHaveBeenCalledOnce();
        fireEvent.click(more);
        await waitFor(() => expect(screen.getAllByRole('button', { name: /^Open commit/ })).toHaveLength(52));
        expect(listCommits).toHaveBeenLastCalledWith('repo-a', { limit: 50, skip: 50, refresh: false });
        expect(screen.queryByText('Change 1')).toBeNull();
        expect(screen.queryByRole('button', { name: /Load more/ })).toBeNull();
    });
});
