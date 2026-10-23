import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { forwardRef } from 'react';
import type { GitFileDiffContentResponse } from '@plusplusoneplusplus/coc-client';
import type { DiffComment } from '../../../../../../src/server/spa/client/comments/diff-comment-types';
import type { DiffSource } from '../../../../../../src/server/spa/client/react/features/git/diff/diffSource';
import type { DiffEditorFactory } from '../../../../../../src/server/spa/client/react/features/git/diff/monacoDiffEditorAdapter';
import { createFakeDiffEditor, type FakeDiffEditor } from './fakeDiffEditorAdapter';

let preference: 'monaco' | 'legacy';
let viewMode: 'unified' | 'split';
let comments: DiffComment[];
const useComments = vi.fn();
const usePatch = vi.fn();
const requestFullDiff = vi.fn();
let classicProps: { diff: string; comments: DiffComment[] } | null;

vi.mock('../../../../../../src/server/spa/client/react/features/git/hooks/useDiffEngine', () => ({
    useDiffEngine: () => [preference, vi.fn()],
}));
vi.mock('../../../../../../src/server/spa/client/react/features/git/hooks/useDiffViewMode', () => ({
    useDiffViewMode: () => [viewMode, vi.fn()],
}));
vi.mock('../../../../../../src/server/spa/client/react/features/git/hooks/useFileDiff', () => ({
    useFileDiff: (...args: unknown[]) => {
        usePatch(...args);
        return {
            diff: '@@ -1 +1 @@\n-before\n+after', loading: false, error: null,
            truncated: true, totalLines: 6000, requestFullDiff, retry: vi.fn(),
        };
    },
}));
vi.mock('../../../../../../src/server/spa/client/react/features/git/hooks/useDiffComments', () => ({
    useDiffComments: (...args: unknown[]) => {
        useComments(...args);
        return {
            comments, loading: false, addComment: vi.fn(), deleteComment: vi.fn(),
            updateComment: vi.fn(), resolveComment: vi.fn(), unresolveComment: vi.fn(),
            runRelocation: vi.fn(), askAI: vi.fn(), aiLoadingIds: new Set(),
            aiErrors: new Map(), clearAiError: vi.fn(), resolvingIds: new Set(),
            deletingIds: new Set(), copyAllCommentsAsPrompt: vi.fn(),
            resolveWithAI: vi.fn(), fixWithAI: vi.fn(),
        };
    },
}));
vi.mock('../../../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ dispatch: vi.fn() }),
}));
vi.mock('../../../../../../src/server/spa/client/react/layout/ThemeProvider', () => ({
    useTheme: () => ({ theme: 'light' }),
}));
vi.mock('../../../../../../src/server/spa/client/react/features/git/hooks/useCommitChatPresentation', () => ({
    useCommitChatPresentation: () => ({ chatOpen: false }),
}));
vi.mock('../../../../../../src/server/spa/client/react/features/git/diff/UnifiedDiffViewer', () => ({
    UnifiedDiffViewer: forwardRef<HTMLDivElement, { diff: string; comments: DiffComment[] }>((props, ref) => {
        classicProps = props;
        return <div ref={ref} data-testid="classic-viewer">{props.diff}{props.comments.map(c => c.comment).join(' ')}</div>;
    }),
    HunkNavButtons: () => null,
}));
vi.mock('../../../../../../src/server/spa/client/react/features/git/diff/DiffMiniMap', () => ({
    DiffMiniMap: () => null,
}));
vi.mock('../../../../../../src/server/spa/client/react/features/git/diff/SideBySideDiffViewer', () => ({
    SideBySideDiffViewer: forwardRef<HTMLDivElement, { diff: string; comments: DiffComment[] }>((props, ref) => {
        classicProps = props;
        return <div ref={ref} data-testid="classic-split-viewer">{props.diff}</div>;
    }),
}));

type NavigateTarget = { workspaceId: string; path: string; line: number; column: number; symbolCandidate?: true };
const currentCodeMounts = vi.hoisted(() => [] as { uri: string; routingRef: unknown; onNavigate: (target: NavigateTarget) => boolean }[]);
vi.mock('../../../../../../src/server/spa/client/react/features/git/diff/diffCurrentCodeMount', () => ({
    mountDiffCurrentCodeModel: (options: { model: { uri: { toString(): string } }; routingRef: unknown; onNavigate: (target: NavigateTarget) => boolean }) => {
        currentCodeMounts.push({ uri: options.model.uri.toString(), routingRef: options.routingRef, onNavigate: options.onNavigate });
        return () => {};
    },
}));
const openUnifiedPanelTab = vi.hoisted(() => vi.fn(() => 'tab-id'));
vi.mock('../../../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelOpen', async importOriginal => ({
    ...(await importOriginal<object>()),
    openUnifiedPanelTab,
}));

import { FileDiffPanel } from '../../../../../../src/server/spa/client/react/features/git/diff/FileDiffPanel';
import { UnifiedPanelHostProvider } from '../../../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelHost';

function content(extra: Partial<GitFileDiffContentResponse> = {}): GitFileDiffContentResponse {
    return {
        path: 'src/a.ts', fileName: 'a.ts', language: 'typescript',
        base: { content: 'before\n', ref: 'base', exists: true },
        head: { content: 'after\n', ref: 'head', exists: true },
        binary: false, tooLarge: false, ...extra,
    };
}

type SourceKind = 'commit' | 'branch-range' | 'pull-request';
function makeSource(kind: SourceKind, fetchFileContent: DiffSource['fetchFileContent'] = vi.fn(async () => content())): DiffSource {
    const [oldRef, newRef] = kind === 'commit' ? ['abc123^', 'abc123']
        : kind === 'branch-range' ? ['branch-base', 'branch-head'] : ['pr-42-base', 'pr-42-head'];
    return {
        label: kind, cacheKey: `${kind}:revision`,
        files: ['src/a.ts', 'src/b.ts'], chat: null, supportsTruncation: true,
        fileDiffUrl: (file, full) => `/patch/${kind}/${file}${full ? '?full=true' : ''}`,
        fullContextFileDiffUrl: file => `/patch/${kind}/${file}?context=full`,
        fullDiffUrl: () => null, fetchFileContent,
        commentContext: filePath => ({ repositoryId: 'ws-a', filePath, oldRef, newRef }),
    };
}

function commentFor(source: DiffSource): DiffComment {
    return {
        id: 'comment-1', context: source.commentContext('src/a.ts'),
        selection: { diffLineStart: 2, diffLineEnd: 2, side: 'added', newLineStart: 1, newLineEnd: 1, startColumn: 0, endColumn: 5 },
        selectedText: 'after', comment: 'Keep this comment', status: 'open',
        createdAt: '', updatedAt: '',
    };
}

let fakes: FakeDiffEditor[];
const createEditor: DiffEditorFactory = async (_host, options) => {
    const fake = createFakeDiffEditor(options);
    fakes.push(fake);
    return fake.adapter;
};
async function mount(source: DiffSource, factory: DiffEditorFactory = createEditor) {
    let view!: ReturnType<typeof render>;
    await act(async () => {
        view = render(<FileDiffPanel workspaceId="ws-a" filePath="src/a.ts" source={source} createDiffEditor={factory} />);
    });
    return view;
}

beforeEach(() => {
    vi.clearAllMocks();
    preference = 'monaco';
    viewMode = 'unified';
    comments = [];
    classicProps = null;
    fakes = [];
    currentCodeMounts.length = 0;
});

describe('historical definition surfaces', () => {
    it.each([
        ['commit', true],
        ['branch-range', true],
        ['pull-request', false],
    ] as const)('%s source mounts current-code definitions: %s', async (kind, expected) => {
        const source = { ...makeSource(kind), routingTarget: 'remote:srv:ws-a', supportsCurrentCodeDefinitions: kind !== 'pull-request' };
        await mount(source);
        await act(async () => {});
        expect(fakes).toHaveLength(1);
        expect(fakes[0].historicalMounts.map(m => m.side)).toEqual(expected ? ['original', 'modified'] : []);
        expect(currentCodeMounts.map(m => m.routingRef)).toEqual(expected ? ['remote:srv:ws-a', 'remote:srv:ws-a'] : []);
    });
});

describe('commit hybrid resolution', () => {
    it.each([true, false])('a commit head matching the working copy (%s) switches between full LSP and current-code lookup', async matches => {
        const fetchContent = vi.fn(async () => content({ modifiedMatchesWorkingCopy: matches }));
        const source = { ...makeSource('commit', fetchContent), supportsWorkingCopyLanguage: true, supportsCurrentCodeDefinitions: true };
        await mount(source);
        await act(async () => {});
        const models = fakes[0].models.at(-1)!;
        expect(models.original.uri).toMatch(/^coc-diff-ref:/);
        expect(models.modified.uri.startsWith('coc-diff-ref:')).toBe(!matches);
        // The parent side always uses the current-code lookup; the head only when it is not the working copy.
        expect(fakes[0].historicalMounts.map(m => m.side)).toEqual(matches ? ['original'] : ['original', 'modified']);
        expect(currentCodeMounts.every(m => m.uri.startsWith('coc-diff-ref:'))).toBe(true);
    });
});

describe('definition routing', () => {
    const panelHost = { workspaceId: 'group-1', chatId: 'chat-1', routingRef: null };
    const jumpFrom = (side: 'original' | 'modified') => currentCodeMounts[side === 'original' ? currentCodeMounts.length - 2 : currentCodeMounts.length - 1];
    const target = (path: string, extra: Partial<NavigateTarget> = {}): NavigateTarget => ({ workspaceId: 'ws-a', path, line: 9, column: 3, ...extra });
    const commitSource = () => ({ ...makeSource('commit'), supportsCurrentCodeDefinitions: true });
    function panel(source: DiffSource, filePath: string, onNavigateToFile: (path: string, hunk: 'first' | 'last') => void, host = true) {
        const body = <FileDiffPanel workspaceId="ws-a" filePath={filePath} source={source} createDiffEditor={createEditor}
            onNavigateToFile={onNavigateToFile} initialHunkTarget="first" />;
        return host ? <UnifiedPanelHostProvider host={panelHost}>{body}</UnifiedPanelHostProvider> : body;
    }

    it('reveals a same-file target on the side the jump started from', async () => {
        const source = commitSource();
        const onNavigateToFile = vi.fn();
        await act(async () => { render(panel(source, 'src/a.ts', onNavigateToFile)); });
        let handled: boolean | undefined;
        act(() => { handled = jumpFrom('original').onNavigate(target('src/a.ts')); });
        expect(handled).toBe(true);
        expect(fakes[0].revealedPositions).toEqual([{ side: 'original', line: 9, column: 3 }]);
        expect(onNavigateToFile).not.toHaveBeenCalled();
        expect(openUnifiedPanelTab).not.toHaveBeenCalled();
    });

    it('switches to a changed file of the review and reveals there instead of the first hunk', async () => {
        const fetchContent = vi.fn(async (path: string) => content({ path, base: { content: `${path} old\n`, ref: 'base', exists: true } }));
        const source = { ...makeSource('commit', fetchContent), supportsCurrentCodeDefinitions: true };
        const onNavigateToFile = vi.fn();
        let view!: ReturnType<typeof render>;
        await act(async () => { view = render(panel(source, 'src/a.ts', onNavigateToFile)); });
        act(() => { jumpFrom('modified').onNavigate(target('src/b.ts')); });
        expect(onNavigateToFile).toHaveBeenCalledWith('src/b.ts', 'first');
        expect(fakes[0].revealedPositions).toEqual([]);
        await act(async () => { view.rerender(panel(source, 'src/b.ts', onNavigateToFile)); });
        await act(async () => {});
        expect(fakes[0].models.at(-1)?.original.text).toBe('src/b.ts old\n');
        expect(fakes[0].revealedPositions).toEqual([{ side: 'modified', line: 9, column: 3 }]);
        act(() => { fakes[0].finishDiff([{ originalStartLineNumber: 1, originalEndLineNumber: 1, modifiedStartLineNumber: 1, modifiedEndLineNumber: 1 }]); });
        expect(fakes[0].adapter.revealModifiedLine).not.toHaveBeenCalled();
    });

    it('a later file change drops a reveal that was not for it', async () => {
        const source = commitSource();
        const onNavigateToFile = vi.fn();
        let view!: ReturnType<typeof render>;
        await act(async () => { view = render(panel(source, 'src/a.ts', onNavigateToFile)); });
        act(() => { jumpFrom('modified').onNavigate(target('src/b.ts')); });
        await act(async () => { view.rerender(panel(source, 'src/c.ts', onNavigateToFile)); });
        await act(async () => { view.rerender(panel(source, 'src/b.ts', onNavigateToFile)); });
        await act(async () => {});
        expect(fakes[0].revealedPositions).toEqual([]);
    });

    it('opens any other file in the Explorer panel at the definition line', async () => {
        const source = { ...commitSource(), routingTarget: 'remote:srv:ws-a' };
        await act(async () => { render(panel(source, 'src/a.ts', vi.fn())); });
        let handled: boolean | undefined;
        act(() => { handled = jumpFrom('original').onNavigate(target('lib/util.ts', { symbolCandidate: true })); });
        expect(handled).toBe(true);
        expect(openUnifiedPanelTab).toHaveBeenCalledWith('group-1', expect.objectContaining({
            kind: 'file', ownerWorkspaceId: 'ws-a', ownerRoutingRef: 'remote:srv:ws-a', chatId: 'chat-1',
            resourceId: 'lib/util.ts', line: 9, column: 3, symbolCandidate: true,
        }));
        expect(fakes[0].revealedPositions).toEqual([]);
    });

    it('falls back to the Explorer deep link without a unified panel', async () => {
        location.hash = '';
        await act(async () => { render(panel(commitSource(), 'src/a.ts', vi.fn(), false)); });
        act(() => { jumpFrom('modified').onNavigate(target('lib/util.ts')); });
        expect(location.hash).toBe(`#repos/ws-a/explorer/${encodeURIComponent('lib/util.ts')}`);
        expect(openUnifiedPanelTab).not.toHaveBeenCalled();
        location.hash = '';
    });

    it('Alt+← and the back chip return to the exact file, side and scroll spot', async () => {
        const fetchContent = vi.fn(async (path: string) => content({ path, base: { content: `${path} old\n`, ref: 'base', exists: true } }));
        const source = { ...makeSource('commit', fetchContent), supportsCurrentCodeDefinitions: true, shortRef: 'abc1234' };
        const onNavigateToFile = vi.fn();
        let view!: ReturnType<typeof render>;
        await act(async () => { view = render(panel(source, 'src/a.ts', onNavigateToFile)); });
        expect(screen.queryByTestId('diff-definition-back-chip')).toBeNull();

        // Same-file jump from the old side, then back with Alt+←.
        fakes[0].viewPositions.original = { line: 4, column: 6, scrollTop: 140 };
        act(() => { jumpFrom('original').onNavigate(target('src/a.ts')); });
        expect(screen.getByTestId('diff-definition-back-chip').textContent).toBe('← Back to abc1234 · a.ts');
        const key = new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true, cancelable: true });
        act(() => { screen.getByTestId('file-diff-panel').dispatchEvent(key); });
        expect(key.defaultPrevented).toBe(true);
        expect(fakes[0].revealedPositions.at(-1)).toEqual({ side: 'original', line: 4, column: 6, scrollTop: 140 });
        expect(screen.queryByTestId('diff-definition-back-chip')).toBeNull();

        // Cross-file jump from the new side, then the chip switches back.
        fakes[0].viewPositions.modified = { line: 12, column: 1, scrollTop: 400 };
        act(() => { jumpFrom('modified').onNavigate(target('src/b.ts')); });
        await act(async () => { view.rerender(panel(source, 'src/b.ts', onNavigateToFile)); });
        await act(async () => {});
        expect(screen.getByTestId('diff-definition-back-chip').textContent).toBe('← Back to abc1234 · a.ts');
        act(() => { fireEvent.click(screen.getByTestId('diff-definition-back-chip')); });
        expect(onNavigateToFile).toHaveBeenLastCalledWith('src/a.ts', 'first');
        await act(async () => { view.rerender(panel(source, 'src/a.ts', onNavigateToFile)); });
        await act(async () => {});
        expect(fakes[0].models.at(-1)?.original.text).toBe('src/a.ts old\n');
        expect(fakes[0].revealedPositions.at(-1)).toEqual({ side: 'modified', line: 12, column: 1, scrollTop: 400 });
        expect(screen.queryByTestId('diff-definition-back-chip')).toBeNull();
    });

    it('leaves Alt+← to the editor when there is nothing to go back to, and Explorer jumps add no history', async () => {
        await act(async () => { render(panel(commitSource(), 'src/a.ts', vi.fn())); });
        fakes[0].viewPositions.modified = { line: 1, column: 1, scrollTop: 0 };
        act(() => { jumpFrom('modified').onNavigate(target('lib/util.ts')); });
        expect(screen.queryByTestId('diff-definition-back-chip')).toBeNull();
        const key = new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true, cancelable: true });
        act(() => { screen.getByTestId('file-diff-panel').dispatchEvent(key); });
        expect(key.defaultPrevented).toBe(false);
    });

    it('declines a target in another workspace', async () => {
        await act(async () => { render(panel(commitSource(), 'src/a.ts', vi.fn())); });
        let handled: boolean | undefined;
        act(() => { handled = jumpFrom('modified').onNavigate(target('src/b.ts', { workspaceId: 'ws-b' })); });
        expect(handled).toBe(false);
        expect(openUnifiedPanelTab).not.toHaveBeenCalled();
    });
});

describe.each<SourceKind>(['commit', 'branch-range', 'pull-request'])('%s fallback wiring', kind => {
    it.each(['malformed', 'synchronous'] as const)('falls back safely for a %s content loader failure', async failure => {
        const loader = failure === 'malformed'
            ? vi.fn().mockResolvedValue({ comments: [] })
            : vi.fn(() => { throw new Error('Loader failed before returning a promise'); });
        await mount(makeSource(kind, loader));
        expect(screen.getByTestId('diff-engine-fallback-banner').getAttribute('data-reason')).toBe('loadFailed');
        expect(screen.getByTestId('classic-viewer')).toBeTruthy();
        expect(fakes).toHaveLength(0);
        expect(screen.getByTestId('diff-engine-fallback-retry')).toBeTruthy();
    });

    it.each(['binary', 'tooLarge', 'loadFailed', 'editorFailed'] as const)(
        'shows %s and preserves the existing comments, context, and patch path',
        async reason => {
            const fetchContent = vi.fn(async () => content());
            if (reason === 'loadFailed') {
                fetchContent.mockRejectedValue(new Error('content-unavailable'));
            } else if (reason === 'binary' || reason === 'tooLarge') {
                fetchContent.mockResolvedValue(content({
                    [reason]: true,
                    base: { content: '', ref: 'base', exists: true },
                    head: { content: '', ref: 'head', exists: true },
                }));
            }
            const source = makeSource(kind, fetchContent);
            comments = [commentFor(source)];
            const failedFactory = vi.fn<DiffEditorFactory>().mockRejectedValue(new Error('editor start failed'));
            const view = await mount(source, reason === 'editorFailed' ? failedFactory : createEditor);

            expect(screen.getByTestId('diff-engine-fallback-banner').getAttribute('data-reason')).toBe(reason);
            expect(screen.queryByTestId('file-diff-editor')).toBeNull();
            expect(screen.getByTestId('classic-viewer').textContent).toContain('Keep this comment');
            expect(classicProps?.comments).toBe(comments);
            expect(classicProps?.diff).toBe('@@ -1 +1 @@\n-before\n+after');
            expect(useComments).toHaveBeenCalledWith('ws-a', source.commentContext('src/a.ts'), undefined);
            expect(usePatch).toHaveBeenCalledWith(source.fileDiffUrl('src/a.ts'), source.fileDiffUrl('src/a.ts', true), 'ws-a');
            expect(screen.getByTestId('full-context-toggle-btn')).toBeTruthy();
            fireEvent.click(screen.getByTestId('load-full-diff-btn'));
            expect(requestFullDiff).toHaveBeenCalledOnce();
            expect(!!screen.queryByTestId('diff-engine-fallback-retry'))
                .toBe(reason === 'loadFailed' || reason === 'editorFailed');
            expect(fakes).toHaveLength(0);

            view.rerender(<FileDiffPanel workspaceId="ws-a" filePath="src/a.ts" source={{ ...source }} createDiffEditor={failedFactory} />);
            expect(fetchContent).toHaveBeenCalledOnce();
            expect(failedFactory).toHaveBeenCalledTimes(reason === 'editorFailed' ? 1 : 0);
        },
    );

    it.each(['load', 'editor'] as const)('retries a %s failure with a fresh content request and editor mount', async failure => {
        const fetchContent = vi.fn(async () => content());
        if (failure === 'load') fetchContent.mockRejectedValueOnce(new Error('content-unavailable'));
        const factory = vi.fn<DiffEditorFactory>().mockImplementation(createEditor);
        if (failure === 'editor') factory.mockRejectedValueOnce(new Error('editor start failed'));
        const source = makeSource(kind, fetchContent);
        await mount(source, factory);
        await act(async () => { fireEvent.click(screen.getByTestId('diff-engine-fallback-retry')); });

        expect(fetchContent).toHaveBeenCalledTimes(2);
        expect(screen.queryByTestId('diff-engine-fallback-banner')).toBeNull();
        expect(screen.queryByTestId('classic-viewer')).toBeNull();
        expect(screen.getByTestId('file-diff-editor')).toBeTruthy();
        expect(fakes).toHaveLength(1);
        expect(fakes[0].models[0].modified.text).toBe('after\n');
        expect(screen.queryByTestId('diff-truncation-banner')).toBeNull();
    });

    it('uses Classic without a fallback banner when explicitly selected', async () => {
        preference = 'legacy';
        const fetchContent = vi.fn(async () => content());
        await mount(makeSource(kind, fetchContent));
        expect(screen.getByTestId('classic-viewer')).toBeTruthy();
        expect(screen.queryByTestId('diff-engine-fallback-banner')).toBeNull();
        expect(fetchContent).not.toHaveBeenCalled();
        expect(fakes).toHaveLength(0);
    });
});

it('clears a sticky editor failure when navigating to another file or source revision', async () => {
    const source = makeSource('commit');
    const factory = vi.fn<DiffEditorFactory>()
        .mockRejectedValueOnce(new Error('editor start failed'))
        .mockImplementation(createEditor);
    const view = await mount(source, factory);
    expect(screen.getByTestId('diff-engine-fallback-banner')).toBeTruthy();
    await act(async () => {
        view.rerender(<FileDiffPanel workspaceId="ws-a" filePath="src/b.ts" source={source} createDiffEditor={factory} />);
    });
    expect(screen.queryByTestId('diff-engine-fallback-banner')).toBeNull();
    expect(fakes).toHaveLength(1);
    await act(async () => {
        view.rerender(<FileDiffPanel workspaceId="ws-a" filePath="src/a.ts" source={{ ...source, cacheKey: 'commit:next' }} createDiffEditor={factory} />);
    });
    expect(screen.queryByTestId('diff-engine-fallback-banner')).toBeNull();
    expect(fakes).toHaveLength(1);
    expect(fakes[0].disposals).toBe(0);
    expect(fakes[0].models.at(-1)?.modified.uri).toContain('commit');
});

it('ignores an old content failure after switching files', async () => {
    let rejectOld!: (error: Error) => void;
    const fetchContent = vi.fn(async () => content()).mockReturnValueOnce(
        new Promise<GitFileDiffContentResponse>((_resolve, reject) => { rejectOld = reject; }),
    );
    const source = makeSource('pull-request', fetchContent);
    const view = await mount(source);
    expect(screen.getByTestId('file-diff-editor-loading')).toBeTruthy();
    await act(async () => {
        view.rerender(<FileDiffPanel workspaceId="ws-a" filePath="src/b.ts" source={source} createDiffEditor={createEditor} />);
        rejectOld(new Error('content-unavailable'));
    });
    expect(screen.queryByTestId('diff-engine-fallback-banner')).toBeNull();
    expect(screen.getByTestId('file-diff-editor')).toBeTruthy();
    expect(fakes).toHaveLength(1);
});

it('keeps patch-only sources on Classic without reporting a failed load', async () => {
    const source = makeSource('commit');
    await mount({ ...source, fetchFileContent: undefined });
    expect(screen.getByTestId('classic-viewer')).toBeTruthy();
    expect(screen.queryByTestId('diff-engine-fallback-banner')).toBeNull();
});

it('preserves comments in split fallback and removes the banner when Classic is selected', async () => {
    viewMode = 'split';
    const source = makeSource('branch-range', vi.fn(async () => content({ binary: true })));
    comments = [commentFor(source)];
    const view = await mount(source);
    expect(screen.getByTestId('classic-split-viewer')).toBeTruthy();
    expect(classicProps?.comments).toBe(comments);
    expect(screen.getByTestId('diff-engine-fallback-banner')).toBeTruthy();
    preference = 'legacy';
    view.rerender(<FileDiffPanel workspaceId="ws-a" filePath="src/a.ts" source={source} />);
    expect(screen.queryByTestId('diff-engine-fallback-banner')).toBeNull();
    expect(screen.getByTestId('classic-split-viewer')).toBeTruthy();
});

it('waits for a retry response without reusing old failure state or full-context controls', async () => {
    let resolveRetry!: (value: GitFileDiffContentResponse) => void;
    const fetchContent = vi.fn(async () => content())
        .mockRejectedValueOnce(new Error('content-unavailable'))
        .mockReturnValueOnce(new Promise<GitFileDiffContentResponse>(resolve => { resolveRetry = resolve; }));
    await mount(makeSource('commit', fetchContent));
    fireEvent.click(screen.getByTestId('diff-engine-fallback-retry'));
    expect(screen.getByTestId('file-diff-editor-loading')).toBeTruthy();
    expect(screen.queryByTestId('diff-engine-fallback-banner')).toBeNull();
    expect(screen.queryByTestId('full-context-toggle-btn')).toBeNull();
    await act(async () => { resolveRetry(content()); });
    expect(screen.getByTestId('file-diff-editor')).toBeTruthy();
    expect(fetchContent).toHaveBeenCalledTimes(2);
});

it('scopes content and editor failure state to the selected workspace', async () => {
    const source = makeSource('branch-range');
    const factory = vi.fn<DiffEditorFactory>()
        .mockRejectedValueOnce(new Error('editor start failed'))
        .mockImplementation(createEditor);
    const view = await mount(source, factory);
    expect(screen.getByTestId('diff-engine-fallback-banner')).toBeTruthy();
    const fetchContent = vi.fn(async () => content({ head: { content: 'remote\n', ref: 'head', exists: true } }));
    await act(async () => {
        view.rerender(<FileDiffPanel workspaceId="ws-b" filePath="src/a.ts" source={{ ...source, fetchFileContent: fetchContent }} createDiffEditor={factory} />);
    });
    expect(fetchContent).toHaveBeenCalledOnce();
    expect(screen.queryByTestId('diff-engine-fallback-banner')).toBeNull();
    expect(fakes[0].models[0].modified.text).toBe('remote\n');
    expect(fakes[0].models[0].modified.uri).toContain('ws-b');
});

it('renders deleted text against an empty modified side without fallback', async () => {
    await mount(makeSource('commit', vi.fn(async () => content({
        head: { content: '', ref: 'head', exists: false },
    }))));
    expect(screen.queryByTestId('diff-engine-fallback-banner')).toBeNull();
    expect(fakes[0].models[0].modified.text).toBe('');
    expect(fakes[0].models[0].original.text).toBe('before\n');
});

it.each<SourceKind>(['commit', 'branch-range', 'pull-request'])(
    '%s keeps equal-text models at different resolved refs separate', async kind => {
        await mount(makeSource(kind));
        await mount(makeSource(kind, vi.fn(async () => content({
            base: { content: 'before\n', ref: 'other-base', exists: true },
            head: { content: 'after\n', ref: 'other-head', exists: true },
        }))));
        expect(fakes).toHaveLength(2);
        expect(fakes[0].models[0].original.text).toBe(fakes[1].models[0].original.text);
        expect(fakes[0].models[0].modified.text).toBe(fakes[1].models[0].modified.text);
        expect(fakes[0].models[0].original.uri).not.toBe(fakes[1].models[0].original.uri);
        expect(fakes[0].models[0].modified.uri).not.toBe(fakes[1].models[0].modified.uri);
    },
);


it('reuses Monaco across delayed file loads and discards superseded responses', async () => {
    let resolveB!: (value: GitFileDiffContentResponse) => void;
    let resolveC!: (value: GitFileDiffContentResponse) => void;
    const fetchContent = vi.fn(async () => content())
        .mockReturnValueOnce(Promise.resolve(content()))
        .mockReturnValueOnce(new Promise<GitFileDiffContentResponse>(resolve => { resolveB = resolve; }))
        .mockReturnValueOnce(new Promise<GitFileDiffContentResponse>(resolve => { resolveC = resolve; }));
    const source = makeSource('commit', fetchContent);
    const view = await mount(source);
    const host = screen.getByTestId('file-diff-editor');
    await act(async () => {
        view.rerender(<FileDiffPanel workspaceId="ws-a" filePath="src/b.ts" source={source} createDiffEditor={createEditor} />);
    });
    expect(screen.getByTestId('file-diff-editor-loading')).toBeTruthy();
    expect(screen.getByTestId('file-diff-editor')).toBe(host);
    expect(host.closest('[hidden]')).toBeTruthy();
    expect(fakes[0].disposals).toBe(0);
    await act(async () => {
        view.rerender(<FileDiffPanel workspaceId="ws-a" filePath="src/c.ts" source={source} createDiffEditor={createEditor} />);
    });
    await act(async () => { resolveC(content({ head: { content: 'file C', ref: 'head', exists: true } })); });
    expect(screen.queryByTestId('file-diff-editor-loading')).toBeNull();
    expect(screen.getByTestId('file-diff-editor')).toBe(host);
    expect(host.closest('[hidden]')).toBeNull();
    expect(fakes).toHaveLength(1);
    expect(fakes[0].models.at(-1)?.modified.text).toBe('file C');
    expect(fakes[0].models.at(-1)?.modified.uri).toContain('c.ts');
    await act(async () => { resolveB(content({ head: { content: 'file B', ref: 'head', exists: true } })); });
    expect(fakes[0].models.at(-1)?.modified.text).toBe('file C');
    expect(fakes[0].disposals).toBe(0);
    view.unmount();
    expect(fakes[0].disposals).toBe(1);
});

it('disposes the retained editor when the next file requires Classic fallback', async () => {
    const fetchContent = vi.fn(async () => content())
        .mockResolvedValueOnce(content()).mockResolvedValueOnce(content({ binary: true }));
    const source = makeSource('commit', fetchContent);
    const view = await mount(source);
    await act(async () => {
        view.rerender(<FileDiffPanel workspaceId="ws-a" filePath="image.png" source={source} createDiffEditor={createEditor} />);
    });
    expect(screen.getByTestId('diff-engine-fallback-banner')).toBeTruthy();
    expect(screen.queryByTestId('file-diff-editor')).toBeNull();
    expect(fakes[0].disposals).toBe(1);
});


it.each(['binary', 'tooLarge'] as const)('never mounts the previous %s content while loading another file', async reason => {
    let resolveNext!: (value: GitFileDiffContentResponse) => void;
    const fetchContent = vi.fn(async () => content())
        .mockResolvedValueOnce(content({ [reason]: true }))
        .mockReturnValueOnce(new Promise<GitFileDiffContentResponse>(resolve => { resolveNext = resolve; }));
    const source = makeSource('commit', fetchContent);
    const view = await mount(source);
    await act(async () => {
        view.rerender(<FileDiffPanel workspaceId="ws-a" filePath="src/b.ts" source={source} createDiffEditor={createEditor} />);
    });
    expect(screen.getByTestId('file-diff-editor-loading')).toBeTruthy();
    expect(screen.queryByTestId('file-diff-editor')).toBeNull();
    expect(fakes).toHaveLength(0);
    await act(async () => { resolveNext(content()); });
    expect(screen.getByTestId('file-diff-editor')).toBeTruthy();
    expect(fakes).toHaveLength(1);
});
