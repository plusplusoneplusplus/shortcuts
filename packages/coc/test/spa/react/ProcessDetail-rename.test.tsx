/**
 * ProcessDetail — rename chat title tests.
 *
 * Tests the pencil rename button, "Add title" link, and status-gating
 * (rename only for completed/failed/cancelled).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { AppProvider, useApp } from '../../../src/server/spa/client/react/contexts/AppContext';
import { QueueProvider } from '../../../src/server/spa/client/react/contexts/QueueContext';
import { ProcessDetail } from '../../../src/server/spa/client/react/processes/ProcessDetail';

vi.mock('../../../src/server/spa/client/react/hooks/preferences/useDisplaySettings', () => ({
    useDisplaySettings: () => ({ showReportIntent: false }),
    invalidateDisplaySettings: vi.fn(),
}));

// Portal passthrough so Dialog/RenameDialog renders inline
vi.mock('react-dom', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-dom')>();
    return { ...actual, createPortal: (children: React.ReactNode) => children };
});

// Stub useBreakpoint used by Dialog
vi.mock('../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false }),
}));

function Wrap({ children }: { children: ReactNode }) {
    return <AppProvider><QueueProvider>{children}</QueueProvider></AppProvider>;
}

function SeededProcessDetail({ process }: { process: any }) {
    const { dispatch } = useApp();
    useEffect(() => {
        dispatch({ type: 'SET_PROCESSES', processes: [process] });
        dispatch({ type: 'SELECT_PROCESS', id: process.id });
    }, [dispatch, process]);
    return <ProcessDetail />;
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
    (global as any).EventSource = vi.fn().mockImplementation(() => ({
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        close: vi.fn(),
        onerror: null,
        onmessage: null,
    }));
    fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ process: null, turns: [] }),
    });
    global.fetch = fetchSpy;
});

afterEach(() => {
    vi.restoreAllMocks();
    delete (global as any).EventSource;
});

describe('ProcessDetail — rename functionality', () => {
    it('shows pencil rename button for completed process with title', async () => {
        const proc = {
            id: 'p-rename-1',
            status: 'completed',
            title: 'AI Summary',
            promptPreview: 'raw prompt',
        };
        await act(async () => {
            render(<Wrap><SeededProcessDetail process={proc} /></Wrap>);
        });
        const btn = screen.getByTitle('Rename chat');
        expect(btn).toBeTruthy();
        expect(btn.textContent).toContain('✏️');
    });

    it('shows pencil rename button for failed process', async () => {
        const proc = {
            id: 'p-rename-2',
            status: 'failed',
            title: 'Failed Task Title',
            promptPreview: 'raw prompt',
        };
        await act(async () => {
            render(<Wrap><SeededProcessDetail process={proc} /></Wrap>);
        });
        expect(screen.getByTitle('Rename chat')).toBeTruthy();
    });

    it('shows pencil rename button for cancelled process', async () => {
        const proc = {
            id: 'p-rename-3',
            status: 'cancelled',
            title: 'Cancelled Task',
            promptPreview: 'raw prompt',
        };
        await act(async () => {
            render(<Wrap><SeededProcessDetail process={proc} /></Wrap>);
        });
        expect(screen.getByTitle('Rename chat')).toBeTruthy();
    });

    it('does NOT show rename button for running process', async () => {
        const proc = {
            id: 'p-rename-4',
            status: 'running',
            title: 'Running Task',
            promptPreview: 'raw prompt',
        };
        await act(async () => {
            render(<Wrap><SeededProcessDetail process={proc} /></Wrap>);
        });
        expect(screen.queryByTitle('Rename chat')).toBeNull();
    });

    it('shows "Add title" button for completed process without title', async () => {
        const proc = {
            id: 'p-rename-5',
            status: 'completed',
            title: undefined,
            promptPreview: 'some prompt text',
        };
        await act(async () => {
            render(<Wrap><SeededProcessDetail process={proc} /></Wrap>);
        });
        expect(screen.getByTitle('Set a title for this chat')).toBeTruthy();
    });

    it('does NOT show "Add title" for running process without title', async () => {
        const proc = {
            id: 'p-rename-6',
            status: 'running',
            title: undefined,
            promptPreview: 'some prompt text',
        };
        await act(async () => {
            render(<Wrap><SeededProcessDetail process={proc} /></Wrap>);
        });
        expect(screen.queryByTitle('Set a title for this chat')).toBeNull();
    });

    it('opens RenameDialog when pencil button is clicked', async () => {
        const proc = {
            id: 'p-rename-7',
            status: 'completed',
            title: 'Old Title',
            promptPreview: 'raw prompt',
        };
        await act(async () => {
            render(<Wrap><SeededProcessDetail process={proc} /></Wrap>);
        });
        const pencil = screen.getByTitle('Rename chat');
        await act(async () => {
            fireEvent.click(pencil);
        });
        // RenameDialog should now be open with "Rename Chat" heading
        expect(screen.getByText('Rename Chat')).toBeTruthy();
        // Input should contain the current title
        const input = screen.getByPlaceholderText('Chat title') as HTMLInputElement;
        expect(input.value).toBe('Old Title');
    });

    it('hides AI title badge after successful rename', async () => {
        fetchSpy.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ process: { id: 'p-rename-8', title: 'New Title' }, turns: [] }),
        });
        const proc = {
            id: 'p-rename-8',
            status: 'completed',
            title: 'Old Title',
            promptPreview: 'raw prompt',
        };
        await act(async () => {
            render(<Wrap><SeededProcessDetail process={proc} /></Wrap>);
        });
        // Initially shows AI title badge
        expect(screen.getByText('✦ AI title')).toBeTruthy();

        // Open rename dialog
        await act(async () => {
            fireEvent.click(screen.getByTitle('Rename chat'));
        });
        // Type new title and confirm
        const input = screen.getByPlaceholderText('Chat title') as HTMLInputElement;
        await act(async () => {
            fireEvent.change(input, { target: { value: 'New Title' } });
        });
        await act(async () => {
            fireEvent.click(screen.getByText('Rename'));
        });

        // After rename, AI title badge should be gone
        await waitFor(() => {
            expect(screen.queryByText('✦ AI title')).toBeNull();
        });
    });
});
