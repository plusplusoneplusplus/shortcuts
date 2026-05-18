/**
 * Tests for ProcessesSidebar — pause/resume controls, paused badge, clear-queue button, and rename.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { AppProvider, useApp } from '../../../src/server/spa/client/react/contexts/AppContext';
import { QueueProvider, useQueue } from '../../../src/server/spa/client/react/contexts/QueueContext';
import { ProcessesSidebar } from '../../../src/server/spa/client/react/processes/ProcessesSidebar';
import { resetSpaCocClientForTests } from '../../../src/server/spa/client/react/api/cocClient';

// Portal passthrough so ContextMenu and RenameDialog render inline
vi.mock('react-dom', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-dom')>();
    return { ...actual, createPortal: (children: React.ReactNode) => children };
});

// ContextMenu — render items as flat buttons for easy querying
vi.mock('../../../src/server/spa/client/react/tasks/comments/ContextMenu', () => ({
    ContextMenu: ({ items, onClose }: any) => (
        <div data-testid="context-menu">
            {items.filter((i: any) => !i.separator).map((item: any, idx: number) => (
                <button key={idx} onClick={() => { item.onClick(); onClose(); }}>{item.icon} {item.label}</button>
            ))}
        </div>
    ),
}));

// Stub useBreakpoint used by Dialog
vi.mock('../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false }),
}));

// Mock useLongPress — captures callbacks for test assertions
let _longPressCallback: ((x: number, y: number) => void) | null = null;
let _longPressFired = false;
vi.mock('../../../src/server/spa/client/react/hooks/ui/useLongPress', () => ({
    useLongPress: (cb: (x: number, y: number) => void) => {
        _longPressCallback = cb;
        return {
            onTouchStart: vi.fn(),
            onTouchEnd: vi.fn(),
            onTouchMove: vi.fn(),
            didLongPress: () => {
                if (_longPressFired) { _longPressFired = false; return true; }
                return false;
            },
        };
    },
}));

// Stub workspace utils
vi.mock('../../../src/server/spa/client/react/utils/workspace', () => ({
    resolveWorkspaceName: (id: string) => id,
    getProcessWorkspaceId: () => undefined,
    getProcessWorkspaceName: () => undefined,
}));

// Stub config
vi.mock('../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => '',
    isRalphEnabled: () => false,
}));

// ── Helpers ────────────────────────────────────────────────────────────

function makeStats(overrides: Partial<{
    queued: number; running: number;
    total: number; isPaused: boolean; isDraining: boolean;
}> = {}) {
    return {
        queued: 0, running: 0,
        total: 0, isPaused: false, isDraining: false,
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
        dispatch({ type: 'QUEUE_UPDATED', queue: { queued, running, stats } });
        if (history.length > 0) {
            dispatch({ type: 'SET_HISTORY', history });
        }
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
    resetSpaCocClientForTests();
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

// ── Rename via context menu ────────────────────────────────────────────

describe('ProcessesSidebar — rename via context menu', () => {
    it('shows context menu with Rename on right-click for completed process', async () => {
        const process = {
            id: 'proc-rename-1',
            status: 'completed',
            title: 'My Title',
            promptPreview: 'prompt',
        };
        render(
            <Wrap processes={[process]}>
                <ProcessesSidebar />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText('My Title')).toBeDefined();
        });
        const card = screen.getByText('My Title').closest('.process-item') as HTMLElement;
        expect(card).toBeDefined();
        fireEvent.contextMenu(card!);
        await waitFor(() => {
            expect(screen.getByText(/Rename/)).toBeDefined();
        });
    });

    it('does NOT show context menu on right-click for running process', async () => {
        const process = {
            id: 'proc-rename-2',
            status: 'running',
            title: 'Running Task',
            promptPreview: 'prompt',
        };
        render(
            <Wrap processes={[process]}>
                <ProcessesSidebar />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText('Running Task')).toBeDefined();
        });
        const card = screen.getByText('Running Task').closest('.process-item') as HTMLElement;
        expect(card).toBeDefined();
        fireEvent.contextMenu(card!);
        expect(screen.queryByTestId('context-menu')).toBeNull();
    });

    it('shows context menu with Rename on right-click for failed process', async () => {
        const process = {
            id: 'proc-rename-3',
            status: 'failed',
            title: 'Failed Task',
            promptPreview: 'prompt',
        };
        render(
            <Wrap processes={[process]}>
                <ProcessesSidebar />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText('Failed Task')).toBeDefined();
        });
        const card = screen.getByText('Failed Task').closest('.process-item') as HTMLElement;
        expect(card).toBeDefined();
        fireEvent.contextMenu(card!);
        await waitFor(() => {
            expect(screen.getByText(/Rename/)).toBeDefined();
        });
    });

    it('clicking Rename opens the RenameDialog with the process title', async () => {
        const process = {
            id: 'proc-rename-4',
            status: 'completed',
            title: 'Existing Title',
            promptPreview: 'prompt',
        };
        render(
            <Wrap processes={[process]}>
                <ProcessesSidebar />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText('Existing Title')).toBeDefined();
        });
        const card = screen.getByText('Existing Title').closest('.process-item') as HTMLElement;
        fireEvent.contextMenu(card!);
        await waitFor(() => {
            expect(screen.getByText(/Rename/)).toBeDefined();
        });
        fireEvent.click(screen.getByText(/Rename/));
        await waitFor(() => {
            expect(screen.getByText('Rename Chat')).toBeDefined();
        });
    });

    it('calls PATCH API on rename confirm and dispatches PROCESS_UPDATED', async () => {
        fetchSpy.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({
                queued: [], running: [], history: [],
                stats: makeStats(),
                process: { id: 'proc-rename-5', title: 'New Name' },
            }),
        });
        const process = {
            id: 'proc-rename-5',
            status: 'completed',
            title: 'Old Name',
            promptPreview: 'prompt',
        };
        render(
            <Wrap processes={[process]}>
                <ProcessesSidebar />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText('Old Name')).toBeDefined();
        });
        const card = screen.getByText('Old Name').closest('.process-item') as HTMLElement;
        fireEvent.contextMenu(card!);
        await waitFor(() => expect(screen.getByText(/Rename/)).toBeDefined());
        fireEvent.click(screen.getByText(/Rename/));
        await waitFor(() => expect(screen.getByText('Rename Chat')).toBeDefined());

        const input = screen.getByPlaceholderText('Chat title') as HTMLInputElement;
        await act(async () => {
            fireEvent.change(input, { target: { value: 'New Name' } });
        });
        // Click the Rename button in the dialog (exact text, not the context menu item)
        await act(async () => {
            fireEvent.click(screen.getByText('Rename'));
        });

        await waitFor(() => {
            const patchCall = fetchSpy.mock.calls.find(
                (c: any[]) => typeof c[0] === 'string' && c[0].includes('/processes/proc-rename-5') && c[1]?.method === 'PATCH'
            );
            expect(patchCall).toBeDefined();
            const body = JSON.parse(patchCall![1].body);
            expect(body.title).toBe('New Name');
        });
    });
});

describe('ProcessesSidebar — long-press opens context menu', () => {
    beforeEach(() => {
        _longPressCallback = null;
        _longPressFired = false;
    });

    it('opens context menu after long-press on completed process card', async () => {
        const process = {
            id: 'proc-lp-1',
            status: 'completed',
            title: 'Completed Task',
            promptPreview: 'prompt',
        };
        render(
            <Wrap processes={[process]}>
                <ProcessesSidebar />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText('Completed Task')).toBeDefined();
        });
        const card = screen.getByText('Completed Task').closest('.process-item') as HTMLElement;

        expect(screen.queryByTestId('context-menu')).toBeNull();

        // touchStart triggers the React handler which sets processLongPressIdRef
        fireEvent.touchStart(card!);
        // Simulate the long-press callback firing (would normally fire after 500ms)
        act(() => { _longPressCallback?.(100, 200); });

        expect(screen.getByTestId('context-menu')).toBeDefined();
        expect(screen.getByText(/Rename/)).toBeDefined();
    });

    it('does NOT open context menu on long-press for running process', async () => {
        const process = {
            id: 'proc-lp-2',
            status: 'running',
            title: 'Running Task',
            promptPreview: 'prompt',
        };
        render(
            <Wrap processes={[process]}>
                <ProcessesSidebar />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText('Running Task')).toBeDefined();
        });
        const card = screen.getByText('Running Task').closest('.process-item') as HTMLElement;

        // touchStart sets the ref to 'proc-lp-2' (running)
        fireEvent.touchStart(card!);
        // Callback checks status and skips because it's 'running'
        act(() => { _longPressCallback?.(100, 200); });

        expect(screen.queryByTestId('context-menu')).toBeNull();
    });

    it('suppresses click navigation after long-press fires', async () => {
        const process = {
            id: 'proc-lp-4',
            status: 'completed',
            title: 'Click Suppress',
            promptPreview: 'prompt',
        };
        const originalHash = location.hash;
        render(
            <Wrap processes={[process]}>
                <ProcessesSidebar />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText('Click Suppress')).toBeDefined();
        });
        const card = screen.getByText('Click Suppress').closest('.process-item') as HTMLElement;

        // Simulate that long-press has fired
        _longPressFired = true;

        // Click should be suppressed (didLongPress returns true)
        act(() => { fireEvent.click(card!); });

        // Hash should NOT have changed
        expect(location.hash).toBe(originalHash);
    });
});
