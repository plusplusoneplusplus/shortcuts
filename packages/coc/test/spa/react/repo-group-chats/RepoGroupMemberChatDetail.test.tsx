/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useEffect, useState } from 'react';
import type { ChatDetailPaneProps } from '../../../../src/server/spa/client/react/features/chat/ChatDetailPane';
import { RepoGroupMemberChatDetail } from '../../../../src/server/spa/client/react/repos/RepoGroupMemberChatDetail';
import { parseRepoGroupChatDeepLink } from '../../../../src/server/spa/client/react/layout/dashboardRoutes';
import { useCocClient } from '../../../../src/server/spa/client/react/repos/cloneRouting';
import { WorkspaceOwnerContext } from '../../../../src/server/spa/client/react/repos/workspaceOwnerContext';
import { useChatPrefs } from '../../../../src/server/spa/client/react/contexts/ChatPreferencesContext';
import { useSendMessage } from '../../../../src/server/spa/client/react/features/chat/hooks/useSendMessage';
import { useChatSSE } from '../../../../src/server/spa/client/react/features/chat/hooks/useChatSSE';
import { useWarmClientStatus } from '../../../../src/server/spa/client/react/features/chat/hooks/useWarmClientStatus';
import { useQueuedTaskPoll } from '../../../../src/server/spa/client/react/queue/hooks/useQueuedTaskPoll';
import { getCocClientFor, getSpaCocClient, resetSpaCocClientForTests } from '../../../../src/server/spa/client/react/api/cocClient';
import { registerCloneBaseUrls, resetCloneRegistryForTests, setActiveCloneForRouting } from '../../../../src/server/spa/client/react/repos/cloneRegistry';
import { MobileWorkspacePaneProvider } from '../../../../src/server/spa/client/react/features/repo-detail/mobileWorkspacePane';

let taskStatus = 'completed';
const errors = vi.fn();

vi.mock('../../../../src/server/spa/client/react/features/chat/ChatDetailPane', () => ({
    ChatDetailPane: (props: ChatDetailPaneProps) => <DetailProbe {...props} />,
}));

class Stream {
    static instances: Stream[] = [];
    closed = false;
    constructor(public url: string) { Stream.instances.push(this); }
    addEventListener() {}
    close() { this.closed = true; }
}

function DetailProbe({ workspaceId, selectedTaskId }: ChatDetailPaneProps) {
    const client = useCocClient(workspaceId);
    const prefs = useChatPrefs();
    const [task, setTask] = useState({ status: taskStatus, id: selectedTaskId });
    useEffect(() => { void client.processes.get(selectedTaskId!); }, [client, selectedTaskId]);
    const send = useSendMessage({
        processId: selectedTaskId, taskId: selectedTaskId!, workspaceId, owningWorkspaceId: workspaceId,
        inputDisabled: false, sending: false, isActiveGeneration: true,
        setSending: vi.fn(), setError: errors, setSessionExpired: vi.fn(), setSuggestions: vi.fn(),
        setTurnsAndRef: vi.fn(), removeStreamingPlaceholder: vi.fn(), refreshConversation: vi.fn().mockResolvedValue(undefined),
        queueDispatch: vi.fn(), slashCommands: { parseAndExtract: text => ({ skills: [], prompt: text, metaCommands: [] }), dismissMenu: vi.fn() },
        followUpInputRef: { current: '' }, setFollowUpInput: vi.fn(), selectedMode: 'ask',
        selectedModeRef: { current: 'ask' }, images: [], clearImages: vi.fn(), clearPaste: vi.fn(),
        lastFailedMessageRef: { current: '' }, setTask,
    });
    useChatSSE({
        taskId: selectedTaskId!, task, processId: selectedTaskId, workspaceId, setTask,
        setIsStreaming: vi.fn(), setPendingQueue: vi.fn(), setSuggestions: vi.fn(),
        setSessionTokenLimit: vi.fn(), setSessionCurrentTokens: vi.fn(), setSessionSystemTokens: vi.fn(),
        setSessionToolTokens: vi.fn(), setSessionConversationTokens: vi.fn(), setBackgroundTasks: vi.fn(),
        setTurnsAndRef: vi.fn(), refreshConversation: vi.fn().mockResolvedValue(undefined), onSendComplete: vi.fn(),
    });
    useWarmClientStatus({ workspaceId, processId: selectedTaskId });
    useQueuedTaskPoll({ workspaceId, taskId: selectedTaskId!, task, setTask, setProcessDetails: vi.fn(), setTurnsAndRef: vi.fn() });
    return <div data-testid="detail-probe" data-status={task.status}>
        <button onClick={() => { void send.sendFollowUp('Owner follow-up'); }}>Send</button>
        <button onClick={() => { void prefs.setChatPinned(selectedTaskId!, true); }}>Pin</button>
    </div>;
}

function selection(group = 'remote:server-a:group-ai', owner = 'ws-member', id = 'queue_chat') {
    return parseRepoGroupChatDeepLink(`#repos/${encodeURIComponent(group)}/chats/member/${owner}/${id}`)!;
}

function stubClient(baseUrl?: string) {
    const client = baseUrl ? getCocClientFor(baseUrl) : getSpaCocClient();
    const get = vi.spyOn(client.processes, 'get').mockResolvedValue({ process: { id: 'queue_chat', status: 'completed' } } as never);
    const send = vi.spyOn(client.processes, 'sendMessage').mockResolvedValue({} as never);
    const pin = vi.spyOn(client.processes, 'pin').mockResolvedValue({} as never);
    const queue = vi.spyOn(client.queue, 'getTask').mockResolvedValue({ task: { id: 'chat', processId: 'queue_chat', status: 'completed' } } as never);
    return { client, get, send, pin, queue };
}

beforeEach(() => {
    taskStatus = 'completed';
    errors.mockReset();
    Stream.instances = [];
    resetCloneRegistryForTests();
    resetSpaCocClientForTests();
    vi.stubGlobal('EventSource', Stream);
});
afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetCloneRegistryForTests();
    resetSpaCocClientForTests();
});

describe('member conversation owner boundary', () => {
    it('routes reads, follow-ups, pin and warm streams to its group server despite colliding ids', async () => {
        registerCloneBaseUrls([
            { workspaceId: 'group-ai', serverId: 'server-a', baseUrl: 'https://owner.test' },
            { workspaceId: 'ws-member', serverId: 'server-b', baseUrl: 'https://wrong.test' },
        ]);
        setActiveCloneForRouting('remote:server-b:ws-member');
        const owner = stubClient('https://owner.test');
        const wrong = stubClient('https://wrong.test');
        const local = stubClient();
        render(<RepoGroupMemberChatDetail selection={selection()} serverLabel="Owner server" onBack={vi.fn()} />);
        expect(owner.get).toHaveBeenCalledWith('queue_chat');
        await act(async () => { fireEvent.click(screen.getByText('Send')); });
        await act(async () => { fireEvent.click(screen.getByText('Pin')); });
        expect(owner.send).toHaveBeenCalledWith('queue_chat', expect.objectContaining({ content: 'Owner follow-up' }), { workspace: 'ws-member' });
        expect(owner.pin).toHaveBeenCalledWith('queue_chat', true, { workspace: 'ws-member' });
        expect(Stream.instances[0].url).toBe('https://owner.test/api/processes/queue_chat/stream?workspace=ws-member&warm=1');
        expect(wrong.get).not.toHaveBeenCalled();
        expect(wrong.send).not.toHaveBeenCalled();
        expect(local.get).not.toHaveBeenCalled();
        expect(local.send).not.toHaveBeenCalled();
        expect(screen.getByTestId('repo-group-member-open-in-repo').getAttribute('href')).toBe('#repos/remote%3Aserver-a%3Aws-member/chats/queue_chat');
    });

    it('keeps explicit local ownership when a same-id remote clone is active', () => {
        registerCloneBaseUrls([{ workspaceId: 'ws-member', serverId: 'server-b', baseUrl: 'https://wrong.test' }]);
        setActiveCloneForRouting('remote:server-b:ws-member');
        const local = stubClient();
        const wrong = stubClient('https://wrong.test');
        render(<RepoGroupMemberChatDetail selection={selection('group-ai')} serverLabel="This server" onBack={vi.fn()} />);
        expect(local.get).toHaveBeenCalled();
        expect(wrong.get).not.toHaveBeenCalled();
    });

    it('does not mount transports for unresolved remote group ownership', () => {
        const local = stubClient();
        render(<RepoGroupMemberChatDetail selection={selection()} serverLabel="Owner server" onBack={vi.fn()} />);
        expect(screen.queryByTestId('detail-probe')).toBeNull();
        expect(screen.getByRole('status').textContent).toContain('unavailable');
        expect(local.get).not.toHaveBeenCalled();
        expect(Stream.instances).toHaveLength(0);
    });

    it('closes old running and warm streams on endpoint reassignment without losing selection', () => {
        taskStatus = 'running';
        registerCloneBaseUrls([{ workspaceId: 'group-ai', serverId: 'server-a', baseUrl: 'https://owner.test' }]);
        const oldOwner = stubClient('https://owner.test');
        const nextOwner = stubClient('https://next.test');
        render(<RepoGroupMemberChatDetail selection={selection()} serverLabel="Owner server" onBack={vi.fn()} />);
        expect(Stream.instances[0].url).toBe('https://owner.test/api/processes/queue_chat/stream?workspace=ws-member');
        const oldStreams = [...Stream.instances];
        act(() => registerCloneBaseUrls([{ workspaceId: 'group-ai', serverId: 'server-a', baseUrl: 'https://next.test' }]));
        expect(oldStreams.every(stream => stream.closed)).toBe(true);
        expect(nextOwner.get).toHaveBeenCalled();
        expect(oldOwner.get).toHaveBeenCalledTimes(1);
        expect(Stream.instances.slice(oldStreams.length).every(stream => stream.url.startsWith('https://next.test/'))).toBe(true);
        expect(screen.getByTestId('repo-group-member-open-in-repo').getAttribute('href')).toContain('server-a');
    });

    it('polls queued tasks and transition reads on the concrete owner, not the page origin', async () => {
        vi.useFakeTimers();
        taskStatus = 'queued';
        registerCloneBaseUrls([{ workspaceId: 'group-ai', serverId: 'server-a', baseUrl: 'https://owner.test' }]);
        const owner = stubClient('https://owner.test');
        const local = stubClient();
        render(<RepoGroupMemberChatDetail selection={selection()} serverLabel="Owner server" onBack={vi.fn()} />);
        await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
        expect(owner.queue).toHaveBeenCalledWith('chat');
        expect(owner.get).toHaveBeenCalledWith('queue_chat', { workspace: 'ws-member' });
        expect(screen.getByTestId('detail-probe').dataset.status).toBe('completed');
        expect(local.queue).not.toHaveBeenCalled();
    });

    it('pushes restored mobile member details and leaves Back to the group handler', () => {
        stubClient();
        const setPane = vi.fn();
        const setDetailOpen = vi.fn();
        const onBack = vi.fn();
        render(<MobileWorkspacePaneProvider value={{ pane: 'git', detailOpen: false, setPane, setDetailOpen }}>
            <RepoGroupMemberChatDetail selection={selection('group-ai')} serverLabel="This server" onBack={onBack} />
        </MobileWorkspacePaneProvider>);
        expect(setPane).toHaveBeenCalledWith('chat');
        expect(setDetailOpen).toHaveBeenCalledWith(true);
    });

    it('limits the owner override to the matching workspace subtree', () => {
        const owner = { workspaceId: 'ws-member', selectionId: 'remote:server-a:ws-member', baseUrl: 'https://owner.test' };
        let memberBaseUrl: string | undefined;
        let otherBaseUrl: string | undefined;
        function Probe() {
            memberBaseUrl = useCocClient('ws-member').options.baseUrl;
            otherBaseUrl = useCocClient('other').options.baseUrl;
            return null;
        }
        render(<WorkspaceOwnerContext.Provider value={owner}><Probe /></WorkspaceOwnerContext.Provider>);
        expect(memberBaseUrl).toBe('https://owner.test');
        expect(otherBaseUrl).not.toBe('https://owner.test');
    });
});
