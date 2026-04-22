/**
 * Tests for WorkingTreeFileDiff — untracked file rendering via PreviewPane.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

const mockUseDiffComments = vi.fn();

vi.mock('../../../../src/server/spa/client/react/features/git/hooks/useDiffComments', () => ({
    useDiffComments: (...args: any[]) => mockUseDiffComments(...args),
}));

vi.mock('../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: () => Promise.resolve({ diff: '+added line\n context' }),
}));

vi.mock('react-dom', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-dom')>();
    return { ...actual, createPortal: (children: React.ReactNode) => children };
});

vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false }),
}));

vi.mock('../../../../src/server/spa/client/react/context/QueueContext', () => ({
    useQueue: () => ({ state: { dialogLaunchMode: 'default', dialogMode: 'task' }, dispatch: vi.fn() }),
}));

vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer', () => ({
    PreviewPane: ({ repoId, filePath, fileName, readOnly }: any) => (
        <div
            data-testid="mock-preview-pane"
            data-repo-id={repoId}
            data-file-path={filePath}
            data-file-name={fileName}
            data-read-only={String(!!readOnly)}
        />
    ),
}));

vi.mock('../../../../src/server/spa/client/react/features/git/diff/UnifiedDiffViewer', () => ({
    UnifiedDiffViewer: ({ 'data-testid': testId }: any) => (
        <div data-testid={testId ?? 'mock-diff-viewer'} />
    ),
    HunkNavButtons: () => null,
}));

import { WorkingTreeFileDiff } from '../../../../src/server/spa/client/react/features/git/working-tree/WorkingTreeFileDiff';

function makeHook(overrides: Record<string, unknown> = {}) {
    return {
        comments: [],
        loading: false,
        error: null,
        isEphemeral: false,
        addComment: vi.fn(),
        updateComment: vi.fn().mockResolvedValue({}),
        deleteComment: vi.fn().mockResolvedValue(undefined),
        resolveComment: vi.fn().mockResolvedValue({}),
        unresolveComment: vi.fn().mockResolvedValue({}),
        askAI: vi.fn(),
        aiLoadingIds: new Set(),
        aiErrors: new Map(),
        clearAiError: vi.fn(),
        resolvingIds: new Set(),
        deletingIds: new Set(),
        runRelocation: vi.fn(),
        copyAllCommentsAsPrompt: vi.fn(),
        refresh: vi.fn(),
        ...overrides,
    };
}

describe('WorkingTreeFileDiff — untracked file rendering', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockUseDiffComments.mockReturnValue(makeHook());
    });

    async function renderDiff(stage: 'staged' | 'unstaged' | 'untracked' = 'untracked', filePath = 'src/newfile.ts') {
        await act(async () => {
            render(
                <WorkingTreeFileDiff
                    workspaceId="ws1"
                    filePath={filePath}
                    stage={stage}
                />
            );
        });
    }

    it('renders PreviewPane for untracked files', async () => {
        await renderDiff('untracked');
        expect(screen.getByTestId('working-tree-file-diff-untracked')).toBeTruthy();
        expect(screen.getByTestId('mock-preview-pane')).toBeTruthy();
    });

    it('passes workspaceId as repoId to PreviewPane', async () => {
        await renderDiff('untracked');
        expect(screen.getByTestId('mock-preview-pane').getAttribute('data-repo-id')).toBe('ws1');
    });

    it('passes filePath to PreviewPane', async () => {
        await renderDiff('untracked', 'src/components/App.tsx');
        expect(screen.getByTestId('mock-preview-pane').getAttribute('data-file-path')).toBe('src/components/App.tsx');
    });

    it('extracts fileName from filePath for PreviewPane', async () => {
        await renderDiff('untracked', 'src/components/App.tsx');
        expect(screen.getByTestId('mock-preview-pane').getAttribute('data-file-name')).toBe('App.tsx');
    });

    it('uses full filePath as fileName when there is no slash', async () => {
        await renderDiff('untracked', 'README.md');
        expect(screen.getByTestId('mock-preview-pane').getAttribute('data-file-name')).toBe('README.md');
    });

    it('sets readOnly on PreviewPane', async () => {
        await renderDiff('untracked');
        expect(screen.getByTestId('mock-preview-pane').getAttribute('data-read-only')).toBe('true');
    });

    it('preserves data-testid on the wrapper div', async () => {
        await renderDiff('untracked');
        const wrapper = screen.getByTestId('working-tree-file-diff-untracked');
        expect(wrapper).toBeTruthy();
        expect(wrapper.className).toContain('h-full');
        expect(wrapper.className).toContain('w-full');
    });

    it('shows header with "Untracked file" label', async () => {
        await renderDiff('untracked');
        const header = screen.getByTestId('working-tree-file-diff-header');
        expect(header.textContent).toContain('Untracked file');
    });

    it('does not render DiffViewToggle for untracked files', async () => {
        await renderDiff('untracked');
        expect(screen.queryByTestId('diff-view-toggle')).toBeNull();
    });

    it('does not render comment sidebar toggle for untracked files', async () => {
        await renderDiff('untracked');
        expect(screen.queryByTestId('toggle-comments-btn')).toBeNull();
    });

    it('renders diff viewer (not PreviewPane) for staged files', async () => {
        await renderDiff('staged');
        expect(screen.queryByTestId('mock-preview-pane')).toBeNull();
        expect(screen.getByTestId('working-tree-file-diff-content')).toBeTruthy();
    });
});
