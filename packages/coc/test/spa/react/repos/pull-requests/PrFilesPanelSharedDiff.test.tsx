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
import { applyRuntimeConfigPatch } from '../../../../../src/server/spa/client/react/utils/config';
import { ReviewContentSearchController } from '../../../../../src/server/spa/client/react/features/git/diff/reviewContentSearchController';
let engine: 'legacy' | 'monaco' = 'legacy';
vi.mock('../../../../../src/server/spa/client/react/features/git/hooks/useDiffEngine', () => ({
    useDiffEngine: () => [engine, vi.fn()],
}));

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
    engine = 'legacy';
    lastPanelProps = null;
    currentClassification = undefined;
    fetchReviewProgressMock.mockReset();
    putReviewProgressMock.mockReset();
    fetchReviewProgressMock.mockResolvedValue({
        headSha: 'head-sha', reviewedFiles: [], visitedFiles: [], lastSelectedFile: null,
    });
    putReviewProgressMock.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); act(() => applyRuntimeConfigPatch({ diffContentSearchEnabled: false })); vi.restoreAllMocks(); });

function fileRows() {
    return Array.from(screen.getByRole('complementary', { name: 'Changed files' }).querySelectorAll<HTMLElement>('[data-file-path]'));
}

describe('PrFilesPanel — desktop adopts the shared FileDiffPanel', () => {
    it.each([false, true])('opens full-content matches on the exact side with mobile=%s', async isMobile => {
        const load = vi.fn(async (path: string) => ({
            path, fileName: path, language: 'typescript', binary: false, tooLarge: false,
            base: { exists: true, ref: 'base', content: 'old target\nunchanged target' },
            head: { exists: true, ref: 'head', content: 'new target\nunchanged target' },
        }));
        const source = { ...makeSource(), fetchFileContent: load };
        render(<PrFilesPanel files={parsedFiles} diffText={diffText} workspaceId="ws-1" diffSource={source} isMobile={isMobile} />);
        expect(screen.queryByRole('button', { name: 'Search review contents' })).toBeNull();
        expect(load).not.toHaveBeenCalled();
        act(() => applyRuntimeConfigPatch({ diffContentSearchEnabled: true }));
        fireEvent.change(screen.getByLabelText('Search changed files by name or path'), { target: { value: 'absent' } });
        fireEvent.click(screen.getByRole('button', { name: 'Search review contents' }));
        fireEvent.change(screen.getByTestId('review-content-search-input'), { target: { value: 'target' } });
        await act(async () => { for (let n = 0; n < 20; n++) await Promise.resolve(); });
        expect(load).toHaveBeenCalledTimes(2);
        fireEvent.click(screen.getByRole('button', { name: 'two.ts, OLD line 2, column 11' }));
        expect(lastPanelProps.filePath).toBe('two.ts');
        expect(lastPanelProps.contentSearchTarget).toMatchObject({ filePath: 'two.ts', side: 'old', line: 2, startColumn: 11, endColumn: 17 });
        const previous = lastPanelProps.contentSearchTarget;
        fireEvent.click(screen.getByRole('button', { name: 'two.ts, OLD line 2, column 11' }));
        expect(lastPanelProps.contentSearchTarget).not.toBe(previous);
        fireEvent.click(screen.getByRole('button', { name: 'two.ts, NEW line 1, column 5' }));
        expect(lastPanelProps.contentSearchTarget.side).toBe('new');
        expect((screen.getByTestId('review-content-search-input') as HTMLInputElement).value).toBe('target');
        fireEvent.click(screen.getByRole('button', { name: 'Files' }));
        fireEvent.click(fileRows().find(row => row.dataset.filePath === 'one.ts')!);
        if (!isMobile) expect(lastPanelProps.contentSearchTarget).toBeUndefined();
        else expect(screen.getByTestId('pr-diff-panel')).toBeInTheDocument();
    });

    it.each(['head', 'base', 'endpoint', 'refresh'] as const)('revokes loaded content when the PR %s changes', async change => {
        act(() => applyRuntimeConfigPatch({ diffContentSearchEnabled: true }));
        const load = vi.fn(async () => ({
            path: 'one.ts', fileName: 'one.ts', language: 'typescript', binary: false, tooLarge: false,
            base: { exists: true, ref: 'base', content: 'target' }, head: { exists: true, ref: 'head', content: 'target' },
        }));
        const source = { ...makeSource(), fetchFileContent: load, fileContextRefs: { baseRef: 'base', headRef: 'head' } };
        const initial = { files: parsedFiles, diffText, workspaceId: 'ws-1', diffSource: source, headSha: 'head' };
        const dispose = vi.spyOn(ReviewContentSearchController.prototype, 'dispose');
        const view = render(<PrFilesPanel {...initial} />);
        fireEvent.click(screen.getByRole('button', { name: 'Search review contents' }));
        fireEvent.change(screen.getByTestId('review-content-search-input'), { target: { value: 'target' } });
        await act(async () => { for (let n = 0; n < 20; n++) await Promise.resolve(); });
        view.rerender(<PrFilesPanel {...initial} {...(
            change === 'head' ? { headSha: 'next-head' }
                : change === 'base' ? { diffSource: { ...source, fileContextRefs: { baseRef: 'next-base', headRef: 'head' } } }
                    : change === 'endpoint' ? { attachmentDestinationId: 'another-owner' }
                        : { diffText: `${diffText}\n ` }
        )} />);
        expect(dispose).toHaveBeenCalledTimes(1);
        expect(lastPanelProps.contentSearchTarget).toBeUndefined();
        fireEvent.click(screen.getByRole('button', { name: 'Search review contents' }));
        fireEvent.change(screen.getByTestId('review-content-search-input'), { target: { value: 'target' } });
        await act(async () => { for (let n = 0; n < 20; n++) await Promise.resolve(); });
        expect(load).toHaveBeenCalledTimes(4);
    });
    it('keeps local and colliding remote owners distinct across mounted owner and file changes', () => {
        const props = { files: parsedFiles, diffText, workspaceId: 'ws-1', diffSource: makeSource() };
        const view = render(<PrFilesPanel {...props} attachmentDestinationId="ws-1" />);
        for (const destination of ['ws-1', 'remote:one:ws-1', 'remote:two:ws-1']) {
            view.rerender(<PrFilesPanel {...props} attachmentDestinationId={destination} />);
            expect(lastPanelProps.attachmentDestinationId).toBe(destination);
            expect(lastPanelProps.workspaceId).toBe('ws-1');
            const row = fileRows().find(r => r.getAttribute('data-file-path') === 'two.ts');
            fireEvent.click(row as HTMLElement);
            expect(lastPanelProps.attachmentDestinationId).toBe(destination);
            expect(lastPanelProps.filePath).toBe('two.ts');
        }
        view.rerender(<PrFilesPanel {...props} />);
        expect(lastPanelProps.attachmentDestinationId).toBeUndefined();
    });

    it('hides classification in Monaco and restores it on reported Classic fallback', () => {
        engine = 'monaco';
        currentClassification = makeClassification();
        const props = {
            files: parsedFiles, diffText, workspaceId: 'ws-1', diffSource: makeSource(),
            classificationKey: { type: 'pr' as const, repoId: 'repo-1', identifier: '7:head' },
        };
        const view = render(<PrFilesPanel {...props} />);
        expect(screen.queryByTestId('classification-filter-bar')).toBeNull();
        act(() => lastPanelProps.onDiffEngineChange('legacy'));
        expect(screen.getByTestId('classification-filter-bar')).toBeTruthy();
        act(() => lastPanelProps.onDiffEngineChange('monaco'));
        expect(screen.queryByTestId('classification-filter-bar')).toBeNull();
        act(() => lastPanelProps.onDiffEngineChange('legacy'));
        view.rerender(<PrFilesPanel {...props} diffSource={{ ...props.diffSource, cacheKey: 'pr:next-head' }} />);
        expect(screen.queryByTestId('classification-filter-bar')).toBeNull();
    });
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

        const twoRow = fileRows()
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

describe('PrFilesPanel review navigation order', () => {
    it.each(['tree', 'flat', 'search'])('uses %s display order and retains the source owner', mode => {
        const files = ['src/a.ts', 'root.ts', 'src/b.ts'].map(path => ({ path, status: 'M' }));
        const source = makeSource();
        render(<PrFilesPanel files={files} workspaceId="ws-1" attachmentDestinationId="remote:server:ws-1" diffSource={source} headSha="head" />);
        if (mode === 'flat') fireEvent.click(screen.getByRole('button', { name: 'Flat', exact: true }));
        if (mode === 'search') fireEvent.change(screen.getByRole('textbox', { name: 'Search changed files by name or path' }), { target: { value: 'src/' } });
        act(() => lastPanelProps.onToggleReviewed());
        expect(lastPanelProps.filePath).toBe(mode === 'flat' ? 'root.ts' : 'src/b.ts');
        expect(lastPanelProps.attachmentDestinationId).toBe('remote:server:ws-1');
        expect(lastPanelProps.source).toMatchObject({ ...source, files: mode === 'search' ? ['src/a.ts', 'src/b.ts'] : mode === 'flat' ? files.map(file => file.path) : ['src/a.ts', 'src/b.ts', 'root.ts'] });
        expect(fileRows().find(row => row.getAttribute('data-file-path') === lastPanelProps.filePath)?.className).toContain('selected');
    });
    it('stays on the last displayed file', () => {
        render(<PrFilesPanel files={parsedFiles} workspaceId="ws-1" diffSource={makeSource()} />);
        fireEvent.click(fileRows().find(row => row.getAttribute('data-file-path') === 'two.ts')!);
        act(() => lastPanelProps.onToggleReviewed());
        expect(lastPanelProps.filePath).toBe('two.ts');
        expect(lastPanelProps.isReviewed).toBe(true);
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

        const twoRow = fileRows()
            .find(r => r.getAttribute('data-file-path') === 'two.ts');
        fireEvent.click(twoRow as HTMLElement);

        expect(screen.getByTestId('pr-file-visited-two.ts')).toBeInTheDocument();
    });

    it('marks the active file, advances selection, and unmarks without advancing', async () => {
        renderWithProgress();
        await act(async () => { await Promise.resolve(); });

        expect(lastPanelProps.isReviewed).toBe(false);

        act(() => { lastPanelProps.onToggleReviewed(); });

        expect(lastPanelProps.filePath).toBe('two.ts');
        expect(lastPanelProps.isReviewed).toBe(false);
        expect(screen.getByRole('button', { name: /one.ts, .*viewed/ })).toBeInTheDocument();
        // Reviewed supersedes the visited dot.
        expect(screen.queryByTestId('pr-file-visited-one.ts')).not.toBeInTheDocument();

        fireEvent.click(fileRows().find(row => row.getAttribute('data-file-path') === 'one.ts')!);
        expect(lastPanelProps.isReviewed).toBe(true);
        act(() => { lastPanelProps.onToggleReviewed(); });
        expect(lastPanelProps.isReviewed).toBe(false);
        expect(lastPanelProps.filePath).toBe('one.ts');
    });

    it('persists the reviewed file and next selection, and ignores a delayed persistence failure', async () => {
        vi.useFakeTimers();
        try {
            let fail!: (reason: Error) => void;
            putReviewProgressMock.mockImplementation(() => new Promise<void>((_, reject) => { fail = reject; }));
            renderWithProgress();
            await act(async () => { await Promise.resolve(); });
            act(() => lastPanelProps.onToggleReviewed());
            expect(lastPanelProps.filePath).toBe('two.ts');
            await act(async () => { await vi.advanceTimersByTimeAsync(400); });
            expect(putReviewProgressMock).toHaveBeenLastCalledWith(persistence, {
                headSha: 'head-sha', reviewedFiles: ['one.ts'], visitedFiles: ['one.ts', 'two.ts'], lastSelectedFile: 'two.ts',
            });
            await act(async () => fail(new Error('offline')));
            expect(lastPanelProps.filePath).toBe('two.ts');
            expect(screen.getByRole('button', { name: /one.ts, .*viewed/ })).toBeInTheDocument();
        } finally { vi.useRealTimers(); }
    });

    it.each(['owner', 'head', 'comparison'])('rejects an old toggle after a %s change', async change => {
        const props = { files: parsedFiles, workspaceId: 'ws-1', diffSource: makeSource(), headSha: 'head-sha', reviewPersistence: persistence };
        const view = render(<PrFilesPanel {...props} />);
        await act(async () => { await Promise.resolve(); });
        const oldToggle = lastPanelProps.onToggleReviewed;
        view.rerender(<PrFilesPanel {...props} {...(change === 'owner' ? { attachmentDestinationId: 'remote:other:ws-1' }
            : change === 'head' ? { headSha: 'new-head' } : { diffSource: { ...props.diffSource, cacheKey: 'other-comparison' } })} />);
        act(() => oldToggle());
        expect(lastPanelProps.filePath).toBe('one.ts');
        expect(lastPanelProps.isReviewed).toBe(false);
    });

    it('renders reviewed state loaded from the shared server record', async () => {
        fetchReviewProgressMock.mockResolvedValue({
            headSha: 'head-sha', reviewedFiles: ['two.ts'], visitedFiles: ['two.ts'], lastSelectedFile: 'two.ts',
        });
        renderWithProgress();
        await act(async () => { await Promise.resolve(); });

        expect(screen.getByRole('button', { name: /two.ts, .*viewed/ })).toBeInTheDocument();
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
        expect(screen.getByRole('button', { name: /one.ts, .*viewed/ })).toBeInTheDocument();
    });
});


describe('PR shared navigator regressions', () => {
    const nav = () => screen.getByRole('complementary', { name: 'Changed files' });
    it.each([
        ['ArrowDown', 'one.ts', 'two.ts'],
        ['End', 'one.ts', 'two.ts'],
        ['ArrowUp', 'two.ts', 'one.ts'],
        ['Home', 'two.ts', 'one.ts'],
    ])('keeps the drawer open and the selected row focused after %s', (key, from, to) => {
        render(<PrFilesPanel files={parsedFiles} workspaceId="ws-1" diffSource={makeSource()} />);
        const trigger = screen.getByRole('button', { name: 'Files · 2' });
        fireEvent.click(trigger);
        const start = nav().querySelector<HTMLButtonElement>(`[data-file-path="${from}"]`)!;
        start.focus();
        fireEvent.keyDown(start, { key });
        expect(lastPanelProps.filePath).toBe(to);
        expect(trigger).toHaveAttribute('aria-expanded', 'true');
        const selected = nav().querySelector<HTMLButtonElement>(`[data-file-path="${to}"]`)!;
        expect(selected).toHaveFocus();
        fireEvent.click(selected);
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
        expect(trigger).toHaveFocus();
    });
    it.each(['gh_org_repo', 'ado_org_project_repo'])('preserves %s source capabilities, rename metadata and filtered navigation', origin => {
        const files = [
            { path: 'src/new.ts', oldPath: 'old/name.ts', status: 'renamed', additions: 1, deletions: 2 },
            { path: 'src/gone.ts', status: 'deleted', additions: 0, deletions: 3 },
            { path: 'assets/image.bin', status: 'added' },
            { path: 'test/new.test.ts', status: 'modified' },
        ];
        const source = { ...makeSource(), cacheKey: `pr:${origin}:7:head` };
        render(<PrFilesPanel files={files} workspaceId="ws-1" attachmentDestinationId="remote:server:ws-1" diffSource={source} />);
        expect(nav().querySelector('[data-file-path="src/new.ts"]')).toHaveAttribute('title', 'old/name.ts → src/new.ts');
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'old/name' } });
        expect(lastPanelProps.source.files).toEqual(['src/new.ts']);
        expect(lastPanelProps.source.fileDiffUrl).toBe(source.fileDiffUrl);
        expect(lastPanelProps.source.commentContext).toBe(source.commentContext);
        expect(lastPanelProps.source.cacheKey).toBe(source.cacheKey);
        fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } });
        fireEvent.change(screen.getByLabelText('Change status filter'), { target: { value: 'D' } });
        expect(lastPanelProps.filePath).toBe('src/gone.ts');
        expect(lastPanelProps.source.files).toEqual(['src/gone.ts']);
        fireEvent.change(screen.getByLabelText('Change status filter'), { target: { value: 'A' } });
        expect(lastPanelProps.filePath).toBe('assets/image.bin');
        expect(lastPanelProps.source.files).toEqual(['assets/image.bin']);
        expect(lastPanelProps.attachmentDestinationId).toBe('remote:server:ws-1');
    });
    it('shares resize, drawer focus, keyboard selection and owner-scoped filter reset', () => {
        const props = { files: parsedFiles, workspaceId: 'ws-1', diffSource: makeSource() };
        const view = render(<PrFilesPanel {...props} />);
        const separator = screen.getByRole('separator', { name: 'Resize changed files list' });
        fireEvent.keyDown(separator, { key: 'End' });
        expect(separator).toHaveAttribute('aria-valuenow', '560');
        fireEvent.doubleClick(separator);
        const trigger = screen.getByRole('button', { name: 'Files · 2' });
        fireEvent.click(trigger);
        expect(screen.getByRole('textbox')).toHaveFocus();
        const one = nav().querySelector('[data-file-path="one.ts"]')!;
        fireEvent.keyDown(one, { key: 'ArrowDown' });
        expect(lastPanelProps.filePath).toBe('two.ts');
        expect(nav().querySelector('[data-file-path="two.ts"]')).toHaveFocus();
        fireEvent.keyDown(nav(), { key: 'Escape' });
        expect(trigger).toHaveFocus();
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'two' } });
        view.rerender(<PrFilesPanel {...props} attachmentDestinationId="remote:other:ws-1" />);
        expect(screen.getByRole('textbox')).toHaveValue('');
        expect(lastPanelProps.filePath).toBe('one.ts');
    });
    it('uses kind and hide-viewed filters for mark-to-next, retaining the last selected file', () => {
        const files = ['src/a.ts', 'src/b.ts', 'test/a.test.ts'].map(path => ({ path, status: 'M' }));
        render(<PrFilesPanel files={files} workspaceId="ws-1" diffSource={{ ...makeSource(), fetchFileList: vi.fn() }} />);
        fireEvent.click(screen.getByRole('button', { name: 'Source 2', exact: true }));
        fireEvent.click(screen.getByLabelText('Hide viewed'));
        act(() => lastPanelProps.onToggleReviewed());
        expect(lastPanelProps.filePath).toBe('src/b.ts');
        expect(lastPanelProps.source.files).toEqual(['src/b.ts']);
        act(() => lastPanelProps.onToggleReviewed());
        expect(lastPanelProps.filePath).toBe('src/b.ts');
        expect(lastPanelProps.isReviewed).toBe(true);
        expect(nav().querySelectorAll('[data-file-path]')).toHaveLength(0);
        expect(lastPanelProps.source.fetchFileList).toBeUndefined();
    });
});
