/**
 * AC-03: a Changes tab that survives a browser reload.
 *
 * The tab descriptor is persisted; the diff source registry is module state and
 * dies with the page. So on the next load the panel holds a `diff` tab pointing
 * at a `chat-changes-<id>` source that nobody has registered yet — and the chat
 * that can rebuild it is still fetching its history. These cases pin what the
 * user sees across that window: loading, then the chat's own combined diff, with
 * the empty diff (not an expiry) for a chat whose retained history changed
 * nothing.
 *
 * The two invariants the fix must not break are here too: a whisper group's diff
 * has no publisher and still expires, and a tab the user closed is never
 * recreated by a later publish — minting a source requires a mounted tab, which
 * a closed tab does not have.
 *
 * A reload is simulated the way it actually happens: the panel state round-trips
 * through localStorage while the in-memory registries are cleared.
 */
/* @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

// The diff body is stubbed to its raw text — these cases assert which files
// render, not how a hunk is painted.
vi.mock('../../../../src/server/spa/client/react/features/git/diff/UnifiedDiffViewer', () => ({
    UnifiedDiffViewer: ({ diff, 'data-testid': testId }: any) => (
        <pre data-testid={testId}>{diff}</pre>
    ),
}));

// `UnifiedTabView` is rendered for real so the descriptor → props wiring is
// covered, but only its `diff` branch matters here; the sibling views pull in
// terminals, editors and canvases that have nothing to do with this.
vi.mock('../../../../src/server/spa/client/react/features/terminal/TerminalView', () => ({
    TerminalView: () => null,
}));
vi.mock('../../../../src/server/spa/client/react/features/notes/dock/DockNotesPanel', () => ({
    DockNotesPanel: () => null,
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/PreviewPane', () => ({
    PreviewPane: () => null,
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedCanvasTab', () => ({
    UnifiedCanvasTab: () => null,
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedNoteTab', () => ({
    UnifiedNoteTab: () => null,
}));

import { buildChatChangesContext } from '../../../../src/server/spa/client/react/features/chat/conversation/tool-calls/chatChangesModel';
import {
    chatChangesSourceId,
    chatChangesTabInput,
    clearUnifiedChatChanges,
    getUnifiedChatChanges,
    publishUnifiedChatChanges,
    withdrawUnifiedChatChanges,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedChatChanges';
import {
    clearUnifiedDiffSources,
    getUnifiedDiffSource,
    whisperDiffTabInput,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedDiffSources';
import { UnifiedTabView } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedTabView';
import { openMenuActions } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelOpenMenuModel';
import {
    EMPTY_UNIFIED_PANEL,
    closeTab,
    openTab,
    visibleTabs,
    type UnifiedPanelTab,
    type OpenUnifiedTabInput,
    type UnifiedPanelState,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';
import {
    clearUnifiedPanelState,
    readUnifiedPanelState,
    writeUnifiedPanelState,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelStore';
import type {
    ClientConversationTurn,
    ClientToolCall,
} from '../../../../src/server/spa/client/react/types/dashboard';

/** The panel's own scope — a repo group here, to keep it apart from the clone. */
const SCOPE = 'group-1';
/** The clone the edited files belong to. */
const OWNER = 'repo-a';
const CHAT_ID = 'chat-1';
const ROOT = '/home/u/proj';

function editCall(id: string, path: string, oldStr: string, newStr: string): ClientToolCall {
    return {
        id,
        toolName: 'edit',
        args: { path, old_str: oldStr, new_str: newStr },
        status: 'completed',
    } as ClientToolCall;
}

function assistantTurn(calls: ClientToolCall[]): ClientConversationTurn {
    return { role: 'assistant', content: '', toolCalls: calls, timeline: [] } as ClientConversationTurn;
}

/** The chat's retained history, as it comes back from the server on a reload. */
const RESTORED_TURNS: ClientConversationTurn[] = [
    assistantTurn([editCall('e1', 'src/app.ts', 'alpha', 'beta')]),
];

/** A later turn: the same chat, one more file. */
const GROWN_TURNS: ClientConversationTurn[] = [
    ...RESTORED_TURNS,
    assistantTurn([editCall('e2', 'src/other.ts', 'one', 'two')]),
];

function contextOf(turns: ClientConversationTurn[]) {
    const ctx = buildChatChangesContext(turns, { ownerWorkspaceId: OWNER, chatId: CHAT_ID });
    if (!ctx) throw new Error('expected the chat to have changes');
    return ctx;
}

/** What `ChatDetail` does once its transcript has loaded. */
function chatPublishes(turns: ClientConversationTurn[] | null) {
    act(() => {
        publishUnifiedChatChanges(
            SCOPE,
            CHAT_ID,
            turns === null ? null : { ctx: contextOf(turns), workspaceRootPath: ROOT },
        );
    });
}

/**
 * Persist a tab, then reload: localStorage survives, the module registries do
 * not. Returns the descriptor as the fresh page reads it back.
 */
function reloadWith(
    input: OpenUnifiedTabInput,
    mutate: (state: UnifiedPanelState) => UnifiedPanelState = state => state,
): UnifiedPanelTab {
    writeUnifiedPanelState(SCOPE, mutate(openTab(EMPTY_UNIFIED_PANEL, input)));
    clearUnifiedDiffSources();
    clearUnifiedChatChanges();
    const restored = readUnifiedPanelState(SCOPE);
    const tab = visibleTabs(restored, CHAT_ID).find(entry => entry.kind === 'diff');
    if (!tab) throw new Error('expected a restored diff tab');
    return tab;
}

/** The Changes tab as the user opened it before the reload. */
function changesTabInput(turns: ClientConversationTurn[] = RESTORED_TURNS): OpenUnifiedTabInput {
    return chatChangesTabInput({
        changes: { ctx: contextOf(turns), workspaceRootPath: ROOT },
        ownerWorkspaceId: OWNER,
        chatId: CHAT_ID,
    });
}

function renderTab(tab: UnifiedPanelTab, onErrorChange?: (id: string, hasError: boolean) => void) {
    render(
        <UnifiedTabView
            tab={tab}
            scopeWorkspaceId={SCOPE}
            onClose={() => {}}
            onErrorChange={onErrorChange}
        />,
    );
}

function renderedPaths(): string[] {
    return screen
        .getAllByTestId('whisper-diff-file-section')
        .map(el => el.getAttribute('data-path') ?? '');
}

beforeEach(() => {
    cleanup();
    localStorage.clear();
    clearUnifiedPanelState();
    clearUnifiedDiffSources();
    clearUnifiedChatChanges();
});

describe('AC-03 — a restored Changes tab rehydrates from the chat', () => {
    it('shows loading until the transcript resolves, then the chat’s combined diff', () => {
        const tab = reloadWith(changesTabInput());
        // The descriptor names the chat's fixed source, which nothing has
        // registered on this fresh page.
        expect(tab.resourceId).toBe(chatChangesSourceId(CHAT_ID));
        expect(getUnifiedDiffSource(tab.resourceId)).toBeNull();

        renderTab(tab);
        expect(screen.getByTestId('unified-panel-diff-loading')).toBeTruthy();
        expect(screen.queryByTestId('unified-panel-diff-expired')).toBeNull();

        chatPublishes(RESTORED_TURNS);

        expect(screen.queryByTestId('unified-panel-diff-loading')).toBeNull();
        expect(renderedPaths()).toEqual(['src/app.ts']);
    });

    it('claims its source id, so later edits refresh the same tab', () => {
        const tab = reloadWith(changesTabInput());
        renderTab(tab);
        chatPublishes(RESTORED_TURNS);

        // The tab filled the registry the reload emptied — which is what a
        // later publish then refreshes in place.
        expect(getUnifiedDiffSource(tab.resourceId)?.ctx.files.map(f => f.path)).toEqual(['src/app.ts']);

        chatPublishes(GROWN_TURNS);
        expect(renderedPaths()).toEqual(['src/app.ts', 'src/other.ts']);
    });

    it('keeps showing the diff when the panel switches away from the chat', () => {
        const tab = reloadWith(changesTabInput());
        renderTab(tab);
        chatPublishes(RESTORED_TURNS);

        // Un-hosting the chat drops the published entry; a tab that is merely
        // off-screen must not fall back to loading or to expired.
        act(() => {
            withdrawUnifiedChatChanges(SCOPE, CHAT_ID);
        });
        expect(renderedPaths()).toEqual(['src/app.ts']);
    });

    it('shows the empty diff — not an expiry — for retained history with no changes', () => {
        const tab = reloadWith(changesTabInput());
        renderTab(tab);

        // The transcript loaded and holds no file change at all.
        chatPublishes(null);

        expect(screen.getByTestId('whisper-diff-empty')).toBeTruthy();
        expect(screen.queryByTestId('unified-panel-diff-expired')).toBeNull();
        expect(screen.queryByTestId('unified-panel-diff-loading')).toBeNull();
        // ...and the `+` menu keeps hiding the entry for that chat.
        expect(getUnifiedChatChanges(SCOPE, CHAT_ID)).toBeNull();
        const ids = openMenuActions({
            targetWorkspaceId: OWNER,
            chatId: CHAT_ID,
            chatHasChanges: getUnifiedChatChanges(SCOPE, CHAT_ID) !== null,
        }).map(action => action.id);
        expect(ids).not.toContain('changes');
    });

    it('does not report loading to the strip as an error', () => {
        const errors: Array<[string, boolean]> = [];
        const tab = reloadWith(changesTabInput());
        renderTab(tab, (id, hasError) => errors.push([id, hasError]));

        expect(screen.getByTestId('unified-panel-diff-loading')).toBeTruthy();
        expect(errors.every(([, hasError]) => hasError === false)).toBe(true);
    });
});

describe('AC-03 — what rehydration must not change', () => {
    it('still expires a restored whisper-group diff tab', () => {
        const ctx = contextOf(RESTORED_TURNS);
        const tab = reloadWith(whisperDiffTabInput({
            ctx,
            ownerWorkspaceId: OWNER,
            chatId: CHAT_ID,
            workspaceRootPath: ROOT,
        }));
        expect(tab.resourceId).not.toBe(chatChangesSourceId(CHAT_ID));

        renderTab(tab);
        expect(screen.getByTestId('unified-panel-diff-expired')).toBeTruthy();
        expect(screen.queryByTestId('unified-panel-diff-loading')).toBeNull();

        // A group has no publisher, so even the owning chat's publish leaves it
        // expired — its source is content-addressed, not chat-addressed.
        chatPublishes(RESTORED_TURNS);
        expect(screen.getByTestId('unified-panel-diff-expired')).toBeTruthy();
    });

    it('does not recreate a Changes tab the user closed', () => {
        const input = changesTabInput();
        const opened = openTab(EMPTY_UNIFIED_PANEL, input);
        const tabId = visibleTabs(opened, CHAT_ID)[0].id;
        writeUnifiedPanelState(SCOPE, closeTab(opened, tabId));
        clearUnifiedDiffSources();
        clearUnifiedChatChanges();

        // Nothing is mounted for the closed tab, so the publish has no tab to
        // fill: no source is minted and the panel stays empty.
        chatPublishes(RESTORED_TURNS);

        expect(getUnifiedDiffSource(chatChangesSourceId(CHAT_ID))).toBeNull();
        expect(visibleTabs(readUnifiedPanelState(SCOPE), CHAT_ID)).toHaveLength(0);
    });
});
