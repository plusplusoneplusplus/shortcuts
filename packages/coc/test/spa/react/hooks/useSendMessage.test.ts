/**
 * Tests for useSendMessage — follow-up message sending, slash commands, error handling.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSendMessage } from '../../../../src/server/spa/client/react/features/chat/hooks/useSendMessage';
import type { UseSendMessageOptions } from '../../../../src/server/spa/client/react/features/chat/hooks/useSendMessage';

// ── Mocks ────────────────────────────────────────────────────────────

vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => '/api',
    isRalphEnabled: () => false,
}));

vi.mock('../../../../src/server/spa/client/react/features/chat/hooks/useDraftStore', () => ({
    clearDraft: vi.fn(),
}));

const mockUnarchiveChat = vi.fn();
let mockArchivedChatIds = new Set<string>();

vi.mock('../../../../src/server/spa/client/react/contexts/ChatPreferencesContext', () => ({
    ChatPrefsSync: () => null,
    useChatPrefs: () => ({
        archivedChatIds: mockArchivedChatIds,
        unarchiveChat: mockUnarchiveChat,
        pinnedChatIds: new Set<string>(),
        pinChat: vi.fn(),
        unpinChat: vi.fn(),
        archiveChat: vi.fn(),
    }),
}));

const fetchMock = vi.fn();
global.fetch = fetchMock as any;

/**
 * By setting EventSource to undefined, `waitForFollowUpCompletion` in useSendMessage
 * falls through to the simple `await refreshConversation(pid)` path, avoiding
 * the need to orchestrate an SSE mock for these unit tests.
 */
const origEventSource = (globalThis as any).EventSource;
function stubNoEventSource() { (globalThis as any).EventSource = undefined; }
function restoreEventSource() { (globalThis as any).EventSource = origEventSource; }

function makeOptions(overrides: Partial<UseSendMessageOptions> = {}): UseSendMessageOptions {
    const followUpInputRef = { current: '' };
    return {
        processId: 'pid-1',
        taskId: 'task-1',
        inputDisabled: false,
        sending: false,
        isActiveGeneration: false,
        setSending: vi.fn(),
        setError: vi.fn(),
        setSessionExpired: vi.fn(),
        setSuggestions: vi.fn(),
        setTurnsAndRef: vi.fn(),
        removeStreamingPlaceholder: vi.fn(),
        refreshConversation: vi.fn().mockResolvedValue(undefined),
        queueDispatch: vi.fn(),
        slashCommands: {
            parseAndExtract: vi.fn().mockReturnValue({ skills: [], prompt: '' }),
            dismissMenu: vi.fn(),
        },
        followUpInputRef,
        setFollowUpInput: vi.fn(),
        selectedMode: 'ask',
        selectedModeRef: { current: 'ask' },
        images: [],
        clearImages: vi.fn(),
        clearPaste: vi.fn(),
        lastFailedMessageRef: { current: '' },
        setTask: vi.fn(),
        ...overrides,
    };
}

describe('useSendMessage', () => {
    beforeEach(() => {
        fetchMock.mockReset();
        mockUnarchiveChat.mockReset();
        mockArchivedChatIds = new Set<string>();
        stubNoEventSource();
        vi.useFakeTimers();
    });

    afterEach(() => {
        restoreEventSource();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('returns early without fetch when inputDisabled is true', async () => {
        const opts = makeOptions({ inputDisabled: true });
        opts.followUpInputRef.current = 'hello';
        const { result } = renderHook(() => useSendMessage(opts));
        await act(async () => { await result.current.sendFollowUp(); });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns early without fetch when rawContent is empty', async () => {
        const opts = makeOptions();
        opts.followUpInputRef.current = '  ';
        const { result } = renderHook(() => useSendMessage(opts));
        await act(async () => { await result.current.sendFollowUp(); });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns early without fetch when processId is null', async () => {
        const opts = makeOptions({ processId: null });
        opts.followUpInputRef.current = 'hello';
        const { result } = renderHook(() => useSendMessage(opts));
        await act(async () => { await result.current.sendFollowUp(); });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('calls parseAndExtract on input', async () => {
        fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
        const parseAndExtract = vi.fn().mockReturnValue({ skills: [], prompt: 'hello' });
        const opts = makeOptions({
            slashCommands: { parseAndExtract, dismissMenu: vi.fn() },
        });
        opts.followUpInputRef.current = 'hello';

        const { result } = renderHook(() => useSendMessage(opts));
        await act(async () => {
            await result.current.sendFollowUp('hello');
        });
        expect(parseAndExtract).toHaveBeenCalledWith('hello');
    });

    it('calls clearDraft after initiating send', async () => {
        const { clearDraft } = await import(
            '../../../../src/server/spa/client/react/features/chat/hooks/useDraftStore'
        );
        fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
        const opts = makeOptions();
        opts.followUpInputRef.current = 'hello';

        const { result } = renderHook(() => useSendMessage(opts));
        await act(async () => {
            await result.current.sendFollowUp('hello');
        });
        expect(clearDraft).toHaveBeenCalledWith('task-1');
    });

    it('calls setError when API returns non-ok (non-410) response', async () => {
        const setError = vi.fn();
        fetchMock.mockResolvedValue({
            ok: false,
            status: 500,
            json: async () => ({ error: 'server error' }),
        });
        const opts = makeOptions({ setError });

        const { result } = renderHook(() => useSendMessage(opts));
        await act(async () => { await result.current.sendFollowUp('hello'); });
        expect(setError).toHaveBeenCalledWith(expect.stringContaining('server error'));
    });

    it('calls setSessionExpired(true) on 410 response', async () => {
        const setSessionExpired = vi.fn();
        const setError = vi.fn();
        fetchMock.mockResolvedValue({ ok: false, status: 410, json: async () => ({}) });
        const opts = makeOptions({ setSessionExpired, setError });

        const { result } = renderHook(() => useSendMessage(opts));
        await act(async () => { await result.current.sendFollowUp('hello'); });
        expect(setSessionExpired).toHaveBeenCalledWith(true);
    });

    it('sends to /message when active generation is running with immediate delivery', async () => {
        fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
        const opts = makeOptions({ isActiveGeneration: true });

        const { result } = renderHook(() => useSendMessage(opts));
        await act(async () => { await result.current.sendFollowUp('steer msg', 'immediate'); });

        expect(fetchMock).toHaveBeenCalled();
        const url = fetchMock.mock.calls[0][0] as string;
        expect(url).toContain('/processes/pid-1/message');
        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.deliveryMode).toBe('immediate');
    });

    it('sends to /message (not /pending-messages) when active generation is running with enqueue delivery', async () => {
        fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
        const opts = makeOptions({ isActiveGeneration: true });

        const { result } = renderHook(() => useSendMessage(opts));
        await act(async () => { await result.current.sendFollowUp('queued msg', 'enqueue'); });

        expect(fetchMock).toHaveBeenCalled();
        const url = fetchMock.mock.calls[0][0] as string;
        expect(url).toContain('/processes/pid-1/message');
        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.deliveryMode).toBe('enqueue');
    });

    it('calls setSending(true) when starting a fresh send', async () => {
        fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
        const setSending = vi.fn();
        const opts = makeOptions({ setSending });

        const { result } = renderHook(() => useSendMessage(opts));
        await act(async () => {
            await result.current.sendFollowUp('hello');
        });
        expect(setSending).toHaveBeenCalledWith(true);
    });

    it('ignores duplicate initial submit while local request is in flight', async () => {
        fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
        const setTurnsAndRef = vi.fn();
        const setSending = vi.fn();
        const opts = makeOptions({ sending: true, isActiveGeneration: false, setSending, setTurnsAndRef });

        const { result } = renderHook(() => useSendMessage(opts));
        await act(async () => { await result.current.sendFollowUp('hello'); });

        expect(fetchMock).not.toHaveBeenCalled();
        expect(setSending).not.toHaveBeenCalled();
        expect(setTurnsAndRef).not.toHaveBeenCalled();
    });

    it('auto-unarchives chat when sending a follow-up on an archived chat', async () => {
        mockArchivedChatIds = new Set(['task-1']);
        fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
        const opts = makeOptions();
        opts.followUpInputRef.current = 'hello';

        const { result } = renderHook(() => useSendMessage(opts));
        await act(async () => { await result.current.sendFollowUp(); });
        expect(mockUnarchiveChat).toHaveBeenCalledWith('task-1');
    });

    it('does not call unarchiveChat when the chat is not archived', async () => {
        mockArchivedChatIds = new Set<string>();
        fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
        const opts = makeOptions();
        opts.followUpInputRef.current = 'hello';

        const { result } = renderHook(() => useSendMessage(opts));
        await act(async () => { await result.current.sendFollowUp(); });
        expect(mockUnarchiveChat).not.toHaveBeenCalled();
    });

    it('calls setTask with status running after successful POST', async () => {
        fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
        const setTask = vi.fn();
        const opts = makeOptions({ setTask });
        opts.followUpInputRef.current = 'hello';

        const { result } = renderHook(() => useSendMessage(opts));
        await act(async () => { await result.current.sendFollowUp(); });
        expect(setTask).toHaveBeenCalled();
        const updater = setTask.mock.calls[0][0];
        expect(updater({ status: 'completed', id: '1' })).toEqual({ status: 'running', id: '1' });
    });

    it('does not call setTask on failed POST', async () => {
        fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'fail' }) });
        const setTask = vi.fn();
        const opts = makeOptions({ setTask });
        opts.followUpInputRef.current = 'hello';

        const { result } = renderHook(() => useSendMessage(opts));
        await act(async () => { await result.current.sendFollowUp(); });
        expect(setTask).not.toHaveBeenCalled();
    });

    it('calls refreshConversation in finally block after successful send', async () => {
        fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
        const refreshConversation = vi.fn().mockResolvedValue(undefined);
        const opts = makeOptions({ refreshConversation });
        opts.followUpInputRef.current = 'hello';

        const { result } = renderHook(() => useSendMessage(opts));
        await act(async () => { await result.current.sendFollowUp(); });
        expect(refreshConversation).toHaveBeenCalledWith('pid-1');
    });

    it('calls refreshConversation in finally block even after error', async () => {
        fetchMock.mockRejectedValue(new Error('network'));
        const refreshConversation = vi.fn().mockResolvedValue(undefined);
        const opts = makeOptions({ refreshConversation });
        opts.followUpInputRef.current = 'hello';

        const { result } = renderHook(() => useSendMessage(opts));
        await act(async () => { await result.current.sendFollowUp(); });
        expect(refreshConversation).toHaveBeenCalledWith('pid-1');
    });

    // ── Paste content composition tests ─────────────────────────────────

    it('composes user text with pasted content when getPastedContent returns a value', async () => {
        fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
        const opts = makeOptions({
            getPastedContent: () => 'PASTED_CONTENT',
        });
        opts.followUpInputRef.current = 'my question';

        const { result } = renderHook(() => useSendMessage(opts));
        await act(async () => { await result.current.sendFollowUp(); });

        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.content).toBe('my question\n\nPASTED_CONTENT');
    });

    it('sends only user text when getPastedContent returns null', async () => {
        fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
        const opts = makeOptions({
            getPastedContent: () => null,
        });
        opts.followUpInputRef.current = 'just a question';

        const { result } = renderHook(() => useSendMessage(opts));
        await act(async () => { await result.current.sendFollowUp(); });

        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.content).toBe('just a question');
    });

    it('sends only pasted content when user text is empty but paste exists', async () => {
        fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
        const opts = makeOptions({
            getPastedContent: () => 'PASTED_ONLY',
        });
        opts.followUpInputRef.current = '';

        const { result } = renderHook(() => useSendMessage(opts));
        await act(async () => { await result.current.sendFollowUp(); });

        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.content).toBe('PASTED_ONLY');
    });

    it('does nothing when both user text and pasted content are empty', async () => {
        fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
        const opts = makeOptions({
            getPastedContent: () => null,
        });
        opts.followUpInputRef.current = '';

        const { result } = renderHook(() => useSendMessage(opts));
        await act(async () => { await result.current.sendFollowUp(); });

        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('sends only user text when getPastedContent is not provided', async () => {
        fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
        const opts = makeOptions();
        opts.followUpInputRef.current = 'no paste getter';

        const { result } = renderHook(() => useSendMessage(opts));
        await act(async () => { await result.current.sendFollowUp(); });

        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.content).toBe('no paste getter');
    });

    it('clears paste state after successful compose-and-send', async () => {
        fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
        const clearPaste = vi.fn();
        const opts = makeOptions({
            getPastedContent: () => 'BIG_PASTE',
            clearPaste,
        });
        opts.followUpInputRef.current = 'question';

        const { result } = renderHook(() => useSendMessage(opts));
        await act(async () => { await result.current.sendFollowUp(); });

        expect(clearPaste).toHaveBeenCalled();
    });

    // ── Group 1: sendFollowUp while active generation is running, deliveryMode='immediate' ──

    describe('immediate steer (active generation, immediate)', () => {
        it('S1: fires POST to /message with deliveryMode=immediate', async () => {
            fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
            const opts = makeOptions({ isActiveGeneration: true });

            const { result } = renderHook(() => useSendMessage(opts));
            await act(async () => { await result.current.sendFollowUp('steer msg', 'immediate'); });

            expect(fetchMock).toHaveBeenCalled();
            const url = fetchMock.mock.calls[0][0] as string;
            expect(url).toContain('/processes/pid-1/message');
            const body = JSON.parse(fetchMock.mock.calls[0][1].body);
            expect(body.deliveryMode).toBe('immediate');
        });

        it('S2: does NOT call setSending(true) — fire-and-forget', async () => {
            fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
            const setSending = vi.fn();
            const opts = makeOptions({ isActiveGeneration: true, setSending });

            const { result } = renderHook(() => useSendMessage(opts));
            await act(async () => { await result.current.sendFollowUp('steer msg', 'immediate'); });

            expect(setSending).not.toHaveBeenCalled();
        });

        it('S3: adds optimistic user turn via setTurnsAndRef', async () => {
            fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
            const setTurnsAndRef = vi.fn();
            const opts = makeOptions({ isActiveGeneration: true, setTurnsAndRef });

            const { result } = renderHook(() => useSendMessage(opts));
            await act(async () => { await result.current.sendFollowUp('steer msg', 'immediate'); });

            expect(setTurnsAndRef).toHaveBeenCalled();
            const updater = setTurnsAndRef.mock.calls[0][0];
            const turns = updater([]);
            expect(turns).toHaveLength(1);
            expect(turns[0].role).toBe('user');
            expect(turns[0].content).toBe('steer msg');
        });

        it('S4: optimistic turn does NOT include assistant placeholder', async () => {
            fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
            const setTurnsAndRef = vi.fn();
            const opts = makeOptions({ isActiveGeneration: true, setTurnsAndRef });

            const { result } = renderHook(() => useSendMessage(opts));
            await act(async () => { await result.current.sendFollowUp('steer msg', 'immediate'); });

            const updater = setTurnsAndRef.mock.calls[0][0];
            const turns = updater([]);
            expect(turns.every((t: any) => t.role === 'user')).toBe(true);
        });

        it('S5: clears images and paste after sending', async () => {
            fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
            const clearImages = vi.fn();
            const clearPaste = vi.fn();
            const opts = makeOptions({ isActiveGeneration: true, clearImages, clearPaste });

            const { result } = renderHook(() => useSendMessage(opts));
            await act(async () => { await result.current.sendFollowUp('steer msg', 'immediate'); });

            expect(clearImages).toHaveBeenCalled();
            expect(clearPaste).toHaveBeenCalled();
        });
    });

    // ── Group 2: sendFollowUp while active generation is running, deliveryMode='enqueue' ──

    describe('enqueue while running (active generation, enqueue)', () => {
        it('E1: POSTs to /message (not /pending-messages) with deliveryMode=enqueue', async () => {
            fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
            const opts = makeOptions({ isActiveGeneration: true });

            const { result } = renderHook(() => useSendMessage(opts));
            await act(async () => { await result.current.sendFollowUp('queued msg', 'enqueue'); });

            expect(fetchMock).toHaveBeenCalled();
            const url = fetchMock.mock.calls[0][0] as string;
            expect(url).toContain('/processes/pid-1/message');
            expect(url).not.toContain('/pending-messages');
            const body = JSON.parse(fetchMock.mock.calls[0][1].body);
            expect(body.deliveryMode).toBe('enqueue');
        });

        it('E2: does NOT call setSending — server handles queuing', async () => {
            fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
            const setSending = vi.fn();
            const opts = makeOptions({ isActiveGeneration: true, setSending });

            const { result } = renderHook(() => useSendMessage(opts));
            await act(async () => { await result.current.sendFollowUp('queued msg', 'enqueue'); });

            expect(setSending).not.toHaveBeenCalled();
        });

        it('E3: does NOT add optimistic turns — waits for server confirmation', async () => {
            fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
            const setTurnsAndRef = vi.fn();
            const opts = makeOptions({ isActiveGeneration: true, setTurnsAndRef });

            const { result } = renderHook(() => useSendMessage(opts));
            await act(async () => { await result.current.sendFollowUp('queued msg', 'enqueue'); });

            expect(setTurnsAndRef).not.toHaveBeenCalled();
        });

        it('E4: clears images and paste after sending', async () => {
            fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
            const clearImages = vi.fn();
            const clearPaste = vi.fn();
            const opts = makeOptions({ isActiveGeneration: true, clearImages, clearPaste });

            const { result } = renderHook(() => useSendMessage(opts));
            await act(async () => { await result.current.sendFollowUp('queued msg', 'enqueue'); });

            expect(clearImages).toHaveBeenCalled();
            expect(clearPaste).toHaveBeenCalled();
        });
    });

    describe('attached context integration', () => {
        it('blocks session context sends when retrieval capability is unavailable', async () => {
            fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
            const setError = vi.fn();
            const clearAttachedContext = vi.fn();
            const opts = makeOptions({
                workspaceId: 'ws-1',
                sessionContextAttachmentsEnabled: true,
                conversationRetrievalAvailable: false,
                setError,
                clearAttachedContext,
                getAttachedContext: () => [{
                    kind: 'session',
                    id: 'ctx-session',
                    sourceWorkspaceId: 'ws-1',
                    sourceProcessId: 'source-proc',
                    title: 'Source session',
                    status: 'completed',
                    lastActivityAt: '2026-01-01T00:00:00.000Z',
                    preview: 'Source session · completed',
                }],
            });
            opts.followUpInputRef.current = 'my follow-up';

            const { result } = renderHook(() => useSendMessage(opts));
            await act(async () => { await result.current.sendFollowUp(); });

            expect(setError).toHaveBeenCalledWith('Conversation retrieval is not available for this chat.');
            expect(fetchMock).not.toHaveBeenCalled();
            expect(clearAttachedContext).not.toHaveBeenCalled();
        });

        it('prepends context block to rawContent when attached context items exist', async () => {
            fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
            const getAttachedContext = vi.fn().mockReturnValue([
                { id: 'ctx-1', turnIndex: 3, role: 'assistant', snippet: 'Snippet text', preview: 'Snippet text' },
            ]);
            const clearAttachedContext = vi.fn();
            const opts = makeOptions({ getAttachedContext, clearAttachedContext });
            opts.followUpInputRef.current = 'my follow-up';

            const { result } = renderHook(() => useSendMessage(opts));
            await act(async () => { await result.current.sendFollowUp(); });

            expect(fetchMock).toHaveBeenCalled();
            const body = JSON.parse(fetchMock.mock.calls[0][1].body);
            expect(body.content).toContain('<context from="assistant" turn="3">');
            expect(body.content).toContain('Snippet text');
            expect(body.content).toContain('my follow-up');
        });

        it('clears attached context after successful send (idle path)', async () => {
            fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
            const clearAttachedContext = vi.fn();
            const opts = makeOptions({
                getAttachedContext: () => [{ id: 'ctx-1', turnIndex: 1, role: 'user', snippet: 'x', preview: 'x' }],
                clearAttachedContext,
            });
            opts.followUpInputRef.current = 'hello';

            const { result } = renderHook(() => useSendMessage(opts));
            await act(async () => { await result.current.sendFollowUp(); });
            expect(clearAttachedContext).toHaveBeenCalled();
        });

        it('clears attached context after send while AI is running', async () => {
            fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
            const clearAttachedContext = vi.fn();
            const opts = makeOptions({
                isActiveGeneration: true,
                getAttachedContext: () => [{ id: 'ctx-1', turnIndex: 1, role: 'user', snippet: 'x', preview: 'x' }],
                clearAttachedContext,
            });
            opts.followUpInputRef.current = 'msg';

            const { result } = renderHook(() => useSendMessage(opts));
            await act(async () => { await result.current.sendFollowUp('msg', 'enqueue'); });
            expect(clearAttachedContext).toHaveBeenCalled();
        });

        it('sends normally when no attached context is provided', async () => {
            fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
            const opts = makeOptions();
            opts.followUpInputRef.current = 'plain message';

            const { result } = renderHook(() => useSendMessage(opts));
            await act(async () => { await result.current.sendFollowUp(); });

            const body = JSON.parse(fetchMock.mock.calls[0][1].body);
            expect(body.content).toBe('plain message');
            expect(body.content).not.toContain('<context');
        });

        it('combines attached context with pasted content', async () => {
            fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
            const opts = makeOptions({
                getAttachedContext: () => [{
                    id: 'ctx-1',
                    turnIndex: 2,
                    role: 'assistant',
                    snippet: 'context snippet',
                    preview: 'context snippet',
                }],
                clearAttachedContext: vi.fn(),
                getPastedContent: () => 'pasted content',
            });
            opts.followUpInputRef.current = 'user text';

            const { result } = renderHook(() => useSendMessage(opts));
            await act(async () => { await result.current.sendFollowUp(); });

            const body = JSON.parse(fetchMock.mock.calls[0][1].body);
            // Context should come first, then user text + pasted content
            expect(body.content.indexOf('<context')).toBeLessThan(body.content.indexOf('user text'));
            expect(body.content).toContain('pasted content');
        });
    });
});
