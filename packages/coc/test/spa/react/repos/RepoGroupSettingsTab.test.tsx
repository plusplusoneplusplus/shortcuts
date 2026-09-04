/**
 * RepoGroupSettingsTab — the repo group's Settings tab (AC-02).
 *
 * Descriptions used to be edited from a collapsible strip on the Workspace tab;
 * they now live here, in a single scrolling pane with one card per topic. The
 * pane owns its own `GET /api/repo-groups/:id`, gated on being the visible tab,
 * and saves through the unchanged `PATCH /api/repo-groups/:id` with a
 * `{ descriptions }` body.
 *
 * Renders the real `RepoGroupMemberList`, so the edit/save/rollback assertions
 * exercise the actual row behaviour rather than a stub.
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockGetRepoGroup = vi.fn();
const mockUpdateRepoGroup = vi.fn();

vi.mock('../../../../src/server/spa/client/react/repos/repoGroupService', () => ({
    getRepoGroup: (...args: unknown[]) => mockGetRepoGroup(...args),
    updateRepoGroup: (...args: unknown[]) => mockUpdateRepoGroup(...args),
    REPO_GROUP_DESCRIPTION_MAX_LENGTH: 280,
}));

import { RepoGroupSettingsTab } from '../../../../src/server/spa/client/react/repos/RepoGroupSettingsTab';

const GROUP_ID = 'group-ai-repos';

const MEMBERS = [
    { workspaceId: 'r1', stale: false, name: 'shortcuts', rootPath: '/r/r1', description: 'The monorepo' },
    { workspaceId: 'r2', stale: false, name: 'docs', rootPath: '/r/r2' },
    { workspaceId: 'r3', stale: true, staleReason: 'path-missing', name: 'gone', rootPath: '/r/r3' },
];

beforeEach(() => {
    cleanup();
    mockGetRepoGroup.mockReset().mockResolvedValue({ id: GROUP_ID, name: 'AI Repos', members: MEMBERS });
    mockUpdateRepoGroup.mockReset().mockResolvedValue({ id: GROUP_ID, name: 'AI Repos', members: MEMBERS });
});

describe('RepoGroupSettingsTab', () => {
    it('renders the shared settings shell with one selected Repos item and no filter or inner card', async () => {
        render(<RepoGroupSettingsTab workspaceId={GROUP_ID} active />);

        const tab = screen.getByTestId('repo-group-settings-tab');
        expect(tab.getAttribute('data-workspace')).toBe(GROUP_ID);
        expect(screen.getByTestId('settings-sidebar')).toBeTruthy();
        expect(screen.getByTestId('settings-content-panel')).toBeTruthy();
        expect(screen.getByTestId('nav-item-repos').textContent).toBe('Repos');
        expect(screen.getByTestId('nav-item-repos').getAttribute('aria-current')).toBe('page');
        expect(screen.getByTestId('settings-section-title').textContent).toBe('Repos');
        expect(screen.getByTestId('settings-section-description').textContent).toContain('what each repo is for');
        expect(screen.queryByTestId('settings-filter-input')).toBeNull();
        expect(screen.queryByTestId('repo-group-settings-members-card')).toBeNull();

        await waitFor(() => expect(screen.getByTestId('repo-group-member-list')).toBeTruthy());
    });

    it('makes no group read while it is not the visible tab', () => {
        render(<RepoGroupSettingsTab workspaceId={GROUP_ID} active={false} />);
        expect(mockGetRepoGroup).not.toHaveBeenCalled();
        expect(screen.queryByTestId('repo-group-member-list')).toBeNull();
    });

    it('lists every member directly in the section body with its name, path, stale badge and description', async () => {
        render(<RepoGroupSettingsTab workspaceId={GROUP_ID} active />);
        await waitFor(() => expect(mockGetRepoGroup).toHaveBeenCalledWith(GROUP_ID, undefined));

        await waitFor(() => expect(screen.getByTestId('repo-group-member-description-r1')).toBeTruthy());
        expect((screen.getByTestId('repo-group-member-description-r1') as HTMLInputElement).value).toBe('The monorepo');
        expect((screen.getByTestId('repo-group-member-description-r2') as HTMLInputElement).value).toBe('');

        const staleRow = screen.getByTestId('repo-group-member-row-r3');
        expect(staleRow.textContent).toContain('gone');
        expect(staleRow.textContent).toContain('/r/r3');
        expect(screen.getAllByTestId('repo-group-stale-badge')).toHaveLength(1);
        expect(screen.getByTestId('repo-group-member-list').parentElement?.parentElement)
            .toBe(screen.getByTestId('settings-content-panel'));
    });

    it('saves an edited description on Enter', async () => {
        render(<RepoGroupSettingsTab workspaceId={GROUP_ID} active />);
        await waitFor(() => expect(screen.getByTestId('repo-group-member-description-r2')).toBeTruthy());

        fireEvent.change(screen.getByTestId('repo-group-member-description-r2'), { target: { value: 'Docs site' } });
        fireEvent.keyDown(screen.getByTestId('repo-group-member-description-r2'), { key: 'Enter' });

        await waitFor(() => expect(mockUpdateRepoGroup)
            .toHaveBeenCalledWith(GROUP_ID, { descriptions: { r2: 'Docs site' } }, undefined));
    });

    it('saves on blur, and clearing a description saves the empty string', async () => {
        render(<RepoGroupSettingsTab workspaceId={GROUP_ID} active />);
        await waitFor(() => expect(screen.getByTestId('repo-group-member-description-r1')).toBeTruthy());

        fireEvent.change(screen.getByTestId('repo-group-member-description-r1'), { target: { value: '' } });
        fireEvent.blur(screen.getByTestId('repo-group-member-description-r1'));

        await waitFor(() => expect(mockUpdateRepoGroup)
            .toHaveBeenCalledWith(GROUP_ID, { descriptions: { r1: '' } }, undefined));
    });

    it('reverts on Escape without saving', async () => {
        render(<RepoGroupSettingsTab workspaceId={GROUP_ID} active />);
        await waitFor(() => expect(screen.getByTestId('repo-group-member-description-r1')).toBeTruthy());

        const input = screen.getByTestId('repo-group-member-description-r1') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'Scratch' } });
        fireEvent.keyDown(input, { key: 'Escape' });
        fireEvent.blur(input);

        expect(mockUpdateRepoGroup).not.toHaveBeenCalled();
        expect((screen.getByTestId('repo-group-member-description-r1') as HTMLInputElement).value).toBe('The monorepo');
    });

    it('rolls the row back and shows the server error when the save fails', async () => {
        mockUpdateRepoGroup.mockRejectedValue(new Error('Group is read-only'));
        render(<RepoGroupSettingsTab workspaceId={GROUP_ID} active />);
        await waitFor(() => expect(screen.getByTestId('repo-group-member-description-r1')).toBeTruthy());

        fireEvent.change(screen.getByTestId('repo-group-member-description-r1'), { target: { value: 'Next' } });
        fireEvent.keyDown(screen.getByTestId('repo-group-member-description-r1'), { key: 'Enter' });

        await waitFor(() => expect(screen.getByTestId('repo-group-member-description-error-r1').textContent)
            .toContain('Group is read-only'));
        expect((screen.getByTestId('repo-group-member-description-r1') as HTMLInputElement).value).toBe('The monorepo');
    });

    it('routes the read and the save to the server owning a remote group', async () => {
        render(<RepoGroupSettingsTab workspaceId={GROUP_ID} baseUrl="http://remote:3000" active />);
        await waitFor(() => expect(mockGetRepoGroup).toHaveBeenCalledWith(GROUP_ID, 'http://remote:3000'));

        fireEvent.change(screen.getByTestId('repo-group-member-description-r2'), { target: { value: 'Docs site' } });
        fireEvent.blur(screen.getByTestId('repo-group-member-description-r2'));
        await waitFor(() => expect(mockUpdateRepoGroup)
            .toHaveBeenCalledWith(GROUP_ID, { descriptions: { r2: 'Docs site' } }, 'http://remote:3000'));
    });

    it('points an empty group at the group edit dialog', async () => {
        mockGetRepoGroup.mockResolvedValue({ id: GROUP_ID, name: 'AI Repos', members: [] });
        render(<RepoGroupSettingsTab workspaceId={GROUP_ID} active />);

        await waitFor(() => expect(screen.getByTestId('repo-group-members-empty')).toBeTruthy());
        expect(screen.getByTestId('repo-group-members-empty').textContent).toContain('Edit group');
    });

    it('shows a loading placeholder until the group read resolves', async () => {
        let resolveRead: (value: unknown) => void = () => {};
        mockGetRepoGroup.mockReturnValue(new Promise(resolve => { resolveRead = resolve; }));
        render(<RepoGroupSettingsTab workspaceId={GROUP_ID} active />);

        expect(screen.getByTestId('repo-group-settings-loading')).toBeTruthy();
        resolveRead({ id: GROUP_ID, name: 'AI Repos', members: MEMBERS });
        await waitFor(() => expect(screen.getByTestId('repo-group-member-list')).toBeTruthy());
    });

    it('ticks a member read-only and PATCHes just that flag', async () => {
        render(<RepoGroupSettingsTab workspaceId={GROUP_ID} active />);
        await waitFor(() => expect(screen.getByTestId('repo-group-member-read-only-r2')).toBeTruthy());

        fireEvent.click(screen.getByTestId('repo-group-member-read-only-r2'));

        await waitFor(() => expect(mockUpdateRepoGroup)
            .toHaveBeenCalledWith(GROUP_ID, { readOnly: { r2: true } }, undefined));
        expect((screen.getByTestId('repo-group-member-read-only-r2') as HTMLInputElement).checked).toBe(true);
    });

    it('shows a loaded flag as ticked and clears it with an explicit false', async () => {
        mockGetRepoGroup.mockResolvedValue({
            id: GROUP_ID,
            name: 'AI Repos',
            members: [{ workspaceId: 'r1', stale: false, name: 'shortcuts', rootPath: '/r/r1', readOnly: true }],
        });
        render(<RepoGroupSettingsTab workspaceId={GROUP_ID} active />);
        await waitFor(() => expect((screen.getByTestId('repo-group-member-read-only-r1') as HTMLInputElement).checked)
            .toBe(true));
        expect(screen.getByTestId('repo-group-read-only-badge-r1')).toBeTruthy();

        fireEvent.click(screen.getByTestId('repo-group-member-read-only-r1'));

        await waitFor(() => expect(mockUpdateRepoGroup)
            .toHaveBeenCalledWith(GROUP_ID, { readOnly: { r1: false } }, undefined));
    });

    it('reverts the checkbox and shows the server error when the flag save fails', async () => {
        mockUpdateRepoGroup.mockRejectedValue(new Error('readOnly must be a boolean'));
        render(<RepoGroupSettingsTab workspaceId={GROUP_ID} active />);
        await waitFor(() => expect(screen.getByTestId('repo-group-member-read-only-r1')).toBeTruthy());

        fireEvent.click(screen.getByTestId('repo-group-member-read-only-r1'));

        await waitFor(() => expect(screen.getByTestId('repo-group-member-description-error-r1').textContent)
            .toContain('readOnly must be a boolean'));
        expect((screen.getByTestId('repo-group-member-read-only-r1') as HTMLInputElement).checked).toBe(false);
    });
});
