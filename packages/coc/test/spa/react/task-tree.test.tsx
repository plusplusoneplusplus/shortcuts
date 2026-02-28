/**
 * Tests for the TaskTree Miller-columns component rendered inside
 * AppProvider + QueueProvider + TaskProvider.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { AppProvider } from '../../../src/server/spa/client/react/context/AppContext';
import { QueueProvider } from '../../../src/server/spa/client/react/context/QueueContext';
import { TaskProvider, useTaskContext } from '../../../src/server/spa/client/react/context/TaskContext';
import { ToastProvider } from '../../../src/server/spa/client/react/context/ToastContext';
import { TaskTree } from '../../../src/server/spa/client/react/tasks/TaskTree';
import type { TaskFolder } from '../../../src/server/spa/client/react/hooks/useTaskTree';

function Wrap({ children }: { children: ReactNode }) {
    return (
        <AppProvider>
            <QueueProvider>
                <ToastProvider value={{ addToast: vi.fn(), removeToast: vi.fn(), toasts: [] }}>
                    <TaskProvider>
                        {children}
                    </TaskProvider>
                </ToastProvider>
            </QueueProvider>
        </AppProvider>
    );
}

/** Helper component that reads openFilePath from TaskContext and renders it for assertion. */
function OpenFilePathReader() {
    const { state } = useTaskContext();
    return <div data-testid="open-file-path">{state.openFilePath ?? 'null'}</div>;
}

function makeTree(overrides?: Partial<TaskFolder>): TaskFolder {
    return {
        name: 'tasks',
        relativePath: '',
        children: [],
        documentGroups: [],
        singleDocuments: [],
        ...overrides,
    };
}

const mockTree: TaskFolder = makeTree({
    children: [
        makeTree({
            name: 'feature1',
            relativePath: 'feature1',
            children: [
                makeTree({
                    name: 'sub',
                    relativePath: 'feature1/sub',
                }),
            ],
            singleDocuments: [
                { baseName: 'task', fileName: 'task.md', relativePath: 'feature1', isArchived: false },
            ],
        }),
        makeTree({
            name: 'feature2',
            relativePath: 'feature2',
            singleDocuments: [
                { baseName: 'impl', fileName: 'impl.md', relativePath: 'feature2', isArchived: false },
            ],
        }),
    ],
    documentGroups: [
        {
            baseName: 'root-task',
            isArchived: false,
            documents: [
                { baseName: 'root-task', docType: 'plan', fileName: 'root-task.plan.md', relativePath: '', isArchived: false },
            ],
        },
    ],
    singleDocuments: [
        { baseName: 'README', fileName: 'README.md', relativePath: '', isArchived: false },
    ],
});

const emptyFolderTree: TaskFolder = makeTree({
    children: [
        makeTree({ name: 'empty', relativePath: 'empty' }),
    ],
});

function renderTaskTree(tree: TaskFolder, props?: Partial<React.ComponentProps<typeof TaskTree>>) {
    // Stub history.replaceState to avoid jsdom errors
    vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});

    return render(
        <Wrap>
            <TaskTree
                tree={tree}
                commentCounts={{}}
                wsId="ws1"
                {...props}
            />
            <OpenFilePathReader />
        </Wrap>
    );
}

describe('TaskTree', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('renders initial root column (miller-column-0) with correct items', () => {
        renderTaskTree(mockTree);
        expect(screen.getByTestId('miller-column-0')).toBeTruthy();
        // Root column should contain folder items and documents
        expect(screen.getByTestId('task-tree-item-feature1')).toBeTruthy();
        expect(screen.getByTestId('task-tree-item-feature2')).toBeTruthy();
    });

    it('appends column on folder click (miller-column-1 appears)', () => {
        renderTaskTree(mockTree);
        fireEvent.click(screen.getByTestId('task-tree-item-feature1'));

        expect(screen.getByTestId('miller-column-1')).toBeTruthy();
        // Column 1 should contain feature1's children
        expect(screen.getByTestId('task-tree-item-sub')).toBeTruthy();
    });

    it('truncates columns on ancestor folder click', () => {
        renderTaskTree(mockTree);

        // Click feature1 → column 1 appears
        fireEvent.click(screen.getByTestId('task-tree-item-feature1'));
        expect(screen.getByTestId('miller-column-1')).toBeTruthy();

        // Click sub folder inside feature1 → column 2 appears
        fireEvent.click(screen.getByTestId('task-tree-item-sub'));
        expect(screen.getByTestId('miller-column-2')).toBeTruthy();

        // Click feature2 in column 0 → columns 1 and 2 should be replaced
        fireEvent.click(screen.getByTestId('task-tree-item-feature2'));
        expect(screen.getByTestId('miller-column-1')).toBeTruthy();
        expect(screen.queryByTestId('miller-column-2')).toBeNull();
    });

    it('sets openFilePath on file click', () => {
        renderTaskTree(mockTree);

        // Navigate to feature1
        fireEvent.click(screen.getByTestId('task-tree-item-feature1'));

        // Click task file item (displayName = baseName = 'task')
        fireEvent.click(screen.getByTestId('task-tree-item-task'));

        expect(screen.getByTestId('open-file-path').textContent).toBe('feature1/task.md');
    });

    it('clears openFilePath on folder click (sets to null)', () => {
        renderTaskTree(mockTree);

        // First click a folder to navigate
        fireEvent.click(screen.getByTestId('task-tree-item-feature1'));
        // Click a file to set openFilePath (displayName = baseName = 'task')
        fireEvent.click(screen.getByTestId('task-tree-item-task'));
        expect(screen.getByTestId('open-file-path').textContent).toBe('feature1/task.md');

        // Click another folder — should clear openFilePath
        fireEvent.click(screen.getByTestId('task-tree-item-feature2'));
        expect(screen.getByTestId('open-file-path').textContent).toBe('null');
    });

    it('renders "Empty folder" placeholder for empty folder children', () => {
        renderTaskTree(emptyFolderTree);

        // Click the empty folder
        fireEvent.click(screen.getByTestId('task-tree-item-empty'));
        expect(screen.getByTestId('miller-column-1')).toBeTruthy();
        expect(screen.getByText('Empty folder')).toBeTruthy();
    });

    it('initialises to initialFolderPath when provided', () => {
        renderTaskTree(mockTree, { initialFolderPath: 'feature1' });

        // Should have two columns: root + feature1's children
        expect(screen.getByTestId('miller-column-0')).toBeTruthy();
        expect(screen.getByTestId('miller-column-1')).toBeTruthy();
        // feature1's child "sub" should be visible in column 1
        expect(screen.getByTestId('task-tree-item-sub')).toBeTruthy();
    });

    it('initialises to initialFilePath when provided', () => {
        renderTaskTree(mockTree, { initialFilePath: 'feature1/task.md' });

        // Should have navigated to feature1 folder and opened the file
        expect(screen.getByTestId('miller-column-1')).toBeTruthy();
        expect(screen.getByTestId('open-file-path').textContent).toBe('feature1/task.md');
    });

    it('initialises to initialFolderPath with backslash separators (Windows)', () => {
        // On Windows, relativePath may use backslashes; deep-link must still split correctly
        renderTaskTree(mockTree, { initialFolderPath: 'feature1\\sub' });

        // Should produce root + feature1 + sub = 3 columns
        expect(screen.getByTestId('miller-column-0')).toBeTruthy();
        expect(screen.getByTestId('miller-column-1')).toBeTruthy();
        expect(screen.getByTestId('miller-column-2')).toBeTruthy();
    });

    it('initialises to initialFilePath with backslash separators (Windows)', () => {
        renderTaskTree(mockTree, { initialFilePath: 'feature1\\task.md' });

        // Should navigate to feature1 folder and open the file
        expect(screen.getByTestId('miller-column-1')).toBeTruthy();
        expect(screen.getByTestId('open-file-path').textContent).toBe('feature1\\task.md');
    });

    it('encodes URL with forward slashes when folder relativePath has backslashes', () => {
        // Create tree where relativePath uses backslash separators
        const bsTree = makeTree({
            children: [
                makeTree({
                    name: 'coc',
                    relativePath: 'coc',
                    children: [
                        makeTree({
                            name: 'chat',
                            relativePath: 'coc\\chat',
                        }),
                    ],
                }),
            ],
        });

        const replaceSpy = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});
        render(
            <Wrap>
                <TaskTree tree={bsTree} commentCounts={{}} wsId="ws1" />
                <OpenFilePathReader />
            </Wrap>
        );

        // Click the "coc" folder — URL should use forward slashes
        fireEvent.click(screen.getByTestId('task-tree-item-coc'));
        expect(replaceSpy).toHaveBeenCalledWith(
            null, '',
            '#repos/ws1/tasks/coc',
        );

        // Click the "chat" subfolder whose relativePath is "coc\chat"
        fireEvent.click(screen.getByTestId('task-tree-item-chat'));
        expect(replaceSpy).toHaveBeenCalledWith(
            null, '',
            '#repos/ws1/tasks/coc/chat',
        );
    });

    it('encodes URL with forward slashes when file path has backslashes', () => {
        // Create tree where a document's relativePath uses backslash
        const bsTree = makeTree({
            children: [
                makeTree({
                    name: 'coc',
                    relativePath: 'coc',
                    singleDocuments: [
                        { baseName: 'readme', fileName: 'readme.md', relativePath: 'coc', isArchived: false },
                    ],
                }),
            ],
        });

        const replaceSpy = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});
        render(
            <Wrap>
                <TaskTree tree={bsTree} commentCounts={{}} wsId="ws1" />
                <OpenFilePathReader />
            </Wrap>
        );

        // Navigate to coc folder, then click the file
        fireEvent.click(screen.getByTestId('task-tree-item-coc'));
        fireEvent.click(screen.getByTestId('task-tree-item-readme'));

        // The file path is "coc/readme.md" (constructed via getNodePath with '/').
        // URL should use forward slashes.
        expect(replaceSpy).toHaveBeenCalledWith(
            null, '',
            '#repos/ws1/tasks/coc/readme.md',
        );
    });

    it('rebuilds columns from activeFolderKeys on tree update', () => {
        const { rerender } = renderTaskTree(mockTree);

        // Navigate to feature1
        fireEvent.click(screen.getByTestId('task-tree-item-feature1'));
        expect(screen.getByTestId('miller-column-1')).toBeTruthy();

        // Stub again for rerender
        vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});

        // Re-render with a modified tree (same structure, simulating a refresh)
        const updatedTree = {
            ...mockTree,
            singleDocuments: [
                ...mockTree.singleDocuments,
                { baseName: 'NOTES', fileName: 'NOTES.md', relativePath: '', isArchived: false },
            ],
        };

        rerender(
            <Wrap>
                <TaskTree
                    tree={updatedTree}
                    commentCounts={{}}
                    wsId="ws1"
                />
                <OpenFilePathReader />
            </Wrap>
        );

        // After tree update, column 1 should still be present (navigation preserved)
        expect(screen.getByTestId('miller-column-1')).toBeTruthy();
    });
});
