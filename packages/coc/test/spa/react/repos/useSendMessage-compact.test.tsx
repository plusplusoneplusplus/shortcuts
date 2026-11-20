/**
 * Tests for the `/compact` submit-time interception in useSendMessage (AC-06).
 *
 * `/compact` is a client-side action (like `/model`), not a normal message: on
 * submit it must call `processes.compact(processId, customInstructions)` instead
 * of `processes.sendMessage`, surface the result as a transient toast, and never
 * create a persisted transcript turn. Unsupported-provider (422) and active-turn
 * (409) failures surface as an error toast.
 */
/* @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderHook, act } from '@testing-library/react';

// Hoisted spies referenced by the cloneRegistry mock.
const { compactSpy, sendSpy, getClientSpy } = vi.hoisted(() => {
    const compactSpy = vi.fn();
    const sendSpy = vi.fn().mockResolvedValue({});
    const getClientSpy = vi.fn((_ws: string | null | undefined) => ({
        processes: { compact: compactSpy, sendMessage: sendSpy },
    }));
    return { compactSpy, sendSpy, getClientSpy };
});

vi.mock('../../../../src/server/spa/client/react/repos/cloneRegistry', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../../src/server/spa/client/react/repos/cloneRegistry')>();
    return {
        ...actual,
        getCocClientForWorkspace: (ws: string | null | undefined) => getClientSpy(ws),
    };
});

import { useSendMessage } from '../../../../src/server/spa/client/react/features/chat/hooks/useSendMessage';
import type { UseSendMessageOptions } from '../../../../src/server/spa/client/react/features/chat/hooks/useSendMessage';
import { ChatPreferencesProvider } from '../../../../src/server/spa/client/react/contexts/ChatPreferencesContext';
import { parseSlashCommands, META_COMMANDS } from '../../../../src/server/spa/client/react/features/chat/slash-command-parser';
import { CocApiError, CocClient } from '@plusplusoneplusplus/coc-client';

const WORKSPACE = 'ws-test';
const PROCESS = 'proc-1';

function makeOptions(overrides: Partial<UseSendMessageOptions> = {}): UseSendMessageOptions {
    return {
        processId: PROCESS,
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
            // Real parser so the test exercises the actual /compact recognition.
            parseAndExtract: (text: string) => parseSlashCommands(text, [], META_COMMANDS),
            dismissMenu: vi.fn(),
        },
        followUpInputRef: { current: '' },
        setFollowUpInput: vi.fn(),
        selectedMode: 'ask',
        selectedModeRef: { current: 'ask' },
        images: [],
        clearImages: vi.fn(),
        clearPaste: vi.fn(),
        lastFailedMessageRef: { current: '' },
        setTask: vi.fn(),
        workspaceId: WORKSPACE,
        notifyCompact: vi.fn(),
        ...overrides,
    };
}

function wrapper({ children }: { children: React.ReactNode }) {
    return <ChatPreferencesProvider workspaceId={WORKSPACE}>{children}</ChatPreferencesProvider>;
}

beforeEach(() => {
    compactSpy.mockReset();
    sendSpy.mockReset().mockResolvedValue({});
    getClientSpy.mockClear();
    // Deterministic completion path for normal sends (no EventSource → refresh).
    (globalThis as any).EventSource = undefined;
});

describe('useSendMessage — /compact interception', () => {
    it('calls processes.compact (not sendMessage), toasts success, and creates no transcript turn', async () => {
        compactSpy.mockResolvedValue({ success: true, tokensRemoved: 1234, messagesRemoved: 5 });
        const notifyCompact = vi.fn();
        const setFollowUpInput = vi.fn();
        // setTurnsAndRef is how a normal send appends OPTIMISTIC turns; the
        // /compact action must never touch it (no client-side optimistic turn).
        const setTurnsAndRef = vi.fn();
        // refreshConversation pulls in the server-appended display-only result
        // turn (AC-03) so it shows without a reload.
        const refreshConversation = vi.fn().mockResolvedValue(undefined);
        const { result } = renderHook(
            () => useSendMessage(makeOptions({ notifyCompact, setFollowUpInput, setTurnsAndRef, refreshConversation })),
            { wrapper },
        );

        await act(async () => {
            await result.current.sendFollowUp('/compact');
        });

        expect(compactSpy).toHaveBeenCalledTimes(1);
        expect(compactSpy).toHaveBeenCalledWith(PROCESS, undefined, { workspace: WORKSPACE });
        expect(sendSpy).not.toHaveBeenCalled();
        expect(setTurnsAndRef).not.toHaveBeenCalled();
        expect(setFollowUpInput).toHaveBeenCalledWith('');
        expect(notifyCompact).toHaveBeenCalledWith(
            'Context compacted — removed 5 messages, freed ~1234 tokens',
            'success',
        );
        // On success, the conversation is refreshed to surface the persisted
        // display-only result turn (AC-03) — the toast is not the only signal.
        expect(refreshConversation).toHaveBeenCalledWith(PROCESS);
    });

    it('passes trailing text after /compact as customInstructions', async () => {
        compactSpy.mockResolvedValue({ success: true, tokensRemoved: 10, messagesRemoved: 1 });
        const notifyCompact = vi.fn();
        const { result } = renderHook(() => useSendMessage(makeOptions({ notifyCompact })), { wrapper });

        await act(async () => {
            await result.current.sendFollowUp('/compact focus on the auth refactor');
        });

        expect(compactSpy).toHaveBeenCalledWith(PROCESS, 'focus on the auth refactor', { workspace: WORKSPACE });
        // Singular "message" for messagesRemoved === 1.
        expect(notifyCompact).toHaveBeenCalledWith(
            'Context compacted — removed 1 message, freed ~10 tokens',
            'success',
        );
        expect(sendSpy).not.toHaveBeenCalled();
    });

    it('surfaces an error toast when the provider does not support compaction (422)', async () => {
        compactSpy.mockRejectedValue(new CocApiError({
            status: 422,
            statusText: 'Unprocessable Entity',
            url: `/api/processes/${PROCESS}/compact`,
            message: 'request failed',
            code: 'COMPACT_UNSUPPORTED',
            body: { error: 'Compaction is not supported for provider "claude".' },
        }));
        const notifyCompact = vi.fn();
        const refreshConversation = vi.fn().mockResolvedValue(undefined);
        const { result } = renderHook(() => useSendMessage(makeOptions({ notifyCompact, refreshConversation })), { wrapper });

        await act(async () => {
            await result.current.sendFollowUp('/compact');
        });

        expect(notifyCompact).toHaveBeenCalledWith(
            'Compaction is not supported for provider "claude".',
            'error',
        );
        expect(sendSpy).not.toHaveBeenCalled();
        // A failed compaction appends no result turn, so there is nothing to
        // refresh for — leave the transcript untouched.
        expect(refreshConversation).not.toHaveBeenCalled();
    });

    it('surfaces an error toast when a turn is active (409) and still intercepts the send', async () => {
        compactSpy.mockRejectedValue(new CocApiError({
            status: 409,
            statusText: 'Conflict',
            url: `/api/processes/${PROCESS}/compact`,
            message: 'request failed',
            code: 'CONVERSATION_NOT_IDLE',
            body: { error: 'Conversation is not idle.' },
        }));
        const notifyCompact = vi.fn();
        const { result } = renderHook(
            () => useSendMessage(makeOptions({ notifyCompact, isActiveGeneration: true })),
            { wrapper },
        );

        await act(async () => {
            await result.current.sendFollowUp('/compact');
        });

        expect(compactSpy).toHaveBeenCalledTimes(1);
        expect(notifyCompact).toHaveBeenCalledWith('Conversation is not idle.', 'error');
        // The active-turn /message routing path must NOT run for /compact.
        expect(sendSpy).not.toHaveBeenCalled();
    });

    it('does not throw when parseAndExtract omits metaCommands (regression: optional chaining guard)', async () => {
        // A partial parseAndExtract stub (no metaCommands) must degrade to a
        // normal send rather than crashing on `.includes`. Guards the regression
        // where `compactParse.metaCommands.includes(...)` threw for such stubs.
        const partialSlash = {
            parseAndExtract: (text: string) => ({ skills: [], prompt: text }) as any,
            dismissMenu: vi.fn(),
        };
        const { result } = renderHook(
            () => useSendMessage(makeOptions({ slashCommands: partialSlash })),
            { wrapper },
        );

        await act(async () => {
            await result.current.sendFollowUp('just a normal message');
        });

        expect(compactSpy).not.toHaveBeenCalled();
        expect(sendSpy).toHaveBeenCalledTimes(1);
    });

    it('does not intercept a normal message (sends via processes.sendMessage)', async () => {
        const notifyCompact = vi.fn();
        const { result } = renderHook(() => useSendMessage(makeOptions({ notifyCompact })), { wrapper });

        await act(async () => {
            await result.current.sendFollowUp('hello world, please /compactify nothing');
        });

        expect(sendSpy).toHaveBeenCalledTimes(1);
        expect(compactSpy).not.toHaveBeenCalled();
        expect(notifyCompact).not.toHaveBeenCalled();
    });

    // ── AC-02: in-progress lifecycle + duplicate-send block ──
    it('acknowledges queued compaction without claiming completion and permits later sends', async () => {
        compactSpy.mockResolvedValue({ state: 'queued', taskId: 'compact-1' });
        const options = makeOptions({ setCompacting: vi.fn() });
        const { result } = renderHook(() => useSendMessage(options), { wrapper });
        await act(async () => { await result.current.sendFollowUp('/compact'); });
        expect(options.notifyCompact).toHaveBeenCalledWith('Compaction queued.', 'success');
        expect(options.refreshConversation).toHaveBeenCalledWith(PROCESS);
        expect(options.setCompacting).toHaveBeenLastCalledWith(false);
        await act(async () => { await result.current.sendFollowUp('later message'); });
        expect(sendSpy).toHaveBeenCalledTimes(1);
    });

    it('marks compacting true (with instructions) at start and false on success', async () => {
        compactSpy.mockResolvedValue({ success: true, messagesRemoved: 2, tokensRemoved: 99 });
        const setCompacting = vi.fn();
        const { result } = renderHook(() => useSendMessage(makeOptions({ setCompacting })), { wrapper });

        await act(async () => {
            await result.current.sendFollowUp('/compact drop the boring bits');
        });

        // Started with the typed custom instructions, settled back to idle.
        expect(setCompacting).toHaveBeenNthCalledWith(1, true, 'drop the boring bits');
        expect(setCompacting).toHaveBeenLastCalledWith(false);
    });

    it('clears compacting state even when compaction fails', async () => {
        compactSpy.mockRejectedValue(new CocApiError({
            status: 422,
            statusText: 'Unprocessable Entity',
            url: `/api/processes/${PROCESS}/compact`,
            message: 'request failed',
            code: 'COMPACT_UNSUPPORTED',
            body: { error: 'Compaction is not supported for provider "claude".' },
        }));
        const setCompacting = vi.fn();
        const { result } = renderHook(() => useSendMessage(makeOptions({ setCompacting })), { wrapper });

        await act(async () => {
            await result.current.sendFollowUp('/compact');
        });

        expect(setCompacting).toHaveBeenNthCalledWith(1, true, undefined);
        expect(setCompacting).toHaveBeenLastCalledWith(false);
    });

    it('drops a second /compact but queues normal follow-ups while one is in flight', async () => {
        // Hold the first compaction open with a deferred promise so we can fire
        // more sends while it is still running.
        let resolveCompact!: (v: any) => void;
        compactSpy.mockReturnValue(new Promise(r => { resolveCompact = r; }));
        const setCompacting = vi.fn();
        const options = makeOptions({ setCompacting });
        const { result } = renderHook(() => useSendMessage(options), { wrapper });

        let firstSend!: Promise<void>;
        await act(async () => {
            firstSend = result.current.sendFollowUp('/compact');
            // The compact branch sets the in-flight ref synchronously before the
            // (blocking) POST, so a second /compact must be dropped...
            await result.current.sendFollowUp('/compact');
            // ...while normal follow-ups reach the server in send order, which
            // queues them behind the compaction boundary.
            await result.current.sendFollowUp('first follow-up');
            await result.current.sendFollowUp('second follow-up', 'immediate');
        });

        expect(compactSpy).toHaveBeenCalledTimes(1);
        expect(sendSpy.mock.calls.map(call => [call[0], call[1].content, call[2]])).toEqual([
            [PROCESS, 'first follow-up', { workspace: WORKSPACE }],
            [PROCESS, 'second follow-up', { workspace: WORKSPACE }],
        ]);
        // Queued, not streamed: no optimistic user/assistant or steer turns and
        // no follow-up stream; the server-queued entries load via refresh.
        expect(options.setTurnsAndRef).not.toHaveBeenCalled();
        expect(options.setSending).not.toHaveBeenCalled();
        expect(options.queueDispatch).not.toHaveBeenCalled();
        expect(sendSpy.mock.calls[1][1].optimisticId).toBeUndefined();
        expect(options.refreshConversation).toHaveBeenCalledTimes(2);
        expect(options.refreshConversation).toHaveBeenCalledWith(PROCESS);
        expect(setCompacting).toHaveBeenCalledTimes(1);

        // Resolve the first compaction; its lifecycle is unchanged.
        await act(async () => {
            resolveCompact({ success: true, messagesRemoved: 1, tokensRemoved: 1 });
            await firstSend;
        });
        expect(setCompacting).toHaveBeenLastCalledWith(false);
        expect(options.notifyCompact).toHaveBeenCalledWith(expect.stringContaining('Context compacted'), 'success');

        // A /compact after settle runs again.
        compactSpy.mockResolvedValue({ success: true, messagesRemoved: 0, tokensRemoved: 0 });
        await act(async () => { await result.current.sendFollowUp('/compact'); });
        expect(compactSpy).toHaveBeenCalledTimes(2);
    });

    it.each([
        ['fails', (r: { reject: (e: Error) => void }) => r.reject(new Error('compact failed'))],
        ['is cancelled', (r: { resolve: (v: any) => void }) => r.resolve({ state: 'cancelled' })],
    ] as const)('keeps a follow-up queued during compaction when compaction %s', async (_label, settle) => {
        let handle!: { resolve: (v: any) => void; reject: (e: Error) => void };
        compactSpy.mockReturnValue(new Promise((resolve, reject) => { handle = { resolve, reject }; }));
        const setCompacting = vi.fn();
        const options = makeOptions({ setCompacting });
        const { result } = renderHook(() => useSendMessage(options), { wrapper });
        let compact!: Promise<void>;
        await act(async () => {
            compact = result.current.compactNow();
            await result.current.sendFollowUp('queued during compaction');
        });
        expect(sendSpy).toHaveBeenCalledTimes(1);
        expect(options.setFollowUpInput).toHaveBeenCalledWith('');
        await act(async () => { (settle as any)(handle); await compact; });
        expect(setCompacting).toHaveBeenLastCalledWith(false);
        // The send is never retried or re-posted by the compaction outcome.
        expect(sendSpy).toHaveBeenCalledTimes(1);
        expect(options.setError).not.toHaveBeenCalledWith(expect.stringContaining('follow-up'));
    });

    it('queues through the server when persisted compaction is pending in an idle chat', async () => {
        // e.g. a queued auto-compaction: the process status is still idle, so
        // only `compactionPending` tells the composer not to start a stream.
        const options = makeOptions({ compactionPending: true, workspaceId: 'ws-b', processId: 'proc-b' });
        const { result } = renderHook(() => useSendMessage(options), { wrapper });
        await act(async () => { await result.current.sendFollowUp('after auto compaction', 'immediate'); });
        expect(compactSpy).not.toHaveBeenCalled();
        expect(sendSpy).toHaveBeenCalledTimes(1);
        expect(sendSpy.mock.calls[0][0]).toBe('proc-b');
        expect(sendSpy.mock.calls[0][1].optimisticId).toBeUndefined();
        expect(sendSpy.mock.calls[0][2]).toEqual({ workspace: 'ws-b' });
        expect(getClientSpy).toHaveBeenCalledWith('ws-b');
        expect(options.setTurnsAndRef).not.toHaveBeenCalled();
        expect(options.queueDispatch).not.toHaveBeenCalled();
        expect(options.refreshConversation).toHaveBeenCalledWith('proc-b');
    });

    it('restores the draft and reports an error when a send during compaction is rejected', async () => {
        sendSpy.mockRejectedValue(new Error('boom'));
        const options = makeOptions({ compactionPending: true });
        const { result } = renderHook(() => useSendMessage(options), { wrapper });
        options.followUpInputRef.current = 'draft text';
        await act(async () => { await result.current.sendFollowUp(); });
        expect(options.setError).toHaveBeenCalledWith(expect.stringContaining('boom'));
        expect(options.setFollowUpInput).toHaveBeenLastCalledWith('draft text');
        expect(options.refreshConversation).not.toHaveBeenCalled();
    });
});


describe('useSendMessage — Compact now', () => {
    it('uses the shared lifecycle and exact owner without touching composer drafts or attachments', async () => {
        let resolve!: (value: any) => void;
        compactSpy.mockReturnValue(new Promise(done => { resolve = done; }));
        const compactClient = new CocClient({ baseUrl: 'https://group-owner.test' });
        const ownerCompact = vi.spyOn(compactClient.processes, 'compact').mockImplementation(compactSpy);
        const options = makeOptions({ compactClient, workspaceId: 'remote:server:group', owningWorkspaceId: 'raw-group',
            followUpInputRef: { current: 'unfinished draft' }, setCompacting: vi.fn(),
            sourceSelectionId: 'remote:server:group', images: ['data:image/png;base64,draft'] });
        const { result } = renderHook(() => useSendMessage(options), { wrapper });
        let pending!: Promise<void>;
        await act(async () => {
            pending = result.current.compactNow();
            await result.current.compactNow();
            await result.current.sendFollowUp('/compact');
        });
        expect(getClientSpy).not.toHaveBeenCalled();
        expect(ownerCompact).toHaveBeenCalledExactlyOnceWith(PROCESS, undefined, { workspace: 'raw-group' });
        expect(options.setCompacting).toHaveBeenCalledWith(true, undefined);
        expect(options.followUpInputRef.current).toBe('unfinished draft');
        expect(options.setFollowUpInput).not.toHaveBeenCalled();
        expect(options.clearImages).not.toHaveBeenCalled();
        expect(options.clearPaste).not.toHaveBeenCalled();
        expect(options.setTurnsAndRef).not.toHaveBeenCalled();
        expect(sendSpy).not.toHaveBeenCalled();
        await act(async () => { resolve({ state: 'queued' }); await pending; });
        expect(options.notifyCompact).toHaveBeenCalledWith('Compaction queued.', 'success');
        expect(options.refreshConversation).toHaveBeenCalledWith(PROCESS);
        expect(options.setCompacting).toHaveBeenLastCalledWith(false);
    });

    it.each([
        { inputDisabled: true }, { sending: true }, { isActiveGeneration: true },
        { compactDisabled: true }, { processId: null },
    ])('rejects unavailable action: %j', async overrides => {
        const { result } = renderHook(() => useSendMessage(makeOptions(overrides)), { wrapper });
        await act(async () => { await result.current.compactNow(); });
        expect(compactSpy).not.toHaveBeenCalled();
    });

    it('shows runtime support errors through the existing toast and clears loading', async () => {
        compactSpy.mockRejectedValue(new Error('Runtime does not support compaction'));
        const options = makeOptions({ setCompacting: vi.fn() });
        const { result } = renderHook(() => useSendMessage(options), { wrapper });
        await act(async () => { await result.current.compactNow(); });
        expect(options.notifyCompact).toHaveBeenCalledWith('Runtime does not support compaction', 'error');
        expect(options.setCompacting).toHaveBeenLastCalledWith(false);
    });
});


describe('manual compaction ownership', () => {
    it('rejects an unresolved remote without falling back to the local server', async () => {
        const options = makeOptions({ workspaceId: 'remote:missing:ws-other' });
        const { result } = renderHook(() => useSendMessage(options), { wrapper });
        await act(async () => { await result.current.compactNow(); });
        expect(compactSpy).not.toHaveBeenCalled();
        expect(options.notifyCompact).toHaveBeenCalledWith(expect.stringContaining('owning server is unavailable'), 'error');
    });

    it('ignores old results and retained actions after switching the conversation owner', async () => {
        let resolve!: (value: any) => void;
        compactSpy.mockReturnValueOnce(new Promise(done => { resolve = done; }));
        const oldOptions = makeOptions({ setCompacting: vi.fn() });
        const newOptions = makeOptions({ workspaceId: 'ws-other', processId: 'proc-other', setCompacting: vi.fn() });
        const { result, rerender } = renderHook(options => useSendMessage(options), { initialProps: oldOptions, wrapper });
        const oldAction = result.current.compactNow;
        let pending!: Promise<void>;
        await act(async () => { pending = oldAction(); });
        rerender(newOptions);
        await act(async () => { resolve({ success: true }); await pending; await oldAction(); });
        expect(oldOptions.notifyCompact).not.toHaveBeenCalled();
        expect(oldOptions.refreshConversation).not.toHaveBeenCalled();
        expect(oldOptions.setCompacting).toHaveBeenCalledTimes(1);
        compactSpy.mockResolvedValue({ success: true });
        await act(async () => { await result.current.compactNow(); });
        expect(compactSpy).toHaveBeenCalledTimes(2);
        expect(compactSpy).toHaveBeenLastCalledWith('proc-other', undefined, { workspace: 'ws-other' });
        expect(newOptions.setCompacting).toHaveBeenLastCalledWith(false);
    });
});
