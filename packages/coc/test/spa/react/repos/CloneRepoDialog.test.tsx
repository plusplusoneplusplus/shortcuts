import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AppProvider } from '../../../../src/server/spa/client/react/contexts/AppContext';
import { QueueProvider } from '../../../../src/server/spa/client/react/contexts/QueueContext';
import {
    CloneRepoDialog,
    deriveRepoName,
    suggestNonConflictingName,
} from '../../../../src/server/spa/client/react/repos/CloneRepoDialog';

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
    // CloneRepoDialog navigates via useWorkspaceNavigation, which reads queue
    // context (selected-task-per-repo), so the dialog needs QueueProvider too.
    return <AppProvider><QueueProvider>{children}</QueueProvider></AppProvider>;
}

describe('deriveRepoName', () => {
    it('strips .git suffix from HTTPS URLs', () => {
        expect(deriveRepoName('https://github.com/org/repo.git')).toBe('repo');
    });

    it('handles URLs without .git suffix', () => {
        expect(deriveRepoName('https://github.com/org/myproject')).toBe('myproject');
    });

    it('handles SSH scp-style URLs', () => {
        expect(deriveRepoName('git@github.com:org/service.git')).toBe('service');
    });

    it('returns empty string for blank input', () => {
        expect(deriveRepoName('')).toBe('');
    });
});

describe('suggestNonConflictingName', () => {
    it('returns the base name when no conflict', () => {
        expect(suggestNonConflictingName('repo', new Set())).toBe('repo');
    });

    it('appends -2 when base name conflicts', () => {
        expect(suggestNonConflictingName('repo', new Set(['repo']))).toBe('repo-2');
    });

    it('increments suffix until a free slot is found', () => {
        expect(suggestNonConflictingName('repo', new Set(['repo', 'repo-2', 'repo-3']))).toBe('repo-4');
    });
});

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
            dirName: 'repo',
        }));
        // Id is server-authoritative now — the client sends only name + path,
        // and navigates using the id returned by the server (mocked 'ws-cloned').
        expect(repositoryServiceMocks.registerWorkspace).toHaveBeenCalledWith({
            name: 'repo',
            rootPath: '/projects/repo',
        });
        // Per-workspace route persistence lands on an explicit sub-tab; with no
        // remembered route for a freshly cloned workspace the default is chats.
        expect(location.hash).toBe('#repos/ws-cloned/chats');
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

    it('auto-derives the folder name from the URL', async () => {
        render(
            <Wrap>
                <CloneRepoDialog open onClose={() => {}} onSuccess={() => {}} />
            </Wrap>,
        );

        await screen.findByText('/projects');
        fireEvent.change(screen.getByTestId('clone-repo-url'), {
            target: { value: 'https://github.com/org/my-project.git' },
        });

        expect(screen.getByTestId('clone-folder-name')).toHaveValue('my-project');
    });

    it('detects a conflict and pre-fills a suffixed folder name with a note', async () => {
        // Browser returns an entry whose name matches the derived repo name.
        repositoryServiceMocks.browseWorkspaceFolders.mockResolvedValue({
            path: '/projects',
            parent: '/',
            entries: [{ name: 'shortcuts', isGitRepo: true }],
        });

        render(
            <Wrap>
                <CloneRepoDialog open onClose={() => {}} onSuccess={() => {}} />
            </Wrap>,
        );

        await screen.findByText('/projects');
        fireEvent.change(screen.getByTestId('clone-repo-url'), {
            target: { value: 'https://github.com/org/shortcuts.git' },
        });

        await waitFor(() => {
            expect(screen.getByTestId('clone-folder-name')).toHaveValue('shortcuts-2');
        });
        expect(screen.getByTestId('clone-folder-conflict-note')).toHaveTextContent(
            'A folder named "shortcuts" already exists here.',
        );
    });

    it('updates the conflict suggestion when the user navigates to a new folder', async () => {
        // Initial browse: no conflict.
        repositoryServiceMocks.browseWorkspaceFolders
            .mockResolvedValueOnce({
                path: '/projects',
                parent: '/',
                entries: [],
            })
            // After navigating into a sub-folder that already has the repo.
            .mockResolvedValueOnce({
                path: '/projects/work',
                parent: '/projects',
                entries: [{ name: 'shortcuts' }],
            });

        render(
            <Wrap>
                <CloneRepoDialog open onClose={() => {}} onSuccess={() => {}} />
            </Wrap>,
        );

        await screen.findByText('/projects');
        fireEvent.change(screen.getByTestId('clone-repo-url'), {
            target: { value: 'https://github.com/org/shortcuts.git' },
        });

        // No conflict yet.
        expect(screen.getByTestId('clone-folder-name')).toHaveValue('shortcuts');
        expect(screen.queryByTestId('clone-folder-conflict-note')).toBeNull();

        // Simulate navigating to /projects/work (click the ".." entry — here we
        // call browseWorkspaceFolders directly by clicking the parent button).
        fireEvent.click(screen.getByText('📁 ..'));

        await waitFor(() => {
            expect(screen.getByTestId('clone-folder-name')).toHaveValue('shortcuts-2');
        });
        expect(screen.getByTestId('clone-folder-conflict-note')).toBeInTheDocument();
    });

    it('does not overwrite a manually-edited folder name when navigating the browser', async () => {
        repositoryServiceMocks.browseWorkspaceFolders
            .mockResolvedValueOnce({
                path: '/projects',
                parent: '/',
                entries: [],
            })
            .mockResolvedValueOnce({
                path: '/projects/work',
                parent: '/projects',
                entries: [{ name: 'shortcuts' }],
            });

        render(
            <Wrap>
                <CloneRepoDialog open onClose={() => {}} onSuccess={() => {}} />
            </Wrap>,
        );

        await screen.findByText('/projects');
        fireEvent.change(screen.getByTestId('clone-repo-url'), {
            target: { value: 'https://github.com/org/shortcuts.git' },
        });

        // User manually renames the folder.
        fireEvent.change(screen.getByTestId('clone-folder-name'), {
            target: { value: 'my-shortcuts' },
        });

        // Navigate to a folder that contains "shortcuts".
        fireEvent.click(screen.getByText('📁 ..'));

        await waitFor(() =>
            expect(repositoryServiceMocks.browseWorkspaceFolders).toHaveBeenCalledTimes(2),
        );

        // Manual name must be preserved.
        expect(screen.getByTestId('clone-folder-name')).toHaveValue('my-shortcuts');
        expect(screen.queryByTestId('clone-folder-conflict-note')).toBeNull();
    });

    it('sends the custom folder name to the clone API', async () => {
        render(
            <Wrap>
                <CloneRepoDialog open onClose={() => {}} onSuccess={() => {}} />
            </Wrap>,
        );

        await screen.findByText('/projects');
        fireEvent.change(screen.getByTestId('clone-repo-url'), {
            target: { value: 'https://github.com/org/repo.git' },
        });
        fireEvent.change(screen.getByTestId('clone-folder-name'), {
            target: { value: 'my-custom-name' },
        });
        fireEvent.click(screen.getByTestId('clone-repo-submit'));

        await waitFor(() => expect(repositoryServiceMocks.cloneRepository).toHaveBeenCalledWith({
            url: 'https://github.com/org/repo.git',
            parentDir: '/projects',
            dirName: 'my-custom-name',
        }));
    });

    it('clears the conflict note when the user manually edits the folder name', async () => {
        repositoryServiceMocks.browseWorkspaceFolders.mockResolvedValue({
            path: '/projects',
            parent: '/',
            entries: [{ name: 'shortcuts' }],
        });

        render(
            <Wrap>
                <CloneRepoDialog open onClose={() => {}} onSuccess={() => {}} />
            </Wrap>,
        );

        await screen.findByText('/projects');
        fireEvent.change(screen.getByTestId('clone-repo-url'), {
            target: { value: 'https://github.com/org/shortcuts.git' },
        });

        await waitFor(() =>
            expect(screen.getByTestId('clone-folder-conflict-note')).toBeInTheDocument(),
        );

        // User edits the name → note disappears.
        fireEvent.change(screen.getByTestId('clone-folder-name'), {
            target: { value: 'shortcuts-personal' },
        });

        expect(screen.queryByTestId('clone-folder-conflict-note')).toBeNull();
    });
});
