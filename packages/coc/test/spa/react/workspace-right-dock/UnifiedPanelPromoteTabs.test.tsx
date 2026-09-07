/**
 * Promotion to a permanent tab (AC-04) — the four gestures that mean "I am
 * keeping this file": a double click in the tree, a double click on the tab, an
 * edit, and a drag to reorder.
 *
 * `unifiedPanelTabsModel.test.ts` pins what promotion does to the state. What
 * these cases pin is that each gesture reaches it, and the two things a user
 * would notice if it were wired badly: a promoted tab must not reload (the
 * buffer, its scroll, and any edit survive), and it must not spawn a second tab
 * beside the preview it came from.
 *
 * The tree is stubbed to one button per gesture, since the real tree's click
 * handling is the Explorer's own and is covered in its suite. The file view is
 * real, with a textarea standing in for Monaco, so the edit gesture runs
 * through an actual buffer and the reload assertions can count reads.
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
                    {/*
                      * A row wired the way TreeNode wires one, so a real
                      * double click replays what the browser actually sends:
                      * click, click, dblclick.
                      */}
                    <div
                        data-testid={`tree-row-${name}`}
                        onClick={() => onOpenFile?.({ path: `src/${name}.ts`, name: `${name}.ts` }, { preview: true })}
                        onDoubleClick={() => onOpenFile?.({ path: `src/${name}.ts`, name: `${name}.ts` }, { preview: false })}
                    >
                        row {name}
                    </div>
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


/** Replay a browser double click on a tree row: click, click, dblclick. */
function doubleClickRow(name: string) {
    const row = screen.getByTestId(`tree-row-${name}`);
    fireEvent.click(row);
    fireEvent.click(row);
    fireEvent.doubleClick(row);
}

/** A dataTransfer stand-in; jsdom does not provide one. */
function dragData() {
    const data = new Map<string, string>();
    return {
        setData: (type: string, value: string) => data.set(type, value),
        getData: (type: string) => data.get(type) ?? '',
        effectAllowed: '',
        dropEffect: '',
    };
}

function tabNode(id: string): HTMLElement {
    return document.querySelector(`[role="tab"][data-tab-id="${id}"]`) as HTMLElement;
}

describe('unified panel tab promotion (AC-04)', () => {
    it('promotes in place when the tree row is double-clicked, without reloading', async () => {
        renderPanel();
        fireEvent.click(screen.getByTestId('tree-row-a'));
        await screen.findByTestId('mock-monaco-textarea');
        const slotId = fileTabs()[0].id;
        const readsAfterPreview = mockExplorerApi.readBlob.mock.calls.length;

        doubleClickRow('a');

        expect(fileTabs()).toEqual([expect.objectContaining({ label: 'a.ts', preview: false, id: slotId })]);
        // Same tab id means the same mounted view: no remount, so no second read
        // of a file that is already on screen.
        expect(mockExplorerApi.readBlob.mock.calls.length).toBe(readsAfterPreview);
    });

    it('opens one permanent tab when a file is double-clicked from a fresh state', () => {
        renderPanel();
        doubleClickRow('b');
        expect(fileTabs()).toEqual([expect.objectContaining({ label: 'b.ts', preview: false })]);
    });

    it('promotes on the first edit, and the next single click opens beside it', async () => {
        renderPanel();
        fireEvent.click(screen.getByTestId('tree-click-c'));
        const editor = await screen.findByTestId('mock-monaco-textarea');
        expect(fileTabs()[0].preview).toBe(true);

        fireEvent.change(editor, { target: { value: 'edited' } });

        const kept = fileTabs()[0];
        expect(kept.preview).toBe(false);
        await waitFor(() => expect(screen.getByTestId(`unified-panel-tab-dirty-${kept.id}`)).toBeTruthy());

        // The slot is free, so c.ts is not the thing the next click evicts.
        fireEvent.click(screen.getByTestId('tree-click-a'));
        expect(fileTabs()).toEqual([
            expect.objectContaining({ label: 'c.ts', preview: false, id: kept.id }),
            expect.objectContaining({ label: 'a.ts', preview: true }),
        ]);
        expect((screen.getAllByTestId('mock-monaco-textarea')[0] as HTMLTextAreaElement).value).toBe('edited');
    });

    it('promotes when the tab itself is double-clicked', () => {
        renderPanel();
        fireEvent.click(screen.getByTestId('tree-click-a'));
        const id = fileTabs()[0].id;

        fireEvent.doubleClick(tabNode(id));

        expect(fileTabs()).toEqual([expect.objectContaining({ label: 'a.ts', preview: false, id })]);
    });

    it('promotes when the tab is dragged to a new position', () => {
        renderPanel();
        fireEvent.click(screen.getByTestId('tree-open-a'));
        fireEvent.click(screen.getByTestId('tree-open-b'));
        fireEvent.click(screen.getByTestId('tree-click-c'));
        expect(labels()).toEqual(['a.ts', 'b.ts', 'c.ts']);
        const previewId = fileTabs()[2].id;

        const dataTransfer = dragData();
        fireEvent.dragStart(tabNode(previewId), { dataTransfer });
        fireEvent.drop(tabNode(fileTabs()[1].id), { dataTransfer });

        expect(labels()).toEqual(['a.ts', 'c.ts', 'b.ts']);
        expect(fileTabs().every(tab => !tab.preview)).toBe(true);
    });

    it('promotes from the keyboard: Enter on the focused preview tab', () => {
        renderPanel();
        fireEvent.click(screen.getByTestId('tree-click-a'));
        const id = fileTabs()[0].id;

        fireEvent.keyDown(tabNode(id), { key: 'Enter' });

        expect(fileTabs()).toEqual([expect.objectContaining({ label: 'a.ts', preview: false, id })]);
    });

    it('is one-way: nothing turns a promoted tab back into the preview slot', () => {
        renderPanel();
        fireEvent.click(screen.getByTestId('tree-click-a'));
        doubleClickRow('a');
        // Every gesture again, on a tab that is already permanent.
        fireEvent.doubleClick(tabNode(fileTabs()[0].id));
        fireEvent.click(screen.getByTestId('tree-click-a'));

        expect(fileTabs()).toEqual([expect.objectContaining({ label: 'a.ts', preview: false })]);
    });
});
