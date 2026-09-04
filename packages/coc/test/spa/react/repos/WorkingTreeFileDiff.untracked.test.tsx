/**
 * Tests for WorkingTreeFileDiff — untracked file rendering via PreviewPane.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

const mockUseDiffComments = vi.fn();
const mockGetWorkingTreeFileDiff = vi.fn(() => Promise.resolve({ diff: '+added line\n context' }));

vi.mock('../../../../src/server/spa/client/react/features/git/hooks/useDiffComments', () => ({
    useDiffComments: (...args: any[]) => mockUseDiffComments(...args),
}));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        git: {
            getWorkingTreeFileDiff: mockGetWorkingTreeFileDiff,
        },
    }),
}));

vi.mock('react-dom', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-dom')>();
    return { ...actual, createPortal: (children: React.ReactNode) => children };
});

vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false }),
}));

vi.mock('../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ state: { dialogLaunchMode: 'default', dialogMode: 'task' }, dispatch: vi.fn() }),
}));

/** Captures the onNotFound callback PreviewPane receives so tests can fire it. */
const previewNotFound = vi.hoisted(() => ({ current: null as null | (() => void) }));

vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer', () => ({
    PreviewPane: ({ repoId, filePath, fileName, readOnly, onNotFound }: any) => {
        previewNotFound.current = onNotFound ?? null;
        return (
            <div
                data-testid="mock-preview-pane"
                data-repo-id={repoId}
                data-file-path={filePath}
                data-file-name={fileName}
                data-read-only={String(!!readOnly)}
            />
        );
    },
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
        mockGetWorkingTreeFileDiff.mockResolvedValue({ diff: '+added line\n context' });
        mockUseDiffComments.mockReturnValue(makeHook());
    });

    async function renderDiff(
        stage: 'staged' | 'unstaged' | 'untracked' = 'untracked',
        filePath = 'src/newfile.ts',
        repoRoot?: string,
    ) {
        await act(async () => {
            render(
                <WorkingTreeFileDiff
                    workspaceId="ws1"
                    filePath={filePath}
                    stage={stage}
                    repoRoot={repoRoot}
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

    it('converts an absolute filePath to repo-relative for PreviewPane when repoRoot is set', async () => {
        await renderDiff('untracked', '/home/user/RSL/AGENTS.md', '/home/user/RSL');
        expect(screen.getByTestId('mock-preview-pane').getAttribute('data-file-path')).toBe('AGENTS.md');
        // fileName still derives from the (absolute) filePath.
        expect(screen.getByTestId('mock-preview-pane').getAttribute('data-file-name')).toBe('AGENTS.md');
    });

    it('converts a nested absolute filePath to repo-relative for PreviewPane', async () => {
        await renderDiff('untracked', '/home/user/RSL/src/lib/new.ts', '/home/user/RSL');
        expect(screen.getByTestId('mock-preview-pane').getAttribute('data-file-path')).toBe('src/lib/new.ts');
    });

    it('leaves filePath unchanged when repoRoot is not supplied', async () => {
        await renderDiff('untracked', '/home/user/RSL/AGENTS.md');
        expect(screen.getByTestId('mock-preview-pane').getAttribute('data-file-path')).toBe('/home/user/RSL/AGENTS.md');
    });

    it('renders diff viewer (not PreviewPane) for staged files', async () => {
        await renderDiff('staged');
        expect(screen.queryByTestId('mock-preview-pane')).toBeNull();
        expect(screen.getByTestId('working-tree-file-diff-content')).toBeTruthy();
    });
});

describe('WorkingTreeFileDiff — untracked file missing from disk', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        previewNotFound.current = null;
        mockGetWorkingTreeFileDiff.mockResolvedValue({ diff: '+added line\n context' });
        mockUseDiffComments.mockReturnValue(makeHook());
    });

    async function renderUntracked(onFileMissing?: () => void) {
        await act(async () => {
            render(
                <WorkingTreeFileDiff
                    workspaceId="ws1"
                    filePath="src/gone.ts"
                    stage="untracked"
                    onFileMissing={onFileMissing}
                />
            );
        });
    }

    it('replaces the preview with a clear missing-file message when the read 404s', async () => {
        await renderUntracked();
        expect(previewNotFound.current).toBeTruthy();

        await act(async () => { previewNotFound.current!(); });

        const missing = screen.getByTestId('working-tree-file-diff-missing');
        expect(missing.textContent).toContain('no longer exists on disk');
        expect(screen.queryByTestId('mock-preview-pane')).toBeNull();
    });

    it('notifies onFileMissing so the owner can refresh the stale change list', async () => {
        const onFileMissing = vi.fn();
        await renderUntracked(onFileMissing);

        await act(async () => { previewNotFound.current!(); });

        expect(onFileMissing).toHaveBeenCalledTimes(1);
    });

    it('notifies onFileMissing at most once even if not-found fires repeatedly', async () => {
        const onFileMissing = vi.fn();
        await renderUntracked(onFileMissing);

        const fire = previewNotFound.current!;
        await act(async () => { fire(); });
        await act(async () => { fire(); });

        expect(onFileMissing).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('working-tree-file-diff-missing')).toBeTruthy();
    });

    it('shows the missing-file state without an onFileMissing handler', async () => {
        await renderUntracked();

        await act(async () => { previewNotFound.current!(); });

        expect(screen.getByTestId('working-tree-file-diff-missing')).toBeTruthy();
    });
});
