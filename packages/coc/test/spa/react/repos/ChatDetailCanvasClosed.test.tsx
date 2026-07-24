/**
 * Integration tests for the persisted per-chat agent-canvas "closed" state.
 *
 * These exercise the AC-02 wiring in ChatDetail: a deliberate close persists to
 * localStorage (keyed per conversation), switching away and back keeps a closed
 * canvas collapsed, reopening / a fresh AI canvas edit clears the flag, and the
 * transient source-canvas mutual-exclusion collapse does NOT persist.
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
import {
    canvasClosedStorageKey,
    readCanvasClosed,
} from '../../../../src/server/spa/client/react/features/chat/canvasClosedPreference';
import { toQueueProcessId } from '../../../../src/server/spa/client/react/utils/queue-process-id';

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
    isLoopsEnabled: () => false,
    isForEachEnabled: () => false,
    getDefaultProvider: () => 'copilot' as const,
    getActiveProvider: () => 'copilot' as const,
    isEffortLevelsEnabled: () => false,
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
    fetchMock = vi.fn(async (url: string) => {
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

// ── Tests ──────────────────────────────────────────────────────────────────

describe('ChatDetail — persisted canvas closed state (AC-02)', () => {
    it('auto-opens a chat canvas on first visit', async () => {
        mockState.canvasesByPid[pidFor('task-A')] = [{ id: 'canvas-A' }];
        renderChat('task-A');
        await waitFor(() => expect(screen.getByTestId('canvas-panel-mock')).toBeTruthy());
        expect(screen.queryByTestId('canvas-collapsed-rail')).toBeNull();
    });

    it('passes the linked canvas list into the panel and switches active canvas from the panel', async () => {
        mockState.canvasesByPid[pidFor('task-A')] = [
            { id: 'canvas-A1', title: 'First Canvas', type: 'markdown' },
            { id: 'canvas-A2', title: 'Second Canvas', type: 'code' },
        ];

        renderChat('task-A');

        await waitFor(() => expect(screen.getByTestId('canvas-panel-mock').getAttribute('data-canvas-id')).toBe('canvas-A1'));
        expect(screen.getByTestId('canvas-available-count').getAttribute('data-count')).toBe('2');

        fireEvent.click(screen.getByTestId('canvas-switch-second'));

        await waitFor(() => expect(screen.getByTestId('canvas-panel-mock').getAttribute('data-canvas-id')).toBe('canvas-A2'));
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

    it('(a) keeps a deliberately-closed canvas collapsed after switching away and back', async () => {
        mockState.canvasesByPid[pidFor('task-A')] = [{ id: 'canvas-A' }];
        mockState.canvasesByPid[pidFor('task-B')] = [];
        const { rerender } = renderChat('task-A');

        await waitFor(() => expect(screen.getByTestId('canvas-panel-mock')).toBeTruthy());

        // Deliberate close → collapsed rail + persisted flag.
        fireEvent.click(screen.getByTestId('canvas-close'));
        await waitFor(() => expect(screen.getByTestId('canvas-collapsed-rail')).toBeTruthy());
        expect(readCanvasClosed(WS_ID, pidFor('task-A'))).toBe(true);

        // Switch to B, then back to A.
        rerenderChat(rerender, 'task-B');
        await waitFor(() => expect(screen.queryByTestId('canvas-panel-mock')).toBeNull());
        rerenderChat(rerender, 'task-A');

        // A settles into the collapsed rail — NOT the expanded panel.
        await waitFor(() => expect(screen.getByTestId('canvas-collapsed-rail')).toBeTruthy());
        expect(screen.queryByTestId('canvas-panel-mock')).toBeNull();
    });

    it('(b) reopening clears persistence and auto-opens on the next switch-back', async () => {
        mockState.canvasesByPid[pidFor('task-A')] = [{ id: 'canvas-A' }];
        mockState.canvasesByPid[pidFor('task-B')] = [];
        const { rerender } = renderChat('task-A');
        await waitFor(() => expect(screen.getByTestId('canvas-panel-mock')).toBeTruthy());

        fireEvent.click(screen.getByTestId('canvas-close'));
        await waitFor(() => expect(screen.getByTestId('canvas-collapsed-rail')).toBeTruthy());
        expect(localStorage.getItem(canvasClosedStorageKey(WS_ID, pidFor('task-A'))!)).not.toBeNull();

        // Reopen via the collapsed-rail « button.
        fireEvent.click(screen.getByTestId('canvas-reopen'));
        await waitFor(() => expect(screen.getByTestId('canvas-panel-mock')).toBeTruthy());
        expect(readCanvasClosed(WS_ID, pidFor('task-A'))).toBe(false);

        // Switch away and back — now auto-opens.
        rerenderChat(rerender, 'task-B');
        await waitFor(() => expect(screen.queryByTestId('canvas-panel-mock')).toBeNull());
        rerenderChat(rerender, 'task-A');
        await waitFor(() => expect(screen.getByTestId('canvas-panel-mock')).toBeTruthy());
        expect(screen.queryByTestId('canvas-collapsed-rail')).toBeNull();
    });

    it('(c) a fresh AI canvas edit auto-opens a closed chat and clears persistence', async () => {
        mockState.canvasesByPid[pidFor('task-A')] = [{ id: 'canvas-A' }];
        renderChat('task-A');
        await waitFor(() => expect(screen.getByTestId('canvas-panel-mock')).toBeTruthy());

        fireEvent.click(screen.getByTestId('canvas-close'));
        await waitFor(() => expect(screen.getByTestId('canvas-collapsed-rail')).toBeTruthy());
        expect(readCanvasClosed(WS_ID, pidFor('task-A'))).toBe(true);

        // SSE delivers an AI canvas update for this chat.
        act(() => {
            mockState.sseOpts.onCanvasUpdated({ canvasId: 'canvas-A', title: 'A', revision: 2, editor: 'ai' });
        });

        await waitFor(() => expect(screen.getByTestId('canvas-panel-mock')).toBeTruthy());
        expect(screen.queryByTestId('canvas-collapsed-rail')).toBeNull();
        expect(readCanvasClosed(WS_ID, pidFor('task-A'))).toBe(false);
    });

    it('(d) opening a source-file canvas collapses the agent canvas WITHOUT persisting closed', async () => {
        mockState.canvasesByPid[pidFor('task-A')] = [{ id: 'canvas-A' }];
        mockState.canvasesByPid[pidFor('task-B')] = [];
        const { rerender } = renderChat('task-A');
        await waitFor(() => expect(screen.getByTestId('canvas-panel-mock')).toBeTruthy());

        // Open the docked source-file canvas — mutual exclusion collapses the
        // agent canvas, but this is transient and must NOT persist.
        act(() => {
            window.dispatchEvent(new CustomEvent('coc-open-source-canvas', { detail: { filePath: '/x.ts' } }));
        });
        await waitFor(() => expect(screen.getByTestId('canvas-collapsed-rail')).toBeTruthy());
        expect(readCanvasClosed(WS_ID, pidFor('task-A'))).toBe(false);

        // Switch away and back — the SAME source canvas is RESTORED (the open
        // canvas is now remembered per-chat) and the close flag was never persisted.
        rerenderChat(rerender, 'task-B');
        await waitFor(() => expect(screen.queryByTestId('source-canvas-dock')).toBeNull());
        rerenderChat(rerender, 'task-A');
        await waitFor(() => expect(screen.getByTestId('source-canvas-dock')).toBeTruthy());
        expect(readCanvasClosed(WS_ID, pidFor('task-A'))).toBe(false);
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

    it('keeps a closed chat collapsed across a full reload (fresh mount)', async () => {
        mockState.canvasesByPid[pidFor('task-A')] = [{ id: 'canvas-A' }];
        const first = renderChat('task-A');
        await waitFor(() => expect(screen.getByTestId('canvas-panel-mock')).toBeTruthy());
        fireEvent.click(screen.getByTestId('canvas-close'));
        await waitFor(() => expect(screen.getByTestId('canvas-collapsed-rail')).toBeTruthy());
        first.unmount();

        // Fresh mount (simulated reload) reads the persisted flag → stays collapsed.
        renderChat('task-A');
        await waitFor(() => expect(screen.getByTestId('canvas-collapsed-rail')).toBeTruthy());
        expect(screen.queryByTestId('canvas-panel-mock')).toBeNull();
    });
});

describe('ChatDetail — restore open canvas on chat switch', () => {
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

    // (a) Each canvas surface returns exactly as it was after switching away and
    // back — the core restore behaviour for source / note / folder canvases.
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
        // Session-only memory must never touch the deliberate-close localStorage flag.
        expect(readCanvasClosed(WS_ID, pidFor('task-A'))).toBe(false);
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

    // (a) With multiple agent canvases, the EXACT open one (the second) returns —
    // not the first one discovery would otherwise auto-open.
    it('restores the exact open agent canvas (not the first linked one)', async () => {
        mockState.canvasesByPid[pidFor('task-A')] = [{ id: 'canvas-A1' }, { id: 'canvas-A2' }];
        mockState.canvasesByPid[pidFor('task-B')] = [];
        const { rerender } = renderChat('task-A');
        await waitFor(() => expect(screen.getByTestId('canvas-panel-mock')).toBeTruthy());

        // Switch to the second agent canvas (a fresh AI edit targets canvas-A2).
        act(() => {
            mockState.sseOpts.onCanvasUpdated({ canvasId: 'canvas-A2', title: 'A2', revision: 1, editor: 'ai' });
        });
        await waitFor(() => expect(screen.getByTestId('canvas-panel-mock').getAttribute('data-canvas-id')).toBe('canvas-A2'));

        rerenderChat(rerender, 'task-B');
        await waitFor(() => expect(screen.queryByTestId('canvas-panel-mock')).toBeNull());

        rerenderChat(rerender, 'task-A');
        await waitFor(() => expect(screen.getByTestId('canvas-panel-mock')).toBeTruthy());
        expect(screen.getByTestId('canvas-panel-mock').getAttribute('data-canvas-id')).toBe('canvas-A2');
    });

    // AC-03 silent fallback: a remembered agent canvas that was deleted while
    // away falls back to the first linked canvas (never a load error).
    it('silently falls back to the first linked canvas when the remembered one was deleted', async () => {
        mockState.canvasesByPid[pidFor('task-A')] = [{ id: 'canvas-A1' }, { id: 'canvas-A2' }];
        mockState.canvasesByPid[pidFor('task-B')] = [];
        const { rerender } = renderChat('task-A');
        await waitFor(() => expect(screen.getByTestId('canvas-panel-mock')).toBeTruthy());

        act(() => {
            mockState.sseOpts.onCanvasUpdated({ canvasId: 'canvas-A2', title: 'A2', revision: 1, editor: 'ai' });
        });
        await waitFor(() => expect(screen.getByTestId('canvas-panel-mock').getAttribute('data-canvas-id')).toBe('canvas-A2'));

        // canvas-A2 is deleted while we are away.
        mockState.canvasesByPid[pidFor('task-A')] = [{ id: 'canvas-A1' }];
        rerenderChat(rerender, 'task-B');
        await waitFor(() => expect(screen.queryByTestId('canvas-panel-mock')).toBeNull());

        rerenderChat(rerender, 'task-A');
        // Falls back to the surviving first canvas — not the deleted canvas-A2.
        await waitFor(() => expect(screen.getByTestId('canvas-panel-mock').getAttribute('data-canvas-id')).toBe('canvas-A1'));
    });

    // (b) Closing the open canvas clears the chat's memory → switch-back shows
    // nothing (no source dock, no agent panel) for a chat with no linked canvas.
    it('clears memory when the open canvas is closed → switch-back shows nothing', async () => {
        mockState.canvasesByPid[pidFor('task-A')] = [];
        mockState.canvasesByPid[pidFor('task-B')] = [];
        const { rerender } = renderChat('task-A');

        openSourceCanvas({ filePath: '/x.ts' });
        await waitFor(() => expect(screen.getByTestId('source-canvas-dock')).toBeTruthy());

        // Deliberate close clears the per-chat open-canvas memory.
        fireEvent.click(screen.getByTestId('source-canvas-close'));
        await waitFor(() => expect(screen.queryByTestId('source-canvas-dock')).toBeNull());

        rerenderChat(rerender, 'task-B');
        rerenderChat(rerender, 'task-A');
        // Nothing is restored — the chat remembers "nothing open".
        await waitFor(() => expect(screen.queryByTestId('canvas-panel-mock')).toBeNull());
        expect(screen.queryByTestId('source-canvas-dock')).toBeNull();
        expect(screen.queryByTestId('whisper-diff-dock')).toBeNull();
    });

    // (c) The deliberate-close localStorage flag still beats the restore: a chat
    // whose agent canvas was closed stays collapsed even though memory exists.
    it('keeps the deliberate-close flag winning over the remembered canvas', async () => {
        mockState.canvasesByPid[pidFor('task-A')] = [{ id: 'canvas-A' }];
        mockState.canvasesByPid[pidFor('task-B')] = [];
        const { rerender } = renderChat('task-A');
        await waitFor(() => expect(screen.getByTestId('canvas-panel-mock')).toBeTruthy());

        // Deliberately close the agent canvas (persists the close flag).
        fireEvent.click(screen.getByTestId('canvas-close'));
        await waitFor(() => expect(screen.getByTestId('canvas-collapsed-rail')).toBeTruthy());
        expect(readCanvasClosed(WS_ID, pidFor('task-A'))).toBe(true);

        rerenderChat(rerender, 'task-B');
        await waitFor(() => expect(screen.queryByTestId('canvas-panel-mock')).toBeNull());
        rerenderChat(rerender, 'task-A');

        // Flag wins → collapsed rail, never the expanded panel.
        await waitFor(() => expect(screen.getByTestId('canvas-collapsed-rail')).toBeTruthy());
        expect(screen.queryByTestId('canvas-panel-mock')).toBeNull();
    });

    // (d) The open-canvas memory is held in memory only — opening + restoring a
    // source canvas must write NOTHING that encodes it to localStorage.
    it('does not persist the open-canvas memory to localStorage', async () => {
        mockState.canvasesByPid[pidFor('task-A')] = [{ id: 'canvas-A' }];
        mockState.canvasesByPid[pidFor('task-B')] = [];
        const { rerender } = renderChat('task-A');
        await waitFor(() => expect(screen.getByTestId('canvas-panel-mock')).toBeTruthy());

        openSourceCanvas({ filePath: '/secret-canvas-path.ts' });
        await waitFor(() => expect(screen.getByTestId('source-canvas-dock')).toBeTruthy());

        // Round-trip to force a memory snapshot + restore.
        rerenderChat(rerender, 'task-B');
        rerenderChat(rerender, 'task-A');
        await waitFor(() => expect(screen.getByTestId('source-canvas-dock')).toBeTruthy());

        // No localStorage value encodes the remembered canvas, and no deliberate-
        // close flag was set by a mere open/restore.
        const dump = Object.keys(localStorage)
            .map(k => `${k}=${localStorage.getItem(k)}`)
            .join(';');
        expect(dump).not.toContain('/secret-canvas-path.ts');
        expect(localStorage.getItem(canvasClosedStorageKey(WS_ID, pidFor('task-A'))!)).toBeNull();
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

// ── canvas-popout-replaces-panel ────────────────────────────────────────────

describe('ChatDetail — pop out replaces the right panel', () => {
    /** Fake popout window handle whose `closed` flag a test can flip. */
    function stubWindowOpen() {
        const handle = { closed: false, focus: vi.fn() };
        const openSpy = vi.spyOn(window, 'open').mockReturnValue(handle as unknown as Window);
        return { handle, openSpy };
    }

    it('(AC-01) popping out collapses the panel to a distinct "popped out" rail', async () => {
        mockState.canvasesByPid[pidFor('task-A')] = [{ id: 'canvas-A' }];
        stubWindowOpen();
        renderChat('task-A');
        await waitFor(() => expect(screen.getByTestId('canvas-panel-mock')).toBeTruthy());

        fireEvent.click(screen.getByTestId('canvas-popout'));

        // Panel collapses to the popped-out rail — NOT the manual-close rail.
        await waitFor(() => expect(screen.getByTestId('canvas-poppedout-rail')).toBeTruthy());
        expect(screen.queryByTestId('canvas-panel-mock')).toBeNull();
        expect(screen.queryByTestId('canvas-collapsed-rail')).toBeNull();
        // Popping out must not persist the deliberate-close flag.
        expect(readCanvasClosed(WS_ID, pidFor('task-A'))).toBe(false);
    });

    it('(AC-01/AC-03) opens the popout window with the canvas id and reuses its window name', async () => {
        mockState.canvasesByPid[pidFor('task-A')] = [{ id: 'canvas-A' }];
        const { openSpy } = stubWindowOpen();
        renderChat('task-A');
        await waitFor(() => expect(screen.getByTestId('canvas-panel-mock')).toBeTruthy());

        fireEvent.click(screen.getByTestId('canvas-popout'));

        expect(openSpy).toHaveBeenCalledOnce();
        const [url, name] = openSpy.mock.calls[0];
        expect(url).toContain('canvasId=canvas-A');
        expect(url).toContain('#popout/canvas');
        // Reused window name gives focus-existing-instead-of-duplicate for free.
        expect(name).toBe('coc-canvas-canvas-A');
    });

    it('(AC-03) focus rail button focuses the existing popout window', async () => {
        mockState.canvasesByPid[pidFor('task-A')] = [{ id: 'canvas-A' }];
        const { handle } = stubWindowOpen();
        renderChat('task-A');
        await waitFor(() => expect(screen.getByTestId('canvas-panel-mock')).toBeTruthy());

        fireEvent.click(screen.getByTestId('canvas-popout'));
        await waitFor(() => expect(screen.getByTestId('canvas-poppedout-rail')).toBeTruthy());

        fireEvent.click(screen.getByTestId('canvas-poppedout-focus'));
        expect(handle.focus).toHaveBeenCalledOnce();
    });

    it('(AC-02) closing the popout window restores the panel', async () => {
        mockState.canvasesByPid[pidFor('task-A')] = [{ id: 'canvas-A' }];
        const { handle } = stubWindowOpen();
        renderChat('task-A');
        await waitFor(() => expect(screen.getByTestId('canvas-panel-mock')).toBeTruthy());

        fireEvent.click(screen.getByTestId('canvas-popout'));
        await waitFor(() => expect(screen.getByTestId('canvas-poppedout-rail')).toBeTruthy());

        // The user closes the popout window; the close-poll (500ms) picks it up.
        handle.closed = true;
        await waitFor(() => expect(screen.getByTestId('canvas-panel-mock')).toBeTruthy(), { timeout: 2000 });
        expect(screen.queryByTestId('canvas-poppedout-rail')).toBeNull();
    });

    it('(AC-03) a different active canvas shows normally while the popout stays pinned', async () => {
        mockState.canvasesByPid[pidFor('task-A')] = [{ id: 'canvas-A1' }, { id: 'canvas-A2' }];
        stubWindowOpen();
        renderChat('task-A');
        await waitFor(() => expect(screen.getByTestId('canvas-panel-mock').getAttribute('data-canvas-id')).toBe('canvas-A1'));

        // Pop out canvas-A1 → the column collapses to the popped-out rail.
        fireEvent.click(screen.getByTestId('canvas-popout'));
        await waitFor(() => expect(screen.getByTestId('canvas-poppedout-rail')).toBeTruthy());

        // A fresh AI edit makes canvas-A2 the active canvas. It is NOT the pinned
        // popped-out one, so the right panel reopens showing canvas-A2.
        act(() => {
            mockState.sseOpts.onCanvasUpdated({ canvasId: 'canvas-A2', title: 'A2', revision: 1, editor: 'ai' });
        });
        await waitFor(() => expect(screen.getByTestId('canvas-panel-mock').getAttribute('data-canvas-id')).toBe('canvas-A2'));
        expect(screen.queryByTestId('canvas-poppedout-rail')).toBeNull();
    });
});
