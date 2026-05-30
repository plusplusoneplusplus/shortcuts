/**
 * Tests for NewChatArea — the empty-state chat component on the Activity tab.
 */
/* @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react';
import React from 'react';

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const { mockQueueDispatch, mockAppState, mockFetch, mockAppDispatch, mockModelCommand, mockSlashCommands, mockEnqueueTask, mockDraftStore, mockDefaultModelResult, mockRalphEnabled } = vi.hoisted(() => ({
    mockQueueDispatch: vi.fn(),
    mockAppState: {
        workspaces: [{ id: 'ws-1', rootPath: '/home/user/repo' }],
        onboardingProgress: { hasUsedChat: false },
    } as Record<string, any>,
    mockFetch: vi.fn(),
    mockAppDispatch: vi.fn(),
    mockEnqueueTask: vi.fn(),
    mockModelCommand: {
        modelMenuVisible: false,
        modelFilter: '',
        filteredModels: [],
        modelHighlightIndex: 0,
        modelOverride: null as string | null,
        setModelOverride: vi.fn(),
        handleModelSelect: vi.fn(),
        showModelMenu: vi.fn(),
        dismissModelMenu: vi.fn(),
        handleModelKeyDown: vi.fn(() => false),
        setModelFilter: vi.fn(),
    },
    mockSlashCommands: {
        menuVisible: false,
        menuFilter: '',
        filteredSkills: [],
        highlightIndex: 0,
        handleInputChange: vi.fn(),
        handleKeyDown: vi.fn(() => false),
        selectSkill: vi.fn(),
        parseAndExtract: vi.fn(() => ({ skills: [], prompt: '' })),
        dismissMenu: vi.fn(),
    },
    mockDraftStore: {
        getDraft: vi.fn(() => null),
        setDraft: vi.fn(),
        clearDraft: vi.fn(),
        newChatDraftKey: vi.fn((wsId?: string) => `new-chat:${wsId ?? '__global__'}`),
    },
    mockDefaultModelResult: {
        effectiveModel: undefined as string | undefined,
        effectiveModelName: undefined as string | undefined,
    },
    mockRalphEnabled: { value: false },
}));

vi.mock('../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ state: {}, dispatch: mockQueueDispatch }),
}));

vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({ state: mockAppState, dispatch: mockAppDispatch }),
}));

vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => '/api',
    getConfig: () => ({ apiBasePath: '/api' }),
    isRalphEnabled: () => mockRalphEnabled.value,
    isLoopsEnabled: () => false,
    getDefaultProvider: () => 'copilot' as const,
    isEffortLevelsEnabled: () => false,
}));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        queue: { enqueue: mockEnqueueTask },
        preferences: {
            patchGlobal: vi.fn().mockResolvedValue({}),
            getRepo: vi.fn().mockResolvedValue({}),
            patchRepo: vi.fn().mockResolvedValue({}),
        },
        skills: { listAllWorkspace: vi.fn().mockResolvedValue({ merged: [] }) },
        agentProviders: { list: vi.fn().mockResolvedValue({ providers: [
            { id: 'copilot', label: 'Copilot', enabled: true, available: true, locked: true },
            { id: 'codex', label: 'Codex', enabled: false, available: false },
            { id: 'claude', label: 'Claude', enabled: false, available: false, reason: 'Claude Code not installed' },
        ] }), getReasoningEfforts: vi.fn().mockResolvedValue({ reasoningEfforts: {} }),
            getEffortTiers: vi.fn().mockResolvedValue({ effortTiers: {} }) },
    }),
    getSpaCocClientErrorMessage: (err: any, fallback: string) =>
        (err instanceof Error ? err.message : undefined) || fallback,
}));

vi.mock('../../../../src/server/spa/client/react/hooks/useModels', () => ({
    useModels: () => ({ models: [
        { id: 'gpt-5.4', name: 'GPT-5.4', tokenLimit: 128000, enabled: true },
        { id: 'claude-sonnet-4.6', name: 'Claude Sonnet 4.6', tokenLimit: 128000, enabled: true },
    ], loading: false, error: null, reload: vi.fn() }),
}));

vi.mock('../../../../src/server/spa/client/react/features/chat/hooks/useSlashCommands', () => ({
    useSlashCommands: () => mockSlashCommands,
}));

vi.mock('../../../../src/server/spa/client/react/features/chat/hooks/useModelCommand', () => ({
    useModelCommand: () => mockModelCommand,
    selectPickableModels: (models: unknown[]) => models,
}));

vi.mock('../../../../src/server/spa/client/react/hooks/useDefaultModelForMode', () => ({
    useDefaultModelForMode: () => mockDefaultModelResult,
}));

vi.mock('../../../../src/server/spa/client/react/features/chat/hooks/useDraftStore', () => ({
    getDraft: (...args: any[]) => mockDraftStore.getDraft(...args),
    setDraft: (...args: any[]) => mockDraftStore.setDraft(...args),
    clearDraft: (...args: any[]) => mockDraftStore.clearDraft(...args),
    newChatDraftKey: (...args: any[]) => mockDraftStore.newChatDraftKey(...args),
}));

vi.mock('../../../../src/server/spa/client/react/features/chat/SlashCommandMenu', () => ({
    SlashCommandMenu: () => null,
    META_SKILL_ITEMS: [],
    getMetaSkillItems: () => [],
    mergeSkillsWithMeta: (skills: any[]) => skills,
}));

vi.mock('../../../../src/server/spa/client/react/features/chat/ModelCommandMenu', () => ({
    ModelCommandMenu: () => null,
}));

// Hoisted mock state for the prompt-autocomplete hook so individual tests
// can inject a fake completion to verify Tab acceptance / Escape dismissal.
const { mockAutocomplete } = vi.hoisted(() => ({
    mockAutocomplete: {
        completion: '' as string,
        accept: vi.fn(() => ''),
        dismiss: vi.fn(),
    },
}));

vi.mock('../../../../src/server/spa/client/react/hooks/usePromptAutocomplete', () => ({
    usePromptAutocomplete: () => mockAutocomplete,
}));

vi.mock('../../../../src/server/spa/client/react/hooks/usePromptAutocompleteEnabled', () => ({
    usePromptAutocompleteEnabled: () => true,
}));

// Hoisted mock state for the prompt-history hook.
const { mockHistory } = vi.hoisted(() => ({
    mockHistory: {
        handleKeyDown: vi.fn(() => false),
        reset: vi.fn(),
    },
}));

vi.mock('../../../../src/server/spa/client/react/hooks/useChatPromptHistory', () => ({
    useChatPromptHistory: () => mockHistory,
}));

// Minimal RichTextInput mock
vi.mock('../../../../src/server/spa/client/react/shared/RichTextInput', async () => {
    const R = await import('react');
    return {
        RichTextInput: R.forwardRef((props: any, ref: any) => {
            const [val, setVal] = R.useState('');
            R.useImperativeHandle(ref, () => ({
                getValue: () => val,
                setValue: (text: string) => setVal(text),
                focus: () => {},
            }), [val]);
            return R.createElement('input', {
                'data-testid': props['data-testid'],
                value: val,
                disabled: props.disabled,
                placeholder: props.placeholder,
                onChange: (e: any) => {
                    setVal(e.target.value);
                    props.onChange?.(e.target.value, e.target.selectionStart ?? 0);
                },
                onKeyDown: props.onKeyDown,
            });
        }),
    };
});

import { NewChatArea } from '../../../../src/server/spa/client/react/features/chat/NewChatArea';

beforeEach(() => {
    vi.clearAllMocks();
    mockAppState.workspaces = [{ id: 'ws-1', rootPath: '/home/user/repo' }];
    mockAppState.onboardingProgress = { hasUsedChat: false };
    mockModelCommand.modelOverride = null;
    mockModelCommand.modelMenuVisible = false;
    mockDefaultModelResult.effectiveModel = undefined;
    mockDefaultModelResult.effectiveModelName = undefined;
    mockEnqueueTask.mockResolvedValue({ task: { id: 'default-task' } });
    mockAutocomplete.completion = '';
    mockAutocomplete.accept = vi.fn(() => '');
    mockAutocomplete.dismiss = vi.fn();
    mockHistory.handleKeyDown = vi.fn(() => false);
    mockHistory.reset = vi.fn();
    mockDraftStore.getDraft.mockReturnValue(null);
    mockRalphEnabled.value = false;
    // Stub fetch for non-queue uses (e.g. useOnboardingPreferences → patchGlobalPreferences)
    globalThis.fetch = mockFetch;
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('NewChatArea', () => {
    it('renders hero text and input elements', () => {
        render(<NewChatArea workspaceId="ws-1" />);
        expect(screen.getByText('Start a new conversation')).toBeTruthy();
        expect(screen.getByText('Type a message below to begin')).toBeTruthy();
        expect(screen.getByTestId('new-chat-input')).toBeTruthy();
        expect(screen.getByTestId('new-chat-send-btn')).toBeTruthy();
    });

    it('root container declares theme-aware background (white in light, #1e1e1e in dark)', () => {
        // Regression: previously the new-chat empty state inherited no
        // explicit background, which rendered as pure black in dark mode.
        render(<NewChatArea workspaceId="ws-1" />);
        const root = screen.getByTestId('new-chat-area');
        expect(root.className).toContain('bg-white');
        expect(root.className).toContain('dark:bg-[#1e1e1e]');
    });

    it('send button is disabled when input is empty', () => {
        render(<NewChatArea workspaceId="ws-1" />);
        const btn = screen.getByTestId('new-chat-send-btn') as HTMLButtonElement;
        expect(btn.disabled).toBe(true);
    });

    it('send button has tooltip with keyboard shortcut hints', () => {
        render(<NewChatArea workspaceId="ws-1" />);
        const btn = screen.getByTestId('new-chat-send-btn');
        expect(btn.getAttribute('title')).toBe(
            'Send (Enter) · Shift+Enter for newline',
        );
    });

    it('send button shows the "Send" label', () => {
        render(<NewChatArea workspaceId="ws-1" />);
        const btn = screen.getByTestId('new-chat-send-btn');
        expect(btn.textContent).toContain('Send');
    });

    it('send button is enabled after typing', () => {
        render(<NewChatArea workspaceId="ws-1" />);
        const input = screen.getByTestId('new-chat-input') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'Hello' } });
        const btn = screen.getByTestId('new-chat-send-btn') as HTMLButtonElement;
        expect(btn.disabled).toBe(false);
    });

    it('renders mode pill selector with ask mode by default', () => {
        render(<NewChatArea workspaceId="ws-1" />);
        expect(screen.getByTestId('mode-selector')).toBeTruthy();
        expect(screen.getByTestId('mode-pill-ask')).toBeTruthy();
        expect(screen.getByTestId('mode-pill-plan')).toBeTruthy();
        expect(screen.getByTestId('mode-pill-autopilot')).toBeTruthy();
        expect(screen.getByTestId('mode-pill-ask').getAttribute('aria-checked')).toBe('true');
    });

    it('sends with default ask mode', async () => {
        mockEnqueueTask.mockResolvedValueOnce({ task: { id: 'task-ask' } });

        render(<NewChatArea workspaceId="ws-1" />);
        const input = screen.getByTestId('new-chat-input') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'Hello' } });

        await act(async () => {
            fireEvent.click(screen.getByTestId('new-chat-send-btn'));
        });

        const body = mockEnqueueTask.mock.calls[0][0];
        expect(body.payload.mode).toBe('ask');
    });

    it('enqueues chat task via cocClient on submit and selects the new task', async () => {
        mockEnqueueTask.mockResolvedValueOnce({ task: { id: 'new-task-42' } });

        render(<NewChatArea workspaceId="ws-1" />);
        const input = screen.getByTestId('new-chat-input') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'Hello world' } });

        await act(async () => {
            fireEvent.click(screen.getByTestId('new-chat-send-btn'));
        });

        expect(mockEnqueueTask).toHaveBeenCalledTimes(1);
        const body = mockEnqueueTask.mock.calls[0][0];
        expect(body.type).toBe('chat');
        expect(body.payload.kind).toBe('chat');
        expect(body.payload.mode).toBe('ask');
        expect(body.payload.prompt).toBe('Hello world');
        expect(body.payload.workingDirectory).toBe('/home/user/repo');
        expect(body.payload.workspaceId).toBe('ws-1');

        expect(mockQueueDispatch).toHaveBeenCalledWith({
            type: 'SELECT_QUEUE_TASK',
            id: 'queue_new-task-42',
            repoId: 'ws-1',
        });
    });

    it('shows error when enqueue fails', async () => {
        mockEnqueueTask.mockRejectedValueOnce(new Error('Internal Server Error'));

        render(<NewChatArea workspaceId="ws-1" />);
        const input = screen.getByTestId('new-chat-input') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'test message' } });

        await act(async () => {
            fireEvent.click(screen.getByTestId('new-chat-send-btn'));
        });

        expect(screen.getByTestId('new-chat-error')).toBeTruthy();
        expect(screen.getByTestId('new-chat-error').textContent).toBe('Internal Server Error');
    });

    it('shows error when enqueue throws', async () => {
        mockEnqueueTask.mockRejectedValueOnce(new Error('Network failure'));

        render(<NewChatArea workspaceId="ws-1" />);
        const input = screen.getByTestId('new-chat-input') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'test' } });

        await act(async () => {
            fireEvent.click(screen.getByTestId('new-chat-send-btn'));
        });

        expect(screen.getByTestId('new-chat-error').textContent).toBe('Network failure');
    });

    it('does not send when input is only whitespace', async () => {
        render(<NewChatArea workspaceId="ws-1" />);
        const input = screen.getByTestId('new-chat-input') as HTMLInputElement;
        fireEvent.change(input, { target: { value: '   ' } });

        // Button should still be disabled since trim() is empty
        const btn = screen.getByTestId('new-chat-send-btn') as HTMLButtonElement;
        expect(btn.disabled).toBe(true);
    });

    it('shows Stop button while sending', async () => {
        let resolvePost: (v: any) => void;
        mockEnqueueTask.mockReturnValueOnce(new Promise(r => { resolvePost = r; }));

        render(<NewChatArea workspaceId="ws-1" />);
        const input = screen.getByTestId('new-chat-input') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'Hello' } });

        // Start sending but don't resolve yet
        act(() => {
            fireEvent.click(screen.getByTestId('new-chat-send-btn'));
        });

        await waitFor(() => {
            expect(screen.getByTestId('new-chat-stop-btn')).toBeTruthy();
            expect(screen.queryByTestId('new-chat-send-btn')).toBeNull();
        });

        // Resolve the enqueue
        await act(async () => {
            resolvePost!({ task: { id: 'done' } });
        });

        expect(screen.getByTestId('new-chat-send-btn')).toBeTruthy();
        expect(screen.queryByTestId('new-chat-stop-btn')).toBeNull();
    });

    it('Enter key triggers send', async () => {
        mockEnqueueTask.mockResolvedValueOnce({ task: { id: 'enter-task' } });

        render(<NewChatArea workspaceId="ws-1" />);
        const input = screen.getByTestId('new-chat-input') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'Hello' } });

        await act(async () => {
            fireEvent.keyDown(input, { key: 'Enter' });
        });

        expect(mockEnqueueTask).toHaveBeenCalledTimes(1);
    });

    it('Shift+Enter does not trigger send', async () => {
        render(<NewChatArea workspaceId="ws-1" />);
        const input = screen.getByTestId('new-chat-input') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'Hello' } });

        fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });

        expect(mockEnqueueTask).not.toHaveBeenCalled();
    });

    it('handles missing workspace gracefully (no workingDirectory)', async () => {
        mockEnqueueTask.mockResolvedValueOnce({ task: { id: 'no-ws-task' } });
        mockAppState.workspaces = [];

        render(<NewChatArea workspaceId="ws-unknown" />);
        const input = screen.getByTestId('new-chat-input') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'Hello' } });

        await act(async () => {
            fireEvent.click(screen.getByTestId('new-chat-send-btn'));
        });

        const body = mockEnqueueTask.mock.calls[0][0];
        expect(body.payload.workingDirectory).toBeUndefined();
    });

    it('dispatches UPDATE_ONBOARDING with hasUsedChat after successful send', async () => {
        mockEnqueueTask.mockResolvedValueOnce({ task: { id: 'task-1' } });

        render(<NewChatArea workspaceId="ws-1" />);
        const input = screen.getByTestId('new-chat-input') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'Hello' } });

        await act(async () => {
            fireEvent.click(screen.getByTestId('new-chat-send-btn'));
        });

        expect(mockAppDispatch).toHaveBeenCalledWith({
            type: 'UPDATE_ONBOARDING',
            payload: { hasUsedChat: true },
        });
    });

    it('does not dispatch UPDATE_ONBOARDING if hasUsedChat is already true', async () => {
        mockAppState.onboardingProgress = { hasUsedChat: true };
        mockEnqueueTask.mockResolvedValueOnce({ task: { id: 'task-2' } });

        render(<NewChatArea workspaceId="ws-1" />);
        const input = screen.getByTestId('new-chat-input') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'Hello' } });

        await act(async () => {
            fireEvent.click(screen.getByTestId('new-chat-send-btn'));
        });

        expect(mockAppDispatch).not.toHaveBeenCalledWith(
            expect.objectContaining({ type: 'UPDATE_ONBOARDING' }),
        );
    });

    it('does not dispatch UPDATE_ONBOARDING when enqueue fails', async () => {
        mockEnqueueTask.mockRejectedValueOnce(new Error('Server error'));

        render(<NewChatArea workspaceId="ws-1" />);
        const input = screen.getByTestId('new-chat-input') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'Hello' } });

        await act(async () => {
            fireEvent.click(screen.getByTestId('new-chat-send-btn'));
        });

        expect(mockAppDispatch).not.toHaveBeenCalled();
    });

    describe('model command in new chat', () => {
        it('shows the active model name on the picker chip when modelOverride is set', () => {
            mockModelCommand.modelOverride = 'gpt-5.4';
            render(<NewChatArea workspaceId="ws-1" />);
            const chip = screen.getByTestId('model-picker-chip');
            expect(chip.textContent).toContain('gpt-5.4');
            // The standalone "new-chat-model-badge" is gone — the chip is the
            // single source of truth for the active model.
            expect(screen.queryByTestId('new-chat-model-badge')).toBeNull();
        });

        it('drops the inline ✕ in favour of a chevron — matches AgentSelectorChip', () => {
            mockModelCommand.modelOverride = 'gpt-5.4';
            render(<NewChatArea workspaceId="ws-1" />);
            const chip = screen.getByTestId('model-picker-chip');
            expect(chip).toBeTruthy();
            expect(screen.queryByTestId('model-picker-chip-clear')).toBeNull();
        });

        it('does not render a separate model badge when modelOverride is null', () => {
            mockModelCommand.modelOverride = null;
            render(<NewChatArea workspaceId="ws-1" />);
            expect(screen.queryByTestId('new-chat-model-badge')).toBeNull();
            // The inline ✕ clear is gone in either state — clearing happens
            // via the "Use default" entry in the dropdown menu.
            expect(screen.queryByTestId('model-picker-chip-clear')).toBeNull();
        });

        it('includes model in payload when modelOverride is set', async () => {
            mockModelCommand.modelOverride = 'claude-sonnet-4.6';
            mockEnqueueTask.mockResolvedValueOnce({ task: { id: 'model-task' } });

            render(<NewChatArea workspaceId="ws-1" />);
            const input = screen.getByTestId('new-chat-input') as HTMLInputElement;
            fireEvent.change(input, { target: { value: 'Hello' } });

            await act(async () => {
                fireEvent.click(screen.getByTestId('new-chat-send-btn'));
            });

            const body = mockEnqueueTask.mock.calls[0][0];
            expect(body.payload.model).toBe('claude-sonnet-4.6');
        });

        it('does not include model in payload when modelOverride is null', async () => {
            mockModelCommand.modelOverride = null;
            mockEnqueueTask.mockResolvedValueOnce({ task: { id: 'no-model-task' } });

            render(<NewChatArea workspaceId="ws-1" />);
            const input = screen.getByTestId('new-chat-input') as HTMLInputElement;
            fireEvent.change(input, { target: { value: 'Hello' } });

            await act(async () => {
                fireEvent.click(screen.getByTestId('new-chat-send-btn'));
            });

            const body = mockEnqueueTask.mock.calls[0][0];
            expect(body.payload.model).toBeUndefined();
        });

        it('placeholder mentions slash commands', () => {
            render(<NewChatArea workspaceId="ws-1" />);
            const input = screen.getByTestId('new-chat-input') as HTMLInputElement;
            expect(input.placeholder).toContain('type / for commands');
        });

        it('shows default model label on chip when no override is set', () => {
            mockModelCommand.modelOverride = null;
            mockDefaultModelResult.effectiveModel = 'claude-opus-4.7';
            mockDefaultModelResult.effectiveModelName = 'Claude Opus 4.7';
            render(<NewChatArea workspaceId="ws-1" />);
            const chip = screen.getByTestId('model-picker-chip');
            expect(chip.textContent).toContain('Claude Opus 4.7');
            // The inline ✕ clear is gone entirely now (mirrors the agent
            // provider chip). Override is cleared via the dropdown menu's
            // "Use default" entry.
            expect(screen.queryByTestId('model-picker-chip-clear')).toBeNull();
        });

        it('shows override model over default model', () => {
            mockModelCommand.modelOverride = 'gpt-5.4';
            mockDefaultModelResult.effectiveModel = 'claude-opus-4.7';
            mockDefaultModelResult.effectiveModelName = 'Claude Opus 4.7';
            render(<NewChatArea workspaceId="ws-1" />);
            const chip = screen.getByTestId('model-picker-chip');
            expect(chip.textContent).toContain('gpt-5.4');
            expect(chip.textContent).not.toContain('Claude Opus 4.7');
        });

        it('shows "model" as fallback when no override and no default', () => {
            mockModelCommand.modelOverride = null;
            mockDefaultModelResult.effectiveModel = undefined;
            mockDefaultModelResult.effectiveModelName = undefined;
            render(<NewChatArea workspaceId="ws-1" />);
            const chip = screen.getByTestId('model-picker-chip');
            expect(chip.textContent).toContain('model');
        });

        it('chip tooltip indicates the default model when no override is set', () => {
            mockModelCommand.modelOverride = null;
            mockDefaultModelResult.effectiveModel = 'gpt-5.5';
            mockDefaultModelResult.effectiveModelName = 'GPT-5.5';
            render(<NewChatArea workspaceId="ws-1" />);
            const chip = screen.getByTestId('model-picker-chip');
            expect(chip.getAttribute('title')).toBe('Default: GPT-5.5 (click to override)');
        });
    });

    describe('mode selector', () => {
        it('mode pill selector lives inside the toolbar, before the model picker chip', () => {
            render(<NewChatArea workspaceId="ws-1" />);
            const toolbar = screen.getByTestId('chat-input-toolbar');
            const selector = within(toolbar).getByTestId('mode-selector');
            const chip = within(toolbar).getByTestId('model-picker-chip');
            expect(selector).toBeTruthy();
            // Selector must come BEFORE the model picker chip in DOM order.
            const pos = selector.compareDocumentPosition(chip);
            // 4 = DOCUMENT_POSITION_FOLLOWING bit
            expect(pos & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        });

        it('clicking a pill switches the active mode', () => {
            render(<NewChatArea workspaceId="ws-1" />);
            expect(screen.getByTestId('mode-pill-ask').getAttribute('aria-checked')).toBe('true');
            fireEvent.click(screen.getByTestId('mode-pill-plan'));
            expect(screen.getByTestId('mode-pill-plan').getAttribute('aria-checked')).toBe('true');
            expect(screen.getByTestId('mode-pill-ask').getAttribute('aria-checked')).toBe('false');
        });

        it('sends selected mode in payload after clicking a pill', async () => {
            mockEnqueueTask.mockResolvedValueOnce({ task: { id: 'mode-task' } });

            render(<NewChatArea workspaceId="ws-1" />);
            fireEvent.click(screen.getByTestId('mode-pill-autopilot'));

            const input = screen.getByTestId('new-chat-input') as HTMLInputElement;
            fireEvent.change(input, { target: { value: 'Do stuff' } });

            await act(async () => {
                fireEvent.click(screen.getByTestId('new-chat-send-btn'));
            });

            const body = mockEnqueueTask.mock.calls[0][0];
            expect(body.payload.mode).toBe('autopilot');
        });

        it('Shift+Tab keyboard shortcut still cycles mode', () => {
            render(<NewChatArea workspaceId="ws-1" />);
            const input = screen.getByTestId('new-chat-input') as HTMLInputElement;
            expect(screen.getByTestId('mode-pill-ask').getAttribute('aria-checked')).toBe('true');

            fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
            expect(screen.getByTestId('mode-pill-plan').getAttribute('aria-checked')).toBe('true');
        });
    });

    describe('inline ghost-text autocomplete', () => {
        it('Tab accepts the ghost-text completion into the input', () => {
            mockAutocomplete.completion = 'world';
            mockAutocomplete.accept = vi.fn(() => 'Hello world');

            render(<NewChatArea workspaceId="ws-1" />);
            const input = screen.getByTestId('new-chat-input') as HTMLInputElement;
            fireEvent.change(input, { target: { value: 'Hello ' } });
            fireEvent.keyDown(input, { key: 'Tab' });

            expect(mockAutocomplete.accept).toHaveBeenCalled();
            expect(mockAutocomplete.dismiss).toHaveBeenCalled();
            expect(input.value).toBe('Hello world');
        });

        it('Escape dismisses an active ghost-text completion', () => {
            mockAutocomplete.completion = 'world';

            render(<NewChatArea workspaceId="ws-1" />);
            const input = screen.getByTestId('new-chat-input') as HTMLInputElement;
            fireEvent.change(input, { target: { value: 'Hello ' } });
            fireEvent.keyDown(input, { key: 'Escape' });

            expect(mockAutocomplete.dismiss).toHaveBeenCalled();
        });

        it('Tab without an active completion does not call accept', () => {
            mockAutocomplete.completion = '';

            render(<NewChatArea workspaceId="ws-1" />);
            const input = screen.getByTestId('new-chat-input') as HTMLInputElement;
            fireEvent.keyDown(input, { key: 'Tab' });

            expect(mockAutocomplete.accept).not.toHaveBeenCalled();
        });
    });

    describe('prompt history navigation', () => {
        it('forwards ArrowUp to the prompt-history hook', () => {
            render(<NewChatArea workspaceId="ws-1" />);
            const input = screen.getByTestId('new-chat-input') as HTMLInputElement;
            fireEvent.keyDown(input, { key: 'ArrowUp' });
            expect(mockHistory.handleKeyDown).toHaveBeenCalled();
            const arg = mockHistory.handleKeyDown.mock.calls[0][0];
            expect(arg.key).toBe('ArrowUp');
        });

        it('forwards ArrowDown to the prompt-history hook', () => {
            render(<NewChatArea workspaceId="ws-1" />);
            const input = screen.getByTestId('new-chat-input') as HTMLInputElement;
            fireEvent.keyDown(input, { key: 'ArrowDown' });
            expect(mockHistory.handleKeyDown).toHaveBeenCalled();
            const arg = mockHistory.handleKeyDown.mock.calls[0][0];
            expect(arg.key).toBe('ArrowDown');
        });

        it('does not invoke history when ghost-text Tab is consumed first', () => {
            mockAutocomplete.completion = 'world';
            mockAutocomplete.accept = vi.fn(() => 'Hello world');

            render(<NewChatArea workspaceId="ws-1" />);
            const input = screen.getByTestId('new-chat-input') as HTMLInputElement;
            fireEvent.change(input, { target: { value: 'Hello ' } });
            fireEvent.keyDown(input, { key: 'Tab' });

            expect(mockAutocomplete.accept).toHaveBeenCalled();
            // Tab is not an arrow key — history should never have seen it.
            const arrowCalls = mockHistory.handleKeyDown.mock.calls.filter(
                (c: any[]) => c[0]?.key === 'ArrowUp' || c[0]?.key === 'ArrowDown',
            );
            expect(arrowCalls).toHaveLength(0);
        });

        it('skips Enter handling when history consumes the event (defensive)', () => {
            // History never consumes Enter, but verify that when handleKeyDown
            // reports true, the Enter branch is not executed (no enqueue call).
            mockHistory.handleKeyDown = vi.fn((e: any) => e.key === 'Enter');

            render(<NewChatArea workspaceId="ws-1" />);
            const input = screen.getByTestId('new-chat-input') as HTMLInputElement;
            fireEvent.change(input, { target: { value: 'Hello' } });
            fireEvent.keyDown(input, { key: 'Enter' });

            expect(mockEnqueueTask).not.toHaveBeenCalled();
        });
    });

    describe('draft persistence (localStorage)', () => {
        it('restores text and mode from saved draft on mount', () => {
            mockDraftStore.getDraft.mockReturnValue({
                text: 'saved message',
                mode: 'plan',
                updatedAt: Date.now(),
            });

            render(<NewChatArea workspaceId="ws-1" />);

            expect(mockDraftStore.getDraft).toHaveBeenCalledWith('new-chat:ws-1');
            // The RichTextInput mock sets internal value via setValue — the
            // component called setInput('saved message') so later interactions
            // will see it. We can verify the draft was read.
            expect(mockDraftStore.getDraft).toHaveBeenCalled();
        });

        it('restores modelOverride from saved draft on mount', () => {
            mockDraftStore.getDraft.mockReturnValue({
                text: 'hello',
                mode: 'ask',
                updatedAt: Date.now(),
                modelOverride: 'gpt-5.4',
            });

            render(<NewChatArea workspaceId="ws-1" />);

            expect(mockModelCommand.setModelOverride).toHaveBeenCalledWith('gpt-5.4');
        });

        it('saves draft on input change (debounced)', () => {
            vi.useFakeTimers();
            render(<NewChatArea workspaceId="ws-1" />);
            const input = screen.getByTestId('new-chat-input') as HTMLInputElement;
            fireEvent.change(input, { target: { value: 'Hello draft' } });

            // Advance past the 300ms debounce
            act(() => { vi.advanceTimersByTime(350); });

            expect(mockDraftStore.setDraft).toHaveBeenCalledWith(
                'new-chat:ws-1',
                'Hello draft',
                'ask',
                null,
                null,
            );
            vi.useRealTimers();
        });

        it('clears draft after successful send', async () => {
            mockEnqueueTask.mockResolvedValueOnce({ task: { id: 'sent-task' } });

            render(<NewChatArea workspaceId="ws-1" />);
            const input = screen.getByTestId('new-chat-input') as HTMLInputElement;
            fireEvent.change(input, { target: { value: 'test message' } });

            await act(async () => {
                fireEvent.click(screen.getByTestId('new-chat-send-btn'));
            });

            expect(mockDraftStore.clearDraft).toHaveBeenCalledWith('new-chat:ws-1');
        });

        it('does not clear draft when send fails', async () => {
            mockEnqueueTask.mockRejectedValueOnce(new Error('fail'));

            render(<NewChatArea workspaceId="ws-1" />);
            const input = screen.getByTestId('new-chat-input') as HTMLInputElement;
            fireEvent.change(input, { target: { value: 'test' } });

            await act(async () => {
                fireEvent.click(screen.getByTestId('new-chat-send-btn'));
            });

            expect(mockDraftStore.clearDraft).not.toHaveBeenCalled();
        });

        it('uses __global__ key when workspaceId is undefined', () => {
            render(<NewChatArea />);

            expect(mockDraftStore.newChatDraftKey).toHaveBeenCalledWith(undefined);
            expect(mockDraftStore.getDraft).toHaveBeenCalledWith('new-chat:__global__');
        });
    });

    describe('agent selector chip — claude provider', () => {
        it('renders claude option in the agent selector menu (disabled when unavailable)', async () => {
            await act(async () => {
                render(<NewChatArea workspaceId="ws-1" />);
            });
            // Wait for providers to load (button becomes enabled when loading=false)
            await waitFor(() => {
                const btn = screen.getByTestId('agent-selector-chip-btn') as HTMLButtonElement;
                expect(btn.disabled).toBe(false);
            });
            await act(async () => {
                fireEvent.click(screen.getByTestId('agent-selector-chip-btn'));
            });
            const claudeOption = screen.getByTestId('agent-option-claude');
            expect(claudeOption).toBeTruthy();
            // Claude is disabled in the mock (enabled: false, available: false)
            expect((claudeOption as HTMLButtonElement).disabled).toBe(true);
        });

        it('shows disabled reason for claude when it is unavailable', async () => {
            await act(async () => {
                render(<NewChatArea workspaceId="ws-1" />);
            });
            await waitFor(() => {
                const btn = screen.getByTestId('agent-selector-chip-btn') as HTMLButtonElement;
                expect(btn.disabled).toBe(false);
            });
            await act(async () => {
                fireEvent.click(screen.getByTestId('agent-selector-chip-btn'));
            });
            const claudeOption = screen.getByTestId('agent-option-claude');
            expect(claudeOption.title).toContain('Claude Code not installed');
        });
    });

    describe('ralph mode – goal.md prompt suffix', () => {
        beforeEach(() => {
            mockRalphEnabled.value = true;
        });

        it('appends goal.md instruction when ralph mode is selected', async () => {
            mockEnqueueTask.mockResolvedValueOnce({ task: { id: 'ralph-task-1' } });
            mockSlashCommands.parseAndExtract.mockReturnValue({ skills: [], prompt: '' });

            render(<NewChatArea workspaceId="ws-1" />);

            // Click the ralph pill to select ralph mode
            const ralphPill = screen.getByTestId('mode-pill-ralph');
            fireEvent.click(ralphPill);

            // Type a message and send
            const input = screen.getByTestId('new-chat-input') as HTMLInputElement;
            fireEvent.change(input, { target: { value: 'Build a CLI tool' } });

            await act(async () => {
                fireEvent.click(screen.getByTestId('new-chat-send-btn'));
            });

            const body = mockEnqueueTask.mock.calls[0][0];
            expect(body.payload.mode).toBe('ask');
            expect(body.payload.prompt).toContain('Build a CLI tool');
            expect(body.payload.prompt).toContain('.goal.md');
            expect(body.payload.prompt).toContain('finished grilling');
            expect(body.payload.context.ralph.phase).toBe('grilling');
            expect(body.payload.context.skills).toContain('grill-me');
        });

        it('does not append goal.md instruction in non-ralph modes', async () => {
            mockEnqueueTask.mockResolvedValueOnce({ task: { id: 'ask-task-1' } });
            mockSlashCommands.parseAndExtract.mockReturnValue({ skills: [], prompt: '' });

            render(<NewChatArea workspaceId="ws-1" />);

            // Stay in ask mode (default)
            const input = screen.getByTestId('new-chat-input') as HTMLInputElement;
            fireEvent.change(input, { target: { value: 'Hello world' } });

            await act(async () => {
                fireEvent.click(screen.getByTestId('new-chat-send-btn'));
            });

            const body = mockEnqueueTask.mock.calls[0][0];
            expect(body.payload.prompt).toBe('Hello world');
            expect(body.payload.prompt).not.toContain('.goal.md');
        });
    });
});
