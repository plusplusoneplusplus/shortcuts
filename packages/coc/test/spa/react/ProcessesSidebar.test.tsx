/**
 * Tests for ProcessesSidebar — pause/resume controls, paused badge, and clear-queue button.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { AppProvider, useApp } from '../../../src/server/spa/client/react/context/AppContext';
import { QueueProvider, useQueue } from '../../../src/server/spa/client/react/context/QueueContext';
import { ProcessesSidebar } from '../../../src/server/spa/client/react/processes/ProcessesSidebar';

// ── Helpers ────────────────────────────────────────────────────────────

function makeStats(overrides: Partial<{
    queued: number; running: number; completed: number; failed: number;
    cancelled: number; total: number; isPaused: boolean; isDraining: boolean;
}> = {}) {
    return {
        queued: 0, running: 0, completed: 0, failed: 0,
        cancelled: 0, total: 0, isPaused: false, isDraining: false,
        ...overrides,
    };
}

function QueueSeeder({ stats, queued = [], running = [], history = [] }: {
    stats: ReturnType<typeof makeStats>;
    queued?: any[];
    running?: any[];
    history?: any[];
}) {
    const { dispatch } = useQueue();
    useEffect(() => {
        dispatch({ type: 'QUEUE_UPDATED', queue: { queued, running, history, stats } });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    return null;
}

function ProcessSeeder({ processes }: { processes: any[] }) {
    const { dispatch } = useApp();
    useEffect(() => {
        dispatch({ type: 'SET_PROCESSES', processes });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    return null;
}

function Wrap({ children, stats, queued, running, history, processes }: {
    children: ReactNode;
    stats?: ReturnType<typeof makeStats>;
    queued?: any[];
    running?: any[];
    history?: any[];
    processes?: any[];
}) {
    return (
        <AppProvider>
            <QueueProvider>
                {stats && <QueueSeeder stats={stats} queued={queued} running={running} history={history} />}
                {processes && <ProcessSeeder processes={processes} />}
                {children}
            </QueueProvider>
        </AppProvider>
    );
}

// ── Setup ──────────────────────────────────────────────────────────────

let fetchSpy: ReturnType<typeof vi.fn>;
let confirmSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
            queued: [], running: [], history: [],
            stats: makeStats(),
        }),
    });
    global.fetch = fetchSpy;
    confirmSpy = vi.fn().mockReturnValue(true);
    global.confirm = confirmSpy;
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ── Tests ──────────────────────────────────────────────────────────────

describe('ProcessesSidebar pause/resume controls', () => {
    it('renders pause button when isPaused=false and running tasks exist', async () => {
        render(
            <Wrap stats={makeStats({ running: 1 })}
                  running={[{ id: 'r1', status: 'running', prompt: 'test' }]}>
                <ProcessesSidebar />
            </Wrap>
        );
        await waitFor(() => {
            const btn = screen.getByTestId('pause-resume-btn');
            expect(btn.getAttribute('title')).toBe('Pause');
            expect(btn.textContent).toContain('⏸');
        });
    });

    it('renders resume button when isPaused=true', async () => {
        render(
            <Wrap stats={makeStats({ isPaused: true })}>
                <ProcessesSidebar />
            </Wrap>
        );
        await waitFor(() => {
            const btn = screen.getByTestId('pause-resume-btn');
            expect(btn.getAttribute('title')).toBe('Resume');
            expect(btn.textContent).toContain('▶');
        });
    });

    it('does not render pause button when isPaused=false and no active tasks', () => {
        render(
            <Wrap stats={makeStats()}>
                <ProcessesSidebar />
            </Wrap>
        );
        expect(screen.queryByTestId('pause-resume-btn')).toBeNull();
    });

    it('renders pause button when isPaused=false and queued tasks exist', async () => {
        render(
            <Wrap stats={makeStats({ queued: 1 })}
                  queued={[{ id: 'q1', status: 'queued', prompt: 'test' }]}>
                <ProcessesSidebar />
            </Wrap>
        );
        await waitFor(() => {
            const btn = screen.getByTestId('pause-resume-btn');
            expect(btn.getAttribute('title')).toBe('Pause');
        });
    });

    it('renders "Paused" badge when isPaused=true', async () => {
        render(
            <Wrap stats={makeStats({ isPaused: true })}>
                <ProcessesSidebar />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText('Paused')).toBeDefined();
        });
    });

    it('does not render "Paused" badge when isPaused=false', async () => {
        render(
            <Wrap stats={makeStats()}>
                <ProcessesSidebar />
            </Wrap>
        );
        expect(screen.queryByText('Paused')).toBeNull();
    });

    it('renders clear-queue button only when stats.queued > 0', async () => {
        const { unmount } = render(
            <Wrap stats={makeStats()}>
                <ProcessesSidebar />
            </Wrap>
        );
        expect(screen.queryByTestId('clear-queue-btn')).toBeNull();
        unmount();

        render(
            <Wrap stats={makeStats({ queued: 2 })}
                  queued={[{ id: 'q1', status: 'queued', prompt: 'a' }, { id: 'q2', status: 'queued', prompt: 'b' }]}>
                <ProcessesSidebar />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByTestId('clear-queue-btn')).toBeDefined();
        });
    });

    it('clicking pause calls POST /api/queue/pause then re-fetches and dispatches QUEUE_UPDATED', async () => {
        const updatedQueue = {
            queued: [], running: [], history: [],
            stats: makeStats({ isPaused: true }),
        };
        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (typeof url === 'string' && url.endsWith('/queue/pause')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            if (typeof url === 'string' && url.endsWith('/queue')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve(updatedQueue) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        render(
            <Wrap stats={makeStats({ running: 1 })}
                  running={[{ id: 'r1', status: 'running', prompt: 'test' }]}>
                <ProcessesSidebar />
            </Wrap>
        );

        await act(async () => {
            fireEvent.click(screen.getByTestId('pause-resume-btn'));
        });

        await waitFor(() => {
            const pauseCall = fetchSpy.mock.calls.find(
                (c: any[]) => typeof c[0] === 'string' && c[0].endsWith('/queue/pause')
            );
            expect(pauseCall).toBeDefined();
            expect(pauseCall![1]?.method).toBe('POST');

            const refetchCall = fetchSpy.mock.calls.find(
                (c: any[]) => typeof c[0] === 'string' && c[0].endsWith('/queue') && !c[0].endsWith('/queue/pause')
            );
            expect(refetchCall).toBeDefined();
        });
    });

    it('clicking resume calls POST /api/queue/resume then re-fetches', async () => {
        const updatedQueue = {
            queued: [], running: [], history: [],
            stats: makeStats({ isPaused: false }),
        };
        fetchSpy.mockImplementation((url: string) => {
            if (typeof url === 'string' && url.endsWith('/queue/resume')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            if (typeof url === 'string' && url.endsWith('/queue')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve(updatedQueue) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        render(
            <Wrap stats={makeStats({ isPaused: true })}>
                <ProcessesSidebar />
            </Wrap>
        );

        await act(async () => {
            fireEvent.click(screen.getByTestId('pause-resume-btn'));
        });

        await waitFor(() => {
            const resumeCall = fetchSpy.mock.calls.find(
                (c: any[]) => typeof c[0] === 'string' && c[0].endsWith('/queue/resume')
            );
            expect(resumeCall).toBeDefined();
            expect(resumeCall![1]?.method).toBe('POST');
        });
    });

    it('clicking clear queue calls confirm; if confirmed, calls DELETE /api/queue', async () => {
        confirmSpy.mockReturnValue(true);
        fetchSpy.mockImplementation((url: string) => {
            if (typeof url === 'string' && url.endsWith('/queue')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        queued: [], running: [], history: [],
                        stats: makeStats(),
                    }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        render(
            <Wrap stats={makeStats({ queued: 2 })}
                  queued={[{ id: 'q1', status: 'queued', prompt: 'a' }, { id: 'q2', status: 'queued', prompt: 'b' }]}>
                <ProcessesSidebar />
            </Wrap>
        );

        await act(async () => {
            fireEvent.click(screen.getByTestId('clear-queue-btn'));
        });

        expect(confirmSpy).toHaveBeenCalledWith('Clear all queued tasks?');

        await waitFor(() => {
            const deleteCall = fetchSpy.mock.calls.find(
                (c: any[]) => typeof c[0] === 'string' && c[0].endsWith('/queue') && c[1]?.method === 'DELETE'
            );
            expect(deleteCall).toBeDefined();
        });
    });

    it('clicking clear queue does nothing if confirm is cancelled', async () => {
        confirmSpy.mockReturnValue(false);

        render(
            <Wrap stats={makeStats({ queued: 1 })}
                  queued={[{ id: 'q1', status: 'queued', prompt: 'a' }]}>
                <ProcessesSidebar />
            </Wrap>
        );

        await act(async () => {
            fireEvent.click(screen.getByTestId('clear-queue-btn'));
        });

        expect(confirmSpy).toHaveBeenCalled();
        // No DELETE call should have been made
        const deleteCall = fetchSpy.mock.calls.find(
            (c: any[]) => typeof c[0] === 'string' && c[0].endsWith('/queue') && c[1]?.method === 'DELETE'
        );
        expect(deleteCall).toBeUndefined();
    });

    it('pause/resume button is disabled while loading', async () => {
        // Make fetch hang to keep loading state active
        let resolvePause: (v: any) => void;
        fetchSpy.mockImplementation((url: string) => {
            if (typeof url === 'string' && url.endsWith('/queue/pause')) {
                return new Promise(resolve => { resolvePause = resolve; });
            }
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({
                    queued: [], running: [], history: [],
                    stats: makeStats(),
                }),
            });
        });

        render(
            <Wrap stats={makeStats({ running: 1 })}
                  running={[{ id: 'r1', status: 'running', prompt: 'test' }]}>
                <ProcessesSidebar />
            </Wrap>
        );

        const btn = screen.getByTestId('pause-resume-btn');
        expect(btn.hasAttribute('disabled')).toBe(false);

        // Click to start loading
        act(() => {
            fireEvent.click(btn);
        });

        await waitFor(() => {
            expect(screen.getByTestId('pause-resume-btn').hasAttribute('disabled')).toBe(true);
        });

        // Resolve to clean up
        await act(async () => {
            resolvePause!({ ok: true, json: () => Promise.resolve({}) });
        });
    });

    it('clear queue button is disabled while loading', async () => {
        confirmSpy.mockReturnValue(true);
        let resolveDelete: (v: any) => void;
        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (typeof url === 'string' && url.endsWith('/queue') && opts?.method === 'DELETE') {
                return new Promise(resolve => { resolveDelete = resolve; });
            }
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({
                    queued: [{ id: 'q1', status: 'queued', prompt: 'a' }],
                    running: [], history: [],
                    stats: makeStats({ queued: 1 }),
                }),
            });
        });

        render(
            <Wrap stats={makeStats({ queued: 1 })}
                  queued={[{ id: 'q1', status: 'queued', prompt: 'a' }]}>
                <ProcessesSidebar />
            </Wrap>
        );

        const btn = screen.getByTestId('clear-queue-btn');
        expect(btn.hasAttribute('disabled')).toBe(false);

        act(() => {
            fireEvent.click(btn);
        });

        await waitFor(() => {
            expect(screen.getByTestId('clear-queue-btn').hasAttribute('disabled')).toBe(true);
        });

        // Resolve to clean up
        await act(async () => {
            resolveDelete!({ ok: true, json: () => Promise.resolve({}) });
        });
    });
});

// ── AI Title Tests ─────────────────────────────────────────────────────

describe('ProcessesSidebar — AI title display for legacy processes', () => {
    it('shows AI title instead of promptPreview when p.title is set', async () => {
        const process = {
            id: 'proc-1',
            status: 'completed',
            title: 'AI Generated Summary',
            promptPreview: 'raw prompt text',
        };
        render(
            <Wrap processes={[process]}>
                <ProcessesSidebar />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText('AI Generated Summary')).toBeDefined();
        });
        expect(screen.queryByText('raw prompt text')).toBeNull();
    });

    it('shows AI indicator ✦ when p.title is set', async () => {
        const process = {
            id: 'proc-2',
            status: 'completed',
            title: 'An AI Title',
            promptPreview: 'fallback',
        };
        render(
            <Wrap processes={[process]}>
                <ProcessesSidebar />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText('✦')).toBeDefined();
        });
    });

    it('shows promptPreview (no ✦) when p.title is absent', async () => {
        const process = {
            id: 'proc-3',
            status: 'completed',
            title: undefined,
            promptPreview: 'fallback preview text',
        };
        render(
            <Wrap processes={[process]}>
                <ProcessesSidebar />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText('fallback preview text')).toBeDefined();
        });
        expect(screen.queryByText('✦')).toBeNull();
    });

    it('truncates promptPreview at 80 chars when no title', async () => {
        const longPreview = 'x'.repeat(100);
        const process = {
            id: 'proc-4',
            status: 'completed',
            title: undefined,
            promptPreview: longPreview,
        };
        render(
            <Wrap processes={[process]}>
                <ProcessesSidebar />
            </Wrap>
        );
        await waitFor(() => {
            const truncated = screen.getByText('x'.repeat(80) + '…');
            expect(truncated).toBeDefined();
        });
    });
});
