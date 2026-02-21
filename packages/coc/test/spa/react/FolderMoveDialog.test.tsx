/**
 * Tests for FolderMoveDialog component and Move Folder context menu wiring
 * in TasksPanel.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';
import { FolderMoveDialog, buildDestinations } from '../../../src/server/spa/client/react/tasks/FolderMoveDialog';
import type { DestinationOption } from '../../../src/server/spa/client/react/tasks/FolderMoveDialog';
import type { TaskFolder } from '../../../src/server/spa/client/react/hooks/useTaskTree';
import { AppProvider } from '../../../src/server/spa/client/react/context/AppContext';
import { QueueProvider } from '../../../src/server/spa/client/react/context/QueueContext';
import { ToastProvider } from '../../../src/server/spa/client/react/context/ToastContext';
import { TasksPanel } from '../../../src/server/spa/client/react/tasks/TasksPanel';

// ── Helpers ────────────────────────────────────────────────────────────

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
                        name: 'backlog',
                        relativePath: 'feature1/backlog',
                        children: [],
                        documentGroups: [],
                        singleDocuments: [],
                    },
                ],
                documentGroups: [],
                singleDocuments: [
                    { baseName: 'design', fileName: 'design.md', relativePath: 'feature1', isArchived: false, status: 'pending' },
                ],
            },
            {
                name: 'feature2',
                relativePath: 'feature2',
                children: [],
                documentGroups: [],
                singleDocuments: [],
            },
        ],
        documentGroups: [],
        singleDocuments: [],
    };
}

function setupFetch(tree?: TaskFolder) {
    const t = tree || makeTree();
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
        if (url.includes('/archive')) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        }
        if (url.includes('/move')) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        }
        if (opts?.method === 'PATCH' || opts?.method === 'DELETE') {
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        }
        if (opts?.method === 'POST' && url.includes('/tasks') && !url.includes('/archive')) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve(t) });
    });
}

// ── buildDestinations unit tests ──────────────────────────────────────

describe('buildDestinations', () => {
    const tree = makeTree();

    it('excludes the source folder and all its children', () => {
        const result = buildDestinations(tree, 'feature1');
        const paths = result.map(d => d.relativePath);
        expect(paths).not.toContain('feature1');
        expect(paths).not.toContain('feature1/backlog');
    });

    it('includes sibling folders and parent folders not in the source subtree', () => {
        const result = buildDestinations(tree, 'feature1');
        const paths = result.map(d => d.relativePath);
        expect(paths).toContain('feature2');
    });

    it('includes all folders when source is a leaf with no overlap', () => {
        const result = buildDestinations(tree, 'feature2');
        const paths = result.map(d => d.relativePath);
        expect(paths).toContain('feature1');
        expect(paths).toContain('feature1/backlog');
    });

    it('assigns depth correctly for nested items', () => {
        const result = buildDestinations(tree, 'feature2');
        const feature1 = result.find(d => d.relativePath === 'feature1');
        const backlog = result.find(d => d.relativePath === 'feature1/backlog');
        expect(feature1?.depth).toBe(0);
        expect(backlog?.depth).toBe(1);
    });

    it('does not include root itself (depth 0 skipped)', () => {
        const result = buildDestinations(tree, 'feature1');
        // root has relativePath '' — it should NOT appear because depth==0 is skipped
        const root = result.find(d => d.relativePath === '');
        expect(root).toBeUndefined();
    });

    it('returns empty list when source matches root', () => {
        // edge case: source is '' which matches root.relativePath
        const result = buildDestinations(tree, '');
        expect(result).toEqual([]);
    });
});

// ── FolderMoveDialog component tests ──────────────────────────────────

describe('FolderMoveDialog', () => {
    afterEach(() => cleanup());

    const tree = makeTree();
    const sourceFolder = tree.children[0]; // feature1

    it('renders with "Tasks Root" pre-selected when open', () => {
        render(
            <FolderMoveDialog
                open
                onClose={vi.fn()}
                sourceFolder={sourceFolder}
                tree={tree}
                onConfirm={vi.fn()}
            />
        );
        expect(screen.getByText('Move Folder')).toBeTruthy();
        expect(screen.getByTestId('move-dest-root')).toBeTruthy();
        // "Tasks Root" should be present
        expect(screen.getByText(/Tasks Root/)).toBeTruthy();
    });

    it('does not render when open is false', () => {
        render(
            <FolderMoveDialog
                open={false}
                onClose={vi.fn()}
                sourceFolder={sourceFolder}
                tree={tree}
                onConfirm={vi.fn()}
            />
        );
        expect(screen.queryByText('Move Folder')).toBeNull();
    });

    it('does not render when sourceFolder is null', () => {
        render(
            <FolderMoveDialog
                open
                onClose={vi.fn()}
                sourceFolder={null}
                tree={tree}
                onConfirm={vi.fn()}
            />
        );
        expect(screen.queryByText('Move Folder')).toBeNull();
    });

    it('excludes source folder and descendants from destination list', () => {
        render(
            <FolderMoveDialog
                open
                onClose={vi.fn()}
                sourceFolder={sourceFolder}
                tree={tree}
                onConfirm={vi.fn()}
            />
        );
        // feature1 and feature1/backlog should not appear
        expect(screen.queryByTestId('move-dest-feature1')).toBeNull();
        expect(screen.queryByTestId('move-dest-feature1/backlog')).toBeNull();
        // feature2 should appear
        expect(screen.getByTestId('move-dest-feature2')).toBeTruthy();
    });

    it('renders destination options with left padding proportional to depth', () => {
        const source = tree.children[1]; // feature2 — so feature1 and backlog are shown
        render(
            <FolderMoveDialog
                open
                onClose={vi.fn()}
                sourceFolder={source}
                tree={tree}
                onConfirm={vi.fn()}
            />
        );
        const feature1Btn = screen.getByTestId('move-dest-feature1');
        const backlogBtn = screen.getByTestId('move-dest-feature1/backlog');
        // depth=0 → 0.75rem base padding
        expect(feature1Btn.style.paddingLeft).toContain('0.75rem');
        // depth=1 → 0.75rem + 1rem = 1.75rem
        expect(backlogBtn.style.paddingLeft).toContain('1.75rem');
    });

    it('clicking a destination selects it; confirm calls onConfirm with relativePath', async () => {
        const onConfirm = vi.fn().mockResolvedValue(undefined);
        render(
            <FolderMoveDialog
                open
                onClose={vi.fn()}
                sourceFolder={sourceFolder}
                tree={tree}
                onConfirm={onConfirm}
            />
        );
        // Click feature2 to select it
        fireEvent.click(screen.getByTestId('move-dest-feature2'));
        // Click Move
        fireEvent.click(screen.getByText('Move'));

        await waitFor(() => {
            expect(onConfirm).toHaveBeenCalledWith('feature2');
        });
    });

    it('confirm with default selection calls onConfirm with empty string (Tasks Root)', async () => {
        const onConfirm = vi.fn().mockResolvedValue(undefined);
        render(
            <FolderMoveDialog
                open
                onClose={vi.fn()}
                sourceFolder={sourceFolder}
                tree={tree}
                onConfirm={onConfirm}
            />
        );
        fireEvent.click(screen.getByText('Move'));
        await waitFor(() => {
            expect(onConfirm).toHaveBeenCalledWith('');
        });
    });

    it('clicking Cancel calls onClose without calling onConfirm', () => {
        const onClose = vi.fn();
        const onConfirm = vi.fn();
        render(
            <FolderMoveDialog
                open
                onClose={onClose}
                sourceFolder={sourceFolder}
                tree={tree}
                onConfirm={onConfirm}
            />
        );
        fireEvent.click(screen.getByText('Cancel'));
        expect(onClose).toHaveBeenCalled();
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it('pressing Escape calls onClose without calling onConfirm', () => {
        const onClose = vi.fn();
        const onConfirm = vi.fn();
        render(
            <FolderMoveDialog
                open
                onClose={onClose}
                sourceFolder={sourceFolder}
                tree={tree}
                onConfirm={onConfirm}
            />
        );
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalled();
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it('displays inline error when onConfirm rejects', async () => {
        const onConfirm = vi.fn().mockRejectedValue(new Error('Server error'));
        render(
            <FolderMoveDialog
                open
                onClose={vi.fn()}
                sourceFolder={sourceFolder}
                tree={tree}
                onConfirm={onConfirm}
            />
        );
        fireEvent.click(screen.getByText('Move'));
        await waitFor(() => {
            expect(screen.getByTestId('move-error')).toBeTruthy();
            expect(screen.getByTestId('move-error').textContent).toBe('Server error');
        });
    });
});

// ── TasksPanel Move Folder integration tests ──────────────────────────

describe('TasksPanel Move Folder action', () => {
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

    it('"Move Folder" context menu item opens FolderMoveDialog with the correct sourceFolder', async () => {
        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-feature1')).toBeTruthy();
        });

        fireEvent.contextMenu(screen.getByTestId('task-tree-item-feature1'));
        fireEvent.click(screen.getByText('Move Folder'));

        // Context menu closes, dialog opens
        expect(screen.queryByTestId('context-menu')).toBeNull();
        expect(screen.getByTestId('move-destination-list')).toBeTruthy();
        // Source folder name displayed inside dialog description
        const dialogStrong = screen.getByTestId('move-destination-list')
            .closest('[class*="flex flex-col"]')!
            .querySelector('strong');
        expect(dialogStrong?.textContent).toBe('feature1');
    });

    it('on successful move confirm, dialog closes and tree refreshes', async () => {
        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-feature1')).toBeTruthy();
        });

        fireEvent.contextMenu(screen.getByTestId('task-tree-item-feature1'));
        fireEvent.click(screen.getByText('Move Folder'));

        // Select feature2 as destination
        fireEvent.click(screen.getByTestId('move-dest-feature2'));
        fireEvent.click(screen.getByText('Move'));

        await waitFor(() => {
            const moveCalls = fetchSpy.mock.calls.filter((call: any[]) =>
                call[0].includes('/move')
            );
            expect(moveCalls.length).toBeGreaterThan(0);
            const body = JSON.parse(moveCalls[0][1].body);
            expect(body.sourcePath).toBe('feature1');
            expect(body.destinationFolder).toBe('feature2');
        });

        // Dialog should close
        await waitFor(() => {
            expect(screen.queryByTestId('move-destination-list')).toBeNull();
        });
    });

    it('on move to Tasks Root, sends empty destinationFolder', async () => {
        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-feature1')).toBeTruthy();
        });

        fireEvent.contextMenu(screen.getByTestId('task-tree-item-feature1'));
        fireEvent.click(screen.getByText('Move Folder'));

        // Tasks Root is default
        fireEvent.click(screen.getByText('Move'));

        await waitFor(() => {
            const moveCalls = fetchSpy.mock.calls.filter((call: any[]) =>
                call[0].includes('/move')
            );
            expect(moveCalls.length).toBeGreaterThan(0);
            const body = JSON.parse(moveCalls[0][1].body);
            expect(body.sourcePath).toBe('feature1');
            expect(body.destinationFolder).toBe('');
        });
    });

    it('closing the move dialog does not trigger any API call', async () => {
        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-feature1')).toBeTruthy();
        });

        const callsBefore = fetchSpy.mock.calls.length;

        fireEvent.contextMenu(screen.getByTestId('task-tree-item-feature1'));
        fireEvent.click(screen.getByText('Move Folder'));
        expect(screen.getByTestId('move-destination-list')).toBeTruthy();

        fireEvent.click(screen.getByText('Cancel'));
        expect(screen.queryByTestId('move-destination-list')).toBeNull();

        // No move calls
        const moveCalls = fetchSpy.mock.calls.filter((call: any[]) =>
            call[0].includes('/move')
        );
        expect(moveCalls.length).toBe(0);
    });

    it('on move API error, inline error is displayed inside the dialog', async () => {
        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (url.includes('/move')) {
                return Promise.resolve({
                    ok: false,
                    status: 500,
                    text: () => Promise.resolve('Internal error'),
                });
            }
            if (url.includes('comment-counts')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve(makeTree()) });
        });

        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-feature1')).toBeTruthy();
        });

        fireEvent.contextMenu(screen.getByTestId('task-tree-item-feature1'));
        fireEvent.click(screen.getByText('Move Folder'));
        fireEvent.click(screen.getByText('Move'));

        await waitFor(() => {
            expect(screen.getByTestId('move-error')).toBeTruthy();
        });

        // Dialog remains open
        expect(screen.getByTestId('move-destination-list')).toBeTruthy();
    });
});
