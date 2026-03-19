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
        ...overrides,
    };
}

describe('useSendMessage', () => {
    beforeEach(() => {
        fetchMock.mockReset();
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
});
