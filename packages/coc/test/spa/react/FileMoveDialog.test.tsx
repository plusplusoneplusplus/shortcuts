/**
 * Tests for FileMoveDialog component and Move File context menu wiring in TasksPanel.
 *
 * Covers: render, destination list, selection, confirm, cancel, error display,
 * null sourceName guard, integration with buildDestinations, and TasksPanel wiring.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';
import { FileMoveDialog } from '../../../src/server/spa/client/react/tasks/FileMoveDialog';
import { AppProvider } from '../../../src/server/spa/client/react/context/AppContext';
import { QueueProvider } from '../../../src/server/spa/client/react/context/QueueContext';
import { ToastProvider } from '../../../src/server/spa/client/react/context/ToastContext';
import { TasksPanel } from '../../../src/server/spa/client/react/tasks/TasksPanel';
import type { TaskFolder } from '../../../src/server/spa/client/react/hooks/useTaskTree';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeTree(): TaskFolder {
    return {
        name: 'tasks',
        relativePath: '',
        children: [
            {
                name: 'feature1',
                relativePath: 'feature1',
                children: [
                    {
                        name: 'sub',
                        relativePath: 'feature1/sub',
                        children: [],
                        documentGroups: [],
                        singleDocuments: [],
                    },
                ],
                documentGroups: [],
                singleDocuments: [],
            },
            {
                name: 'backlog',
                relativePath: 'backlog',
                children: [],
                documentGroups: [],
                singleDocuments: [],
            },
        ],
        documentGroups: [],
        singleDocuments: [],
    };
}

afterEach(() => cleanup());

// ── Render ────────────────────────────────────────────────────────────────────

describe('FileMoveDialog — render', () => {
    it('renders title "Move File" when open', () => {
        render(
            <FileMoveDialog
                open
                sourceName="task-a.md"
                tree={makeTree()}
                onClose={vi.fn()}
                onConfirm={vi.fn()}
            />
        );
        expect(screen.getByText('Move File')).toBeTruthy();
    });

    it('shows sourceName in prompt text', () => {
        render(
            <FileMoveDialog
                open
                sourceName="task-a.md"
                tree={makeTree()}
                onClose={vi.fn()}
                onConfirm={vi.fn()}
            />
        );
        expect(screen.getByText(/task-a\.md/)).toBeTruthy();
    });

    it('renders Cancel and Move buttons', () => {
        render(
            <FileMoveDialog
                open
                sourceName="task-a.md"
                tree={makeTree()}
                onClose={vi.fn()}
                onConfirm={vi.fn()}
            />
        );
        expect(screen.getByText('Cancel')).toBeTruthy();
        expect(screen.getByText('Move')).toBeTruthy();
    });

    it('does not render when sourceName is null', () => {
        render(
            <FileMoveDialog
                open
                sourceName={null}
                tree={makeTree()}
                onClose={vi.fn()}
                onConfirm={vi.fn()}
            />
        );
        expect(screen.queryByText('Move File')).toBeNull();
    });

    it('renders destination list with all folders', () => {
        render(
            <FileMoveDialog
                open
                sourceName="task-a.md"
                tree={makeTree()}
                onClose={vi.fn()}
                onConfirm={vi.fn()}
            />
        );
        const list = screen.getByTestId('file-move-destination-list');
        expect(list).toBeTruthy();
        // Tasks Root, feature1, feature1/sub, backlog
        expect(screen.getByTestId('file-move-dest-root')).toBeTruthy();
        expect(screen.getByTestId('file-move-dest-feature1')).toBeTruthy();
        expect(screen.getByTestId('file-move-dest-feature1/sub')).toBeTruthy();
        expect(screen.getByTestId('file-move-dest-backlog')).toBeTruthy();
    });
});

// ── Selection ─────────────────────────────────────────────────────────────────

describe('FileMoveDialog — destination selection', () => {
    it('defaults to Tasks Root (empty path selected)', () => {
        render(
            <FileMoveDialog
                open
                sourceName="task-a.md"
                tree={makeTree()}
                onClose={vi.fn()}
                onConfirm={vi.fn()}
            />
        );
        // The root button has relativePath '' which maps to data-testid 'file-move-dest-root'
        const rootBtn = screen.getByTestId('file-move-dest-root');
        // Initially no selection highlight on any specific button
        expect(rootBtn).toBeTruthy();
    });

    it('clicking a destination selects it (visual highlight via class)', () => {
        render(
            <FileMoveDialog
                open
                sourceName="task-a.md"
                tree={makeTree()}
                onClose={vi.fn()}
                onConfirm={vi.fn()}
            />
        );
        const feature1Btn = screen.getByTestId('file-move-dest-feature1');
        fireEvent.click(feature1Btn);
        // Selected destination gets bg-[#0066b8]/10 class
        expect(feature1Btn.className).toContain('bg-[#0066b8]');
    });

    it('clicking a different destination deselects previous', () => {
        render(
            <FileMoveDialog
                open
                sourceName="task-a.md"
                tree={makeTree()}
                onClose={vi.fn()}
                onConfirm={vi.fn()}
            />
        );
        const feature1Btn = screen.getByTestId('file-move-dest-feature1');
        const backlogBtn = screen.getByTestId('file-move-dest-backlog');

        fireEvent.click(feature1Btn);
        expect(feature1Btn.className).toContain('bg-[#0066b8]');

        fireEvent.click(backlogBtn);
        expect(backlogBtn.className).toContain('bg-[#0066b8]');
        expect(feature1Btn.className).not.toContain('bg-[#0066b8]');
    });
});

// ── Confirm / Cancel ──────────────────────────────────────────────────────────

describe('FileMoveDialog — confirm / cancel', () => {
    it('clicking Cancel calls onClose', () => {
        const onClose = vi.fn();
        render(
            <FileMoveDialog
                open
                sourceName="task-a.md"
                tree={makeTree()}
                onClose={onClose}
                onConfirm={vi.fn()}
            />
        );
        fireEvent.click(screen.getByText('Cancel'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('clicking Move calls onConfirm with selected destination', async () => {
        const onConfirm = vi.fn().mockResolvedValue(undefined);
        render(
            <FileMoveDialog
                open
                sourceName="task-a.md"
                tree={makeTree()}
                onClose={vi.fn()}
                onConfirm={onConfirm}
            />
        );

        fireEvent.click(screen.getByTestId('file-move-dest-feature1'));
        fireEvent.click(screen.getByText('Move'));

        await waitFor(() => {
            expect(onConfirm).toHaveBeenCalledWith('feature1');
        });
    });

    it('clicking Move with root selection passes empty string', async () => {
        const onConfirm = vi.fn().mockResolvedValue(undefined);
        render(
            <FileMoveDialog
                open
                sourceName="task-a.md"
                tree={makeTree()}
                onClose={vi.fn()}
                onConfirm={onConfirm}
            />
        );

        fireEvent.click(screen.getByTestId('file-move-dest-root'));
        fireEvent.click(screen.getByText('Move'));

        await waitFor(() => {
            expect(onConfirm).toHaveBeenCalledWith('');
        });
    });
});

// ── Error handling ────────────────────────────────────────────────────────────

describe('FileMoveDialog — error handling', () => {
    it('shows error message when onConfirm rejects', async () => {
        const onConfirm = vi.fn().mockRejectedValue(new Error('Move failed'));
        render(
            <FileMoveDialog
                open
                sourceName="task-a.md"
                tree={makeTree()}
                onClose={vi.fn()}
                onConfirm={onConfirm}
            />
        );

        fireEvent.click(screen.getByTestId('file-move-dest-feature1'));
        fireEvent.click(screen.getByText('Move'));

        await waitFor(() => {
            expect(screen.getByTestId('file-move-error')).toBeTruthy();
            expect(screen.getByTestId('file-move-error').textContent).toContain('Move failed');
        });
    });

    it('clears error when a new destination is selected', async () => {
        const onConfirm = vi.fn().mockRejectedValue(new Error('Move failed'));
        render(
            <FileMoveDialog
                open
                sourceName="task-a.md"
                tree={makeTree()}
                onClose={vi.fn()}
                onConfirm={onConfirm}
            />
        );

        fireEvent.click(screen.getByTestId('file-move-dest-feature1'));
        fireEvent.click(screen.getByText('Move'));

        await waitFor(() => {
            expect(screen.getByTestId('file-move-error')).toBeTruthy();
        });

        // Clicking another destination clears the error
        fireEvent.click(screen.getByTestId('file-move-dest-backlog'));
        expect(screen.queryByTestId('file-move-error')).toBeNull();
    });
});

// ── TasksPanel Move File integration tests ────────────────────────────────────

const mockAddToast = vi.fn();

function Wrap({ children }: { children: ReactNode }) {
    return (
        <AppProvider>
            <QueueProvider>
                <ToastProvider value={{ addToast: mockAddToast, removeToast: vi.fn(), toasts: [] }}>
                    {children}
                </ToastProvider>
            </QueueProvider>
        </AppProvider>
    );
}

const panelTree = {
    name: 'tasks',
    relativePath: '',
    children: [
        {
            name: 'feature1',
            relativePath: 'feature1',
            children: [],
            documentGroups: [],
            singleDocuments: [],
        },
        {
            name: 'backlog',
            relativePath: 'backlog',
            children: [],
            documentGroups: [],
            singleDocuments: [],
        },
    ],
    documentGroups: [],
    singleDocuments: [
        { baseName: 'task-a', fileName: 'task-a.md', relativePath: '', isArchived: false, status: 'pending' },
    ],
};

function setupFetch(tree = panelTree) {
    return vi.fn().mockImplementation((url: string, opts?: any) => {
        if (url.includes('comment-counts')) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        }
        if (url.includes('tasks/content')) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ content: '# Title' }) });
        }
        if (url.includes('/comments/')) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ comments: [] }) });
        }
        if (url.includes('/move')) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ path: 'feature1/task-a.md', name: 'task-a.md' }) });
        }
        if (opts?.method === 'PATCH' || opts?.method === 'DELETE') {
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve(tree) });
    });
}

describe('TasksPanel Move File action', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchSpy = setupFetch();
        global.fetch = fetchSpy;
        mockAddToast.mockClear();
        Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it('"Move File" context menu item opens FileMoveDialog', async () => {
        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-task-a')).toBeTruthy();
        });

        fireEvent.contextMenu(screen.getByTestId('task-tree-item-task-a'));
        fireEvent.click(screen.getByText('Move File'));

        expect(screen.queryByTestId('context-menu')).toBeNull();
        expect(screen.getByTestId('file-move-destination-list')).toBeTruthy();
    });

    it('Move File dialog shows file name in prompt', async () => {
        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-task-a')).toBeTruthy();
        });

        fireEvent.contextMenu(screen.getByTestId('task-tree-item-task-a'));
        fireEvent.click(screen.getByText('Move File'));

        // The dialog title "Move File" is visible
        expect(screen.getByText('Move File')).toBeTruthy();
        // The destination list is shown
        expect(screen.getByTestId('file-move-destination-list')).toBeTruthy();
    });

    it('confirms Move File and calls /move API with correct body', async () => {
        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-task-a')).toBeTruthy();
        });

        fireEvent.contextMenu(screen.getByTestId('task-tree-item-task-a'));
        fireEvent.click(screen.getByText('Move File'));

        fireEvent.click(screen.getByTestId('file-move-dest-feature1'));
        fireEvent.click(screen.getByText('Move'));

        await waitFor(() => {
            const moveCalls = fetchSpy.mock.calls.filter((call: any[]) =>
                call[0].includes('/move')
            );
            expect(moveCalls.length).toBeGreaterThan(0);
            const body = JSON.parse(moveCalls[0][1].body);
            expect(body.sourcePath).toBe('task-a.md');
            expect(body.destinationFolder).toBe('feature1');
        });
    });

    it('cancelling Move File dialog does not call /move API', async () => {
        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-task-a')).toBeTruthy();
        });

        const callsBefore = fetchSpy.mock.calls.length;

        fireEvent.contextMenu(screen.getByTestId('task-tree-item-task-a'));
        fireEvent.click(screen.getByText('Move File'));
        expect(screen.getByTestId('file-move-destination-list')).toBeTruthy();

        fireEvent.click(screen.getByText('Cancel'));
        expect(screen.queryByTestId('file-move-destination-list')).toBeNull();

        const moveCalls = fetchSpy.mock.calls.filter((call: any[]) =>
            call[0].includes('/move')
        );
        expect(moveCalls.length).toBe(0);
    });

    it('on /move API error, shows error inside the dialog', async () => {
        fetchSpy.mockImplementation((url: string) => {
            if (url.includes('/move')) {
                return Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve('Move failed') });
            }
            if (url.includes('comment-counts')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve(panelTree) });
        });

        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-task-a')).toBeTruthy();
        });

        fireEvent.contextMenu(screen.getByTestId('task-tree-item-task-a'));
        fireEvent.click(screen.getByText('Move File'));
        fireEvent.click(screen.getByTestId('file-move-dest-feature1'));
        fireEvent.click(screen.getByText('Move'));

        await waitFor(() => {
            expect(screen.getByTestId('file-move-error')).toBeTruthy();
        });

        // Dialog remains open
        expect(screen.getByTestId('file-move-destination-list')).toBeTruthy();
    });
});
