/**
 * Tests for the Ralph promotion branch in `useSendMessage`.
 *
 * When `selectedMode === 'ralph'`, calling `sendFollowUp` must:
 *   - call `cocClient.processes.promoteToRalph(processId, { workspaceId, extraGuidance })`
 *     instead of POSTing a normal /message
 *   - on success: clear input, fire `onPromotedToRalph`, and refresh the conversation
 *   - on failure: surface the error and restore the typed text
 *   - treat a 410 CocApiError as session-expired
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ── Mocks ────────────────────────────────────────────────────────────

vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => '/api',
}));

const hoisted = vi.hoisted(() => ({
    clearDraftMock: vi.fn(),
    mockUnarchiveChat: vi.fn(),
    promoteToRalphMock: vi.fn(),
}));
const { clearDraftMock, mockUnarchiveChat, promoteToRalphMock } = hoisted;

vi.mock('../../../../src/server/spa/client/react/features/chat/hooks/useDraftStore', () => ({
    clearDraft: hoisted.clearDraftMock,
}));

vi.mock('../../../../src/server/spa/client/react/contexts/ChatPreferencesContext', () => ({
    ChatPrefsSync: () => null,
    useChatPrefs: () => ({
        archivedChatIds: new Set<string>(),
        unarchiveChat: hoisted.mockUnarchiveChat,
        pinnedChatIds: new Set<string>(),
        pinChat: vi.fn(),
        unpinChat: vi.fn(),
        archiveChat: vi.fn(),
    }),
}));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        processes: { promoteToRalph: hoisted.promoteToRalphMock },
    }),
    getSpaCocClientErrorMessage: (err: any, fallback: string) =>
        err?.message ? `${fallback}: ${err.message}` : fallback,
}));

// CocApiError class — useSendMessage uses `instanceof CocApiError` to detect 410.
const { CocApiError } = vi.hoisted(() => {
    class CocApiError extends Error {
        status: number;
        constructor(status: number, message: string) {
            super(message);
            this.status = status;
            this.name = 'CocApiError';
        }
    }
    return { CocApiError };
});
vi.mock('@plusplusoneplusplus/coc-client', () => ({
    CocApiError,
}));

import { useSendMessage } from '../../../../src/server/spa/client/react/features/chat/hooks/useSendMessage';
import type { UseSendMessageOptions } from '../../../../src/server/spa/client/react/features/chat/hooks/useSendMessage';

function makeOptions(overrides: Partial<UseSendMessageOptions> = {}): UseSendMessageOptions {
    const followUpInputRef = { current: '' };
    return {
        processId: 'queue_p-1',
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
        selectedMode: 'ralph' as any,
        selectedModeRef: { current: 'ralph' as any },
        images: [],
        clearImages: vi.fn(),
        clearPaste: vi.fn(),
        lastFailedMessageRef: { current: '' },
        setTask: vi.fn(),
        workspaceId: 'ws-1',
        onPromotedToRalph: vi.fn(),
        ...overrides,
    };
}

describe('useSendMessage — Ralph promotion branch', () => {
    beforeEach(() => {
        promoteToRalphMock.mockReset();
        mockUnarchiveChat.mockReset();
        clearDraftMock.mockReset();
    });

    it('calls promoteToRalph with workspaceId and trimmed typed text as extraGuidance', async () => {
        promoteToRalphMock.mockResolvedValue({
            promoted: true,
            processId: 'queue_p-1',
            sessionId: 'ralph-x',
            synthesisTaskId: 'queue_synth',
        });
        const onPromotedToRalph = vi.fn();
        const opts = makeOptions({
            followUpInputRef: { current: '  focus on the queue refactor  ' },
            onPromotedToRalph,
        });

        const { result } = renderHook(() => useSendMessage(opts));
        await act(async () => {
            await result.current.sendFollowUp();
        });

        expect(promoteToRalphMock).toHaveBeenCalledOnce();
        expect(promoteToRalphMock).toHaveBeenCalledWith('queue_p-1', {
            workspaceId: 'ws-1',
            extraGuidance: 'focus on the queue refactor',
        });
        expect(onPromotedToRalph).toHaveBeenCalledOnce();
        expect(opts.refreshConversation).toHaveBeenCalledWith('queue_p-1');
        expect(opts.setFollowUpInput).toHaveBeenCalledWith('');
        expect(opts.setError).toHaveBeenCalledWith(null);
    });

    it('passes extraGuidance: undefined when input is empty', async () => {
        promoteToRalphMock.mockResolvedValue({ promoted: true });
        const opts = makeOptions({ followUpInputRef: { current: '' } });

        const { result } = renderHook(() => useSendMessage(opts));
        await act(async () => {
            await result.current.sendFollowUp();
        });

        expect(promoteToRalphMock).toHaveBeenCalledWith('queue_p-1', {
            workspaceId: 'ws-1',
            extraGuidance: undefined,
        });
    });

    it('does NOT POST to /message when ralph is selected (uses SDK only)', async () => {
        const fetchMock = vi.fn();
        global.fetch = fetchMock as any;
        promoteToRalphMock.mockResolvedValue({ promoted: true });

        const opts = makeOptions({ followUpInputRef: { current: 'hi' } });
        const { result } = renderHook(() => useSendMessage(opts));
        await act(async () => {
            await result.current.sendFollowUp();
        });

        expect(promoteToRalphMock).toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('on failure: surfaces error message and restores typed text', async () => {
        promoteToRalphMock.mockRejectedValue(new Error('queue full'));
        const opts = makeOptions({ followUpInputRef: { current: 'my hint' } });

        const { result } = renderHook(() => useSendMessage(opts));
        await act(async () => {
            await result.current.sendFollowUp();
        });

        expect(opts.setError).toHaveBeenCalledWith(
            expect.stringContaining('queue full'),
        );
        // Typed text restored so the user can retry.
        expect(opts.setFollowUpInput).toHaveBeenCalledWith('my hint');
        expect(opts.lastFailedMessageRef.current).toBe('my hint');
        expect(opts.onPromotedToRalph).not.toHaveBeenCalled();
    });

    it('on 410 CocApiError: marks session expired', async () => {
        promoteToRalphMock.mockRejectedValue(new CocApiError(410, 'gone'));
        const opts = makeOptions({ followUpInputRef: { current: '' } });

        const { result } = renderHook(() => useSendMessage(opts));
        await act(async () => {
            await result.current.sendFollowUp();
        });

        expect(opts.setSessionExpired).toHaveBeenCalledWith(true);
        expect(opts.setError).toHaveBeenCalledWith('Session expired.');
    });

    it('falls through (does NOT call promoteToRalph) when selectedMode is "ask"', async () => {
        promoteToRalphMock.mockResolvedValue({ promoted: true });
        const opts = makeOptions({
            selectedMode: 'ask',
            selectedModeRef: { current: 'ask' },
            followUpInputRef: { current: '' },
        });

        const { result } = renderHook(() => useSendMessage(opts));
        await act(async () => {
            await result.current.sendFollowUp();
        });

        expect(promoteToRalphMock).not.toHaveBeenCalled();
    });
});
