/**
 * PrFilesPanel — shared FileDiffPanel adoption on the inline Files tab.
 *
 * Covers:
 *   - desktop with a DiffSource renders the shared FileDiffPanel (not the slim
 *     SideBySideDiffViewer panel), with the "Pop out" button moved into the
 *     shared header's `headerActions` slot
 *   - mobile keeps the slim viewer sliced from the combined diff
 *   - no DiffSource (e.g. unit renders) still falls back to the slim viewer
 *   - classification results reach FileDiffPanel as `getHunkClassification` /
 *     `hunkActiveFilters` so filtered-out hunks collapse inline
 *
 * FileDiffPanel itself is mocked — it has its own suite, and mocking keeps this
 * one focused on the branch + prop wiring.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { PrFilesPanel } from '../../../../../src/server/spa/client/react/features/pull-requests/PrFilesPanel';
import { parseDiffFileList } from '../../../../../src/server/spa/client/react/features/git/diff';
import type { DiffSource } from '../../../../../src/server/spa/client/react/features/git/diff/diffSource';
import type { UseClassificationReturn } from '../../../../../src/server/spa/client/react/features/git/diff/useClassification';

vi.mock('../../../../../src/server/spa/client/react/shared/ModalJobAiControls', () => ({
    useModalJobAiSelection: () => ({
        provider: 'copilot',
        setProvider: vi.fn(),
        agentProviders: [{ id: 'copilot', label: 'Copilot', enabled: true, available: true, locked: true }],
        providersLoading: false,
        useEffortTierMode: false,
        effortTierMap: {},
        selectedEffortTier: 'medium',
        setEffortTier: vi.fn(),
        modelCommand: {
            modelMenuVisible: false,
            modelFilter: '',
            filteredModels: [],
            modelHighlightIndex: 0,
            modelOverride: null,
            setModelOverride: vi.fn(),
            handleModelSelect: vi.fn(),
            showModelMenu: vi.fn(),
            dismissModelMenu: vi.fn(),
            handleModelKeyDown: vi.fn(),
            setModelFilter: vi.fn(),
        },
        defaultModelId: undefined,
        defaultModelLabel: undefined,
        validModelOverride: null,
        effortOverride: null,
        setEffortOverride: vi.fn(),
        effortOptions: [],
        effortPickerDisabled: false,
        resolved: { provider: 'copilot' },
    }),
    isChatProvider: () => true,
    isSelectableProvider: () => true,
}));

/** Captured props of the last FileDiffPanel render. */
let lastPanelProps: any = null;
vi.mock('../../../../../src/server/spa/client/react/features/git/diff/FileDiffPanel', () => ({
    FileDiffPanel: (props: any) => {
        lastPanelProps = props;
        return (
            <div data-testid="file-diff-panel">
                <div data-testid="file-diff-header">{props.headerActions}</div>
                <span data-testid="mock-panel-path">{props.filePath}</span>
            </div>
        );
    },
}));

/**
 * Review-progress transport is stubbed — the hook itself has its own suite, and
 * this one only cares that the inline path wires it up with the pop-out's key.
 */
const fetchReviewProgressMock = vi.fn();
const putReviewProgressMock = vi.fn();
vi.mock('../../../../../src/server/spa/client/react/features/git/diff/reviewProgressApi', () => ({
    fetchReviewProgress: (...args: any[]) => fetchReviewProgressMock(...args),
    putReviewProgress: (...args: any[]) => putReviewProgressMock(...args),
}));

let currentClassification: UseClassificationReturn | undefined;
vi.mock('../../../../../src/server/spa/client/react/features/git/diff/useClassification', () => ({
    useClassification: () => currentClassification,
}));

const diffText = [
    'diff --git a/one.ts b/one.ts',
    '--- a/one.ts',
    '+++ b/one.ts',
    '@@ -1,1 +1,2 @@',
    ' keep',
    '+added in one',
    'diff --git a/two.ts b/two.ts',
    '--- a/two.ts',
    '+++ b/two.ts',
    '@@ -1,2 +1,1 @@',
    ' keep',
    '-removed in two',
].join('\n');

const parsedFiles = parseDiffFileList(diffText);

function makeSource(): DiffSource {
    return {
        label: 'PR #7',
        fileDiffUrl: (p: string) => `/api/pr/7/diff/files/${p}`,
        fullContextFileDiffUrl: (p: string) => `/api/pr/7/diff/files/${p}?fullContext=true`,
        fullDiffUrl: () => '/api/pr/7/diff',
        commentContext: (filePath: string) => ({
            repositoryId: 'ws-1', filePath, oldRef: 'pr-7-base', newRef: 'pr-7-head',
        }),
        files: parsedFiles.map(f => f.path),
        chat: null,
        supportsTruncation: false,
        cacheKey: 'pr:gh_octo_repo:7',
    };
}

function makeClassification(overrides: Partial<UseClassificationReturn> = {}): UseClassificationReturn {
    return {
        state: {
            status: 'ready',
            activeFilters: new Set(['logic']),
            result: null,
            error: null,
        },
        classify: vi.fn(),
        toggleFilter: vi.fn(),
        setFilters: vi.fn(),
        getFileBadge: () => undefined,
        isFileDimmed: () => false,
        getHunkClassification: () => ({ category: 'logic', intensity: 'high' }),
        ...overrides,
    } as unknown as UseClassificationReturn;
}

beforeEach(() => {
    lastPanelProps = null;
    currentClassification = undefined;
    fetchReviewProgressMock.mockReset();
    putReviewProgressMock.mockReset();
    fetchReviewProgressMock.mockResolvedValue({
        headSha: 'head-sha', reviewedFiles: [], visitedFiles: [], lastSelectedFile: null,
    });
    putReviewProgressMock.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('PrFilesPanel — desktop adopts the shared FileDiffPanel', () => {
    it('renders FileDiffPanel for the selected file and drops the slim panel', () => {
        render(<PrFilesPanel files={parsedFiles} diffText={diffText} workspaceId="ws-1" diffSource={makeSource()} />);

        expect(screen.getByTestId('pr-shared-diff-panel')).toBeInTheDocument();
        expect(screen.getByTestId('file-diff-panel')).toBeInTheDocument();
        expect(screen.queryByTestId('pr-diff-panel')).not.toBeInTheDocument();
        expect(screen.getByTestId('mock-panel-path').textContent).toBe('one.ts');
        expect(lastPanelProps.workspaceId).toBe('ws-1');
        expect(lastPanelProps.showSourceLabel).toBe(false);
    });

    it('moves the Pop out button into the shared header actions slot', () => {
        const onPopOut = vi.fn();
        render(
            <PrFilesPanel
                files={parsedFiles}
                diffText={diffText}
                workspaceId="ws-1"
                diffSource={makeSource()}
                onPopOut={onPopOut}
            />,
        );

        const popout = screen.getByTestId('file-diff-header').querySelector('[data-testid="pr-diff-popout"]');
        expect(popout).not.toBeNull();
        fireEvent.click(popout as HTMLElement);
        expect(onPopOut).toHaveBeenCalledWith('one.ts');
    });

    it('switches the shared panel to the file the reviewer selects', () => {
        render(<PrFilesPanel files={parsedFiles} diffText={diffText} workspaceId="ws-1" diffSource={makeSource()} />);

        const twoRow = screen.getAllByTestId('pr-file-row')
            .find(r => r.getAttribute('data-file-path') === 'two.ts');
        fireEvent.click(twoRow as HTMLElement);

        expect(screen.getByTestId('mock-panel-path').textContent).toBe('two.ts');
    });

    it('lets FileDiffPanel drive cross-file navigation back into the list selection', () => {
        render(<PrFilesPanel files={parsedFiles} diffText={diffText} workspaceId="ws-1" diffSource={makeSource()} />);

        act(() => { lastPanelProps.onNavigateToFile('two.ts', 'first'); });
        expect(screen.getByTestId('mock-panel-path').textContent).toBe('two.ts');
    });
});

describe('PrFilesPanel — slim viewer fallbacks', () => {
    it('keeps the slim viewer on mobile', () => {
        render(
            <PrFilesPanel
                files={parsedFiles}
                diffText={diffText}
                workspaceId="ws-1"
                diffSource={makeSource()}
                isMobile
            />,
        );

        expect(screen.getByTestId('pr-diff-panel')).toBeInTheDocument();
        expect(screen.getByTestId('pr-inline-diff')).toBeInTheDocument();
        expect(screen.queryByTestId('file-diff-panel')).not.toBeInTheDocument();
    });

    it('keeps the slim viewer when no diff source is supplied', () => {
        render(<PrFilesPanel files={parsedFiles} diffText={diffText} workspaceId="ws-1" />);

        expect(screen.getByTestId('pr-diff-panel')).toBeInTheDocument();
        expect(screen.queryByTestId('file-diff-panel')).not.toBeInTheDocument();
    });

    it('shows the empty state instead of the shared panel when the PR has no files', () => {
        render(<PrFilesPanel files={[]} diffText="" workspaceId="ws-1" diffSource={makeSource()} />);

        expect(screen.getByTestId('pr-diff-panel-empty').textContent)
            .toContain('No file changes in this pull request.');
        expect(screen.queryByTestId('file-diff-panel')).not.toBeInTheDocument();
    });
});

describe('PrFilesPanel — hunk classification reaches the shared panel', () => {
    it('forwards getHunkClassification and the active filters once results are ready', () => {
        currentClassification = makeClassification();
        render(
            <PrFilesPanel
                files={parsedFiles}
                diffText={diffText}
                workspaceId="ws-1"
                diffSource={makeSource()}
                classificationKey={{ type: 'pr', repoId: 'repo-1', identifier: '7:abc' }}
            />,
        );

        expect(lastPanelProps.getHunkClassification).toBe(currentClassification!.getHunkClassification);
        expect(Array.from(lastPanelProps.hunkActiveFilters)).toEqual(['logic']);
    });

    it('forwards nothing while classification is still idle', () => {
        currentClassification = makeClassification({
            state: { status: 'idle', activeFilters: new Set(['logic']) } as any,
        });
        render(
            <PrFilesPanel
                files={parsedFiles}
                diffText={diffText}
                workspaceId="ws-1"
                diffSource={makeSource()}
                classificationKey={{ type: 'pr', repoId: 'repo-1', identifier: '7:abc' }}
            />,
        );

        expect(lastPanelProps.getHunkClassification).toBeUndefined();
        expect(lastPanelProps.hunkActiveFilters).toBeUndefined();
    });
});

describe('PrFilesPanel — mark reviewed / review progress (AC-04)', () => {
    const persistence = { originId: 'gh_octo_repo', workspaceId: 'ws-1', repoId: 'repo-1', prId: '7' };

    function renderWithProgress() {
        return render(
            <PrFilesPanel
                files={parsedFiles}
                diffText={diffText}
                workspaceId="ws-1"
                diffSource={makeSource()}
                headSha="head-sha"
                reviewPersistence={persistence}
            />,
        );
    }

    it('hydrates from the same persistence key the pop-out uses', async () => {
        renderWithProgress();
        await act(async () => { await Promise.resolve(); });

        expect(fetchReviewProgressMock).toHaveBeenCalledWith(persistence, 'head-sha');
    });

    it('marks the file the diff pane is showing as visited', async () => {
        renderWithProgress();
        await act(async () => { await Promise.resolve(); });

        expect(screen.getByTestId('pr-file-visited-one.ts')).toBeInTheDocument();
        expect(screen.queryByTestId('pr-file-visited-two.ts')).not.toBeInTheDocument();
    });

    it('marks a newly selected file visited too', async () => {
        renderWithProgress();
        await act(async () => { await Promise.resolve(); });

        const twoRow = screen.getAllByTestId('pr-file-row')
            .find(r => r.getAttribute('data-file-path') === 'two.ts');
        fireEvent.click(twoRow as HTMLElement);

        expect(screen.getByTestId('pr-file-visited-two.ts')).toBeInTheDocument();
    });

    it('toggles reviewed for the active file and shows the ✓ mark in the list', async () => {
        renderWithProgress();
        await act(async () => { await Promise.resolve(); });

        expect(lastPanelProps.isReviewed).toBe(false);

        act(() => { lastPanelProps.onToggleReviewed(); });

        expect(lastPanelProps.isReviewed).toBe(true);
        expect(screen.getByTestId('pr-file-reviewed-one.ts')).toBeInTheDocument();
        // Reviewed supersedes the visited dot.
        expect(screen.queryByTestId('pr-file-visited-one.ts')).not.toBeInTheDocument();

        act(() => { lastPanelProps.onToggleReviewed(); });
        expect(lastPanelProps.isReviewed).toBe(false);
    });

    it('renders reviewed state loaded from the shared server record', async () => {
        fetchReviewProgressMock.mockResolvedValue({
            headSha: 'head-sha', reviewedFiles: ['two.ts'], visitedFiles: ['two.ts'], lastSelectedFile: 'two.ts',
        });
        renderWithProgress();
        await act(async () => { await Promise.resolve(); });

        expect(screen.getByTestId('pr-file-reviewed-two.ts')).toBeInTheDocument();
    });

    it('keeps progress in-memory when no persistence key is supplied', async () => {
        render(
            <PrFilesPanel
                files={parsedFiles}
                diffText={diffText}
                workspaceId="ws-1"
                diffSource={makeSource()}
                headSha="head-sha"
            />,
        );
        await act(async () => { await Promise.resolve(); });

        expect(fetchReviewProgressMock).not.toHaveBeenCalled();
        act(() => { lastPanelProps.onToggleReviewed(); });
        expect(screen.getByTestId('pr-file-reviewed-one.ts')).toBeInTheDocument();
    });
});
