/* @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent, cleanup } from '@testing-library/react';
import React, { createRef } from 'react';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { tracker, flags } = vi.hoisted(() => ({
    flags: { enabled: true },
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
}));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        preferences: {
            getLlmToolsConfig: vi.fn().mockResolvedValue({
                tools: [],
                disabledLlmTools: [],
                conversationRetrievalAvailable: true,
            }),
        },
    }),
}));

import { FollowUpInputArea } from '../../../../src/server/spa/client/react/features/chat/FollowUpInputArea';
import type { FollowUpInputAreaProps } from '../../../../src/server/spa/client/react/features/chat/FollowUpInputArea';
import type { RichTextInputHandle } from '../../../../src/server/spa/client/react/shared/RichTextInput';
import { GitFileReview } from '../../../../src/server/spa/client/react/features/git/diff/GitFileReview';
import { createCommitDiffSource, createBranchRangeDiffSource } from '../../../../src/server/spa/client/react/features/git/diff/diffSource';
import { useAttachedContext, formatAttachedContext, parseAttachedSessionContextBlocks } from '../../../../src/server/spa/client/react/features/chat/hooks/useAttachedContext';
import { validateSessionContextAttachmentsForSend } from '../../../../src/server/spa/client/react/features/chat/sessionContextDrop';
import { buildRemoteCloneKey } from '../../../../src/server/spa/client/react/repos/cloneIdentity';
import { registerCloneBaseUrls, resetCloneRegistryForTests } from '../../../../src/server/spa/client/react/repos/cloneRegistry';
import { WorkspaceOwnerContext } from '../../../../src/server/spa/client/react/repos/workspaceOwnerContext';

vi.mock('../../../../src/server/spa/client/react/features/git/diff/FileDiffPanel', () => ({ FileDiffPanel: () => null }));
const WS = 'ws-1';
const hash = 'a'.repeat(40), base = 'b'.repeat(40);
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
function Composer({ remote = false, disabled = false }: { remote?: boolean; disabled?: boolean }) {
    attached = useAttachedContext();
    return <FollowUpInputArea {...makeProps({
        inputDisabled: disabled, sessionContextAttachmentsEnabled: flags.enabled,
        canRetrieveConversations: false, workspaceId: WS, attachmentDestinationId: remote ? route(WS) : WS,
        attachedContext: attached.items, getAttachedContext: attached.getItems,
        onAttachSessionContext: attached.addSessionContext, onRemoveAttachedContext: attached.remove,
    })} />;
}
function drag(path: string) {
    const dataTransfer = makeDataTransfer();
    const row = document.querySelector(`[data-file-path="${path}"]`)!;
    fireEvent.dragStart(row, { dataTransfer });
    return dataTransfer;
}
async function setup({ remote = false, path = 'src/index.ts', status = 'M', oldPath, range = false, sourceOwner, commitHash = hash }: {
    remote?: boolean; path?: string; status?: string; oldPath?: string; range?: boolean; sourceOwner?: string; commitHash?: string;
} = {}) {
    registerCloneBaseUrls(['one', 'two'].flatMap(serverId => [member, WS].map(workspaceId => ({
        workspaceId, serverId, baseUrl: `https://${serverId}.example`,
    }))));
    const owner = sourceOwner ?? (remote ? route(member) : member);
    const source = range ? createBranchRangeDiffSource(member, {
        routingTarget: remote ? owner : null,
        range: { baseRef: 'main', headRef: 'feature', mergeBase: base, headSha: hash },
    }) : createCommitDiffSource(member, commitHash, { routingTarget: remote ? owner : null });
    const onSelect = vi.fn();
    await act(async () => { render(<>
        <WorkspaceOwnerContext.Provider value={{ workspaceId: member, selectionId: owner }}>
            <GitFileReview workspaceId={member} comparisonKey={hash} source={source}
                files={[{ path, status, ...(oldPath ? { oldPath } : {}) }]} onSelect={onSelect} />
        </WorkspaceOwnerContext.Provider>
        <Composer remote={remote} />
    </>); });
    return { onSelect, source };
}
beforeEach(() => { flags.enabled = true; tracker.calls = []; tracker.domValue = 'Explain '; });
afterEach(() => { cleanup(); resetCloneRegistryForTests(); vi.clearAllMocks(); });

describe('changed-files sidebar → follow-up composer', () => {
    it.each([false, true])('retains concrete member and owner through drag/drop/send (remote=%s)', async remote => {
        await setup({ remote });
        tracker.calls = [];
        const dataTransfer = drag('src/index.ts');
        expect(dataTransfer.effectAllowed).toBe('copy');
        const target = screen.getByTestId('chat-input-bar');
        fireEvent.dragOver(target, { dataTransfer });
        expect(dataTransfer.dropEffect).toBe('copy');
        expect(screen.getByTestId('session-context-drop-hint')).toBeTruthy();
        fireEvent.drop(target, { dataTransfer });
        expect(screen.getByTestId('attached-git-file-context-chip').textContent).toContain('src/index.ts');
        expect(tracker.calls).toEqual([]); // Whole-file attachment, never bare path insertion.
        expect(validateSessionContextAttachmentsForSend({
            featureEnabled: true, activeWorkspaceId: WS, activeRoutingRef: remote ? route(WS) : null,
            canRetrieveConversations: false, items: attached.items,
        })).toBeNull();
        const text = formatAttachedContext(attached.items);
        expect(parseAttachedSessionContextBlocks(text).pointerContexts[0]).toMatchObject({
            kind: 'git-file', sourceWorkspaceId: member, sourceRoutingRef: remote ? route(member) : null,
            filePath: 'src/index.ts', revision: hash, side: 'head',
        });
        expect(text).toContain('Never substitute working-tree/index content');
        fireEvent.drop(target, { dataTransfer });
        expect(attached.items).toHaveLength(1);
        expect(screen.getByTestId('follow-up-session-context-error').textContent).toContain('already attached');
        fireEvent.click(screen.getByTestId('attached-context-remove'));
        expect(attached.items).toHaveLength(0);
    });

    it.each([
        ['D', undefined, false, `${hash}^`, 'src/gone.ts', 'base'],
        ['D', 'src/original.ts', true, base, 'src/original.ts', 'base'],
        ['R100', 'src/old.ts', false, hash, 'src/gone.ts', 'head'],
        ['A', undefined, true, hash, 'src/gone.ts', 'head'],
    ] as const)('uses reviewed %s side/path (range=%s)', async (status, oldPath, range, revision, filePath, side) => {
        await setup({ path: 'src/gone.ts', status, oldPath, range });
        fireEvent.drop(screen.getByTestId('chat-input-bar'), { dataTransfer: drag('src/gone.ts') });
        expect(attached.items[0]).toMatchObject({ kind: 'git-file', revision, filePath, side });
    });

    it('retrieves the whole historical, renamed and deleted file after the working tree changes', async () => {
        const root = mkdtempSync(join(tmpdir(), 'coc-reviewed-file-'));
        const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'core.autocrlf=false', ...args], { cwd: root, encoding: 'utf8' }).trim();
        try {
            git('init', '-q');
            mkdirSync(join(root, 'src'));
            const content = 'first line\nwhole file, including unchanged lines\nlast line\n';
            writeFileSync(join(root, 'src/index.ts'), content);
            git('add', '.'); git('commit', '-qm', 'initial');
            const original = git('rev-parse', 'HEAD');
            git('mv', 'src/index.ts', 'src/renamed.ts'); git('commit', '-qm', 'rename');
            const renamed = git('rev-parse', 'HEAD');
            git('rm', '-q', 'src/renamed.ts'); git('commit', '-qm', 'delete');
            const deleted = git('rev-parse', 'HEAD');
            mkdirSync(join(root, 'src'), { recursive: true });
            writeFileSync(join(root, 'src/index.ts'), 'unrelated working-tree content');
            writeFileSync(join(root, 'src/renamed.ts'), 'new untracked file at deleted path');
            for (const item of [
                { commitHash: original, path: 'src/index.ts', status: 'A' },
                { commitHash: renamed, path: 'src/renamed.ts', oldPath: 'src/index.ts', status: 'R100' },
                { commitHash: deleted, path: 'src/renamed.ts', status: 'D' },
            ]) {
                await setup(item);
                fireEvent.drop(screen.getByTestId('chat-input-bar'), { dataTransfer: drag(item.path) });
                const pointer = parseAttachedSessionContextBlocks(formatAttachedContext(attached.items)).pointerContexts[0];
                expect(git('show', `${pointer.revision}:${pointer.filePath}`)).toBe(content.trim());
                expect(pointer.sourceWorkspaceId).toBe(member);
                cleanup();
            }
        } finally { rmSync(root, { recursive: true, force: true }); }
    });

    it('keeps row navigation and native row drag preview', async () => {
        const { onSelect } = await setup();
        const row = document.querySelector('[data-file-path="src/index.ts"]')!;
        fireEvent.click(row);
        expect(onSelect).toHaveBeenLastCalledWith('src/index.ts', 'first');
        expect(row.getAttribute('draggable')).toBe('true');
        expect(row.className).toContain('git-review-file');
        expect(row.textContent).toContain('index.ts');
    });

    it('rejects another server and preserves remote source identity', async () => {
        await setup({ remote: true, sourceOwner: route(member, 'two') });
        fireEvent.drop(screen.getByTestId('chat-input-bar'), { dataTransfer: drag('src/index.ts') });
        expect(attached.items).toHaveLength(0);
        expect(screen.getByTestId('follow-up-session-context-error').textContent).toContain('owning server');
    });

    it('revalidates disconnected ownership before send', async () => {
        await setup({ remote: true });
        fireEvent.drop(screen.getByTestId('chat-input-bar'), { dataTransfer: drag('src/index.ts') });
        act(() => registerCloneBaseUrls([]));
        expect(validateSessionContextAttachmentsForSend({ featureEnabled: true, activeWorkspaceId: WS,
            activeRoutingRef: route(WS), canRetrieveConversations: false, items: attached.items })).toContain('unavailable');
    });

    it('retains the shared three-context cap', async () => {
        await setup();
        act(() => [1, 2, 3].forEach(i => attached.addSessionContext({
            kind: 'coc.git-file-context', version: 1, sourceWorkspaceId: member, sourceRoutingRef: null,
            filePath: `src/${i}.ts`, revision: hash, side: 'head', label: `${i}`,
        })));
        fireEvent.drop(screen.getByTestId('chat-input-bar'), { dataTransfer: drag('src/index.ts') });
        expect(attached.items).toHaveLength(3);
        expect(screen.getByTestId('follow-up-session-context-error').textContent).toContain('up to 3');
    });

    it.each(['short-commit', 'mutable-range', 'unknown-owner'])('offers no working-tree fallback for %s', async mode => {
        if (mode === 'unknown-owner') registerCloneBaseUrls([{ workspaceId: member, serverId: 'one', baseUrl: 'https://one.example' }]);
        const source = mode === 'mutable-range'
            ? createBranchRangeDiffSource(member, { range: { baseRef: 'main', headRef: 'feature' } })
            : createCommitDiffSource(member, mode === 'short-commit' ? 'abcdef1' : hash);
        await act(async () => { render(<GitFileReview workspaceId={member} comparisonKey="test"
            source={source} files={[{ path: 'src/index.ts', status: 'M' }]} />); });
        expect(document.querySelector('[data-file-path="src/index.ts"]')!.getAttribute('draggable')).toBe('false');
        expect(drag('src/index.ts').types).toEqual([]);
    });

    it('disables the producer with the context feature off', async () => {
        flags.enabled = false;
        await setup();
        expect(document.querySelector('[data-file-path="src/index.ts"]')!.getAttribute('draggable')).toBe('false');
        expect(drag('src/index.ts').types).toEqual([]);
    });
});
