/* @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent, cleanup } from '@testing-library/react';
import React, { createRef } from 'react';

const { tracker, flags, state } = vi.hoisted(() => ({
    flags: { enabled: true },
    state: { changes: [] as any[], mode: 'flat', reads: [] as any[] },
    tracker: {
        calls: [] as Array<[string, number?]>,
        domValue: '',
        onChange: undefined as undefined | ((val: string, cursorPos: number) => void),
    },
}));

vi.mock('../../../../src/server/spa/client/react/shared/RichTextInput', async () => {
    const R = await import('react');
    return {
        RichTextInput: R.forwardRef((props: any, ref: any) => {
            R.useImperativeHandle(ref, () => ({
                getValue: () => tracker.domValue,
                setValue: (text: string, cursorPos?: number) => {
                    tracker.calls.push([text, cursorPos]);
                    tracker.domValue = text;
                },
                focus: () => {},
            }), []);
            tracker.onChange = props.onChange;
            return R.createElement('div', { 'data-testid': props['data-testid'] });
        }),
    };
});

vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    isComposerWordHintEnabled: () => false,
    DASHBOARD_CONFIG_UPDATED_EVENT: 'coc-dashboard-config-updated',
    isRalphEnabled: () => false,
    isForEachEnabled: () => false,
    isSessionContextAttachmentsEnabled: () => flags.enabled,
    getPrewarmDebounceMs: () => 500,
    getWarmClientTtlMs: () => 300000,
    isDiffContentSearchEnabled: () => false,
}));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => {
    const client = (baseUrl?: string) => ({
        git: {
            getWorkingTreeChanges: (workspace: string) => { state.reads.push([workspace, baseUrl]); return Promise.resolve({ changes: state.changes }); },
            listDiffComments: async () => ({ comments: [] }),
        },
        preferences: { getLlmToolsConfig: async () => ({ tools: [], conversationRetrievalAvailable: false }) },
    });
    return { getSpaCocClient: () => client(), getCocClientFor: client };
});
vi.mock('../../../../src/server/spa/client/react/features/git/hooks/useFilesViewMode', () => ({
    useFilesViewMode: () => ({ mode: state.mode, setMode: vi.fn() }),
}));
vi.mock('../../../../src/server/spa/client/react/features/git/working-tree/WorkingTreeFileDiff', () => ({ WorkingTreeFileDiff: ({ onDirtyChange }: any) => <button data-testid="working-diff" onClick={() => onDirtyChange(true)}>Edit buffer</button> }));
import { WorkingTree } from '../../../../src/server/spa/client/react/features/git/working-tree/WorkingTree';
import { WorkingTreeAllFilesDiff } from '../../../../src/server/spa/client/react/features/git/working-tree/WorkingTreeAllFilesDiff';

import { FollowUpInputArea } from '../../../../src/server/spa/client/react/features/chat/FollowUpInputArea';
import type { FollowUpInputAreaProps } from '../../../../src/server/spa/client/react/features/chat/FollowUpInputArea';
import type { RichTextInputHandle } from '../../../../src/server/spa/client/react/shared/RichTextInput';
import { useAttachedContext, formatAttachedContext, parseAttachedSessionContextBlocks } from '../../../../src/server/spa/client/react/features/chat/hooks/useAttachedContext';
import { validateSessionContextAttachmentsForSend } from '../../../../src/server/spa/client/react/features/chat/sessionContextDrop';
import { buildRemoteCloneKey } from '../../../../src/server/spa/client/react/repos/cloneIdentity';
import { registerCloneBaseUrls, resetCloneRegistryForTests } from '../../../../src/server/spa/client/react/repos/cloneRegistry';
import { WorkspaceOwnerContext } from '../../../../src/server/spa/client/react/repos/workspaceOwnerContext';

const WS = 'group-team';
const member = 'member';
const route = (id: string, server = 'one') => buildRemoteCloneKey(server, id);

/**
 * DataTransfer stand-in faithful on the one point that matters here: `types`
 * reflects what setData actually wrote, the way a browser's does. The composer
 * sniffs `types`, so a stand-in with a hardcoded list would hide a real bug.
 */
function makeDataTransfer() {
    const store = new Map<string, string>();
    return {
        effectAllowed: 'uninitialized' as string,
        dropEffect: 'none' as string,
        setData(format: string, data: string) { store.set(format, data); },
        getData(format: string) { return store.get(format) ?? ''; },
        get types() { return Array.from(store.keys()); },
    };
}

function makeProps(overrides: Partial<FollowUpInputAreaProps> = {}): FollowUpInputAreaProps {
    return {
        richTextRef: createRef<RichTextInputHandle>(),
        inputDisabled: false,
        sending: false,
        isActiveGeneration: false,
        isCancelling: false,
        error: null,
        resumeFeedback: null,
        suggestions: [],
        followUpInput: '',
        setFollowUpInput: vi.fn(),
        selectedMode: 'ask',
        setSelectedMode: vi.fn(),
        onSend: vi.fn().mockResolvedValue(undefined),
        onRetry: vi.fn(),
        skills: [],
        attachments: [],
        onAttachmentPaste: vi.fn(),
        onAttachmentRemove: vi.fn(),
        onAttachmentFiles: vi.fn(),
        attachmentError: null,
        attachedContext: [],
        onRemoveAttachedContext: vi.fn(),
        onAttachSessionContext: vi.fn(),
        workspaceId: WS,
        currentProcessId: 'current-process',
        task: null,
        slashCommands: {
            handleInputChange: vi.fn(),
            handleKeyDown: vi.fn(() => false),
            selectSkill: vi.fn(),
            dismissMenu: vi.fn(),
            menuVisible: false,
            menuFilter: '',
            filteredSkills: [],
            highlightIndex: 0,
        },
        ...overrides,
    };
}


let attached: ReturnType<typeof useAttachedContext>;
const ROOT = '/repo';
const relative = 'src/index.ts';
function change(overrides: Record<string, unknown> = {}) {
    return { filePath: `${ROOT}/${relative}`, stage: 'unstaged', status: 'M', repositoryRoot: ROOT, repositoryName: 'repo', ...overrides };
}
function Composer({ remote = false }: { remote?: boolean }) {
    attached = useAttachedContext();
    return <FollowUpInputArea {...makeProps({
        sessionContextAttachmentsEnabled: flags.enabled, canRetrieveConversations: false,
        attachmentDestinationId: remote ? route(WS) : WS,
        attachedContext: attached.items, getAttachedContext: attached.getItems,
        onAttachSessionContext: attached.addSessionContext, onRemoveAttachedContext: attached.remove,
    })} />;
}
type View = 'all' | 'flat' | 'tree';
async function setup(view: View, { remote = false, sourceOwner, repoRoot = ROOT, changes = [change()] }: {
    remote?: boolean; sourceOwner?: string; repoRoot?: string; changes?: any[];
} = {}) {
    state.changes = changes; state.mode = view;
    registerCloneBaseUrls(['one', 'two'].flatMap(serverId => [member, WS].map(workspaceId => ({
        workspaceId, serverId, baseUrl: `https://${serverId}.example`,
    }))));
    const owner = sourceOwner ?? (remote ? route(member) : member);
    const navigate = vi.fn();
    await act(async () => { render(<>
        <WorkspaceOwnerContext.Provider value={{ workspaceId: member, selectionId: owner, rootPath: repoRoot, baseUrl: remote ? `https://${sourceOwner === route(member, 'two') ? 'two' : 'one'}.example` : undefined }}>
            {view === 'all'
                ? <WorkingTreeAllFilesDiff workspaceId={member} attachmentDestinationId={owner} repoRoot={repoRoot} onNavigateToFile={navigate} />
                : <WorkingTree workspaceId={member} attachmentDestinationId={owner} repoRoot={repoRoot} onFileSelect={navigate} />}
        </WorkspaceOwnerContext.Provider>
        <Composer remote={remote} />
    </>); });
    tracker.calls = [];
    return navigate;
}
function rows(view: View) {
    return view === 'all'
        ? [...screen.getByRole('complementary', { name: 'Changed files' }).querySelectorAll<HTMLButtonElement>('[data-file-path]')]
        : screen.getAllByTestId(/^working-tree-file-row-/);
}
function drag(row: Element) {
    const dataTransfer = makeDataTransfer();
    fireEvent.dragStart(row, { dataTransfer });
    return dataTransfer;
}
const target = () => screen.getByTestId('chat-input-bar');
beforeEach(() => { flags.enabled = true; state.reads = []; tracker.calls = []; tracker.domValue = ''; });
afterEach(() => { cleanup(); resetCloneRegistryForTests(); vi.clearAllMocks(); });

describe.each(['all', 'flat', 'tree'] as const)('working changes %s → follow-up composer', view => {
    it.each([false, true])('attaches the member working file on its exact server (remote=%s)', async remote => {
        const navigate = await setup(view, { remote });
        const row = rows(view)[0];
        const dataTransfer = drag(row);
        expect(dataTransfer.effectAllowed).toBe('copy');
        fireEvent.dragOver(target(), { dataTransfer });
        expect(dataTransfer.dropEffect).toBe('copy');
        expect(screen.getByTestId('session-context-drop-hint')).toBeTruthy();
        fireEvent.drop(target(), { dataTransfer });
        expect(screen.getByTestId('attached-git-file-context-chip')).toBeTruthy();
        expect(tracker.calls).toEqual([]);
        const text = formatAttachedContext(attached.items);
        const pointer = parseAttachedSessionContextBlocks(text).pointerContexts[0];
        expect(pointer).toMatchObject({ kind: 'git-file', sourceWorkspaceId: member,
            sourceRoutingRef: remote ? route(member) : null, filePath: relative, side: 'working-tree' });
        expect(pointer.revision).toBeUndefined();
        expect(text).toContain('read the current file at path');
        expect(validateSessionContextAttachmentsForSend({ featureEnabled: true, activeWorkspaceId: WS,
            activeRoutingRef: remote ? route(WS) : null, items: attached.items, canRetrieveConversations: false })).toBeNull();
        expect(state.reads).toContainEqual([member, remote ? 'https://one.example' : undefined]);
        fireEvent.click(row);
        expect(navigate).toHaveBeenCalledWith(`${ROOT}/${relative}`, 'unstaged', ...(view === 'all' ? ['first'] : []));
        fireEvent.drop(target(), { dataTransfer });
        expect(attached.items).toHaveLength(1);
        expect(screen.getByTestId('follow-up-session-context-error').textContent).toContain('already attached');
        fireEvent.click(screen.getByTestId('attached-context-remove'));
        expect(attached.items).toHaveLength(0);
    });

    it('uses the disk path for staged, unstaged, untracked, rename and conflict rows; disables deletions', async () => {
        await setup(view, { changes: [
            change({ stage: 'staged' }), change(),
            change({ filePath: '/repo/new.ts', stage: 'untracked', status: '?' }),
            change({ filePath: '/repo/renamed.ts', originalPath: '/repo/original.ts', oldPath: '/repo/original.ts', status: 'R100' }),
            change({ filePath: '/repo/conflict.ts', status: 'U' }),
            change({ filePath: '/repo/gone.ts', status: 'D' }),
        ] });
        const list = rows(view);
        const gone = list.find(row => row.textContent?.includes('gone.ts'))!;
        expect(gone.getAttribute('draggable')).toBe('false');
        expect(drag(gone).types).toEqual([]);
        for (const [fragment, path] of [['new.ts', 'new.ts'], ['renamed.ts', 'renamed.ts'], ['conflict.ts', 'conflict.ts']]) {
            fireEvent.drop(target(), { dataTransfer: drag(list.find(row => row.textContent?.includes(fragment))!) });
            expect(attached.items.at(-1)).toMatchObject({ side: 'working-tree', filePath: path });
        }
        expect(attached.items).toHaveLength(3);
        fireEvent.drop(target(), { dataTransfer: drag(list.find(row => row.textContent?.includes('index.ts'))!) });
        expect(screen.getByTestId('follow-up-session-context-error').textContent).toContain('up to 3');
        act(() => attached.clear());
        const repeated = list.filter(row => row.textContent?.includes('index.ts'));
        expect(repeated).toHaveLength(2);
        for (const row of repeated) fireEvent.drop(target(), { dataTransfer: drag(row) });
        expect(attached.items).toHaveLength(1); // Both rows reference the same current disk file.
    });

    it('does not rebase a different repository root into the source workspace', async () => {
        await setup(view, { changes: [change({ filePath: '/other/src/index.ts', repositoryRoot: '/other', repositoryName: 'other' })] });
        expect(rows(view)[0].getAttribute('draggable')).toBe('false');
        expect(drag(rows(view)[0]).types).toEqual([]);
    });

    it('normalizes Windows paths and preserves a nested repository path relative to the workspace', async () => {
        await setup(view, { repoRoot: 'C:\\repo', changes: [change({ filePath: 'C:\\repo\\nested\\src\\index.ts', repositoryRoot: 'C:\\repo\\nested' })] });
        fireEvent.drop(target(), { dataTransfer: drag(rows(view)[0]) });
        expect(attached.items[0]).toMatchObject({ filePath: 'nested/src/index.ts', sourceWorkspaceId: member });
    });

    it('rejects cross-server drops and unavailable owners without adding context', async () => {
        await setup(view, { remote: true, sourceOwner: route(member, 'two') });
        fireEvent.drop(target(), { dataTransfer: drag(rows(view)[0]) });
        expect(attached.items).toHaveLength(0);
        expect(screen.getByTestId('follow-up-session-context-error').textContent).toContain('owning server');
        cleanup();
        await setup(view, { sourceOwner: route(member, 'missing') });
        if (view === 'all') expect(screen.getByRole('alert').textContent).toContain('unavailable');
        else expect(drag(rows(view)[0]).types).toEqual([]);
    });

    it('revalidates owner availability and the context feature before send', async () => {
        await setup(view, { remote: true });
        fireEvent.drop(target(), { dataTransfer: drag(rows(view)[0]) });
        expect(validateSessionContextAttachmentsForSend({ featureEnabled: false, activeWorkspaceId: WS,
            activeRoutingRef: route(WS), items: attached.items, canRetrieveConversations: false })).toContain('disabled');
        act(() => registerCloneBaseUrls([]));
        expect(validateSessionContextAttachmentsForSend({ featureEnabled: true, activeWorkspaceId: WS,
            activeRoutingRef: route(WS), items: attached.items, canRetrieveConversations: false })).toContain('unavailable');
    });

    it('keeps the producer behind the existing attachment gate', async () => {
        flags.enabled = false;
        await setup(view);
        expect(rows(view)[0].getAttribute('draggable')).toBe('false');
        expect(drag(rows(view)[0]).types).toEqual([]);
    });
});

describe('unavailable working-change sources', () => {
    it('disables a retained dirty row removed by status refresh', async () => {
        state.changes = [change()];
        const props = { workspaceId: member, attachmentDestinationId: member, repoRoot: ROOT };
        const view = render(<WorkingTreeAllFilesDiff {...props} refreshKey={0} />);
        await act(async () => {});
        expect(rows('all')[0].getAttribute('draggable')).toBe('true');
        fireEvent.click(screen.getByTestId('working-diff'));
        state.changes = [];
        await act(async () => { view.rerender(<WorkingTreeAllFilesDiff {...props} refreshKey={1} />); });
        expect(rows('all')).toHaveLength(1);
        expect(rows('all')[0].getAttribute('draggable')).toBe('false');
        expect(drag(rows('all')[0]).types).toEqual([]);
    });

    it('does not guess an absolute path owner when the workspace root is unavailable', async () => {
        state.changes = [change()];
        render(<WorkingTree workspaceId={member} attachmentDestinationId={member} />);
        await act(async () => {});
        expect(drag(rows('flat')[0]).types).toEqual([]);
    });
});
