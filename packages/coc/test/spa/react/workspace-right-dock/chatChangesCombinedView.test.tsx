/**
 * AC-02: the one combined Changes tab, end to end.
 *
 * The layers below this are unit-tested on their own (`chatChangesModel`,
 * `buildWhisperCombinedDiff`, `useWhisperDiffState`, `WhisperDiffPanel`). What
 * these cases pin is the whole chain a user actually goes through: a chat's
 * retained turns -> `buildChatChangesContext` -> `chatChangesTabInput`'s
 * registered source -> `UnifiedDiffTab`'s rendered panel. They cover the DoD
 * list — several turns, repeated edits to one file, a later reversion, a record
 * that arrives twice, files whose content is unavailable or deleted, and tab
 * reuse across repeated opens and a close.
 *
 * The fixture is cross-platform: alongside the POSIX-path files it carries two
 * files a Windows run recorded with backslash paths — one edited, one removed
 * with `Remove-Item` — and every list assertion below covers them the same way.
 *
 * The heavy `UnifiedDiffViewer` is stubbed to its raw diff text so an assertion
 * can read the reconstructed hunks directly.
 */
/* @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../../../src/server/spa/client/react/features/git/diff/UnifiedDiffViewer', () => ({
    UnifiedDiffViewer: ({ diff, fileName, 'data-testid': testId }: any) => (
        <pre data-testid={testId} data-file-name={fileName}>{diff}</pre>
    ),
}));

import { buildChatChangesContext } from '../../../../src/server/spa/client/react/features/chat/conversation/tool-calls/chatChangesModel';
import {
    chatChangesSourceId,
    chatChangesTabInput,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedChatChanges';
import { clearUnifiedDiffSources } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedDiffSources';
import { UnifiedDiffTab } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedDiffTab';
import {
    EMPTY_UNIFIED_PANEL,
    closeTab,
    openTab,
    visibleTabs,
    activeTabId,
    type UnifiedPanelState,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';
import type {
    ClientConversationTurn,
    ClientToolCall,
} from '../../../../src/server/spa/client/react/types/dashboard';

const CHAT_ID = 'chat-1';
const OWNER = 'repo-a';
const ROOT = '/home/u/proj';

function call(over: Partial<ClientToolCall> & { toolName: string }): ClientToolCall {
    return { id: 't1', args: {}, status: 'completed', ...over } as ClientToolCall;
}

function assistantTurn(
    calls: ClientToolCall[],
    options: { timeline?: ClientToolCall[] } = {},
): ClientConversationTurn {
    return {
        role: 'assistant',
        content: '',
        toolCalls: calls,
        timeline: (options.timeline ?? []).map(c => ({
            type: 'tool-complete' as const,
            timestamp: '',
            toolCall: c,
        })),
    } as ClientConversationTurn;
}

function editCall(id: string, path: string, oldStr: string, newStr: string): ClientToolCall {
    return call({ id, toolName: 'edit', args: { path, old_str: oldStr, new_str: newStr } });
}

function createCall(id: string, path: string, text: string): ClientToolCall {
    return call({ id, toolName: 'create', args: { path, file_text: text } });
}

/**
 * A chat that exercises every combined-view rule at once:
 *  - `src/app.ts` is created, edited, then edited back (three chronological steps);
 *  - `src/helper.ts` is edited once but recorded in both `toolCalls` and `timeline`;
 *  - `src/gone.ts` is created and later removed by a shell command;
 *  - `src/codex.ts` changes through a Codex structured patch with no line content;
 *  - `src\win\panel.ts` is created and edited with Windows-form paths;
 *  - `src\win\scratch.ts` is created with a Windows-form path and removed by
 *    `Remove-Item`.
 */
const HELPER_EDIT = editCall('h1', 'src/helper.ts', 'old helper', 'new helper');

const CHAT_TURNS: ClientConversationTurn[] = [
    assistantTurn([createCall('c1', 'src/app.ts', 'alpha\n'), createCall('c2', 'src/gone.ts', 'temp\n')]),
    { role: 'user', content: 'now change it', timeline: [] } as ClientConversationTurn,
    assistantTurn([
        editCall('e1', 'src/app.ts', 'alpha', 'beta'),
        HELPER_EDIT,
        call({ id: 'p1', toolName: 'apply_patch', args: { changes: [{ path: 'src/codex.ts', kind: 'update' }] } }),
    ], { timeline: [HELPER_EDIT] }),
    { role: 'user', content: 'undo that, and drop the temp file', timeline: [] } as ClientConversationTurn,
    assistantTurn([
        editCall('e2', 'src/app.ts', 'beta', 'alpha'),
        call({ id: 's1', toolName: 'bash', args: { command: 'rm -f src/gone.ts' } }),
    ]),
    // The same chat continued from a Windows clone: native backslash paths for
    // a created-then-edited file and for a scratch file removed by PowerShell.
    { role: 'user', content: 'now the windows side', timeline: [] } as ClientConversationTurn,
    assistantTurn([
        createCall('w1', 'src\\win\\panel.ts', 'winA\n'),
        editCall('w2', 'src\\win\\panel.ts', 'winA', 'winB'),
        createCall('w3', 'src\\win\\scratch.ts', 'junk\n'),
        call({ id: 'w4', toolName: 'powershell', args: { command: 'Remove-Item -Force src\\win\\scratch.ts' } }),
    ]),
];

function openChangesTab(turns: ClientConversationTurn[] = CHAT_TURNS) {
    const ctx = buildChatChangesContext(turns, { ownerWorkspaceId: OWNER, chatId: CHAT_ID });
    if (!ctx) throw new Error('expected the chat to have changes');
    return chatChangesTabInput({
        changes: { ctx, workspaceRootPath: ROOT },
        ownerWorkspaceId: OWNER,
        chatId: CHAT_ID,
    });
}

function renderChangesTab(turns: ClientConversationTurn[] = CHAT_TURNS) {
    const input = openChangesTab(turns);
    render(
        <UnifiedDiffTab
            sourceId={input.resourceId}
            label={input.label}
            scopeWorkspaceId={OWNER}
            chatId={CHAT_ID}
            onClose={() => {}}
        />,
    );
    return input;
}

function sectionByPath(path: string): HTMLElement {
    const found = screen
        .getAllByTestId('whisper-diff-file-section')
        .find(el => el.getAttribute('data-path') === path);
    if (!found) throw new Error(`no diff section for ${path}`);
    return found;
}

beforeEach(() => {
    cleanup();
    clearUnifiedDiffSources();
});

describe('AC-02 — the combined Changes view over a whole chat', () => {
    it('renders one section per reconstructable file, across every turn', () => {
        renderChangesTab();
        expect(
            screen.getAllByTestId('whisper-diff-file-section').map(el => el.getAttribute('data-path')),
        ).toEqual(['src/app.ts', 'src/helper.ts', 'src/win/panel.ts']);
        // The header counts every changed file, including the three that cannot
        // render a body.
        expect(screen.getByTestId('whisper-diff-totals')).toHaveTextContent('6 files');
    });

    it('replays repeated edits and a later reversion as chronological steps', () => {
        renderChangesTab();
        const diff = sectionByPath('src/app.ts').querySelector('pre')?.textContent ?? '';
        // Three operations, three hunks — not one net before/after.
        expect(diff.match(/^@@/gm)?.length).toBe(3);
        // Create, then alpha -> beta, then beta -> alpha, in that order.
        expect(diff.indexOf('+alpha')).toBeLessThan(diff.indexOf('+beta'));
        expect(diff.indexOf('+beta')).toBeLessThan(diff.indexOf('-beta'));
        expect(diff).toContain('-alpha');
        expect(diff).toContain('-beta');
    });

    it('replays a record captured in both toolCalls and timeline exactly once', () => {
        renderChangesTab();
        const diff = sectionByPath('src/helper.ts').querySelector('pre')?.textContent ?? '';
        expect(diff.match(/^@@/gm)?.length).toBe(1);
        expect(diff.match(/^\+new helper$/gm)?.length).toBe(1);
    });

    it('lists deleted and unavailable files under "Not shown" with their reason', () => {
        renderChangesTab();
        const notShown = screen.getByTestId('whisper-diff-not-shown');
        const items = screen.getAllByTestId('whisper-diff-not-shown-item');
        // Deleted files first, then the non-reconstructable ones; the Windows
        // scratch file reaches this list through `Remove-Item`.
        expect(items.map(el => el.getAttribute('data-path'))).toEqual([
            'src/gone.ts',
            'src/win/scratch.ts',
            'src/codex.ts',
        ]);
        expect(notShown).toHaveTextContent('src/gone.ts — deleted');
        expect(notShown).toHaveTextContent('src/win/scratch.ts — deleted');
        expect(notShown).toHaveTextContent('src/codex.ts — no diff available');
    });

    it('offers every changed file in the dropdown, including the ones with no body', () => {
        renderChangesTab();
        fireEvent.click(screen.getByTestId('whisper-diff-file-select'));
        // `collectFileEdits` sorts by path, so the whole chat's files list the
        // same way a single group's does — the leading `null` is "All files".
        expect(
            screen.getAllByTestId('whisper-diff-file-option').map(el => el.getAttribute('data-path')),
        ).toEqual([
            null,
            'src/app.ts',
            'src/codex.ts',
            'src/gone.ts',
            'src/helper.ts',
            'src/win/panel.ts',
            'src/win/scratch.ts',
        ]);
    });

    it('narrows to a single file when one is picked', () => {
        renderChangesTab();
        fireEvent.click(screen.getByTestId('whisper-diff-file-select'));
        const option = screen
            .getAllByTestId('whisper-diff-file-option')
            .find(el => el.getAttribute('data-path') === 'src/helper.ts');
        fireEvent.click(option!);
        expect(screen.getByTestId('whisper-diff-path')).toHaveTextContent('src/helper.ts');
        expect(screen.queryAllByTestId('whisper-diff-file-section')).toHaveLength(0);
        const body = screen.getByTestId('whisper-diff-body').textContent ?? '';
        expect(body).toContain('+new helper');
        expect(body).not.toContain('+beta');
    });

    it('rebuilds from a grown chat, keeping the earlier turns in place', () => {
        const grown = [...CHAT_TURNS, assistantTurn([editCall('e3', 'src/later.ts', 'x', 'y')])];
        renderChangesTab(grown);
        expect(
            screen.getAllByTestId('whisper-diff-file-section').map(el => el.getAttribute('data-path')),
        ).toEqual(['src/app.ts', 'src/helper.ts', 'src/later.ts', 'src/win/panel.ts']);
    });

    it('narrows to a Windows-recorded file, reconstructed from its backslash args', () => {
        renderChangesTab();
        fireEvent.click(screen.getByTestId('whisper-diff-file-select'));
        const option = screen
            .getAllByTestId('whisper-diff-file-option')
            .find(el => el.getAttribute('data-path') === 'src/win/panel.ts');
        fireEvent.click(option!);
        expect(screen.getByTestId('whisper-diff-path')).toHaveTextContent('src/win/panel.ts');
        const body = screen.getByTestId('whisper-diff-body').textContent ?? '';
        expect(body).toContain('+winA');
        expect(body).toContain('+winB');
    });

    it('shows one file, not two, when the chat records it in both path forms', () => {
        // A Windows-native tool reports `src\\both.ts` and a later repo-relative
        // one reports `src/both.ts`. `collectFileEdits` canonicalizes the key, so
        // the list, the dropdown and the section stay singular.
        const mixed = [
            assistantTurn([createCall('m1', 'src\\both.ts', 'one\n')]),
            assistantTurn([editCall('m2', 'src/both.ts', 'one', 'two')]),
        ];
        renderChangesTab(mixed);
        expect(
            screen.getAllByTestId('whisper-diff-file-section').map(el => el.getAttribute('data-path')),
        ).toEqual(['src/both.ts']);
        expect(screen.getByTestId('whisper-diff-totals')).toHaveTextContent('1 file');
        fireEvent.click(screen.getByTestId('whisper-diff-file-select'));
        expect(
            screen.getAllByTestId('whisper-diff-file-option').map(el => el.getAttribute('data-path')),
        ).toEqual([null, 'src/both.ts']);
        // Both operations replay into the one section, in order.
        const diff = sectionByPath('src/both.ts').querySelector('pre')?.textContent ?? '';
        expect(diff.match(/^@@/gm)?.length).toBe(2);
        expect(diff.indexOf('+one')).toBeLessThan(diff.indexOf('+two'));
    });
});

describe('AC-02 — Changes tab reuse', () => {
    it('opens under the chat-scoped source id whatever the chat records', () => {
        expect(openChangesTab().resourceId).toBe(chatChangesSourceId(CHAT_ID));
        clearUnifiedDiffSources();
        const grown = [...CHAT_TURNS, assistantTurn([editCall('e3', 'src/later.ts', 'x', 'y')])];
        expect(openChangesTab(grown).resourceId).toBe(chatChangesSourceId(CHAT_ID));
    });

    it('focuses the one tab when the entry is clicked twice', () => {
        let state: UnifiedPanelState = EMPTY_UNIFIED_PANEL;
        state = openTab(state, { ...openChangesTab(), chatId: CHAT_ID });
        const first = visibleTabs(state, CHAT_ID);
        state = openTab(state, { ...openChangesTab(), chatId: CHAT_ID });
        const second = visibleTabs(state, CHAT_ID);
        expect(second).toHaveLength(1);
        expect(second[0].id).toBe(first[0].id);
        expect(second[0].label).toBe('Changes');
        expect(activeTabId(state, CHAT_ID)).toBe(first[0].id);
    });

    it('reopens on the same tab after it is closed', () => {
        let state: UnifiedPanelState = EMPTY_UNIFIED_PANEL;
        state = openTab(state, { ...openChangesTab(), chatId: CHAT_ID });
        const originalId = visibleTabs(state, CHAT_ID)[0].id;
        state = closeTab(state, originalId);
        expect(visibleTabs(state, CHAT_ID)).toHaveLength(0);

        state = openTab(state, { ...openChangesTab(), chatId: CHAT_ID });
        const reopened = visibleTabs(state, CHAT_ID);
        expect(reopened).toHaveLength(1);
        expect(reopened[0].id).toBe(originalId);
        expect(activeTabId(state, CHAT_ID)).toBe(originalId);
    });

    it('keeps another chat\'s Changes tab distinct', () => {
        const other = buildChatChangesContext(CHAT_TURNS, { ownerWorkspaceId: OWNER, chatId: 'chat-2' });
        const otherInput = chatChangesTabInput({
            changes: { ctx: other!, workspaceRootPath: ROOT },
            ownerWorkspaceId: OWNER,
            chatId: 'chat-2',
        });
        let state: UnifiedPanelState = EMPTY_UNIFIED_PANEL;
        state = openTab(state, { ...openChangesTab(), chatId: CHAT_ID });
        state = openTab(state, { ...otherInput, chatId: 'chat-2' });
        expect(visibleTabs(state, CHAT_ID)).toHaveLength(1);
        expect(visibleTabs(state, 'chat-2')).toHaveLength(1);
        expect(visibleTabs(state, CHAT_ID)[0].id).not.toBe(visibleTabs(state, 'chat-2')[0].id);
    });
});
