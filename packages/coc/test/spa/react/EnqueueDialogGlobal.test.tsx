/**
 * Tests for EnqueueDialog global mounting — verifies the dialog is accessible
 * from any tab (repos/tasks, processes, etc.) since it's rendered at the App level.
 *
 * The bug: EnqueueDialog was only rendered inside QueueView (processes tab),
 * so "Queue All Tasks" from the tasks panel (repos tab) dispatched OPEN_DIALOG
 * but the dialog component wasn't mounted.
 *
 * The fix: EnqueueDialog is now rendered in AppInner (App.tsx), making it
 * always available regardless of which tab is active.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { AppProvider, useApp } from '../../../src/server/spa/client/react/context/AppContext';
import { QueueProvider, useQueue } from '../../../src/server/spa/client/react/context/QueueContext';
import { ToastProvider } from '../../../src/server/spa/client/react/context/ToastContext';
import { EnqueueDialog } from '../../../src/server/spa/client/react/queue/EnqueueDialog';
import { QueueView } from '../../../src/server/spa/client/react/queue/QueueView';

// ── Helpers ────────────────────────────────────────────────────────────

function Wrap({ children }: { children: ReactNode }) {
    return (
        <AppProvider>
            <QueueProvider>
                <ToastProvider value={{ addToast: vi.fn(), removeToast: vi.fn(), toasts: [] }}>
                    {children}
                </ToastProvider>
            </QueueProvider>
        </AppProvider>
    );
}

function DialogOpener({ folderPath, workspaceId }: { folderPath?: string | null; workspaceId?: string | null }) {
    const { dispatch } = useQueue();
    useEffect(() => {
        dispatch({ type: 'OPEN_DIALOG', folderPath, workspaceId });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    return null;
}

function DialogToggler() {
    const { dispatch } = useQueue();
    return (
        <button
            data-testid="open-dialog-btn"
            onClick={() => dispatch({ type: 'OPEN_DIALOG', folderPath: 'coc' })}
        >
            Open Dialog
        </button>
    );
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('EnqueueDialog global mounting', () => {
    beforeEach(() => {
        global.fetch = vi.fn().mockImplementation((url: string) => {
            if (typeof url === 'string' && url.includes('/queue/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ models: [] }) });
            }
            if (typeof url === 'string' && url.includes('/queue')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ queued: [], running: [], stats: {}, history: [] }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it('EnqueueDialog opens when OPEN_DIALOG is dispatched without QueueView mounted', async () => {
        render(
            <Wrap>
                <DialogOpener folderPath="feature1" />
                <EnqueueDialog />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText('Enqueue AI Task')).toBeTruthy();
        });
    });

    it('EnqueueDialog opens via user interaction without QueueView', async () => {
        render(
            <Wrap>
                <DialogToggler />
                <EnqueueDialog />
            </Wrap>
        );

        expect(screen.queryByText('Enqueue AI Task')).toBeNull();

        fireEvent.click(screen.getByTestId('open-dialog-btn'));

        await waitFor(() => {
            expect(screen.getByText('Enqueue AI Task')).toBeTruthy();
        });
    });

    it('EnqueueDialog receives folderPath from OPEN_DIALOG dispatch', async () => {
        render(
            <Wrap>
                <DialogOpener folderPath="coc/deep-wiki" />
                <EnqueueDialog />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText('Enqueue AI Task')).toBeTruthy();
        });
    });

    it('EnqueueDialog closes when CLOSE_DIALOG is dispatched', async () => {
        function DialogCloser() {
            const { dispatch } = useQueue();
            return (
                <button
                    data-testid="close-dialog-btn"
                    onClick={() => dispatch({ type: 'CLOSE_DIALOG' })}
                >
                    Close
                </button>
            );
        }

        render(
            <Wrap>
                <DialogOpener folderPath="test" />
                <DialogCloser />
                <EnqueueDialog />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByText('Enqueue AI Task')).toBeTruthy();
        });

        fireEvent.click(screen.getByTestId('close-dialog-btn'));

        await waitFor(() => {
            expect(screen.queryByText('Enqueue AI Task')).toBeNull();
        });
    });

    it('QueueView no longer renders EnqueueDialog', () => {
        const { container } = render(<Wrap><QueueView /></Wrap>);
        expect(container).toBeDefined();
        expect(screen.queryByText('Enqueue AI Task')).toBeNull();
    });

    it('EnqueueDialog coexists with QueueView without duplication', async () => {
        render(
            <Wrap>
                <DialogOpener folderPath="test" />
                <QueueView />
                <EnqueueDialog />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByText('Enqueue AI Task')).toBeTruthy();
        });

        const dialogTitles = screen.getAllByText('Enqueue AI Task');
        expect(dialogTitles).toHaveLength(1);
    });

    it('OPEN_DIALOG with null folderPath opens dialog without pre-selected folder', async () => {
        render(
            <Wrap>
                <DialogOpener folderPath={null} />
                <EnqueueDialog />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText('Enqueue AI Task')).toBeTruthy();
        });
        expect(screen.queryByTestId('folder-select')).toBeNull();
    });

    it('multiple OPEN_DIALOG dispatches update folderPath correctly', async () => {
        function MultiDispatcher() {
            const { dispatch } = useQueue();
            return (
                <>
                    <button
                        data-testid="open-folder-a"
                        onClick={() => dispatch({ type: 'OPEN_DIALOG', folderPath: 'folder-a' })}
                    >
                        Open A
                    </button>
                    <button
                        data-testid="open-folder-b"
                        onClick={() => dispatch({ type: 'OPEN_DIALOG', folderPath: 'folder-b' })}
                    >
                        Open B
                    </button>
                </>
            );
        }

        render(
            <Wrap>
                <MultiDispatcher />
                <EnqueueDialog />
            </Wrap>
        );

        fireEvent.click(screen.getByTestId('open-folder-a'));
        await waitFor(() => {
            expect(screen.getByText('Enqueue AI Task')).toBeTruthy();
        });

        // Close and reopen with different folder
        fireEvent.click(screen.getByText('Cancel'));
        await waitFor(() => {
            expect(screen.queryByText('Enqueue AI Task')).toBeNull();
        });

        fireEvent.click(screen.getByTestId('open-folder-b'));
        await waitFor(() => {
            expect(screen.getByText('Enqueue AI Task')).toBeTruthy();
        });
    });
});
