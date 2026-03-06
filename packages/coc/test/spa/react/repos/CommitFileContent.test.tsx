import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { CommitFileContent } from '../../../../src/server/spa/client/react/repos/CommitFileContent';

const mockFetchApi = vi.fn();

vi.mock('../../../../src/server/spa/client/react/hooks/useApi', () => {
    return {
        fetchApi: (...args: unknown[]) => mockFetchApi(...args),
    };
});

describe('CommitFileContent', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('fetches and renders line-numbered source for non-markdown files', async () => {
        mockFetchApi.mockResolvedValue({
            path: 'src/app.ts',
            fileName: 'app.ts',
            lines: ['const a = 1;', 'const b = 2;'],
            totalLines: 2,
            truncated: false,
            language: 'ts',
            resolvedRef: 'abc123:src/app.ts',
        });

        render(<CommitFileContent workspaceId="ws-1" hash="abc123" filePath="src/app.ts" />);

        await waitFor(() => expect(screen.getByTestId('commit-file-code')).toBeInTheDocument());
        expect(mockFetchApi).toHaveBeenCalledWith('/workspaces/ws-1/git/commits/abc123/files/src%2Fapp.ts/content');
        const codeLines = screen.getAllByTestId('commit-file-code-line');
        expect(codeLines).toHaveLength(2);
        expect(codeLines[0].textContent).toContain('const a = 1;');
        expect(codeLines[1].textContent).toContain('const b = 2;');
    });

    it('renders markdown files with markdown-body output', async () => {
        mockFetchApi.mockResolvedValue({
            path: 'docs/README.md',
            fileName: 'README.md',
            lines: ['# Heading', '', 'Some text'],
            totalLines: 3,
            truncated: false,
            language: 'md',
            resolvedRef: 'abc123:docs/README.md',
        });

        render(<CommitFileContent workspaceId="ws-1" hash="abc123" filePath="docs/README.md" />);

        await waitFor(() => expect(screen.getByTestId('commit-file-markdown')).toBeInTheDocument());
        expect(screen.getByTestId('commit-file-markdown').innerHTML).toContain('data-line=');
    });

    it('shows the parent-version badge when the server falls back for deleted files', async () => {
        mockFetchApi.mockResolvedValue({
            path: 'docs/removed.md',
            fileName: 'removed.md',
            lines: ['gone'],
            totalLines: 1,
            truncated: false,
            language: 'md',
            resolvedRef: 'abc123^:docs/removed.md',
        });

        render(<CommitFileContent workspaceId="ws-1" hash="abc123" filePath="docs/removed.md" />);

        await waitFor(() => expect(screen.getByTestId('commit-file-fallback-badge')).toBeInTheDocument());
        expect(screen.getByTestId('commit-file-fallback-badge').textContent).toContain('Showing parent version');
    });
});
