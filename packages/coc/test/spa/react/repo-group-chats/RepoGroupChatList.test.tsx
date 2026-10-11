/**
 * Repo-group aggregated chat list (canvas option B): owner prefixes, sections,
 * global history order, owner details, partial sources and Load more.
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { RepoGroupChatFeedResponse, RepoGroupChatSource } from '@plusplusoneplusplus/coc-client';
import { RepoGroupChatList } from '../../../../src/server/spa/client/react/repos/RepoGroupChatList';
import {
    buildRepoGroupChatFeedModel,
    type RepoGroupChatFeedModel,
    type RepoGroupChatRow,
} from '../../../../src/server/spa/client/react/repos/repoGroupChatFeed';
import {
    buildRepoGroupOwnerLabels,
    isUnseenGroupChat,
    OWNER_PREFIX_MAX_LENGTH,
    partitionPinnedRows,
} from '../../../../src/server/spa/client/react/repos/repoGroupChatRowLabels';

const sources: RepoGroupChatSource[] = [
    { workspaceId: 'grp', role: 'group', name: 'AI Repos', available: true },
    { workspaceId: 'ws-a', role: 'member', name: 'connector', available: true },
    { workspaceId: 'ws-b', role: 'member', name: 'shortcuts', available: true },
];

function model(overrides: Partial<RepoGroupChatFeedResponse> = {}): RepoGroupChatFeedModel {
    return buildRepoGroupChatFeedModel({
        groupId: 'grp',
        membershipKey: 'm1',
        sources,
        running: [],
        queued: [],
        history: [],
        hasMore: false,
        counts: { total: 0, running: 0, queued: 0, history: 0, byOwner: {}, partial: false },
        ...overrides,
    } as RepoGroupChatFeedResponse, 'local');
}

function hist(id: string, owner: string, extra: Record<string, unknown> = {}) {
    return {
        id, ownerWorkspaceId: owner, type: 'chat', status: 'completed',
        customTitle: `Title ${id}`, endTime: '2026-10-10T00:00:00.000Z',
        seenAt: '2026-10-10T00:00:00.000Z', ...extra,
    };
}

function renderList(m: RepoGroupChatFeedModel | null, props: Partial<Parameters<typeof RepoGroupChatList>[0]> = {}) {
    const onSelect = vi.fn();
    const loadMore = vi.fn(async () => {});
    render(
        <RepoGroupChatList
            feed={{ model: m, status: m ? 'ready' : 'loading', loadingMore: false, loadMore, ...(props.feed ?? {}) }}
            serverLabel={props.serverLabel ?? 'This server'}
            selectedKey={props.selectedKey ?? null}
            onSelect={props.onSelect ?? onSelect}
        />,
    );
    return { onSelect, loadMore };
}

afterEach(() => cleanup());

describe('buildRepoGroupOwnerLabels', () => {
    it('gives group-owned chats no prefix and members their registered name', () => {
        const labels = buildRepoGroupOwnerLabels(sources);
        expect(labels.get('grp')).toEqual({ full: 'AI Repos' });
        expect(labels.get('ws-a')).toEqual({ prefix: 'connector', full: 'connector' });
    });

    it('shortens long names only while they stay distinguishable', () => {
        const long = 'x'.repeat(OWNER_PREFIX_MAX_LENGTH + 5);
        const labels = buildRepoGroupOwnerLabels([
            { workspaceId: 'a', role: 'member', name: long + '-alpha', available: true },
            { workspaceId: 'b', role: 'member', name: long + '-beta', available: true },
            { workspaceId: 'c', role: 'member', name: 'y'.repeat(OWNER_PREFIX_MAX_LENGTH + 2), available: true },
        ]);
        // a and b shorten to the same text, so both keep their full names.
        expect(labels.get('a')!.prefix).toBe(long + '-alpha');
        expect(labels.get('b')!.prefix).toBe(long + '-beta');
        expect(labels.get('c')!.prefix).toHaveLength(OWNER_PREFIX_MAX_LENGTH);
        expect(labels.get('c')!.prefix!.endsWith('…')).toBe(true);
        expect(labels.get('c')!.full).toBe('y'.repeat(OWNER_PREFIX_MAX_LENGTH + 2));
    });

    it('tells members with the same registered name apart by workspace id', () => {
        const labels = buildRepoGroupOwnerLabels([
            { workspaceId: 'ws-1', role: 'member', name: 'app', available: true },
            { workspaceId: 'ws-2', role: 'member', name: 'app', available: true },
        ]);
        expect(labels.get('ws-1')!.prefix).not.toBe(labels.get('ws-2')!.prefix);
        expect(labels.get('ws-1')!.full).toContain('ws-1');
    });
});

describe('partitionPinnedRows / isUnseenGroupChat', () => {
    it('lifts pinned, unarchived history newest pin first and keeps the rest in order', () => {
        const m = model({
            history: [
                hist('h1', 'ws-a'),
                hist('h2', 'ws-b', { pinnedAt: '2026-10-01T00:00:00Z' }),
                hist('h3', 'grp', { pinnedAt: '2026-10-05T00:00:00Z' }),
                hist('h4', 'ws-a', { pinnedAt: '2026-10-06T00:00:00Z', archived: true }),
                hist('h5', 'ws-b'),
            ] as any,
        });
        const { pinned, rest } = partitionPinnedRows(m.history);
        expect(pinned.map(r => r.canonicalId)).toEqual(['h3', 'h2']);
        expect(rest.map(r => r.canonicalId)).toEqual(['h1', 'h4', 'h5']);
    });

    it('matches the owner unread rule: finished and not seen since it ended', () => {
        const row = (item: any, section: RepoGroupChatRow['section'] = 'history') =>
            ({ key: 'k', serverKey: 'local', ownerWorkspaceId: 'ws-a', ownerRole: 'member', canonicalId: 'x', section, item }) as RepoGroupChatRow;
        expect(isUnseenGroupChat(row({ status: 'completed', endTime: 'e1', seenAt: 'e0' }))).toBe(true);
        expect(isUnseenGroupChat(row({ status: 'failed', endTime: 'e1' }))).toBe(true);
        expect(isUnseenGroupChat(row({ status: 'completed', endTime: 'e1', seenAt: 'e1' }))).toBe(false);
        expect(isUnseenGroupChat(row({ status: 'cancelled', endTime: 'e1' }))).toBe(false);
        expect(isUnseenGroupChat(row({ status: 'running' }, 'running'))).toBe(false);
    });
});

describe('RepoGroupChatList', () => {
    it('reveals search excerpts in accessible and hover text without adding a metadata row', () => {
        renderList(model({ history: [hist('h1', 'ws-a')], snippets: { 'ws-a': { h1: 'Matching body text' } } }));
        const row = screen.getByTestId('repo-group-chat-row');
        expect(row.getAttribute('aria-label')).toContain('Matching body text');
        expect(row.getAttribute('title')).toContain('Matching body text');
        expect(screen.getByTestId('repo-group-search-snippet').closest('.chat-title')).toBeTruthy();
    });
    it('renders member rows as one line with a muted repo prefix and group rows with the title only', () => {
        renderList(model({ history: [hist('h1', 'ws-a'), hist('h2', 'grp')] as any }));
        const rows = screen.getAllByTestId('repo-group-chat-row');
        expect(within(rows[0]).getByTestId('repo-group-chat-owner-prefix').textContent).toBe('connector /');
        expect(within(rows[0]).getByText('Title h1')).toBeTruthy();
        expect(within(rows[1]).queryByTestId('repo-group-chat-owner-prefix')).toBeNull();
        expect(rows[1].getAttribute('data-owner-role')).toBe('group');
        // No tag/badge or second metadata line: one title span, no prompt preview row.
        expect(rows[0].querySelectorAll('.chat-title')).toHaveLength(1);
    });

    it('keeps Running, Queued, Pinned and History sections with history in the feed order', () => {
        renderList(model({
            running: [{ id: 't1', processId: 'queue_t1', ownerWorkspaceId: 'ws-b', type: 'chat', displayName: 'Run B' }] as any,
            queued: [{ id: 't2', ownerWorkspaceId: 'grp', type: 'chat', displayName: 'Queued G' }] as any,
            history: [
                hist('h-new', 'ws-b'),
                hist('h-pin', 'ws-a', { pinnedAt: '2026-10-02T00:00:00Z' }),
                hist('h-mid', 'grp'),
                hist('h-old', 'ws-a'),
            ] as any,
        }));
        const list = screen.getByTestId('repo-group-chat-list');
        const order = [...list.querySelectorAll('[data-section]')]
            .filter(el => el.getAttribute('role') === 'group')
            .map(el => el.getAttribute('data-section'));
        expect(order).toEqual(['running', 'queued', 'pinned', 'history']);
        const history = list.querySelector('[role="group"][data-section="history"]')!;
        expect([...history.querySelectorAll('[data-testid="repo-group-chat-row"]')].map(r => r.getAttribute('data-owner')))
            .toEqual(['ws-b', 'grp', 'ws-a']);
        const running = list.querySelector('[role="group"][data-section="running"]')!;
        expect(running.querySelector('.chat-row-when')!.textContent).toBe('Thinking');
    });

    it('keeps rows with equal ids under different owners separate', () => {
        renderList(model({ history: [hist('same', 'ws-a'), hist('same', 'ws-b')] as any }));
        const keys = screen.getAllByTestId('repo-group-chat-row').map(r => r.getAttribute('data-chat-key'));
        expect(keys).toEqual(['local|ws-a|same', 'local|ws-b|same']);
    });

    it('exposes full owner and server on hover and to assistive tech, and names the server in the header', () => {
        renderList(model({ history: [hist('h1', 'ws-a')] as any }), { serverLabel: 'devbox' });
        const row = screen.getByTestId('repo-group-chat-row');
        expect(row.getAttribute('aria-label')).toBe('Title h1 — connector · devbox');
        expect(row.getAttribute('title')).toContain('connector · devbox');
        expect(screen.getByTestId('repo-group-chat-server').textContent).toBe('devbox');
    });

    it('selects a row by click and keyboard and marks the selected row', () => {
        const m = model({ history: [hist('h1', 'ws-a'), hist('h2', 'grp')] as any });
        const { onSelect } = renderList(m, { selectedKey: 'local|grp|h2' });
        const rows = screen.getAllByTestId('repo-group-chat-row');
        expect(rows[1].getAttribute('aria-selected')).toBe('true');
        expect(rows[0].getAttribute('aria-selected')).toBe('false');
        fireEvent.click(rows[0]);
        fireEvent.keyDown(rows[1], { key: 'Enter' });
        expect(onSelect.mock.calls.map(c => c[0].key)).toEqual(['local|ws-a|h1', 'local|grp|h2']);
    });

    it('collapses a section from its header toggle', () => {
        renderList(model({ history: [hist('h1', 'ws-a')] as any }));
        const toggle = screen.getByTestId('repo-group-history-section-toggle');
        fireEvent.click(toggle);
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(screen.queryByTestId('repo-group-chat-row')).toBeNull();
    });

    it('marks unread rows and keeps native failed styling', () => {
        renderList(model({ history: [hist('h1', 'ws-a', { seenAt: undefined, status: 'failed' })] as any }));
        const row = screen.getByTestId('repo-group-chat-row');
        expect(row.getAttribute('data-unseen')).toBe('true');
        expect(within(row).getByTestId('unseen-dot')).toBeTruthy();
        expect(row.querySelector('.chat-title')!.className).toContain('text-red-700');
    });

    it('marks counts partial and names unavailable sources', () => {
        renderList(model({
            sources: [...sources.slice(0, 2), { ...sources[2], available: false, error: 'offline' }],
            history: [hist('h1', 'ws-a')] as any,
            counts: { total: 1, running: 0, queued: 0, history: 1, byOwner: {}, partial: true },
        }));
        expect(screen.getByTestId('repo-group-chat-total').textContent).toBe('1+');
        expect(screen.getByTestId('repo-group-chat-partial').textContent).toContain('shortcuts');
    });

    it('distinguishes loading, error and empty states', () => {
        renderList(null);
        expect(screen.getByTestId('repo-group-chat-loading')).toBeTruthy();
        cleanup();
        renderList(null, { feed: { model: null, status: 'error', error: 'boom', loadingMore: false, loadMore: vi.fn() } });
        expect(screen.getByTestId('repo-group-chat-error').textContent).toContain('boom');
        cleanup();
        renderList(model());
        expect(screen.getByTestId('repo-group-chat-empty').textContent).toBe('No chats yet.');
    });

    it('shows one Load more control while more history exists', () => {
        const { loadMore } = renderList(model({ history: [hist('h1', 'ws-a')] as any, hasMore: true, nextCursor: 'c1' }));
        fireEvent.click(screen.getByTestId('repo-group-chat-load-more'));
        expect(loadMore).toHaveBeenCalledTimes(1);
        expect(screen.getAllByTestId('repo-group-chat-load-more')).toHaveLength(1);
    });
});
