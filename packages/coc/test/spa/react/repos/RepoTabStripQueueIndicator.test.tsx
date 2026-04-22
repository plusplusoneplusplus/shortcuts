/**
 * RepoTabStrip — queue status dot indicator tests.
 *
 * Verifies the repo-tab dot gets the correct animation class
 * for each queue state (idle, running, queued, paused).
 * Covers both main tabs and overflow dropdown dots.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import {
    RepoTabStrip,
    getDotAnimationClass,
    type QueueDotStatus,
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

const makeRepo = (id: string, name: string, color = '#ff0000') => ({
    workspace: { id, name, rootPath: `/repos/${id}`, color },
    stats: { success: 0, failed: 0, running: 0 },
    workflows: [],
    taskCount: 0,
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

/* ── Tests ────────────────────────────────────────────────────────────── */

describe('getDotAnimationClass (pure)', () => {
    it.each<[QueueDotStatus, string]>([
        ['idle', ''],
        ['running', ' animate-pulse'],
        ['queued', ' animate-blink'],
        ['paused', ' ring-1 ring-[#f14c4c]'],
    ])('returns correct class for %s', (status, expected) => {
        expect(getDotAnimationClass(status)).toBe(expected);
    });
});

describe('RepoTabStrip queue dot indicator', () => {
    beforeEach(() => {
        cleanup();
        mockQueueState = { repoQueueMap: {} };
    });

    it('dot has no animation class when queue is idle', () => {
        renderStrip([makeRepo('r1', 'Alpha')]);
        const dot = screen.getByTestId('repo-tab-dot');
        expect(dot.className).not.toContain('animate-');
        expect(dot.className).not.toContain('ring-');
    });

    it('dot has animate-pulse when repo has running tasks', () => {
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
        const dot = screen.getByTestId('repo-tab-dot');
        expect(dot.className).toContain('animate-pulse');
    });

    it('dot has animate-blink when repo has only queued tasks', () => {
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
        const dot = screen.getByTestId('repo-tab-dot');
        expect(dot.className).toContain('animate-blink');
    });

    it('dot has ring class when queue is paused', () => {
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
        const dot = screen.getByTestId('repo-tab-dot');
        expect(dot.className).toContain('ring-1');
        expect(dot.className).toContain('ring-[#f14c4c]');
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
        const dot = screen.getByTestId('repo-tab-dot');
        expect(dot.className).toContain('ring-1');
        expect(dot.className).not.toContain('animate-pulse');
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
        const dot = screen.getByTestId('repo-tab-dot');
        expect(dot.className).toContain('animate-pulse');
        expect(dot.className).not.toContain('animate-blink');
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
        const dot = screen.getByTestId('repo-tab-dot');
        expect(dot.className).not.toContain('animate-pulse');
        expect(dot.className).not.toContain('animate-blink');
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
        const dot = screen.getByTestId('repo-tab-dot');
        expect(dot.className).not.toContain('animate-blink');
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
        const dots = screen.getAllByTestId('repo-tab-dot');
        expect(dots[0].className).toContain('animate-pulse');
        expect(dots[1].className).toContain('animate-blink');
    });

    it('selected tab dot also gets animation class', () => {
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
        const dot = screen.getByTestId('repo-tab-dot');
        expect(dot.className).toContain('animate-pulse');
    });

    it('repo not in repoQueueMap renders idle (no extra class)', () => {
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
        const dot = screen.getByTestId('repo-tab-dot');
        expect(dot.className).not.toContain('animate-');
        expect(dot.className).not.toContain('ring-');
    });
});

describe('RepoTabStrip overflow dropdown queue dot indicator', () => {
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

    it('overflow dot has animate-pulse for running repo', () => {
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
        const overflowDots = screen.queryAllByTestId('overflow-repo-dot');
        // At least one overflow dot should exist with animate-pulse
        const pulsingDots = overflowDots.filter(d => d.className.includes('animate-pulse'));
        expect(pulsingDots.length).toBeGreaterThanOrEqual(1);
    });

    it('overflow dot has animate-blink for queued-only repo', () => {
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
        const overflowDots = screen.queryAllByTestId('overflow-repo-dot');
        const blinkingDots = overflowDots.filter(d => d.className.includes('animate-blink'));
        expect(blinkingDots.length).toBeGreaterThanOrEqual(1);
    });

    it('overflow dot has ring for paused repo', () => {
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
        const overflowDots = screen.queryAllByTestId('overflow-repo-dot');
        const pausedDots = overflowDots.filter(d => d.className.includes('ring-1'));
        expect(pausedDots.length).toBeGreaterThanOrEqual(1);
    });
});
