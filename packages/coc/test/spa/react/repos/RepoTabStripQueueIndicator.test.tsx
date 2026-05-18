/**
 * RepoTabStrip — queue status indicator tests.
 *
 * Verifies repo tabs and overflow rows use explicit status icons
 * for active queue states while keeping the idle repo marker.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react';
import {
    RepoTabStrip,
    getRepoQueueStatusInfo,
    type RepoQueueStatus,
} from '../../../../src/server/spa/client/react/features/repo-detail/RepoTabStrip';

/* ── Configurable queue mock ─────────────────────────────────────────── */

let mockQueueState: any = { repoQueueMap: {} };
const mockQueueDispatch = vi.fn();

vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({ state: {}, dispatch: vi.fn() }),
}));

vi.mock('../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ state: mockQueueState, dispatch: mockQueueDispatch }),
}));

vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    getApiBase: () => 'http://localhost:4000/api',
    isRalphEnabled: () => false,
    isContainerMode: () => false,
    getRawApiBase: () => 'http://localhost:4000/api',
    getHostname: () => 'localhost',
    isServersEnabled: () => false,
}));

vi.mock('../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: vi.fn().mockResolvedValue({ gitGroupOrder: [] }),
}));

vi.mock('../../../../src/server/spa/client/react/repos/AddRepoDialog', () => ({
    AddRepoDialog: ({ open }: { open: boolean }) => open ? <div data-testid="add-repo-dialog" /> : null,
}));

vi.mock('../../../../src/server/spa/client/react/repos/AddFolderDialog', () => ({
    AddFolderDialog: ({ open }: { open: boolean }) => open ? <div data-testid="add-folder-dialog" /> : null,
}));

vi.mock('../../../../src/server/spa/client/react/tasks/GenerateTaskDialog', () => ({
    GenerateTaskDialog: () => null,
}));

/* ── Helpers ──────────────────────────────────────────────────────────── */

const makeRepo = (id: string, name: string, color = '#ff0000', isGitRepo: boolean | undefined = undefined) => ({
    workspace: { id, name, rootPath: `/repos/${id}`, color },
    stats: { success: 0, failed: 0, running: 0 },
    workflows: [],
    taskCount: 0,
    ...(isGitRepo === undefined ? {} : { gitInfo: { isGitRepo } }),
});

const defaultStats = {
    queued: 0, running: 0, completed: 0, failed: 0,
    cancelled: 0, total: 0, isPaused: false, isDraining: false,
};

function renderStrip(repos: ReturnType<typeof makeRepo>[], selectedRepoId: string | null = null) {
    return render(
        <RepoTabStrip
            repos={repos}
            selectedRepoId={selectedRepoId}
            onSelect={vi.fn()}
            unseenCounts={{}}
            onRefresh={vi.fn()}
        />
    );
}

function expectNoActiveIcon(container: HTMLElement = document.body) {
    expect(within(container).queryByTestId('repo-queue-play-icon')).toBeNull();
    expect(within(container).queryByTestId('repo-queue-pause-icon')).toBeNull();
    expect(within(container).queryByTestId('repo-queue-pending-icon')).toBeNull();
}

function getOverflowItem(repoId: string) {
    const item = screen.getAllByTestId('overflow-repo-item')
        .find(el => el.getAttribute('data-repo-id') === repoId);
    expect(item).toBeTruthy();
    return item as HTMLElement;
}

/* ── Tests ────────────────────────────────────────────────────────────── */

describe('getRepoQueueStatusInfo (pure)', () => {
    it.each<[RepoQueueStatus, ReturnType<typeof getRepoQueueStatusInfo>]>([
        ['idle', { status: 'idle', label: 'idle', icon: null }],
        ['running', { status: 'running', label: 'running jobs', icon: 'play' }],
        ['queued', { status: 'queued', label: 'queued jobs', icon: 'pending' }],
        ['paused', { status: 'paused', label: 'queue paused', icon: 'pause' }],
    ])('returns correct metadata for %s', (status, expected) => {
        expect(getRepoQueueStatusInfo(status)).toEqual(expected);
    });
});

describe('RepoTabStrip queue status indicator', () => {
    beforeEach(() => {
        cleanup();
        mockQueueState = { repoQueueMap: {} };
    });

    it('idle Git repo keeps the round color marker and no active-state icon', () => {
        renderStrip([makeRepo('r1', 'Alpha')]);
        const indicator = screen.getByTestId('repo-tab-dot');
        expect(indicator.dataset.status).toBe('idle');
        expect(indicator.className).toContain('rounded-full');
        expectNoActiveIcon();
        expect(screen.getByRole('button', { name: 'Alpha' })).toBeTruthy();
    });

    it('idle non-Git repo keeps the square color marker', () => {
        renderStrip([makeRepo('r1', 'Alpha', '#ff0000', false)]);
        const indicator = screen.getByTestId('repo-tab-dot');
        expect(indicator.dataset.status).toBe('idle');
        expect(indicator.className).toContain('rounded-sm');
        expectNoActiveIcon();
    });

    it('shows a play icon when repo has running tasks', () => {
        mockQueueState = {
            repoQueueMap: {
                r1: {
                    running: [{ type: 'task', payload: {} }],
                    queued: [],
                    history: [],
                    stats: { ...defaultStats, running: 1 },
                },
            },
        };
        renderStrip([makeRepo('r1', 'Alpha')]);
        const indicator = screen.getByTestId('repo-tab-dot');
        expect(indicator.dataset.status).toBe('running');
        expect(within(indicator).getByTestId('repo-queue-play-icon')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Alpha, running jobs' })).toBeTruthy();
    });

    it('shows a pending icon when repo has only queued tasks', () => {
        mockQueueState = {
            repoQueueMap: {
                r1: {
                    running: [],
                    queued: [{ type: 'task', payload: {} }],
                    history: [],
                    stats: { ...defaultStats, queued: 1 },
                },
            },
        };
        renderStrip([makeRepo('r1', 'Alpha')]);
        const indicator = screen.getByTestId('repo-tab-dot');
        expect(indicator.dataset.status).toBe('queued');
        expect(within(indicator).getByTestId('repo-queue-pending-icon')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Alpha, queued jobs' })).toBeTruthy();
    });

    it('shows a pause icon when queue is paused', () => {
        mockQueueState = {
            repoQueueMap: {
                r1: {
                    running: [],
                    queued: [],
                    history: [],
                    stats: { ...defaultStats, isPaused: true },
                },
            },
        };
        renderStrip([makeRepo('r1', 'Alpha')]);
        const indicator = screen.getByTestId('repo-tab-dot');
        expect(indicator.dataset.status).toBe('paused');
        expect(within(indicator).getByTestId('repo-queue-pause-icon')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Alpha, queue paused' })).toBeTruthy();
    });

    it('paused takes priority over running', () => {
        mockQueueState = {
            repoQueueMap: {
                r1: {
                    running: [{ type: 'task', payload: {} }],
                    queued: [],
                    history: [],
                    stats: { ...defaultStats, isPaused: true, running: 1 },
                },
            },
        };
        renderStrip([makeRepo('r1', 'Alpha')]);
        const indicator = screen.getByTestId('repo-tab-dot');
        expect(indicator.dataset.status).toBe('paused');
        expect(within(indicator).getByTestId('repo-queue-pause-icon')).toBeTruthy();
        expect(within(indicator).queryByTestId('repo-queue-play-icon')).toBeNull();
    });

    it('running takes priority over queued', () => {
        mockQueueState = {
            repoQueueMap: {
                r1: {
                    running: [{ type: 'task', payload: {} }],
                    queued: [{ type: 'task', payload: {} }],
                    history: [],
                    stats: { ...defaultStats, running: 1, queued: 1 },
                },
            },
        };
        renderStrip([makeRepo('r1', 'Alpha')]);
        const indicator = screen.getByTestId('repo-tab-dot');
        expect(indicator.dataset.status).toBe('running');
        expect(within(indicator).getByTestId('repo-queue-play-icon')).toBeTruthy();
        expect(within(indicator).queryByTestId('repo-queue-pending-icon')).toBeNull();
    });

    it('hidden chat follow-ups are excluded from running count', () => {
        mockQueueState = {
            repoQueueMap: {
                r1: {
                    running: [{ type: 'chat', payload: { processId: 'p1' } }],
                    queued: [],
                    history: [],
                    stats: { ...defaultStats, running: 1 },
                },
            },
        };
        renderStrip([makeRepo('r1', 'Alpha')]);
        const indicator = screen.getByTestId('repo-tab-dot');
        expect(indicator.dataset.status).toBe('idle');
        expectNoActiveIcon();
    });

    it('hidden chat follow-ups are excluded from queued count', () => {
        mockQueueState = {
            repoQueueMap: {
                r1: {
                    running: [],
                    queued: [{ type: 'chat', payload: { processId: 'p1' } }],
                    history: [],
                    stats: { ...defaultStats, queued: 1 },
                },
            },
        };
        renderStrip([makeRepo('r1', 'Alpha')]);
        const indicator = screen.getByTestId('repo-tab-dot');
        expect(indicator.dataset.status).toBe('idle');
        expectNoActiveIcon();
    });

    it('each repo shows independent status', () => {
        mockQueueState = {
            repoQueueMap: {
                r1: {
                    running: [{ type: 'task', payload: {} }],
                    queued: [],
                    history: [],
                    stats: { ...defaultStats, running: 1 },
                },
                r2: {
                    running: [],
                    queued: [{ type: 'task', payload: {} }],
                    history: [],
                    stats: { ...defaultStats, queued: 1 },
                },
            },
        };
        renderStrip([makeRepo('r1', 'Alpha'), makeRepo('r2', 'Beta')]);
        const indicators = screen.getAllByTestId('repo-tab-dot');
        expect(indicators[0].dataset.status).toBe('running');
        expect(within(indicators[0]).getByTestId('repo-queue-play-icon')).toBeTruthy();
        expect(indicators[1].dataset.status).toBe('queued');
        expect(within(indicators[1]).getByTestId('repo-queue-pending-icon')).toBeTruthy();
    });

    it('selected tab active icon remains visible', () => {
        mockQueueState = {
            repoQueueMap: {
                r1: {
                    running: [{ type: 'task', payload: {} }],
                    queued: [],
                    history: [],
                    stats: { ...defaultStats, running: 1 },
                },
            },
        };
        renderStrip([makeRepo('r1', 'Alpha')], 'r1');
        const indicator = screen.getByTestId('repo-tab-dot');
        expect(indicator.dataset.status).toBe('running');
        expect(indicator.style.color).toBe('rgba(255, 255, 255, 0.85)');
        expect(within(indicator).getByTestId('repo-queue-play-icon')).toBeTruthy();
    });

    it('repo not in repoQueueMap renders idle', () => {
        mockQueueState = {
            repoQueueMap: {
                other: {
                    running: [{ type: 'task', payload: {} }],
                    queued: [],
                    history: [],
                    stats: { ...defaultStats, running: 1 },
                },
            },
        };
        renderStrip([makeRepo('r1', 'Alpha')]);
        const indicator = screen.getByTestId('repo-tab-dot');
        expect(indicator.dataset.status).toBe('idle');
        expectNoActiveIcon();
    });
});

describe('RepoTabStrip overflow dropdown queue status indicator', () => {
    beforeEach(() => {
        cleanup();
        mockQueueState = { repoQueueMap: {} };
    });

    /**
     * Helper: render with mocked overflow so the dropdown appears.
     * jsdom has no layout engine, so we mock ResizeObserver + element widths
     * to force overflow mode, then open the dropdown.
     */
    function renderWithOverflowOpen(repos: ReturnType<typeof makeRepo>[]) {
        let resizeCb: ResizeObserverCallback | null = null;
        vi.stubGlobal('ResizeObserver', class {
            constructor(cb: ResizeObserverCallback) { resizeCb = cb; }
            observe() { /* trigger on next tick */ }
            disconnect() {}
        });

        const result = render(
            <RepoTabStrip
                repos={repos}
                selectedRepoId={null}
                onSelect={vi.fn()}
                unseenCounts={{}}
                onRefresh={vi.fn()}
            />
        );

        // Force overflow by mocking container width and tab widths
        const measureContainer = screen.getByTestId('repo-tab-measure-container');
        const visibleContainer = screen.getByTestId('repo-tab-visible-container');
        Object.defineProperty(visibleContainer, 'clientWidth', { value: 100, configurable: true });
        const tabEls = measureContainer.querySelectorAll('[data-repo-id]');
        tabEls.forEach(el => {
            Object.defineProperty(el, 'offsetWidth', { value: 80, configurable: true });
        });

        // Trigger resize
        act(() => {
            if (resizeCb) resizeCb([], {} as ResizeObserver);
        });

        // Open overflow dropdown
        const pill = screen.queryByTestId('overflow-pill');
        if (pill) {
            fireEvent.click(pill);
        }

        return result;
    }

    it('overflow row shows play icon and label for running repo', () => {
        mockQueueState = {
            repoQueueMap: {
                r2: {
                    running: [{ type: 'task', payload: {} }],
                    queued: [],
                    history: [],
                    stats: { ...defaultStats, running: 1 },
                },
            },
        };
        renderWithOverflowOpen([makeRepo('r1', 'Alpha'), makeRepo('r2', 'Beta'), makeRepo('r3', 'Gamma')]);
        const item = getOverflowItem('r2');
        const indicator = within(item).getByTestId('overflow-repo-dot');
        expect(item.getAttribute('aria-label')).toBe('Beta, running jobs');
        expect(indicator.dataset.status).toBe('running');
        expect(within(indicator).getByTestId('repo-queue-play-icon')).toBeTruthy();
    });

    it('overflow row shows pending icon and label for queued-only repo', () => {
        mockQueueState = {
            repoQueueMap: {
                r3: {
                    running: [],
                    queued: [{ type: 'task', payload: {} }],
                    history: [],
                    stats: { ...defaultStats, queued: 1 },
                },
            },
        };
        renderWithOverflowOpen([makeRepo('r1', 'Alpha'), makeRepo('r2', 'Beta'), makeRepo('r3', 'Gamma')]);
        const item = getOverflowItem('r3');
        const indicator = within(item).getByTestId('overflow-repo-dot');
        expect(item.getAttribute('aria-label')).toBe('Gamma, queued jobs');
        expect(indicator.dataset.status).toBe('queued');
        expect(within(indicator).getByTestId('repo-queue-pending-icon')).toBeTruthy();
    });

    it('overflow row shows pause icon and label for paused repo', () => {
        mockQueueState = {
            repoQueueMap: {
                r2: {
                    running: [],
                    queued: [],
                    history: [],
                    stats: { ...defaultStats, isPaused: true },
                },
            },
        };
        renderWithOverflowOpen([makeRepo('r1', 'Alpha'), makeRepo('r2', 'Beta'), makeRepo('r3', 'Gamma')]);
        const item = getOverflowItem('r2');
        const indicator = within(item).getByTestId('overflow-repo-dot');
        expect(item.getAttribute('aria-label')).toBe('Beta, queue paused');
        expect(indicator.dataset.status).toBe('paused');
        expect(within(indicator).getByTestId('repo-queue-pause-icon')).toBeTruthy();
    });

    it('overflow row keeps idle marker without an active-state icon', () => {
        renderWithOverflowOpen([makeRepo('r1', 'Alpha'), makeRepo('r2', 'Beta'), makeRepo('r3', 'Gamma')]);
        const item = getOverflowItem('r2');
        const indicator = within(item).getByTestId('overflow-repo-dot');
        expect(item.getAttribute('aria-label')).toBe('Beta');
        expect(indicator.dataset.status).toBe('idle');
        expectNoActiveIcon(item);
    });
});
