/**
 * Tests for PreviewPane trusted-path (absolute path) support.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { PreviewPane } from '../../../../../src/server/spa/client/react/repos/explorer/PreviewPane';
import { TRUSTED_PATH_PREFIX } from '../../../../../src/server/spa/client/react/repos/explorer/ExactOpen';

const mockFetchApi = vi.fn();

vi.mock('../../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: (...args: unknown[]) => mockFetchApi(...args),
}));

vi.mock('../../../../../src/server/spa/client/react/repos/explorer/MonacoFileEditor', () => ({
    MonacoFileEditor: ({ value, language, onChange, onSave, readOnly }: any) => (
        <div data-testid="mock-monaco-editor" data-language={language} data-value={value} data-read-only={String(!!readOnly)}>
            <textarea
                data-testid="mock-monaco-textarea"
                value={value}
                onChange={(e) => onChange(e.target.value)}
            />
            {onSave && <button data-testid="mock-monaco-save" onClick={onSave}>Save</button>}
        </div>
    ),
    getMonacoLanguage: (name: string) => {
        const ext = name?.split('.').pop()?.toLowerCase();
        const map: Record<string, string> = { ts: 'typescript', js: 'javascript', py: 'python', md: 'markdown' };
        return map[ext ?? ''] ?? 'plaintext';
    },
}));

describe('PreviewPane — trusted path support', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('fetches from /api/fs/blob for trusted-prefixed paths', async () => {
        mockFetchApi.mockResolvedValue({
            content: '# Plan',
            encoding: 'utf-8',
            mimeType: 'text/markdown',
        });

        const trustedPath = `${TRUSTED_PATH_PREFIX}/home/user/.copilot/plan.md`;
        render(<PreviewPane repoId="r1" filePath={trustedPath} fileName="plan.md" />);

        await waitFor(() => expect(mockFetchApi).toHaveBeenCalled());

        const callUrl = mockFetchApi.mock.calls[0][0] as string;
        expect(callUrl).toContain('/api/fs/blob?path=');
        expect(callUrl).toContain(encodeURIComponent('/home/user/.copilot/plan.md'));
        // Should NOT call the repo blob endpoint
        expect(callUrl).not.toContain('/repos/');
    });

    it('forces readOnly for trusted paths', async () => {
        mockFetchApi.mockResolvedValue({
            content: 'const x = 1;',
            encoding: 'utf-8',
            mimeType: 'application/typescript',
        });

        const trustedPath = `${TRUSTED_PATH_PREFIX}/home/user/.copilot/file.ts`;
        render(<PreviewPane repoId="r1" filePath={trustedPath} fileName="file.ts" />);

        await waitFor(() => expect(screen.getByTestId('mock-monaco-editor')).toBeInTheDocument());
        expect(screen.getByTestId('mock-monaco-editor').getAttribute('data-read-only')).toBe('true');
        // onSave should not be provided for trusted paths → no save button
        expect(screen.queryByTestId('mock-monaco-save')).not.toBeInTheDocument();
    });

    it('fetches from /repos/:id/blob for non-trusted paths (no prefix)', async () => {
        mockFetchApi.mockResolvedValue({
            content: 'hello',
            encoding: 'utf-8',
            mimeType: 'text/plain',
        });

        render(<PreviewPane repoId="r1" filePath="src/index.ts" fileName="index.ts" />);

        await waitFor(() => expect(mockFetchApi).toHaveBeenCalled());

        const callUrl = mockFetchApi.mock.calls[0][0] as string;
        expect(callUrl).toContain('/repos/r1/blob?path=');
        expect(callUrl).not.toContain('/api/fs/blob');
    });
});
