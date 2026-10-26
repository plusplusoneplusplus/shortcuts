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
 * The heavy `UnifiedDiffViewer` and `MonacoFileDiffViewer` are stubbed to their
 * inputs so an assertion can read the reconstructed hunks and editor sides
 * directly.
 */
/* @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../../../src/server/spa/client/react/features/git/hooks/useDiffEngine', () => ({
    useDiffEngine: () => ['monaco', () => {}],
}));
vi.mock('../../../../src/server/spa/client/react/features/git/diff/MonacoFileDiffViewer', () => ({
    MonacoFileDiffViewer: (props: any) => (
        <div data-testid={props['data-testid']} data-workspace={props.workspaceId}>
            <pre data-testid="monaco-original">{props.original}</pre>
            <pre data-testid="monaco-modified">{props.modified}</pre>
        </div>
    ),
}));
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

const nav = () => screen.getByRole('complementary', { name: 'Changed files' });
/** The files the shared review navigator lists, in tree order. */
const rowPaths = () => Array.from(nav().querySelectorAll('[data-file-path]')).map(el => el.getAttribute('data-file-path'));
const selectedPath = () => nav().querySelector('[aria-current="true"]')?.getAttribute('data-file-path');
function selectFile(path: string) {
    fireEvent.click(nav().querySelector(`[data-file-path="${path}"]`)!);
}
/** The selected file's rendered diff text. */
function selectedDiff(path: string): string {
    selectFile(path);
    expect(screen.getByTestId('whisper-diff-file')).toHaveAttribute('data-path', path);
    return screen.getByTestId('whisper-diff-body').textContent ?? '';
}

beforeEach(() => {
    cleanup();
    clearUnifiedDiffSources();
    localStorage.clear();
});

describe('AC-02 — the combined Changes view over a whole chat', () => {
    it('lists every changed file across every turn in the review navigator', () => {
        renderChangesTab();
        // Tree order: folders first, then files. Files with no body are listed
        // too, and say why when selected.
        expect(rowPaths()).toEqual([
            'src/win/panel.ts',
            'src/win/scratch.ts',
            'src/app.ts',
            'src/codex.ts',
            'src/gone.ts',
            'src/helper.ts',
        ]);
        expect(screen.getByTestId('whisper-diff-totals')).toHaveTextContent('6 files');
    });

    it('replays repeated edits and a later reversion as chronological steps', () => {
        renderChangesTab();
        const diff = selectedDiff('src/app.ts');
        // Three operations, three hunks — not one net before/after, and never a
        // fabricated full file.
        expect(screen.getByTestId('whisper-diff-patch-only')).toBeInTheDocument();
        expect(screen.queryByTestId('whisper-diff-editor')).toBeNull();
        expect(screen.getByTestId('whisper-diff-viewer').textContent?.match(/^@@/gm)?.length).toBe(3);
        expect(diff.indexOf('+alpha')).toBeLessThan(diff.indexOf('+beta'));
        expect(diff.indexOf('+beta')).toBeLessThan(diff.indexOf('-beta'));
        expect(diff).toContain('-alpha');
    });

    it('replays a record captured in both toolCalls and timeline exactly once', () => {
        renderChangesTab();
        const diff = selectedDiff('src/helper.ts');
        expect(diff.match(/\+new helper/g)?.length).toBe(1);
    });

    it('says why deleted and unavailable files have no diff', () => {
        renderChangesTab();
        expect(selectedDiff('src/gone.ts')).toContain('deleted this file');
        // The Windows scratch file reaches the deleted state through `Remove-Item`.
        expect(selectedDiff('src/win/scratch.ts')).toContain('deleted this file');
        expect(selectedDiff('src/codex.ts')).toContain('no line content');
        expect(nav().querySelector('[data-file-path="src/gone.ts"]')).toHaveAccessibleName(/Deleted/);
    });

    it('opens a single created file in Monaco with the exact captured text', () => {
        renderChangesTab([assistantTurn([createCall('n1', 'src/fresh.ts', 'line 1\nline 2\n')])]);
        const editor = screen.getByTestId('whisper-diff-editor');
        expect(editor).toHaveAttribute('data-workspace', OWNER);
        expect(screen.getByTestId('monaco-original').textContent).toBe('');
        expect(screen.getByTestId('monaco-modified').textContent).toBe('line 1\nline 2\n');
    });

    it('selects a file when its row is clicked', () => {
        renderChangesTab();
        const body = selectedDiff('src/helper.ts');
        expect(selectedPath()).toBe('src/helper.ts');
        expect(body).toContain('+new helper');
        expect(body).not.toContain('+beta');
    });

    it('rebuilds from a grown chat, keeping the earlier turns in place', () => {
        const grown = [...CHAT_TURNS, assistantTurn([editCall('e3', 'src/later.ts', 'x', 'y')])];
        renderChangesTab(grown);
        expect(rowPaths()).toContain('src/later.ts');
        expect(rowPaths()).toContain('src/app.ts');
    });

    it('reconstructs a Windows-recorded file from its backslash args', () => {
        renderChangesTab();
        const body = selectedDiff('src/win/panel.ts');
        expect(body).toContain('+winA');
        expect(body).toContain('+winB');
    });

    it('shows one file, not two, when the chat records it in both path forms', () => {
        // A Windows-native tool reports `src\\both.ts` and a later repo-relative
        // one reports `src/both.ts`. `collectFileEdits` canonicalizes the key, so
        // the list stays singular.
        const mixed = [
            assistantTurn([createCall('m1', 'src\\both.ts', 'one\n')]),
            assistantTurn([editCall('m2', 'src/both.ts', 'one', 'two')]),
        ];
        renderChangesTab(mixed);
        expect(rowPaths()).toEqual(['src/both.ts']);
        expect(screen.getByTestId('whisper-diff-totals')).toHaveTextContent('1 file');
        // Both operations replay into the one patch, in order.
        const diff = screen.getByTestId('whisper-diff-body').textContent ?? '';
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
