import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WorkItemsTab } from '../../../../src/server/spa/client/react/features/work-items/WorkItemsTab';
import { getWorkItemTrackerViewStorageKey } from '../../../../src/server/spa/client/react/features/work-items/workItemTrackerViews';

const mocks = vi.hoisted(() => ({
    dispatch: vi.fn(),
    tree: vi.fn(),
    syncStatus: vi.fn(),
}));

vi.mock('../../../../src/server/spa/client/react/contexts/WorkItemContext', () => ({
    useWorkItems: () => ({
        state: {
            workItemsByRepo: {},
            paginationByRepo: {},
            loading: {},
        },
        dispatch: mocks.dispatch,
    }),
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

vi.mock('../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: vi.fn(),
}));

vi.mock('../../../../src/server/spa/client/react/features/git/hooks/useFileCommentCounts', () => {
    const stableMap = new Map();
    return { useFileCommentCounts: () => stableMap };
});

vi.mock('../../../../src/server/spa/client/comments/diff-comment-utils', () => ({
    computeDiffCommentKey: vi.fn().mockResolvedValue('mock-key'),
}));

vi.mock('../../../../src/server/spa/client/react/features/work-items/WorkItemDetail', () => ({
    WorkItemDetail: () => <div data-testid="mock-work-item-detail" />,
}));

vi.mock('../../../../src/server/spa/client/react/features/work-items/WorkItemExecutionSession', () => ({
    WorkItemExecutionSession: () => <div data-testid="mock-work-item-execution-session" />,
}));

vi.mock('../../../../src/server/spa/client/react/features/work-items/WorkItemSection', () => ({
    WorkItemSection: () => <div data-testid="mock-work-item-section" />,
}));

vi.mock('../../../../src/server/spa/client/react/features/work-items/CreateWorkItemDialog', () => ({
    CreateWorkItemDialog: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/features/work-items/ImportFromGitHubDialog', () => ({
    ImportFromGitHubDialog: ({ initialProvider, onImported }: any) => (
        <button
            type="button"
            data-testid="mock-complete-import"
            onClick={() => onImported({
                id: 'wi-imported',
                title: 'Imported remote work item',
                tracker: { kind: initialProvider === 'azure-boards' ? 'azure-boards-backed' : 'github-backed' },
            }, initialProvider)}
        >
            Complete import
        </button>
    ),
}));

vi.mock('../../../../src/server/spa/client/react/features/work-items/WorkItemAiComposer', () => ({
    WorkItemAiComposer: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    isWorkItemsHierarchyEnabled: () => true,
    isWorkItemsAiAuthoringEnabled: () => false,
    isWorkItemsSyncEnabled: () => true,
    isSessionContextAttachmentsEnabled: () => false,
}));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        workItems: {
            tree: mocks.tree,
            syncStatus: mocks.syncStatus,
        },
    }),
    getSpaCocClientErrorMessage: (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback,
}));

function emptyTreeResponse() {
    return {
        disabled: false,
        total: 0,
        roots: [],
    };
}

function syncStatusResponse(provider: 'github' | 'azure-boards' = 'github') {
    const repository = provider === 'github'
        ? {
            provider: 'github',
            owner: 'octo',
            repo: 'repo',
            url: 'https://github.com/octo/repo',
        }
        : {
            provider: 'azure-boards',
            organizationUrl: 'https://dev.azure.com/example',
            project: 'Payments',
            url: 'https://dev.azure.com/example/Payments',
        };

    return {
        enabled: true,
        disabled: false,
        maxItems: 200,
        remoteProvider: provider,
        provider: {
            provider,
            available: true,
            repository,
            auth: { mode: 'external', authenticated: true },
        },
        providers: [{
            provider,
            available: true,
            repository,
            auth: { mode: 'external', authenticated: true },
        }],
    };
}

describe('WorkItemsTab — remote provider tab icon', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        location.hash = '';
        mocks.tree.mockResolvedValue(emptyTreeResponse());
        mocks.syncStatus.mockResolvedValue(syncStatusResponse());
    });

    afterEach(() => {
        localStorage.clear();
        vi.restoreAllMocks();
    });

    it('defaults to Local when there is no saved tracker tab', () => {
        render(<WorkItemsTab workspaceId="ws-test" />);

        expect(screen.getByTestId('work-item-tracker-tab-local')).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByTestId('work-item-tracker-tab-remote')).toHaveAttribute('aria-selected', 'false');
    });

    it('restores a valid saved tracker tab for the current workspace', () => {
        localStorage.setItem(getWorkItemTrackerViewStorageKey('ws-test'), 'remote');
        localStorage.setItem(getWorkItemTrackerViewStorageKey('ws-other'), 'local');

        render(<WorkItemsTab workspaceId="ws-test" />);

        expect(screen.getByTestId('work-item-tracker-tab-local')).toHaveAttribute('aria-selected', 'false');
        expect(screen.getByTestId('work-item-tracker-tab-remote')).toHaveAttribute('aria-selected', 'true');
    });

    it('falls back to Local for invalid saved tracker tab values', () => {
        localStorage.setItem(getWorkItemTrackerViewStorageKey('ws-test'), 'synced');

        render(<WorkItemsTab workspaceId="ws-test" />);

        expect(screen.getByTestId('work-item-tracker-tab-local')).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByTestId('work-item-tracker-tab-remote')).toHaveAttribute('aria-selected', 'false');
    });

    it('persists clicked tracker tabs under a workspace-scoped storage key', () => {
        render(<WorkItemsTab workspaceId="ws-test" />);

        fireEvent.click(screen.getByTestId('work-item-tracker-tab-remote'));
        expect(localStorage.getItem(getWorkItemTrackerViewStorageKey('ws-test'))).toBe('remote');
        expect(localStorage.getItem(getWorkItemTrackerViewStorageKey('ws-other'))).toBeNull();

        fireEvent.click(screen.getByTestId('work-item-tracker-tab-local'));
        expect(localStorage.getItem(getWorkItemTrackerViewStorageKey('ws-test'))).toBe('local');
    });

    it('keeps tracker tab preferences isolated between workspaces', () => {
        localStorage.setItem(getWorkItemTrackerViewStorageKey('ws-a'), 'remote');

        render(<WorkItemsTab workspaceId="ws-b" />);

        expect(screen.getByTestId('work-item-tracker-tab-local')).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByTestId('work-item-tracker-tab-remote')).toHaveAttribute('aria-selected', 'false');
    });

    it('shows only the GitHub icon after detecting a GitHub remote provider', async () => {
        mocks.syncStatus.mockResolvedValue(syncStatusResponse('github'));

        render(<WorkItemsTab workspaceId="ws-test" />);
        fireEvent.click(screen.getByTestId('work-item-tracker-tab-remote'));

        await waitFor(() => {
            expect(screen.getByTestId('work-item-tracker-tab-remote-github-icon')).toBeTruthy();
        });
        expect(screen.queryByTestId('work-item-tracker-tab-remote-azure-boards-icon')).toBeNull();
        await waitFor(() => {
            expect(screen.queryByTestId('remote-sync-status-message')).toBeNull();
        });
    });

    it('shows only the Azure DevOps icon after detecting an Azure Boards remote provider', async () => {
        mocks.syncStatus.mockResolvedValue(syncStatusResponse('azure-boards'));

        render(<WorkItemsTab workspaceId="ws-test" />);
        fireEvent.click(screen.getByTestId('work-item-tracker-tab-remote'));

        await waitFor(() => {
            expect(screen.getByTestId('work-item-tracker-tab-remote-azure-boards-icon')).toBeTruthy();
        });
        expect(screen.queryByTestId('work-item-tracker-tab-remote-github-icon')).toBeNull();
        await waitFor(() => {
            expect(screen.queryByTestId('remote-sync-status-message')).toBeNull();
        });
    });

    it('persists Remote when a remote import completes', async () => {
        mocks.syncStatus.mockResolvedValue(syncStatusResponse('github'));

        render(<WorkItemsTab workspaceId="ws-test" />);
        fireEvent.click(screen.getByTestId('work-item-tracker-tab-remote'));
        localStorage.setItem(getWorkItemTrackerViewStorageKey('ws-test'), 'local');

        fireEvent.click(await screen.findByTestId('mock-complete-import'));

        expect(localStorage.getItem(getWorkItemTrackerViewStorageKey('ws-test'))).toBe('remote');
    });
});
