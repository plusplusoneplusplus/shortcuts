/**
 * Unit tests for TasksMillerLayout — the scrollable miller-column container
 * that conditionally renders TaskTree or TaskSearchResults alongside an
 * optional TaskPreview panel, with mobile-responsive behaviour.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { createRef } from 'react';
import type { TaskFolder, TaskDocument, TaskDocumentGroup } from '../../../src/server/spa/client/react/tasks/hooks/useTaskTree';

// ── Mock child components ──────────────────────────────────────────────

vi.mock('../../../src/server/spa/client/react/tasks/TaskTree', () => ({
    TaskTree: (props: Record<string, unknown>) => (
        <div data-testid="mock-task-tree" data-props={JSON.stringify({
            wsId: props.wsId,
            tasksFolder: props.tasksFolder,
            primaryFolderPath: props.primaryFolderPath,
            initialFolderPath: props.initialFolderPath,
            initialFilePath: props.initialFilePath,
            initialActiveFolderPath: props.initialActiveFolderPath,
            navigateToFilePath: props.navigateToFilePath,
        })} />
    ),
}));

vi.mock('../../../src/server/spa/client/react/tasks/TaskSearchResults', () => ({
    TaskSearchResults: (props: Record<string, unknown>) => (
        <div data-testid="mock-search-results" data-query={props.query as string} />
    ),
}));

vi.mock('../../../src/server/spa/client/react/tasks/TaskPreview', () => ({
    TaskPreview: (props: Record<string, unknown>) => (
        <div data-testid="mock-task-preview" data-ws-id={props.wsId as string} data-file-path={props.filePath as string} data-task-root={props.taskRootPath as string ?? ''} data-view-mode={props.initialViewMode as string ?? ''} />
    ),
}));

// ── Imports (after mocks) ──────────────────────────────────────────────

import { TasksMillerLayout } from '../../../src/server/spa/client/react/tasks/TasksMillerLayout';

// ── Fixtures ───────────────────────────────────────────────────────────

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

function makeDocument(overrides?: Partial<TaskDocument>): TaskDocument {
    return {
        baseName: 'task',
        fileName: 'task.md',
        relativePath: 'feature1',
        isArchived: false,
        ...overrides,
    };
}

function makeDocumentGroup(overrides?: Partial<TaskDocumentGroup>): TaskDocumentGroup {
    return {
        baseName: 'design',
        documents: [
            { baseName: 'design', docType: 'spec', fileName: 'design.spec.md', relativePath: 'feature1', isArchived: false },
        ],
        isArchived: false,
        ...overrides,
    };
}

/** Create a complete set of default props. */
function defaultProps(overrides?: Partial<Parameters<typeof TasksMillerLayout>[0]>) {
    return {
        scrollRef: createRef<HTMLDivElement>(),
        isSearching: false,
        searchResults: [] as (TaskDocument | TaskDocumentGroup)[],
        searchQuery: '',
        tree: makeTree(),
        commentCounts: {} as Record<string, number>,
        wsId: 'ws-test',
        tasksFolder: 'tasks',
        primaryFolderPath: undefined,
        initialFolderPath: null as string | null,
        initialFilePath: null as string | null,
        initialActiveFolderPath: null as string | null,
        initialViewMode: null as 'review' | 'source' | null,
        navigateToFilePath: null as string | null,
        onNavigated: vi.fn(),
        onColumnsChange: vi.fn(),
        onNavigateBack: vi.fn(),
        onFolderContextMenu: vi.fn(),
        onFolderEmptySpaceContextMenu: vi.fn(),
        onFileContextMenu: vi.fn(),
        onDrop: vi.fn(),
        onActiveFolderChange: vi.fn(),
        openFilePath: null as string | null,
        openFileTaskRootPath: null as string | null,
        setOpenFilePath: vi.fn(),
        isMobile: false,
        wsIdEncoded: 'ws-test',
        ...overrides,
    };
}

// ── Teardown ───────────────────────────────────────────────────────────

afterEach(cleanup);

let replaceStateSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    replaceStateSpy = vi.spyOn(history, 'replaceState').mockImplementation(() => { });
});

afterEach(() => {
    replaceStateSpy.mockRestore();
});

// ── Tests ──────────────────────────────────────────────────────────────

describe('TasksMillerLayout', () => {
    // ── Scroll container ───────────────────────────────────────────────

    describe('scroll container', () => {
        it('renders the outer scroll container with data-testid', () => {
            render(<TasksMillerLayout {...defaultProps()} />);
            expect(screen.getByTestId('tasks-miller-scroll-container')).toBeTruthy();
        });

        it('applies overflow-x-scroll and overflow-y-hidden classes', () => {
            render(<TasksMillerLayout {...defaultProps()} />);
            const container = screen.getByTestId('tasks-miller-scroll-container');
            expect(container.className).toContain('overflow-x-scroll');
            expect(container.className).toContain('overflow-y-hidden');
        });

        it('sets WebkitOverflowScrolling touch for momentum scrolling', () => {
            render(<TasksMillerLayout {...defaultProps()} />);
            const container = screen.getByTestId('tasks-miller-scroll-container');
            expect(container.style.webkitOverflowScrolling).toBe('touch');
        });

        it('forwards scrollRef to the scroll container element', () => {
            const ref = createRef<HTMLDivElement>();
            render(<TasksMillerLayout {...defaultProps({ scrollRef: ref })} />);
            expect(ref.current).toBe(screen.getByTestId('tasks-miller-scroll-container'));
        });
    });

    // ── Conditional rendering: TaskTree vs TaskSearchResults ────────────

    describe('conditional rendering', () => {
        it('renders TaskTree when isSearching is false', () => {
            render(<TasksMillerLayout {...defaultProps({ isSearching: false })} />);
            expect(screen.getByTestId('mock-task-tree')).toBeTruthy();
            expect(screen.queryByTestId('mock-search-results')).toBeNull();
        });

        it('renders TaskSearchResults when isSearching is true', () => {
            const results = [makeDocument({ baseName: 'hit', fileName: 'hit.md' })];
            render(<TasksMillerLayout {...defaultProps({ isSearching: true, searchResults: results, searchQuery: 'hit' })} />);
            expect(screen.getByTestId('mock-search-results')).toBeTruthy();
            expect(screen.queryByTestId('mock-task-tree')).toBeNull();
        });

        it('does not render TaskPreview when openFilePath is null', () => {
            render(<TasksMillerLayout {...defaultProps({ openFilePath: null })} />);
            expect(screen.queryByTestId('mock-task-preview')).toBeNull();
        });

        it('renders TaskPreview when openFilePath is set', () => {
            render(<TasksMillerLayout {...defaultProps({ openFilePath: 'feature/task.md' })} />);
            expect(screen.getByTestId('mock-task-preview')).toBeTruthy();
        });
    });

    // ── Props delegation ───────────────────────────────────────────────

    describe('props delegation', () => {
        it('passes wsId and tasksFolder to TaskTree', () => {
            render(<TasksMillerLayout {...defaultProps({ wsId: 'my-ws', tasksFolder: '/root/tasks' })} />);
            const treeEl = screen.getByTestId('mock-task-tree');
            const forwarded = JSON.parse(treeEl.getAttribute('data-props')!);
            expect(forwarded.wsId).toBe('my-ws');
            expect(forwarded.tasksFolder).toBe('/root/tasks');
        });

        it('passes navigation state to TaskTree', () => {
            render(<TasksMillerLayout {...defaultProps({
                initialFolderPath: 'sub/folder',
                initialFilePath: 'sub/folder/file.md',
                initialActiveFolderPath: 'sub/folder',
                navigateToFilePath: 'target.md',
            })} />);
            const forwarded = JSON.parse(screen.getByTestId('mock-task-tree').getAttribute('data-props')!);
            expect(forwarded.initialFolderPath).toBe('sub/folder');
            expect(forwarded.initialFilePath).toBe('sub/folder/file.md');
            expect(forwarded.initialActiveFolderPath).toBe('sub/folder');
            expect(forwarded.navigateToFilePath).toBe('target.md');
        });

        it('passes query to TaskSearchResults', () => {
            render(<TasksMillerLayout {...defaultProps({ isSearching: true, searchQuery: 'findme' })} />);
            expect(screen.getByTestId('mock-search-results').getAttribute('data-query')).toBe('findme');
        });

        it('passes wsId, filePath, taskRootPath, and initialViewMode to TaskPreview', () => {
            render(<TasksMillerLayout {...defaultProps({
                wsId: 'ws-99',
                openFilePath: 'feat/plan.md',
                openFileTaskRootPath: '/abs/path',
                initialViewMode: 'source',
            })} />);
            const preview = screen.getByTestId('mock-task-preview');
            expect(preview.getAttribute('data-ws-id')).toBe('ws-99');
            expect(preview.getAttribute('data-file-path')).toBe('feat/plan.md');
            expect(preview.getAttribute('data-task-root')).toBe('/abs/path');
            expect(preview.getAttribute('data-view-mode')).toBe('source');
        });
    });

    // ── Mobile behaviour ───────────────────────────────────────────────

    describe('mobile behaviour', () => {
        it('hides tree column when isMobile and openFilePath is set', () => {
            render(<TasksMillerLayout {...defaultProps({ isMobile: true, openFilePath: 'file.md' })} />);
            const treeColumn = screen.getByTestId('mock-task-tree').closest('.flex-shrink-0') as HTMLElement;
            expect(treeColumn.style.display).toBe('none');
        });

        it('shows tree column when isMobile but openFilePath is null', () => {
            render(<TasksMillerLayout {...defaultProps({ isMobile: true, openFilePath: null })} />);
            const treeColumn = screen.getByTestId('mock-task-tree').closest('.flex-shrink-0') as HTMLElement;
            expect(treeColumn.style.display).not.toBe('none');
        });

        it('shows tree column on desktop even when openFilePath is set', () => {
            render(<TasksMillerLayout {...defaultProps({ isMobile: false, openFilePath: 'file.md' })} />);
            const treeColumn = screen.getByTestId('mock-task-tree').closest('.flex-shrink-0') as HTMLElement;
            expect(treeColumn.style.display).not.toBe('none');
        });

        it('renders back button on mobile when preview is open', () => {
            render(<TasksMillerLayout {...defaultProps({ isMobile: true, openFilePath: 'my/task.md' })} />);
            expect(screen.getByTestId('task-preview-back-btn')).toBeTruthy();
        });

        it('does not render back button on desktop', () => {
            render(<TasksMillerLayout {...defaultProps({ isMobile: false, openFilePath: 'my/task.md' })} />);
            expect(screen.queryByTestId('task-preview-back-btn')).toBeNull();
        });

        it('does not render back button when preview is closed on mobile', () => {
            render(<TasksMillerLayout {...defaultProps({ isMobile: true, openFilePath: null })} />);
            expect(screen.queryByTestId('task-preview-back-btn')).toBeNull();
        });
    });

    // ── Back button interaction ────────────────────────────────────────

    describe('back button', () => {
        it('calls setOpenFilePath(null) when back button is clicked', () => {
            const setOpenFilePath = vi.fn();
            render(<TasksMillerLayout {...defaultProps({
                isMobile: true,
                openFilePath: 'folder/item.md',
                setOpenFilePath,
            })} />);

            fireEvent.click(screen.getByTestId('task-preview-back-btn'));
            expect(setOpenFilePath).toHaveBeenCalledWith(null);
        });

        it('navigates URL hash to parent folder when back is clicked', () => {
            render(<TasksMillerLayout {...defaultProps({
                isMobile: true,
                openFilePath: 'deep/nested/task.md',
                wsIdEncoded: 'ws-enc',
            })} />);

            fireEvent.click(screen.getByTestId('task-preview-back-btn'));
            expect(replaceStateSpy).toHaveBeenCalledWith(
                null, '',
                '#repos/ws-enc/tasks/deep/nested',
            );
        });

        it('navigates to root tasks URL when file is at root level', () => {
            render(<TasksMillerLayout {...defaultProps({
                isMobile: true,
                openFilePath: 'root-file.md',
                wsIdEncoded: 'ws-enc',
            })} />);

            fireEvent.click(screen.getByTestId('task-preview-back-btn'));
            expect(replaceStateSpy).toHaveBeenCalledWith(
                null, '',
                '#repos/ws-enc/tasks',
            );
        });
    });

    // ── Preview panel layout ───────────────────────────────────────────

    describe('preview panel layout', () => {
        it('applies min-w-[48rem] class on desktop preview', () => {
            render(<TasksMillerLayout {...defaultProps({ isMobile: false, openFilePath: 'file.md' })} />);
            const previewWrapper = screen.getByTestId('mock-task-preview').closest('.flex-1') as HTMLElement;
            expect(previewWrapper.className).toContain('min-w-[48rem]');
        });

        it('applies min-w-0 class on mobile preview', () => {
            render(<TasksMillerLayout {...defaultProps({ isMobile: true, openFilePath: 'file.md' })} />);
            const previewWrapper = screen.getByTestId('mock-task-preview').closest('.flex-1') as HTMLElement;
            expect(previewWrapper.className).toContain('min-w-0');
            expect(previewWrapper.className).not.toContain('min-w-[48rem]');
        });

        it('renders border between tree and preview', () => {
            render(<TasksMillerLayout {...defaultProps({ openFilePath: 'file.md' })} />);
            const previewWrapper = screen.getByTestId('mock-task-preview').closest('.border-r') as HTMLElement;
            expect(previewWrapper).toBeTruthy();
        });
    });

    // ── Edge cases ─────────────────────────────────────────────────────

    describe('edge cases', () => {
        it('handles empty search results without crashing', () => {
            render(<TasksMillerLayout {...defaultProps({
                isSearching: true,
                searchResults: [],
                searchQuery: 'no-match',
            })} />);
            expect(screen.getByTestId('mock-search-results')).toBeTruthy();
        });

        it('renders correctly with an empty tree', () => {
            const emptyTree = makeTree({ children: [], documentGroups: [], singleDocuments: [] });
            render(<TasksMillerLayout {...defaultProps({ tree: emptyTree })} />);
            expect(screen.getByTestId('mock-task-tree')).toBeTruthy();
        });

        it('handles switching from search to tree mode', () => {
            const props = defaultProps({ isSearching: true, searchQuery: 'q' });
            const { rerender } = render(<TasksMillerLayout {...props} />);
            expect(screen.getByTestId('mock-search-results')).toBeTruthy();

            rerender(<TasksMillerLayout {...{ ...props, isSearching: false }} />);
            expect(screen.getByTestId('mock-task-tree')).toBeTruthy();
            expect(screen.queryByTestId('mock-search-results')).toBeNull();
        });

        it('handles opening and closing preview via rerender', () => {
            const props = defaultProps();
            const { rerender } = render(<TasksMillerLayout {...props} />);
            expect(screen.queryByTestId('mock-task-preview')).toBeNull();

            rerender(<TasksMillerLayout {...{ ...props, openFilePath: 'open.md' }} />);
            expect(screen.getByTestId('mock-task-preview')).toBeTruthy();

            rerender(<TasksMillerLayout {...{ ...props, openFilePath: null }} />);
            expect(screen.queryByTestId('mock-task-preview')).toBeNull();
        });

        it('encodes parent folder segments in the back-button URL', () => {
            render(<TasksMillerLayout {...defaultProps({
                isMobile: true,
                openFilePath: 'path with spaces/file.md',
                wsIdEncoded: 'ws-enc',
            })} />);

            fireEvent.click(screen.getByTestId('task-preview-back-btn'));
            expect(replaceStateSpy).toHaveBeenCalledWith(
                null, '',
                '#repos/ws-enc/tasks/path%20with%20spaces',
            );
        });
    });
});
