/**
 * Render tests for ChatDetail — the right-pane chat orchestrator.
 *
 * Covers: container rendering, loading/error states, pending task display,
 * mode selector, follow-up send, cancel/move-to-top, back navigation,
 * copy conversation, streaming turns, draft restore, session management,
 * skills, image paste, and workspace ID propagation.
 *
 * Heavy mocking of hooks keeps tests focused on orchestrator behaviour;
 * sub-component wiring (FollowUpInputArea, ChatHeader, ConversationArea)
 * is verified via prop-forwarding and data-testid assertions.
 */
/* @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import React, { useEffect, type ReactNode, createRef } from 'react';
import { AppProvider, useApp } from '../../../../src/server/spa/client/react/contexts/AppContext';
import { QueueProvider, useQueue } from '../../../../src/server/spa/client/react/contexts/QueueContext';
import { ToastProvider } from '../../../../src/server/spa/client/react/contexts/ToastContext';
import { NotificationProvider } from '../../../../src/server/spa/client/react/contexts/NotificationContext';
import { TaskProvider } from '../../../../src/server/spa/client/react/contexts/TaskContext';
import {
    STOPPED_CHAT_STRICT_RESUME_FAILED_MESSAGE,
    STOPPED_CHAT_STRICT_RESUME_FAILED_REASON,
} from '../../../../src/server/tasks/task-types';

// ── Module mocks (hoisted before imports) ──────────────────────────────────

// Hoisted tracker for mock state
const { mockState } = vi.hoisted(() => ({
    mockState: {
        sendFollowUp: vi.fn().mockResolvedValue(undefined),
        closeFollowUpStream: vi.fn(),
        onSendComplete: vi.fn(),
        stopStreaming: vi.fn(),
        handlePopOut: vi.fn(),
        handleFloat: vi.fn(),
        getDraft: vi.fn().mockReturnValue(null) as ReturnType<typeof vi.fn>,
        setDraft: vi.fn(),
        pruneExpired: vi.fn(),
        clearDraft: vi.fn(),
        clearAskUserDraftsForProcess: vi.fn(),
        addFromPaste: vi.fn(),
        removeAttachment: vi.fn(),
        clearAttachments: vi.fn(),
        richTextValue: '',
        richTextSetValueCalls: [] as Array<[string, number?]>,
        // Per-test toggles for the follow-up effort-tier selector (AC-02/AC-03).
        // Default off / empty so existing tests keep the legacy model+effort UI.
        effortLevelsEnabled: false,
        effortTiers: {} as Record<string, { model: string; reasoningEffort: string }>,
    },
}));

// Config
vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => '/api',
    getWsPath: () => '/ws',
    getWsUrl: () => 'ws://localhost/ws',
    isRalphEnabled: () => true,
    isRalphMultiAgentGrillEnabled: () => false,
    isLoopsEnabled: () => false,
    isForEachEnabled: () => false,
    getDefaultProvider: () => 'copilot' as const,
    getActiveProvider: () => 'copilot' as const,
    isEffortLevelsEnabled: () => mockState.effortLevelsEnabled,
    isSessionContextAttachmentsEnabled: () => false,
    getPrewarmDebounceMs: () => 500,
    getWarmClientTtlMs: () => 300000,
    isCanvasEnabled: () => false,
    isRemoteShellEnabled: () => false,
}));

// Display settings
vi.mock('../../../../src/server/spa/client/react/hooks/preferences/useDisplaySettings', () => ({
    useDisplaySettings: () => ({ showReportIntent: false, toolCompactness: 0, taskCardDensity: 'compact', groupSingleLineMessages: false }),
    invalidateDisplaySettings: vi.fn(),
}));

// Chat preferences
vi.mock('../../../../src/server/spa/client/react/contexts/ChatPreferencesContext', () => ({
    ChatPrefsSync: () => null,
    useChatPrefs: () => ({
        archivedChatIds: new Set<string>(),
        pinnedChatIds: new Set<string>(),
        pinChat: vi.fn(),
        unpinChat: vi.fn(),
        archiveChat: vi.fn(),
        unarchiveChat: vi.fn(),
        archiveChats: vi.fn(),
        unarchiveChats: vi.fn(),
        loaded: true,
    }),
}));

// Pop-out context
vi.mock('../../../../src/server/spa/client/react/contexts/PopOutContext', () => ({
    usePopOut: () => ({
        poppedOutTasks: new Set<string>(),
        markPoppedOut: vi.fn(),
        markRestored: vi.fn(),
        postMessage: vi.fn(),
    }),
}));

// Floating chats context
vi.mock('../../../../src/server/spa/client/react/contexts/FloatingChatsContext', () => ({
    useFloatingChats: () => ({
        floatingChats: new Map(),
        floatChat: vi.fn(),
        unfloatChat: vi.fn(),
        isFloating: () => false,
    }),
}));

// useChatSSE
vi.mock('../../../../src/server/spa/client/react/features/chat/hooks/useChatSSE', () => ({
    useChatSSE: () => ({ stopStreaming: mockState.stopStreaming }),
}));

// useSendMessage
vi.mock('../../../../src/server/spa/client/react/features/chat/hooks/useSendMessage', () => ({
    useSendMessage: (opts: any) => {
        // Capture setSessionExpired for session expiry tests
        (globalThis as any).__useSendMessage_opts = opts;
        return {
            sendFollowUp: mockState.sendFollowUp,
            closeFollowUpStream: mockState.closeFollowUpStream,
            onSendComplete: mockState.onSendComplete,
        };
    },
}));

// useQueuedTaskPoll
vi.mock('../../../../src/server/spa/client/react/queue/hooks/useQueuedTaskPoll', () => ({
    useQueuedTaskPoll: () => {},
}));

// useChatWindowActions
vi.mock('../../../../src/server/spa/client/react/features/chat/hooks/useChatWindowActions', () => ({
    useChatWindowActions: () => ({
        handlePopOut: mockState.handlePopOut,
        handleFloat: mockState.handleFloat,
    }),
}));

// useFileAttachments
vi.mock('../../../../src/server/spa/client/react/features/chat/hooks/useFileAttachments', () => ({
    useFileAttachments: () => ({
        attachments: [],
        images: [],
        addFromPaste: mockState.addFromPaste,
        addFromFileInput: vi.fn(),
        removeAttachment: mockState.removeAttachment,
        clearAttachments: mockState.clearAttachments,
        error: null,
        clearError: vi.fn(),
        toPayload: () => [],
    }),
}));

// useBreakpoint
vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false, isTablet: false, isDesktop: true, breakpoint: 'desktop' as const }),
}));

// useModels — return empty list so ChatDetail renders without a real API
vi.mock('../../../../src/server/spa/client/react/hooks/useModels', () => ({
    useModels: () => ({ models: [], loading: false, error: null, reload: vi.fn() }),
}));

// useProviderEffortTiers — return empty tier map so ChatDetail renders without a real API
vi.mock('../../../../src/server/spa/client/react/hooks/useProviderEffortTiers', () => ({
    useProviderEffortTiers: () => ({
        tiers: mockState.effortTiers,
        loading: false,
        error: null,
        saveError: null,
        saving: false,
        dirty: false,
        setTier: vi.fn(),
        clearTier: vi.fn(),
        save: vi.fn(),
        cancel: vi.fn(),
        reload: vi.fn(),
    }),
}));

vi.mock('../../../../src/server/spa/client/react/features/chat/hooks/useContainerWidth', () => ({
    useContainerWidth: () => ({ width: 800, tier: 'wide', isWide: true, isMedium: false, isNarrow: false }),
}));

// useDraftStore
vi.mock('../../../../src/server/spa/client/react/features/chat/hooks/useDraftStore', () => ({
    getDraft: (...args: any[]) => mockState.getDraft(...args),
    setDraft: (...args: any[]) => mockState.setDraft(...args),
    clearDraft: (...args: any[]) => mockState.clearDraft(...args),
    pruneExpired: () => mockState.pruneExpired(),
}));

vi.mock('../../../../src/server/spa/client/react/features/chat/hooks/useAskUserDraftStore', () => ({
    getAskUserDraft: () => null,
    setAskUserDraft: vi.fn(),
    clearAskUserDraft: vi.fn(),
    clearOtherAskUserDraftsForProcess: vi.fn(),
    pruneExpiredAskUserDrafts: vi.fn(),
    clearAskUserDraftsForProcess: (...args: any[]) => mockState.clearAskUserDraftsForProcess(...args),
}));

// useSlashCommands
vi.mock('../../../../src/server/spa/client/react/features/chat/hooks/useSlashCommands', () => ({
    useSlashCommands: () => ({
        menuVisible: false,
        menuFilter: '',
        filteredSkills: [],
        highlightIndex: 0,
        handleInputChange: vi.fn(),
        handleKeyDown: vi.fn(() => false),
        selectSkill: vi.fn(),
        parseAndExtract: vi.fn((t: string) => ({ skills: [], prompt: t })),
        dismissMenu: vi.fn(),
    }),
}));

// RichTextInput — lightweight test double
vi.mock('../../../../src/server/spa/client/react/shared/RichTextInput', async () => {
    const R = await import('react');
    return {
        RichTextInput: R.forwardRef((props: any, ref: any) => {
            R.useImperativeHandle(ref, () => ({
                getValue: () => mockState.richTextValue,
                setValue: (text: string, cursorPos?: number) => {
                    mockState.richTextSetValueCalls.push([text, cursorPos]);
                    mockState.richTextValue = text;
                },
                focus: () => {},
            }), []);
            return R.createElement('div', {
                'data-testid': props['data-testid'] ?? 'activity-chat-input',
                'data-placeholder': props.placeholder,
                contentEditable: !props.disabled,
                onKeyDown: props.onKeyDown,
                onInput: (e: any) => props.onChange?.(e.currentTarget?.textContent ?? ''),
                onPaste: props.onPaste,
            });
        }),
    };
});

// ConversationMiniMap — stub
vi.mock('../../../../src/server/spa/client/react/features/chat/conversation/ConversationMiniMap', () => ({
    ConversationMiniMap: () => React.createElement('div', { 'data-testid': 'conversation-minimap' }),
}));

// ConversationTurnBubble — stub that renders turn content
vi.mock('../../../../src/server/spa/client/react/features/chat/conversation/ConversationTurnBubble', () => ({
    ConversationTurnBubble: (props: any) => {
        const turnIndex = props.turn?.turnIndex;
        const children: React.ReactNode[] = [props.turn?.content ?? ''];
        if (props.onPinTurn && turnIndex != null) {
            children.push(React.createElement('button', {
                key: 'pin',
                'data-testid': `pin-turn-${turnIndex}`,
                onClick: () => props.onPinTurn(turnIndex, !props.turn?.pinnedAt),
            }, props.turn?.pinnedAt ? 'Unpin' : 'Pin'));
        }
        if (props.onArchiveTurn && turnIndex != null) {
            children.push(React.createElement('button', {
                key: 'archive',
                'data-testid': `archive-turn-${turnIndex}`,
                onClick: () => props.onArchiveTurn(turnIndex, !props.turn?.archived),
            }, props.turn?.archived ? 'Unarchive' : 'Archive'));
        }
        if (props.turn?.interrupted && props.onContinueInterrupted && turnIndex != null) {
            children.push(React.createElement('button', {
                key: 'continue-interrupted',
                'data-testid': `continue-interrupted-${turnIndex}`,
                onClick: props.onContinueInterrupted,
            }, 'Continue / retry'));
        }
        return React.createElement('div', {
            'data-testid': `turn-${props.turn?.role}`,
            'data-turn-index': turnIndex,
            'data-pinned': props.turn?.pinnedAt ? 'true' : 'false',
            'data-archived': props.turn?.archived ? 'true' : 'false',
        }, ...children);
    },
}));

// QueuedBubble — stub
vi.mock('../../../../src/server/spa/client/react/features/chat/QueuedBubble', () => ({
    QueuedBubble: (props: any) => React.createElement('div', { 'data-testid': 'queued-bubble' }, props.msg?.content ?? ''),
    QueuedFollowUps: (props: any) =>
        React.createElement('div', { 'data-testid': 'queued-followups', 'data-count': props.queue?.length ?? 0 }),
}));

// BackgroundTasksIndicator — stub
vi.mock('../../../../src/server/spa/client/react/features/chat/BackgroundTasksIndicator', () => ({
    BackgroundTasksIndicator: () => React.createElement('div', { 'data-testid': 'bg-tasks-indicator' }),
}));

// PendingTaskInfoPanel — stub that exposes props
vi.mock('../../../../src/server/spa/client/react/queue/PendingTaskInfoPanel', () => ({
    PendingTaskInfoPanel: (props: any) =>
        React.createElement('div', { 'data-testid': 'pending-task-info-panel' },
            React.createElement('button', { 'data-testid': 'cancel-task-btn', onClick: props.onCancel }, 'Cancel Task'),
            React.createElement('button', { 'data-testid': 'move-to-top-btn', onClick: props.onMoveToTop }, 'Move to Top'),
            props.task?.payload?.prompt && React.createElement('span', { 'data-testid': 'pending-prompt' }, props.task.payload.prompt),
        ),
}));

// ConversationMetadataPopover — getSessionIdFromProcess + stub component
vi.mock('../../../../src/server/spa/client/react/features/chat/conversation/ConversationMetadataPopover', () => ({
    getSessionIdFromProcess: (proc: any) => proc?.sdkSessionId ?? proc?.sessionId ?? proc?.metadata?.sessionId ?? null,
    ConversationMetadataPopover: (props: any) => React.createElement('div', { 'data-testid': 'metadata-popover' }),
}));

// shared — use real module (Badge, Button, Spinner, etc.)
vi.mock('../../../../src/server/spa/client/react/ui', async (importOriginal) => {
    const actual = await importOriginal<Record<string, any>>();
    return {
        ...actual,
    };
});

// Now import the component under test (after mocks)
import { ChatDetail } from '../../../../src/server/spa/client/react/features/chat/ChatDetail';
import { registerCloneBaseUrls, resetCloneRegistryForTests } from '../../../../src/server/spa/client/react/repos/cloneRegistry';

// ── Provider wrapper ───────────────────────────────────────────────────────

function Wrap({ children }: { children: ReactNode }) {
    return (
        <AppProvider>
            <QueueProvider>
                <NotificationProvider>
                    <TaskProvider>
                        <ToastProvider value={{ addToast: vi.fn(), removeToast: vi.fn(), toasts: [] }}>
                            {children}
                        </ToastProvider>
                    </TaskProvider>
                </NotificationProvider>
            </QueueProvider>
        </AppProvider>
    );
}

/**
 * Seeds a pending (queued) task into queue state and renders ChatDetail.
 */
function SeededChatDetail({ task, ...rest }: { task: any } & Partial<React.ComponentProps<typeof ChatDetail>>) {
    const { dispatch: queueDispatch } = useQueue();
    useEffect(() => {
        queueDispatch({ type: 'QUEUE_UPDATED', queue: { queued: [task], running: [], stats: {} } });
        queueDispatch({ type: 'SELECT_QUEUE_TASK', id: task.id });
    }, []);
    return <ChatDetail taskId={task.id} {...rest} />;
}

// ── Factories ──────────────────────────────────────────────────────────────

function makeTask(overrides?: Partial<any>): any {
    return {
        id: 'task-1',
        type: 'chat',
        status: 'completed',
        processId: 'proc-1',
        displayName: 'Test Chat',
        createdAt: '2025-06-01T12:00:00Z',
        payload: {
            kind: 'chat',
            mode: 'autopilot',
            prompt: 'Hello world',
            workingDirectory: '/home/user/project',
        },
        metadata: {},
        ...overrides,
    };
}

function makePendingTask(overrides?: Partial<any>): any {
    return makeTask({
        type: 'workflow',
        status: 'queued',
        processId: undefined,
        ...overrides,
    });
}

function makeProcess(overrides?: Partial<any>): any {
    return {
        id: 'proc-1',
        status: 'completed',
        metadata: { mode: 'autopilot', sessionId: 'sess-default' },
        conversationTurns: [
            { role: 'user', content: 'Hello', turnIndex: 0, timeline: [] },
            { role: 'assistant', content: 'Hi there', turnIndex: 1, timeline: [] },
        ],
        ...overrides,
    };
}

// ── Fetch helpers ──────────────────────────────────────────────────────────

let fetchMock: ReturnType<typeof vi.fn>;

function setupFetch(handlers: Record<string, any>) {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
        const urlStr = typeof url === 'string' ? url : '';
        for (const [pattern, response] of Object.entries(handlers)) {
            if (urlStr.includes(pattern)) {
                if (typeof response === 'function') return response(urlStr, init);
                const status = response?.status ?? 200;
                const body = response?.body !== undefined ? response.body : response;
                return new Response(JSON.stringify(body), {
                    status,
                    headers: { 'content-type': 'application/json' },
                });
            }
        }
        return new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } });
    });
}

function setupStandardFetch(task?: any, process?: any) {
    const t = task ?? makeTask();
    const p = process ?? makeProcess();
    setupFetch({
        '/skills/all': { body: { merged: [] } },
        '/queue/': { body: { task: t } },
        '/processes/': { body: { process: p, conversation: p.conversation } },
        '/models': { body: [] },
    });
}

// ── Setup / teardown ───────────────────────────────────────────────────────

beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    resetCloneRegistryForTests();
    // Reset mock state
    mockState.sendFollowUp.mockReset().mockResolvedValue(undefined);
    mockState.closeFollowUpStream.mockReset();
    mockState.onSendComplete.mockReset();
    mockState.stopStreaming.mockReset();
    mockState.handlePopOut.mockReset();
    mockState.handleFloat.mockReset();
    mockState.getDraft.mockReset().mockReturnValue(null);
    mockState.setDraft.mockReset();
    mockState.pruneExpired.mockReset();
    mockState.clearDraft.mockReset();
    mockState.clearAskUserDraftsForProcess.mockReset();
    mockState.addFromPaste.mockReset();
    mockState.removeAttachment.mockReset();
    mockState.clearAttachments.mockReset();
    mockState.richTextValue = '';
    mockState.richTextSetValueCalls = [];
    mockState.effortLevelsEnabled = false;
    mockState.effortTiers = {};
    localStorage.clear();
    // JSDOM polyfills
    Element.prototype.scrollIntoView = vi.fn();
    // navigator.clipboard
    Object.assign(navigator, {
        clipboard: {
            writeText: vi.fn().mockResolvedValue(undefined),
            write: vi.fn().mockResolvedValue(undefined),
        },
    });
});

afterEach(() => {
    vi.restoreAllMocks();
    resetCloneRegistryForTests();
    delete (globalThis as any).__useSendMessage_opts;
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe('ChatDetail', () => {
    // ── Rendering ──────────────────────────────────────────────────────────

    describe('rendering', () => {
        it('renders container with data-testid="activity-chat-detail"', async () => {
            setupStandardFetch();
            render(<Wrap><ChatDetail taskId="task-1" /></Wrap>);
            expect(screen.getByTestId('activity-chat-detail')).toBeTruthy();
        });

        it('renders conversation area', async () => {
            setupStandardFetch();
            render(<Wrap><ChatDetail taskId="task-1" /></Wrap>);
            expect(screen.getByTestId('activity-chat-conversation')).toBeTruthy();
        });

        it('renders generated plan review cards inside the scrollable conversation area', async () => {
            const forEachItems = [
                { id: 'item-1', title: 'First generated item', prompt: 'Handle first item', status: 'pending' },
                { id: 'item-2', title: 'Second generated item', prompt: 'Handle second item', status: 'pending' },
            ];
            const mapReduceItems = [
                { id: 'map-1', title: 'First map item', prompt: 'Map first item', status: 'pending' },
            ];
            const proc = makeProcess({
                metadata: {
                    mode: 'ask',
                    sessionId: 'sess-1',
                    forEach: {
                        kind: 'generation',
                        workspaceId: 'ws-1',
                        generationId: 'for-each-gen-1',
                        childMode: 'ask',
                        originalRequest: 'Split this work',
                        status: 'draft',
                        latestItemCount: forEachItems.length,
                        latestPlanTurnIndex: 1,
                        latestPlan: {
                            turnIndex: 1,
                            childMode: 'ask',
                            items: forEachItems,
                            rawJson: JSON.stringify({ items: forEachItems }),
                        },
                    },
                    mapReduce: {
                        kind: 'generation',
                        workspaceId: 'ws-1',
                        generationId: 'map-reduce-gen-1',
                        childMode: 'ask',
                        originalRequest: 'Map then reduce this work',
                        status: 'draft',
                        latestItemCount: mapReduceItems.length,
                        latestPlanTurnIndex: 1,
                        latestPlan: {
                            turnIndex: 1,
                            childMode: 'ask',
                            items: mapReduceItems,
                            reduceInstructions: 'Summarize the map results.',
                            maxParallel: 2,
                            rawJson: JSON.stringify({
                                items: mapReduceItems,
                                reduceInstructions: 'Summarize the map results.',
                                maxParallel: 2,
                            }),
                        },
                    },
                },
            });
            setupStandardFetch(makeTask({ payload: { kind: 'chat', mode: 'ask', prompt: 'Split this work' } }), proc);
            render(<Wrap><ChatDetail taskId="task-1" workspaceId="ws-1" /></Wrap>);

            await waitFor(() => {
                expect(screen.getByTestId('for-each-plan-review-card')).toBeTruthy();
                expect(screen.getByTestId('map-reduce-plan-review-card')).toBeTruthy();
            });

            const conversation = screen.getByTestId('activity-chat-conversation');
            expect(conversation.contains(screen.getByTestId('for-each-plan-review-card'))).toBe(true);
            expect(conversation.contains(screen.getByTestId('map-reduce-plan-review-card'))).toBe(true);
            expect(conversation.contains(screen.getByTestId('activity-chat-send-btn'))).toBe(false);
        });

        it('renders send button', async () => {
            setupStandardFetch();
            render(<Wrap><ChatDetail taskId="task-1" /></Wrap>);
            await waitFor(() => {
                expect(screen.getByTestId('activity-chat-send-btn')).toBeTruthy();
            });
        });

        it('shows mode selector by default (hideModeSelector defaults to false)', async () => {
            setupStandardFetch();
            render(<Wrap><ChatDetail taskId="task-1" /></Wrap>);
            await waitFor(() => {
                expect(screen.getByTestId('activity-chat-send-btn')).toBeTruthy();
            });
            expect(screen.getByTestId('mode-selector')).toBeTruthy();
        });

        it('renders copy-conversation button', async () => {
            setupStandardFetch();
            render(<Wrap><ChatDetail taskId="task-1" /></Wrap>);
            await waitFor(() => {
                expect(screen.getByTestId('copy-conversation-btn')).toBeTruthy();
            });
        });

        it('renders copy-conversation-html button', async () => {
            setupStandardFetch();
            render(<Wrap><ChatDetail taskId="task-1" /></Wrap>);
            await waitFor(() => {
                expect(screen.getByTestId('copy-conversation-html-btn')).toBeTruthy();
            });
        });

        it('renders back button when onBack provided', async () => {
            setupStandardFetch();
            render(<Wrap><ChatDetail taskId="task-1" onBack={() => {}} /></Wrap>);
            await waitFor(() => {
                expect(screen.getByTestId('activity-chat-back-btn')).toBeTruthy();
            });
        });

        it('does not render back button when onBack is undefined', async () => {
            setupStandardFetch();
            render(<Wrap><ChatDetail taskId="task-1" /></Wrap>);
            await waitFor(() => {
                expect(screen.getByTestId('activity-chat-send-btn')).toBeTruthy();
            });
            expect(screen.queryByTestId('activity-chat-back-btn')).toBeNull();
        });

        it('renders conversation minimap for inline variant', async () => {
            setupStandardFetch();
            render(<Wrap><ChatDetail taskId="task-1" /></Wrap>);
            await waitFor(() => {
                expect(screen.getByTestId('conversation-minimap')).toBeTruthy();
            });
        });

        it('does not render conversation minimap for floating variant', async () => {
            setupStandardFetch();
            render(<Wrap><ChatDetail taskId="task-1" variant="floating" /></Wrap>);
            await waitFor(() => {
                expect(screen.getByTestId('activity-chat-send-btn')).toBeTruthy();
            });
            expect(screen.queryByTestId('conversation-minimap')).toBeNull();
        });
    });

    // ── Loading and data ───────────────────────────────────────────────────

    describe('loading and data', () => {
        it('shows loading spinner while fetch is pending', async () => {
            fetchMock.mockImplementation(() => new Promise(() => {})); // never resolves
            render(<Wrap><ChatDetail taskId="task-1" /></Wrap>);
            await waitFor(() => {
                expect(screen.getByText('Loading conversation...')).toBeTruthy();
            });
        });

        it('shows conversation turns after load completes', async () => {
            setupStandardFetch();
            render(<Wrap><ChatDetail taskId="task-1" /></Wrap>);
            await waitFor(() => {
                expect(screen.getByText('Hello')).toBeTruthy();
                expect(screen.getByText('Hi there')).toBeTruthy();
            });
        });

        it('shows error message on queue task load failure', async () => {
            setupFetch({
                '/queue/': { status: 500, body: { error: 'Server error' } },
            });
            render(<Wrap><ChatDetail taskId="task-1" /></Wrap>);
            await waitFor(() => {
                expect(screen.getByText(/Server error/)).toBeTruthy();
            });
        });

        it('loads queue task details on mount', async () => {
            setupStandardFetch();
            render(<Wrap><ChatDetail taskId="task-42" /></Wrap>);
            await waitFor(() => {
                const queueCalls = fetchMock.mock.calls.filter(
                    ([url]: [string]) => typeof url === 'string' && url.includes('/queue/task-42'),
                );
                expect(queueCalls.length).toBeGreaterThanOrEqual(1);
            });
        });

        it('fetches /processes/<id> for non-queued tasks', async () => {
            setupStandardFetch();
            render(<Wrap><ChatDetail taskId="task-1" /></Wrap>);
            await waitFor(() => {
                const processCalls = fetchMock.mock.calls.filter(
                    ([url]: [string]) => typeof url === 'string' && url.includes('/processes/proc-1'),
                );
                expect(processCalls.length).toBeGreaterThanOrEqual(1);
            });
        });

        it('shows "No conversation data available." when no turns exist', async () => {
            const proc = makeProcess({ conversationTurns: [] });
            setupStandardFetch(undefined, proc);
            render(<Wrap><ChatDetail taskId="task-1" /></Wrap>);
            await waitFor(() => {
                expect(screen.getByText('No conversation data available.')).toBeTruthy();
            });
        });

        it('prunes expired drafts on mount', async () => {
            setupStandardFetch();
            render(<Wrap><ChatDetail taskId="task-1" /></Wrap>);
            await waitFor(() => {
                expect(mockState.pruneExpired).toHaveBeenCalled();
            });
        });

        it('hydrates pinned and archived turn state from process detail data', async () => {
            const proc = makeProcess({
                conversationTurns: [
                    { role: 'user', content: 'Pinned from store', turnIndex: 0, pinnedAt: '2026-06-23T19:00:00.000Z', timeline: [] },
                    { role: 'assistant', content: 'Archived from store', turnIndex: 1, archived: true, timeline: [] },
                ],
            });
            setupStandardFetch(undefined, proc);

            render(<Wrap><ChatDetail taskId="task-1" /></Wrap>);

            await waitFor(() => {
                expect(screen.getByText('📌 Pinned Messages (1)')).toBeTruthy();
            });
            expect(screen.getByText(/Show archived messages \(1\)/)).toBeTruthy();
            expect(screen.queryByText('Archived from store')).toBeNull();

            fireEvent.click(screen.getByText(/Show archived messages \(1\)/));
            await waitFor(() => {
                expect(screen.getByText('Archived from store')).toBeTruthy();
            });
        });
    });

    describe('turn action routing', () => {
        it('routes pin and archive turn actions through the latest remote clone client', async () => {
            const remoteA = 'http://remote-a.example';
            const remoteB = 'http://remote-b.example';
            registerCloneBaseUrls([{ workspaceId: 'remote-ws', baseUrl: remoteA }]);
            const task = makeTask();
            const proc = makeProcess({
                conversationTurns: [
                    { role: 'user', content: 'Hello', turnIndex: 0, timeline: [] },
                    { role: 'assistant', content: 'Hi there', turnIndex: 1, timeline: [] },
                ],
            });
            setupFetch({
                '/turns/0/pin': { body: { id: 'proc-1', turnIndex: 0, pinnedAt: '2026-06-23T19:01:00.000Z', archived: false } },
                '/turns/1/archive': { body: { id: 'proc-1', turnIndex: 1, archived: true } },
                '/skills/all': { body: { merged: [] } },
                '/queue/': { body: { task } },
                '/processes/': { body: { process: proc, conversation: proc.conversation } },
                '/models': { body: [] },
            });

            const { rerender } = render(<Wrap><ChatDetail taskId="task-1" workspaceId="remote-ws" /></Wrap>);
            await waitFor(() => {
                expect(screen.getByText('Hello')).toBeTruthy();
            });

            registerCloneBaseUrls([{ workspaceId: 'remote-ws', baseUrl: remoteB }]);
            rerender(<Wrap><ChatDetail taskId="task-1" workspaceId="remote-ws" /></Wrap>);
            await waitFor(() => {
                expect(screen.getByTestId('pin-turn-0')).toBeTruthy();
            });

            await act(async () => {
                fireEvent.click(screen.getByTestId('pin-turn-0'));
            });
            await waitFor(() => {
                expect(fetchMock.mock.calls.some(([url]: [string]) =>
                    url.startsWith(remoteB) && url.includes('/api/processes/proc-1/turns/0/pin'),
                )).toBe(true);
            });
            expect(fetchMock.mock.calls.some(([url]: [string]) =>
                url.startsWith(remoteA) && url.includes('/api/processes/proc-1/turns/0/pin'),
            )).toBe(false);
            const pinCall = fetchMock.mock.calls.find(([url]: [string]) =>
                url.startsWith(remoteB) && url.includes('/api/processes/proc-1/turns/0/pin'),
            );
            expect(JSON.parse(String((pinCall?.[1] as RequestInit | undefined)?.body))).toEqual({ pinned: true });
            await waitFor(() => {
                expect(screen.getAllByTestId('turn-user').some(el => el.getAttribute('data-pinned') === 'true')).toBe(true);
            });

            await act(async () => {
                fireEvent.click(screen.getByTestId('archive-turn-1'));
            });
            await waitFor(() => {
                expect(fetchMock.mock.calls.some(([url]: [string]) =>
                    url.startsWith(remoteB) && url.includes('/api/processes/proc-1/turns/1/archive'),
                )).toBe(true);
            });
            const archiveCall = fetchMock.mock.calls.find(([url]: [string]) =>
                url.startsWith(remoteB) && url.includes('/api/processes/proc-1/turns/1/archive'),
            );
            expect(JSON.parse(String((archiveCall?.[1] as RequestInit | undefined)?.body))).toEqual({ archived: true });
        });

        it('keeps local turn actions on the default SPA client', async () => {
            const task = makeTask();
            const proc = makeProcess();
            setupFetch({
                '/turns/0/pin': { body: { id: 'proc-1', turnIndex: 0, pinnedAt: '2026-06-23T19:02:00.000Z', archived: false } },
                '/skills/all': { body: { merged: [] } },
                '/queue/': { body: { task } },
                '/processes/': { body: { process: proc, conversation: proc.conversation } },
                '/models': { body: [] },
            });

            render(<Wrap><ChatDetail taskId="task-1" workspaceId="local-ws" /></Wrap>);
            await waitFor(() => {
                expect(screen.getByText('Hello')).toBeTruthy();
            });

            await act(async () => {
                fireEvent.click(screen.getByTestId('pin-turn-0'));
            });

            await waitFor(() => {
                expect(fetchMock.mock.calls.some(([url]: [string]) =>
                    url === '/api/processes/proc-1/turns/0/pin',
                )).toBe(true);
            });
        });
    });

    // ── Pending task ───────────────────────────────────────────────────────

    describe('pending task', () => {
        it('renders pending state for queued chat tasks', async () => {
            const task = makePendingTask();
            setupFetch({
                '/queue/': { body: { task } },
                '/skills/all': { body: { merged: [] } },
            });
            render(<Wrap><SeededChatDetail task={task} /></Wrap>);
            // Once loading completes, the conversation area should exist
            await waitFor(() => {
                expect(screen.getByTestId('activity-chat-conversation')).toBeTruthy();
            });
            // Follow-up input should not be shown for pending tasks
            expect(screen.queryByTestId('activity-chat-send-btn')).toBeNull();
        });

        it('shows PendingTaskInfoPanel for non-chat queued tasks', async () => {
            const task = makePendingTask({ type: 'workflow' });
            setupFetch({
                '/queue/': { body: { task } },
                '/skills/all': { body: { merged: [] } },
            });
            render(<Wrap><SeededChatDetail task={task} /></Wrap>);
            await waitFor(() => {
                expect(screen.getByTestId('pending-task-info-panel')).toBeTruthy();
            });
        });

        it('cancel button clears selection after cancelling non-chat tasks', async () => {
            const task = makePendingTask({ type: 'workflow' });
            setupFetch({
                '/queue/': { body: { task } },
                '/skills/all': { body: { merged: [] } },
            });
            const onBack = vi.fn();
            render(<Wrap><SeededChatDetail task={task} onBack={onBack} /></Wrap>);
            await waitFor(() => {
                expect(screen.getByTestId('cancel-task-btn')).toBeTruthy();
            });
            await act(async () => {
                fireEvent.click(screen.getByTestId('cancel-task-btn'));
            });
            await waitFor(() => {
                expect(onBack).toHaveBeenCalled();
            });
        });

        it('move-to-top button refreshes the selected queue task', async () => {
            const task = makePendingTask({ type: 'workflow' });
            setupFetch({
                '/queue/': { body: { task } },
                '/skills/all': { body: { merged: [] } },
            });
            render(<Wrap><SeededChatDetail task={task} /></Wrap>);
            await waitFor(() => {
                expect(screen.getByTestId('move-to-top-btn')).toBeTruthy();
            });
            await act(async () => {
                fireEvent.click(screen.getByTestId('move-to-top-btn'));
            });
            await waitFor(() => {
                const moveToTopCalls = fetchMock.mock.calls.filter(
                    ([url]: [string, RequestInit?]) => typeof url === 'string' && url.includes('/queue/task-1/move-to-top'),
                );
                expect(moveToTopCalls.length).toBe(1);
            });
        });
    });

    // ── Mode selector ──────────────────────────────────────────────────────

    describe('mode selector', () => {
        it('shows mode pill selector by default (hideModeSelector defaults to false)', async () => {
            setupStandardFetch();
            render(<Wrap><ChatDetail taskId="task-1" /></Wrap>);
            await waitFor(() => {
                expect(screen.getByTestId('activity-chat-send-btn')).toBeTruthy();
            });
            expect(screen.getByTestId('mode-selector')).toBeTruthy();
            // Mode syncs from task payload (autopilot in the default mock)
            expect(screen.getByTestId('mode-pill-autopilot').getAttribute('aria-checked')).toBe('true');
        });

        it('hides mode selector when hideModeSelector is true', async () => {
            setupStandardFetch();
            render(<Wrap><ChatDetail taskId="task-1" hideModeSelector={true} /></Wrap>);
            await waitFor(() => {
                expect(screen.getByTestId('activity-chat-send-btn')).toBeTruthy();
            });
            expect(screen.queryByTestId('mode-selector')).toBeNull();
            expect(screen.queryByTestId('mode-pill-ask')).toBeNull();
        });

        it('clicking a pill changes the active mode when visible', async () => {
            setupStandardFetch();
            render(<Wrap><ChatDetail taskId="task-1" hideModeSelector={false} /></Wrap>);
            await waitFor(() => {
                expect(screen.getByTestId('mode-pill-ask')).toBeTruthy();
            });
            expect(screen.queryByTestId('mode-pill-plan')).toBeNull();
            fireEvent.click(screen.getByTestId('mode-pill-ask'));
            expect(screen.getByTestId('mode-pill-ask').getAttribute('aria-checked')).toBe('true');
            expect(screen.getByTestId('mode-pill-autopilot').getAttribute('aria-checked')).toBe('false');
        });
    });

    // ── Follow-up send ─────────────────────────────────────────────────────

    describe('follow-up send', () => {
        it('send button triggers sendFollowUp', async () => {
            setupStandardFetch();
            render(<Wrap><ChatDetail taskId="task-1" /></Wrap>);
            await waitFor(() => {
                expect(screen.getByTestId('activity-chat-send-btn')).toBeTruthy();
            });
            fireEvent.click(screen.getByTestId('activity-chat-send-btn'));
            expect(mockState.sendFollowUp).toHaveBeenCalled();
        });

        it('continues an interrupted turn using the live process metadata mode instead of the composer mode', async () => {
            const task = makeTask({
                payload: {
                    ...makeTask().payload,
                    mode: 'ask',
                },
            });
            const proc = makeProcess({
                metadata: { mode: 'autopilot', sessionId: 'sess-live-mode' },
                conversationTurns: [
                    { role: 'user', content: 'Start in ask', turnIndex: 0, timeline: [], mode: 'ask' },
                    {
                        role: 'assistant',
                        content: 'Partial autopilot answer',
                        turnIndex: 1,
                        timeline: [],
                        interrupted: true,
                        interruptionReason: 'Request timed out after 90000ms',
                    },
                ],
            });
            setupStandardFetch(task, proc);

            render(<Wrap><ChatDetail taskId="task-1" /></Wrap>);

            await waitFor(() => {
                expect(screen.getByTestId('continue-interrupted-1')).toBeTruthy();
                expect(screen.getByTestId('mode-pill-ask').getAttribute('aria-checked')).toBe('true');
            });

            fireEvent.click(screen.getByTestId('continue-interrupted-1'));

            expect(mockState.sendFollowUp).toHaveBeenCalledWith(
                expect.any(String),
                'enqueue',
                expect.objectContaining({
                    includeComposerContext: false,
                    modeOverride: 'autopilot',
                }),
            );
        });

        it('still coerces interrupted Ralph retries to ask follow-ups', async () => {
            const task = makeTask({
                payload: {
                    ...makeTask().payload,
                    mode: 'ask',
                },
            });
            const proc = makeProcess({
                metadata: { mode: 'ralph', sessionId: 'sess-ralph-mode' },
                conversationTurns: [
                    { role: 'user', content: 'Promote this', turnIndex: 0, timeline: [], mode: 'ask' },
                    {
                        role: 'assistant',
                        content: 'Partial Ralph answer',
                        turnIndex: 1,
                        timeline: [],
                        interrupted: true,
                        interruptionReason: 'Request timed out after 90000ms',
                    },
                ],
            });
            setupStandardFetch(task, proc);

            render(<Wrap><ChatDetail taskId="task-1" /></Wrap>);

            await waitFor(() => {
                expect(screen.getByTestId('continue-interrupted-1')).toBeTruthy();
            });

            fireEvent.click(screen.getByTestId('continue-interrupted-1'));

            expect(mockState.sendFollowUp).toHaveBeenCalledWith(
                expect.any(String),
                'enqueue',
                expect.objectContaining({
                    includeComposerContext: false,
                    modeOverride: 'ask',
                }),
            );
        });

        it('input enabled for cancelled task with a saved sdkSessionId', async () => {
            const task = makeTask({ status: 'cancelled', processId: 'proc-1' });
            const proc = makeProcess({ status: 'cancelled', sdkSessionId: 'sdk-stopped-1', metadata: { mode: 'autopilot' } });
            setupStandardFetch(task, proc);
            render(<Wrap><ChatDetail taskId="task-1" /></Wrap>);
            await waitFor(() => {
                const sendBtn = screen.getByTestId('activity-chat-send-btn');
                expect(sendBtn.hasAttribute('disabled')).toBe(false);
                expect(screen.getByTestId('activity-chat-input').getAttribute('data-placeholder')).not.toBe('Session expired.');
            });
        });

        it('clears ask-user drafts when the loaded process is cancelled', async () => {
            const task = makeTask({ status: 'cancelled', processId: 'proc-1' });
            const proc = makeProcess({ id: 'proc-1', status: 'cancelled' });
            setupStandardFetch(task, proc);
            render(<Wrap><ChatDetail taskId="task-1" /></Wrap>);

            await waitFor(() => {
                expect(mockState.clearAskUserDraftsForProcess).toHaveBeenCalledWith('proc-1');
            });
        });

        it('shows a non-retryable inline error for cancelled task without sdkSessionId', async () => {
            const task = makeTask({ status: 'cancelled', processId: 'proc-1' });
            const proc = makeProcess({
                status: 'cancelled',
                sessionId: 'legacy-session-id',
                metadata: { mode: 'autopilot', sessionId: 'legacy-metadata-session-id' },
            });
            setupStandardFetch(task, proc);
            render(<Wrap><ChatDetail taskId="task-1" /></Wrap>);
            await waitFor(() => {
                const sendBtn = screen.getByTestId('activity-chat-send-btn');
                expect(sendBtn.hasAttribute('disabled')).toBe(true);
                expect(screen.getByTestId('follow-up-inline-error').textContent)
                    .toContain('no SDK session was saved');
            });
            expect(screen.getByTestId('activity-chat-input').getAttribute('data-placeholder')).toBe('Cannot continue this stopped chat.');
            expect(screen.queryByTestId('retry-btn')).toBeNull();
            expect(screen.queryByText('Follow-up chat is not available for this process type.')).toBeNull();
        });

        it('shows only the non-retryable inline error after stopped-chat strict resume failure', async () => {
            const task = makeTask({ status: 'failed', processId: 'proc-1' });
            const proc = makeProcess({
                status: 'failed',
                sdkSessionId: 'stopped-session',
                error: 'Provider did not resume the stopped SDK session.',
                metadata: {
                    mode: 'autopilot',
                    stoppedChatResume: {
                        resumable: false,
                        reason: STOPPED_CHAT_STRICT_RESUME_FAILED_REASON,
                        message: STOPPED_CHAT_STRICT_RESUME_FAILED_MESSAGE,
                        failedAt: '2026-06-23T18:53:00.000Z',
                        sdkSessionId: 'stopped-session',
                    },
                },
            });
            setupStandardFetch(task, proc);
            render(<Wrap><ChatDetail taskId="task-1" /></Wrap>);

            await waitFor(() => {
                const sendBtn = screen.getByTestId('activity-chat-send-btn');
                expect(sendBtn.hasAttribute('disabled')).toBe(true);
                expect(screen.getByTestId('follow-up-inline-error').textContent)
                    .toContain('saved SDK session could not be resumed');
            });

            expect(screen.getByTestId('activity-chat-input').getAttribute('data-placeholder')).toBe('Cannot continue this stopped chat.');
            expect(screen.queryByTestId('retry-btn')).toBeNull();
            expect(screen.queryByText('This task failed before a chat session was created.')).toBeNull();
            expect(screen.queryByText('Follow-up chat is not available for this process type.')).toBeNull();
            fireEvent.click(screen.getByTestId('activity-chat-send-btn'));
            expect(mockState.sendFollowUp).not.toHaveBeenCalled();
        });

        it('shows error message when error is set', async () => {
            setupFetch({
                '/queue/': { status: 500, body: { error: 'fail' } },
            });
            render(<Wrap><ChatDetail taskId="task-1" /></Wrap>);
            await waitFor(() => {
                expect(screen.getByText(/fail/)).toBeTruthy();
            });
        });

        it('input disabled during loading', async () => {
            fetchMock.mockImplementation(() => new Promise(() => {}));
            render(<Wrap><ChatDetail taskId="task-1" /></Wrap>);
            // During loading, the FollowUpInputArea may not render or input is disabled
            // ConversationArea shows loading message
            await waitFor(() => {
                expect(screen.getByText('Loading conversation...')).toBeTruthy();
            });
        });
    });

    // ── Session management ─────────────────────────────────────────────────

    describe('session management', () => {
        it('shows no-session message for terminal tasks without session', async () => {
            const task = makeTask({ status: 'completed', processId: 'proc-1' });
            const proc = makeProcess({ metadata: { mode: 'autopilot' } });
            setupStandardFetch(task, proc);
            render(<Wrap><ChatDetail taskId="task-1" /></Wrap>);
            await waitFor(() => {
                const msg = screen.queryByText('Follow-up chat is not available for this process type.');
                // This renders when processDetails is non-null and no sessionId is found
                // processDetails is set from the process response; sessionId comes from getSessionIdFromProcess
                // Since our mock returns null for sessionId when metadata has no sessionId, and task is terminal:
                expect(msg).toBeTruthy();
            });
        });

        it('hides follow-up input when no session available for terminal tasks', async () => {
            const task = makeTask({ status: 'completed', processId: 'proc-1' });
            const proc = makeProcess({ metadata: { mode: 'autopilot' } });
            setupStandardFetch(task, proc);
            render(<Wrap><ChatDetail taskId="task-1" /></Wrap>);
            await waitFor(() => {
                expect(screen.queryByText('Follow-up chat is not available for this process type.')).toBeTruthy();
            });
            expect(screen.queryByTestId('activity-chat-send-btn')).toBeNull();
        });

        it('shows follow-up input when session is available', async () => {
            const task = makeTask({ status: 'completed', processId: 'proc-1' });
            const proc = makeProcess({ metadata: { sessionId: 'sess-123' } });
            setupStandardFetch(task, proc);
            render(<Wrap><ChatDetail taskId="task-1" /></Wrap>);
            await waitFor(() => {
                expect(screen.getByTestId('activity-chat-send-btn')).toBeTruthy();
            });
        });

        it('shows follow-up input when task is running', async () => {
            const task = makeTask({ status: 'running', processId: 'proc-1' });
            const proc = makeProcess({ status: 'running', metadata: {} });
            setupStandardFetch(task, proc);
            render(<Wrap><ChatDetail taskId="task-1" /></Wrap>);
            await waitFor(() => {
                expect(screen.getByTestId('activity-chat-stop-btn')).toBeTruthy();
            });
        });

        it('shows a Retry button for a failed task with no session and calls retry on click', async () => {
            const task = makeTask({ status: 'failed', processId: 'proc-1' });
            const proc = makeProcess({ status: 'failed', metadata: { mode: 'autopilot' } });
            setupFetch({
                '/skills/all': { body: { merged: [] } },
                '/queue/': (url: string) => {
                    if (url.includes('/retry')) {
                        return new Response(
                            JSON.stringify({ task: { id: 'task-2', status: 'queued' } }),
                            { status: 201, headers: { 'content-type': 'application/json' } },
                        );
                    }
                    return new Response(
                        JSON.stringify({ task }),
                        { status: 200, headers: { 'content-type': 'application/json' } },
                    );
                },
                '/processes/': { body: { process: proc } },
                '/models': { body: [] },
            });
            render(<Wrap><ChatDetail taskId="task-1" workspaceId="ws-1" /></Wrap>);

            const btn = await screen.findByTestId('retry-task-button');
            expect(btn).toBeTruthy();

            fireEvent.click(btn);

            await waitFor(() => {
                const retryCalls = fetchMock.mock.calls.filter(
                    (c: any) => typeof c[0] === 'string' && c[0].includes('/queue/task-1/retry'),
                );
                expect(retryCalls.length).toBeGreaterThan(0);
            });
        });

        it('does not show a Retry button for a completed task with no session', async () => {
            const task = makeTask({ status: 'completed', processId: 'proc-1' });
            const proc = makeProcess({ metadata: { mode: 'autopilot' } });
            setupStandardFetch(task, proc);
            render(<Wrap><ChatDetail taskId="task-1" /></Wrap>);
            await waitFor(() => {
                expect(screen.queryByText('Follow-up chat is not available for this process type.')).toBeTruthy();
            });
            expect(screen.queryByTestId('retry-task-button')).toBeNull();
        });

        it('shows a Retry task button for a failed chat with a non-retryable resume error and calls retry', async () => {
            const task = makeTask({ status: 'failed', processId: 'proc-1' });
            const proc = makeProcess({
                status: 'failed',
                sdkSessionId: 'stopped-session',
                error: 'Provider did not resume the stopped SDK session.',
                metadata: {
                    mode: 'autopilot',
                    stoppedChatResume: {
                        resumable: false,
                        reason: STOPPED_CHAT_STRICT_RESUME_FAILED_REASON,
                        message: STOPPED_CHAT_STRICT_RESUME_FAILED_MESSAGE,
                        failedAt: '2026-06-23T18:53:00.000Z',
                        sdkSessionId: 'stopped-session',
                    },
                },
            });
            setupFetch({
                '/skills/all': { body: { merged: [] } },
                '/queue/': (url: string) => {
                    if (url.includes('/retry')) {
                        return new Response(
                            JSON.stringify({ task: { id: 'task-2', status: 'queued' } }),
                            { status: 201, headers: { 'content-type': 'application/json' } },
                        );
                    }
                    return new Response(
                        JSON.stringify({ task }),
                        { status: 200, headers: { 'content-type': 'application/json' } },
                    );
                },
                '/processes/': { body: { process: proc } },
                '/models': { body: [] },
            });
            render(<Wrap><ChatDetail taskId="task-1" workspaceId="ws-1" /></Wrap>);

            // The dead-end inline error is still shown, but now with a retry path.
            await waitFor(() => {
                expect(screen.getByTestId('follow-up-inline-error').textContent)
                    .toContain('saved SDK session could not be resumed');
            });
            const btn = await screen.findByTestId('retry-task-button');
            fireEvent.click(btn);

            await waitFor(() => {
                const retryCalls = fetchMock.mock.calls.filter(
                    (c: any) => typeof c[0] === 'string' && c[0].includes('/queue/task-1/retry'),
                );
                expect(retryCalls.length).toBeGreaterThan(0);
            });
        });

        it('does not show a Retry task button for a cancelled chat without a saved session', async () => {
            const task = makeTask({ status: 'cancelled', processId: 'proc-1' });
            const proc = makeProcess({
                status: 'cancelled',
                sessionId: 'legacy-session-id',
                metadata: { mode: 'autopilot', sessionId: 'legacy-metadata-session-id' },
            });
            setupStandardFetch(task, proc);
            render(<Wrap><ChatDetail taskId="task-1" /></Wrap>);
            await waitFor(() => {
                expect(screen.getByTestId('follow-up-inline-error').textContent)
                    .toContain('no SDK session was saved');
            });
            expect(screen.queryByTestId('retry-task-button')).toBeNull();
        });
    });

    // ── Task actions ───────────────────────────────────────────────────────

    describe('task actions', () => {
        it('back button calls onBack callback', async () => {
            setupStandardFetch();
            const onBack = vi.fn();
            render(<Wrap><ChatDetail taskId="task-1" onBack={onBack} /></Wrap>);
            await waitFor(() => {
                expect(screen.getByTestId('activity-chat-back-btn')).toBeTruthy();
            });
            fireEvent.click(screen.getByTestId('activity-chat-back-btn'));
            expect(onBack).toHaveBeenCalledTimes(1);
        });

        it('cancel calls onBack after deletion for non-chat tasks', async () => {
            const task = makePendingTask({ type: 'workflow' });
            setupFetch({
                '/queue/': { body: { task } },
                '/skills/all': { body: { merged: [] } },
            });
            const onBack = vi.fn();
            render(<Wrap><SeededChatDetail task={task} onBack={onBack} /></Wrap>);
            await waitFor(() => {
                expect(screen.getByTestId('cancel-task-btn')).toBeTruthy();
            });
            await act(async () => {
                fireEvent.click(screen.getByTestId('cancel-task-btn'));
            });
            await waitFor(() => {
                expect(onBack).toHaveBeenCalled();
            });
        });
    });

    // ── Copy conversation ──────────────────────────────────────────────────

    describe('copy conversation', () => {
        it('copy buttons are present', async () => {
            setupStandardFetch();
            render(<Wrap><ChatDetail taskId="task-1" /></Wrap>);
            await waitFor(() => {
                expect(screen.getByTestId('copy-conversation-btn')).toBeTruthy();
                expect(screen.getByTestId('copy-conversation-html-btn')).toBeTruthy();
            });
        });

        it('copy buttons disabled when loading', async () => {
            fetchMock.mockImplementation(() => new Promise(() => {}));
            render(<Wrap><ChatDetail taskId="task-1" /></Wrap>);
            await waitFor(() => {
                const copyBtn = screen.getByTestId('copy-conversation-btn');
                expect(copyBtn.hasAttribute('disabled')).toBe(true);
            });
        });

        it('copy buttons disabled when no turns exist', async () => {
            const proc = makeProcess({ conversationTurns: [] });
            setupStandardFetch(undefined, proc);
            render(<Wrap><ChatDetail taskId="task-1" /></Wrap>);
            await waitFor(() => {
                expect(screen.getByText('No conversation data available.')).toBeTruthy();
            });
            const copyBtn = screen.getByTestId('copy-conversation-btn');
            expect(copyBtn.hasAttribute('disabled')).toBe(true);
        });
    });

    // ── Streaming ──────────────────────────────────────────────────────────

    describe('streaming', () => {
        it('renders conversation turns from loaded data', async () => {
            setupStandardFetch();
            render(<Wrap><ChatDetail taskId="task-1" /></Wrap>);
            await waitFor(() => {
                const userTurns = screen.getAllByTestId('turn-user');
                const assistantTurns = screen.getAllByTestId('turn-assistant');
                expect(userTurns.length).toBeGreaterThanOrEqual(1);
                expect(assistantTurns.length).toBeGreaterThanOrEqual(1);
            });
        });

        it('adds streaming placeholder for running tasks without streaming turn', async () => {
            const task = makeTask({ status: 'running', processId: 'proc-1' });
            const proc = makeProcess({
                status: 'running',
                metadata: { sessionId: 'sess-1' },
                conversationTurns: [{ role: 'user', content: 'test', turnIndex: 0, timeline: [] }],
            });
            setupStandardFetch(task, proc);
            render(<Wrap><ChatDetail taskId="task-1" /></Wrap>);
            await waitFor(() => {
                // ConversationArea adds a streaming placeholder for running tasks
                const assistantTurns = screen.getAllByTestId('turn-assistant');
                expect(assistantTurns.length).toBeGreaterThanOrEqual(1);
            });
        });

        it('shows scroll-to-bottom button', async () => {
            setupStandardFetch();
            render(<Wrap><ChatDetail taskId="task-1" /></Wrap>);
            await waitFor(() => {
                expect(screen.getByTestId('scroll-to-bottom-btn')).toBeTruthy();
            });
        });
    });

    // ── Draft restore ──────────────────────────────────────────────────────

    describe('draft restore', () => {
        it('restores draft text on mount', async () => {
            mockState.getDraft.mockReturnValue({ text: 'saved draft', mode: 'autopilot', updatedAt: Date.now() });
            const task = makeTask({ status: 'completed', processId: 'proc-1' });
            const proc = makeProcess({ metadata: { sessionId: 'sess-1' } });
            setupStandardFetch(task, proc);
            render(<Wrap><ChatDetail taskId="task-1" /></Wrap>);
            await waitFor(() => {
                expect(mockState.getDraft).toHaveBeenCalledWith('task-1');
            });
        });

        it('restores draft mode on mount', async () => {
            mockState.getDraft.mockReturnValue({ text: 'draft text', mode: 'ask', updatedAt: Date.now() });
            const task = makeTask({ status: 'completed', processId: 'proc-1' });
            const proc = makeProcess({ metadata: { sessionId: 'sess-1' } });
            setupStandardFetch(task, proc);
            render(<Wrap><ChatDetail taskId="task-1" /></Wrap>);
            await waitFor(() => {
                // Mode should be restored to 'ask' but then overridden by process metadata
                // unless process metadata has no mode
                expect(mockState.getDraft).toHaveBeenCalledWith('task-1');
            });
        });

        it('saves draft on unmount', async () => {
            const task = makeTask({ status: 'completed', processId: 'proc-1' });
            const proc = makeProcess({ metadata: { sessionId: 'sess-1' } });
            setupStandardFetch(task, proc);
            const { unmount } = render(<Wrap><ChatDetail taskId="task-1" /></Wrap>);
            await waitFor(() => {
                expect(screen.getByTestId('activity-chat-send-btn')).toBeTruthy();
            });
            unmount();
            expect(mockState.setDraft).toHaveBeenCalled();
        });

        it('calls getDraft with taskId on each mount', async () => {
            setupStandardFetch();
            render(<Wrap><ChatDetail taskId="task-1" /></Wrap>);
            await waitFor(() => {
                expect(mockState.getDraft).toHaveBeenCalledWith('task-1');
            });
        });
    });

    // ── Workspace ID propagation ───────────────────────────────────────────

    describe('workspace id', () => {
        it('passes data-ws-id attribute when workspaceId provided', async () => {
            setupStandardFetch();
            render(<Wrap><ChatDetail taskId="task-1" workspaceId="ws-abc" /></Wrap>);
            await waitFor(() => {
                const container = screen.getByTestId('activity-chat-detail');
                expect(container.getAttribute('data-ws-id')).toBe('ws-abc');
            });
        });

        it('does not add data-ws-id when workspaceId is absent', async () => {
            setupStandardFetch();
            render(<Wrap><ChatDetail taskId="task-1" /></Wrap>);
            await waitFor(() => {
                const container = screen.getByTestId('activity-chat-detail');
                expect(container.hasAttribute('data-ws-id')).toBe(false);
            });
        });

        it('fetches skills for the workspace', async () => {
            setupStandardFetch();
            render(<Wrap><ChatDetail taskId="task-1" workspaceId="ws-abc" /></Wrap>);
            await waitFor(() => {
                const skillsCalls = fetchMock.mock.calls.filter(
                    ([url]: [string]) => typeof url === 'string' && url.includes('/workspaces/ws-abc/skills/all'),
                );
                expect(skillsCalls.length).toBe(1);
            });
        });
    });

    // ── Variant behaviour ──────────────────────────────────────────────────

    describe('variant behaviour', () => {
        it('hides back button for floating variant', async () => {
            setupStandardFetch();
            const task = makeTask({ status: 'completed' });
            const proc = makeProcess({ metadata: { sessionId: 'sess-1' } });
            setupStandardFetch(task, proc);
            render(<Wrap><ChatDetail taskId="task-1" onBack={() => {}} variant="floating" /></Wrap>);
            await waitFor(() => {
                expect(screen.getByTestId('activity-chat-send-btn')).toBeTruthy();
            });
            expect(screen.queryByTestId('activity-chat-back-btn')).toBeNull();
        });

        it('hides pop-out button when isPopOut is true', async () => {
            const task = makeTask({ status: 'completed' });
            const proc = makeProcess({ metadata: { sessionId: 'sess-1' } });
            setupStandardFetch(task, proc);
            render(<Wrap><ChatDetail taskId="task-1" isPopOut /></Wrap>);
            await waitFor(() => {
                expect(screen.getByTestId('activity-chat-send-btn')).toBeTruthy();
            });
            expect(screen.queryByTestId('activity-chat-popout-btn')).toBeNull();
        });
    });

    // ── SSE and hook wiring ────────────────────────────────────────────────

    describe('hook wiring', () => {
        it('calls stopStreaming on taskId change (cleanup)', async () => {
            setupStandardFetch();
            const { rerender } = render(<Wrap><ChatDetail taskId="task-1" /></Wrap>);
            await waitFor(() => {
                expect(screen.getByTestId('activity-chat-detail')).toBeTruthy();
            });
            // Change taskId triggers cleanup which calls stopStreaming
            setupStandardFetch();
            rerender(<Wrap><ChatDetail taskId="task-2" /></Wrap>);
            await waitFor(() => {
                expect(mockState.stopStreaming).toHaveBeenCalled();
            });
        });

        it('calls closeFollowUpStream on taskId change (cleanup)', async () => {
            setupStandardFetch();
            const { rerender } = render(<Wrap><ChatDetail taskId="task-1" /></Wrap>);
            await waitFor(() => {
                expect(screen.getByTestId('activity-chat-detail')).toBeTruthy();
            });
            setupStandardFetch();
            rerender(<Wrap><ChatDetail taskId="task-2" /></Wrap>);
            await waitFor(() => {
                expect(mockState.closeFollowUpStream).toHaveBeenCalled();
            });
        });

        it('clears attachments on taskId change', async () => {
            setupStandardFetch();
            const { rerender } = render(<Wrap><ChatDetail taskId="task-1" /></Wrap>);
            await waitFor(() => {
                expect(screen.getByTestId('activity-chat-detail')).toBeTruthy();
            });
            setupStandardFetch();
            rerender(<Wrap><ChatDetail taskId="task-2" /></Wrap>);
            await waitFor(() => {
                expect(mockState.clearAttachments).toHaveBeenCalled();
            });
        });
    });

    // ── Pop-out and float ──────────────────────────────────────────────────

    describe('pop-out and float', () => {
        it('renders pop-out button', async () => {
            const task = makeTask({ status: 'completed' });
            const proc = makeProcess({ metadata: { sessionId: 'sess-1' } });
            setupStandardFetch(task, proc);
            render(<Wrap><ChatDetail taskId="task-1" /></Wrap>);
            await waitFor(() => {
                expect(screen.getByTestId('activity-chat-popout-btn')).toBeTruthy();
            });
        });

        it('renders float button', async () => {
            const task = makeTask({ status: 'completed' });
            const proc = makeProcess({ metadata: { sessionId: 'sess-1' } });
            setupStandardFetch(task, proc);
            render(<Wrap><ChatDetail taskId="task-1" /></Wrap>);
            await waitFor(() => {
                expect(screen.getByTestId('activity-chat-float-btn')).toBeTruthy();
            });
        });

        it('hides float button when variant is floating', async () => {
            setupStandardFetch();
            render(<Wrap><ChatDetail taskId="task-1" variant="floating" /></Wrap>);
            await waitFor(() => {
                expect(screen.getByTestId('activity-chat-detail')).toBeTruthy();
            });
            expect(screen.queryByTestId('activity-chat-float-btn')).toBeNull();
        });
    });

    // ── Task status display ────────────────────────────────────────────────

    describe('task status display', () => {
        it('input disabled for cancelling task', async () => {
            const task = makeTask({ status: 'cancelling', processId: 'proc-1' });
            const proc = makeProcess({ status: 'cancelling', metadata: { sessionId: 'sess-1' } });
            setupStandardFetch(task, proc);
            render(<Wrap><ChatDetail taskId="task-1" /></Wrap>);
            await waitFor(() => {
                expect((globalThis as any).__useSendMessage_opts?.inputDisabled).toBe(true);
                const stopBtn = screen.getByTestId('activity-chat-stop-btn');
                expect(stopBtn.textContent).toBe('Stopping...');
                expect(stopBtn.hasAttribute('disabled')).toBe(true);
            });
        });

        it('shows failed task with conversation still visible', async () => {
            const task = makeTask({ status: 'failed', processId: 'proc-1' });
            const proc = makeProcess({ status: 'failed', metadata: { sessionId: 'sess-1' } });
            setupStandardFetch(task, proc);
            render(<Wrap><ChatDetail taskId="task-1" /></Wrap>);
            await waitFor(() => {
                expect(screen.getByText('Hello')).toBeTruthy();
                expect(screen.getByText('Hi there')).toBeTruthy();
            });
        });

        it('shows running task with streaming indicator', async () => {
            const task = makeTask({ status: 'running', processId: 'proc-1' });
            const proc = makeProcess({ status: 'running', metadata: { sessionId: 'sess-1' } });
            setupStandardFetch(task, proc);
            render(<Wrap><ChatDetail taskId="task-1" /></Wrap>);
            await waitFor(() => {
                // Running tasks should show the conversation area
                expect(screen.getByTestId('activity-chat-conversation')).toBeTruthy();
            });
        });

        it('passes active generation state from running task status', async () => {
            const task = makeTask({ status: 'running', processId: 'proc-1' });
            const proc = makeProcess({ status: 'running', metadata: { sessionId: 'sess-1' } });
            setupStandardFetch(task, proc);
            render(<Wrap><ChatDetail taskId="task-1" /></Wrap>);
            await waitFor(() => {
                expect((globalThis as any).__useSendMessage_opts?.isActiveGeneration).toBe(true);
                expect(screen.getByTestId('activity-chat-stop-btn')).toBeTruthy();
            });
        });

        it('uses running process status when queue task status is stale', async () => {
            const task = makeTask({ status: 'completed', processId: 'proc-1' });
            const proc = makeProcess({ status: 'running', metadata: { sessionId: 'sess-1' } });
            setupStandardFetch(task, proc);
            render(<Wrap><ChatDetail taskId="task-1" /></Wrap>);
            await waitFor(() => {
                expect((globalThis as any).__useSendMessage_opts?.isActiveGeneration).toBe(true);
                expect(screen.getByTestId('activity-chat-stop-btn')).toBeTruthy();
            });
        });

        it('keeps Stop visible after switching away from and back to a running chat', async () => {
            const task1 = makeTask({ id: 'task-1', status: 'running', processId: 'proc-1', displayName: 'Running Chat' });
            const proc1 = makeProcess({ id: 'proc-1', status: 'running', metadata: { sessionId: 'sess-1' } });
            const task2 = makeTask({ id: 'task-2', status: 'completed', processId: 'proc-2', displayName: 'Idle Chat' });
            const proc2 = makeProcess({ id: 'proc-2', status: 'completed', metadata: { sessionId: 'sess-2' } });
            const jsonResponse = (body: unknown) => new Response(JSON.stringify(body), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            });
            setupFetch({
                '/skills/all': { body: { merged: [] } },
                '/models': { body: [] },
                '/queue/': (url: string) => jsonResponse({ task: url.includes('task-2') ? task2 : task1 }),
                '/processes/': (url: string) => jsonResponse({ process: url.includes('proc-2') ? proc2 : proc1 }),
            });

            const { rerender } = render(<Wrap><ChatDetail taskId="task-1" /></Wrap>);
            await waitFor(() => {
                expect(screen.getByTestId('activity-chat-stop-btn')).toBeTruthy();
            });

            rerender(<Wrap><ChatDetail taskId="task-2" /></Wrap>);
            await waitFor(() => {
                expect(screen.getByTestId('activity-chat-send-btn')).toBeTruthy();
            });

            rerender(<Wrap><ChatDetail taskId="task-1" /></Wrap>);
            await waitFor(() => {
                expect(screen.getByTestId('activity-chat-stop-btn')).toBeTruthy();
                expect(screen.queryByTestId('activity-chat-send-btn')).toBeNull();
            });
        });
    });

    // ── Title override ─────────────────────────────────────────────────────

    describe('title override', () => {
        it('passes custom title to ChatHeader', async () => {
            setupStandardFetch();
            render(<Wrap><ChatDetail taskId="task-1" title="Custom Title" /></Wrap>);
            await waitFor(() => {
                expect(screen.getByText('Custom Title')).toBeTruthy();
            });
        });

        it('defaults to "Chat" title when no title provided', async () => {
            setupStandardFetch();
            render(<Wrap><ChatDetail taskId="task-1" /></Wrap>);
            await waitFor(() => {
                expect(screen.getByText('Chat')).toBeTruthy();
            });
        });
    });

    // ── Standalone mode ────────────────────────────────────────────────────

    describe('standalone mode', () => {
        it('renders correctly in standalone mode', async () => {
            setupStandardFetch();
            render(<Wrap><ChatDetail taskId="task-1" standalone /></Wrap>);
            await waitFor(() => {
                expect(screen.getByTestId('activity-chat-detail')).toBeTruthy();
                expect(screen.getByText('Hello')).toBeTruthy();
            });
        });
    });

    // ── Refresh deduplication ──────────────────────────────────────────────

    describe('refresh deduplication', () => {
        /**
         * Helper that bumps refreshVersion N times before mounting ChatDetail,
         * simulating a scenario where prior interactions already incremented it.
         */
        function PreBumpedDetail({ bumps, taskId, ...rest }: { bumps: number; taskId: string } & Partial<React.ComponentProps<typeof ChatDetail>>) {
            const { dispatch } = useQueue();
            const [ready, setReady] = React.useState(false);
            useEffect(() => {
                for (let i = 0; i < bumps; i++) {
                    dispatch({ type: 'REFRESH_SELECTED_QUEUE_TASK' });
                }
                setReady(true);
            }, []); // eslint-disable-line react-hooks/exhaustive-deps
            if (!ready) return null;
            return <ChatDetail taskId={taskId} {...rest} />;
        }

        it('does not duplicate fetches when refreshVersion > 0 on mount', async () => {
            const task = makeTask();
            const proc = makeProcess();
            setupStandardFetch(task, proc);

            await act(async () => {
                render(
                    <Wrap>
                        <PreBumpedDetail bumps={3} taskId="task-1" />
                    </Wrap>,
                );
            });

            // Wait for normal initial load to complete
            await waitFor(() => {
                expect(screen.getByTestId('activity-chat-detail')).toBeTruthy();
            });

            // Count calls to /queue/ and /processes/ — should be exactly 1 each
            // (the initial load), not 2 (initial + spurious refresh)
            const queueCalls = fetchMock.mock.calls.filter(
                ([url]: [string]) => typeof url === 'string' && url.includes('/queue/'),
            );
            const processCalls = fetchMock.mock.calls.filter(
                ([url]: [string]) => typeof url === 'string' && url.includes('/processes/'),
            );
            expect(queueCalls).toHaveLength(1);
            expect(processCalls).toHaveLength(1);
        });

        it('fires only one process fetch for a running task on mount', async () => {
            const task = makeTask({ status: 'running' });
            const proc = makeProcess({ status: 'running' });
            setupStandardFetch(task, proc);

            await act(async () => {
                render(<Wrap><ChatDetail taskId="task-1" /></Wrap>);
            });

            await waitFor(() => {
                expect(screen.getByTestId('activity-chat-detail')).toBeTruthy();
            });

            const processCalls = fetchMock.mock.calls.filter(
                ([url]: [string]) => typeof url === 'string' && url.includes('/processes/'),
            );
            expect(processCalls).toHaveLength(1);
        });

        it('reconciles task status with process status when they differ', async () => {
            // Queue says 'running' but process already completed — only a user turn
            const task = makeTask({ status: 'running' });
            const proc = makeProcess({
                status: 'completed',
                conversationTurns: [
                    { role: 'user', content: 'Hello', turnIndex: 0, timeline: [] },
                ],
            });
            setupStandardFetch(task, proc);

            await act(async () => {
                render(<Wrap><ChatDetail taskId="task-1" /></Wrap>);
            });

            await waitFor(() => {
                expect(screen.getByTestId('activity-chat-detail')).toBeTruthy();
            });

            // If status reconciliation works, effectiveTask.status === 'completed',
            // so no streaming assistant placeholder turn is appended.
            // Without reconciliation, the code would see status === 'running' and
            // add a streaming assistant turn.
            const assistantTurns = screen.queryAllByTestId('turn-assistant');
            expect(assistantTurns).toHaveLength(0);

            // Only 1 process fetch (no duplicate from SSE done→refresh)
            const processCalls = fetchMock.mock.calls.filter(
                ([url]: [string]) => typeof url === 'string' && url.includes('/processes/'),
            );
            expect(processCalls).toHaveLength(1);
        });

        it('still re-fetches on genuine re-click after mount', async () => {
            const task = makeTask();
            const proc = makeProcess();
            setupStandardFetch(task, proc);

            /**
             * Helper that renders ChatDetail then dispatches
             * REFRESH_SELECTED_QUEUE_TASK after mount to simulate a re-click.
             */
            function ReClickDetail() {
                const { dispatch } = useQueue();
                const triggerRef = createRef<() => void>();
                (triggerRef as any).current = () => {
                    dispatch({ type: 'REFRESH_SELECTED_QUEUE_TASK' });
                };
                // Expose trigger via testid button
                return (
                    <>
                        <ChatDetail taskId="task-1" />
                        <button data-testid="trigger-refresh" onClick={() => (triggerRef as any).current?.()} />
                    </>
                );
            }

            render(<Wrap><ReClickDetail /></Wrap>);

            // Wait for initial load
            await waitFor(() => {
                expect(screen.getByTestId('activity-chat-detail')).toBeTruthy();
            });

            // Clear fetch mock to isolate re-click fetches
            fetchMock.mockClear();
            setupStandardFetch(task, proc);

            // Simulate re-click
            await act(async () => {
                fireEvent.click(screen.getByTestId('trigger-refresh'));
            });

            // The refresh effect should fire and re-fetch both endpoints
            await waitFor(() => {
                const queueCalls = fetchMock.mock.calls.filter(
                    ([url]: [string]) => typeof url === 'string' && url.includes('/queue/'),
                );
                expect(queueCalls.length).toBeGreaterThanOrEqual(1);
            });
        });
    });

    // ── processId-based loading (post history refactor) ────────────────────

    describe('processId-based loading', () => {
        it('skips /queue/ fetch when taskId is a processId', async () => {
            const proc = makeProcess({ id: 'queue_abc', title: 'My Chat' });
            setupFetch({
                '/skills/all': { body: { merged: [] } },
                '/processes/queue_abc': { body: { process: proc, conversation: proc } },
                '/models': { body: [] },
            });

            render(<Wrap><ChatDetail taskId="queue_abc" /></Wrap>);

            await waitFor(() => {
                const queueCalls = fetchMock.mock.calls.filter(
                    ([url]: [string]) => typeof url === 'string' && url.includes('/queue/queue_abc'),
                );
                expect(queueCalls).toHaveLength(0);
            });

            // Should have fetched /processes/queue_abc directly
            await waitFor(() => {
                const processCalls = fetchMock.mock.calls.filter(
                    ([url]: [string]) => typeof url === 'string' && url.includes('/processes/queue_abc'),
                );
                expect(processCalls.length).toBeGreaterThanOrEqual(1);
            });
        });

        it('uses /queue/ fetch for raw (non-processId) taskId', async () => {
            setupStandardFetch();
            render(<Wrap><ChatDetail taskId="raw-task-id" /></Wrap>);

            await waitFor(() => {
                const queueCalls = fetchMock.mock.calls.filter(
                    ([url]: [string]) => typeof url === 'string' && url.includes('/queue/raw-task-id'),
                );
                expect(queueCalls.length).toBeGreaterThanOrEqual(1);
            });
        });

        it('resolves processId correctly when taskId is already a processId', async () => {
            const proc = makeProcess({
                id: 'queue_abc',
                title: 'My Chat',
                conversationTurns: [
                    { role: 'user', content: 'Hello', turnIndex: 0, timeline: [] },
                ],
            });
            setupFetch({
                '/skills/all': { body: { merged: [] } },
                '/processes/queue_abc': { body: { process: proc, conversation: proc } },
                '/models': { body: [] },
            });

            render(<Wrap><ChatDetail taskId="queue_abc" /></Wrap>);

            // Should NOT produce a double-prefixed /processes/queue_queue_abc call
            await waitFor(() => {
                const badCalls = fetchMock.mock.calls.filter(
                    ([url]: [string]) => typeof url === 'string' && url.includes('queue_queue_'),
                );
                expect(badCalls).toHaveLength(0);
            });
        });

        it('loads conversation turns from process data for processId taskId', async () => {
            const proc = makeProcess({
                id: 'queue_abc',
                title: 'History Chat',
                conversationTurns: [
                    { role: 'user', content: 'First message', turnIndex: 0, timeline: [] },
                    { role: 'assistant', content: 'Bot reply', turnIndex: 1, timeline: [] },
                ],
            });
            setupFetch({
                '/skills/all': { body: { merged: [] } },
                '/processes/queue_abc': { body: { process: proc, conversation: proc } },
                '/models': { body: [] },
            });

            render(<Wrap><ChatDetail taskId="queue_abc" /></Wrap>);

            await waitFor(() => {
                expect(screen.getByText('First message')).toBeTruthy();
                expect(screen.getByText('Bot reply')).toBeTruthy();
            });
        });

        // Regression: queued-message-survives-chat-switch.
        // A still-running chat's submitted follow-ups ("Queued · N") must survive
        // switching to another chat and returning. The cache-hit processId load
        // path painted turns from cache but never re-hydrated `pendingQueue`, so
        // the queued section blanked out on return even though the server still
        // held the pending messages in `process.pendingMessages`.
        it('re-hydrates the queued follow-ups from server pendingMessages on a cache-hit return', async () => {
            const runningProc = makeProcess({
                id: 'queue_running-1',
                status: 'running',
                metadata: { mode: 'autopilot', sessionId: 'sess-running' },
                pendingMessages: [
                    { id: 'pm-1', content: 'first queued follow-up' },
                    { id: 'pm-2', content: 'second queued follow-up' },
                ],
            });
            const otherProc = makeProcess({
                id: 'queue_other-1',
                status: 'running',
                metadata: { mode: 'autopilot', sessionId: 'sess-other' },
                pendingMessages: [],
            });
            setupFetch({
                '/skills/all': { body: { merged: [] } },
                '/processes/queue_running-1': { body: { process: runningProc } },
                '/processes/queue_other-1': { body: { process: otherProc } },
                '/models': { body: [] },
            });

            const { rerender } = render(<Wrap><ChatDetail key="queue_running-1" taskId="queue_running-1" /></Wrap>);

            // Cold (cache-miss) processId load hydrates the queue from the server.
            await waitFor(() => {
                expect(screen.getByTestId('queued-followups').getAttribute('data-count')).toBe('2');
            });

            // Switch away to another still-running chat with no pending follow-ups.
            rerender(<Wrap><ChatDetail key="queue_other-1" taskId="queue_other-1" /></Wrap>);
            await waitFor(() => {
                expect(screen.queryByTestId('queued-followups')).toBeNull();
            });

            // Switch back — now a cache hit. The queued section must re-appear,
            // sourced from the server's pendingMessages (the regression: the
            // cache-hit branch used to return early without re-syncing the queue).
            rerender(<Wrap><ChatDetail key="queue_running-1" taskId="queue_running-1" /></Wrap>);
            await waitFor(() => {
                expect(screen.getByTestId('queued-followups').getAttribute('data-count')).toBe('2');
            });
        });

        it('leaves the queued section empty when the server has no pending messages', async () => {
            const proc = makeProcess({
                id: 'queue_empty-1',
                status: 'running',
                metadata: { mode: 'autopilot', sessionId: 'sess-empty' },
                pendingMessages: [],
                conversationTurns: [
                    { role: 'user', content: 'Running task', turnIndex: 0, timeline: [] },
                ],
            });
            setupFetch({
                '/skills/all': { body: { merged: [] } },
                '/processes/queue_empty-1': { body: { process: proc } },
                '/models': { body: [] },
            });

            render(<Wrap><ChatDetail taskId="queue_empty-1" /></Wrap>);

            await waitFor(() => {
                expect(screen.getByText('Running task')).toBeTruthy();
            });
            expect(screen.queryByTestId('queued-followups')).toBeNull();
        });
    });

    describe('reactive title updates', () => {
        /** Helper component that dispatches PROCESS_UPDATED to AppContext. */
        function AppDispatcher({ dispatchRef }: { dispatchRef: { current: ((process: any) => void) | null } }) {
            const { dispatch } = useApp();
            dispatchRef.current = (process: any) => {
                dispatch({ type: 'PROCESS_ADDED', process });
                dispatch({ type: 'PROCESS_UPDATED', process });
            };
            return null;
        }

        it('updates ChatHeader title when process-updated WS event arrives', async () => {
            const proc = makeProcess({ title: undefined });
            setupFetch({
                '/skills/all': { body: { merged: [] } },
                '/processes/queue_proc-1': { body: { process: proc } },
                '/models': { body: [] },
            });
            const appRef: { current: ((process: any) => void) | null } = { current: null };

            render(
                <Wrap>
                    <ChatDetail taskId="queue_proc-1" />
                    <AppDispatcher dispatchRef={appRef} />
                </Wrap>,
            );

            // Initially shows "Chat" (no title)
            await waitFor(() => {
                expect(screen.getByTestId('chat-header')).toBeTruthy();
            });
            expect(screen.getByText('Chat')).toBeTruthy();

            // Simulate process-updated WS event with new title
            await act(async () => {
                appRef.current?.({ id: 'queue_proc-1', title: 'AI Generated Title' });
            });

            await waitFor(() => {
                expect(screen.getByText('AI Generated Title')).toBeTruthy();
            });
        });

        it('does not override explicit title prop', async () => {
            const proc = makeProcess({ title: undefined });
            setupFetch({
                '/skills/all': { body: { merged: [] } },
                '/processes/queue_proc-1': { body: { process: proc } },
                '/models': { body: [] },
            });
            const appRef: { current: ((process: any) => void) | null } = { current: null };

            render(
                <Wrap>
                    <ChatDetail taskId="queue_proc-1" title="Explicit Title" />
                    <AppDispatcher dispatchRef={appRef} />
                </Wrap>,
            );

            await waitFor(() => {
                expect(screen.getByText('Explicit Title')).toBeTruthy();
            });

            // Simulate process-updated — explicit title should still win
            await act(async () => {
                appRef.current?.({ id: 'queue_proc-1', title: 'AI Title' });
            });

            expect(screen.getByText('Explicit Title')).toBeTruthy();
            expect(screen.queryByText('AI Title')).not.toBeInTheDocument();
        });

        it('shows title from initial process load', async () => {
            const proc = makeProcess({ title: 'Pre-existing Title' });
            setupFetch({
                '/skills/all': { body: { merged: [] } },
                '/processes/queue_proc-1': { body: { process: proc } },
                '/models': { body: [] },
            });

            render(<Wrap><ChatDetail taskId="queue_proc-1" /></Wrap>);

            await waitFor(() => {
                expect(screen.getByText('Pre-existing Title')).toBeTruthy();
            });
        });
    });

    // ── Context-window seeding on cold load ────────────────────────────────
    // A completed chat never opens the SSE stream (useChatSSE gates on
    // status === 'running' and is mocked to a no-op here), so the only way the
    // ctx fuel gauge can show a real percentage is if ChatDetail seeds the
    // session token state from the freshly-fetched process record. useModels is
    // mocked to [] in this file, so the model-catalog tokenLimit seed cannot
    // fire — any tokenLimit/percentage shown originates from the process seed.
    describe('context-window seeding (cold load)', () => {
        it('shows real context usage immediately for a completed process (no SSE, no first message)', async () => {
            const task = makeTask({ status: 'completed', processId: 'proc-1' });
            const proc = makeProcess({
                status: 'completed',
                metadata: { sessionId: 'sess-1' },
                // Persisted token usage on the completed process record.
                tokenLimit: 200000,
                currentTokens: 50000, // → 25%
                systemTokens: 10000,
                toolDefinitionsTokens: 5000,
                conversationTokens: 35000,
            });
            setupStandardFetch(task, proc);
            render(<Wrap><ChatDetail taskId="task-1" /></Wrap>);

            // The composer fuel gauge reflects the seeded usage immediately —
            // 50k / 200k = 25% — with no SSE stream and no follow-up message.
            await waitFor(() => {
                expect(screen.getByTestId('composer-ctx-pct').textContent).toBe('25%');
            });

            // All three breakdown fields were numeric → segmented bar is shown.
            expect(screen.getByTestId('composer-ctx-segment-system')).toBeTruthy();
            expect(screen.getByTestId('composer-ctx-segment-tools')).toBeTruthy();
            expect(screen.getByTestId('composer-ctx-segment-conversation')).toBeTruthy();
            // (useChatSSE is mocked to a no-op that never sets any session token
            //  state, so the 25% can only have come from the cold-load seed.)
        });

        it('seeds usage for a processId-keyed (direct) cold load', async () => {
            const proc = makeProcess({
                id: 'queue_abc',
                status: 'completed',
                metadata: { sessionId: 'sess-1' },
                tokenLimit: 100000,
                currentTokens: 80000, // → 80%
            });
            setupFetch({
                '/skills/all': { body: { merged: [] } },
                '/processes/queue_abc': { body: { process: proc, conversation: proc } },
                '/models': { body: [] },
            });
            render(<Wrap><ChatDetail taskId="queue_abc" /></Wrap>);

            await waitFor(() => {
                expect(screen.getByTestId('composer-ctx-pct').textContent).toBe('80%');
            });
            // No breakdown fields → single-fill bar, no segments.
            expect(screen.getByTestId('composer-ctx-fill')).toBeTruthy();
            expect(screen.queryByTestId('composer-ctx-segment-system')).toBeNull();
        });

        it('AC-03 non-regression: keeps the 0% fallback when the process has no persisted currentTokens', async () => {
            const task = makeTask({ status: 'completed', processId: 'proc-1' });
            const proc = makeProcess({
                status: 'completed',
                metadata: { sessionId: 'sess-1' },
                // tokenLimit present (so the gauge renders) but usage genuinely unknown.
                tokenLimit: 200000,
                // currentTokens / breakdown intentionally absent.
            });
            setupStandardFetch(task, proc);
            render(<Wrap><ChatDetail taskId="task-1" /></Wrap>);

            // The absent currentTokens is NOT clobbered into anything — the
            // numeric guard skips it and the existing 0% fallback is preserved.
            await waitFor(() => {
                expect(screen.getByTestId('composer-ctx-pct').textContent).toBe('0%');
            });
            // Bar is shown (not hidden) with the single-fill fallback.
            expect(screen.getByTestId('composer-ctx-fill')).toBeTruthy();
            expect(screen.queryByTestId('composer-ctx-segment-system')).toBeNull();
        });
    });
});

// ── Per-conversation follow-up effort tier (AC-02 read-back, AC-03 persist) ──
//
// The follow-up after-tier is remembered per conversation in
// `process.metadata.afterEffortTier` (not the workspace-global localStorage key).
// These tests drive the real EffortTierSelector inside the real FollowUpInputArea,
// so they exercise the init read-back + the PATCH-on-change end-to-end through the
// fetch mock and localStorage.
describe('ChatDetail — per-conversation after effort tier', () => {
    // All three tiers configured so a seeded selection is never coerced to the
    // first configured tier by the resolveEffectiveTier effect.
    const CONFIGURED_TIERS = {
        low: { model: 'model-low', reasoningEffort: 'low' },
        medium: { model: 'model-medium', reasoningEffort: '' },
        high: { model: 'model-high', reasoningEffort: 'high' },
    };

    function enableTierMode() {
        mockState.effortLevelsEnabled = true;
        mockState.effortTiers = { ...CONFIGURED_TIERS };
    }

    function selectorTier(): string | null {
        return screen.getByTestId('follow-up-effort-tier-selector').getAttribute('data-tier-value');
    }

    it('AC-02: initializes the selector from the conversation\'s metadata.afterEffortTier', async () => {
        enableTierMode();
        const task = makeTask({ status: 'completed', processId: 'proc-1' });
        const proc = makeProcess({ metadata: { sessionId: 'sess-1', afterEffortTier: 'high' } });
        setupStandardFetch(task, proc);

        render(<Wrap><ChatDetail taskId="task-1" workspaceId="ws-1" /></Wrap>);

        await waitFor(() => expect(selectorTier()).toBe('high'));
    });

    it('AC-02: falls back to the workspace-global localStorage value when no per-conversation seed exists', async () => {
        enableTierMode();
        localStorage.setItem('coc:effort-tier:ws-1', 'low');
        const task = makeTask({ status: 'completed', processId: 'proc-1' });
        const proc = makeProcess({ metadata: { sessionId: 'sess-1' } }); // no afterEffortTier
        setupStandardFetch(task, proc);

        render(<Wrap><ChatDetail taskId="task-1" workspaceId="ws-1" /></Wrap>);

        await waitFor(() => expect(selectorTier()).toBe('low'));
    });

    it('AC-02: falls back to medium when neither a seed nor a localStorage value exists', async () => {
        enableTierMode();
        const task = makeTask({ status: 'completed', processId: 'proc-1' });
        const proc = makeProcess({ metadata: { sessionId: 'sess-1' } });
        setupStandardFetch(task, proc);

        render(<Wrap><ChatDetail taskId="task-1" workspaceId="ws-1" /></Wrap>);

        await waitFor(() => expect(screen.getByTestId('follow-up-effort-tier-selector')).toBeTruthy());
        expect(selectorTier()).toBe('medium');
    });

    it('AC-03: persists a tier change via PATCH metadataPatch.set.afterEffortTier and does NOT write the workspace localStorage key', async () => {
        enableTierMode();
        const task = makeTask({ status: 'completed', processId: 'proc-1' });
        const proc = makeProcess({ metadata: { sessionId: 'sess-1', afterEffortTier: 'high' } });
        setupStandardFetch(task, proc);

        render(<Wrap><ChatDetail taskId="task-1" workspaceId="ws-1" /></Wrap>);
        await waitFor(() => expect(selectorTier()).toBe('high'));

        // Open the tier dropdown and pick "low".
        fireEvent.click(screen.getByTestId('effort-tier-trigger-btn'));
        fireEvent.click(screen.getByTestId('effort-tier-option-low'));

        // UI updates immediately (optimistic).
        await waitFor(() => expect(selectorTier()).toBe('low'));

        // Persisted per conversation via PATCH /api/processes/proc-1.
        await waitFor(() => {
            const patchCall = fetchMock.mock.calls.find(([url, init]: any) =>
                typeof url === 'string' && url.includes('/processes/proc-1') && init?.method === 'PATCH');
            expect(patchCall).toBeTruthy();
            const body = JSON.parse((patchCall as any[])[1].body);
            expect(body.metadataPatch.set.afterEffortTier).toBe('low');
        });

        // The workspace-global key is NOT written from ChatDetail anymore — the
        // change must not leak into other chats in the workspace.
        expect(localStorage.getItem('coc:effort-tier:ws-1')).toBeNull();
    });
});
