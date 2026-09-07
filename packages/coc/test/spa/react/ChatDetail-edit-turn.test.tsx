/**
 * Integration tests for the "Edit message" wiring inside ChatDetail (AC-01,
 * AC-03, AC-04).
 *
 * These render the REAL chain — ChatDetail -> ConversationArea ->
 * ConversationTurnBubble -> InlineTurnEditor -> useEditTurn -> useSendMessage —
 * over a mocked `fetch`, so what is under test is the plumbing rather than the
 * pieces:
 *
 *   - `useEditTurn.test.tsx` proves the hook's ordering and failure branches,
 *     but every dependency there is injected. It cannot catch ChatDetail
 *     handing it the wrong `sendEdited`, `didSendFail` or `restoreComposer`.
 *   - `InlineTurnEditor.test.tsx` proves the editor hands back the right
 *     submission, but nobody listens to it there.
 *   - `ConversationTurnBubble-edit.test.tsx` passes the capability straight
 *     into the bubble, so it cannot catch ChatDetail resolving the provider
 *     wrongly (the same class of defect `ChatDetail-rewind-provider.test.tsx`
 *     guards for rewind).
 *
 * They stand in for the manual Definition-of-Done walkthroughs: the pencil per
 * provider, edit-then-resend firing rewind before send, and both failure
 * branches.
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
        /** Deliberately hostile: an unrecognized provider must not fall back to this. */
        defaultProvider: 'codex' as 'copilot' | 'codex' | 'claude' | 'opencode',
    },
}));

// ── Mocks ──────────────────────────────────────────────────────────────────
//
// Everything the edit path actually runs through stays REAL: RichTextInput,
// useFileAttachments, useSendMessage, useSlashCommands, useEditTurn and the
// bubble. Only ambient chat chrome is stubbed out.

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

vi.mock('../../../src/server/spa/client/react/queue/hooks/useQueuedTaskPoll', () => ({
    useQueuedTaskPoll: () => {},
}));

vi.mock('../../../src/server/spa/client/react/features/chat/hooks/useChatWindowActions', () => ({
    useChatWindowActions: () => ({ handlePopOut: vi.fn(), handleFloat: vi.fn() }),
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

vi.mock('../../../src/server/spa/client/react/features/chat/conversation/ConversationMiniMap', () => ({
    ConversationMiniMap: () => React.createElement('div', { 'data-testid': 'conversation-minimap' }),
}));

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

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';

interface Call { url: string; method: string; body: any }

let calls: Call[];
/** Per-URL-fragment overrides letting a test fail the rewind or the send. */
let failures: { rewind?: { status: number; body: unknown }; message?: { status: number; body: unknown } };

/**
 * Renders ChatDetail over a chat whose first user turn (`turnIndex` 0) carries
 * the rewind anchor and a pasted image.
 */
async function renderChat(opts: { provider: string; sdkEventId?: string; status?: string; images?: string[] }) {
    const status = opts.status ?? 'completed';
    const task = {
        id: 'task-1',
        type: 'chat',
        status,
        processId: 'proc-1',
        displayName: 'Test Chat',
        createdAt: '2025-06-01T12:00:00Z',
        payload: { kind: 'chat', mode: 'autopilot', prompt: 'Hello world', workingDirectory: '/home/user/project' },
        metadata: {},
    };
    const proc = {
        id: 'proc-1',
        status,
        metadata: { mode: 'autopilot', sessionId: 'sess-1', provider: opts.provider },
        conversationTurns: [
            { role: 'user', content: 'Hello', turnIndex: 0, timeline: [], sdkEventId: opts.sdkEventId, images: opts.images },
            { role: 'assistant', content: 'Hi there', turnIndex: 1, timeline: [] },
        ],
    };

    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
        const u = typeof url === 'string' ? url : String(url);
        const method = init?.method ?? 'GET';
        let body: any;
        try { body = init?.body ? JSON.parse(String(init.body)) : undefined; } catch { body = init?.body; }
        calls.push({ url: u, method, body });

        if (u.includes('/rewind') && failures.rewind) {
            return new Response(JSON.stringify(failures.rewind.body), {
                status: failures.rewind.status, headers: { 'content-type': 'application/json' },
            });
        }
        if (u.includes('/message') && failures.message) {
            return new Response(JSON.stringify(failures.message.body), {
                status: failures.message.status, headers: { 'content-type': 'application/json' },
            });
        }

        const payload = u.includes('/skills/all') ? { merged: [] }
            : u.includes('/rewind') ? { restored: { content: 'SERVER RESTORED', images: [] } }
                : u.includes('/queue/') ? { task }
                    : u.includes('/processes/') ? { process: proc }
                        : {};
        return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
    }));

    render(<Wrap><ChatDetail taskId="task-1" /></Wrap>);
    await waitFor(() => {
        expect(document.querySelector('.chat-message.user[data-turn-index="0"]')).toBeTruthy();
    });
}

const pencil = () => screen.queryByTestId('bubble-edit-btn') as HTMLButtonElement | null;
const editor = () => screen.queryByTestId('inline-turn-editor');
const editorInput = () => screen.getByTestId('inline-turn-editor-input');

/** Type into the contenteditable the way RichTextInput reads it back. */
function typeInto(text: string) {
    const div = editorInput();
    (div as HTMLElement & { innerText: string }).innerText = text;
    fireEvent.input(div);
}

async function openEditor() {
    fireEvent.click(pencil()!);
    await waitFor(() => expect(editor()).toBeTruthy());
}

const messagePosts = () => calls.filter(c => c.url.includes('/message') && c.method === 'POST');
const rewindPosts = () => calls.filter(c => c.url.includes('/rewind') && c.method === 'POST');

beforeEach(() => {
    mockState.defaultProvider = 'codex';
    calls = [];
    failures = {};
    localStorage.clear();
    Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

// ── AC-01: the pencil affordance, through the real provider plumbing ───────

describe('ChatDetail edit-message affordance', () => {
    it.each(['claude', 'copilot', 'opencode'] as const)(
        'offers an enabled pencil on an anchored %s turn even when the default provider is codex',
        async (provider) => {
            await renderChat({ provider, sdkEventId: 'evt_1' });
            expect(pencil()).toBeTruthy();
            expect(pencil()!.hasAttribute('disabled')).toBe(false);
        },
    );

    it('hides the pencil entirely on a codex conversation', async () => {
        await renderChat({ provider: 'codex', sdkEventId: 'evt_1' });
        expect(pencil()).toBeNull();
    });

    it('offers a disabled pencil with a tooltip on a turn with no rewind anchor', async () => {
        await renderChat({ provider: 'claude' });
        expect(pencil()).toBeTruthy();
        expect(pencil()!.hasAttribute('disabled')).toBe(true);
        expect(pencil()!.getAttribute('title')).toBe('This turn predates rewind support');
    });
});

// ── AC-03: Save & Send = rewind, then send ────────────────────────────────

describe('ChatDetail edit-message save & send', () => {
    it('prefills the editor from the turn and, on save, rewinds before sending the edited text', async () => {
        await renderChat({ provider: 'claude', sdkEventId: 'evt_1', images: [PNG_DATA_URL] });
        await openEditor();

        // Prefill: original text plus the turn's image as a removable chip.
        expect((editorInput() as HTMLElement & { innerText?: string }).innerText).toBe('Hello');
        expect(screen.getAllByTestId('attachment-preview-image')).toHaveLength(1);

        typeInto('edited text');
        fireEvent.click(screen.getByTestId('inline-turn-editor-save'));

        await waitFor(() => expect(messagePosts()).toHaveLength(1));

        // Rewind targets turn 0 and happens strictly before the send.
        expect(rewindPosts()).toHaveLength(1);
        expect(rewindPosts()[0].url).toContain('/processes/proc-1/turns/0/rewind');
        const rewindAt = calls.findIndex(c => c.url.includes('/rewind'));
        const sendAt = calls.findIndex(c => c.url.includes('/message') && c.method === 'POST');
        expect(rewindAt).toBeGreaterThanOrEqual(0);
        expect(rewindAt).toBeLessThan(sendAt);

        // The send carries the edited text and the retained image, not the
        // server's `restored` payload.
        expect(messagePosts()[0].body.content).toBe('edited text');
        expect(messagePosts()[0].body.images).toEqual([PNG_DATA_URL]);

        // The editor closes on success.
        await waitFor(() => expect(editor()).toBeNull());
    });

    it('Cancel is inert: no rewind, no send, editor closes', async () => {
        await renderChat({ provider: 'claude', sdkEventId: 'evt_1' });
        await openEditor();
        typeInto('half-written edit');
        fireEvent.click(screen.getByTestId('inline-turn-editor-cancel'));

        await waitFor(() => expect(editor()).toBeNull());
        expect(rewindPosts()).toHaveLength(0);
        expect(messagePosts()).toHaveLength(0);
    });
});

// ── AC-04: failure handling ───────────────────────────────────────────────

describe('ChatDetail edit-message failure handling', () => {
    it('keeps the editor open with a readable message and sends nothing when the rewind 409s', async () => {
        failures.rewind = { status: 409, body: { error: { code: 'CONVERSATION_NOT_IDLE', message: 'Conversation is not idle' } } };
        await renderChat({ provider: 'claude', sdkEventId: 'evt_1' });
        await openEditor();
        typeInto('edited text');
        fireEvent.click(screen.getByTestId('inline-turn-editor-save'));

        const err = await screen.findByTestId('inline-turn-editor-error');
        expect(err.textContent?.toLowerCase()).toContain('busy');
        // The editor stays open with the user's content intact, and nothing was sent.
        expect(editor()).toBeTruthy();
        expect((editorInput() as HTMLElement & { innerText?: string }).innerText).toBe('edited text');
        expect(messagePosts()).toHaveLength(0);
        // The turn the user was editing is still on screen.
        expect(document.querySelector('.chat-message.user[data-turn-index="0"]')).toBeTruthy();
    });

    it('closes the editor and surfaces an error when the send fails after a successful rewind', async () => {
        failures.message = { status: 500, body: { error: { message: 'boom' } } };
        await renderChat({ provider: 'claude', sdkEventId: 'evt_1' });
        await openEditor();
        typeInto('edited text');
        fireEvent.click(screen.getByTestId('inline-turn-editor-save'));

        await waitFor(() => expect(messagePosts()).toHaveLength(1));
        // The rewind landed, so the edit cannot simply vanish with the editor:
        // it is parked in the main composer and the failure is surfaced.
        await waitFor(() => expect(editor()).toBeNull());
        await screen.findByText(/restored into the composer/i);
        expect(rewindPosts()).toHaveLength(1);
        // That the edit itself lands back in the composer is asserted in
        // useEditTurn.test.tsx, where `restoreComposer` is injected: this
        // harness renders the conversation without the follow-up composer.
    });
});
