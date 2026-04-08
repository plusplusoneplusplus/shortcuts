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

vi.mock('../../../../src/server/spa/client/react/hooks/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false, isTablet: false }),
}));

vi.mock('../../../../src/server/spa/client/react/hooks/useResizablePanel', () => ({
    useResizablePanel: () => ({
        width: 340,
        isDragging: false,
        handleMouseDown: vi.fn(),
        handleTouchStart: vi.fn(),
    }),
}));

vi.mock('../../../../src/server/spa/client/react/context/WorkItemContext', () => ({
    useWorkItems: () => ({ dispatch: mockDispatch }),
    WorkItemProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../../../src/server/spa/client/react/hooks/useFileCommentCounts', () => {
    const stableMap = new Map();
    return { useFileCommentCounts: () => stableMap };
});

// Mock CommitDetail to verify it receives correct props
const mockCommitDetail = vi.fn();
vi.mock('../../../../src/server/spa/client/react/repos/CommitDetail', () => ({
    CommitDetail: (props: any) => {
        mockCommitDetail(props);
        return (
            <div data-testid="mock-commit-detail">
                {props.filePath && <span data-testid="commit-detail-file-path">{props.filePath}</span>}
                {!props.filePath && <span data-testid="commit-detail-no-file">full commit view</span>}
            </div>
        );
    },
}));

// Mock sub-components that are not under test
vi.mock('../../../../src/server/spa/client/react/repos/WorkItemSection', () => ({
    WorkItemSection: ({ onSelectWorkItem }: any) => (
        <div data-testid="mock-work-item-section">
            <button data-testid="select-work-item" onClick={() => onSelectWorkItem('wi-1')}>
                Select WI
            </button>
        </div>
    ),
}));

vi.mock('../../../../src/server/spa/client/react/repos/WorkItemDetail', () => ({
    WorkItemDetail: ({ onViewCommit }: any) => (
        <div data-testid="mock-work-item-detail">
            <button data-testid="view-commit" onClick={() => onViewCommit('abc1234567890')}>
                View Commit
            </button>
        </div>
    ),
}));

vi.mock('../../../../src/server/spa/client/react/repos/WorkItemExecutionSession', () => ({
    WorkItemExecutionSession: () => <div data-testid="mock-execution-session" />,
}));

vi.mock('../../../../src/server/spa/client/react/repos/CreateWorkItemDialog', () => ({
    CreateWorkItemDialog: () => null,
}));

// Mock computeDiffCommentKey (async)
vi.mock('../../../../src/server/spa/client/diff-comment-utils', () => ({
    computeDiffCommentKey: vi.fn().mockResolvedValue('mock-key'),
}));

import { WorkItemsTab } from '../../../../src/server/spa/client/react/repos/WorkItemsTab';

const COMMIT_FILES = [
    { status: 'modified', path: 'src/utils/helper.ts' },
    { status: 'added', path: 'src/components/Button.tsx' },
    { status: 'deleted', path: 'tests/old.test.ts' },
];

describe('WorkItemsTab — commit review with file sidebar', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFetchApi.mockReset();
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

    it('renders CommitDetail without filePath initially (full commit diff)', async () => {
        await navigateToCommitReview();

        await waitFor(() => {
            expect(screen.getByTestId('commit-detail-no-file')).toBeTruthy();
        });

        // Verify CommitDetail was called without filePath
        const lastCall = mockCommitDetail.mock.calls[mockCommitDetail.mock.calls.length - 1][0];
        expect(lastCall.filePath).toBeUndefined();
        expect(lastCall.hash).toBe('abc1234567890');
    });

    it('passes filePath to CommitDetail when a file is clicked', async () => {
        await navigateToCommitReview();

        // Wait for file list to render
        await waitFor(() => {
            expect(screen.getByTestId('commit-file-list')).toBeTruthy();
        });

        // Click a file in the sidebar
        fireEvent.click(screen.getByTestId('wi-commit-file-src/utils/helper.ts'));

        await waitFor(() => {
            expect(screen.getByTestId('commit-detail-file-path')).toBeTruthy();
            expect(screen.getByTestId('commit-detail-file-path').textContent).toBe('src/utils/helper.ts');
        });

        // Verify CommitDetail received the filePath prop
        const lastCall = mockCommitDetail.mock.calls[mockCommitDetail.mock.calls.length - 1][0];
        expect(lastCall.filePath).toBe('src/utils/helper.ts');
        expect(lastCall.hash).toBe('abc1234567890');
    });

    it('shows short hash in the header', async () => {
        await navigateToCommitReview();

        expect(screen.getByText('abc1234')).toBeTruthy();
    });

    it('updates header to show "File Diff" when a file is selected', async () => {
        await navigateToCommitReview();

        // Initially shows "Commit Review"
        expect(screen.getByText('Commit Review')).toBeTruthy();

        // Wait for files and click one
        await waitFor(() => {
            expect(screen.getByTestId('commit-file-list')).toBeTruthy();
        });
        fireEvent.click(screen.getByTestId('wi-commit-file-src/utils/helper.ts'));

        await waitFor(() => {
            expect(screen.getByText('File Diff')).toBeTruthy();
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
            expect(screen.getByTestId('commit-detail-file-path')).toBeTruthy();
        });

        // Click back — should deselect file but stay in commit review
        fireEvent.click(screen.getByTestId('commit-review-back-btn'));
        await waitFor(() => {
            expect(screen.getByTestId('commit-detail-no-file')).toBeTruthy();
            expect(screen.getByTestId('work-item-commit-review')).toBeTruthy();
        });
    });

    it('back button from file list returns to work item detail', async () => {
        await navigateToCommitReview();

        // Click back without a file selected — should go back to work item detail
        fireEvent.click(screen.getByTestId('commit-review-back-btn'));
        await waitFor(() => {
            expect(screen.getByTestId('mock-work-item-detail')).toBeTruthy();
        });
    });

    it('passes commitFiles and onNavigateToFile for cross-file navigation', async () => {
        await navigateToCommitReview();

        await waitFor(() => {
            expect(screen.getByTestId('commit-file-list')).toBeTruthy();
        });

        // Select a file
        fireEvent.click(screen.getByTestId('wi-commit-file-src/components/Button.tsx'));

        await waitFor(() => {
            const lastCall = mockCommitDetail.mock.calls[mockCommitDetail.mock.calls.length - 1][0];
            expect(lastCall.commitFiles).toBeDefined();
            expect(lastCall.commitFiles.length).toBe(3);
            expect(lastCall.onNavigateToFile).toBeDefined();
        });
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

        // The CommitDetail mock should show it's selected
        await waitFor(() => {
            const lastCall = mockCommitDetail.mock.calls[mockCommitDetail.mock.calls.length - 1][0];
            expect(lastCall.filePath).toBe('src/utils/helper.ts');
        });
    });

    it('back label changes based on file selection state', async () => {
        await navigateToCommitReview();

        // Initially no file selected — back button labeled "Back to work item"
        expect(screen.getByLabelText('Back to work item')).toBeTruthy();

        // Select a file
        await waitFor(() => screen.getByTestId('commit-file-list'));
        fireEvent.click(screen.getByTestId('wi-commit-file-src/utils/helper.ts'));

        await waitFor(() => {
            expect(screen.getByLabelText('Back to file list')).toBeTruthy();
        });
    });
});
