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

    it('fetches per-file diff and renders with UnifiedDiffViewer', async () => {
        mockFetchApi.mockResolvedValue({
            diff: 'diff --git a/src/app.ts b/src/app.ts\nindex abc..def 100644\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,2 +1,2 @@\n-const a = 1;\n+const a = 2;\n const b = 2;',
        });

        render(<CommitFileContent workspaceId="ws-1" hash="abc123" filePath="src/app.ts" />);

        await waitFor(() => expect(screen.getByTestId('commit-file-diff-content')).toBeInTheDocument());
        expect(mockFetchApi).toHaveBeenCalledWith('/workspaces/ws-1/git/commits/abc123/files/src%2Fapp.ts/diff');
    });

    it('shows empty diff message when diff is empty', async () => {
        mockFetchApi.mockResolvedValue({ diff: '' });

        render(<CommitFileContent workspaceId="ws-1" hash="abc123" filePath="src/app.ts" />);

        await waitFor(() => expect(screen.getByTestId('commit-file-content-empty')).toBeInTheDocument());
        expect(screen.getByTestId('commit-file-content-empty').textContent).toContain('empty diff');
    });

    it('shows error state with retry button on fetch failure', async () => {
        mockFetchApi.mockRejectedValue(new Error('Network error'));

        render(<CommitFileContent workspaceId="ws-1" hash="abc123" filePath="src/app.ts" />);

        await waitFor(() => expect(screen.getByTestId('commit-file-content-error')).toBeInTheDocument());
        expect(screen.getByTestId('commit-file-content-error').textContent).toContain('Network error');
    });

    it('applies green/red coloring to added and removed lines', async () => {
        mockFetchApi.mockResolvedValue({
            diff: '@@ -1,2 +1,2 @@\n-old line\n+new line\n context line',
        });

        render(<CommitFileContent workspaceId="ws-1" hash="abc123" filePath="src/app.ts" />);

        await waitFor(() => expect(screen.getByTestId('commit-file-diff-content')).toBeInTheDocument());
        const viewer = screen.getByTestId('commit-file-diff-content');

        // The removed line should have a red background class
        const lines = viewer.querySelectorAll('[class*="bg-"]');
        const classes = Array.from(lines).map(el => el.className);
        expect(classes.some(c => c.includes('bg-[#fecaca]'))).toBe(true);
        expect(classes.some(c => c.includes('bg-[#d1f7c4]'))).toBe(true);
    });

    it('renders DiffMiniMap when diff has changes', async () => {
        mockFetchApi.mockResolvedValue({
            diff: 'diff --git a/src/app.ts b/src/app.ts\nindex abc..def 100644\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,2 +1,2 @@\n-const a = 1;\n+const a = 2;\n const b = 2;',
        });

        render(<CommitFileContent workspaceId="ws-1" hash="abc123" filePath="src/app.ts" />);

        await waitFor(() => expect(screen.getByTestId('commit-file-diff-content')).toBeInTheDocument());
        await waitFor(() => expect(screen.getByTestId('diff-minimap')).toBeInTheDocument());
    });

    it('does not render DiffMiniMap when diff is empty', async () => {
        mockFetchApi.mockResolvedValue({ diff: '' });

        render(<CommitFileContent workspaceId="ws-1" hash="abc123" filePath="src/app.ts" />);

        await waitFor(() => expect(screen.getByTestId('commit-file-content-empty')).toBeInTheDocument());
        expect(screen.queryByTestId('diff-minimap')).not.toBeInTheDocument();
    });
});
