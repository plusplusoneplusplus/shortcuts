/**
 * RepoGroupView's "Member repos" strip (AC-03).
 *
 * The strip is where a user attaches a description to each repo in the group.
 * It is collapsed by default, and on a shell without the right dock a collapsed
 * strip must not cost a `GET /api/repo-groups/:id` — when the dock IS present
 * both surfaces share the single read.
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockDispatch = vi.fn();
let mockAppState: any = {};
let mockBreakpoint = 'desktop';
let mockSplitPanelEnabled = false;
let mockRemoteGroupWorkspaces: any[] = [];
const mockGetRepoGroup = vi.fn();
const mockUpdateRepoGroup = vi.fn();

vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({ state: mockAppState, dispatch: mockDispatch }),
}));
vi.mock('../../../../src/server/spa/client/react/contexts/ReposContext', () => ({
    useReposOptional: () => ({ remoteGroupWorkspaces: mockRemoteGroupWorkspaces }),
}));
vi.mock('../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ state: { selectedTaskIdByRepo: {} } }),
}));
vi.mock('../../../../src/server/spa/client/react/layout/Router', async () => {
    const routes = await import('../../../../src/server/spa/client/react/layout/dashboardRoutes');
    return { buildRepoSubTabSuffix: routes.buildRepoSubTabSuffix };
});
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useSchedulesInScheduledSlideEnabled', () => ({
    useSchedulesInScheduledSlideEnabled: () => false,
}));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useRemoteShellEnabled', () => ({
    useRemoteShellEnabled: () => false,
}));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useSplitWorkspacePanelEnabled', () => ({
    useSplitWorkspacePanelEnabled: () => mockSplitPanelEnabled,
}));
vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({
        breakpoint: mockBreakpoint,
        isMobile: mockBreakpoint === 'mobile',
        isTablet: false,
        isDesktop: mockBreakpoint === 'desktop',
    }),
}));
vi.mock('../../../../src/server/spa/client/react/repos/repoGroupService', () => ({
    getRepoGroup: (...args: unknown[]) => mockGetRepoGroup(...args),
    updateRepoGroup: (...args: unknown[]) => mockUpdateRepoGroup(...args),
    REPO_GROUP_DESCRIPTION_MAX_LENGTH: 280,
}));
vi.mock('../../../../src/server/spa/client/react/features/chat/RepoChatTab', () => ({
    RepoChatTab: ({ workspaceId }: { workspaceId: string }) => (
        <div data-testid="stub-chat-tab" data-workspace={workspaceId} />
    ),
}));
vi.mock('../../../../src/server/spa/client/react/features/notes/NotesView', () => ({
    NotesView: ({ workspaceId }: { workspaceId: string }) => (
        <div data-testid="stub-notes-view" data-workspace={workspaceId} />
    ),
}));

import { RepoGroupView } from '../../../../src/server/spa/client/react/repos/RepoGroupView';

const GROUP_ID = 'group-ai-repos';

const MEMBERS = [
    { workspaceId: 'r1', stale: false, name: 'shortcuts', rootPath: '/r/r1', description: 'The monorepo' },
    { workspaceId: 'r2', stale: false, name: 'docs', rootPath: '/r/r2' },
];

beforeEach(() => {
    cleanup();
    localStorage.clear();
    mockDispatch.mockReset();
    mockGetRepoGroup.mockReset().mockResolvedValue({ id: GROUP_ID, name: 'AI Repos', members: MEMBERS });
    mockUpdateRepoGroup.mockReset().mockResolvedValue({ id: GROUP_ID, name: 'AI Repos', members: MEMBERS });
    mockBreakpoint = 'desktop';
    mockSplitPanelEnabled = false;
    mockRemoteGroupWorkspaces = [];
    mockAppState = {
        activeRepoSubTab: 'chats',
        selectedNotePath: null,
        workspaces: [{ id: GROUP_ID, name: 'AI Repos', rootPath: `/data/repos/${GROUP_ID}` }],
    };
});

describe('RepoGroupView member strip (AC-03)', () => {
    it('starts collapsed and makes no group read until it is opened', async () => {
        render(<RepoGroupView workspaceId={GROUP_ID} />);

        expect(screen.queryByTestId('repo-group-members-panel')).toBeNull();
        expect(mockGetRepoGroup).not.toHaveBeenCalled();

        fireEvent.click(screen.getByTestId('repo-group-members-toggle'));
        await waitFor(() => expect(mockGetRepoGroup).toHaveBeenCalledWith(GROUP_ID, undefined));
        expect(screen.getByTestId('repo-group-members-panel')).toBeTruthy();
    });

    it('lists every member with its description field once opened', async () => {
        render(<RepoGroupView workspaceId={GROUP_ID} />);
        fireEvent.click(screen.getByTestId('repo-group-members-toggle'));

        await waitFor(() => expect(screen.getByTestId('repo-group-member-description-r1')).toBeTruthy());
        expect((screen.getByTestId('repo-group-member-description-r1') as HTMLInputElement).value).toBe('The monorepo');
        expect((screen.getByTestId('repo-group-member-description-r2') as HTMLInputElement).value).toBe('');
    });

    it('saves an edited description back to the group', async () => {
        render(<RepoGroupView workspaceId={GROUP_ID} />);
        fireEvent.click(screen.getByTestId('repo-group-members-toggle'));
        await waitFor(() => expect(screen.getByTestId('repo-group-member-description-r2')).toBeTruthy());

        fireEvent.change(screen.getByTestId('repo-group-member-description-r2'), { target: { value: 'Docs site' } });
        fireEvent.keyDown(screen.getByTestId('repo-group-member-description-r2'), { key: 'Enter' });

        await waitFor(() => expect(mockUpdateRepoGroup)
            .toHaveBeenCalledWith(GROUP_ID, { descriptions: { r2: 'Docs site' } }, undefined));
    });

    it('routes the read and the save to the server owning a remote group', async () => {
        mockAppState.workspaces = [];
        mockRemoteGroupWorkspaces = [{ id: GROUP_ID, name: 'AI Repos', baseUrl: 'http://remote:3000' }];
        render(<RepoGroupView workspaceId={GROUP_ID} />);
        fireEvent.click(screen.getByTestId('repo-group-members-toggle'));

        await waitFor(() => expect(mockGetRepoGroup).toHaveBeenCalledWith(GROUP_ID, 'http://remote:3000'));
        fireEvent.change(screen.getByTestId('repo-group-member-description-r2'), { target: { value: 'Docs site' } });
        fireEvent.blur(screen.getByTestId('repo-group-member-description-r2'));
        await waitFor(() => expect(mockUpdateRepoGroup)
            .toHaveBeenCalledWith(GROUP_ID, { descriptions: { r2: 'Docs site' } }, 'http://remote:3000'));
    });

    it('reuses the dock\'s single read instead of fetching the group twice', async () => {
        mockSplitPanelEnabled = true;
        render(<RepoGroupView workspaceId={GROUP_ID} />);
        await waitFor(() => expect(mockGetRepoGroup).toHaveBeenCalledTimes(1));

        fireEvent.click(screen.getByTestId('repo-group-members-toggle'));
        await waitFor(() => expect(screen.getByTestId('repo-group-member-description-r1')).toBeTruthy());
        expect(mockGetRepoGroup).toHaveBeenCalledTimes(1);
    });

    it('collapses again on a second click', async () => {
        render(<RepoGroupView workspaceId={GROUP_ID} />);
        const toggle = screen.getByTestId('repo-group-members-toggle');

        fireEvent.click(toggle);
        await waitFor(() => expect(screen.getByTestId('repo-group-members-panel')).toBeTruthy());
        fireEvent.click(toggle);
        expect(screen.queryByTestId('repo-group-members-panel')).toBeNull();
    });
});
