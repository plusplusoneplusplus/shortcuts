import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockDispatch = vi.hoisted(() => vi.fn());
const mockFetchApi = vi.hoisted(() => vi.fn());
const mockSelectedPrId = vi.hoisted(() => ({ value: null as number | string | null }));

vi.mock('../../../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => '',
    isRalphEnabled: () => false,
    isPullRequestsSuggestionsEnabled: () => false,
    isPullRequestsAutoClassifyTeamEnabled: () => false,
    isFocusedDiffEnabled: () => true,
    getActiveProvider: () => 'copilot',
    isSessionContextAttachmentsEnabled: () => false,
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: mockFetchApi,
}));

vi.mock('../../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({ state: { selectedPrId: mockSelectedPrId.value }, dispatch: mockDispatch }),
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false, isTablet: false, isDesktop: true }),
}));

// Shell chrome with its own suite; stub to keep the StatusActions graph out.
vi.mock('../../../../../src/server/spa/client/react/layout/DockedStatusFooter', () => ({
    DockedStatusFooter: () => null,
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/ui/useResizablePanel', () => ({
    useResizablePanel: () => ({
        width: 288,
        isDragging: false,
        handleMouseDown: vi.fn(),
        handleTouchStart: vi.fn(),
        resetWidth: vi.fn(),
    }),
}));

vi.mock('../../../../../src/server/spa/client/react/features/pull-requests/PullRequestDetail', () => ({
    PullRequestDetail: ({ prId, remoteUrl }: { prId: number | string; remoteUrl?: string | null }) => (
        <div data-testid="mock-pr-detail" data-remote-url={remoteUrl ?? ''}>PR detail {prId}</div>
    ),
}));

const templates = [
    {
        key: '/validate',
        description: 'Validate merge readiness',
        templateText: 'Validate {{prNumbers}} before merge.',
    },
];

const prs = [
    {
        id: 1,
        number: 1,
        title: 'Ready to merge',
        sourceBranch: 'feature/ready',
        targetBranch: 'main',
        status: 'open',
        createdAt: '2026-01-15T10:00:00Z',
        updatedAt: '2026-01-16T12:30:00Z',
        author: { displayName: 'Alice' },
        reviewers: [{ identity: { displayName: 'Reviewer' }, vote: 'approved' }],
    },
];

function mockFetchOk() {
    global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ pullRequests: prs }),
    } as Response);
}

async function renderTab() {
    const { PullRequestsTab } = await import(
        '../../../../../src/server/spa/client/react/features/pull-requests/PullRequestsTab'
    );
    return render(<PullRequestsTab repoId="repo-1" workspaceId="ws-1" remoteUrl="https://github.com/octo/repo.git" />);
}

beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    mockSelectedPrId.value = null;
    mockFetchApi.mockResolvedValue(templates);
});

describe('PullRequestsTab batch panel switching', () => {
    it('renders BatchCommandPanel in the right panel when PRs are selected', async () => {
        mockFetchOk();

        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.getByTestId('pr-row')).toBeInTheDocument());

        // Enable batch mode first, then select the row
        fireEvent.click(screen.getByTestId('select-mode-button'));
        fireEvent.click(screen.getByTestId('pr-row-checkbox'));

        await waitFor(() => expect(screen.getByTestId('batch-command-panel')).toBeInTheDocument());
        expect(screen.getByTestId('pr-detail-panel')).toContainElement(screen.getByTestId('batch-command-panel'));
    });

    it('reverts to PullRequestDetail when batch selection is cleared', async () => {
        mockSelectedPrId.value = 1;
        mockFetchOk();

        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.getByTestId('mock-pr-detail')).toHaveTextContent('PR detail 1'));
        expect(screen.getByTestId('mock-pr-detail').getAttribute('data-remote-url')).toBe('https://github.com/octo/repo.git');

        // Enable batch mode, select the PR
        fireEvent.click(screen.getByTestId('select-mode-button'));
        fireEvent.click(screen.getByTestId('pr-row-checkbox'));
        await waitFor(() => expect(screen.getByTestId('batch-command-panel')).toBeInTheDocument());

        fireEvent.click(screen.getByTestId('batch-clear-selection'));

        await waitFor(() => expect(screen.queryByTestId('batch-command-panel')).toBeNull());
        expect(screen.getByTestId('mock-pr-detail')).toHaveTextContent('PR detail 1');
    });
});
