/**
 * Integration tests for ChatDetail's right-hand surfaces after the chat-owned AI
 * canvas column was removed.
 *
 * The AI canvas is now purely a tab in the shared right panel, so these cover:
 * that no canvas rail, resize handle, or canvas column renders in the chat under
 * any entry point or retired preference; that the shared panel's canvas tab is
 * still reachable and still what an AI update opens; that source-file / note /
 * folder / whisper-diff views keep their own per-chat restore behaviour,
 * independent of any canvas preference; and that the chat publishes the composer
 * actions ("Ask AI", "Send comments") a canvas tab calls back into.
 *
 * Canvas rendering is enabled here (the main ChatDetail.test.tsx disables it),
 * so this lives in its own file with its own mock set: a stubbed CanvasPanel, a
 * controllable source-canvas hook, a captured `onCanvasUpdated` SSE callback,
 * and a fetch handler that serves `client.canvases.list` per conversation pid.
 */

/* @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act, cleanup } from '@testing-library/react';
import React, { useEffect, type ReactNode } from 'react';
import { AppProvider } from '../../../../src/server/spa/client/react/contexts/AppContext';
import { QueueProvider } from '../../../../src/server/spa/client/react/contexts/QueueContext';
import { ToastProvider } from '../../../../src/server/spa/client/react/contexts/ToastContext';
import { NotificationProvider } from '../../../../src/server/spa/client/react/contexts/NotificationContext';
import { TaskProvider } from '../../../../src/server/spa/client/react/contexts/TaskContext';
import { toQueueProcessId } from '../../../../src/server/spa/client/react/utils/queue-process-id';
import { UnifiedPanelHostProvider } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelHost';
import { readUnifiedPanelState, clearUnifiedPanelState } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelStore';
import { clearUnifiedDiffSources, getUnifiedDiffSource } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedDiffSources';
import { clearUnifiedCanvasEvents } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedCanvasEvents';
import { clearUnifiedChatCanvasActions, getUnifiedChatCanvasActions } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedChatCanvasActions';
import { UnifiedTabView } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedTabView';
import { clearUnifiedChatChanges, getUnifiedChatChanges, getUnifiedChatChangesEntry } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedChatChanges';
import { closeTab, visibleTabs } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';
import { updateUnifiedPanelState } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelOpen';

// ── Hoisted mock state ──────────────────────────────────────────────────────

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
        // Captured SSE options so a test can fire onCanvasUpdated.
        sseOpts: null as any,
        // When set, every fetch waits on it — lets a test hold the chat in its
        // loading state and observe what the UI does meanwhile.
        holdFetch: null as Promise<void> | null,
        // Per-pid canvas descriptors served by the fetch handler for
        // `client.canvases.list`.
        canvasesByPid: {} as Record<string, Array<{ id: string; title?: string; type?: string }>>,
        sourceFiles: [] as Array<{
            fullPath: string;
            wsId: string;
            kind: 'code';
            line?: number;
            endLine?: number;
        }>,
    },
}));

// ── Module mocks (hoisted before imports) ──────────────────────────────────

// @excalidraw/excalidraw imports `roughjs/bin/rough` without a file extension,
// which Node's ESM loader cannot resolve (roughjs ships no `exports` map). The
// global setup stub is not applied to ChatDetail's transitive import graph under
// vitest 4.x, so stub it file-locally — these tests never render an Excalidraw
// canvas (CanvasPanel / source-canvas / whisper-diff are all mocked below).
vi.mock('@excalidraw/excalidraw', () => ({
    Excalidraw: () => null,
    restoreElements: (elements: unknown) => (Array.isArray(elements) ? elements : []),
    convertToExcalidrawElements: (elements: unknown) => (Array.isArray(elements) ? elements : []),
}));

vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => '/api',
    getWsPath: () => '/ws',
    getWsUrl: () => 'ws://localhost/ws',
    isRalphEnabled: () => true,
    isRalphMultiAgentGrillEnabled: () => false,
    isCronEnabled: () => false,
    isForEachEnabled: () => false,
    getDefaultProvider: () => 'copilot' as const,
    getActiveProvider: () => 'copilot' as const,
    isEffortLevelsEnabled: () => false,
    isChatStyleSelectorEnabled: () => false,
    getDefaultChatStyle: () => 'default',
    isSessionContextAttachmentsEnabled: () => false,
    getPrewarmDebounceMs: () => 500,
    getWarmClientTtlMs: () => 300000,
    isCanvasEnabled: () => true,
    isRemoteShellEnabled: () => false,
    isQuickAskSidenotesEnabled: () => false,
    DASHBOARD_CONFIG_UPDATED_EVENT: 'coc-dashboard-config-updated',
}));

vi.mock('../../../../src/server/spa/client/react/hooks/preferences/useDisplaySettings', () => ({
    useDisplaySettings: () => ({ showReportIntent: false, toolCompactness: 0, taskCardDensity: 'compact', groupSingleLineMessages: false }),
    invalidateDisplaySettings: vi.fn(),
}));

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

vi.mock('../../../../src/server/spa/client/react/contexts/PopOutContext', () => ({
    usePopOut: () => ({
        poppedOutTasks: new Set<string>(),
        markPoppedOut: vi.fn(),
        markRestored: vi.fn(),
        postMessage: vi.fn(),
    }),
}));

vi.mock('../../../../src/server/spa/client/react/contexts/FloatingChatsContext', () => ({
    useFloatingChats: () => ({
        floatingChats: new Map(),
        floatChat: vi.fn(),
        unfloatChat: vi.fn(),
        isFloating: () => false,
    }),
}));

// useChatSSE — capture the options object so tests can fire onCanvasUpdated.
vi.mock('../../../../src/server/spa/client/react/features/chat/hooks/useChatSSE', () => ({
    useChatSSE: (opts: any) => {
        mockState.sseOpts = opts;
        return { stopStreaming: mockState.stopStreaming };
    },
}));

vi.mock('../../../../src/server/spa/client/react/features/chat/hooks/useSendMessage', () => ({
    useSendMessage: (opts: any) => {
        (globalThis as any).__useSendMessage_opts = opts;
        return {
            sendFollowUp: mockState.sendFollowUp,
            closeFollowUpStream: mockState.closeFollowUpStream,
            onSendComplete: mockState.onSendComplete,
        };
    },
}));

vi.mock('../../../../src/server/spa/client/react/queue/hooks/useQueuedTaskPoll', () => ({
    useQueuedTaskPoll: () => {},
}));

vi.mock('../../../../src/server/spa/client/react/features/chat/hooks/useChatWindowActions', () => ({
    useChatWindowActions: () => ({
        handlePopOut: mockState.handlePopOut,
        handleFloat: mockState.handleFloat,
    }),
}));

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

vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false, isTablet: false, isDesktop: true, breakpoint: 'desktop' as const }),
}));

vi.mock('../../../../src/server/spa/client/react/hooks/useModels', () => ({
    useModels: () => ({ models: [], loading: false, error: null, reload: vi.fn() }),
}));

vi.mock('../../../../src/server/spa/client/react/hooks/useProviderEffortTiers', () => ({
    useProviderEffortTiers: () => ({
        tiers: {},
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
                contentEditable: !props.disabled,
                onKeyDown: props.onKeyDown,
                onInput: (e: any) => props.onChange?.(e.currentTarget?.textContent ?? ''),
                onPaste: props.onPaste,
            });
        }),
    };
});

vi.mock('../../../../src/server/spa/client/react/features/chat/conversation/ConversationMiniMap', () => ({
    ConversationMiniMap: () => React.createElement('div', { 'data-testid': 'conversation-minimap' }),
}));

vi.mock('../../../../src/server/spa/client/react/features/chat/conversation/ConversationTurnBubble', () => ({
    ConversationTurnBubble: (props: any) => React.createElement('div', {
        'data-testid': `turn-${props.turn?.role}`,
    }, props.turn?.content ?? ''),
}));

vi.mock('../../../../src/server/spa/client/react/features/chat/QueuedBubble', () => ({
    QueuedBubble: (props: any) => React.createElement('div', { 'data-testid': 'queued-bubble' }, props.msg?.content ?? ''),
    QueuedFollowUps: (props: any) =>
        React.createElement('div', { 'data-testid': 'queued-followups', 'data-count': props.queue?.length ?? 0 }),
}));

vi.mock('../../../../src/server/spa/client/react/features/chat/BackgroundTasksIndicator', () => ({
    BackgroundTasksIndicator: () => React.createElement('div', { 'data-testid': 'bg-tasks-indicator' }),
}));

vi.mock('../../../../src/server/spa/client/react/queue/PendingTaskInfoPanel', () => ({
    PendingTaskInfoPanel: () => React.createElement('div', { 'data-testid': 'pending-task-info-panel' }),
}));

vi.mock('../../../../src/server/spa/client/react/features/chat/conversation/ConversationMetadataPopover', () => ({
    getSessionIdFromProcess: (proc: any) => proc?.sdkSessionId ?? proc?.sessionId ?? proc?.metadata?.sessionId ?? null,
    ConversationMetadataPopover: () => React.createElement('div', { 'data-testid': 'metadata-popover' }),
}));

// CanvasPanel — stub exposing the close affordance the persistence wiring calls
// and the active canvas id (so restore tests can assert WHICH agent canvas shows).
vi.mock('../../../../src/server/spa/client/react/features/canvas/CanvasPanel', () => ({
    CanvasPanel: (props: any) => React.createElement('div', { 'data-testid': 'canvas-panel-mock', 'data-canvas-id': props.canvasId },
        React.createElement('span', {
            'data-testid': 'canvas-available-count',
            'data-count': props.availableCanvases?.length ?? 0,
        }),
        props.availableCanvases?.[1]
            ? React.createElement('button', {
                'data-testid': 'canvas-switch-second',
                onClick: () => props.onSelectCanvas?.(props.availableCanvases[1].id),
            }, 'Switch second')
            : null,
        props.onPopOut
            ? React.createElement('button', { 'data-testid': 'canvas-popout', onClick: props.onPopOut }, 'Pop out')
            : null,
        React.createElement('button', { 'data-testid': 'canvas-close', onClick: props.onClose }, 'Close'),
    ),
}));

// source-canvas — controllable hook so a test can open the docked source canvas
// (which collapses the agent canvas transiently). The dock stub surfaces the
// open file's kind + path and a close affordance so restore/clear tests can
// assert the SAME canvas comes back and that closing clears the memory.
vi.mock('../../../../src/server/spa/client/react/features/chat/source-canvas', async () => {
    const R = await import('react');
    return {
        SourceCanvasDock: (props: any) => R.createElement('div', {
            'data-testid': 'source-canvas-dock',
            'data-kind': props.fileRef?.kind ?? 'code',
            'data-path': props.fileRef?.fullPath ?? '',
            'data-ws-id': props.wsId ?? '',
            'data-line': props.fileRef?.line ?? '',
            'data-end-line': props.fileRef?.endLine ?? '',
        },
        R.createElement('span', {
            'data-testid': 'source-canvas-candidate-count',
            'data-count': props.sourceFiles?.length ?? 0,
        }),
        props.sourceFiles?.map((sourceFile: any, index: number) => R.createElement('button', {
            key: `${sourceFile.wsId}:${sourceFile.fullPath}`,
            'data-testid': `source-canvas-candidate-${index}`,
            'data-path': sourceFile.fullPath,
            'data-ws-id': sourceFile.wsId,
            onClick: () => props.onNavigate?.(sourceFile),
        }, sourceFile.fullPath)),
        R.createElement('button', { 'data-testid': 'source-canvas-close', onClick: props.onClose }, 'Close')),
        useSourceCanvasState: (opts: any) => {
            const [fileRef, setFileRef] = R.useState<any>(null);
            const onOpenRef = R.useRef(opts?.onOpen);
            onOpenRef.current = opts?.onOpen;
            const open = R.useCallback((ref: any) => {
                onOpenRef.current?.();
                setFileRef(ref ?? { fullPath: '/x.ts', kind: 'code' });
            }, []);
            const close = R.useCallback(() => setFileRef(null), []);
            return { open, close, isOpen: !!fileRef, fileRef };
        },
        useSourceCanvasContent: () => null,
        useSourceCanvasTree: () => null,
        useConversationSourceFiles: () => mockState.sourceFiles,
    };
});

// whisper-diff — controllable hook + dock stub mirroring source-canvas, so a
// test can open + restore the transient whisper-diff panel.
vi.mock('../../../../src/server/spa/client/react/features/chat/whisper-diff', async () => {
    const R = await import('react');
    return {
        WHISPER_DIFF_EVENT: 'coc-open-whisper-diff',
        WhisperDiffDock: (props: any) => R.createElement('div', {
            'data-testid': 'whisper-diff-dock',
            'data-path': props.state?.focusPath ?? props.state?.files?.[0]?.path ?? '',
        }, R.createElement('button', { 'data-testid': 'whisper-diff-close', onClick: props.onClose }, 'Close')),
        useWhisperDiffPanelState: (opts: any) => {
            const [ctx, setCtx] = R.useState<any>(null);
            const onOpenRef = R.useRef(opts?.onOpen);
            onOpenRef.current = opts?.onOpen;
            const open = R.useCallback((next: any) => {
                onOpenRef.current?.();
                setCtx(next);
            }, []);
            const close = R.useCallback(() => setCtx(null), []);
            return { open, close, isOpen: !!ctx, ctx };
        },
        useWhisperDiffState: (ctx: any) => ctx,
    };
});

// Path resolution for a clicked source link reads the workspace list (with
// remote clones folded in); AppProvider fetches it, so pin a known root here
// rather than driving the reducer from a test.
vi.mock('../../../../src/server/spa/client/react/repos/workspacesWithRemote', () => ({
    useWorkspacesWithRemote: () => [{ id: 'ws-1', name: 'main-repo', rootPath: '/repos/main' }],
    useWorkspacesWithRemoteOptional: () => [{ id: 'ws-1', name: 'main-repo', rootPath: '/repos/main' }],
    withRemoteWorkspaces: (w: any[]) => w,
}));

// Now import the component under test (after mocks)
import { ChatDetail } from '../../../../src/server/spa/client/react/features/chat/ChatDetail';

// ── Helpers ─────────────────────────────────────────────────────────────────

const WS_ID = 'ws-1';

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

let fetchMock: ReturnType<typeof vi.fn>;

function jsonResponse(body: any): Response {
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
    localStorage.clear();
    mockState.canvasesByPid = {};
    mockState.sourceFiles = [];
    mockState.sseOpts = null;
    mockState.holdFetch = null;
    fetchMock = vi.fn(async (url: string) => {
        if (mockState.holdFetch) await mockState.holdFetch;
        const urlStr = typeof url === 'string' ? url : '';
        if (urlStr.includes('/canvases')) {
            const pid = new URL(urlStr, 'http://x').searchParams.get('processId') ?? '';
            return jsonResponse({ canvases: mockState.canvasesByPid[pid] ?? [] });
        }
        if (urlStr.includes('/skills/all')) {
            return jsonResponse({ merged: [] });
        }
        return jsonResponse({});
    });
    vi.stubGlobal('fetch', fetchMock);
    Element.prototype.scrollIntoView = vi.fn();
    mockState.sendFollowUp.mockReset().mockResolvedValue(undefined);
    mockState.stopStreaming.mockReset();
});

afterEach(() => {
    // Unmount mounted trees between tests. @testing-library/react's auto-cleanup
    // is not registered under this vitest version, so without this each test's
    // ChatDetail lingers in the DOM and `getByTestId` matches stale duplicates.
    cleanup();
    vi.restoreAllMocks();
    delete (globalThis as any).__useSendMessage_opts;
});

/** The conversation identity ChatDetail keys the canvas off of (task unloaded). */
function pidFor(taskId: string): string {
    return toQueueProcessId(taskId);
}

function renderChat(taskId: string) {
    return render(<Wrap><ChatDetail taskId={taskId} workspaceId={WS_ID} /></Wrap>);
}

function rerenderChat(rerender: (ui: React.ReactElement) => void, taskId: string) {
    rerender(<Wrap><ChatDetail taskId={taskId} workspaceId={WS_ID} /></Wrap>);
}

/**
 * The same chat, but rendered under a unified right panel that is showing
 * `hostChatId`'s tabs — what `RepoDetail` / `RepoGroupView` publish with the
 * flag on. Defaults to hosting the rendered chat itself.
 */
function renderHostedChat(taskId: string, hostChatId: string | null = taskId) {
    return render(
        <Wrap>
            <UnifiedPanelHostProvider host={{ workspaceId: WS_ID, chatId: hostChatId }}>
                <ChatDetail taskId={taskId} workspaceId={WS_ID} />
            </UnifiedPanelHostProvider>
        </Wrap>,
    );
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('ChatDetail — no chat-owned AI canvas column', () => {
    beforeEach(() => {
        clearUnifiedPanelState();
        clearUnifiedCanvasEvents();
    });

    /** Every artifact of the retired chat-side canvas surface. */
    function expectNoChatCanvasSurface() {
        expect(screen.queryByTestId('canvas-panel-mock')).toBeNull();
        expect(screen.queryByTestId('canvas-collapsed-rail')).toBeNull();
        expect(screen.queryByTestId('canvas-poppedout-rail')).toBeNull();
        expect(screen.queryByTestId('canvas-panel-resize-handle')).toBeNull();
        expect(screen.queryByLabelText('Open canvas')).toBeNull();
        expect(screen.queryByLabelText('Resize canvas panel')).toBeNull();
    }

    /** The retired per-chat "closed" flag, written by an older build. */
    function writeLegacyClosedFlag(taskId: string) {
        localStorage.setItem(`coc.canvasPanel.closed.${WS_ID}.${encodeURIComponent(pidFor(taskId))}`, '1');
    }

    it('renders no canvas rail or column for a chat with a linked canvas', async () => {
        mockState.canvasesByPid[pidFor('task-A')] = [{ id: 'canvas-A' }];
        renderChat('task-A');

        await screen.findByTestId('chat-explorer-toggle-btn');
        await waitFor(() => expectNoChatCanvasSurface());
    });

    it('renders nothing canvas-shaped while discovery is outstanding, nor once it lands', async () => {
        mockState.canvasesByPid[pidFor('task-A')] = [{ id: 'canvas-A' }];
        let release = () => {};
        mockState.holdFetch = new Promise<void>(resolve => { release = resolve; });

        renderChat('task-A');
        expectNoChatCanvasSurface();

        // Delayed discovery: the response lands well after first paint.
        mockState.holdFetch = null;
        act(() => { release(); });
        await waitFor(() => expect(fetchMock).toHaveBeenCalled());
        await waitFor(() => expectNoChatCanvasSurface());
    });

    it('ignores an old saved closed preference on first mount and after switching back', async () => {
        mockState.canvasesByPid[pidFor('task-A')] = [{ id: 'canvas-A' }];
        mockState.canvasesByPid[pidFor('task-B')] = [];
        writeLegacyClosedFlag('task-A');

        const { rerender } = renderChat('task-A');
        await screen.findByTestId('chat-explorer-toggle-btn');
        await waitFor(() => expectNoChatCanvasSurface());

        rerenderChat(rerender, 'task-B');
        rerenderChat(rerender, 'task-A');
        await waitFor(() => expectNoChatCanvasSurface());

        // Nothing rewrites the retired key either — it is simply inert.
        expect(localStorage.getItem(`coc.canvasPanel.closed.${WS_ID}.${encodeURIComponent(pidFor('task-A'))}`)).toBe('1');
    });

    it('ignores an old saved chat-canvas width preference, however extreme', async () => {
        mockState.canvasesByPid[pidFor('task-A')] = [{ id: 'canvas-A' }];
        localStorage.setItem(`coc.canvasPanel.width.${WS_ID}`, '4000');

        renderChat('task-A');
        await screen.findByTestId('chat-explorer-toggle-btn');
        await waitFor(() => expectNoChatCanvasSurface());
    });

    it('keeps the shared panel canvas tab reachable with the old closed preference set', async () => {
        writeLegacyClosedFlag('task-A');
        renderHostedChat('task-A');

        act(() => {
            mockState.sseOpts.onCanvasUpdated({ canvasId: 'canvas-A', title: 'Plan', revision: 1, editor: 'ai' });
        });

        // The editor is REACHABLE, not merely the rail absent: the tab the update
        // filed renders CanvasPanel for that canvas.
        await waitFor(() => expect(visibleTabs(readUnifiedPanelState(WS_ID), 'task-A')).toHaveLength(1));
        const tab = visibleTabs(readUnifiedPanelState(WS_ID), 'task-A')[0]!;
        render(
            <Wrap>
                <UnifiedTabView tab={tab} scopeWorkspaceId={WS_ID} onClose={vi.fn()} />
            </Wrap>,
        );
        const panels = await screen.findAllByTestId('canvas-panel-mock');
        expect(panels.some(el => el.getAttribute('data-canvas-id') === 'canvas-A')).toBe(true);
        expect(screen.queryByTestId('canvas-collapsed-rail')).toBeNull();
    });

    it('renders no canvas column across repeated chat switches or a fresh mount', async () => {
        mockState.canvasesByPid[pidFor('task-A')] = [{ id: 'canvas-A' }];
        mockState.canvasesByPid[pidFor('task-B')] = [{ id: 'canvas-B' }];
        const first = renderChat('task-A');
        for (const id of ['task-B', 'task-A', 'task-B', 'task-A']) {
            rerenderChat(first.rerender, id);
            await waitFor(() => expectNoChatCanvasSurface());
        }
        first.unmount();

        renderChat('task-A');
        await screen.findByTestId('chat-explorer-toggle-btn');
        await waitFor(() => expectNoChatCanvasSurface());
    });

    it('opens the read-only file-tree dock (kind: dir) from the persistent header explorer toggle, and closes it on re-toggle', async () => {
        renderChat('task-A');
        // The toggle is persistent whenever a workspace is resolved.
        const toggle = await screen.findByTestId('chat-explorer-toggle-btn');
        expect(screen.queryByTestId('source-canvas-dock')).toBeNull();

        // Toggle ON → docked source canvas opens in folder (tree) mode.
        fireEvent.click(toggle);
        const dock = await screen.findByTestId('source-canvas-dock');
        expect(dock.getAttribute('data-kind')).toBe('dir');
        await waitFor(() => expect(screen.getByTestId('chat-explorer-toggle-btn').getAttribute('aria-pressed')).toBe('true'));

        // Toggle OFF → the dock closes again.
        fireEvent.click(screen.getByTestId('chat-explorer-toggle-btn'));
        await waitFor(() => expect(screen.queryByTestId('source-canvas-dock')).toBeNull());
    });

    it('replaces the active source canvas from its conversation candidates and preserves the selected workspace', async () => {
        mockState.sourceFiles = [
            { fullPath: '/remote/src/newer.ts', wsId: 'remote-ws', kind: 'code', line: 21, endLine: 24 },
            { fullPath: '/local/src/older.ts', wsId: WS_ID, kind: 'code', line: 3 },
        ];
        renderChat('task-A');

        act(() => {
            window.dispatchEvent(new CustomEvent('coc-open-source-canvas', {
                detail: { filePath: '/local/src/older.ts', wsId: WS_ID, line: 3 },
            }));
        });

        await waitFor(() => expect(screen.getByTestId('source-canvas-dock')).toBeTruthy());
        expect(screen.getByTestId('source-canvas-candidate-count').getAttribute('data-count')).toBe('2');

        fireEvent.click(screen.getByTestId('source-canvas-candidate-0'));

        await waitFor(() => {
            const dock = screen.getByTestId('source-canvas-dock');
            expect(dock.getAttribute('data-path')).toBe('/remote/src/newer.ts');
            expect(dock.getAttribute('data-ws-id')).toBe('remote-ws');
            expect(dock.getAttribute('data-line')).toBe('21');
            expect(dock.getAttribute('data-end-line')).toBe('24');
        });
    });
});

describe('ChatDetail — whisper diff entry point with the unified right panel (AC-04)', () => {
    beforeEach(() => {
        clearUnifiedPanelState();
        clearUnifiedDiffSources();
    });

    function dispatchWhisperDiff(path: string) {
        act(() => {
            window.dispatchEvent(new CustomEvent('coc-open-whisper-diff', {
                detail: { files: [{ path }], toolCalls: [], commits: [], focusPath: path },
            }));
        });
    }

    it('files a diff tab in the hosting panel instead of opening the chat\u2019s own column', async () => {
        renderHostedChat('task-A');
        dispatchWhisperDiff('a.ts');

        // The competing sibling column must not appear — one right-side surface.
        await waitFor(() => {
            const tabs = visibleTabs(readUnifiedPanelState(WS_ID), 'task-A');
            expect(tabs.map(t => t.kind)).toEqual(['diff']);
        });
        expect(screen.queryByTestId('whisper-diff-dock')).toBeNull();

        const tab = visibleTabs(readUnifiedPanelState(WS_ID), 'task-A')[0]!;
        // Owned by the clone the edited files came from, scoped to the chat that
        // produced them, and pointing at a registered (renderable) source.
        expect(tab.ownerWorkspaceId).toBe(WS_ID);
        expect(tab.chatId).toBe('task-A');
        expect(tab.label).toBe('1 file changed');
        expect(getUnifiedDiffSource(tab.resourceId)?.ctx.focusPath).toBe('a.ts');
    });

    it('keeps the chat\u2019s own column when the panel is showing another chat', async () => {
        // A background chat's diff would be filed under a tab set the panel is
        // not displaying, so it must not be rerouted into an invisible tab.
        renderHostedChat('task-A', 'task-B');
        dispatchWhisperDiff('a.ts');

        await waitFor(() => expect(screen.getByTestId('whisper-diff-dock')).toBeTruthy());
        expect(visibleTabs(readUnifiedPanelState(WS_ID), 'task-A')).toEqual([]);
        expect(visibleTabs(readUnifiedPanelState(WS_ID), 'task-B')).toEqual([]);
    });

    it('keeps the chat\u2019s own column with no panel hosting it at all', async () => {
        renderChat('task-A');
        dispatchWhisperDiff('a.ts');

        await waitFor(() => expect(screen.getByTestId('whisper-diff-dock')).toBeTruthy());
        expect(visibleTabs(readUnifiedPanelState(WS_ID), 'task-A')).toEqual([]);
    });
});

describe('ChatDetail — source-link entry point with the unified right panel (AC-04)', () => {
    beforeEach(() => {
        clearUnifiedPanelState();
    });

    function dispatchSourceLink(detail: Record<string, unknown>) {
        act(() => {
            window.dispatchEvent(new CustomEvent('coc-open-source-canvas', { detail }));
        });
    }

    it('files a READ-ONLY file tab in the hosting panel instead of the docked source canvas', async () => {
        renderHostedChat('task-A');
        dispatchSourceLink({ filePath: '/repos/main/src/app.ts', wsId: WS_ID, line: 12 });

        await waitFor(() => {
            const tabs = visibleTabs(readUnifiedPanelState(WS_ID), 'task-A');
            expect(tabs.map(t => t.kind)).toEqual(['file']);
        });
        // One right-side surface: the chat's own column must not also appear.
        expect(screen.queryByTestId('source-canvas-dock')).toBeNull();

        const tab = visibleTabs(readUnifiedPanelState(WS_ID), 'task-A')[0]!;
        expect(tab.ownerWorkspaceId).toBe(WS_ID);
        expect(tab.chatId).toBe('task-A');
        expect(tab.resourceId).toBe('src/app.ts');
        expect(tab.line).toBe(12);
        // A link is a reference, not an authorization — the tab stays read-only.
        expect(tab.readOnly).toBe(true);
    });

    it('files a note ref as an editable, workspace-owned note tab', async () => {
        renderHostedChat('task-A');
        dispatchSourceLink({ filePath: '/repos/main/notes/n.md', wsId: WS_ID, kind: 'note', line: 3 });

        await waitFor(() => {
            const tabs = visibleTabs(readUnifiedPanelState(WS_ID), 'task-A');
            expect(tabs.map(t => t.kind)).toEqual(['note']);
        });
        expect(screen.queryByTestId('source-canvas-dock')).toBeNull();

        const tab = visibleTabs(readUnifiedPanelState(WS_ID), 'task-A')[0]!;
        // Workspace-owned, so it survives a chat switch, and editable: a plan
        // note reached through a link keeps the capability the docked editor had.
        expect(tab.chatId).toBeNull();
        expect(tab.readOnly).toBeUndefined();
        expect(tab.ownerWorkspaceId).toBe(WS_ID);
        expect(tab.resourceId).toBe('auto||/repos/main/notes/n.md');
        expect(tab.line).toBe(3);
    });

    it('keeps the docked canvas for refs the panel’s views cannot read', async () => {
        // A folder ref is the Explorer's, and an out-of-root path is not
        // readable through a repo's blob API — both keep the existing surface
        // rather than opening a tab that could only render an error.
        renderHostedChat('task-A');
        dispatchSourceLink({ filePath: '/repos/main/src', wsId: WS_ID, kind: 'dir' });

        await waitFor(() => expect(screen.getByTestId('source-canvas-dock')).toBeTruthy());
        expect(visibleTabs(readUnifiedPanelState(WS_ID), 'task-A')).toEqual([]);

        dispatchSourceLink({ filePath: '/elsewhere/src/a.ts', wsId: WS_ID });
        await waitFor(() => expect(screen.getByTestId('source-canvas-dock').getAttribute('data-path')).toBe('/elsewhere/src/a.ts'));
        expect(visibleTabs(readUnifiedPanelState(WS_ID), 'task-A')).toEqual([]);
    });

    it('keeps the chat’s own column when the panel is showing another chat', async () => {
        renderHostedChat('task-A', 'task-B');
        dispatchSourceLink({ filePath: '/repos/main/src/app.ts', wsId: WS_ID });

        await waitFor(() => expect(screen.getByTestId('source-canvas-dock')).toBeTruthy());
        expect(visibleTabs(readUnifiedPanelState(WS_ID), 'task-A')).toEqual([]);
        expect(visibleTabs(readUnifiedPanelState(WS_ID), 'task-B')).toEqual([]);
    });

    it('keeps the chat’s own column with no panel hosting it at all', async () => {
        renderChat('task-A');
        dispatchSourceLink({ filePath: '/repos/main/src/app.ts', wsId: WS_ID });

        await waitFor(() => expect(screen.getByTestId('source-canvas-dock')).toBeTruthy());
        expect(visibleTabs(readUnifiedPanelState(WS_ID), 'task-A')).toEqual([]);
    });
});

describe('ChatDetail — AI canvas updates with the unified right panel (AC-06)', () => {
    beforeEach(() => {
        clearUnifiedPanelState();
        clearUnifiedCanvasEvents();
    });

    function fireCanvasUpdate(canvasId: string, revision: number) {
        act(() => {
            mockState.sseOpts.onCanvasUpdated({ canvasId, title: 'Plan', revision, editor: 'ai' });
        });
    }

    it('activates the canvas as a panel tab, with no canvas column in the chat', async () => {
        renderHostedChat('task-A');
        fireCanvasUpdate('canvas-A2', 1);

        await waitFor(() => {
            const tabs = visibleTabs(readUnifiedPanelState(WS_ID), 'task-A');
            expect(tabs.map(t => t.resourceId)).toEqual(['canvas-A2']);
        });
        const state = readUnifiedPanelState(WS_ID);
        const tab = visibleTabs(state, 'task-A')[0]!;
        expect(tab.chatId).toBe('task-A');
        expect(tab.ownerWorkspaceId).toBe(WS_ID);
        // Active, not merely present — the goal asks for activation on every
        // create and update.
        expect(state.activeByScope['task-A']).toBe(tab.id);
        // One right-side surface: the chat itself grows no canvas column.
        expect(screen.queryByTestId('canvas-panel-mock')).toBeNull();
        expect(screen.queryByTestId('canvas-collapsed-rail')).toBeNull();
    });

    it('recreates a dismissed tab on a later update, without duplicating it', async () => {
        renderHostedChat('task-A');
        fireCanvasUpdate('canvas-A2', 1);
        await waitFor(() => expect(visibleTabs(readUnifiedPanelState(WS_ID), 'task-A')).toHaveLength(1));
        const tabId = visibleTabs(readUnifiedPanelState(WS_ID), 'task-A')[0]!.id;

        act(() => { updateUnifiedPanelState(WS_ID, prev => closeTab(prev, tabId)); });
        expect(visibleTabs(readUnifiedPanelState(WS_ID), 'task-A')).toEqual([]);

        fireCanvasUpdate('canvas-A2', 2);
        await waitFor(() => {
            const tabs = visibleTabs(readUnifiedPanelState(WS_ID), 'task-A');
            expect(tabs.map(t => t.id)).toEqual([tabId]);
        });

        fireCanvasUpdate('canvas-A2', 3);
        expect(visibleTabs(readUnifiedPanelState(WS_ID), 'task-A')).toHaveLength(1);
    });

    it('opens a tab per canvas, so two linked canvases stay separately reachable', async () => {
        renderHostedChat('task-A');
        fireCanvasUpdate('canvas-A1', 1);
        fireCanvasUpdate('canvas-A2', 1);

        await waitFor(() => {
            const tabs = visibleTabs(readUnifiedPanelState(WS_ID), 'task-A');
            expect(tabs.map(t => t.resourceId)).toEqual(['canvas-A1', 'canvas-A2']);
        });
        const first = visibleTabs(readUnifiedPanelState(WS_ID), 'task-A')[0]!;
        act(() => { updateUnifiedPanelState(WS_ID, prev => closeTab(prev, first.id)); });
        expect(visibleTabs(readUnifiedPanelState(WS_ID), 'task-A').map(t => t.resourceId)).toEqual(['canvas-A2']);
    });

    it('leaves the visible panel alone for a chat it is not showing', async () => {
        // A background chat's AI edit must not repoint the panel — and must not
        // grow a canvas column in the background chat either.
        renderHostedChat('task-A', 'task-B');
        fireCanvasUpdate('canvas-A2', 1);

        await waitFor(() => expect(fetchMock).toHaveBeenCalled());
        expect(visibleTabs(readUnifiedPanelState(WS_ID), 'task-A')).toEqual([]);
        expect(visibleTabs(readUnifiedPanelState(WS_ID), 'task-B')).toEqual([]);
        expect(screen.queryByTestId('canvas-panel-mock')).toBeNull();
        expect(screen.queryByTestId('canvas-collapsed-rail')).toBeNull();
    });

    it('opens nothing with no panel hosting the chat at all', async () => {
        renderChat('task-A');
        fireCanvasUpdate('canvas-A2', 1);

        await waitFor(() => expect(fetchMock).toHaveBeenCalled());
        expect(visibleTabs(readUnifiedPanelState(WS_ID), 'task-A')).toEqual([]);
        expect(screen.queryByTestId('canvas-panel-mock')).toBeNull();
        expect(screen.queryByTestId('canvas-collapsed-rail')).toBeNull();
    });
});

describe('ChatDetail — restore the open side view on chat switch', () => {
    function openSourceCanvas(detail: Record<string, unknown>) {
        act(() => {
            window.dispatchEvent(new CustomEvent('coc-open-source-canvas', { detail }));
        });
    }

    function openWhisperDiff(path: string) {
        act(() => {
            window.dispatchEvent(new CustomEvent('coc-open-whisper-diff', {
                detail: { files: [{ path }], toolCalls: [], commits: [], focusPath: path },
            }));
        });
    }

    // (a) Each view returns exactly as it was after switching away and back —
    // the core restore behaviour for source / note / folder canvases.
    it.each([
        { kind: 'code', path: '/x.ts', label: 'source-file' },
        { kind: 'note', path: '/notes/n.md', label: 'note' },
        { kind: 'dir', path: '/src', label: 'folder' },
    ])('restores a $label canvas on switch-away-and-back', async ({ kind, path }) => {
        mockState.canvasesByPid[pidFor('task-A')] = [];
        mockState.canvasesByPid[pidFor('task-B')] = [];
        const { rerender } = renderChat('task-A');

        openSourceCanvas({ filePath: path, kind });
        await waitFor(() => expect(screen.getByTestId('source-canvas-dock')).toBeTruthy());

        rerenderChat(rerender, 'task-B');
        await waitFor(() => expect(screen.queryByTestId('source-canvas-dock')).toBeNull());

        rerenderChat(rerender, 'task-A');
        await waitFor(() => expect(screen.getByTestId('source-canvas-dock')).toBeTruthy());
        const dock = screen.getByTestId('source-canvas-dock');
        expect(dock.getAttribute('data-path')).toBe(path);
        expect(dock.getAttribute('data-kind')).toBe(kind);
    });

    // The retired AI-canvas preferences must not reach these views: a chat whose
    // old flag says "canvas closed" still restores its source canvas.
    it('restores a source canvas even with the retired closed preference set', async () => {
        mockState.canvasesByPid[pidFor('task-A')] = [{ id: 'canvas-A' }];
        mockState.canvasesByPid[pidFor('task-B')] = [];
        localStorage.setItem(`coc.canvasPanel.closed.${WS_ID}.${encodeURIComponent(pidFor('task-A'))}`, '1');
        const { rerender } = renderChat('task-A');

        openSourceCanvas({ filePath: '/x.ts' });
        await waitFor(() => expect(screen.getByTestId('source-canvas-dock')).toBeTruthy());

        rerenderChat(rerender, 'task-B');
        await waitFor(() => expect(screen.queryByTestId('source-canvas-dock')).toBeNull());
        rerenderChat(rerender, 'task-A');
        await waitFor(() => expect(screen.getByTestId('source-canvas-dock')).toBeTruthy());
    });

    // (a) A whisper-diff canvas returns as it was.
    it('restores a whisper-diff canvas on switch-away-and-back', async () => {
        mockState.canvasesByPid[pidFor('task-A')] = [];
        mockState.canvasesByPid[pidFor('task-B')] = [];
        const { rerender } = renderChat('task-A');

        openWhisperDiff('a.ts');
        await waitFor(() => expect(screen.getByTestId('whisper-diff-dock')).toBeTruthy());

        rerenderChat(rerender, 'task-B');
        await waitFor(() => expect(screen.queryByTestId('whisper-diff-dock')).toBeNull());

        rerenderChat(rerender, 'task-A');
        await waitFor(() => expect(screen.getByTestId('whisper-diff-dock')).toBeTruthy());
        expect(screen.getByTestId('whisper-diff-dock').getAttribute('data-path')).toBe('a.ts');
    });

    // (b) Closing the open view clears the chat's memory → switch-back shows
    // nothing, the explicit "nothing open" state.
    it('clears memory when the open view is closed → switch-back shows nothing', async () => {
        mockState.canvasesByPid[pidFor('task-A')] = [];
        mockState.canvasesByPid[pidFor('task-B')] = [];
        const { rerender } = renderChat('task-A');

        openSourceCanvas({ filePath: '/x.ts' });
        await waitFor(() => expect(screen.getByTestId('source-canvas-dock')).toBeTruthy());

        // Deliberate close clears the per-chat open-view memory.
        fireEvent.click(screen.getByTestId('source-canvas-close'));
        await waitFor(() => expect(screen.queryByTestId('source-canvas-dock')).toBeNull());

        rerenderChat(rerender, 'task-B');
        rerenderChat(rerender, 'task-A');
        // Nothing is restored — the chat remembers "nothing open".
        await waitFor(() => expect(screen.queryByTestId('source-canvas-dock')).toBeNull());
        expect(screen.queryByTestId('whisper-diff-dock')).toBeNull();
        expect(screen.queryByTestId('canvas-panel-mock')).toBeNull();
    });

    // (c) Each chat's memory is its own: B's open view never leaks into A.
    it('keeps the remembered view isolated per conversation', async () => {
        mockState.canvasesByPid[pidFor('task-A')] = [];
        mockState.canvasesByPid[pidFor('task-B')] = [];
        const { rerender } = renderChat('task-A');

        rerenderChat(rerender, 'task-B');
        openSourceCanvas({ filePath: '/only-in-b.ts' });
        await waitFor(() => expect(screen.getByTestId('source-canvas-dock')).toBeTruthy());

        rerenderChat(rerender, 'task-A');
        await waitFor(() => expect(screen.queryByTestId('source-canvas-dock')).toBeNull());

        rerenderChat(rerender, 'task-B');
        await waitFor(() => expect(screen.getByTestId('source-canvas-dock').getAttribute('data-path')).toBe('/only-in-b.ts'));
    });

    // (d) The open-view memory is held in memory only — opening + restoring a
    // source canvas must write NOTHING that encodes it to localStorage.
    it('does not persist the open-view memory to localStorage', async () => {
        mockState.canvasesByPid[pidFor('task-A')] = [];
        mockState.canvasesByPid[pidFor('task-B')] = [];
        const { rerender } = renderChat('task-A');

        openSourceCanvas({ filePath: '/secret-canvas-path.ts' });
        await waitFor(() => expect(screen.getByTestId('source-canvas-dock')).toBeTruthy());

        // Round-trip to force a memory snapshot + restore.
        rerenderChat(rerender, 'task-B');
        rerenderChat(rerender, 'task-A');
        await waitFor(() => expect(screen.getByTestId('source-canvas-dock')).toBeTruthy());

        const dump = Object.keys(localStorage)
            .map(k => `${k}=${localStorage.getItem(k)}`)
            .join(';');
        expect(dump).not.toContain('/secret-canvas-path.ts');
        // The retired per-chat canvas flag is never written any more either.
        expect(dump).not.toContain('coc.canvasPanel.closed');
    });

    it('forwards only the current conversation candidate list after chat switches', async () => {
        mockState.canvasesByPid[pidFor('task-A')] = [];
        mockState.canvasesByPid[pidFor('task-B')] = [];
        mockState.sourceFiles = [
            { fullPath: '/workspace-a/src/one.ts', wsId: 'workspace-a', kind: 'code', line: 1 },
        ];
        const { rerender } = renderChat('task-A');

        openSourceCanvas({ filePath: '/workspace-a/src/one.ts', wsId: 'workspace-a' });
        await waitFor(() => expect(screen.getByTestId('source-canvas-candidate-0').getAttribute('data-path')).toBe('/workspace-a/src/one.ts'));

        mockState.sourceFiles = [
            { fullPath: '/workspace-b/src/two.ts', wsId: 'workspace-b', kind: 'code', line: 2 },
        ];
        rerenderChat(rerender, 'task-B');
        openSourceCanvas({ filePath: '/workspace-b/src/two.ts', wsId: 'workspace-b' });
        await waitFor(() => expect(screen.getByTestId('source-canvas-candidate-0').getAttribute('data-path')).toBe('/workspace-b/src/two.ts'));

        mockState.sourceFiles = [
            { fullPath: '/workspace-a/src/one.ts', wsId: 'workspace-a', kind: 'code', line: 1 },
        ];
        rerenderChat(rerender, 'task-A');
        await waitFor(() => expect(screen.getByTestId('source-canvas-dock').getAttribute('data-path')).toBe('/workspace-a/src/one.ts'));
        expect(screen.getByTestId('source-canvas-candidate-0').getAttribute('data-path')).toBe('/workspace-a/src/one.ts');
        expect(screen.queryByText('/workspace-b/src/two.ts')).toBeNull();
    });
});

// ── canvas chat actions ─────────────────────────────────────────────────────

describe('ChatDetail — publishing canvas chat actions for the shared panel', () => {
    beforeEach(() => {
        clearUnifiedChatCanvasActions();
    });

    it('prefills only the owning chat’s composer from Ask AI', async () => {
        renderChat('task-A');
        await waitFor(() => expect(getUnifiedChatCanvasActions('task-A')).not.toBeNull());
        // A second chat mounted in the same workspace publishes separately.
        renderChat('task-B');
        await waitFor(() => expect(getUnifiedChatCanvasActions('task-B')).not.toBeNull());

        mockState.richTextSetValueCalls.length = 0;
        act(() => { getUnifiedChatCanvasActions('task-A')!.askAi('Rewrite this section'); });

        // Prefilled and focused, never sent.
        expect(mockState.richTextSetValueCalls.at(-1)?.[0]).toBe('Rewrite this section');
        expect(mockState.sendFollowUp).not.toHaveBeenCalled();
    });

    it('sends comments through the owning chat’s follow-up path', async () => {
        renderChat('task-A');
        await waitFor(() => expect(getUnifiedChatCanvasActions('task-A')).not.toBeNull());

        await act(async () => { await getUnifiedChatCanvasActions('task-A')!.sendToAi('3 comments'); });

        expect(mockState.sendFollowUp).toHaveBeenCalledTimes(1);
        expect(mockState.sendFollowUp.mock.calls[0][0]).toBe('3 comments');
        expect(mockState.sendFollowUp.mock.calls[0][1]).toBe('enqueue');
    });

    it('withdraws its entry on unmount, so an unmounted chat is unavailable', async () => {
        const { unmount } = renderChat('task-A');
        await waitFor(() => expect(getUnifiedChatCanvasActions('task-A')).not.toBeNull());
        unmount();
        expect(getUnifiedChatCanvasActions('task-A')).toBeNull();
    });
});

// ── chat-changes-publish ────────────────────────────────────────────────────

describe('ChatDetail — publishing the chat’s own Changes to the panel (AC-03)', () => {
    beforeEach(() => {
        clearUnifiedPanelState();
        clearUnifiedChatChanges();
    });
    afterEach(() => {
        clearUnifiedChatChanges();
    });

    /** A completed `edit` record — the minimum that makes a chat "have changes". */
    function editTurn(turnIndex: number, id: string, path: string, status?: string): any {
        return {
            turnIndex,
            role: 'assistant',
            content: '',
            toolCalls: [{
                id,
                toolName: 'edit',
                args: { path, old_str: 'before\n', new_str: 'after\n' },
                ...(status === undefined ? {} : { status }),
            }],
        };
    }

    /** Drive the chat's turns the way the stream does. */
    function streamTurns(turns: any[]) {
        act(() => {
            mockState.sseOpts.setTurnsAndRef(turns);
        });
    }

    /**
     * The chat under a panel whose SCOPE may differ from the chat's own
     * workspace — a repo group's panel is keyed by the group id while the edited
     * files belong to a member clone.
     */
    function hostedChat(taskId: string, opts: { scopeId?: string; hostChatId?: string | null; workspaceId?: string } = {}) {
        const scopeId = opts.scopeId ?? WS_ID;
        const hostChatId = opts.hostChatId === undefined ? taskId : opts.hostChatId;
        return (
            <Wrap>
                <UnifiedPanelHostProvider host={{ workspaceId: scopeId, chatId: hostChatId }}>
                    <ChatDetail taskId={taskId} workspaceId={opts.workspaceId ?? WS_ID} />
                </UnifiedPanelHostProvider>
            </Wrap>
        );
    }

    it('publishes the chat’s changes after the first completed edit', async () => {
        renderHostedChat('task-A');
        await waitFor(() => expect(mockState.sseOpts).toBeTruthy());

        // No edits yet → nothing published, so the `+` menu hides the entry.
        expect(getUnifiedChatChanges(WS_ID, 'task-A')).toBeNull();

        streamTurns([editTurn(0, 'call-1', 'a.ts')]);

        await waitFor(() => expect(getUnifiedChatChanges(WS_ID, 'task-A')).not.toBeNull());
        const published = getUnifiedChatChanges(WS_ID, 'task-A')!;
        expect(published.ctx.files.map(f => f.path)).toEqual(['a.ts']);
        // The clone the paths belong to, not the panel's scope.
        expect(published.ctx.workspaceId).toBe(WS_ID);
    });

    it('updates the published context as later edits stream in', async () => {
        renderHostedChat('task-A');
        await waitFor(() => expect(mockState.sseOpts).toBeTruthy());

        streamTurns([editTurn(0, 'call-1', 'a.ts')]);
        await waitFor(() => expect(getUnifiedChatChanges(WS_ID, 'task-A')).not.toBeNull());
        const first = getUnifiedChatChanges(WS_ID, 'task-A')!;

        // A second turn edits another file: one entry, both files, in order.
        streamTurns([editTurn(0, 'call-1', 'a.ts'), editTurn(1, 'call-2', 'b.ts')]);
        await waitFor(() => {
            expect(getUnifiedChatChanges(WS_ID, 'task-A')!.ctx.files.map(f => f.path)).toEqual(['a.ts', 'b.ts']);
        });
        // A fresh context object, so an open tab re-renders rather than sticking
        // to the stale one.
        expect(getUnifiedChatChanges(WS_ID, 'task-A')!.ctx).not.toBe(first.ctx);
    });

    it('ignores an edit that has not completed', async () => {
        renderHostedChat('task-A');
        await waitFor(() => expect(mockState.sseOpts).toBeTruthy());

        streamTurns([editTurn(0, 'call-1', 'a.ts', 'running')]);
        streamTurns([editTurn(0, 'call-1', 'a.ts', 'error')]);
        // Give the effect a chance to publish something wrong.
        await waitFor(() => expect(mockState.sseOpts).toBeTruthy());
        expect(getUnifiedChatChanges(WS_ID, 'task-A')).toBeNull();

        // …and the same call, once completed, does publish.
        streamTurns([editTurn(0, 'call-1', 'a.ts', 'completed')]);
        await waitFor(() => expect(getUnifiedChatChanges(WS_ID, 'task-A')).not.toBeNull());
    });

    it('publishes nothing while the panel is showing another chat', async () => {
        // A background chat must not repoint the visible menu at its own changes.
        render(hostedChat('task-A', { hostChatId: 'task-B' }));
        await waitFor(() => expect(mockState.sseOpts).toBeTruthy());
        streamTurns([editTurn(0, 'call-1', 'a.ts')]);

        await waitFor(() => expect(mockState.sseOpts).toBeTruthy());
        expect(getUnifiedChatChanges(WS_ID, 'task-A')).toBeNull();
        expect(getUnifiedChatChanges(WS_ID, 'task-B')).toBeNull();
    });

    it('publishes nothing with no panel hosting the chat', async () => {
        renderChat('task-A');
        await waitFor(() => expect(mockState.sseOpts).toBeTruthy());
        streamTurns([editTurn(0, 'call-1', 'a.ts')]);

        await waitFor(() => expect(mockState.sseOpts).toBeTruthy());
        expect(getUnifiedChatChanges(WS_ID, 'task-A')).toBeNull();
    });

    it('withdraws the entry when the panel switches to another chat', async () => {
        const { rerender } = render(hostedChat('task-A'));
        await waitFor(() => expect(mockState.sseOpts).toBeTruthy());
        streamTurns([editTurn(0, 'call-1', 'a.ts')]);
        await waitFor(() => expect(getUnifiedChatChanges(WS_ID, 'task-A')).not.toBeNull());

        rerender(hostedChat('task-B'));

        // B has no edits of its own, and A's entry does not linger behind it.
        await waitFor(() => expect(getUnifiedChatChanges(WS_ID, 'task-A')).toBeNull());
        expect(getUnifiedChatChanges(WS_ID, 'task-B')).toBeNull();
    });

    it('withdraws the entry on unmount', async () => {
        const { unmount } = render(hostedChat('task-A'));
        await waitFor(() => expect(mockState.sseOpts).toBeTruthy());
        streamTurns([editTurn(0, 'call-1', 'a.ts')]);
        await waitFor(() => expect(getUnifiedChatChanges(WS_ID, 'task-A')).not.toBeNull());

        unmount();

        // Withdrawn, not resolved-with-nothing: nothing speaks for the chat any
        // more, so a Changes tab of its own would go back to loading rather than
        // claim the chat changed no files.
        expect(getUnifiedChatChangesEntry(WS_ID, 'task-A')).toBeUndefined();
        expect(getUnifiedChatChanges(WS_ID, 'task-A')).toBeNull();
    });

    it('holds the entry unresolved until the transcript has loaded', async () => {
        // A reload restores the Changes tab before the history arrives. Until
        // then nothing has spoken for the chat, and the tab must show loading —
        // publishing "no changes" here would flash an empty diff over a chat
        // that is about to show one.
        let release!: () => void;
        mockState.holdFetch = new Promise<void>(resolve => { release = resolve; });
        render(hostedChat('task-A'));
        await waitFor(() => expect(mockState.sseOpts).toBeTruthy());
        streamTurns([editTurn(0, 'call-1', 'a.ts')]);

        expect(getUnifiedChatChangesEntry(WS_ID, 'task-A')).toBeUndefined();

        mockState.holdFetch = null;
        await act(async () => {
            release();
            await new Promise(resolve => setTimeout(resolve, 0));
        });

        // The load replaced the streamed turns with the server's history, which
        // holds no edits — resolved with nothing, which is not "unknown".
        await waitFor(() => expect(getUnifiedChatChangesEntry(WS_ID, 'task-A')).toBeNull());
        expect(getUnifiedChatChanges(WS_ID, 'task-A')).toBeNull();

        // ...and a later edit still publishes normally.
        streamTurns([editTurn(0, 'call-1', 'a.ts')]);
        await waitFor(() => expect(getUnifiedChatChanges(WS_ID, 'task-A')).not.toBeNull());
    });

    it('rebuilds the entry from restored history on a fresh mount, with no extra request', async () => {
        const { unmount } = render(hostedChat('task-A'));
        await waitFor(() => expect(mockState.sseOpts).toBeTruthy());
        streamTurns([editTurn(0, 'call-1', 'a.ts')]);
        await waitFor(() => expect(getUnifiedChatChanges(WS_ID, 'task-A')).not.toBeNull());
        unmount();
        cleanup();

        // Reload: same chat, history restored into the conversation snapshot.
        const callsBefore = fetchMock.mock.calls.length;
        render(hostedChat('task-A'));
        await waitFor(() => expect(mockState.sseOpts).toBeTruthy());
        streamTurns([editTurn(0, 'call-1', 'a.ts')]);

        await waitFor(() => {
            expect(getUnifiedChatChanges(WS_ID, 'task-A')!.ctx.files.map(f => f.path)).toEqual(['a.ts']);
        });
        // Reconstruction is pure — no changes-specific endpoint exists to call.
        const changesRequests = fetchMock.mock.calls
            .slice(callsBefore)
            .map(call => String(call[0]))
            .filter(url => url.includes('changes'));
        expect(changesRequests).toEqual([]);
    });

    it('keys the entry by the panel’s scope while the context keeps the owning clone', async () => {
        // A repo group: the panel is scoped to the group, the chat's files live
        // in a member clone. Another scope's menu must not see this entry.
        render(hostedChat('task-A', { scopeId: 'group-1', workspaceId: 'ws-member' }));
        await waitFor(() => expect(mockState.sseOpts).toBeTruthy());
        streamTurns([editTurn(0, 'call-1', 'a.ts')]);

        await waitFor(() => expect(getUnifiedChatChanges('group-1', 'task-A')).not.toBeNull());
        expect(getUnifiedChatChanges('group-1', 'task-A')!.ctx.workspaceId).toBe('ws-member');
        expect(getUnifiedChatChanges(WS_ID, 'task-A')).toBeNull();
    });
});
