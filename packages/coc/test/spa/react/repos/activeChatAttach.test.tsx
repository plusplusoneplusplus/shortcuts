/**
 * Routing tests for the "Attach as context" editor pill channel
 * (activeChatAttach): active chat composer subscription, new-chat fallback,
 * workspace isolation, duplicate rejection and focus.
 */
/* @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import React, { createRef } from 'react';
import {
    attachSelectionToChat,
    hasActiveChatAttachSubscriber,
    resetActiveChatAttach,
    subscribeActiveChatAttach,
} from '../../../../src/server/spa/client/react/features/chat/activeChatAttach';
import {
    drainNewChatSeedContext,
    peekNewChatSeedContext,
    resetNewChatSeedContext,
} from '../../../../src/server/spa/client/react/features/chat/newChatSeedContext';
import { createFileSelectionContextItem } from '../../../../src/server/spa/client/react/features/chat/hooks/useAttachedContext';

// Hoist a call tracker so the mock factory can reference it before imports
const { tracker, mockRalphEnabled, mockForEachEnabled, mockSessionContextAttachmentsEnabled, mockGetLlmToolsConfig } = vi.hoisted(() => ({
    tracker: {
        calls: [] as Array<[string, number?]>,
        domValue: '',
        onChange: undefined as undefined | ((val: string, cursorPos: number) => void),
        focusCount: 0,
    },
    mockRalphEnabled: { value: false },
    mockForEachEnabled: { value: false },
    mockSessionContextAttachmentsEnabled: { value: false },
    mockGetLlmToolsConfig: vi.fn(),
}));

// Replace RichTextInput with a minimal stable test double that records setValue calls
vi.mock('../../../../src/server/spa/client/react/shared/RichTextInput', async () => {
    const R = await import('react');
    return {
        RichTextInput: R.forwardRef((props: any, ref: any) => {
            R.useImperativeHandle(ref, () => ({
                getValue: () => tracker.domValue,
                setValue: (text: string, cursorPos?: number) => {
                    tracker.calls.push([text, cursorPos]);
                    tracker.domValue = text;
                },
                focus: () => { tracker.focusCount += 1; },
            }), []);
            tracker.onChange = props.onChange;
            return R.createElement('div', {
                'data-testid': props['data-testid'],
                onKeyDown: props.onKeyDown,
            });
        }),
    };
});

vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    isComposerWordHintEnabled: () => false,
    DASHBOARD_CONFIG_UPDATED_EVENT: 'coc-dashboard-config-updated',
    isRalphEnabled: () => mockRalphEnabled.value,
    isForEachEnabled: () => mockForEachEnabled.value,
    isSessionContextAttachmentsEnabled: () => mockSessionContextAttachmentsEnabled.value,
    getPrewarmDebounceMs: () => 500,
    getWarmClientTtlMs: () => 300000,
}));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        preferences: {
            getLlmToolsConfig: mockGetLlmToolsConfig,
        },
    }),
}));

import { FollowUpInputArea } from '../../../../src/server/spa/client/react/features/chat/FollowUpInputArea';
import type { FollowUpInputAreaProps } from '../../../../src/server/spa/client/react/features/chat/FollowUpInputArea';
import type { RichTextInputHandle } from '../../../../src/server/spa/client/react/shared/RichTextInput';
import {
    createFileSelectionContextPayload,
    FILE_PATH_DRAG_KIND,
    FILE_PATH_DRAG_MIME,
    RALPH_SESSION_CONTEXT_DRAG_KIND,
    RALPH_SESSION_CONTEXT_DRAG_MIME,
    SESSION_CONTEXT_DRAG_KIND,
    SESSION_CONTEXT_DRAG_MIME,
    type RalphSessionContextDragPayload,
    type SessionContextDragPayload,
} from '../../../../src/server/spa/client/react/features/chat/sessionContextDrag';

afterEach(() => {
    vi.restoreAllMocks();
});

beforeEach(() => {
    tracker.calls = [];
    tracker.domValue = '';
    tracker.onChange = undefined;
    tracker.focusCount = 0;
    resetActiveChatAttach();
    resetNewChatSeedContext();
    mockRalphEnabled.value = false;
    mockForEachEnabled.value = false;
    mockSessionContextAttachmentsEnabled.value = false;
    mockGetLlmToolsConfig.mockResolvedValue({
        tools: [{ name: 'get_conversation', label: 'Get Conversation', description: '', enabledByDefault: true }],
        disabledLlmTools: [],
        conversationRetrievalAvailable: true,
    });
    // JSDOM does not implement scrollIntoView
    Element.prototype.scrollIntoView = vi.fn();
});

function makeSessionPayload(overrides: Partial<SessionContextDragPayload> = {}): SessionContextDragPayload {
    return {
        kind: SESSION_CONTEXT_DRAG_KIND,
        version: 1,
        sourceWorkspaceId: 'ws-1',
        sourceProcessId: 'source-process-123456',
        title: 'Source chat',
        status: 'completed',
        lastActivityAt: '2026-01-01T00:00:00.000Z',
        ...overrides,
    };
}

function makeRalphPayload(overrides: Partial<RalphSessionContextDragPayload> = {}): RalphSessionContextDragPayload {
    return {
        kind: RALPH_SESSION_CONTEXT_DRAG_KIND,
        version: 1,
        sourceWorkspaceId: 'ws-1',
        sourceRalphSessionId: 'ralph-session-0001',
        title: 'Ralph source',
        displayLabel: 'Ralph source - 2 iter',
        phase: 'executing',
        status: 'running',
        lastActivityAt: '2026-01-01T00:00:00.000Z',
        childProcessIds: ['grill-proc', 'iter-1', 'iter-2'],
        processCount: 3,
        iterationCount: 2,
        ...overrides,
    };
}

function makeSessionDataTransfer(payload: unknown, mime = SESSION_CONTEXT_DRAG_MIME) {
    return {
        types: [mime],
        dropEffect: 'none',
        getData: vi.fn((format: string) => format === mime ? JSON.stringify(payload) : ''),
    };
}

function makeUnsupportedDataTransfer() {
    return {
        types: ['text/plain'],
        dropEffect: 'none',
        getData: vi.fn(() => 'not coc context'),
    };
}

function makeProps(overrides: Partial<FollowUpInputAreaProps> = {}): FollowUpInputAreaProps {
    return {
        richTextRef: createRef<RichTextInputHandle>(),
        inputDisabled: false,
        sending: false,
        isActiveGeneration: false,
        isCancelling: false,
        error: null,
        resumeFeedback: null,
        suggestions: [],
        followUpInput: '',
        setFollowUpInput: vi.fn(),
        selectedMode: 'ask',
        setSelectedMode: vi.fn(),
        onSend: vi.fn().mockResolvedValue(undefined),
        onRetry: vi.fn(),
        skills: [{ name: 'impl', description: 'Implement' }],
        attachments: [],
        onAttachmentPaste: vi.fn(),
        onAttachmentRemove: vi.fn(),
        onAttachmentFiles: vi.fn(),
        attachmentError: null,
        attachedContext: [],
        onRemoveAttachedContext: vi.fn(),
        onAttachSessionContext: vi.fn(),
        workspaceId: 'ws-1',
        currentProcessId: 'current-process',
        task: null,
        slashCommands: {
            handleInputChange: vi.fn(),
            handleKeyDown: vi.fn(() => false),
            selectSkill: vi.fn(),
            dismissMenu: vi.fn(),
            menuVisible: false,
            menuFilter: '',
            filteredSkills: [],
            highlightIndex: 0,
        },
        ...overrides,
    };
}

function fileSelection(workspaceId = 'ws-1', start = 24, end = 35) {
    const payload = createFileSelectionContextPayload({
        sourceWorkspaceId: workspaceId,
        filePath: 'src/status.rs',
        range: { start, end },
        snippet: 'fn main() {}',
    });
    if (!payload) throw new Error('payload should be valid');
    return payload;
}

describe('activeChatAttach channel', () => {
    it('falls back to the new-chat seed buffer when no chat is subscribed', () => {
        const payload = fileSelection();
        expect(attachSelectionToChat('ws-1', payload)).toBe('new-chat');
        expect(peekNewChatSeedContext()).toEqual([payload]);
    });

    it('delivers to the newest subscriber for the workspace only', () => {
        const older = vi.fn(() => true);
        const newer = vi.fn(() => true);
        const other = vi.fn(() => true);
        subscribeActiveChatAttach('ws-1', older);
        subscribeActiveChatAttach('ws-1', newer);
        subscribeActiveChatAttach('ws-2', other);
        const payload = fileSelection();
        expect(attachSelectionToChat('ws-1', payload)).toBe('active-chat');
        expect(newer).toHaveBeenCalledWith(payload);
        expect(older).not.toHaveBeenCalled();
        expect(other).not.toHaveBeenCalled();
        expect(peekNewChatSeedContext()).toEqual([]);
    });

    it('does not leak into a chat bound to another workspace', () => {
        const other = vi.fn(() => true);
        subscribeActiveChatAttach('ws-2', other);
        expect(attachSelectionToChat('ws-1', fileSelection())).toBe('new-chat');
        expect(other).not.toHaveBeenCalled();
    });

    it('isolates subscribers for remote clones sharing the same raw workspace id', () => {
        const local = vi.fn(() => true);
        const remoteA = vi.fn(() => true);
        const remoteB = vi.fn(() => true);
        const a = subscribeActiveChatAttach('remote:server-a:ws-1', remoteA);
        subscribeActiveChatAttach('ws-1', local);
        subscribeActiveChatAttach('remote:server-b:ws-1', remoteB);
        const payload = fileSelection();

        expect(attachSelectionToChat('remote:server-a:ws-1', payload)).toBe('active-chat');
        expect(remoteA).toHaveBeenCalledWith(payload);
        expect(local).not.toHaveBeenCalled();
        expect(remoteB).not.toHaveBeenCalled();
        expect(payload.sourceWorkspaceId).toBe('ws-1');
        a.bump();
        expect(attachSelectionToChat('remote:server-b:ws-1', payload)).toBe('active-chat');
        expect(remoteB).toHaveBeenCalledWith(payload);
        expect(remoteA).toHaveBeenCalledTimes(1);
        a.unsubscribe();
        expect(hasActiveChatAttachSubscriber('remote:server-a:ws-1')).toBe(false);
        expect(hasActiveChatAttachSubscriber('remote:server-b:ws-1')).toBe(true);
    });

    it.each(['missing', 'declining', 'throwing'] as const)(
        'retains a remote destination on %s-subscriber fallback', behavior => {
            const local = vi.fn(() => true);
            const other = vi.fn(() => true);
            subscribeActiveChatAttach('ws-1', local);
            subscribeActiveChatAttach('remote:server-b:ws-1', other);
            if (behavior !== 'missing') {
                subscribeActiveChatAttach('remote:server-a:ws-1', () => {
                    if (behavior === 'throwing') throw new Error('unavailable composer');
                    return false;
                });
            }
            const payload = fileSelection();
            expect(attachSelectionToChat('remote:server-a:ws-1', payload)).toBe('new-chat');
            expect(local).not.toHaveBeenCalled();
            expect(other).not.toHaveBeenCalled();
            expect(drainNewChatSeedContext('ws-1')).toEqual([]);
            expect(drainNewChatSeedContext('remote:server-b:ws-1')).toEqual([]);
            expect(drainNewChatSeedContext('remote:server-a:ws-1')).toEqual([payload]);
        },
    );

    it('bump makes an older subscriber the target; declined handlers fall through', () => {
        const older = vi.fn(() => true);
        const newer = vi.fn(() => false);
        const a = subscribeActiveChatAttach('ws-1', older);
        subscribeActiveChatAttach('ws-1', newer);
        expect(attachSelectionToChat('ws-1', fileSelection())).toBe('active-chat');
        expect(newer).toHaveBeenCalledTimes(1);
        expect(older).toHaveBeenCalledTimes(1);
        a.bump();
        attachSelectionToChat('ws-1', fileSelection());
        expect(older).toHaveBeenCalledTimes(2);
        expect(newer).toHaveBeenCalledTimes(1);
    });

    it('unsubscribe removes the target', () => {
        const sub = subscribeActiveChatAttach('ws-1', () => true);
        expect(hasActiveChatAttachSubscriber('ws-1')).toBe(true);
        sub.unsubscribe();
        expect(hasActiveChatAttachSubscriber('ws-1')).toBe(false);
        expect(attachSelectionToChat('ws-1', fileSelection())).toBe('new-chat');
    });
});

describe('FollowUpInputArea — editor pill attach', () => {
    it.each([
        { style: { display: 'none' } },
        { style: { visibility: 'hidden' as const } },
        { style: { visibility: 'collapse' as const } },
        { hidden: true },
        { inert: '' },
    ])('skips a mounted composer inside a hidden panel (%j)', async hiddenProps => {
        mockSessionContextAttachmentsEnabled.value = true;
        const visible = vi.fn();
        const hidden = vi.fn();
        render(<FollowUpInputArea {...makeProps({ onAttachSessionContext: visible })} />);
        render(<div {...hiddenProps}><FollowUpInputArea {...makeProps({ onAttachSessionContext: hidden })} /></div>);
        await act(async () => { await Promise.resolve(); });
        tracker.focusCount = 0;

        const payload = fileSelection();
        act(() => { expect(attachSelectionToChat('ws-1', payload)).toBe('active-chat'); });

        expect(visible).toHaveBeenCalledWith(payload);
        expect(hidden).not.toHaveBeenCalled();
        expect(tracker.focusCount).toBe(1);
        expect(peekNewChatSeedContext()).toEqual([]);
    });

    it('seeds a new chat without focusing or changing a hidden composer, then accepts when shown', async () => {
        mockSessionContextAttachmentsEnabled.value = true;
        const onAttachSessionContext = vi.fn();
        const props = makeProps({ onAttachSessionContext });
        const { rerender } = render(<div style={{ display: 'none' }}><FollowUpInputArea {...props} /></div>);
        await act(async () => { await Promise.resolve(); });
        tracker.focusCount = 0;

        const payload = fileSelection();
        act(() => { expect(attachSelectionToChat('ws-1', payload)).toBe('new-chat'); });
        expect(onAttachSessionContext).not.toHaveBeenCalled();
        expect(tracker.focusCount).toBe(0);
        expect(peekNewChatSeedContext()).toEqual([payload]);
        expect(screen.queryByTestId('follow-up-session-context-error')).toBeNull();

        rerender(<div style={{ display: 'contents' }}><FollowUpInputArea {...props} /></div>);
        act(() => { expect(attachSelectionToChat('ws-1', payload)).toBe('active-chat'); });
        expect(onAttachSessionContext).toHaveBeenCalledWith(payload);
        expect(tracker.focusCount).toBe(1);
    });

    it('attaches a routed selection and focuses the chat input', async () => {
        mockSessionContextAttachmentsEnabled.value = true;
        const onAttachSessionContext = vi.fn();
        render(<FollowUpInputArea {...makeProps({ onAttachSessionContext })} />);
        await act(async () => { await Promise.resolve(); });

        const payload = fileSelection();
        let target: string | undefined;
        act(() => { target = attachSelectionToChat('ws-1', payload); });

        expect(target).toBe('active-chat');
        expect(onAttachSessionContext).toHaveBeenCalledWith(payload);
        expect(tracker.focusCount).toBeGreaterThan(0);
        expect(peekNewChatSeedContext()).toEqual([]);
    });

    it('rejects the same file+range twice with the already-attached error', async () => {
        mockSessionContextAttachmentsEnabled.value = true;
        const onAttachSessionContext = vi.fn();
        const payload = fileSelection();
        const existing = createFileSelectionContextItem(payload, 'ctx-1');
        render(<FollowUpInputArea {...makeProps({ onAttachSessionContext, attachedContext: [existing] })} />);
        await act(async () => { await Promise.resolve(); });

        act(() => { attachSelectionToChat('ws-1', fileSelection()); });

        expect(onAttachSessionContext).not.toHaveBeenCalled();
        expect(screen.getByTestId('follow-up-session-context-error').textContent).toMatch(/already attached/);

        act(() => { attachSelectionToChat('ws-1', fileSelection('ws-1', 40, 42)); });
        expect(onAttachSessionContext).toHaveBeenCalledTimes(1);
    });

    it('does not subscribe when the feature flag is off', async () => {
        mockSessionContextAttachmentsEnabled.value = false;
        const onAttachSessionContext = vi.fn();
        render(<FollowUpInputArea {...makeProps({ onAttachSessionContext })} />);
        await act(async () => { await Promise.resolve(); });

        expect(hasActiveChatAttachSubscriber('ws-1')).toBe(false);
        expect(attachSelectionToChat('ws-1', fileSelection())).toBe('new-chat');
        expect(onAttachSessionContext).not.toHaveBeenCalled();
    });

    it('ignores selections from another workspace', async () => {
        mockSessionContextAttachmentsEnabled.value = true;
        const onAttachSessionContext = vi.fn();
        render(<FollowUpInputArea {...makeProps({ onAttachSessionContext })} />);
        await act(async () => { await Promise.resolve(); });

        expect(attachSelectionToChat('ws-2', fileSelection('ws-2'))).toBe('new-chat');
        expect(onAttachSessionContext).not.toHaveBeenCalled();
    });

    it('unsubscribes on unmount', async () => {
        mockSessionContextAttachmentsEnabled.value = true;
        const { unmount } = render(<FollowUpInputArea {...makeProps()} />);
        await act(async () => { await Promise.resolve(); });
        expect(hasActiveChatAttachSubscriber('ws-1')).toBe(true);
        unmount();
        expect(hasActiveChatAttachSubscriber('ws-1')).toBe(false);
    });

    it('focusing a composer makes it the target over a newer one', async () => {
        mockSessionContextAttachmentsEnabled.value = true;
        const first = vi.fn();
        const second = vi.fn();
        render(<FollowUpInputArea {...makeProps({ onAttachSessionContext: first })} />);
        render(<FollowUpInputArea {...makeProps({ onAttachSessionContext: second })} />);
        await act(async () => { await Promise.resolve(); });

        act(() => { attachSelectionToChat('ws-1', fileSelection()); });
        expect(second).toHaveBeenCalledTimes(1);

        fireEvent.focus(screen.getAllByTestId('chat-input-bar')[0]);
        act(() => { attachSelectionToChat('ws-1', fileSelection('ws-1', 1, 2)); });
        expect(first).toHaveBeenCalledTimes(1);
    });
});
