import '../language-servers/fileIdentityMock';
/**
 * Right-panel file history (`features.fileHistory`): the toolbar's History
 * toggle replaces the file view with the owner's newest-first commit list for
 * that file, a commit opens that file's diff in place, and the file view stays
 * mounted underneath the whole time so its unsaved buffer survives.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const listFileHistory = vi.hoisted(() => vi.fn());
const getCocClientForWorkspace = vi.hoisted(() => vi.fn());

vi.mock('../../../../src/server/spa/client/react/features/terminal/TerminalView', () => ({
    TerminalView: () => <div data-testid="mock-terminal" />,
}));
const TREE_FILES = [
    { key: 'app', path: 'src/app.ts', name: 'app.ts' },
    { key: 'trusted', path: '__trusted__:/etc/hosts', name: 'hosts' },
];
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/ExplorerPanel', async () => {
    const actual = await vi.importActual<typeof import('../../../../src/server/spa/client/react/features/repo-detail/explorer/ExplorerPanel')>(
        '../../../../src/server/spa/client/react/features/repo-detail/explorer/ExplorerPanel',
    );
    return {
        getAncestorPaths: actual.getAncestorPaths,
        ExplorerPanel: ({ onOpenFile }: {
            onOpenFile?: (file: { path: string; name: string }, options: { preview: boolean }) => void;
        }) => (
            <div data-testid="mock-explorer">
                {TREE_FILES.map(file => (
                    <button
                        key={file.key}
                        type="button"
                        data-testid={`mock-explorer-open-${file.key}`}
                        onClick={() => onOpenFile?.({ path: file.path, name: file.name }, { preview: true })}
                    >
                        {file.name}
                    </button>
                ))}
            </div>
        ),
    };
});
vi.mock('../../../../src/server/spa/client/react/features/notes/NotesView', () => ({
    NotesView: () => <div data-testid="mock-notes" />,
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi', () => ({
    explorerApi: {
        tree: async () => ({ entries: [], truncated: false }),
        searchFiles: async () => ({ results: [] as { path: string }[] }),
        readBlob: async () => ({ content: 'draft base', encoding: 'utf-8', mimeType: 'text/plain' }),
        writeBlob: async () => ({ success: true }),
        readTrustedBlob: async () => ({ content: '', encoding: 'utf-8', mimeType: 'text/plain' }),
    },
}));
vi.mock('../../../../src/server/spa/client/react/shared/file-viewer/MonacoFileEditor', () => ({
    MonacoFileEditor: () => <div data-testid="mock-monaco" />,
    getMonacoLanguage: () => 'plaintext',
}));
vi.mock('../../../../src/server/spa/client/react/repos/cloneRegistry', () => ({
    getCocClientForWorkspace,
    lookupCloneBaseUrl: () => null,
    resolveCloneRoute: () => ({ kind: 'local' }),
}));
vi.mock('../../../../src/server/spa/client/react/features/language-servers/languageServerClient',
    async () => await import('../language-servers/inertTransportMock'));
// The Git tab's diff viewer has its own suites; here it only has to show which
// file and patch URL the history handed it.
vi.mock('../../../../src/server/spa/client/react/features/git/diff/FileDiffPanel', () => ({
    FileDiffPanel: ({ workspaceId, filePath, source, onBack }: {
        workspaceId: string;
        filePath: string;
        source: { fileDiffUrl(path: string): string; routingTarget?: string | null };
        onBack?: () => void;
    }) => (
        <div data-testid="mock-file-diff">
            <span data-testid="mock-file-diff-path">{workspaceId}:{filePath}</span>
            <span data-testid="mock-file-diff-url">{source.fileDiffUrl(filePath)}</span>
            <button type="button" data-testid="mock-file-diff-back" onClick={onBack}>back</button>
        </div>
    ),
}));

import { UnifiedRightPanel } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedRightPanel';
import { UnifiedFileHistory } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedFileHistory';
import { clearUnifiedPanelState } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelStore';
import { clearUnifiedTreeState, writeUnifiedTreeState } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTree';
import { applyRuntimeConfigPatch } from '../../../../src/server/spa/client/react/utils/config';
import type { WorkspaceDockController } from '../../../../src/server/spa/client/react/features/repo-detail/useWorkspaceDock';

const WS = 'ws-1';

function commit(n: number, extra: Record<string, unknown> = {}) {
    const hash = `${n}`.padStart(7, 'a').padEnd(40, '0');
    return {
        hash, shortHash: hash.slice(0, 7), subject: `Subject ${n}`, author: `Author ${n}`,
        authorEmail: `a${n}@example.invalid`, date: '2026-01-01T00:00:00Z', path: 'src/app.ts', status: 'M', ...extra,
    };
}

function dockStub(): WorkspaceDockController {
    return {
        isOpen: true, toggleOpen: vi.fn(), mode: 'explorer', selectMode: vi.fn(), target: WS, setTarget: vi.fn(),
        targets: [], width: 900, maxWidth: 1200, isDragging: false, handleMouseDown: vi.fn(), handleTouchStart: vi.fn(),
    };
}

async function openFile(key: string) {
    writeUnifiedTreeState(WS, { open: true, width: 220 });
    render(<UnifiedRightPanel workspaceId={WS} dock={dockStub()} />);
    await act(async () => { fireEvent.click(screen.getByTestId(`mock-explorer-open-${key}`)); });
}

function activeFileView(): HTMLElement {
    const view = document.querySelector<HTMLElement>('[data-testid^="unified-panel-view-"][data-active="true"]');
    if (!view) throw new Error('no active view');
    return view;
}

beforeEach(() => {
    localStorage.clear();
    clearUnifiedPanelState();
    clearUnifiedTreeState();
    listFileHistory.mockReset();
    getCocClientForWorkspace.mockReset();
    getCocClientForWorkspace.mockReturnValue({
        git: {
            listFileHistory,
            commitFileDiffPath: (ws: string, hash: string, filePath: string) =>
                `/workspaces/${encodeURIComponent(ws)}/git/commits/${hash}/files/${encodeURIComponent(filePath)}/diff`,
        },
        canvases: { list: async () => [], create: async () => ({ id: 'c1', title: 'c' }) },
    });
    applyRuntimeConfigPatch({ fileHistoryEnabled: true });
});
afterEach(() => {
    cleanup();
    clearUnifiedPanelState();
    clearUnifiedTreeState();
    applyRuntimeConfigPatch({ fileHistoryEnabled: false });
});

describe('file history in the right panel', () => {
    it('offers no History control while the feature is off', async () => {
        applyRuntimeConfigPatch({ fileHistoryEnabled: false });
        await openFile('app');
        expect(screen.getByTestId('unified-panel-toolbar')).toBeTruthy();
        expect(screen.queryByTestId('file-history-toggle')).toBeNull();
    });

    it('offers no History control for a trusted path outside the repository', async () => {
        await openFile('trusted');
        expect(screen.getByTestId('unified-panel-toolbar')).toBeTruthy();
        expect(screen.queryByTestId('file-history-toggle')).toBeNull();
    });

    it('replaces the file view with the owner commit list and keeps the file view mounted underneath', async () => {
        listFileHistory.mockResolvedValue({ commits: [commit(1), commit(2)], hasMore: false });
        await openFile('app');
        const view = activeFileView();
        const editor = await waitFor(() => screen.getByTestId('mock-monaco'));

        await act(async () => { fireEvent.click(screen.getByTestId('file-history-toggle')); });

        expect(listFileHistory).toHaveBeenCalledWith(WS, 'src/app.ts', { limit: 50, skip: 0 });
        expect(getCocClientForWorkspace).toHaveBeenCalledWith(WS);
        await screen.findByTestId(`file-history-row-${commit(1).shortHash}`);
        const rows = screen.getAllByTestId(/^file-history-row-/);
        expect(rows.map(row => row.textContent)).toEqual([
            expect.stringContaining('Subject 1'), expect.stringContaining('Subject 2'),
        ]);
        expect(rows[0].textContent).toContain(commit(1).shortHash);
        expect(rows[0].textContent).toContain('Author 1');
        expect(screen.getByTestId('file-history-toggle').getAttribute('aria-pressed')).toBe('true');
        expect(screen.queryByTestId('file-reload-from-disk')).toBeNull();
        // The buffer is hidden, not unmounted, so unsaved edits survive.
        expect(view.style.display).toBe('none');
        expect(view.isConnected).toBe(true);
        expect(editor.isConnected).toBe(true);

        await act(async () => { fireEvent.click(screen.getByTestId('file-history-back')); });
        expect(screen.queryByTestId('file-history')).toBeNull();
        expect(activeFileView()).toBe(view);
        expect(view.style.display).toBe('');
        expect(screen.getByTestId('mock-monaco')).toBe(editor);
    });

    it('shows a renamed revision diff in place with its old path, and returns to the list', async () => {
        listFileHistory.mockResolvedValue({
            commits: [commit(1), commit(2, { path: 'src/app.ts', oldPath: 'lib/old app.ts', status: 'R' }), commit(3, { path: 'lib/old app.ts', status: 'A' })],
            hasMore: false,
        });
        await openFile('app');
        await act(async () => { fireEvent.click(screen.getByTestId('file-history-toggle')); });
        await act(async () => { fireEvent.click(await screen.findByTestId(`file-history-row-${commit(2).shortHash}`)); });

        expect(screen.getByTestId('mock-file-diff-path').textContent).toBe(`${WS}:src/app.ts`);
        expect(screen.getByTestId('mock-file-diff-url').textContent).toContain(`/commits/${commit(2).hash}/files/src%2Fapp.ts/diff?oldPath=lib%2Fold%20app.ts`);
        expect(screen.getByTestId('file-history-diff-header').textContent).toContain('renamed from lib/old app.ts');

        await act(async () => { fireEvent.click(screen.getByTestId('mock-file-diff-back')); });
        await act(async () => { fireEvent.click(screen.getByTestId(`file-history-row-${commit(3).shortHash}`)); });
        // The root revision diffs the file under the name it had then.
        expect(screen.getByTestId('mock-file-diff-path').textContent).toBe(`${WS}:lib/old app.ts`);
        expect(screen.getByTestId('mock-file-diff-url').textContent).not.toContain('oldPath');
        expect(listFileHistory).toHaveBeenCalledTimes(1);
    });
});

describe('UnifiedFileHistory', () => {
    it('routes through the concrete owner route and pages with Load more', async () => {
        listFileHistory
            .mockResolvedValueOnce({ commits: [commit(1)], hasMore: true })
            .mockResolvedValueOnce({ commits: [commit(2)], hasMore: false });
        render(<UnifiedFileHistory workspaceId={WS} routingRef="remote:host:ws-1" filePath="src/app.ts" onClose={vi.fn()} />);

        await screen.findByTestId(`file-history-row-${commit(1).shortHash}`);
        expect(getCocClientForWorkspace).toHaveBeenCalledWith('remote:host:ws-1');
        expect(listFileHistory).toHaveBeenLastCalledWith(WS, 'src/app.ts', { limit: 50, skip: 0 });

        await act(async () => { fireEvent.click(screen.getByTestId('file-history-more')); });
        expect(listFileHistory).toHaveBeenLastCalledWith(WS, 'src/app.ts', { limit: 50, skip: 1 });
        await screen.findByTestId(`file-history-row-${commit(2).shortHash}`);
        expect(screen.getAllByTestId(/^file-history-row-/)).toHaveLength(2);
        expect(screen.queryByTestId('file-history-more')).toBeNull();
    });

    it('shows loading, then the empty state', async () => {
        let resolve!: (value: unknown) => void;
        listFileHistory.mockReturnValue(new Promise(r => { resolve = r; }));
        render(<UnifiedFileHistory workspaceId={WS} filePath="new.ts" onClose={vi.fn()} />);
        expect(screen.getByTestId('file-history-loading')).toBeTruthy();
        await act(async () => { resolve({ commits: [], hasMore: false }); });
        expect(screen.getByTestId('file-history-empty')).toBeTruthy();
    });

    it('shows a failure with Retry', async () => {
        listFileHistory
            .mockRejectedValueOnce(new Error('git exploded'))
            .mockResolvedValueOnce({ commits: [commit(1)], hasMore: false });
        render(<UnifiedFileHistory workspaceId={WS} filePath="src/app.ts" onClose={vi.fn()} />);
        expect((await screen.findByTestId('file-history-error')).textContent).toContain('git exploded');

        await act(async () => { fireEvent.click(screen.getByText('Retry')); });
        await screen.findByTestId(`file-history-row-${commit(1).shortHash}`);
        expect(screen.queryByTestId('file-history-error')).toBeNull();
    });

    it('drops an answer for a file it no longer shows', async () => {
        let resolveOld!: (value: unknown) => void;
        listFileHistory
            .mockReturnValueOnce(new Promise(r => { resolveOld = r; }))
            .mockResolvedValueOnce({ commits: [commit(2)], hasMore: false });
        const { rerender } = render(<UnifiedFileHistory workspaceId={WS} filePath="a.ts" onClose={vi.fn()} />);
        rerender(<UnifiedFileHistory workspaceId={WS} filePath="b.ts" onClose={vi.fn()} />);
        await screen.findByTestId(`file-history-row-${commit(2).shortHash}`);
        await act(async () => { resolveOld({ commits: [commit(1)], hasMore: false }); });
        expect(screen.queryByTestId(`file-history-row-${commit(1).shortHash}`)).toBeNull();
    });
});
