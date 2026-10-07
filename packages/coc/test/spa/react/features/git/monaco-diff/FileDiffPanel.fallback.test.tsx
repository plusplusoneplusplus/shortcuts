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

import { FileDiffPanel } from '../../../../../../src/server/spa/client/react/features/git/diff/FileDiffPanel';

function content(extra: Partial<GitFileDiffContentResponse> = {}): GitFileDiffContentResponse {
    return {
        path: 'src/a.ts', fileName: 'a.ts', language: 'typescript',
        base: { content: 'before\n', ref: 'base', exists: true },
        head: { content: 'after\n', ref: 'head', exists: true },
        binary: false, tooLarge: false, ...extra,
    };
}

type SourceKind = 'commit' | 'branch-range' | 'pull-request';
function makeSource(kind: SourceKind, fetchFileContent = vi.fn(async () => content())): DiffSource {
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
            expect(useComments).toHaveBeenCalledWith('ws-a', source.commentContext('src/a.ts'));
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
