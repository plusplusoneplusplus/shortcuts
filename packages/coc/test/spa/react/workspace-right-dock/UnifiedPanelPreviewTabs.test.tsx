/**
 * Preview tabs in the unified panel (AC-03) — VS Code's italic, replaceable
 * slot, driven by the file tree's single click.
 *
 * `unifiedPanelTabsModel.test.ts` pins the rules (one preview per section,
 * reuse in place, dedupe against a permanent tab). What these cases pin is the
 * wiring a user actually touches: that the tree's single click reaches the
 * preview slot while every other entry point does not, that the strip renders
 * the slot as italics *and* says so in words, and that reusing the slot goes
 * through the same unsaved-edits prompt a close does.
 *
 * The tree is stubbed down to two buttons per file — a single click and a
 * permanent open — because the real tree's click handling is the Explorer's
 * own, covered in its suite. The file view is real, with a textarea standing in
 * for Monaco, so the dirty case exercises an actual buffer.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockExplorerApi = vi.hoisted(() => ({
    readBlob: vi.fn(),
    writeBlob: vi.fn(),
    readTrustedBlob: vi.fn(),
    searchFiles: vi.fn(async () => ({ results: [] as { path: string }[] })),
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi', () => ({
    explorerApi: mockExplorerApi,
}));
vi.mock('../../../../src/server/spa/client/react/shared/file-viewer/MonacoFileEditor', () => ({
    MonacoFileEditor: ({ value, onChange }: any) => (
        <textarea data-testid="mock-monaco-textarea" value={value} onChange={e => onChange?.(e.target.value)} />
    ),
    getMonacoLanguage: () => 'plaintext',
}));
vi.mock('../../../../src/server/spa/client/react/features/terminal/TerminalView', () => ({
    TerminalView: () => <div data-testid="mock-terminal" />,
}));
// The tree column: one row per file, with the two gestures the panel
// distinguishes surfaced as real buttons.
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/ExplorerPanel', () => ({
    ExplorerPanel: ({ onOpenFile }: {
        onOpenFile?: (
            file: { path: string; name: string; line?: number },
            options: { preview: boolean; readOnly?: boolean },
        ) => void;
    }) => (
        <div data-testid="mock-explorer">
            {['a', 'b', 'c'].map(name => (
                <div key={name}>
                    <button
                        type="button"
                        data-testid={`tree-click-${name}`}
                        onClick={() => onOpenFile?.({ path: `src/${name}.ts`, name: `${name}.ts` }, { preview: true })}
                    >
                        click {name}
                    </button>
                    <button
                        type="button"
                        data-testid={`tree-open-${name}`}
                        onClick={() => onOpenFile?.({ path: `src/${name}.ts`, name: `${name}.ts` }, { preview: false })}
                    >
                        open {name}
                    </button>
                </div>
            ))}
        </div>
    ),
}));
vi.mock('../../../../src/server/spa/client/react/features/notes/dock/DockNotesPanel', () => ({
    DockNotesPanel: () => <div data-testid="mock-notes" />,
}));
vi.mock('../../../../src/server/spa/client/react/repos/cloneRegistry', () => ({
    getCocClientForWorkspace: () => ({ canvases: { list: async () => [], create: async () => ({ id: 'c1', title: 'c' }) } }),
    lookupCloneBaseUrl: () => null,
}));

import { UnifiedRightPanel } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedRightPanel';
import { clearUnifiedPanelState } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelStore';
import { openUnifiedPanelTab } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelOpen';
import {
    clearUnifiedTreeState,
    writeUnifiedTreeState,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTree';
import type { WorkspaceDockController } from '../../../../src/server/spa/client/react/features/repo-detail/WorkspaceRightDock';

const WS = 'ws-1';
const CHAT = 'chat-1';

function dockStub(overrides: Partial<WorkspaceDockController> = {}): WorkspaceDockController {
    return {
        isOpen: true,
        toggleOpen: vi.fn(),
        view: 'terminal',
        setView: vi.fn(),
        views: ['terminal', 'explorer', 'notes'],
        target: WS,
        setTarget: vi.fn(),
        targets: [],
        width: 900,
        maxWidth: 1200,
        isDragging: false,
        handleMouseDown: vi.fn(),
        handleTouchStart: vi.fn(),
        ...overrides,
    };
}

/** Render the panel with the tree column already open. */
function renderPanel(chatId: string | null = CHAT) {
    act(() => { writeUnifiedTreeState(WS, { open: true, width: 220 }); });
    return render(<UnifiedRightPanel workspaceId={WS} chatId={chatId} dock={dockStub()} />);
}

/** Every file tab in the strip, in order, with its preview bit. */
function fileTabs(): { label: string; preview: boolean; id: string }[] {
    return Array.from(document.querySelectorAll('[role="tab"][data-kind="file"]')).map(node => ({
        label: node.querySelector('[data-testid^="unified-panel-tab-label-"]')?.textContent ?? '',
        preview: node.getAttribute('data-preview') === 'true',
        id: node.getAttribute('data-tab-id') ?? '',
    }));
}

function labels(): string[] {
    return fileTabs().map(tab => tab.label);
}

beforeEach(() => {
    vi.clearAllMocks();
    mockExplorerApi.searchFiles.mockResolvedValue({ results: [] });
    mockExplorerApi.readBlob.mockResolvedValue({ content: 'hello', encoding: 'utf-8', mimeType: 'text/plain' });
    mockExplorerApi.writeBlob.mockResolvedValue({ success: true });
    localStorage.clear();
    clearUnifiedPanelState();
    clearUnifiedTreeState();
});
afterEach(() => {
    cleanup();
    clearUnifiedPanelState();
    clearUnifiedTreeState();
});

describe('unified panel preview tabs (AC-03)', () => {
    it('opens a single click as one italic tab, and reuses it for the next click', () => {
        renderPanel();

        fireEvent.click(screen.getByTestId('tree-click-a'));
        expect(fileTabs()).toEqual([expect.objectContaining({ label: 'a.ts', preview: true })]);
        const slotId = fileTabs()[0].id;

        fireEvent.click(screen.getByTestId('tree-click-b'));
        const tabs = fileTabs();
        expect(tabs.length).toBe(1);
        expect(tabs[0].label).toBe('b.ts');
        expect(tabs[0].preview).toBe(true);
        // A new resource, so a new identity — but the same one slot.
        expect(tabs[0].id).not.toBe(slotId);
    });

    it('says "preview" in words, not only in italics', () => {
        renderPanel();
        fireEvent.click(screen.getByTestId('tree-click-a'));
        const tab = document.querySelector('[role="tab"][data-kind="file"]')!;

        expect(tab.getAttribute('title')).toContain('preview — double-click to keep open');
        expect(tab.textContent).toContain('preview — double-click to keep open');
        expect(tab.querySelector('[data-testid^="unified-panel-tab-label-"]')!.className).toContain('italic');
    });

    it('keeps the preview slot last and leaves permanent tabs alone', () => {
        renderPanel();

        fireEvent.click(screen.getByTestId('tree-click-a'));
        fireEvent.click(screen.getByTestId('tree-open-b'));
        fireEvent.click(screen.getByTestId('tree-open-c'));

        expect(labels()).toEqual(['b.ts', 'c.ts', 'a.ts']);
        expect(fileTabs().filter(tab => tab.preview).map(tab => tab.label)).toEqual(['a.ts']);
    });

    it('focuses an existing permanent tab instead of previewing the same file twice', () => {
        renderPanel();

        fireEvent.click(screen.getByTestId('tree-open-a'));
        fireEvent.click(screen.getByTestId('tree-click-b'));
        fireEvent.click(screen.getByTestId('tree-click-a'));

        // a.ts is selected and still permanent; the preview slot still holds b.
        expect(labels()).toEqual(['a.ts', 'b.ts']);
        expect(fileTabs()[0].preview).toBe(false);
        expect(document.querySelector('[role="tab"][data-active]')?.textContent).toContain('a.ts');
        expect(fileTabs()[1].preview).toBe(true);
    });

    it('does not touch the preview slot when a source link opens a file', () => {
        renderPanel();
        fireEvent.click(screen.getByTestId('tree-click-a'));

        act(() => {
            openUnifiedPanelTab(WS, {
                kind: 'file',
                ownerWorkspaceId: WS,
                chatId: CHAT,
                resourceId: 'src/linked.ts',
                label: 'linked.ts',
                readOnly: true,
            });
        });

        // The link's tab is permanent and lands before the preview, which is
        // still the one replaceable slot.
        expect(labels()).toEqual(['linked.ts', 'a.ts']);
        expect(fileTabs().filter(tab => tab.preview).map(tab => tab.label)).toEqual(['a.ts']);
    });

    it('files the preview under the chat when one is selected, and the workspace otherwise', () => {
        const withChat = renderPanel(CHAT);
        fireEvent.click(screen.getByTestId('tree-click-a'));
        expect(fileTabs()[0].id).toContain(CHAT);
        withChat.unmount();

        clearUnifiedPanelState();
        renderPanel(null);
        fireEvent.click(screen.getByTestId('tree-click-a'));
        expect(fileTabs()[0].id).toContain('@workspace');
    });

    it('runs the unsaved-edits prompt before replacing a dirty preview, and cancel keeps it', async () => {
        renderPanel();
        fireEvent.click(screen.getByTestId('tree-click-a'));
        const editor = await screen.findByTestId('mock-monaco-textarea');
        fireEvent.change(editor, { target: { value: 'edited' } });
        await waitFor(() => expect(screen.getByTestId(`unified-panel-tab-dirty-${fileTabs()[0].id}`)).toBeTruthy());

        fireEvent.click(screen.getByTestId('tree-click-b'));

        // Nothing has been replaced yet: the prompt is up and a.ts is still the
        // buffer on screen.
        expect(screen.getByTestId('explorer-close-tabs-prompt')).toBeTruthy();
        expect(labels()).toEqual(['a.ts']);

        fireEvent.click(screen.getByTestId('explorer-close-cancel-btn'));
        expect(screen.queryByTestId('explorer-close-tabs-prompt')).toBeNull();
        expect(labels()).toEqual(['a.ts']);
        expect((screen.getByTestId('mock-monaco-textarea') as HTMLTextAreaElement).value).toBe('edited');
    });

    it("opens the queued file once Don't Save resolves the dirty preview", async () => {
        renderPanel();
        fireEvent.click(screen.getByTestId('tree-click-a'));
        const editor = await screen.findByTestId('mock-monaco-textarea');
        fireEvent.change(editor, { target: { value: 'edited' } });
        await waitFor(() => expect(screen.getByTestId(`unified-panel-tab-dirty-${fileTabs()[0].id}`)).toBeTruthy());

        fireEvent.click(screen.getByTestId('tree-click-b'));
        fireEvent.click(screen.getByTestId('explorer-close-dont-save-btn'));

        await waitFor(() => expect(labels()).toEqual(['b.ts']));
        expect(fileTabs()[0].preview).toBe(true);
    });
});
