/**
 * Tests for useSendMessage hook — POST /api/processes/:id/message, loading flag, error paths.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSendMessage } from '../../../src/server/spa/client/react/hooks/useSendMessage';

// ── Mock EventSource ──────────────────────────────────────────────────────────

class MockEventSource {
    url: string;
    listeners: Record<string, ((e: Event) => void)[]> = {};
    onerror: (() => void) | null = null;
    closed = false;

    constructor(url: string) { this.url = url; }

    addEventListener(type: string, handler: (e: Event) => void) {
        if (!this.listeners[type]) this.listeners[type] = [];
        this.listeners[type].push(handler);
    }

    close() { this.closed = true; }

    emit(type: string, data?: any) {
        const event = data !== undefined ? { data: JSON.stringify(data) } as MessageEvent : ({} as Event);
        (this.listeners[type] || []).forEach(h => h(event));
    }
}

vi.stubGlobal('EventSource', MockEventSource);

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeOptions(overrides: Partial<Parameters<typeof useSendMessage>[0]> = {}): Parameters<typeof useSendMessage>[0] {
    return {
        processId: 'proc-1',
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
            parseAndExtract: (input: string) => ({ skills: [], prompt: input }),
            dismissMenu: vi.fn(),
        },
        followUpInputRef: { current: 'Hello World' },
        setFollowUpInput: vi.fn(),
        selectedMode: 'ask' as const,
        selectedModeRef: { current: 'ask' as const },
        images: [],
        clearImages: vi.fn(),
        lastFailedMessageRef: { current: '' },
        ...overrides,
    };
}

const mockFetch = vi.fn();

beforeEach(() => {
    vi.restoreAllMocks();
    mockFetch.mockReset();
    vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('useSendMessage', () => {
    it('sendFollowUp does nothing when processId is null', async () => {
        const setSending = vi.fn();
        const opts = makeOptions({ processId: null, setSending });
        const { result } = renderHook(() => useSendMessage(opts));
        await act(async () => { await result.current.sendFollowUp(); });
        expect(setSending).not.toHaveBeenCalled();
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('sendFollowUp does nothing when content is empty', async () => {
        const setSending = vi.fn();
        const opts = makeOptions({ followUpInputRef: { current: '   ' }, setSending });
        const { result } = renderHook(() => useSendMessage(opts));
        await act(async () => { await result.current.sendFollowUp(); });
        expect(setSending).not.toHaveBeenCalled();
    });

    it('sendFollowUp does nothing when inputDisabled is true', async () => {
        const setSending = vi.fn();
        const opts = makeOptions({ inputDisabled: true, setSending });
        const { result } = renderHook(() => useSendMessage(opts));
        await act(async () => { await result.current.sendFollowUp('Hello'); });
        expect(setSending).not.toHaveBeenCalled();
    });

    it('sets sending=true then false after successful POST', async () => {
        const setSending = vi.fn();
        mockFetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
        });
        const opts = makeOptions({ setSending });
        const { result } = renderHook(() => useSendMessage(opts));
        await act(async () => { await result.current.sendFollowUp('Hello'); });
        expect(setSending).toHaveBeenCalledWith(true);
        expect(setSending).toHaveBeenCalledWith(false);
    });

    it('calls setError on non-2xx response', async () => {
        const setError = vi.fn();
        mockFetch.mockResolvedValueOnce({
            ok: false,
            status: 500,
            json: () => Promise.resolve({ error: 'Server error' }),
        });
        const opts = makeOptions({ setError });
        const { result } = renderHook(() => useSendMessage(opts));
        await act(async () => { await result.current.sendFollowUp('Hello'); });
        expect(setError).toHaveBeenCalledWith(expect.stringContaining('Server error'));
    });

    it('calls setSessionExpired on 410 response', async () => {
        const setSessionExpired = vi.fn();
        mockFetch.mockResolvedValueOnce({
            ok: false,
            status: 410,
        });
        const opts = makeOptions({ setSessionExpired });
        const { result } = renderHook(() => useSendMessage(opts));
        await act(async () => { await result.current.sendFollowUp('Hello'); });
        expect(setSessionExpired).toHaveBeenCalledWith(true);
    });

    it('calls setError on fetch network error', async () => {
        const setError = vi.fn();
        mockFetch.mockRejectedValueOnce(new Error('Network error'));
        const opts = makeOptions({ setError });
        const { result } = renderHook(() => useSendMessage(opts));
        await act(async () => { await result.current.sendFollowUp('Hello'); });
        expect(setError).toHaveBeenCalledWith(expect.stringContaining('Network error'));
    });

    it('adds message to pendingQueue when sending=true (second message while first in-flight)', async () => {
        const setPendingQueue = vi.fn();
        mockFetch.mockResolvedValue({ ok: true, status: 200 });
        // sending=true simulates first message is in-flight
        const opts = makeOptions({ sending: true, setPendingQueue });
        const { result } = renderHook(() => useSendMessage(opts));
        await act(async () => { await result.current.sendFollowUp('Second message'); });
        expect(setPendingQueue).toHaveBeenCalled();
    });

    it('POSTs to /api/processes/:id/message with correct content', async () => {
        mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });
        const opts = makeOptions();
        const { result } = renderHook(() => useSendMessage(opts));
        await act(async () => { await result.current.sendFollowUp('Hello World'); });
        const call = mockFetch.mock.calls[0];
        expect(call[0]).toContain('/processes/proc-1/message');
        const body = JSON.parse(call[1].body);
        expect(body.content).toBe('Hello World');
    });

    it('calls setTurnsAndRef to add optimistic user and assistant turns', async () => {
        const setTurnsAndRef = vi.fn();
        mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });
        const opts = makeOptions({ setTurnsAndRef });
        const { result } = renderHook(() => useSendMessage(opts));
        await act(async () => { await result.current.sendFollowUp('Hello'); });
        expect(setTurnsAndRef).toHaveBeenCalled();
    });

    it('sets lastFailedMessageRef on non-2xx response', async () => {
        const lastFailedMessageRef = { current: '' };
        mockFetch.mockResolvedValueOnce({
            ok: false,
            status: 500,
            json: () => Promise.resolve({}),
        });
        const opts = makeOptions({ lastFailedMessageRef });
        const { result } = renderHook(() => useSendMessage(opts));
        await act(async () => { await result.current.sendFollowUp('Failed msg'); });
        expect(lastFailedMessageRef.current).toBe('Failed msg');
    });

    it('clears lastFailedMessageRef on successful send', async () => {
        const lastFailedMessageRef = { current: 'previous failure' };
        mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });
        const opts = makeOptions({ lastFailedMessageRef });
        const { result } = renderHook(() => useSendMessage(opts));
        await act(async () => { await result.current.sendFollowUp('New message'); });
        expect(lastFailedMessageRef.current).toBe('');
    });
});
