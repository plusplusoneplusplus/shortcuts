import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AppProvider } from '../../../../src/server/spa/client/react/contexts/AppContext';
import { CloneRepoDialog } from '../../../../src/server/spa/client/react/repos/CloneRepoDialog';

const repositoryServiceMocks = vi.hoisted(() => ({
    browseWorkspaceFolders: vi.fn(),
    cloneRepository: vi.fn(),
    getRepositoryApiErrorMessage: vi.fn((error: unknown, fallback: string, networkFallback?: string) => {
        if (error instanceof Error && error.message) return error.message;
        return networkFallback ?? fallback;
    }),
    registerWorkspace: vi.fn(),
}));

vi.mock('../../../../src/server/spa/client/react/repos/repositoryService', () => ({
    ...repositoryServiceMocks,
}));

function Wrap({ children }: { children: ReactNode }) {
    return <AppProvider>{children}</AppProvider>;
}

describe('CloneRepoDialog', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        location.hash = '';
        repositoryServiceMocks.browseWorkspaceFolders.mockResolvedValue({
            path: '/projects',
            parent: '/projects-parent',
            entries: [{ name: 'team' }],
        });
        repositoryServiceMocks.cloneRepository.mockResolvedValue({ clonedPath: '/projects/repo' });
        repositoryServiceMocks.registerWorkspace.mockResolvedValue({
            id: 'ws-cloned',
            name: 'repo',
            rootPath: '/projects/repo',
        });
    });

    it('clones into the selected parent folder, registers the cloned path, and navigates to the workspace', async () => {
        const onSuccess = vi.fn();
        const onClose = vi.fn();
        render(
            <Wrap>
                <CloneRepoDialog open onClose={onClose} onSuccess={onSuccess} />
            </Wrap>,
        );

        await screen.findByText('/projects');
        fireEvent.change(screen.getByTestId('clone-repo-url'), {
            target: { value: 'git@github.com:org/repo.git' },
        });
        fireEvent.click(screen.getByTestId('clone-repo-submit'));

        await waitFor(() => expect(repositoryServiceMocks.cloneRepository).toHaveBeenCalledWith({
            url: 'git@github.com:org/repo.git',
            parentDir: '/projects',
        }));
        expect(repositoryServiceMocks.registerWorkspace).toHaveBeenCalledWith({
            id: expect.stringMatching(/^ws-/),
            name: 'repo',
            rootPath: '/projects/repo',
        });
        expect(location.hash).toBe('#repos/ws-cloned');
        expect(onSuccess).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('lets the user pick a nested parent folder with the filesystem browser', async () => {
        repositoryServiceMocks.browseWorkspaceFolders
            .mockResolvedValueOnce({
                path: '/projects',
                parent: '/',
                entries: [{ name: 'team' }],
            })
            .mockResolvedValueOnce({
                path: '/projects/team',
                parent: '/projects',
                entries: [],
            });

        render(
            <Wrap>
                <CloneRepoDialog open onClose={() => {}} onSuccess={() => {}} />
            </Wrap>,
        );

        const entry = await screen.findByTestId('clone-folder-browser-entry');
        fireEvent.click(entry);

        await waitFor(() => expect(repositoryServiceMocks.browseWorkspaceFolders).toHaveBeenCalledWith('/projects/team'));
        expect(screen.getByTestId('clone-parent-dir')).toHaveValue('/projects/team');
    });

    it('surfaces clone failures verbatim', async () => {
        repositoryServiceMocks.cloneRepository.mockRejectedValue(new Error('fatal: destination path already exists'));

        render(
            <Wrap>
                <CloneRepoDialog open onClose={() => {}} onSuccess={() => {}} />
            </Wrap>,
        );

        await screen.findByText('/projects');
        fireEvent.change(screen.getByTestId('clone-repo-url'), {
            target: { value: 'https://example.com/repo.git' },
        });
        fireEvent.click(screen.getByTestId('clone-repo-submit'));

        expect(await screen.findByTestId('clone-repo-error')).toHaveTextContent('fatal: destination path already exists');
        expect(repositoryServiceMocks.registerWorkspace).not.toHaveBeenCalled();
    });

    it('validates required inputs before cloning', async () => {
        render(
            <Wrap>
                <CloneRepoDialog open onClose={() => {}} onSuccess={() => {}} />
            </Wrap>,
        );

        await screen.findByText('/projects');
        fireEvent.click(screen.getByTestId('clone-repo-submit'));

        expect(await screen.findByTestId('clone-repo-error')).toHaveTextContent('Repository URL is required');
        expect(repositoryServiceMocks.cloneRepository).not.toHaveBeenCalled();
    });
});
