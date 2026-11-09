/**
 * Steer (Ctrl/Cmd+Enter) vs queue (Enter) while a turn is running: the client
 * shows exactly what the server did with the message.
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

function turnsHolder() {
    const state = { turns: [] as any[] };
    const setTurnsAndRef = vi.fn((update: any) => {
        state.turns = typeof update === 'function' ? update(state.turns) : update;
    });
    return { state, setTurnsAndRef };
}

describe('useSendMessage — steer while running', () => {
    it('removes the optimistic turn and shows a notice when the server queued the steer', async () => {
        sendSpy.mockResolvedValue({ processId: PROCESS, turnIndex: -1, delivery: 'queued' });
        const { state, setTurnsAndRef } = turnsHolder();
        const notify = vi.fn();
        const { result } = renderHook(
            () => useSendMessage(makeOptions({ isActiveGeneration: true, setTurnsAndRef, notify })),
            { wrapper },
        );

        await act(async () => { await result.current.sendFollowUp('steer me', 'immediate'); });

        const request = sendSpy.mock.calls[0][1];
        expect(request).toMatchObject({ deliveryMode: 'immediate', optimisticId: expect.any(String) });
        // No duplicate: the queued entry (from pending-message-added) is the only copy.
        expect(state.turns).toEqual([]);
        expect(notify).toHaveBeenCalledWith("Couldn't steer — queued for after this turn.", 'info');
    });

    it('keeps one user turn labelled steered when the server steered it', async () => {
        sendSpy.mockResolvedValue({ processId: PROCESS, turnIndex: 2, delivery: 'steered' });
        const { state, setTurnsAndRef } = turnsHolder();
        const notify = vi.fn();
        const { result } = renderHook(
            () => useSendMessage(makeOptions({ isActiveGeneration: true, setTurnsAndRef, notify })),
            { wrapper },
        );

        await act(async () => { await result.current.sendFollowUp('steer me', 'immediate'); });

        expect(state.turns).toHaveLength(1);
        expect(state.turns[0]).toMatchObject({ role: 'user', content: 'steer me', steered: true });
        expect(state.turns[0].optimisticId).toBe(sendSpy.mock.calls[0][1].optimisticId);
        expect(notify).not.toHaveBeenCalled();
    });

    it('adds no optimistic turn when queueing with Enter while running', async () => {
        sendSpy.mockResolvedValue({ processId: PROCESS, turnIndex: -1, delivery: 'queued' });
        const { state, setTurnsAndRef } = turnsHolder();
        const notify = vi.fn();
        const { result } = renderHook(
            () => useSendMessage(makeOptions({ isActiveGeneration: true, setTurnsAndRef, notify })),
            { wrapper },
        );

        await act(async () => { await result.current.sendFollowUp('later', 'enqueue'); });

        expect(sendSpy.mock.calls[0][1]).toMatchObject({ deliveryMode: 'enqueue' });
        expect(sendSpy.mock.calls[0][1].optimisticId).toBeUndefined();
        expect(state.turns).toEqual([]);
        expect(notify).not.toHaveBeenCalled();
    });

    it('drops the optimistic steer turn when the send fails', async () => {
        sendSpy.mockRejectedValue(new Error('offline'));
        const { state, setTurnsAndRef } = turnsHolder();
        const { result } = renderHook(
            () => useSendMessage(makeOptions({ isActiveGeneration: true, setTurnsAndRef })),
            { wrapper },
        );

        await act(async () => { await result.current.sendFollowUp('steer me', 'immediate'); });

        expect(state.turns).toEqual([]);
    });
});
