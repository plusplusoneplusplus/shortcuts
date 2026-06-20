/**
 * Tests for RepoCard — 2-line compact layout.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

// Mock useRepoQueueStats to return zeroes by default
const mockQueueStats = vi.fn(() => ({ running: 0, queued: 0 }));

vi.mock('../../../../src/server/spa/client/react/queue/hooks/useRepoQueueStats', () => ({
    useRepoQueueStats: (...args: any[]) => mockQueueStats(...args),
}));

import { RepoCard } from '../../../../src/server/spa/client/react/repos/RepoCard';
import type { RepoData } from '../../../../src/server/spa/client/react/repos/repoGrouping';

function makeRepo(overrides: Partial<RepoData> = {}): RepoData {
    return {
        workspace: { id: 'ws-1', name: 'my-app', rootPath: '/home/user/my-app' } as any,
        gitInfo: { branch: 'main', dirty: false, isGitRepo: true } as any,
        workflows: [],
        stats: { success: 2, failed: 1, running: 0 },
        taskCount: 0,
        ...overrides,
    };
}

function renderCard(props: Partial<Parameters<typeof RepoCard>[0]> = {}) {
    const defaults = {
        repo: makeRepo(),
        isSelected: false,
        onClick: vi.fn(),
    };
    return render(<RepoCard {...defaults} {...props} />);
}

// ── Layout: 2 rows ────────────────────────────────────────────────────────────

describe('2-line layout', () => {
    it('renders repo name on line 1', () => {
        renderCard();
        expect(screen.getByText('my-app')).toBeTruthy();
    });

    it('renders branch badge on line 1 when NOT in group', () => {
        renderCard({ inGroup: false });
        expect(screen.getByText('main')).toBeTruthy();
    });

    it('renders branch badge on line 1 when in group', () => {
        renderCard({ inGroup: true });
        expect(screen.getByText('main')).toBeTruthy();
    });

    it('renders Pipelines count on line 2', () => {
        renderCard({ repo: makeRepo({ workflows: [{} as any, {} as any] }) });
        expect(screen.getByText('Workflows: 2')).toBeTruthy();
    });

    it('renders stat counts on line 2', () => {
        renderCard();
        // stats: success=2, failed=1, running=0
        const statsEl = document.querySelector('.repo-stat-counts');
        expect(statsEl).toBeTruthy();
        expect(statsEl?.textContent).toContain('✓2');
        expect(statsEl?.textContent).toContain('✗1');
    });

    it('does NOT render a standalone path div (old 3-row layout)', () => {
        renderCard();
        // Ensure path is on line 2 (inside stats row), not in a separate element
        // The stats row div contains the path text
        const card = document.querySelector('.repo-item');
        const children = Array.from(card?.children || []);
        // Card should have exactly 2 child divs (line 1 + line 2)
        expect(children.length).toBe(2);
    });
});

// ── taskCount on line 1 ───────────────────────────────────────────────────────

describe('taskCount', () => {
    it('does NOT show task count when taskCount is 0', () => {
        renderCard({ repo: makeRepo({ taskCount: 0 }) });
        expect(screen.queryByText(/· 0/)).toBeNull();
    });

    it('shows · taskCount on line 1 when taskCount > 0', () => {
        renderCard({ repo: makeRepo({ taskCount: 5 }) });
        expect(screen.getByText('· 5')).toBeTruthy();
    });
});

// ── Branch badge ──────────────────────────────────────────────────────────────

describe('branch badge', () => {
    it('hides badge when branch is n/a', () => {
        renderCard({ repo: makeRepo({ gitInfo: { branch: undefined } as any }) });
        expect(screen.queryByText('n/a')).toBeNull();
    });

    it('shows badge when branch is defined, regardless of inGroup', () => {
        renderCard({ repo: makeRepo(), inGroup: false });
        expect(screen.getByText('main')).toBeTruthy();

        renderCard({ repo: makeRepo(), inGroup: true });
        expect(screen.getAllByText('main').length).toBeGreaterThan(0);
    });
});

// ── Queue status ──────────────────────────────────────────────────────────────

describe('queue status', () => {
    it('hides queue-status span when both running and queued are 0', () => {
        mockQueueStats.mockReturnValue({ running: 0, queued: 0 });
        renderCard();
        expect(screen.queryByTestId('repo-card-queue-status')).toBeNull();
    });

    it('shows running indicator when running > 0', () => {
        mockQueueStats.mockReturnValue({ running: 3, queued: 0 });
        renderCard();
        expect(screen.getByTestId('repo-card-queue-running').textContent).toBe('⏳3');
    });

    it('shows queued indicator when queued > 0', () => {
        mockQueueStats.mockReturnValue({ running: 0, queued: 2 });
        renderCard();
        expect(screen.getByTestId('repo-card-queue-queued').textContent).toBe('⏸2');
    });
});

// ── Selected state ────────────────────────────────────────────────────────────

describe('selected state', () => {
    it('applies ring classes when isSelected is true', () => {
        renderCard({ isSelected: true });
        const card = document.querySelector('.repo-item');
        expect(card?.className).toContain('ring-2');
    });

    it('does not apply ring classes when isSelected is false', () => {
        renderCard({ isSelected: false });
        const card = document.querySelector('.repo-item');
        expect(card?.className).not.toContain('ring-2');
    });
});

// ── inGroup indent ────────────────────────────────────────────────────────────

describe('inGroup indent', () => {
    it('applies ml-4 when inGroup is true', () => {
        renderCard({ inGroup: true });
        const card = document.querySelector('.repo-item');
        expect(card?.className).toContain('ml-4');
    });

    it('does not apply ml-4 when inGroup is false', () => {
        renderCard({ inGroup: false });
        const card = document.querySelector('.repo-item');
        expect(card?.className).not.toContain('ml-4');
    });
});

// ── Remote-workspace distinction (AC-03) ───────────────────────────────────────

function makeRemoteRepo(opts: {
    serverLabel?: string;
    connection?: string;
    queue?: string;
    offline?: boolean;
    name?: string;
} = {}): RepoData {
    const { serverLabel = 'devbox', connection = 'online', queue = 'idle', offline = false, name = 'shortcuts' } = opts;
    return makeRepo({
        workspace: {
            id: 'remote-1', name, color: '#0078d4', rootPath: '/remote/shortcuts', isGitRepo: true,
            baseUrl: 'http://127.0.0.1:4000',
            remote: { baseUrl: 'http://127.0.0.1:4000', serverId: 'srv-1', serverLabel, offline, connection, queue },
        } as any,
        gitInfo: { branch: 'main', dirty: false, isGitRepo: true } as any,
    });
}

describe('remote distinction (AC-03)', () => {
    beforeEach(() => {
        mockQueueStats.mockReturnValue({ running: 0, queued: 0 });
    });

    it('renders no remote badge for a local workspace (local layout unchanged)', () => {
        renderCard();
        expect(screen.queryByTestId('repo-card-remote-badge')).toBeNull();
        // Local card keeps its exact 2-row structure (identity + metadata).
        const card = document.querySelector('.repo-item');
        expect(Array.from(card?.children || []).length).toBe(2);
    });

    it('shows a compact server-label badge with a status dot for an online remote workspace', () => {
        renderCard({ repo: makeRemoteRepo({ serverLabel: 'devbox' }) });
        const badge = screen.getByTestId('repo-card-remote-badge');
        expect(badge.getAttribute('data-offline')).toBe('false');
        expect(badge.getAttribute('data-remote-status')).toBe('idle');
        expect(badge.textContent).toContain('devbox');
        expect(badge.getAttribute('title')).toContain('devbox');
        expect(screen.getByTestId('repo-card-remote-status-dot')).toBeTruthy();
    });

    it('reflects a running remote queue as a running status', () => {
        renderCard({ repo: makeRemoteRepo({ connection: 'online', queue: 'running' }) });
        const badge = screen.getByTestId('repo-card-remote-badge');
        expect(badge.getAttribute('data-offline')).toBe('false');
        expect(badge.getAttribute('data-remote-status')).toBe('running');
    });

    it('marks an offline remote workspace as offline rather than dropping it (AC-01 DoD)', () => {
        renderCard({ repo: makeRemoteRepo({ connection: 'offline', offline: true }) });
        const badge = screen.getByTestId('repo-card-remote-badge');
        expect(badge.getAttribute('data-offline')).toBe('true');
        expect(badge.getAttribute('data-remote-status')).toBe('offline');
        expect(badge.getAttribute('title')).toContain('offline');
        // The workspace still renders — it did not disappear silently.
        expect(screen.getByText('shortcuts')).toBeTruthy();
    });

    it('keeps the badge inside row 1 so the card structure is still 2 rows', () => {
        renderCard({ repo: makeRemoteRepo() });
        const card = document.querySelector('.repo-item');
        expect(Array.from(card?.children || []).length).toBe(2);
    });

    it('truncates a long server label so it cannot overflow the narrow dropdown', () => {
        renderCard({ repo: makeRemoteRepo({ serverLabel: 'a-very-long-remote-server-label-that-would-overflow' }) });
        const badge = screen.getByTestId('repo-card-remote-badge');
        expect(badge.className).toContain('max-w-[96px]');
        const labelSpan = badge.querySelector('span.truncate');
        expect(labelSpan?.textContent).toContain('a-very-long-remote-server-label');
    });
});
