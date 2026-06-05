import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WorkItemsTab } from '../../../../src/server/spa/client/react/features/work-items/WorkItemsTab';

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
    ImportFromGitHubDialog: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/features/work-items/WorkItemAiComposer', () => ({
    WorkItemAiComposer: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    isWorkItemsHierarchyEnabled: () => true,
    isWorkItemsAiAuthoringEnabled: () => false,
    isWorkItemsSyncEnabled: () => true,
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

describe('WorkItemsTab — remote provider tab icon', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.tree.mockResolvedValue(emptyTreeResponse());
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('shows only the GitHub icon after detecting a GitHub remote provider', async () => {
        mocks.syncStatus.mockResolvedValue({
            enabled: true,
            disabled: false,
            maxItems: 200,
            remoteProvider: 'github',
            provider: {
                provider: 'github',
                available: true,
                repository: {
                    provider: 'github',
                    owner: 'octo',
                    repo: 'repo',
                    url: 'https://github.com/octo/repo',
                },
                auth: { mode: 'external', authenticated: true },
            },
            providers: [{
                provider: 'github',
                available: true,
                repository: {
                    provider: 'github',
                    owner: 'octo',
                    repo: 'repo',
                    url: 'https://github.com/octo/repo',
                },
                auth: { mode: 'external', authenticated: true },
            }],
        });

        render(<WorkItemsTab workspaceId="ws-test" />);
        fireEvent.click(screen.getByTestId('work-item-tracker-tab-remote'));

        await waitFor(() => {
            expect(screen.getByTestId('work-item-tracker-tab-remote-github-icon')).toBeTruthy();
        });
        expect(screen.queryByTestId('work-item-tracker-tab-remote-azure-boards-icon')).toBeNull();
        expect(screen.queryByTestId('remote-sync-status-message')).toBeNull();
    });

    it('shows only the Azure DevOps icon after detecting an Azure Boards remote provider', async () => {
        mocks.syncStatus.mockResolvedValue({
            enabled: true,
            disabled: false,
            maxItems: 200,
            remoteProvider: 'azure-boards',
            provider: {
                provider: 'azure-boards',
                available: true,
                repository: {
                    provider: 'azure-boards',
                    organizationUrl: 'https://dev.azure.com/example',
                    project: 'Payments',
                    url: 'https://dev.azure.com/example/Payments',
                },
                auth: { mode: 'external', authenticated: true },
            },
            providers: [{
                provider: 'azure-boards',
                available: true,
                repository: {
                    provider: 'azure-boards',
                    organizationUrl: 'https://dev.azure.com/example',
                    project: 'Payments',
                    url: 'https://dev.azure.com/example/Payments',
                },
                auth: { mode: 'external', authenticated: true },
            }],
        });

        render(<WorkItemsTab workspaceId="ws-test" />);
        fireEvent.click(screen.getByTestId('work-item-tracker-tab-remote'));

        await waitFor(() => {
            expect(screen.getByTestId('work-item-tracker-tab-remote-azure-boards-icon')).toBeTruthy();
        });
        expect(screen.queryByTestId('work-item-tracker-tab-remote-github-icon')).toBeNull();
        expect(screen.queryByTestId('remote-sync-status-message')).toBeNull();
    });
});
