import '../language-servers/fileIdentityMock';
/**
 * Right-panel Git blame (`features.fileBlame`): the toolbar's Blame toggle sits
 * beside History, starts off for every file view and is never persisted. While
 * on, the file view reads `HEAD` blame from the tab's own owner and paints it
 * into its editor; clicking an attributed line opens that commit in the
 * owner-routed Git detail. Binary, outside-repo and rendered Markdown views
 * offer no toggle.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const getFileBlame = vi.hoisted(() => vi.fn());
const getCocClientForWorkspace = vi.hoisted(() => vi.fn());
const attachFileBlameDecorations = vi.hoisted(() => vi.fn());
const dispatch = vi.hoisted(() => vi.fn());

vi.mock('../../../../src/server/spa/client/react/features/terminal/TerminalView', () => ({
    TerminalView: () => <div data-testid="mock-terminal" />,
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/ExplorerPanel', () => ({
    ExplorerPanel: () => <div data-testid="mock-explorer" />,
    getAncestorPaths: () => [],
}));
vi.mock('../../../../src/server/spa/client/react/features/notes/NotesView', () => ({
    NotesView: () => <div data-testid="mock-notes" />,
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi', () => ({
    explorerApi: {
        tree: async () => ({ entries: [], truncated: false }),
        searchFiles: async () => ({ results: [] as { path: string }[] }),
        readBlob: async (_ws: string, path: string) => (path.endsWith('.bin')
            ? { content: 'AAEC', encoding: 'base64', mimeType: 'application/octet-stream' }
            : { content: path.endsWith('.md') ? '# Title\n' : 'one\ntwo\n', encoding: 'utf-8', mimeType: 'text/plain' }),
        writeBlob: async () => ({ success: true }),
        readTrustedBlob: async () => ({ content: 'x', encoding: 'utf-8', mimeType: 'text/plain' }),
    },
}));
// The editor mounts a model like Monaco would, so the pane can attach blame.
vi.mock('../../../../src/server/spa/client/react/shared/file-viewer/MonacoFileEditor', async () => {
    const { useEffect } = await import('react');
    return {
        MonacoFileEditor: ({ onModelMount }: { onModelMount?: (context: unknown) => (() => void) | void }) => {
            useEffect(() => onModelMount?.({ editor: { id: 'editor', updateOptions: () => undefined }, monaco: {}, model: {} }) ?? undefined, [onModelMount]);
            return <div data-testid="mock-monaco" />;
        },
        getMonacoLanguage: () => 'plaintext',
    };
});
const attachment = vi.hoisted(() => ({ mountModel: () => undefined, identityFailure: null }));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/usePreviewModelAttachment', () => ({
    usePreviewModelAttachment: () => attachment,
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/fileBlameDecorations', () => ({
    attachFileBlameDecorations,
}));
vi.mock('../../../../src/server/spa/client/react/repos/cloneRegistry', () => ({
    getCocClientForWorkspace,
    lookupCloneBaseUrl: () => null,
    resolveCloneRoute: (ref: string) => (ref.startsWith('remote:')
        ? { kind: 'remote', baseUrl: 'http://127.0.0.1:7201' } : { kind: 'local' }),
}));
vi.mock('../../../../src/server/spa/client/react/features/language-servers/languageServerClient',
    async () => await import('../language-servers/inertTransportMock'));

import { UnifiedRightPanel } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedRightPanel';
import { clearUnifiedPanelState, readUnifiedPanelState, writeUnifiedPanelState } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelStore';
import { EMPTY_UNIFIED_PANEL, openTab } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';
import { applyRuntimeConfigPatch } from '../../../../src/server/spa/client/react/utils/config';
import type { WorkspaceDockController } from '../../../../src/server/spa/client/react/features/repo-detail/useWorkspaceDock';

const WS = 'ws-1';
const CHAT = 'chat-1';
const REMOTE = 'remote:srv:ws-1';
const HASH = 'a'.repeat(40);
const BLAME = {
    lines: [{ hash: HASH, text: 'one' }, { hash: HASH, text: 'two' }],
    commits: { [HASH]: { hash: HASH, shortHash: 'aaaaaaa', subject: 'Add', author: 'Ann', authorEmail: 'a@x', date: '2026-01-01T00:00:00Z', path: 'src/app.ts' } },
};

function dockStub(): WorkspaceDockController {
    return {
        isOpen: true, toggleOpen: vi.fn(), mode: 'explorer', selectMode: vi.fn(), target: WS, setTarget: vi.fn(),
        targets: [], width: 900, maxWidth: 1200, isDragging: false, handleMouseDown: vi.fn(), handleTouchStart: vi.fn(),
    };
}

async function showFile(resourceId: string, routingRef?: string) {
    writeUnifiedPanelState(WS, openTab(EMPTY_UNIFIED_PANEL, {
        kind: 'file', ownerWorkspaceId: WS, ...(routingRef ? { ownerRoutingRef: routingRef } : {}),
        chatId: CHAT, resourceId, label: resourceId.split('/').pop()!,
    }));
    const view = render(<UnifiedRightPanel workspaceId={WS} routingRef={routingRef} chatId={CHAT} dock={dockStub()} appDispatch={dispatch} />);
    await act(async () => { await Promise.resolve(); });
    return view;
}

/** The workspace's `coc://git` page tab, once a blame click opened it. */
const gitPageTab = () => readUnifiedPanelState(WS).workspaceTabs.find(tab => tab.resourceId === 'coc-git');

const toggle = () => screen.queryByRole('button', { name: 'Blame' });
const findToggle = () => screen.findByRole('button', { name: 'Blame' });

beforeEach(() => {
    localStorage.clear();
    clearUnifiedPanelState(WS);
    getFileBlame.mockReset();
    getFileBlame.mockResolvedValue(BLAME);
    attachFileBlameDecorations.mockReset();
    attachFileBlameDecorations.mockReturnValue(vi.fn());
    dispatch.mockReset();
    getCocClientForWorkspace.mockReset();
    getCocClientForWorkspace.mockReturnValue({
        git: { getFileBlame },
        canvases: { list: async () => [], create: async () => ({ id: 'c1', title: 'c' }) },
    });
    applyRuntimeConfigPatch({ fileBlameEnabled: true, fileHistoryEnabled: true, markdownPanelPreviewEnabled: true });
});
afterEach(() => {
    cleanup();
    clearUnifiedPanelState(WS);
    applyRuntimeConfigPatch({ fileBlameEnabled: false, fileHistoryEnabled: false });
});

describe('file blame in the right panel', () => {
    it('offers no Blame control while the feature is off', async () => {
        applyRuntimeConfigPatch({ fileBlameEnabled: false });
        await showFile('src/app.ts');
        await screen.findByTestId('mock-monaco');
        expect(toggle()).toBeNull();
        expect(getFileBlame).not.toHaveBeenCalled();
    });

    it('starts off beside History, reads the owner blame once toggled, and paints it into the editor', async () => {
        let resolve!: (value: typeof BLAME) => void;
        getFileBlame.mockReturnValueOnce(new Promise(r => { resolve = r; }));
        await showFile('src/app.ts');
        const button = await findToggle();
        expect(button.getAttribute('aria-pressed')).toBe('false');
        expect(button.previousElementSibling?.getAttribute('data-testid')).toBe('file-history-toggle');
        expect(getFileBlame).not.toHaveBeenCalled();

        fireEvent.click(button);
        expect(toggle()!.getAttribute('aria-pressed')).toBe('true');
        expect(screen.getByTestId('file-blame-loading').textContent).toContain('Loading blame');
        expect(getCocClientForWorkspace).toHaveBeenLastCalledWith(WS);
        expect(getFileBlame).toHaveBeenCalledWith(WS, 'src/app.ts');

        await act(async () => { resolve(BLAME); });
        expect(screen.queryByTestId('file-blame-loading')).toBeNull();
        expect(attachFileBlameDecorations).toHaveBeenCalledTimes(1);
        expect(attachFileBlameDecorations.mock.calls[0][0]).toMatchObject({ editor: { id: 'editor' } });
        expect(attachFileBlameDecorations.mock.calls[0][1]).toBe(BLAME);

        const detach = attachFileBlameDecorations.mock.results[0].value as ReturnType<typeof vi.fn>;
        fireEvent.click(toggle()!);
        expect(toggle()!.getAttribute('aria-pressed')).toBe('false');
        expect(detach).toHaveBeenCalled();
    });

    it('opens a clicked commit in the local owner Git detail', async () => {
        await showFile('src/app.ts');
        fireEvent.click(await findToggle());
        await waitFor(() => expect(attachFileBlameDecorations).toHaveBeenCalled());
        const onOpenCommit = attachFileBlameDecorations.mock.calls[0][2] as (hash: string) => void;
        act(() => onOpenCommit(HASH));
        expect(gitPageTab()).toEqual(expect.objectContaining({
            ownerWorkspaceId: WS, browserUrl: `coc://git/${HASH}`,
        }));
        expect(gitPageTab()?.ownerRoutingRef ?? null).toBeNull();
        expect(dispatch).not.toHaveBeenCalled();
    });

    it('reads and navigates through the remote clone owner, never the page origin', async () => {
        await showFile('src/app.ts', REMOTE);
        fireEvent.click(await findToggle());
        await waitFor(() => expect(attachFileBlameDecorations).toHaveBeenCalled());
        expect(getCocClientForWorkspace).toHaveBeenLastCalledWith(REMOTE);
        expect(getFileBlame).toHaveBeenCalledWith(WS, 'src/app.ts');
        const onOpenCommit = attachFileBlameDecorations.mock.calls[0][2] as (hash: string) => void;
        act(() => onOpenCommit(HASH));
        expect(gitPageTab()).toEqual(expect.objectContaining({
            ownerWorkspaceId: WS, ownerRoutingRef: REMOTE, browserUrl: `coc://git/${HASH}`,
        }));
    });

    it('shows a failure with Retry', async () => {
        getFileBlame.mockRejectedValueOnce(new Error('boom'));
        await showFile('src/app.ts');
        fireEvent.click(await findToggle());
        const alert = await screen.findByTestId('file-blame-error');
        expect(alert.getAttribute('role')).toBe('alert');
        expect(alert.textContent).toContain('boom');
        expect(attachFileBlameDecorations).not.toHaveBeenCalled();
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry' })); });
        expect(screen.queryByTestId('file-blame-error')).toBeNull();
        expect(attachFileBlameDecorations).toHaveBeenCalledTimes(1);
    });

    it('keeps the toggle in memory only: a fresh panel starts with blame off', async () => {
        const first = await showFile('src/app.ts');
        fireEvent.click(await findToggle());
        expect(toggle()!.getAttribute('aria-pressed')).toBe('true');
        first.unmount();
        getFileBlame.mockClear();
        render(<UnifiedRightPanel workspaceId={WS} chatId={CHAT} dock={dockStub()} appDispatch={dispatch} />);
        const button = await findToggle();
        expect(button.getAttribute('aria-pressed')).toBe('false');
        expect(getFileBlame).not.toHaveBeenCalled();
    });

    it('offers no Blame control for a binary file or a path outside the repository', async () => {
        const binary = await showFile('assets/blob.bin');
        await waitFor(() => expect(screen.queryByTestId('preview-loading')).toBeNull());
        expect(toggle()).toBeNull();
        binary.unmount();
        await showFile('__trusted__:/etc/hosts');
        await screen.findByTestId('mock-monaco');
        expect(toggle()).toBeNull();
        expect(getFileBlame).not.toHaveBeenCalled();
    });

    it('offers Blame for Markdown source but not its rendered view', async () => {
        await showFile('docs/readme.md');
        await waitFor(() => expect(screen.queryByTestId('preview-loading')).toBeNull());
        const rendered = screen.queryByTestId('preview-markdown');
        if (!rendered) fireEvent.click(screen.getByRole('button', { name: 'Rendered' }));
        await screen.findByTestId('preview-markdown');
        expect(toggle()).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Raw' }));
        await waitFor(() => expect(toggle()).not.toBeNull());
    });
});
