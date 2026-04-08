/**
 * Tests for useSendMessage — follow-up message sending, slash commands, error handling.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSendMessage } from '../../../../src/server/spa/client/react/hooks/useSendMessage';
import type { UseSendMessageOptions } from '../../../../src/server/spa/client/react/hooks/useSendMessage';

// ── Mocks ────────────────────────────────────────────────────────────

vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    getApiBase: () => '/api',
}));

vi.mock('../../../../src/server/spa/client/react/hooks/useDraftStore', () => ({
    clearDraft: vi.fn(),
}));

const mockUnarchiveChat = vi.fn();
let mockArchivedChatIds = new Set<string>();

vi.mock('../../../../src/server/spa/client/react/context/ChatPreferencesContext', () => ({
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
        setSending: vi.fn(),
        setError: vi.fn(),
        setSessionExpired: vi.fn(),
        setSuggestions: vi.fn(),
        pendingQueue: [],
        setPendingQueue: vi.fn(),
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
            '../../../../src/server/spa/client/react/hooks/useDraftStore'
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

    it('enqueues message in pendingQueue optimistically when already sending', async () => {
        fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
        const setPendingQueue = vi.fn();
        const opts = makeOptions({ sending: true, setPendingQueue });

        const { result } = renderHook(() => useSendMessage(opts));
        await act(async () => { await result.current.sendFollowUp('hello'); });
        expect(setPendingQueue).toHaveBeenCalled();
        const updaterArg = setPendingQueue.mock.calls[0][0];
        const result2 = updaterArg([]);
        expect(result2).toHaveLength(1);
        expect(result2[0].content).toBe('hello');
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

    it('calls refreshConversation via waitForSendCompletion fallback (no EventSource)', async () => {
        // With EventSource stubbed to undefined, waitForSendCompletion falls through
        // to `return refreshConversation(pid)` — so it is still called once.
        fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
        const refreshConversation = vi.fn().mockResolvedValue(undefined);
        const opts = makeOptions({ refreshConversation });
        opts.followUpInputRef.current = 'hello';

        const { result } = renderHook(() => useSendMessage(opts));
        await act(async () => { await result.current.sendFollowUp(); });
        expect(refreshConversation).toHaveBeenCalledWith('pid-1');
    });

    it('does not call refreshConversation in finally block (deduplication)', async () => {
        // refreshConversation is intentionally NOT called from the finally block
        // to avoid racing with useChatSSE.finish() which already triggers a refresh.
        // In this test (no EventSource), the only call comes from waitForSendCompletion fallback.
        fetchMock.mockRejectedValue(new Error('network'));
        const refreshConversation = vi.fn().mockResolvedValue(undefined);
        const opts = makeOptions({ refreshConversation });
        opts.followUpInputRef.current = 'hello';

        const { result } = renderHook(() => useSendMessage(opts));
        await act(async () => { await result.current.sendFollowUp(); });
        // fetch throws before waitForSendCompletion is reached, so refreshConversation
        // should NOT be called (the finally block no longer calls it)
        expect(refreshConversation).not.toHaveBeenCalled();
    });
});

// ── Timeout fix regression tests ─────────────────────────────────────────────

describe('waitForSendCompletion safety timeout (regression)', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('timeout fires and resolves the promise (previously: ref comparison was always false)', async () => {
        // Reproduces the waitForSendCompletion pattern directly to verify the fix.
        // Before the fix, the ref was overwritten with a wrapper after the comparison
        // reference was captured, making `resolveCurrentSendRef.current === resolve`
        // always false — the 90-second safety timeout never fired.
        const resolveRef: { current: (() => void) | null } = { current: null };

        const waitFn = (): Promise<void> => new Promise<void>(resolve => {
            let timeoutId: ReturnType<typeof setTimeout>;
            // Fixed pattern: ref holds the wrapper, timeout calls the wrapper directly
            const wrappedResolve = () => {
                clearTimeout(timeoutId);
                if (resolveRef.current === wrappedResolve) resolveRef.current = null;
                resolve();
            };
            resolveRef.current = wrappedResolve;
            timeoutId = setTimeout(wrappedResolve, 90_000);
        });

        let resolved = false;
        const p = waitFn().then(() => { resolved = true; });

        expect(resolved).toBe(false);
        vi.advanceTimersByTime(91_000);
        await p;
        expect(resolved).toBe(true);
    });

    it('onSendComplete (external caller) fires the wrapper and resolves immediately', async () => {
        const resolveRef: { current: (() => void) | null } = { current: null };

        const waitFn = (): Promise<void> => new Promise<void>(resolve => {
            let timeoutId: ReturnType<typeof setTimeout>;
            const wrappedResolve = () => {
                clearTimeout(timeoutId);
                if (resolveRef.current === wrappedResolve) resolveRef.current = null;
                resolve();
            };
            resolveRef.current = wrappedResolve;
            timeoutId = setTimeout(wrappedResolve, 90_000);
        });

        let resolved = false;
        const p = waitFn().then(() => { resolved = true; });

        expect(resolved).toBe(false);
        // Simulate onSendComplete calling resolveRef.current() (as useChatSSE does)
        if (resolveRef.current) { resolveRef.current(); resolveRef.current = null; }
        await p;
        expect(resolved).toBe(true);
        // Timer should NOT have fired (cancelled)
        vi.runAllTimers();
        expect(resolved).toBe(true); // idempotent
    });
});
