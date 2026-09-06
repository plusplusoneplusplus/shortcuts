/**
 * Regression tests for the provider that reaches the "Rewind to here" menu item.
 *
 * These render the REAL wiring — ChatDetail -> ConversationArea ->
 * ConversationTurnBubble — instead of handing the bubble a provider directly,
 * because the defect this guards against lived entirely in the plumbing:
 * ChatDetail's `sessionProvider` does not recognize 'opencode' and collapses it
 * onto the user's configured default provider. With that default set to 'codex',
 * an opencode chat lost its rewind action even though the backend accepts it.
 *
 * ConversationTurnBubble-rewind.test.tsx cannot catch this class of defect: it
 * passes provider="opencode" into the bubble itself.
 */
/* @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React, { type ReactNode } from 'react';
import { AppProvider } from '../../../src/server/spa/client/react/contexts/AppContext';
import { QueueProvider } from '../../../src/server/spa/client/react/contexts/QueueContext';
import { ToastProvider } from '../../../src/server/spa/client/react/contexts/ToastContext';
import { NotificationProvider } from '../../../src/server/spa/client/react/contexts/NotificationContext';
import { TaskProvider } from '../../../src/server/spa/client/react/contexts/TaskContext';

// ── Hoisted mock state ─────────────────────────────────────────────────────

const { mockState } = vi.hoisted(() => ({
    mockState: {
        /** The user's configured default provider — the crux of this suite. */
        defaultProvider: 'codex' as 'copilot' | 'codex' | 'claude' | 'opencode',
    },
}));

// ── Mocks ──────────────────────────────────────────────────────────────────

// Real config module, with only the default-provider accessors overridden so a
// test can put the user on a codex default.
vi.mock('../../../src/server/spa/client/react/utils/config', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return {
        ...actual,
        getConfiguredDefaultProvider: () => mockState.defaultProvider,
        getDefaultProvider: () => mockState.defaultProvider,
        getActiveProvider: () => mockState.defaultProvider,
    };
});

vi.mock('../../../src/server/spa/client/react/hooks/preferences/useDisplaySettings', () => ({
    useDisplaySettings: () => ({ showReportIntent: false, toolCompactness: 0, taskCardDensity: 'compact', groupSingleLineMessages: false }),
    invalidateDisplaySettings: vi.fn(),
}));

vi.mock('../../../src/server/spa/client/react/contexts/ChatPreferencesContext', () => ({
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

vi.mock('../../../src/server/spa/client/react/contexts/PopOutContext', () => ({
    usePopOut: () => ({
        poppedOutTasks: new Set<string>(),
        markPoppedOut: vi.fn(),
        markRestored: vi.fn(),
        postMessage: vi.fn(),
    }),
}));

vi.mock('../../../src/server/spa/client/react/contexts/FloatingChatsContext', () => ({
    useFloatingChats: () => ({
        floatingChats: new Map(),
        floatChat: vi.fn(),
        unfloatChat: vi.fn(),
        isFloating: () => false,
    }),
}));

vi.mock('../../../src/server/spa/client/react/features/chat/hooks/useChatSSE', () => ({
    useChatSSE: () => ({ stopStreaming: vi.fn() }),
}));

vi.mock('../../../src/server/spa/client/react/features/chat/hooks/useSendMessage', () => ({
    useSendMessage: () => ({
        sendFollowUp: vi.fn().mockResolvedValue(undefined),
        closeFollowUpStream: vi.fn(),
        onSendComplete: vi.fn(),
    }),
}));

vi.mock('../../../src/server/spa/client/react/queue/hooks/useQueuedTaskPoll', () => ({
    useQueuedTaskPoll: () => {},
}));

vi.mock('../../../src/server/spa/client/react/features/chat/hooks/useChatWindowActions', () => ({
    useChatWindowActions: () => ({ handlePopOut: vi.fn(), handleFloat: vi.fn() }),
}));

vi.mock('../../../src/server/spa/client/react/features/chat/hooks/useFileAttachments', () => ({
    useFileAttachments: () => ({
        attachments: [],
        images: [],
        addFromPaste: vi.fn(),
        addFromFileInput: vi.fn(),
        removeAttachment: vi.fn(),
        clearAttachments: vi.fn(),
        error: null,
        clearError: vi.fn(),
        toPayload: () => [],
    }),
}));

vi.mock('../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false, isTablet: false, isDesktop: true, breakpoint: 'desktop' as const }),
}));

vi.mock('../../../src/server/spa/client/react/hooks/useModels', () => ({
    useModels: () => ({ models: [], loading: false, error: null, reload: vi.fn() }),
}));

vi.mock('../../../src/server/spa/client/react/hooks/useProviderEffortTiers', () => ({
    useProviderEffortTiers: () => ({
        tiers: {}, loading: false, error: null, saveError: null, saving: false, dirty: false,
        setTier: vi.fn(), clearTier: vi.fn(), save: vi.fn(), cancel: vi.fn(), reload: vi.fn(),
    }),
}));

vi.mock('../../../src/server/spa/client/react/features/chat/hooks/useContainerWidth', () => ({
    useContainerWidth: () => ({ width: 800, tier: 'wide', isWide: true, isMedium: false, isNarrow: false }),
}));

vi.mock('../../../src/server/spa/client/react/features/chat/hooks/useDraftStore', () => ({
    getDraft: () => null,
    setDraft: vi.fn(),
    clearDraft: vi.fn(),
    pruneExpired: vi.fn(),
}));

vi.mock('../../../src/server/spa/client/react/features/chat/hooks/useAskUserDraftStore', () => ({
    getAskUserDraft: () => null,
    setAskUserDraft: vi.fn(),
    clearAskUserDraft: vi.fn(),
    clearOtherAskUserDraftsForProcess: vi.fn(),
    pruneExpiredAskUserDrafts: vi.fn(),
    clearAskUserDraftsForProcess: vi.fn(),
}));

vi.mock('../../../src/server/spa/client/react/features/chat/hooks/useSlashCommands', () => ({
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

vi.mock('../../../src/server/spa/client/react/shared/RichTextInput', async () => {
    const R = await import('react');
    return {
        RichTextInput: R.forwardRef((props: any, ref: any) => {
            R.useImperativeHandle(ref, () => ({ getValue: () => '', setValue: () => {}, focus: () => {} }), []);
            return R.createElement('div', { 'data-testid': props['data-testid'] ?? 'activity-chat-input' });
        }),
    };
});

vi.mock('../../../src/server/spa/client/react/features/chat/conversation/ConversationMiniMap', () => ({
    ConversationMiniMap: () => React.createElement('div', { 'data-testid': 'conversation-minimap' }),
}));

// Markdown rendering — kept cheap; ConversationTurnBubble itself stays REAL.
vi.mock('../../../src/server/spa/client/react/shared/MarkdownView', () => ({
    MarkdownView: ({ html }: { html: string }) =>
        React.createElement('div', { 'data-testid': 'markdown-view', dangerouslySetInnerHTML: { __html: html } }),
}));

vi.mock('../../../src/server/spa/client/diff/markdown-renderer', () => ({
    renderMarkdownToHtml: (s: string) => `<p>${s}</p>`,
}));

// Now import the component under test (after mocks)
import { ChatDetail } from '../../../src/server/spa/client/react/features/chat/ChatDetail';

// ── Harness ────────────────────────────────────────────────────────────────

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

/**
 * Renders ChatDetail over a two-turn completed chat whose process metadata
 * declares `provider`, with the user turn optionally carrying a rewind anchor.
 */
async function renderChat(opts: { provider: string; sdkEventId?: string }) {
    const task = {
        id: 'task-1',
        type: 'chat',
        status: 'completed',
        processId: 'proc-1',
        displayName: 'Test Chat',
        createdAt: '2025-06-01T12:00:00Z',
        payload: { kind: 'chat', mode: 'autopilot', prompt: 'Hello world', workingDirectory: '/home/user/project' },
        metadata: {},
    };
    const proc = {
        id: 'proc-1',
        status: 'completed',
        metadata: { mode: 'autopilot', sessionId: 'sess-1', provider: opts.provider },
        conversationTurns: [
            { role: 'user', content: 'Hello', turnIndex: 0, timeline: [], sdkEventId: opts.sdkEventId },
            { role: 'assistant', content: 'Hi there', turnIndex: 1, timeline: [] },
        ],
    };
    fetchMock.mockImplementation(async (url: string) => {
        const u = typeof url === 'string' ? url : '';
        const body = u.includes('/skills/all') ? { merged: [] }
            : u.includes('/queue/') ? { task }
                : u.includes('/processes/') ? { process: proc }
                    : {};
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    render(<Wrap><ChatDetail taskId="task-1" /></Wrap>);
    await waitFor(() => {
        expect(document.querySelector('.chat-message.user[data-turn-index="0"]')).toBeTruthy();
    });
}

/** Opens the user turn's context menu and returns the "Rewind to here" button, if any. */
function openRewindMenu(): HTMLButtonElement | null {
    fireEvent.contextMenu(document.querySelector('.chat-message.user[data-turn-index="0"]')!);
    const label = screen.queryByText('Rewind to here');
    return label ? label.closest('button') : null;
}

beforeEach(() => {
    mockState.defaultProvider = 'codex';
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    localStorage.clear();
    Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe('ChatDetail rewind provider plumbing', () => {
    it('offers an enabled rewind on an anchored opencode turn even when the default provider is codex', async () => {
        await renderChat({ provider: 'opencode', sdkEventId: 'msg_open_1' });
        const item = openRewindMenu();
        expect(item).toBeTruthy();
        expect(item!.hasAttribute('disabled')).toBe(false);
    });

    it('offers a disabled rewind with a tooltip on an anchor-less opencode turn', async () => {
        await renderChat({ provider: 'opencode' });
        const item = openRewindMenu();
        expect(item).toBeTruthy();
        expect(item!.hasAttribute('disabled')).toBe(true);
        expect(item!.closest('[title]')?.getAttribute('title')).toBe('This turn predates rewind support');
    });

    it('hides rewind entirely on a codex conversation', async () => {
        await renderChat({ provider: 'codex', sdkEventId: 'evt_1' });
        expect(openRewindMenu()).toBeNull();
    });

    it.each(['copilot', 'claude'] as const)(
        'still offers an enabled rewind on an anchored %s turn when the default provider is codex',
        async (provider) => {
            await renderChat({ provider, sdkEventId: 'evt_1' });
            const item = openRewindMenu();
            expect(item).toBeTruthy();
            expect(item!.hasAttribute('disabled')).toBe(false);
        },
    );

    it('offers rewind on a chat with no provider metadata (backend treats it as copilot)', async () => {
        mockState.defaultProvider = 'codex';
        await renderChat({ provider: undefined as unknown as string, sdkEventId: 'evt_1' });
        const item = openRewindMenu();
        expect(item).toBeTruthy();
        expect(item!.hasAttribute('disabled')).toBe(false);
    });
});
