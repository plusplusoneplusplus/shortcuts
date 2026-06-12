import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WorkItemSection } from '../../../../src/server/spa/client/react/features/work-items/WorkItemSection';
import { WorkItemHierarchyTree } from '../../../../src/server/spa/client/react/features/work-items/WorkItemHierarchyTree';

const mocks = vi.hoisted(() => ({
    dispatch: vi.fn(),
    tree: vi.fn(),
    grouped: vi.fn(),
    syncStatus: vi.fn(),
    isWorkItemsSyncEnabled: vi.fn(),
}));

vi.mock('../../../../src/server/spa/client/react/contexts/WorkItemContext', () => ({
    useWorkItems: () => ({
        state: {
            workItemsByRepo: {
                'ws-test': [{
                    id: 'wi-imported',
                    title: 'Imported issue',
                    status: 'created',
                    type: 'bug',
                    createdAt: '2026-01-01T00:00:00.000Z',
                    updatedAt: '2026-01-01T00:00:00.000Z',
                }],
            },
            paginationByRepo: {
                'ws-test': {
                    created: { total: 1, hasMore: false, offset: 1 },
                },
            },
            loading: {},
            realtimeRevisionByRepo: {},
        },
        dispatch: mocks.dispatch,
    }),
}));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        workItems: {
            tree: mocks.tree,
            grouped: mocks.grouped,
            syncStatus: mocks.syncStatus,
        },
    }),
    getSpaCocClientErrorMessage: (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback,
}));

vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    isWorkItemsSyncEnabled: () => mocks.isWorkItemsSyncEnabled(),
    isSessionContextAttachmentsEnabled: () => false,
}));

const importedItem = {
    id: 'wi-imported',
    title: 'Imported issue',
    status: 'created',
    type: 'bug',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('Import from remote work item placement', () => {
    let scrollIntoView: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.isWorkItemsSyncEnabled.mockReturnValue(false);
        scrollIntoView = vi.fn();
        HTMLElement.prototype.scrollIntoView = scrollIntoView;
        mocks.grouped.mockResolvedValue({
            groups: {
                created: { items: [importedItem], total: 1, hasMore: false },
            },
        });
        mocks.tree.mockResolvedValue({
            disabled: false,
            total: 1,
            roots: [{
                item: importedItem,
                children: [],
                rollup: {
                    descendantCount: 0,
                    byStatus: {},
                },
            }],
        });
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
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('scrolls the highlighted imported item into view in the non-hierarchy list', async () => {
        render(
            <WorkItemSection
                workspaceId="ws-test"
                onSelectWorkItem={vi.fn()}
                selectedWorkItemId={null}
                highlightedWorkItemId="wi-imported"
            />,
        );

        await waitFor(() => {
            expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
        });
        expect(screen.getByTestId('work-item-card-wi-imported').className).toContain('animate-pulse');
    });

    it('renders the Remote hierarchy import action and scrolls the highlighted imported tree row into view', async () => {
        mocks.isWorkItemsSyncEnabled.mockReturnValue(true);
        const onImportFromRemote = vi.fn();
        render(
            <WorkItemHierarchyTree
                workspaceId="ws-test"
                trackerViewKind="remote"
                trackerKinds={['github-backed']}
                selectedWorkItemId={null}
                onSelectWorkItem={vi.fn()}
                onCreated={vi.fn()}
                onCreateItem={vi.fn()}
                onImportFromRemote={onImportFromRemote}
                highlightedWorkItemId="wi-imported"
            />,
        );

        const importButton = await screen.findByRole('button', { name: 'Import remote' });
        fireEvent.click(importButton);

        expect(onImportFromRemote).toHaveBeenCalledWith('github');
        expect(screen.getByTestId('remote-provider-filter-github')).toBeTruthy();
        expect(screen.queryByTestId('remote-provider-filter-all')).toBeNull();
        expect(screen.queryByTestId('remote-provider-filter-azure-boards')).toBeNull();
        expect(mocks.tree.mock.calls.map(call => call[1]?.tracker)).toContain('github-backed');
        expect(mocks.tree.mock.calls.map(call => call[1]?.tracker)).not.toContain('azure-boards-backed');
        await waitFor(() => {
            expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
        });
        expect(screen.getByTestId('hierarchy-node-row-wi-imported').className).toContain('animate-pulse');
    });

    it('shows a disabled-by-flag Remote sync status message without calling the provider status endpoint', async () => {
        mocks.isWorkItemsSyncEnabled.mockReturnValue(false);

        render(
            <WorkItemHierarchyTree
                workspaceId="ws-test"
                trackerViewKind="remote"
                trackerKinds={['azure-boards-backed']}
                remoteProviderFilter="azure-boards"
                selectedWorkItemId={null}
                onSelectWorkItem={vi.fn()}
                onCreated={vi.fn()}
                onCreateItem={vi.fn()}
                onImportFromRemote={vi.fn()}
            />,
        );

        const status = await screen.findByTestId('remote-sync-status-message');
        expect(status).toHaveTextContent('Remote sync is disabled by configuration');
        expect(status.dataset.statusTone).toBe('warning');
        expect(mocks.syncStatus).not.toHaveBeenCalled();
    });

    it('hides Azure Boards sync status once the provider is available', async () => {
        mocks.isWorkItemsSyncEnabled.mockReturnValue(true);
        let resolveStatus: (value: any) => void = () => undefined;
        mocks.syncStatus.mockReturnValue(new Promise(resolve => {
            resolveStatus = resolve;
        }));

        render(
            <WorkItemHierarchyTree
                workspaceId="ws-test"
                trackerViewKind="remote"
                trackerKinds={['azure-boards-backed']}
                remoteProviderFilter="azure-boards"
                selectedWorkItemId={null}
                onSelectWorkItem={vi.fn()}
                onCreated={vi.fn()}
                onCreateItem={vi.fn()}
                onImportFromRemote={vi.fn()}
            />,
        );

        expect(await screen.findByTestId('remote-sync-status-message')).toHaveTextContent('Checking Azure Boards sync status');

        await act(async () => {
            resolveStatus({
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
        });

        await waitFor(() => {
            expect(screen.queryByTestId('remote-sync-status-message')).toBeNull();
        });
        expect(screen.getByTestId('remote-provider-filter-azure-boards')).toBeTruthy();
        expect(screen.queryByTestId('remote-provider-filter-all')).toBeNull();
        expect(screen.queryByTestId('remote-provider-filter-github')).toBeNull();
        expect(mocks.syncStatus).toHaveBeenCalledWith('ws-test');
        expect(mocks.tree.mock.calls.map(call => call[1]?.tracker)).toContain('azure-boards-backed');
        expect(mocks.tree.mock.calls.map(call => call[1]?.tracker)).not.toContain('github-backed');
    });

    it('shows Azure Boards project-missing status messaging', async () => {
        mocks.isWorkItemsSyncEnabled.mockReturnValue(true);
        mocks.syncStatus.mockResolvedValue({
            enabled: true,
            disabled: false,
            maxItems: 200,
            remoteProvider: 'azure-boards',
            provider: {
                provider: 'azure-boards',
                available: false,
                reason: 'missing-project',
                repository: {
                    provider: 'azure-boards',
                    organizationUrl: 'https://dev.azure.com/example',
                },
                auth: { mode: 'external', authenticated: true },
            },
            providers: [{
                provider: 'azure-boards',
                available: false,
                reason: 'missing-project',
                repository: {
                    provider: 'azure-boards',
                    organizationUrl: 'https://dev.azure.com/example',
                },
                auth: { mode: 'external', authenticated: true },
            }],
        });

        render(
            <WorkItemHierarchyTree
                workspaceId="ws-test"
                trackerViewKind="remote"
                trackerKinds={['azure-boards-backed']}
                remoteProviderFilter="azure-boards"
                selectedWorkItemId={null}
                onSelectWorkItem={vi.fn()}
                onCreated={vi.fn()}
                onCreateItem={vi.fn()}
                onImportFromRemote={vi.fn()}
            />,
        );

        const status = await screen.findByText(/Azure Boards unavailable: Azure Boards project is not configured for this workspace/);
        expect(status).toBeTruthy();
    });

    it('shows Azure Boards auth-missing status messaging without exposing credentials', async () => {
        mocks.isWorkItemsSyncEnabled.mockReturnValue(true);
        mocks.syncStatus.mockResolvedValue({
            enabled: true,
            disabled: false,
            maxItems: 200,
            remoteProvider: 'azure-boards',
            provider: {
                provider: 'azure-boards',
                available: false,
                reason: 'auth-unavailable',
                repository: {
                    provider: 'azure-boards',
                    organizationUrl: 'https://dev.azure.com/example',
                    project: 'Payments',
                },
                auth: { mode: 'external', authenticated: false },
            },
            providers: [{
                provider: 'azure-boards',
                available: false,
                reason: 'auth-unavailable',
                repository: {
                    provider: 'azure-boards',
                    organizationUrl: 'https://dev.azure.com/example',
                    project: 'Payments',
                },
                auth: { mode: 'external', authenticated: false },
            }],
        });

        render(
            <WorkItemHierarchyTree
                workspaceId="ws-test"
                trackerViewKind="remote"
                trackerKinds={['azure-boards-backed']}
                remoteProviderFilter="azure-boards"
                selectedWorkItemId={null}
                onSelectWorkItem={vi.fn()}
                onCreated={vi.fn()}
                onCreateItem={vi.fn()}
                onImportFromRemote={vi.fn()}
            />,
        );

        const status = await screen.findByText(/Azure Boards unavailable: Azure CLI authentication is unavailable/);
        expect(status.textContent).not.toMatch(/bearer|token|pat|authorization/i);
    });

    it('shows Azure Boards sync status errors distinctly from empty tree state', async () => {
        mocks.isWorkItemsSyncEnabled.mockReturnValue(true);
        mocks.tree.mockResolvedValue({
            disabled: false,
            total: 0,
            roots: [],
        });
        mocks.syncStatus.mockRejectedValue(new Error('network down'));

        render(
            <WorkItemHierarchyTree
                workspaceId="ws-test"
                trackerViewKind="remote"
                trackerKinds={['azure-boards-backed']}
                remoteProviderFilter="azure-boards"
                selectedWorkItemId={null}
                onSelectWorkItem={vi.fn()}
                onCreated={vi.fn()}
                onCreateItem={vi.fn()}
                onImportFromRemote={vi.fn()}
            />,
        );

        const status = await screen.findByTestId('remote-sync-status-message');
        expect(status).toHaveTextContent('Unable to check Azure Boards sync status: network down');
        expect(status.dataset.statusTone).toBe('error');
        expect(await screen.findByTestId('hierarchy-empty')).toHaveTextContent('No Azure Boards-backed Epic trees yet');
    });

    it('hides remote provider affordances when the workspace remote is unsupported', async () => {
        mocks.isWorkItemsSyncEnabled.mockReturnValue(true);
        mocks.tree.mockClear();
        mocks.syncStatus.mockResolvedValue({
            enabled: true,
            disabled: false,
            maxItems: 200,
            providers: [],
        });

        render(
            <WorkItemHierarchyTree
                workspaceId="ws-test"
                trackerViewKind="remote"
                trackerKinds={['github-backed', 'azure-boards-backed']}
                remoteProviderFilter="all"
                selectedWorkItemId={null}
                onSelectWorkItem={vi.fn()}
                onCreated={vi.fn()}
                onCreateItem={vi.fn()}
                onImportFromRemote={vi.fn()}
            />,
        );

        const status = await screen.findByTestId('remote-sync-status-message');
        expect(status).toHaveTextContent('No supported remote provider was detected');
        expect(screen.queryByTestId('remote-provider-filter')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Import remote' })).toBeNull();
        expect(mocks.tree).not.toHaveBeenCalled();
    });
});
