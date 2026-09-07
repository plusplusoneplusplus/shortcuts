/**
 * The dirty-preview close guard (AC-03 DoD 6) — the safety net for replacing a
 * preview tab that holds unsaved edits.
 *
 * This case is deliberately hard to reach: AC-04 promotes a tab the moment it
 * first reports dirty, so in the shipped UI a dirty tab is never the preview
 * slot. The guard still has to be right, because the model, a restore, or a
 * future entry point could put an edited buffer in the slot — losing it
 * silently is the one failure a file panel must not have. So this suite stubs
 * `promoteTab` to a no-op, which is exactly the seam the spec allows, and
 * drives the guard the way a tree click would.
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

// The seam: promotion off, so an edited preview stays in the slot and the guard
// below is reachable. Everything else in the model is the real thing.
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel', async () => {
    const actual = await vi.importActual<typeof import('../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel')>(
        '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel',
    );
    return { ...actual, promoteTab: (state: unknown) => state };
});

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

describe('unified panel preview slot — dirty close guard (AC-03)', () => {
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
