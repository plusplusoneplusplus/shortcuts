/**
 * Wiring tests for the diff-engine preference in WorkingTreeFileDiff (AC-04):
 * the Classic/Editor toolbar control, engine selection from the cached
 * preference, both sides loaded from the selected workspace's client, and the
 * classic viewer when the editor cannot show the file. Monaco is not loaded;
 * the editor is the owned test adapter.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createFakeDiffEditor, type FakeDiffEditor } from './fakeDiffEditorAdapter';


// The unstaged editor opens a language document (AC-06); keep the transport inert.
vi.mock('../../../../../../src/server/spa/client/react/features/language-servers/languageServerClient',
    async () => await import('../../../language-servers/inertTransportMock'));
vi.mock('../../../../../../src/server/spa/client/react/features/git/hooks/useDiffComments', () => ({
    useDiffComments: () => ({
        comments: [], loading: false, error: null, isEphemeral: false,
        addComment: vi.fn(), updateComment: vi.fn(), deleteComment: vi.fn(),
        resolveComment: vi.fn(), unresolveComment: vi.fn(), askAI: vi.fn(),
        aiLoadingIds: new Set(), aiErrors: new Map(), clearAiError: vi.fn(),
        resolvingIds: new Set(), deletingIds: new Set(),
        refresh: vi.fn(), runRelocation: vi.fn(), copyAllCommentsAsPrompt: vi.fn(),
    }),
}));

vi.mock('../../../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ state: {}, dispatch: vi.fn() }),
}));

vi.mock('../../../../../../src/server/spa/client/react/layout/ThemeProvider', () => ({
    useTheme: () => ({ theme: 'light', setTheme: () => {} }),
}));

vi.mock('../../../../../../src/server/spa/client/react/features/git/diff/UnifiedDiffViewer', () => ({
    UnifiedDiffViewer: ({ diff }: { diff: string }) => <div data-testid="classic-viewer">{diff}</div>,
    HunkNavButtons: ({ onNext }: { onNext: () => void }) => <button data-testid="hunk-next" onClick={onNext}>next</button>,
}));

vi.mock('../../../../../../src/server/spa/client/react/features/repo-detail/explorer', () => ({
    PreviewPane: () => <div data-testid="preview-pane" />,
}));

const getGlobal = vi.fn();
const patchGlobal = vi.fn();
vi.mock('../../../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({ preferences: { getGlobal, patchGlobal } }),
}));

const selectionPill = vi.fn();
vi.mock('../../../../../../src/server/spa/client/react/features/git/diff/MonacoDiffSelectionAttachPill', () => ({
    MonacoDiffSelectionAttachPill: (props: any) => { selectionPill(props.source); return null; },
}));

type Content = {
    path: string; fileName: string; language: string; binary: boolean; tooLarge: boolean;
    base: { content: string; ref: string; exists: boolean };
    head: { content: string; ref: string; exists: boolean };
};
function content(original: string, modified: string, extra: Partial<Content> = {}): Content {
    return {
        path: '/repo/src/a.ts', fileName: 'a.ts', language: 'typescript', binary: false, tooLarge: false,
        base: { content: original, ref: 'INDEX', exists: true },
        head: { content: modified, ref: 'WORKTREE', exists: true },
        ...extra,
    };
}
function makeClient() {
    return {
        git: {
            getWorkingTreeFileDiff: vi.fn(async () => ({ diff: '@@ -1 +1 @@\n-a\n+b', truncated: false, totalLines: 2 })),
            getWorkingTreeFileContent: vi.fn(async () => content('a\n', 'b\n')),
        },
    };
}
const clients: Record<string, ReturnType<typeof makeClient>> = {};
vi.mock('../../../../../../src/server/spa/client/react/repos/cloneRouting', () => ({
    useCocClient: (workspaceId: string) => clients[workspaceId],
}));

type NavigateTarget = { workspaceId: string; path: string; line: number; column: number; symbolCandidate?: true };
const currentCodeMounts = vi.hoisted(() => [] as { uri: string; onNavigate: (target: NavigateTarget) => boolean }[]);
vi.mock('../../../../../../src/server/spa/client/react/features/git/diff/diffCurrentCodeMount', () => ({
    mountDiffCurrentCodeModel: (options: { model: { uri: { toString(): string } }; onNavigate: (target: NavigateTarget) => boolean }) => {
        currentCodeMounts.push({ uri: options.model.uri.toString(), onNavigate: options.onNavigate });
        return () => {};
    },
}));
const openUnifiedPanelTab = vi.hoisted(() => vi.fn(() => 'tab-id'));
vi.mock('../../../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelOpen', async importOriginal => ({
    ...(await importOriginal<object>()),
    openUnifiedPanelTab,
}));

import { WorkingTreeFileDiff, untrackedContentAsDiff } from '../../../../../../src/server/spa/client/react/features/git/working-tree/WorkingTreeFileDiff';
import {
    DIFF_ENGINE_STORAGE_KEY,
    __resetDiffEngineForTesting,
} from '../../../../../../src/server/spa/client/react/features/git/hooks/useDiffEngine';
import type { DiffEditorFactory } from '../../../../../../src/server/spa/client/react/features/git/diff/monacoDiffEditorAdapter';
import { __resetDiffWordWrapForTesting } from '../../../../../../src/server/spa/client/react/features/git/hooks/useDiffWordWrap';
import { UnifiedPanelHostProvider } from '../../../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelHost';
import {
    getDiffDefinitionReturn, resetDiffDefinitionReturns, returnToDiffDefinitionOrigin,
} from '../../../../../../src/server/spa/client/react/features/git/diff/diffDefinitionReturn';

let fakes: FakeDiffEditor[];
const createDiffEditor: DiffEditorFactory = async (_host, options) => {
    const fake = createFakeDiffEditor(options);
    fakes.push(fake);
    return fake.adapter;
};

async function renderDiff(props: Partial<React.ComponentProps<typeof WorkingTreeFileDiff>> = {}) {
    let view!: ReturnType<typeof render>;
    await act(async () => {
        view = render(
            <WorkingTreeFileDiff
                workspaceId="ws-a"
                filePath="/repo/src/a.ts"
                repoRoot="/repo"
                stage="unstaged"
                createDiffEditor={createDiffEditor}
                {...props}
            />,
        );
    });
    await act(async () => {});
    return view;
}

beforeEach(() => {
    fakes = [];
    currentCodeMounts.length = 0;
    openUnifiedPanelTab.mockClear();
    localStorage.clear();
    __resetDiffEngineForTesting();
    __resetDiffWordWrapForTesting();
    getGlobal.mockReset().mockReturnValue(new Promise(() => {}));
    patchGlobal.mockReset().mockResolvedValue({});
    clients['ws-a'] = makeClient();
    clients['ws-b'] = makeClient();
});

describe('WorkingTreeFileDiff — diff engine', () => {
    it('renders untracked text as a full all-added comparison in the shared review', async () => {
        clients['ws-a'].git.getWorkingTreeFileContent.mockResolvedValue(content('', 'new\ntext\n', {
            base: { content: '', ref: 'EMPTY', exists: false },
        }));
        await renderDiff({ stage: 'untracked', untrackedAsDiff: true });
        expect(fakes[0].models[0].original.text).toBe('');
        expect(fakes[0].models[0].modified.text).toBe('new\ntext\n');
        expect(clients['ws-a'].git.getWorkingTreeFileContent).toHaveBeenCalledWith('ws-a', '/repo/src/a.ts', 'untracked');
        expect(clients['ws-a'].git.getWorkingTreeFileDiff).not.toHaveBeenCalled();
        expect(screen.queryByTestId('toggle-comments-btn')).toBeNull();
        await act(async () => { fireEvent.click(screen.getByTestId('diff-engine-toggle')); });
        expect(screen.getByTestId('classic-viewer').textContent).toBe('@@ -0,0 +1,2 @@\n+new\n+text');
        expect(untrackedContentAsDiff('')).toBe('');
    });
    it('refreshes a stale untracked entry when its full content read returns 404', async () => {
        const onFileMissing = vi.fn();
        clients['ws-a'].git.getWorkingTreeFileContent.mockRejectedValue(Object.assign(new Error('missing'), { status: 404 }));
        await renderDiff({ stage: 'untracked', untrackedAsDiff: true, onFileMissing });
        expect(onFileMissing).toHaveBeenCalledOnce();
        expect(screen.getByTestId('working-tree-file-diff-missing')).toBeTruthy();
    });
    it.each([{ binary: true }, { tooLarge: true }])('retains untracked preview handling for %o', async flags => {
        clients['ws-a'].git.getWorkingTreeFileContent.mockResolvedValue(content('', '', flags));
        await renderDiff({ stage: 'untracked', untrackedAsDiff: true });
        expect(screen.getByTestId('preview-pane')).toBeTruthy();
        expect(screen.queryByTestId('working-tree-file-diff-editor')).toBeNull();
    });
    it('rejects delayed full content superseded by a refresh during initial loading', async () => {
        let finishOld!: (value: Content) => void;
        clients['ws-a'].git.getWorkingTreeFileContent.mockReturnValueOnce(new Promise(resolve => { finishOld = resolve; }));
        const view = await renderDiff({ refreshKey: 0 });
        clients['ws-a'].git.getWorkingTreeFileContent.mockResolvedValue(content('a\n', 'fresh\n'));
        await act(async () => { view.rerender(<WorkingTreeFileDiff workspaceId="ws-a" filePath="/repo/src/a.ts" repoRoot="/repo" stage="unstaged" refreshKey={1} createDiffEditor={createDiffEditor} />); });
        expect(fakes.at(-1)!.modifiedText).toBe('fresh\n');
        await act(async () => { finishOld(content('a\n', 'stale\n')); });
        expect(fakes.at(-1)!.modifiedText).toBe('fresh\n');
    });
    it('shows a retryable error if refresh supersedes an initial content read and then fails', async () => {
        clients['ws-a'].git.getWorkingTreeFileContent.mockReturnValueOnce(new Promise(() => {}));
        const view = await renderDiff({ refreshKey: 0 });
        clients['ws-a'].git.getWorkingTreeFileContent.mockRejectedValue(new Error('content unavailable'));
        clients['ws-a'].git.getWorkingTreeFileDiff.mockRejectedValue(new Error('patch unavailable'));
        await act(async () => { view.rerender(<WorkingTreeFileDiff workspaceId="ws-a" filePath="/repo/src/a.ts" repoRoot="/repo" stage="unstaged" refreshKey={1} createDiffEditor={createDiffEditor} />); });
        expect(screen.getByTestId('working-tree-file-diff-error').textContent).toContain('patch unavailable');
        expect(screen.getByTestId('working-tree-file-diff-retry-btn')).toBeTruthy();
    });
    it('rejects a delayed patch superseded by refresh while the first patch is loading', async () => {
        localStorage.setItem(DIFF_ENGINE_STORAGE_KEY, 'legacy');
        let finishOld!: (value: any) => void;
        clients['ws-a'].git.getWorkingTreeFileDiff.mockReturnValueOnce(new Promise(resolve => { finishOld = resolve; }));
        const view = await renderDiff({ refreshKey: 0 });
        await act(async () => { view.rerender(<WorkingTreeFileDiff workspaceId="ws-a" filePath="/repo/src/a.ts" repoRoot="/repo" stage="unstaged" refreshKey={1} />); });
        expect(screen.getByTestId('classic-viewer').textContent).toContain('+b');
        await act(async () => { finishOld({ diff: 'stale patch' }); });
        expect(screen.getByTestId('classic-viewer').textContent).not.toContain('stale patch');
    });
    it.each(['staged', 'unstaged'] as const)('toggles word wrap in a mounted %s editor', async stage => {
        await renderDiff({ stage });
        const toggle = screen.getByRole('button', { name: 'Word wrap' });
        await act(async () => { fireEvent.click(toggle); });
        expect(fakes).toHaveLength(1);
        expect(fakes[0].options.at(-1)).toMatchObject({ wordWrap: 'on', diffWordWrap: 'on' });
        expect(patchGlobal).toHaveBeenCalledWith({ diffWordWrap: true });
        await act(async () => { fireEvent.click(screen.getByTestId('diff-engine-toggle')); });
        expect(screen.queryByRole('button', { name: 'Word wrap' })).toBeNull();
        await act(async () => { fireEvent.click(screen.getByTestId('diff-engine-toggle')); });
        expect(fakes.at(-1)?.options.at(-1)).toMatchObject({ wordWrap: 'on', diffWordWrap: 'on' });
    });
    it('renders the editor by default with no cached or server choice', async () => {
        await renderDiff();
        expect(screen.getByTestId('diff-engine-toggle').getAttribute('data-value')).toBe('monaco');
        expect(clients['ws-a'].git.getWorkingTreeFileContent).toHaveBeenCalledWith('ws-a', '/repo/src/a.ts', 'unstaged');
        expect(screen.getByTestId('working-tree-file-diff-editor')).toBeTruthy();
        expect(screen.queryByTestId('classic-viewer')).toBeNull();
    });

    it('renders the classic viewer for the Classic choice and does not load full sides', async () => {
        localStorage.setItem(DIFF_ENGINE_STORAGE_KEY, 'legacy');
        await renderDiff();
        expect(screen.getByTestId('classic-viewer')).toBeTruthy();
        expect(screen.queryByTestId('working-tree-file-diff-editor')).toBeNull();
        expect(clients['ws-a'].git.getWorkingTreeFileContent).not.toHaveBeenCalled();
        expect(screen.getByTestId('diff-engine-toggle').getAttribute('data-value')).toBe('legacy');
    });

    it('uses the cached Editor engine on first paint and feeds both server sides to Monaco', async () => {
        localStorage.setItem(DIFF_ENGINE_STORAGE_KEY, 'monaco');
        await renderDiff();
        expect(screen.getByTestId('diff-engine-toggle').getAttribute('data-value')).toBe('monaco');
        expect(clients['ws-a'].git.getWorkingTreeFileContent).toHaveBeenCalledWith('ws-a', '/repo/src/a.ts', 'unstaged');
        expect(screen.getByTestId('working-tree-file-diff-editor')).toBeTruthy();
        expect(screen.queryByTestId('classic-viewer')).toBeNull();
        expect(fakes).toHaveLength(1);
        const models = fakes[0].models[0];
        expect(models.original.text).toBe('a\n');
        expect(models.modified.text).toBe('b\n');
        // Unstaged working copy uses the real repo-relative document URI.
        expect(models.modified.uri).toContain('src/a.ts');
        expect(models.original.uri).toMatch(/^coc-diff-ref:/);
    });

    it('routes the content request to the selected workspace client', async () => {
        localStorage.setItem(DIFF_ENGINE_STORAGE_KEY, 'monaco');
        // Disk differs from the index, so the staged index side stays ref-backed.
        clients['ws-b'].git.getWorkingTreeFileContent.mockImplementation(async (_ws: string, _p: string, stage: string) =>
            stage === 'staged' ? content('a\n', 'b\n') : content('b\n', 'c\n'));
        await renderDiff({ workspaceId: 'ws-b', stage: 'staged' });
        expect(clients['ws-b'].git.getWorkingTreeFileContent).toHaveBeenCalledWith('ws-b', '/repo/src/a.ts', 'staged');
        expect(clients['ws-b'].git.getWorkingTreeFileContent).toHaveBeenCalledWith('ws-b', '/repo/src/a.ts', 'unstaged');
        expect(clients['ws-a'].git.getWorkingTreeFileContent).not.toHaveBeenCalled();
        const models = fakes[0].models[0];
        expect(models.original.uri).toMatch(/^coc-diff-ref:/);
        expect(models.modified.uri).toMatch(/^coc-diff-ref:/);
    });

    it('switches engine in place from the toolbar and persists the choice', async () => {
        localStorage.setItem(DIFF_ENGINE_STORAGE_KEY, 'legacy');
        await renderDiff();
        await act(async () => { fireEvent.click(screen.getByTestId('diff-engine-toggle')); });
        await act(async () => {});
        expect(patchGlobal).toHaveBeenCalledWith({ diffEngine: 'monaco' });
        expect(localStorage.getItem(DIFF_ENGINE_STORAGE_KEY)).toBe('monaco');
        expect(screen.getByTestId('working-tree-file-diff-editor')).toBeTruthy();

        await act(async () => { fireEvent.click(screen.getByTestId('diff-engine-toggle')); });
        expect(screen.getByTestId('classic-viewer')).toBeTruthy();
        expect(screen.queryByTestId('working-tree-file-diff-editor')).toBeNull();
        expect(fakes[0].disposals).toBe(1);
    });

    it('keeps the classic viewer for binary or oversized content and failed loads', async () => {
        localStorage.setItem(DIFF_ENGINE_STORAGE_KEY, 'monaco');
        clients['ws-a'].git.getWorkingTreeFileContent.mockResolvedValueOnce(content('', '', { binary: true }));
        const first = await renderDiff();
        expect(screen.getByTestId('classic-viewer')).toBeTruthy();
        first.unmount();

        clients['ws-a'].git.getWorkingTreeFileContent.mockResolvedValueOnce(content('', '', { tooLarge: true }));
        const second = await renderDiff();
        expect(screen.getByTestId('classic-viewer')).toBeTruthy();
        second.unmount();

        clients['ws-a'].git.getWorkingTreeFileContent.mockRejectedValueOnce(new Error('boom'));
        await renderDiff();
        expect(screen.getByTestId('classic-viewer')).toBeTruthy();
        expect(fakes).toHaveLength(0);
    });

    it('does not offer the engine control for untracked files', async () => {
        localStorage.setItem(DIFF_ENGINE_STORAGE_KEY, 'monaco');
        await renderDiff({ stage: 'untracked' });
        expect(screen.getByTestId('preview-pane')).toBeTruthy();
        expect(screen.queryByTestId('diff-engine-toggle')).toBeNull();
        expect(clients['ws-a'].git.getWorkingTreeFileContent).not.toHaveBeenCalled();
    });

    it('drives hunk navigation through the Monaco viewer when the editor is active', async () => {
        localStorage.setItem(DIFF_ENGINE_STORAGE_KEY, 'monaco');
        await renderDiff();
        await act(async () => {
            fakes[0].finishDiff([{ originalStartLineNumber: 1, originalEndLineNumber: 1, modifiedStartLineNumber: 1, modifiedEndLineNumber: 1 }]);
        });
        fireEvent.click(screen.getByTestId('hunk-next'));
        expect(fakes[0].adapter.revealModifiedLine).toHaveBeenCalled();
    });
});

describe('working-tree content search Monaco navigation', () => {
    const match = (side: 'old' | 'new', line = 7) => ({
        filePath: '/repo/src/a.ts', side, line, startColumn: 3, endColumn: 9, text: '😀needle',
    });
    it.each(['staged', 'unstaged', 'untracked'] as const)('reveals the exact new side in %s without initial-hunk navigation', async stage => {
        const target = match('new');
        await renderDiff({ stage, untrackedAsDiff: true, contentSearchTarget: target, initialHunkTarget: 'last' });
        expect(fakes[0].revealedPositions).toEqual([{ side: 'modified', line: 7, column: 3 }]);
        expect(fakes[0].adapter.revealModifiedLine).not.toHaveBeenCalled();
    });
    it('switches inline to split before revealing old, and repeats only for fresh activations', async () => {
        const target = match('old');
        const view = await renderDiff({ contentSearchTarget: target });
        expect(fakes[0].options.at(-1)).toMatchObject({ renderSideBySide: true });
        expect(fakes[0].revealedPositions).toEqual([{ side: 'original', line: 7, column: 3 }]);
        const props = { workspaceId: 'ws-a', filePath: '/repo/src/a.ts', repoRoot: '/repo', stage: 'unstaged' as const, createDiffEditor };
        await act(async () => { view.rerender(<WorkingTreeFileDiff {...props} contentSearchTarget={target} />); });
        expect(fakes[0].revealedPositions).toHaveLength(1);
        await act(async () => { view.rerender(<WorkingTreeFileDiff {...props} contentSearchTarget={{ ...target }} />); });
        expect(fakes[0].revealedPositions).toHaveLength(2);
    });
    it('waits for full content and ignores a target for another path', async () => {
        let finish!: (value: Content) => void;
        clients['ws-a'].git.getWorkingTreeFileContent.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
        const view = await renderDiff({ contentSearchTarget: match('old') });
        expect(fakes).toHaveLength(0);
        await act(async () => { finish(content('needle', 'needle')); });
        expect(fakes[0].revealedPositions).toEqual([{ side: 'original', line: 7, column: 3 }]);
        await act(async () => {
            view.rerender(<WorkingTreeFileDiff workspaceId="ws-a" filePath="/repo/src/a.ts" stage="unstaged"
                createDiffEditor={createDiffEditor} contentSearchTarget={{ ...match('new'), filePath: '/repo/other.ts' }} />);
        });
        expect(fakes[0].revealedPositions).toHaveLength(1);
    });
    it('lets later definition navigation supersede a search target', async () => {
        await renderDiff({ contentSearchTarget: match('old') });
        act(() => { currentCodeMounts[0].onNavigate({ workspaceId: 'ws-a', path: 'src/a.ts', line: 2, column: 5 }); });
        expect(fakes[0].revealedPositions.at(-1)).toEqual({ side: 'original', line: 2, column: 5 });
    });
});

it.each(['ws-a', 'remote:one:ws-a', 'remote:two:ws-a'])('forwards working-tree selection destination %s with raw workspace identity', async destinationId => {
    const view = await renderDiff({ attachmentDestinationId: destinationId });
    expect(selectionPill).toHaveBeenLastCalledWith(expect.objectContaining({ workspaceId: 'ws-a', filePath: 'src/a.ts', destinationId, ref: { type: 'working-tree' } }));
    view.rerender(<WorkingTreeFileDiff workspaceId="ws-a" attachmentDestinationId="remote:next:ws-a"
        filePath="/repo/src/a.ts" stage="unstaged" repoRoot="/repo" createDiffEditor={createDiffEditor} />);
    expect(selectionPill).toHaveBeenLastCalledWith(expect.objectContaining({ workspaceId: 'ws-a', destinationId: 'remote:next:ws-a' }));
});

describe('WorkingTreeFileDiff — historical definitions', () => {
    it('serves the left (index) side of an unstaged diff, never the disk document', async () => {
        localStorage.setItem(DIFF_ENGINE_STORAGE_KEY, 'monaco');
        await renderDiff({ stage: 'unstaged' });
        expect(fakes).toHaveLength(1);
        expect(fakes[0].historicalMounts.filter(m => m.live).map(m => m.side)).toEqual(['original']);
    });

    it('serves the HEAD side of a staged diff', async () => {
        localStorage.setItem(DIFF_ENGINE_STORAGE_KEY, 'monaco');
        await renderDiff({ stage: 'staged' });
        expect(fakes).toHaveLength(1);
        const sides = fakes[0].historicalMounts.filter(m => m.live).map(m => m.side);
        expect(sides[0]).toBe('original');
        expect(fakes[0].historicalMounts.every(m => m.uri.startsWith('coc-diff-ref://'))).toBe(true);
    });
});

describe('WorkingTreeFileDiff — definition routing', () => {
    const target = (path: string, extra: Partial<NavigateTarget> = {}): NavigateTarget => ({ workspaceId: 'ws-a', path, line: 7, column: 2, ...extra });
    async function renderHosted(props: Partial<React.ComponentProps<typeof WorkingTreeFileDiff>> = {}) {
        localStorage.setItem(DIFF_ENGINE_STORAGE_KEY, 'monaco');
        await act(async () => {
            render(
                <UnifiedPanelHostProvider host={{ workspaceId: 'group-1', chatId: 'chat-1', routingRef: null }}>
                    <WorkingTreeFileDiff workspaceId="ws-a" filePath="/repo/src/a.ts" repoRoot="/repo" stage="unstaged"
                        createDiffEditor={createDiffEditor} {...props} />
                </UnifiedPanelHostProvider>,
            );
        });
        await act(async () => {});
        expect(currentCodeMounts).toHaveLength(1);
        return currentCodeMounts[0];
    }

    it('reveals a same-file target on the left side the jump started from', async () => {
        const mount = await renderHosted();
        let handled: boolean | undefined;
        act(() => { handled = mount.onNavigate(target('src/a.ts')); });
        expect(handled).toBe(true);
        expect(fakes[0].revealedPositions).toEqual([{ side: 'original', line: 7, column: 2 }]);
        expect(openUnifiedPanelTab).not.toHaveBeenCalled();
    });

    it.each(['original', 'modified'] as const)('restores %s cursor and exact scroll through the chip and Alt+←', async side => {
        localStorage.setItem(DIFF_ENGINE_STORAGE_KEY, 'monaco');
        clients['ws-a'].git.getWorkingTreeFileContent.mockResolvedValueOnce(content('a\n', 'b\n', {
            base: { content: 'a\n', ref: 'HEAD', exists: true },
            head: { content: 'b\n', ref: 'INDEX', exists: true },
        })).mockResolvedValueOnce(content('b\n', 'disk differs\n'));
        await renderDiff({ stage: 'staged' });
        const mount = currentCodeMounts[side === 'original' ? 0 : 1];
        expect(mount).toBeDefined();
        const origin = { line: 3, column: 4, scrollTop: 183.5 };
        fakes[0].viewPositions[side] = origin;
        act(() => { mount.onNavigate(target('src/a.ts')); });
        expect(screen.getByTestId('diff-definition-back-chip').textContent).toContain('Back to Staged · a.ts');
        fakes[0].viewPositions[side] = { line: 7, column: 2, scrollTop: 500 };
        act(() => { mount.onNavigate(target('src/a.ts', { line: 12 })); });
        fireEvent.keyDown(screen.getByTestId('working-tree-file-diff'), { key: 'ArrowLeft', altKey: true });
        expect(fakes[0].revealedPositions.at(-1)).toEqual({ side, line: 7, column: 2, scrollTop: 500 });
        fireEvent.click(screen.getByTestId('diff-definition-back-chip'));
        expect(fakes[0].revealedPositions.at(-1)).toEqual({ side, ...origin });
        expect(screen.queryByTestId('diff-definition-back-chip')).toBeNull();
        const count = fakes[0].revealedPositions.length;
        fireEvent.keyDown(screen.getByTestId('working-tree-file-diff'), { key: 'ArrowLeft', altKey: true });
        expect(fakes[0].revealedPositions).toHaveLength(count);
    });

    it('clears return history and pending reveal when the selected file changes', async () => {
        localStorage.setItem(DIFF_ENGINE_STORAGE_KEY, 'monaco');
        const view = await renderDiff();
        fakes[0].viewPositions.original = { line: 2, column: 1, scrollTop: 70 };
        act(() => { currentCodeMounts[0].onNavigate(target('src/a.ts')); });
        expect(screen.getByTestId('diff-definition-back-chip')).toBeTruthy();
        await act(async () => {
            view.rerender(<WorkingTreeFileDiff workspaceId="ws-a" filePath="/repo/src/b.ts" repoRoot="/repo"
                stage="unstaged" createDiffEditor={createDiffEditor} />);
        });
        expect(screen.queryByTestId('diff-definition-back-chip')).toBeNull();
        expect(fakes.flatMap(fake => fake.revealedPositions)).toEqual([{ side: 'original', line: 7, column: 2 }]);
    });

    it('opens another file, even a changed one, in Explorer at the definition line', async () => {
        const onNavigateToFile = vi.fn();
        const mount = await renderHosted({ attachmentDestinationId: 'remote:srv:ws-a', onNavigateToFile, workingTreeFiles: ['/repo/src/a.ts', '/repo/src/b.ts'] });
        let handled: boolean | undefined;
        act(() => { handled = mount.onNavigate(target('src/b.ts', { symbolCandidate: true })); });
        expect(handled).toBe(true);
        expect(onNavigateToFile).not.toHaveBeenCalled();
        expect(openUnifiedPanelTab).toHaveBeenCalledWith('group-1', expect.objectContaining({
            kind: 'file', ownerWorkspaceId: 'ws-a', ownerRoutingRef: 'remote:srv:ws-a', chatId: 'chat-1',
            resourceId: 'src/b.ts', line: 7, column: 2, symbolCandidate: true,
        }));
        expect(fakes[0].revealedPositions).toEqual([]);
        expect(screen.queryByTestId('diff-definition-back-chip')).toBeNull();
    });

    it('an Explorer jump leaves a way back to the exact side and scroll spot', async () => {
        resetDiffDefinitionReturns();
        const mount = await renderHosted();
        fakes[0].viewPositions.original = { line: 5, column: 3, scrollTop: 90 };
        act(() => { mount.onNavigate(target('lib/util.ts')); });
        expect(getDiffDefinitionReturn('group-1', 'tab-id')).toMatchObject({ label: 'Unstaged · a.ts', chatId: 'chat-1' });
        let returned = false;
        act(() => { returned = returnToDiffDefinitionOrigin('group-1', 'tab-id'); });
        expect(returned).toBe(true);
        expect(fakes[0].revealedPositions.at(-1)).toEqual({ side: 'original', line: 5, column: 3, scrollTop: 90 });
        expect(getDiffDefinitionReturn('group-1', 'tab-id')).toBeNull();
    });

    it('declines a target in another workspace', async () => {
        const mount = await renderHosted();
        let handled: boolean | undefined;
        act(() => { handled = mount.onNavigate(target('src/a.ts', { workspaceId: 'ws-b' })); });
        expect(handled).toBe(false);
        expect(fakes[0].revealedPositions).toEqual([]);
        expect(openUnifiedPanelTab).not.toHaveBeenCalled();
    });
});
