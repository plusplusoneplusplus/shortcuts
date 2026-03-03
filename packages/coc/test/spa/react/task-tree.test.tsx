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
import { TaskTree, getFolderKey } from '../../../src/server/spa/client/react/tasks/TaskTree';
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

        // Click feature1 → column 1 appears; 2 total → both visible (cols 0 and 1)
        fireEvent.click(screen.getByTestId('task-tree-item-feature1'));
        expect(screen.getByTestId('miller-column-0')).toBeTruthy();
        expect(screen.getByTestId('miller-column-1')).toBeTruthy();

        // Click sub folder inside feature1 → column 2 appears; 3 total → sliding window shows cols 1 and 2 only
        fireEvent.click(screen.getByTestId('task-tree-item-sub'));
        expect(screen.getByTestId('miller-column-1')).toBeTruthy();
        expect(screen.getByTestId('miller-column-2')).toBeTruthy();
        // Column 0 is hidden by the sliding window
        expect(screen.queryByTestId('miller-column-0')).toBeNull();
        // Overflow indicator appears
        expect(screen.getByTestId('column-overflow-indicator')).toBeTruthy();

        // Click the file in col 1 → columns truncate to [col0, col1]; sliding window shows both
        fireEvent.click(screen.getByTestId('task-tree-item-task'));
        expect(screen.getByTestId('miller-column-0')).toBeTruthy();
        expect(screen.getByTestId('miller-column-1')).toBeTruthy();
        expect(screen.queryByTestId('miller-column-2')).toBeNull();
        expect(screen.queryByTestId('column-overflow-indicator')).toBeNull();
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

        // Should produce root + feature1 + sub = 3 columns total, but sliding window shows only last 2
        expect(screen.getByTestId('miller-column-1')).toBeTruthy();
        expect(screen.getByTestId('miller-column-2')).toBeTruthy();
        // Column 0 is hidden by the sliding window
        expect(screen.queryByTestId('miller-column-0')).toBeNull();
        expect(screen.getByTestId('column-overflow-indicator')).toBeTruthy();
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

    it('getNodePath normalizes backslashes in relativePath', () => {
        // When the server sends backslash-separated relativePaths (Windows),
        // file paths constructed by getNodePath should use forward slashes
        // to match the keys built by useQueueActivity.
        const bsTree = makeTree({
            children: [
                makeTree({
                    name: 'coc',
                    relativePath: 'coc',
                    children: [
                        makeTree({
                            name: 'chat',
                            relativePath: 'coc\\chat',
                            singleDocuments: [
                                { baseName: 'render', fileName: 'render.md', relativePath: 'coc\\chat', isArchived: false },
                            ],
                        }),
                    ],
                }),
            ],
        });

        vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});
        render(
            <Wrap>
                <TaskTree tree={bsTree} commentCounts={{}} wsId="ws1" />
                <OpenFilePathReader />
            </Wrap>
        );

        // Navigate into coc → chat
        fireEvent.click(screen.getByTestId('task-tree-item-coc'));
        fireEvent.click(screen.getByTestId('task-tree-item-chat'));
        // Click the file — its path should use forward slashes
        fireEvent.click(screen.getByTestId('task-tree-item-render'));
        expect(screen.getByTestId('open-file-path').textContent).toBe('coc/chat/render.md');
    });

    it('getFolderKey normalizes backslashes', () => {
        const folder = makeTree({ name: 'chat', relativePath: 'coc\\chat' });
        expect(getFolderKey(folder)).toBe('coc/chat');
    });

    it('getFolderKey falls back to name when relativePath is empty', () => {
        const folder = makeTree({ name: 'tasks', relativePath: '' });
        expect(getFolderKey(folder)).toBe('tasks');
    });

    it('navigates to file path when navigateToFilePath is set', () => {
        const onNavigated = vi.fn();
        vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});

        render(
            <Wrap>
                <TaskTree
                    tree={mockTree}
                    commentCounts={{}}
                    wsId="ws1"
                    navigateToFilePath="feature1/task.md"
                    onNavigated={onNavigated}
                />
                <OpenFilePathReader />
            </Wrap>
        );

        // Should navigate to the file and expand its parent folder
        expect(screen.getByTestId('miller-column-1')).toBeTruthy();
        expect(screen.getByTestId('open-file-path').textContent).toBe('feature1/task.md');
        expect(onNavigated).toHaveBeenCalledTimes(1);
    });

    it('navigates to root-level file when navigateToFilePath has no folder', () => {
        const onNavigated = vi.fn();
        vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});

        render(
            <Wrap>
                <TaskTree
                    tree={mockTree}
                    commentCounts={{}}
                    wsId="ws1"
                    navigateToFilePath="README.md"
                    onNavigated={onNavigated}
                />
                <OpenFilePathReader />
            </Wrap>
        );

        // Only root column, file opened
        expect(screen.getByTestId('miller-column-0')).toBeTruthy();
        expect(screen.queryByTestId('miller-column-1')).toBeNull();
        expect(screen.getByTestId('open-file-path').textContent).toBe('README.md');
        expect(onNavigated).toHaveBeenCalledTimes(1);
    });

    it('updates URL hash when navigateToFilePath is used', () => {
        const replaceSpy = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});

        render(
            <Wrap>
                <TaskTree
                    tree={mockTree}
                    commentCounts={{}}
                    wsId="ws1"
                    navigateToFilePath="feature1/task.md"
                    onNavigated={vi.fn()}
                />
                <OpenFilePathReader />
            </Wrap>
        );

        expect(replaceSpy).toHaveBeenCalledWith(
            null, '',
            '#repos/ws1/tasks/feature1/task.md',
        );
    });

    it('double-clicking a file dispatches coc-open-markdown-review with relative path and wsId', () => {
        const events: CustomEvent[] = [];
        const listener = (e: Event) => events.push(e as CustomEvent);
        window.addEventListener('coc-open-markdown-review', listener);

        renderTaskTree(mockTree);

        // Navigate into feature1 to expose task.md
        fireEvent.click(screen.getByTestId('task-tree-item-feature1'));
        fireEvent.dblClick(screen.getByTestId('task-tree-item-task'));

        window.removeEventListener('coc-open-markdown-review', listener);

        expect(events).toHaveLength(1);
        expect(events[0].detail.filePath).toBe('feature1/task.md');
        expect(events[0].detail.wsId).toBe('ws1');
    });

    it('double-clicking a folder does NOT dispatch coc-open-markdown-review', () => {
        const events: CustomEvent[] = [];
        const listener = (e: Event) => events.push(e as CustomEvent);
        window.addEventListener('coc-open-markdown-review', listener);

        renderTaskTree(mockTree);
        fireEvent.dblClick(screen.getByTestId('task-tree-item-feature1'));

        window.removeEventListener('coc-open-markdown-review', listener);

        expect(events).toHaveLength(0);
    });

    it('clicking overflow indicator calls onNavigateBack and collapses one column', () => {
        const onNavigateBack = vi.fn();
        vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});
        renderTaskTree(mockTree, { onNavigateBack });

        // Navigate feature1 → sub to get 3 columns (overflow indicator appears)
        fireEvent.click(screen.getByTestId('task-tree-item-feature1'));
        fireEvent.click(screen.getByTestId('task-tree-item-sub'));

        const indicator = screen.getByTestId('column-overflow-indicator');
        expect(indicator.tagName.toLowerCase()).toBe('button');
        fireEvent.click(indicator);

        expect(onNavigateBack).toHaveBeenCalledTimes(1);
        // Should now show cols 0 and 1 with no overflow indicator
        expect(screen.getByTestId('miller-column-0')).toBeTruthy();
        expect(screen.getByTestId('miller-column-1')).toBeTruthy();
        expect(screen.queryByTestId('miller-column-2')).toBeNull();
        expect(screen.queryByTestId('column-overflow-indicator')).toBeNull();
    });

    it('clicking overflow indicator without onNavigateBack prop still navigates back', () => {
        vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});
        renderTaskTree(mockTree); // no onNavigateBack passed

        fireEvent.click(screen.getByTestId('task-tree-item-feature1'));
        fireEvent.click(screen.getByTestId('task-tree-item-sub'));

        expect(screen.getByTestId('column-overflow-indicator')).toBeTruthy();
        fireEvent.click(screen.getByTestId('column-overflow-indicator'));

        // Should navigate back without errors
        expect(screen.queryByTestId('column-overflow-indicator')).toBeNull();
        expect(screen.getByTestId('miller-column-0')).toBeTruthy();
        expect(screen.getByTestId('miller-column-1')).toBeTruthy();
    });

    it('back navigation updates URL hash to parent folder', () => {
        const replaceSpy = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});

        render(
            <Wrap>
                <TaskTree tree={mockTree} commentCounts={{}} wsId="ws1" />
                <OpenFilePathReader />
            </Wrap>
        );

        fireEvent.click(screen.getByTestId('task-tree-item-feature1'));
        fireEvent.click(screen.getByTestId('task-tree-item-sub'));

        replaceSpy.mockClear();
        fireEvent.click(screen.getByTestId('column-overflow-indicator'));

        // After back nav from 'feature1/sub' → should navigate to 'feature1'
        expect(replaceSpy).toHaveBeenCalledWith(null, '', '#repos/ws1/tasks/feature1');
    });

    it('back navigation to root updates URL hash to tasks base', () => {
        const replaceSpy = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});
        // Tree with only one level of nesting so 2 folders = 3 cols
        const shallow = makeTree({
            children: [
                makeTree({
                    name: 'alpha',
                    relativePath: 'alpha',
                    children: [
                        makeTree({ name: 'beta', relativePath: 'alpha/beta' }),
                    ],
                }),
            ],
        });

        render(
            <Wrap>
                <TaskTree tree={shallow} commentCounts={{}} wsId="ws1" />
                <OpenFilePathReader />
            </Wrap>
        );

        fireEvent.click(screen.getByTestId('task-tree-item-alpha'));
        fireEvent.click(screen.getByTestId('task-tree-item-beta'));

        // 3 columns → overflow indicator shows 1 hidden column
        const indicator = screen.getByTestId('column-overflow-indicator');
        expect(indicator.textContent?.trim()).toContain('1');

        replaceSpy.mockClear();
        fireEvent.click(indicator);

        // After going back from alpha/beta → should navigate to alpha
        expect(replaceSpy).toHaveBeenCalledWith(null, '', '#repos/ws1/tasks/alpha');

        // Now only 2 columns, no overflow indicator
        expect(screen.queryByTestId('column-overflow-indicator')).toBeNull();
    });
});
