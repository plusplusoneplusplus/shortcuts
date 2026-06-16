/**
 * Tests for WorkItemsTab — commit review with file sidebar and inline commenting.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// --- Module mocks (hoisted by Vitest) ---

const mockFetchApi = vi.fn();
const mockDispatch = vi.fn();

vi.mock('../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: (path: string, options?: RequestInit) => mockFetchApi(path, options),
}));

// WorkItemsTab routes the commit-files load to the clone via requestForWorkspace;
// delegate to the same mockFetchApi so the existing path-based setup keeps working.
// Spread the real module so other consumers (e.g. WorkItemAiComposer's useCocClient
// → lookupCloneBaseUrl) keep their real implementations.
vi.mock('../../../../src/server/spa/client/react/repos/cloneRegistry', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../../src/server/spa/client/react/repos/cloneRegistry')>()),
    requestForWorkspace: (_wsId: string, path: string, options?: RequestInit) => mockFetchApi(path, options),
}));

vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false, isTablet: false }),
}));

vi.mock('../../../../src/server/spa/client/react/hooks/ui/useResizablePanel', () => ({
    useResizablePanel: () => ({
        width: 340,
        isDragging: false,
        handleMouseDown: vi.fn(),
        handleTouchStart: vi.fn(),
    }),
}));

vi.mock('../../../../src/server/spa/client/react/contexts/WorkItemContext', () => ({
    useWorkItems: () => ({ dispatch: mockDispatch }),
    WorkItemProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({
        state: {
            selectedWorkItemId: undefined,
            selectedWorkItemSessionTaskId: undefined,
            selectedWorkItemCommitHash: undefined,
            selectedWorkItemCommitFilePath: undefined,
        },
        dispatch: vi.fn(),
    }),
}));

vi.mock('../../../../src/server/spa/client/react/features/git/hooks/useFileCommentCounts', () => {
    const stableMap = new Map();
    return { useFileCommentCounts: () => stableMap };
});

// Mock CommitDetail to verify it receives correct props
const mockCommitDetail = vi.fn();
vi.mock('../../../../src/server/spa/client/react/features/git/commits/CommitDetail', () => ({
    CommitDetail: (props: any) => {
        mockCommitDetail(props);
        return (
            <div data-testid="mock-commit-detail">
                <span data-testid="commit-detail-no-file">full commit view</span>
            </div>
        );
    },
}));

// Mock FileDiffPanel — rendered when a specific file is selected
const mockFileDiffPanel = vi.fn();
vi.mock('../../../../src/server/spa/client/react/features/git/diff/FileDiffPanel', () => ({
    FileDiffPanel: (props: any) => {
        mockFileDiffPanel(props);
        return (
            <div data-testid="mock-file-diff-panel">
                <span data-testid="file-diff-panel-file-path">{props.filePath}</span>
            </div>
        );
    },
}));

// Mock createCommitDiffSource
const mockCreateCommitDiffSource = vi.fn().mockReturnValue({ type: 'commit' });
vi.mock('../../../../src/server/spa/client/react/features/git/diff/diffSource', () => ({
    createCommitDiffSource: (...args: any[]) => mockCreateCommitDiffSource(...args),
}));

// Mock sub-components that are not under test
vi.mock('../../../../src/server/spa/client/react/features/work-items/WorkItemSection', () => ({
    WorkItemSection: ({ onSelectWorkItem }: any) => (
        <div data-testid="mock-work-item-section">
            <button data-testid="select-work-item" onClick={() => onSelectWorkItem('wi-1')}>
                Select WI
            </button>
        </div>
    ),
}));

vi.mock('../../../../src/server/spa/client/react/features/work-items/WorkItemDetail', () => ({
    WorkItemDetail: ({ onViewCommit }: any) => (
        <div data-testid="mock-work-item-detail">
            <button data-testid="view-commit" onClick={() => onViewCommit('abc1234567890')}>
                View Commit
            </button>
        </div>
    ),
}));

vi.mock('../../../../src/server/spa/client/react/features/work-items/WorkItemExecutionSession', () => ({
    WorkItemExecutionSession: () => <div data-testid="mock-execution-session" />,
}));

vi.mock('../../../../src/server/spa/client/react/features/work-items/CreateWorkItemDialog', () => ({
    CreateWorkItemDialog: () => null,
}));

// Mock computeDiffCommentKey (async)
vi.mock('../../../../src/server/spa/client/comments/diff-comment-utils', () => ({
    computeDiffCommentKey: vi.fn().mockResolvedValue('mock-key'),
}));

import { WorkItemsTab } from '../../../../src/server/spa/client/react/features/work-items/WorkItemsTab';

const COMMIT_FILES = [
    { status: 'modified', path: 'src/utils/helper.ts' },
    { status: 'added', path: 'src/components/Button.tsx' },
    { status: 'deleted', path: 'tests/old.test.ts' },
];

describe('WorkItemsTab — commit review with file sidebar', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFetchApi.mockReset();
        mockFileDiffPanel.mockClear();
        mockCreateCommitDiffSource.mockClear();
        mockCreateCommitDiffSource.mockReturnValue({ type: 'commit' });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    async function navigateToCommitReview() {
        // Set up fetchApi to return commit files when the commit is selected
        mockFetchApi.mockResolvedValue({ files: COMMIT_FILES });

        render(<WorkItemsTab workspaceId="ws-test" />);

        // Select a work item
        fireEvent.click(screen.getByTestId('select-work-item'));
        await waitFor(() => {
            expect(screen.getByTestId('mock-work-item-detail')).toBeTruthy();
        });

        // Click "View Commit" to navigate to commit review
        fireEvent.click(screen.getByTestId('view-commit'));
        await waitFor(() => {
            expect(screen.getByTestId('work-item-commit-review')).toBeTruthy();
        });
    }

    it('shows commit review with file sidebar when viewing a commit', async () => {
        await navigateToCommitReview();

        // File sidebar should be visible
        expect(screen.getByTestId('commit-file-sidebar')).toBeTruthy();

        // Should fetch files for the commit
        expect(mockFetchApi).toHaveBeenCalledWith(
            '/workspaces/ws-test/git/commits/abc1234567890/files',
            undefined,
        );

        // File tree should render after files load
        await waitFor(() => {
            expect(screen.getByTestId('commit-file-list')).toBeTruthy();
        });
    });

    it('renders CommitDetail for full commit view when file is deselected', async () => {
        await navigateToCommitReview();

        // After commit files load, first file is auto-selected → FileDiffPanel renders
        await waitFor(() => {
            expect(screen.getByTestId('mock-file-diff-panel')).toBeTruthy();
        });

        // Click back to deselect file → CommitDetail renders for full overview
        fireEvent.click(screen.getByTestId('commit-review-back-btn'));

        await waitFor(() => {
            expect(screen.getByTestId('commit-detail-no-file')).toBeTruthy();
        });

        // Verify CommitDetail was called without filePath
        const lastCall = mockCommitDetail.mock.calls[mockCommitDetail.mock.calls.length - 1][0];
        expect(lastCall.hash).toBe('abc1234567890');
    });

    it('renders FileDiffPanel when a file is clicked', async () => {
        await navigateToCommitReview();

        // Wait for file list to render
        await waitFor(() => {
            expect(screen.getByTestId('commit-file-list')).toBeTruthy();
        });

        // Click a file in the sidebar
        fireEvent.click(screen.getByTestId('wi-commit-file-src/utils/helper.ts'));

        await waitFor(() => {
            expect(screen.getByTestId('mock-file-diff-panel')).toBeTruthy();
            expect(screen.getByTestId('file-diff-panel-file-path').textContent).toBe('src/utils/helper.ts');
        });

        // Verify FileDiffPanel received the correct props
        const lastCall = mockFileDiffPanel.mock.calls[mockFileDiffPanel.mock.calls.length - 1][0];
        expect(lastCall.filePath).toBe('src/utils/helper.ts');
        expect(lastCall.workspaceId).toBe('ws-test');
        expect(lastCall.source).toBeDefined();
        expect(lastCall.onNavigateToFile).toBeDefined();
    });

    it('shows short hash in the header', async () => {
        await navigateToCommitReview();

        expect(screen.getByText('abc1234')).toBeTruthy();
    });

    it('header shows "File Diff" when file is auto-selected, and "Commit Review" after back', async () => {
        await navigateToCommitReview();

        // First file is auto-selected, so header shows "File Diff"
        await waitFor(() => {
            expect(screen.getByText('File Diff')).toBeTruthy();
        });

        // Click back to deselect file
        fireEvent.click(screen.getByTestId('commit-review-back-btn'));

        await waitFor(() => {
            expect(screen.getByText('Commit Review')).toBeTruthy();
        });
    });

    it('back button from file view returns to file list (not work item)', async () => {
        await navigateToCommitReview();

        await waitFor(() => {
            expect(screen.getByTestId('commit-file-list')).toBeTruthy();
        });

        // Select a file
        fireEvent.click(screen.getByTestId('wi-commit-file-src/utils/helper.ts'));
        await waitFor(() => {
            expect(screen.getByTestId('mock-file-diff-panel')).toBeTruthy();
        });

        // Click back — should deselect file but stay in commit review
        fireEvent.click(screen.getByTestId('commit-review-back-btn'));
        await waitFor(() => {
            expect(screen.getByTestId('commit-detail-no-file')).toBeTruthy();
            expect(screen.getByTestId('work-item-commit-review')).toBeTruthy();
        });
    });

    it('back button from commit overview returns to work item detail', async () => {
        await navigateToCommitReview();

        // First file is auto-selected; click back to deselect file
        await waitFor(() => screen.getByTestId('mock-file-diff-panel'));
        fireEvent.click(screen.getByTestId('commit-review-back-btn'));
        await waitFor(() => {
            expect(screen.getByTestId('commit-detail-no-file')).toBeTruthy();
        });

        // Click back again — should go back to work item detail
        fireEvent.click(screen.getByTestId('commit-review-back-btn'));
        await waitFor(() => {
            expect(screen.getByTestId('mock-work-item-detail')).toBeTruthy();
        });
    });

    it('passes onNavigateToFile to FileDiffPanel for cross-file navigation', async () => {
        await navigateToCommitReview();

        await waitFor(() => {
            expect(screen.getByTestId('commit-file-list')).toBeTruthy();
        });

        // Select a file
        fireEvent.click(screen.getByTestId('wi-commit-file-src/components/Button.tsx'));

        await waitFor(() => {
            const lastCall = mockFileDiffPanel.mock.calls[mockFileDiffPanel.mock.calls.length - 1][0];
            expect(lastCall.onNavigateToFile).toBeDefined();
            expect(lastCall.filePath).toBe('src/components/Button.tsx');
        });

        // Verify createCommitDiffSource was called with the right args
        expect(mockCreateCommitDiffSource).toHaveBeenCalledWith(
            'ws-test',
            'abc1234567890',
            expect.objectContaining({ files: expect.any(Array) }),
        );
    });

    it('shows all changed files in the sidebar tree', async () => {
        await navigateToCommitReview();

        await waitFor(() => {
            expect(screen.getByTestId('commit-file-list')).toBeTruthy();
        });

        // All three files should appear
        expect(screen.getByTestId('wi-commit-file-src/utils/helper.ts')).toBeTruthy();
        expect(screen.getByTestId('wi-commit-file-src/components/Button.tsx')).toBeTruthy();
        expect(screen.getByTestId('wi-commit-file-tests/old.test.ts')).toBeTruthy();
    });

    it('shows file count in sidebar header', async () => {
        await navigateToCommitReview();

        await waitFor(() => {
            expect(screen.getByText('(3)', { exact: false })).toBeTruthy();
        });
    });

    it('shows loading state while fetching files', async () => {
        // Make fetchApi hang to simulate loading
        mockFetchApi.mockReturnValue(new Promise(() => {}));

        render(<WorkItemsTab workspaceId="ws-test" />);

        fireEvent.click(screen.getByTestId('select-work-item'));
        await waitFor(() => screen.getByTestId('mock-work-item-detail'));

        fireEvent.click(screen.getByTestId('view-commit'));
        await waitFor(() => {
            expect(screen.getByTestId('commit-files-loading')).toBeTruthy();
        });
    });

    it('shows "No files changed" when commit has no files', async () => {
        mockFetchApi.mockResolvedValue({ files: [] });

        render(<WorkItemsTab workspaceId="ws-test" />);

        fireEvent.click(screen.getByTestId('select-work-item'));
        await waitFor(() => screen.getByTestId('mock-work-item-detail'));

        fireEvent.click(screen.getByTestId('view-commit'));
        await waitFor(() => {
            expect(screen.getByText('No files changed')).toBeTruthy();
        });
    });

    it('highlights selected file in the tree', async () => {
        await navigateToCommitReview();

        await waitFor(() => {
            expect(screen.getByTestId('commit-file-list')).toBeTruthy();
        });

        // Click a file
        fireEvent.click(screen.getByTestId('wi-commit-file-src/utils/helper.ts'));

        // FileDiffPanel should be rendered with the selected file
        await waitFor(() => {
            const lastCall = mockFileDiffPanel.mock.calls[mockFileDiffPanel.mock.calls.length - 1][0];
            expect(lastCall.filePath).toBe('src/utils/helper.ts');
        });
    });

    it('back label changes based on file selection state', async () => {
        await navigateToCommitReview();

        // First file is auto-selected — back button labeled "Back to file list"
        await waitFor(() => {
            expect(screen.getByLabelText('Back to file list')).toBeTruthy();
        });

        // Click back to deselect file — now labeled "Back to work item"
        fireEvent.click(screen.getByTestId('commit-review-back-btn'));
        await waitFor(() => {
            expect(screen.getByLabelText('Back to work item')).toBeTruthy();
        });
    });
});
