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
import { CocApiError } from '@plusplusoneplusplus/coc-client';

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
        // setTurnsAndRef is how a normal send appends optimistic turns; the
        // /compact action must never touch it (transcript stays unchanged).
        const setTurnsAndRef = vi.fn();
        const { result } = renderHook(
            () => useSendMessage(makeOptions({ notifyCompact, setFollowUpInput, setTurnsAndRef })),
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
        const { result } = renderHook(() => useSendMessage(makeOptions({ notifyCompact })), { wrapper });

        await act(async () => {
            await result.current.sendFollowUp('/compact');
        });

        expect(notifyCompact).toHaveBeenCalledWith(
            'Compaction is not supported for provider "claude".',
            'error',
        );
        expect(sendSpy).not.toHaveBeenCalled();
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
});
