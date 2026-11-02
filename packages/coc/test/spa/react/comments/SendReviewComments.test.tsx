import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef, useState } from 'react';
import { CommentSidebar } from '../../../../src/server/spa/client/react/tasks/comments/CommentSidebar';
import { useSendReviewComments } from '../../../../src/server/spa/client/react/features/git/hooks/useSendReviewComments';
import { useSendMessage } from '../../../../src/server/spa/client/react/features/chat/hooks/useSendMessage';
import { useCurrentChatSend, usePublishCurrentChatSend } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/currentChatSend';
import { UnifiedPanelHostProvider, useUnifiedPanelHostForChat, type UnifiedPanelHost } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelHost';
import { getCocClientFor } from '../../../../src/server/spa/client/react/api/cocClient';
import { registerCloneBaseUrls, setActiveCloneForRouting } from '../../../../src/server/spa/client/react/repos/cloneRegistry';
import type { DiffComment } from '../../../../src/server/spa/client/comments/diff-comment-types';
import type { DiffCommentPromptContext, ReviewCommentScope } from '../../../../src/server/spa/client/react/utils/diffCommentPrompt';
import { formatDiffCommentsPrompt, formatReviewCommentsPrompt } from '../../../../src/server/spa/client/react/utils/diffCommentPrompt';
import type { ChatMode } from '../../../../src/server/spa/client/react/repos/modeConfig';

vi.mock('../../../../src/server/spa/client/react/contexts/ChatPreferencesContext', () => ({
    useChatPrefs: () => ({ archivedChatIds: new Set(), unarchiveChat: vi.fn() }),
}));

const fetchMock = vi.fn();
const resolve = vi.fn();
const copy = vi.fn();
const clearContext = vi.fn();
const changeMode = vi.fn();
const noop = () => {};
const scope: ReviewCommentScope = { kind: 'commit', hash: 'abc1234' };
const comment: DiffComment = {
    id: 'c1', status: 'open', comment: 'Keep this text.\nAdd a regression test.',
    selectedText: 'const value = 1;',
    context: { repositoryId: 'ws-member', filePath: 'src/example.ts', oldRef: 'abc1234^', newRef: 'abc1234' },
    selection: { diffLineStart: 4, diffLineEnd: 5, side: 'added', newLineStart: 12, newLineEnd: 13, startColumn: 0, endColumn: 2 },
    createdAt: '', updatedAt: '',
};
const resolved: DiffComment = { ...comment, id: 'c2', status: 'resolved', comment: 'Already fixed.' };

function Chat({ taskId = 'chat-a', workspaceId = 'ws-chat', baseUrl, disabledReason, active = false, mode = 'autopilot' }: {
    taskId?: string; workspaceId?: string; baseUrl?: string; disabledReason?: string; active?: boolean; mode?: ChatMode;
}) {
    const host = useUnifiedPanelHostForChat(taskId);
    const [draft, setDraft] = useState('Unsent composer draft');
    const [selectedMode, setMode] = useState(mode);
    const draftRef = useRef(draft);
    draftRef.current = draft;
    const failed = useRef('');
    const selectedModeRef = useRef(selectedMode);
    selectedModeRef.current = selectedMode;
    const { sendFollowUp } = useSendMessage({
        processId: taskId, taskId, workspaceId, owningWorkspaceId: workspaceId,
        messageClient: getCocClientFor(baseUrl),
        inputDisabled: !!disabledReason, sending: false, isActiveGeneration: active,
        setSending: noop, setError: noop, setSessionExpired: noop, setSuggestions: noop,
        setTurnsAndRef: noop, removeStreamingPlaceholder: noop,
        refreshConversation: async () => {}, queueDispatch: noop,
        slashCommands: { parseAndExtract: () => ({ skills: [], prompt: '', metaCommands: [] }), dismissMenu: noop },
        followUpInputRef: draftRef, setFollowUpInput: setDraft, selectedMode, selectedModeRef,
        images: ['unsent-image'], clearImages: clearContext, clearPaste: clearContext,
        getPastedContent: () => 'Unsent paste', getAttachedContext: () => [], clearAttachedContext: clearContext,
        lastFailedMessageRef: failed, setTask: noop,
        activeProvider: 'codex', providerOverride: 'codex', modelOverride: 'test-model', effortOverride: 'high',
    });
    usePublishCurrentChatSend(host, {
        disabledReason,
        requiresAutopilotConfirmation: selectedMode === 'ask',
        targetKey: JSON.stringify([taskId, workspaceId, selectedMode]),
        send: (message, switchToAutopilot) => {
            if (switchToAutopilot) { changeMode('autopilot'); setMode('autopilot'); }
            return sendFollowUp(message, 'enqueue', {
                includeComposerContext: false, throwOnError: true, waitForCompletion: false,
                ...(switchToAutopilot ? { modeOverride: 'autopilot' as const } : {}),
            });
        },
    }, baseUrl);
    return <>
        <textarea aria-label={`Draft ${taskId}`} value={draft} onChange={e => setDraft(e.target.value)} />
        <span data-testid={`mode-${taskId}`}>{selectedMode}</span>
    </>;
}

function Comments({ comments = [comment, resolved], reviewScope = scope }: {
    comments?: DiffComment[]; reviewScope?: ReviewCommentScope | DiffCommentPromptContext;
}) {
    const send = useSendReviewComments('ws-member', comments, reviewScope);
    return <CommentSidebar comments={comments} loading={false} groupByFile
        onResolve={resolve} onUnresolve={noop} onDelete={noop} onEdit={noop}
        onAskAI={noop} onCommentClick={noop} onCopyPrompt={copy} {...send} />;
}

const localHost: UnifiedPanelHost = { workspaceId: 'ws-chat', chatId: 'chat-a' };
const button = () => screen.getByRole('button', { name: 'Send comments to current chat' });

beforeEach(() => {
    vi.clearAllMocks();
    registerCloneBaseUrls([]);
    setActiveCloneForRouting(null);
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
});
afterEach(() => { cleanup(); registerCloneBaseUrls([]); vi.unstubAllGlobals(); });

describe('sending Git review comments to the current chat', () => {
    it.each([false, true])('dispatches through the existing follow-up flow (busy=%s) without consuming drafts or resolving comments', async active => {
        render(<UnifiedPanelHostProvider host={localHost}>
            <Chat active={active} mode="autopilot" /><Comments />
        </UnifiedPanelHostProvider>);
        await act(async () => { fireEvent.click(button()); });
        expect(fetchMock).toHaveBeenCalledOnce();
        const [url, options] = fetchMock.mock.calls[0];
        expect(url).toContain('/processes/chat-a/message?workspace=ws-chat');
        const body = JSON.parse(options.body);
        expect(body).toMatchObject({
            content: `Repository workspace: ws-member\n\n${formatReviewCommentsPrompt(scope, [comment, resolved])}`,
            deliveryMode: 'enqueue', mode: 'autopilot', provider: 'codex', model: 'test-model',
        });
        expect(body.content).toContain('Location: new lines 12');
        expect(body.content).toContain('abc1234');
        expect(body.content).toContain(comment.comment);
        expect(JSON.stringify(body)).not.toContain('Unsent');
        expect(JSON.stringify(body)).not.toContain('unsent-image');
        expect(screen.getByLabelText('Draft chat-a')).toHaveValue('Unsent composer draft');
        expect(clearContext).not.toHaveBeenCalled();
        expect(resolve).not.toHaveBeenCalled();
        expect(comment.status).toBe('open');
        expect(resolved.status).toBe('resolved');
        expect(screen.queryByTestId('resolve-all-ai-btn')).toBeNull();
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(changeMode).not.toHaveBeenCalled();
        expect(screen.getByRole('status')).toHaveTextContent('Comments sent');
        fireEvent.click(screen.getByTestId('copy-prompt-btn'));
        expect(copy).toHaveBeenCalledOnce();
    });

    it('uses the exact remote group member conversation despite a conflicting active clone', async () => {
        registerCloneBaseUrls(['server-a', 'server-b'].flatMap(serverId =>
            ['group-review', 'ws-chat'].map(workspaceId => ({
                workspaceId, serverId, baseUrl: `https://${serverId}.example`,
            }))));
        setActiveCloneForRouting('remote:server-b:ws-chat');
        const host = { workspaceId: 'group-review', routingRef: 'remote:server-a:group-review', chatId: 'chat-a' };
        render(<UnifiedPanelHostProvider host={host}>
            <Chat baseUrl="https://server-a.example" /><Comments />
        </UnifiedPanelHostProvider>);
        await act(async () => { fireEvent.click(button()); });
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(fetchMock.mock.calls[0][0]).toBe('https://server-a.example/api/processes/chat-a/message?workspace=ws-chat');
    });

    it('follows the selected chat, not another mounted chat or the review chat', async () => {
        const tree = (chatId: string) => <UnifiedPanelHostProvider host={{ ...localHost, chatId }}>
            <Chat /><Chat taskId="chat-b" /><Comments />
        </UnifiedPanelHostProvider>;
        const { rerender } = render(tree('chat-a'));
        rerender(tree('chat-b'));
        await act(async () => { fireEvent.click(button()); });
        expect(fetchMock.mock.calls[0][0]).toContain('/processes/chat-b/message');
        expect(screen.getByLabelText('Draft chat-a')).toHaveValue('Unsent composer draft');
    });

    it.each([
        [null, undefined, 'Open a chat'],
        [{ ...localHost, chatId: null }, undefined, 'Open a chat'],
        [localHost, 'This chat is read-only.', 'read-only'],
        [localHost, 'Wait for compaction.', 'compaction'],
    ] as const)('explains unavailable sending without fallback (%j)', (host, disabledReason, text) => {
        render(<UnifiedPanelHostProvider host={host}>
            <Chat disabledReason={disabledReason} /><Comments />
        </UnifiedPanelHostProvider>);
        expect(button()).toBeDisabled();
        expect(screen.getByRole('status')).toHaveTextContent(text);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('does not use a mounted chat from a different panel owner', () => {
        render(<>
            <UnifiedPanelHostProvider host={localHost}><Chat /></UnifiedPanelHostProvider>
            <UnifiedPanelHostProvider host={{ ...localHost, workspaceId: 'other-workspace' }}><Comments /></UnifiedPanelHostProvider>
        </>);
        expect(button()).toBeDisabled();
        expect(screen.getByRole('status')).toHaveTextContent('unavailable');
    });

    it('disables unresolved remote owners even with a same-id local chat', () => {
        render(<UnifiedPanelHostProvider host={{ ...localHost, routingRef: 'remote:missing:ws-chat' }}>
            <Chat /><Comments />
        </UnifiedPanelHostProvider>);
        expect(button()).toBeDisabled();
        expect(screen.getByRole('status')).toHaveTextContent('server is unavailable');
    });

    it.each([{ comments: [] }, { comments: [resolved] }])('explains when there are no sendable comments', ({ comments }) => {
        render(<UnifiedPanelHostProvider host={localHost}><Chat /><Comments comments={comments} /></UnifiedPanelHostProvider>);
        expect(button()).toBeDisabled();
        expect(screen.getByRole('status')).toHaveTextContent('No unresolved comments');
    });

    it.each([false, true])('shows errors, preserves resolution and prevents duplicate in-flight submissions (busy=%s)', async active => {
        let reject!: (error: Error) => void;
        fetchMock.mockImplementationOnce(() => new Promise((_resolve, rejectSend) => { reject = rejectSend; }));
        render(<UnifiedPanelHostProvider host={localHost}><Chat active={active} /><Comments /></UnifiedPanelHostProvider>);
        fireEvent.click(button());
        fireEvent.click(button());
        await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
        expect(button()).toBeDisabled();
        fireEvent.change(screen.getByLabelText('Draft chat-a'), { target: { value: 'Updated unsent draft' } });
        await act(async () => { reject(new Error('Send failed')); });
        expect(screen.getByRole('alert')).toHaveTextContent('request failed before receiving a response');
        expect(button()).not.toBeDisabled();
        expect(resolve).not.toHaveBeenCalled();
        expect(screen.getByLabelText('Draft chat-a')).toHaveValue('Updated unsent draft');
        await act(async () => { fireEvent.click(button()); });
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(screen.getByRole('status')).toHaveTextContent('Comments sent');
    });

    it.each<ReviewCommentScope>([{ kind: 'working-tree' }, { kind: 'branch-range', label: 'main..topic' }])('keeps the existing %j review context', async reviewScope => {
        render(<UnifiedPanelHostProvider host={localHost}><Chat /><Comments reviewScope={reviewScope} /></UnifiedPanelHostProvider>);
        await act(async () => { fireEvent.click(button()); });
        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.content).toContain(formatReviewCommentsPrompt(reviewScope, [comment, resolved]));
    });

    it('uses the single-file copy formatter with the file refs and diff-line range', async () => {
        render(<UnifiedPanelHostProvider host={localHost}><Chat /><Comments reviewScope={comment.context} /></UnifiedPanelHostProvider>);
        await act(async () => { fireEvent.click(button()); });
        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.content).toBe(`Repository workspace: ws-member\n\n${formatDiffCommentsPrompt(comment.context, [comment])}`);
        expect(body.content).not.toContain(resolved.comment);
    });

    it.each([
        { active: false, remote: false }, { active: true, remote: false },
        { active: false, remote: true }, { active: true, remote: true },
    ])('asks before switching Ask to Autopilot and dispatches only after confirmation (%j)', async ({ active, remote }) => {
        if (remote) {
            registerCloneBaseUrls(['server-a', 'server-b'].flatMap(serverId =>
                ['group-review', 'ws-chat'].map(workspaceId => ({ workspaceId, serverId, baseUrl: `https://${serverId}.example` }))));
            setActiveCloneForRouting('remote:server-b:ws-chat');
        }
        const host = remote ? { workspaceId: 'group-review', routingRef: 'remote:server-a:group-review', chatId: 'chat-a' } : localHost;
        render(<UnifiedPanelHostProvider host={host}><Chat mode="ask" active={active} baseUrl={remote ? 'https://server-a.example' : undefined} /><Comments /></UnifiedPanelHostProvider>);
        fireEvent.click(button());
        expect(screen.getByRole('dialog')).toHaveTextContent('Autopilot, which can modify files');
        expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
        expect(fetchMock).not.toHaveBeenCalled();
        expect(changeMode).not.toHaveBeenCalled();
        expect(screen.getByTestId('mode-chat-a')).toHaveTextContent('ask');
        const confirmButton = screen.getByRole('button', { name: 'Switch to Autopilot and send' });
        await act(async () => { fireEvent.click(confirmButton); fireEvent.click(confirmButton); });
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(changeMode).toHaveBeenCalledExactlyOnceWith('autopilot');
        expect(screen.getByTestId('mode-chat-a')).toHaveTextContent('autopilot');
        const [url, options] = fetchMock.mock.calls[0];
        expect(url).toContain('/processes/chat-a/message?workspace=ws-chat');
        if (remote) expect(url).toBe('https://server-a.example/api/processes/chat-a/message?workspace=ws-chat');
        expect(JSON.parse(options.body)).toMatchObject({
            mode: 'autopilot', provider: 'codex', deliveryMode: 'enqueue', model: 'test-model', reasoningEffort: 'high',
        });
        expect(screen.getByLabelText('Draft chat-a')).toHaveValue('Unsent composer draft');
        expect(clearContext).not.toHaveBeenCalled();
        expect(resolve).not.toHaveBeenCalled();
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it.each(['Cancel', 'Escape', 'Close', 'backdrop'])('cancels Ask confirmation with %s without sending or switching mode', async dismiss => {
        render(<UnifiedPanelHostProvider host={localHost}><Chat mode="ask" /><Comments /></UnifiedPanelHostProvider>);
        fireEvent.click(button());
        expect(screen.getByRole('dialog')).toBeTruthy();
        if (dismiss === 'Escape') fireEvent.keyDown(document, { key: 'Escape' });
        else if (dismiss === 'backdrop') fireEvent.click(screen.getByTestId('dialog-overlay'));
        else fireEvent.click(screen.getByRole('button', { name: dismiss }));
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
        expect(changeMode).not.toHaveBeenCalled();
        expect(screen.getByTestId('mode-chat-a')).toHaveTextContent('ask');
        expect(screen.getByLabelText('Draft chat-a')).toHaveValue('Unsent composer draft');
        expect(screen.queryByText('Comments sent to the open chat.')).toBeNull();
    });

    it('never applies an Ask confirmation to a newly selected chat', async () => {
        const tree = (chatId: string) => <UnifiedPanelHostProvider host={{ ...localHost, chatId }}>
            <Chat taskId="chat-a" mode="ask" /><Chat taskId="chat-b" /><Comments />
        </UnifiedPanelHostProvider>;
        const { rerender } = render(tree('chat-a'));
        fireEvent.click(button());
        rerender(tree('chat-b'));
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Switch to Autopilot and send' })); });
        expect(fetchMock).not.toHaveBeenCalled();
        expect(changeMode).not.toHaveBeenCalled();
        expect(screen.getByRole('alert')).toHaveTextContent('open chat changed');
        expect(screen.getByTestId('mode-chat-a')).toHaveTextContent('ask');
        expect(screen.getByTestId('mode-chat-b')).toHaveTextContent('autopilot');
    });

    it('revalidates busy/read-only restrictions while the confirmation is open', () => {
        const tree = (disabledReason?: string) => <UnifiedPanelHostProvider host={localHost}>
            <Chat mode="ask" disabledReason={disabledReason} /><Comments />
        </UnifiedPanelHostProvider>;
        const { rerender } = render(tree());
        fireEvent.click(button());
        rerender(tree('This chat is read-only.'));
        expect(screen.getByRole('button', { name: 'Switch to Autopilot and send' })).toBeDisabled();
        expect(fetchMock).not.toHaveBeenCalled();
        expect(changeMode).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(screen.getByTestId('mode-chat-a')).toHaveTextContent('ask');
    });

    it('requires consent even if a caller bypasses the confirmation UI', async () => {
        let captured: ReturnType<typeof useCurrentChatSend> | undefined;
        function Capture() { captured = useCurrentChatSend(); return null; }
        render(<UnifiedPanelHostProvider host={localHost}><Chat mode="ask" /><Capture /></UnifiedPanelHostProvider>);
        await expect(captured!.send('Review comments')).rejects.toThrow('Confirm switching');
        expect(fetchMock).not.toHaveBeenCalled();
        expect(changeMode).not.toHaveBeenCalled();
    });

    it('revokes an Ask confirmation when the server endpoint is replaced', async () => {
        registerCloneBaseUrls([{ workspaceId: 'ws-chat', serverId: 'server-a', baseUrl: 'https://first.example' }]);
        const host = { ...localHost, routingRef: 'remote:server-a:ws-chat' };
        const tree = (baseUrl: string) => <UnifiedPanelHostProvider host={host}>
            <Chat mode="ask" baseUrl={baseUrl} /><Comments />
        </UnifiedPanelHostProvider>;
        const { rerender } = render(tree('https://first.example'));
        fireEvent.click(button());
        act(() => { registerCloneBaseUrls([{ workspaceId: 'ws-chat', serverId: 'server-a', baseUrl: 'https://replacement.example' }]); });
        rerender(tree('https://replacement.example'));
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Switch to Autopilot and send' })); });
        expect(fetchMock).not.toHaveBeenCalled();
        expect(changeMode).not.toHaveBeenCalled();
        expect(screen.getByRole('alert')).toHaveTextContent('open chat changed');
    });

    it('revokes an Ask confirmation when hydrated conversation/provider binding changes', async () => {
        const send = vi.fn().mockResolvedValue(undefined);
        function Sender({ targetKey }: { targetKey: string }) {
            usePublishCurrentChatSend(useUnifiedPanelHostForChat('chat-a'), {
                requiresAutopilotConfirmation: true, targetKey, send,
            });
            return null;
        }
        const tree = (targetKey: string) => <UnifiedPanelHostProvider host={localHost}>
            <Sender targetKey={targetKey} /><Comments />
        </UnifiedPanelHostProvider>;
        const { rerender } = render(tree('original-binding'));
        fireEvent.click(button());
        rerender(tree('replacement-binding'));
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Switch to Autopilot and send' })); });
        expect(send).not.toHaveBeenCalled();
        expect(screen.getByRole('alert')).toHaveTextContent('open chat changed');
    });

    it('rejects a stale captured sender after the current conversation changes', async () => {
        let captured: ReturnType<typeof useCurrentChatSend> | undefined;
        function Capture() { captured = useCurrentChatSend(); return null; }
        const tree = (chatId: string) => <UnifiedPanelHostProvider host={{ ...localHost, chatId }}>
            <Chat taskId={chatId} /><Capture />
        </UnifiedPanelHostProvider>;
        const { rerender } = render(tree('chat-a'));
        const old = captured!;
        rerender(tree('chat-b'));
        await expect(old.send('stale message')).rejects.toThrow('open chat changed');
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
