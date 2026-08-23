/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const repositoryServiceMocks = vi.hoisted(() => ({
    browseWorkspaceFolders: vi.fn(),
    discoverWorkspaces: vi.fn(),
    registerWorkspace: vi.fn(),
    getRepositoryApiErrorMessage: vi.fn((error: unknown, fallback: string, networkFallback?: string) => {
        if (error instanceof Error && error.message) return error.message;
        return networkFallback ?? fallback;
    }),
}));

vi.mock('../../../../../src/server/spa/client/react/ui', () => ({
    Dialog: ({ open, children, footer, title, id }: any) =>
        open ? (
            <div data-testid="dialog" id={id}>
                <span data-testid="dialog-title">{title}</span>
                <div data-testid="dialog-body">{children}</div>
                <div data-testid="dialog-footer">{footer}</div>
            </div>
        ) : null,
    Button: ({ onClick, loading, disabled, children, id, ...rest }: any) => (
        <button
            onClick={onClick}
            disabled={loading || disabled}
            id={id}
            data-testid={rest['data-testid'] ?? id}
        >
            {children}
        </button>
    ),
}));

vi.mock('../../../../../src/server/spa/client/react/repos/repositoryService', () => ({
    ...repositoryServiceMocks,
}));

vi.mock('../../../../../src/server/spa/client/react/repos/repoGrouping', () => ({
    hashString: (s: string) => 'hash-' + s.replace(/[^a-z0-9]/gi, ''),
}));

import { AddFolderDialog } from '../../../../../src/server/spa/client/react/repos/AddFolderDialog';

describe('AddFolderDialog', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        repositoryServiceMocks.browseWorkspaceFolders.mockResolvedValue({
            path: '/workspace-root',
            parent: '/',
            entries: [{ name: 'repo-a', isGitRepo: true }],
        });
        repositoryServiceMocks.discoverWorkspaces.mockResolvedValue({ repos: [] });
        repositoryServiceMocks.registerWorkspace.mockResolvedValue({});
        repositoryServiceMocks.getRepositoryApiErrorMessage.mockImplementation((error: unknown, fallback: string, networkFallback?: string) => {
            if (error instanceof Error && error.message) return error.message;
            return networkFallback ?? fallback;
        });
    });

    it('browses the default folder through the typed repository service', async () => {
        render(<AddFolderDialog open onClose={vi.fn()} onAdded={vi.fn()} />);

        await waitFor(() => {
            expect(repositoryServiceMocks.browseWorkspaceFolders).toHaveBeenCalledWith('~', undefined);
        });
        expect(screen.getByTestId('folder-browser')).toBeTruthy();
        // The waitFor above only proves the call was made; the breadcrumb still
        // reads "…" until the resolved response lands in state, so poll for it.
        expect(await screen.findByText('/workspace-root')).toBeTruthy();
    });

    it('discovers repositories and registers selected items', async () => {
        repositoryServiceMocks.discoverWorkspaces.mockResolvedValueOnce({
            repos: [
                { path: '/workspace-root/repo-a', name: 'repo-a' },
                { path: '/workspace-root/repo-b', name: 'repo-b' },
            ],
        });

        render(<AddFolderDialog open onClose={vi.fn()} onAdded={vi.fn()} />);

        await screen.findByText('/workspace-root');
        await waitFor(() => expect(screen.getByTestId('scan-folder-btn')).toBeTruthy());
        await act(async () => {
            fireEvent.click(screen.getByTestId('scan-folder-btn'));
        });

        expect(await screen.findByTestId('repo-checklist')).toBeTruthy();

        await act(async () => {
            fireEvent.click(screen.getByTestId('add-selected-btn'));
        });

        await waitFor(() => {
            expect(repositoryServiceMocks.registerWorkspace).toHaveBeenCalledTimes(2);
        });
        // Local target → the trailing baseUrl argument is undefined.
        expect(repositoryServiceMocks.registerWorkspace).toHaveBeenNthCalledWith(1, expect.objectContaining({
            name: 'repo-a',
            rootPath: '/workspace-root/repo-a',
        }), undefined);
        expect(repositoryServiceMocks.registerWorkspace).toHaveBeenNthCalledWith(2, expect.objectContaining({
            name: 'repo-b',
            rootPath: '/workspace-root/repo-b',
        }), undefined);
        expect(await screen.findByTestId('adding-done')).toHaveTextContent('Added 2 repositories');
    });

    it('stops the batch at the first failure and reports added vs not added', async () => {
        repositoryServiceMocks.discoverWorkspaces.mockResolvedValueOnce({
            repos: [
                { path: '/workspace-root/repo-a', name: 'repo-a' },
                { path: '/workspace-root/repo-b', name: 'repo-b' },
                { path: '/workspace-root/repo-c', name: 'repo-c' },
            ],
        });
        repositoryServiceMocks.registerWorkspace
            .mockResolvedValueOnce({})
            .mockRejectedValueOnce(new Error('Already registered'));

        render(<AddFolderDialog open onClose={vi.fn()} onAdded={vi.fn()} />);

        await screen.findByText('/workspace-root');
        await act(async () => {
            fireEvent.click(await screen.findByTestId('scan-folder-btn'));
        });
        await act(async () => {
            fireEvent.click(await screen.findByTestId('add-selected-btn'));
        });

        const done = await screen.findByTestId('adding-done');
        // repo-c is never attempted — the loop stops at repo-b.
        expect(repositoryServiceMocks.registerWorkspace).toHaveBeenCalledTimes(2);
        expect(done).toHaveTextContent('Added 1 repository');
        // The successful add is kept, not rolled back.
        expect(screen.getByTestId('added-list')).toHaveTextContent('Added: repo-a');
        expect(screen.getByText('repo-b: Already registered')).toBeTruthy();
        expect(screen.getByTestId('not-added-list')).toHaveTextContent('Not added (2): repo-b, repo-c');
    });
});
