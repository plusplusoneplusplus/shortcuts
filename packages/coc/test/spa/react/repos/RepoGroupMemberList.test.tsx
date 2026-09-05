/**
 * RepoGroupMemberList — inline per-member description editing (AC-03).
 *
 * Covers the placeholder empty state, saving on Enter and on blur, Escape
 * cancelling, the no-op when the text did not change, and the optimistic
 * update rolling back with an error when the PATCH fails.
 *
 * Also covers the per-member read-only checkbox: ticking and unticking each
 * issue their own PATCH, and a failed PATCH flips the box back and shows the
 * row's error line.
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockUpdateRepoGroup = vi.fn();

vi.mock('../../../../src/server/spa/client/react/repos/repoGroupService', () => ({
    updateRepoGroup: (...args: unknown[]) => mockUpdateRepoGroup(...args),
    REPO_GROUP_DESCRIPTION_MAX_LENGTH: 280,
}));

import { RepoGroupMemberList } from '../../../../src/server/spa/client/react/repos/RepoGroupMemberList';

const GROUP_ID = 'group-frontend';

const MEMBERS = [
    { workspaceId: 'r1', stale: false, name: 'api', rootPath: '/r/api' },
    { workspaceId: 'r2', stale: false, name: 'web', rootPath: '/r/web', description: 'The dashboard SPA' },
];

function field(memberId: string): HTMLInputElement {
    return screen.getByTestId(`repo-group-member-description-${memberId}`) as HTMLInputElement;
}

function readOnlyBox(memberId: string): HTMLInputElement {
    return screen.getByTestId(`repo-group-member-read-only-${memberId}`) as HTMLInputElement;
}

function renderList(members: any[] = MEMBERS, baseUrl?: string) {
    return render(<RepoGroupMemberList workspaceId={GROUP_ID} baseUrl={baseUrl} members={members} />);
}

beforeEach(() => {
    cleanup();
    mockUpdateRepoGroup.mockReset().mockResolvedValue({ id: GROUP_ID, name: 'Frontend', members: [] });
});

describe('RepoGroupMemberList', () => {
    it('shows a muted placeholder for a member with no description and the saved text otherwise', () => {
        renderList();

        expect(field('r1').value).toBe('');
        expect(field('r1').placeholder).toBe('Add description');
        expect(field('r2').value).toBe('The dashboard SPA');
    });

    it('lists every member with its name, path and stale badge', () => {
        renderList([...MEMBERS, { workspaceId: 'r3', stale: true, staleReason: 'workspace-removed', name: 'gone' }]);

        expect(screen.getByTestId('repo-group-member-row-r1').textContent).toContain('/r/api');
        expect(screen.getByTestId('repo-group-stale-badge').textContent).toBe('removed');
    });

    it('renders an empty-state row for a group with no members', () => {
        renderList([]);

        expect(screen.getByTestId('repo-group-members-empty')).toBeTruthy();
    });

    it('saves on Enter, patching only the edited member', async () => {
        renderList();

        fireEvent.change(field('r1'), { target: { value: 'The REST API' } });
        fireEvent.keyDown(field('r1'), { key: 'Enter' });

        await waitFor(() => expect(mockUpdateRepoGroup).toHaveBeenCalledTimes(1));
        expect(mockUpdateRepoGroup).toHaveBeenCalledWith(GROUP_ID, { descriptions: { r1: 'The REST API' } }, undefined);
        expect(field('r1').value).toBe('The REST API');
        // The programmatic blur that follows Enter must not fire a second PATCH.
        fireEvent.blur(field('r1'));
        expect(mockUpdateRepoGroup).toHaveBeenCalledTimes(1);
    });

    it('saves on blur and routes to the group\'s own server', async () => {
        renderList(MEMBERS, 'http://remote:3000');

        fireEvent.change(field('r2'), { target: { value: 'The web UI' } });
        fireEvent.blur(field('r2'));

        await waitFor(() => expect(mockUpdateRepoGroup).toHaveBeenCalledWith(
            GROUP_ID,
            { descriptions: { r2: 'The web UI' } },
            'http://remote:3000'
        ));
        expect(field('r2').value).toBe('The web UI');
    });

    it('clears a description by saving an empty string', async () => {
        renderList();

        fireEvent.change(field('r2'), { target: { value: '' } });
        fireEvent.blur(field('r2'));

        await waitFor(() => expect(mockUpdateRepoGroup).toHaveBeenCalledWith(GROUP_ID, { descriptions: { r2: '' } }, undefined));
        expect(field('r2').placeholder).toBe('Add description');
    });

    it('cancels on Escape, restoring the saved text without a request', () => {
        renderList();

        fireEvent.change(field('r2'), { target: { value: 'scratch text' } });
        fireEvent.keyDown(field('r2'), { key: 'Escape' });
        fireEvent.blur(field('r2'));

        expect(field('r2').value).toBe('The dashboard SPA');
        expect(mockUpdateRepoGroup).not.toHaveBeenCalled();
    });

    it('does not patch when the text is unchanged', () => {
        renderList();

        fireEvent.change(field('r2'), { target: { value: 'The dashboard SPA' } });
        fireEvent.blur(field('r2'));

        expect(mockUpdateRepoGroup).not.toHaveBeenCalled();
    });

    it('rolls back the optimistic text and surfaces the error when the save fails', async () => {
        mockUpdateRepoGroup.mockRejectedValue(new Error('description is too long'));
        renderList();

        fireEvent.change(field('r2'), { target: { value: 'nope' } });
        fireEvent.keyDown(field('r2'), { key: 'Enter' });

        await waitFor(() => expect(screen.getByTestId('repo-group-member-description-error-r2')).toBeTruthy());
        expect(screen.getByTestId('repo-group-member-description-error-r2').textContent).toContain('description is too long');
        expect(field('r2').value).toBe('The dashboard SPA');
    });

    it('caps the field at the server\'s 280-character limit', () => {
        renderList();

        expect(field('r1').maxLength).toBe(280);
    });

    it('ticks read-only, PATCHing the flag for that member only and badging the row', async () => {
        renderList();

        expect(readOnlyBox('r1').checked).toBe(false);
        expect(screen.queryByTestId('repo-group-read-only-badge-r1')).toBeNull();

        fireEvent.click(readOnlyBox('r1'));

        await waitFor(() => expect(mockUpdateRepoGroup).toHaveBeenCalledTimes(1));
        expect(mockUpdateRepoGroup).toHaveBeenCalledWith(GROUP_ID, { readOnly: { r1: true } }, undefined);
        expect(readOnlyBox('r1').checked).toBe(true);
        expect(readOnlyBox('r2').checked).toBe(false);
        expect(screen.getByTestId('repo-group-read-only-badge-r1')).toBeTruthy();
    });

    it('unticks read-only by sending an explicit false, routed to the group\'s server', async () => {
        renderList([
            { workspaceId: 'r1', stale: false, name: 'api', rootPath: '/r/api', readOnly: true },
        ], 'http://remote:3000');

        expect(readOnlyBox('r1').checked).toBe(true);
        fireEvent.click(readOnlyBox('r1'));

        await waitFor(() => expect(mockUpdateRepoGroup).toHaveBeenCalledWith(
            GROUP_ID,
            { readOnly: { r1: false } },
            'http://remote:3000',
        ));
        expect(readOnlyBox('r1').checked).toBe(false);
        expect(screen.queryByTestId('repo-group-read-only-badge-r1')).toBeNull();
    });

    it('reverts the checkbox and surfaces the error when the read-only PATCH fails', async () => {
        mockUpdateRepoGroup.mockRejectedValue(new Error('group is not writable'));
        renderList();

        fireEvent.click(readOnlyBox('r1'));

        await waitFor(() => expect(screen.getByTestId('repo-group-member-description-error-r1')).toBeTruthy());
        expect(screen.getByTestId('repo-group-member-description-error-r1').textContent)
            .toContain('group is not writable');
        expect(readOnlyBox('r1').checked).toBe(false);
        expect(screen.queryByTestId('repo-group-read-only-badge-r1')).toBeNull();
    });
});
