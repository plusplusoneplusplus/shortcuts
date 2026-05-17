/**
 * @vitest-environment jsdom
 *
 * Tests that useSendMessage forwards attachments in the API payload
 * when toPayload() returns non-empty results.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({}),
});
vi.stubGlobal('fetch', mockFetch);

vi.mock('../../../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => '/api',
}));

vi.mock('../../../../../src/server/spa/client/react/features/chat/hooks/useDraftStore', () => ({
    clearDraft: vi.fn(),
}));

vi.mock('../../../../../src/server/spa/client/react/contexts/ChatPreferencesContext', () => ({
    useChatPrefs: () => ({
        archivedChatIds: new Set<string>(),
        unarchiveChat: vi.fn(),
    }),
}));

vi.mock('../../../../../src/server/spa/client/react/features/chat/hooks/useTextPaste', () => ({
    CLIENT_PASTE_THRESHOLD: 50000,
}));

vi.mock('../../../../../src/server/spa/client/react/features/chat/hooks/useAttachedContext', () => ({
    formatAttachedContext: () => '',
}));

vi.mock('@plusplusoneplusplus/forge', () => ({}));

import { useSendMessage } from '../../../../../src/server/spa/client/react/features/chat/hooks/useSendMessage';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createOptions(overrides: Record<string, any> = {}) {
    return {
        processId: 'proc-1',
        taskId: 'queue_task-1',
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
            parseAndExtract: (input: string) => ({ skills: [], prompt: input }),
            dismissMenu: vi.fn(),
        },
        followUpInputRef: { current: 'hello world' },
        setFollowUpInput: vi.fn(),
        selectedMode: 'ask' as const,
        selectedModeRef: { current: 'ask' as const },
        images: [] as string[],
        clearImages: vi.fn(),
        toPayload: undefined as (() => any[]) | undefined,
        clearPaste: vi.fn(),
        getPastedContent: () => null,
        lastFailedMessageRef: { current: '' },
        setTask: vi.fn(),
        getAttachedContext: () => [],
        clearAttachedContext: vi.fn(),
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useSendMessage – attachment forwarding', () => {
    beforeEach(() => {
        mockFetch.mockClear();
        mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    });

    it('includes attachments in payload when toPayload returns items', async () => {
        const attachmentPayload = [
            { name: 'file.txt', mimeType: 'text/plain', size: 100, dataUrl: 'data:text/plain;base64,aGVsbG8=' },
        ];
        const toPayload = vi.fn().mockReturnValue(attachmentPayload);

        const options = createOptions({ toPayload });
        const { result } = renderHook(() => useSendMessage(options as any));

        await act(async () => {
            await result.current.sendFollowUp('test message');
        });

        expect(mockFetch).toHaveBeenCalled();
        const fetchCall = mockFetch.mock.calls[0];
        const body = JSON.parse(fetchCall[1].body);
        expect(body.attachments).toEqual(attachmentPayload);
        expect(body.content).toBe('test message');
    });

    it('omits attachments when toPayload returns empty array', async () => {
        const toPayload = vi.fn().mockReturnValue([]);
        const options = createOptions({ toPayload });
        const { result } = renderHook(() => useSendMessage(options as any));

        await act(async () => {
            await result.current.sendFollowUp('test message');
        });

        expect(mockFetch).toHaveBeenCalled();
        const fetchCall = mockFetch.mock.calls[0];
        const body = JSON.parse(fetchCall[1].body);
        expect(body.attachments).toBeUndefined();
    });

    it('omits attachments when toPayload is undefined', async () => {
        const options = createOptions({ toPayload: undefined });
        const { result } = renderHook(() => useSendMessage(options as any));

        await act(async () => {
            await result.current.sendFollowUp('test message');
        });

        expect(mockFetch).toHaveBeenCalled();
        const fetchCall = mockFetch.mock.calls[0];
        const body = JSON.parse(fetchCall[1].body);
        expect(body.attachments).toBeUndefined();
    });

    it('sends both images and attachments when both present', async () => {
        const attachmentPayload = [
            { name: 'code.ts', mimeType: 'text/typescript', size: 50, dataUrl: 'data:text/typescript;base64,Y29uc3Q=' },
        ];
        const toPayload = vi.fn().mockReturnValue(attachmentPayload);
        const options = createOptions({
            toPayload,
            images: ['data:image/png;base64,abc123'],
        });
        const { result } = renderHook(() => useSendMessage(options as any));

        await act(async () => {
            await result.current.sendFollowUp('look at this');
        });

        expect(mockFetch).toHaveBeenCalled();
        const fetchCall = mockFetch.mock.calls[0];
        const body = JSON.parse(fetchCall[1].body);
        expect(body.images).toEqual(['data:image/png;base64,abc123']);
        expect(body.attachments).toEqual(attachmentPayload);
    });

    it('sends attachments during active generation', async () => {
        const attachmentPayload = [
            { name: 'doc.md', mimeType: 'text/markdown', size: 80, dataUrl: 'data:text/markdown;base64,IyBoZWxsbw==' },
        ];
        const toPayload = vi.fn().mockReturnValue(attachmentPayload);
        const options = createOptions({ toPayload, isActiveGeneration: true });
        const { result } = renderHook(() => useSendMessage(options as any));

        await act(async () => {
            await result.current.sendFollowUp('steering message', 'immediate');
        });

        expect(mockFetch).toHaveBeenCalled();
        const fetchCall = mockFetch.mock.calls[0];
        const body = JSON.parse(fetchCall[1].body);
        expect(body.attachments).toEqual(attachmentPayload);
        expect(body.deliveryMode).toBe('immediate');
    });
});
