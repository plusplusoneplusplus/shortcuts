/**
 * Tests for NewChatDialog mobile layout — bottom padding clearance for bottom nav.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { AppProvider } from '../../../../src/server/spa/client/react/context/AppContext';
import { MinimizedDialogsProvider, MinimizedDialogsTray } from '../../../../src/server/spa/client/react/context/MinimizedDialogsContext';
import { NewChatDialog } from '../../../../src/server/spa/client/react/chat/NewChatDialog';
import { mockViewport } from '../../helpers/viewport-mock';

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: vi.fn().mockResolvedValue([]),
}));

import { fetchApi } from '../../../../src/server/spa/client/react/hooks/useApi';
import type { Mock } from 'vitest';
const mockFetchApi = fetchApi as Mock;

vi.mock('../../../../src/server/spa/client/react/hooks/usePreferences', () => ({
    usePreferences: () => ({ model: '', setModel: vi.fn(), loaded: true }),
}));

vi.mock('../../../../src/server/spa/client/react/hooks/useImagePaste', () => ({
    useImagePaste: () => ({
        images: [],
        addFromPaste: vi.fn(),
        removeImage: vi.fn(),
        clearImages: vi.fn(),
    }),
}));

vi.mock('../../../../src/server/spa/client/react/processes/ConversationTurnBubble', () => ({
    ConversationTurnBubble: ({ turn }: any) => (
        <div data-testid="conversation-turn">{turn.content}</div>
    ),
}));

vi.mock('../../../../src/server/spa/client/react/shared/ImagePreviews', () => ({
    ImagePreviews: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/repos/SlashCommandMenu', () => ({
    SlashCommandMenu: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/repos/useSlashCommands', () => ({
    useSlashCommands: () => ({
        menuVisible: false,
        menuFilter: '',
        highlightIndex: 0,
        filteredSkills: [],
        handleInputChange: vi.fn(),
        handleKeyDown: vi.fn(() => false),
        dismissMenu: vi.fn(),
        selectSkill: vi.fn(),
        parseAndExtract: (text: string) => ({ skills: [], prompt: text }),
    }),
}));

// ── Helpers ────────────────────────────────────────────────────────────

const mockFetch = vi.fn();

function renderDialog(props: Partial<React.ComponentProps<typeof NewChatDialog>> = {}) {
    const defaultProps: React.ComponentProps<typeof NewChatDialog> = {
        workspaceId: 'ws-1',
        workspacePath: '/path/to/repo',
        onMinimize: vi.fn(),
        onRestore: vi.fn(),
        onClose: vi.fn(),
        ...props,
    };
    return render(
        <AppProvider>
            <MinimizedDialogsProvider>
                <NewChatDialog {...defaultProps} />
                <MinimizedDialogsTray />
            </MinimizedDialogsProvider>
        </AppProvider>,
    );
}

/** Set up fetch mocks so a chat can be started and streaming completed. */
function setupStartChatMocks(eventListeners: Record<string, Function>) {
    mockFetchApi.mockImplementation((url: string) => {
        if (url.includes('/queue/models')) return Promise.resolve({ models: [] });
        if (url.includes('/skills')) return Promise.resolve({ skills: [] });
        return Promise.resolve([]);
    });

    mockFetch.mockImplementation((url: string, opts?: any) => {
        if (url.includes('/queue/models')) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ models: [] }) });
        }
        if (url.includes('/skills')) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ skills: [] }) });
        }
        if (opts?.method === 'POST' && url.includes('/queue')) {
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ task: { id: 'task-1', processId: 'proc-1', status: 'running' } }),
            });
        }
        if (url.includes('/processes/')) {
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({
                    process: {
                        conversationTurns: [
                            { role: 'user', content: 'hello', timeline: [] },
                            { role: 'assistant', content: 'world', timeline: [] },
                        ],
                    },
                }),
            });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    (global as any).EventSource = vi.fn().mockImplementation(() => ({
        addEventListener: (event: string, fn: Function) => { eventListeners[event] = fn; },
        removeEventListener: vi.fn(),
        close: vi.fn(),
        onerror: null,
    }));
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('NewChatDialog mobile layout', () => {
    let viewportCleanup: (() => void) | undefined;

    beforeEach(() => {
        vi.restoreAllMocks();
        mockFetch.mockReset();
        global.fetch = mockFetch;
    });

    afterEach(() => {
        viewportCleanup?.();
        viewportCleanup = undefined;
    });

    it('follow-up wrapper has pb-14 on mobile to clear bottom nav', async () => {
        viewportCleanup = mockViewport(375);
        const eventListeners: Record<string, Function> = {};
        setupStartChatMocks(eventListeners);

        await act(async () => { renderDialog(); });

        // Start a chat
        const textarea = screen.getByTestId('new-chat-input') as HTMLTextAreaElement;
        fireEvent.change(textarea, { target: { value: 'hello' } });
        await act(async () => { fireEvent.click(screen.getByTestId('new-chat-start-btn')); });

        // Complete streaming so conversation view is shown
        await act(async () => { eventListeners['done']?.(); });

        const wrapper = document.querySelector('[data-testid="new-chat-followup-wrapper"]') as HTMLElement;
        expect(wrapper).not.toBeNull();
        expect(wrapper.className).toContain('pb-14');
    });

    it('follow-up wrapper does NOT have pb-14 on desktop', async () => {
        viewportCleanup = mockViewport(1280);
        const eventListeners: Record<string, Function> = {};
        setupStartChatMocks(eventListeners);

        await act(async () => { renderDialog(); });

        const textarea = screen.getByTestId('new-chat-input') as HTMLTextAreaElement;
        fireEvent.change(textarea, { target: { value: 'hello' } });
        await act(async () => { fireEvent.click(screen.getByTestId('new-chat-start-btn')); });

        await act(async () => { eventListeners['done']?.(); });

        const wrapper = document.querySelector('[data-testid="new-chat-followup-wrapper"]') as HTMLElement;
        expect(wrapper).not.toBeNull();
        expect(wrapper.className).not.toContain('pb-14');
    });
});
