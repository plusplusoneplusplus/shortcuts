/**
 * Tests for NewChatArea — the empty-state chat component on the Activity tab.
 */
/* @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react';
import React from 'react';

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const { mockQueueDispatch, mockAppState, mockFetch, mockAppDispatch, mockModelCommand, mockSlashCommands, mockEnqueueTask, mockDraftStore, mockDefaultModelResult, mockRalphEnabled, mockForEachEnabled, mockSessionContextAttachmentsEnabled, mockGetLlmToolsConfig, mockAgentProvidersResponse, mockEffortLevelsEnabled, mockEffortTiers } = vi.hoisted(() => ({
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
    mockForEachEnabled: { value: false },
    mockSessionContextAttachmentsEnabled: { value: false },
    mockEffortLevelsEnabled: { value: false },
    mockEffortTiers: { value: {} as Record<string, { model: string; reasoningEffort?: string | null }> },
    mockGetLlmToolsConfig: vi.fn(),
    mockAgentProvidersResponse: {
        providers: [
            { id: 'copilot', label: 'Copilot', enabled: true, available: true, locked: true },
            { id: 'codex', label: 'Codex', enabled: false, available: false },
            { id: 'claude', label: 'Claude', enabled: false, available: false, reason: 'Claude Code not installed' },
        ],
    },
}));

const OriginalFileReader = globalThis.FileReader;

function mockFileReader() {
    globalThis.FileReader = function (this: any) {
        this.onload = null;
        this.readAsDataURL = (file: File) => {
            if (this.onload) {
                const mimeType = file.type || 'application/octet-stream';
                this.onload({ target: { result: `data:${mimeType};base64,test` } });
            }
        };
    } as any;
}

function restoreFileReader() {
    if (OriginalFileReader) {
        globalThis.FileReader = OriginalFileReader;
    }
}

vi.mock('../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ state: {}, dispatch: mockQueueDispatch }),
}));

vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({ state: mockAppState, dispatch: mockAppDispatch }),
}));

// RalphLaunchDialog → useRalphExecutionRepoTargets reads the repo list from
// ReposContext. Provide the source workspace so the execution-repo selector
// defaults to it and the launch posts the expected workspace root.
vi.mock('../../../../src/server/spa/client/react/contexts/ReposContext', () => ({
    useRepos: () => ({
        repos: [{ workspace: { id: 'ws-1', name: 'repo', rootPath: '/home/user/repo' } }],
        loading: false,
        fetchRepos: vi.fn(),
        unseenCounts: {},
    }),
}));

vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => '/api',
    getConfig: () => ({ apiBasePath: '/api' }),
    isRalphEnabled: () => mockRalphEnabled.value,
    isRalphMultiAgentGrillEnabled: () => false,
    isForEachEnabled: () => mockForEachEnabled.value,
    isMapReduceEnabled: () => false,
    isLoopsEnabled: () => false,
    getDefaultProvider: () => 'copilot' as const,
    getConfiguredDefaultProvider: () => 'copilot' as const,
    isAutoAgentProviderRoutingEnabled: () => false,
    isEffortLevelsEnabled: () => mockEffortLevelsEnabled.value,
    isSessionContextAttachmentsEnabled: () => mockSessionContextAttachmentsEnabled.value,
}));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        queue: { enqueue: mockEnqueueTask },
        preferences: {
            patchGlobal: vi.fn().mockResolvedValue({}),
            getRepo: vi.fn().mockResolvedValue({}),
            patchRepo: vi.fn().mockResolvedValue({}),
            getLlmToolsConfig: mockGetLlmToolsConfig,
        },
        skills: { listAllWorkspace: vi.fn().mockResolvedValue({ merged: [] }) },
        agentProviders: { list: vi.fn().mockResolvedValue(mockAgentProvidersResponse), getReasoningEfforts: vi.fn().mockResolvedValue({ reasoningEfforts: {} }),
            getEffortTiers: vi.fn().mockImplementation(() => Promise.resolve({ effortTiers: mockEffortTiers.value })) },
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

import { InitialChatComposer, NewChatArea } from '../../../../src/server/spa/client/react/features/chat/NewChatArea';
import {
    GIT_COMMIT_CONTEXT_DRAG_KIND,
    RALPH_SESSION_CONTEXT_DRAG_KIND,
    RALPH_SESSION_CONTEXT_DRAG_MIME,
    SESSION_CONTEXT_DRAG_KIND,
    SESSION_CONTEXT_DRAG_MIME,
    type GitCommitContextDragPayload,
    type RalphSessionContextDragPayload,
    type SessionContextDragPayload,
} from '../../../../src/server/spa/client/react/features/chat/sessionContextDrag';
import {
    pushNewChatSeedContext,
    resetNewChatSeedContext,
} from '../../../../src/server/spa/client/react/features/chat/newChatSeedContext';

function makeCommitPayload(overrides: Partial<GitCommitContextDragPayload> = {}): GitCommitContextDragPayload {
    return {
        kind: GIT_COMMIT_CONTEXT_DRAG_KIND,
        version: 1,
        sourceWorkspaceId: 'ws-1',
        commitHash: 'abcdef1234567890',
        shortHash: 'abcdef1',
        label: 'Commit abcdef1',
        subject: 'Add drop target',
        title: 'Add drop target',
        ...overrides,
    };
}

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

function selectRalphMode() {
    fireEvent.click(screen.getByTestId('workflow-mode-trigger'));
    fireEvent.click(screen.getByTestId('workflow-mode-option-ralph'));
}

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
    mockForEachEnabled.value = false;
    mockSessionContextAttachmentsEnabled.value = false;
    mockEffortLevelsEnabled.value = false;
    mockEffortTiers.value = {};
    mockAgentProvidersResponse.providers = [
        { id: 'copilot', label: 'Copilot', enabled: true, available: true, locked: true },
        { id: 'codex', label: 'Codex', enabled: false, available: false },
        { id: 'claude', label: 'Claude', enabled: false, available: false, reason: 'Claude Code not installed' },
    ];
    mockGetLlmToolsConfig.mockResolvedValue({
        tools: [{ name: 'get_conversation', label: 'Get Conversation', description: '', enabledByDefault: true }],
        disabledLlmTools: [],
        conversationRetrievalAvailable: true,
    });
    // Stub fetch for non-queue uses (e.g. useOnboardingPreferences → patchGlobalPreferences)
    globalThis.fetch = mockFetch;
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    restoreFileReader();
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

    it('keeps the Activity initial composer on the full AI toolbar at desktop width', () => {
        vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(900);

        render(<NewChatArea workspaceId="ws-1" />);

        expect(screen.getByTestId('new-chat-area').getAttribute('data-settings-layout')).toBe('full');
        expect(screen.queryByTestId('compact-ai-settings-chip')).toBeNull();
        expect(screen.getByTestId('agent-selector-chip-btn')).toBeTruthy();
        expect(screen.getByTestId('mode-selector')).toBeTruthy();
        expect(screen.getByTestId('model-picker-chip')).toBeTruthy();
        expect(screen.getByTestId('effort-pill-selector')).toBeTruthy();
        expect(screen.getByTestId('chat-toolbar-mention-btn')).toBeTruthy();
    });

    it('uses the compact AI settings chip when the Activity composer container is narrow', async () => {
        vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(420);

        render(<NewChatArea workspaceId="ws-1" />);

        await waitFor(() => {
            expect(screen.getByTestId('new-chat-area').getAttribute('data-settings-layout')).toBe('compact');
        });
        expect(screen.getByTestId('compact-ai-settings-chip')).toBeTruthy();
        expect(screen.queryByTestId('agent-selector-chip-btn')).toBeNull();
        expect(screen.queryByTestId('mode-selector')).toBeNull();
        expect(screen.queryByTestId('model-picker-chip')).toBeNull();
        expect(screen.queryByTestId('effort-pill-selector')).toBeNull();
        expect(screen.queryByTestId('chat-toolbar-mention-btn')).toBeNull();
        expect(screen.getByTestId('chat-toolbar-slash-btn')).toBeTruthy();
        expect(screen.getByTestId('new-chat-attach-btn')).toBeTruthy();
        expect(screen.getByTestId('new-chat-send-btn')).toBeTruthy();
    });

    it('compacts already at medium container width (regression: 500–700px used to wrap the toolbar)', async () => {
        vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(600);

        render(<NewChatArea workspaceId="ws-1" />);

        await waitFor(() => {
            expect(screen.getByTestId('new-chat-area').getAttribute('data-settings-layout')).toBe('compact');
        });
        expect(screen.getByTestId('compact-ai-settings-chip')).toBeTruthy();
        expect(screen.queryByTestId('mode-selector')).toBeNull();
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
        expect(screen.getByTestId('mode-pill-autopilot')).toBeTruthy();
        expect(screen.queryByTestId('mode-pill-plan')).toBeNull();
        expect(screen.queryByTestId('mode-pill-ralph')).toBeNull();
        expect(screen.queryByTestId('workflow-mode-trigger')).toBeNull();
        expect(screen.queryByTestId('new-chat-ralph-start-from-goal-btn')).toBeNull();
        expect(screen.getByTestId('mode-pill-ask').getAttribute('aria-checked')).toBe('true');
    });

    it('shows workflow modes in a Workflow submenu when enabled', () => {
        mockRalphEnabled.value = true;
        mockForEachEnabled.value = true;

        render(<NewChatArea workspaceId="ws-1" />);

        expect(screen.getByTestId('mode-pill-ask')).toBeTruthy();
        expect(screen.getByTestId('mode-pill-autopilot')).toBeTruthy();
        expect(screen.queryByTestId('mode-pill-ralph')).toBeNull();
        expect(screen.queryByTestId('mode-pill-for-each')).toBeNull();

        expect(screen.getByTestId('mode-selector').contains(screen.getByTestId('workflow-mode-trigger'))).toBe(true);
        fireEvent.click(screen.getByTestId('workflow-mode-trigger'));

        expect(screen.getByTestId('workflow-mode-option-ralph').textContent).toContain('Ralph');
        expect(screen.getByTestId('workflow-mode-option-for-each').textContent).toContain('For Each');
    });

    it('shows only the Ralph workflow option when only Ralph is feature-enabled', () => {
        mockRalphEnabled.value = true;
        mockForEachEnabled.value = false;

        render(<NewChatArea workspaceId="ws-1" />);
        fireEvent.click(screen.getByTestId('workflow-mode-trigger'));

        expect(screen.getByTestId('workflow-mode-option-ralph').textContent).toContain('Ralph');
        expect(screen.queryByTestId('workflow-mode-option-for-each')).toBeNull();
    });

    it('shows only the For Each workflow option when only For Each is feature-enabled', () => {
        mockRalphEnabled.value = false;
        mockForEachEnabled.value = true;

        render(<NewChatArea workspaceId="ws-1" />);
        fireEvent.click(screen.getByTestId('workflow-mode-trigger'));

        expect(screen.queryByTestId('workflow-mode-option-ralph')).toBeNull();
        expect(screen.getByTestId('workflow-mode-option-for-each').textContent).toContain('For Each');
    });

    it('selects Ralph from the Workflow submenu and preserves the Ralph split submit', () => {
        mockRalphEnabled.value = true;

        render(<NewChatArea workspaceId="ws-1" />);
        fireEvent.click(screen.getByTestId('workflow-mode-trigger'));
        fireEvent.click(screen.getByTestId('workflow-mode-option-ralph'));

        expect(screen.getByTestId('new-chat-ralph-submit-split')).toBeTruthy();
        expect(screen.getByTestId('new-chat-send-btn').textContent).toContain('Grill');
        expect(screen.getByTestId('new-chat-ralph-start-from-goal-btn')).toBeTruthy();
    });

    it('marks the Workflow trigger active and keeps the Ralph composer accent when Ralph is selected', () => {
        mockRalphEnabled.value = true;

        render(<NewChatArea workspaceId="ws-1" />);
        selectRalphMode();

        const trigger = screen.getByTestId('workflow-mode-trigger');
        expect(trigger.getAttribute('aria-pressed')).toBe('true');
        expect(trigger.getAttribute('data-active')).toBe('true');
        expect(trigger.getAttribute('data-selected-mode')).toBe('ralph');
        expect(trigger.className).toContain('shadow-[inset_0_0_0_1px_#d0d0d0]');
        expect(screen.getByTestId('mode-pill-ask').getAttribute('aria-checked')).toBe('false');

        const inputBar = screen.getByTestId('chat-input-bar');
        expect(inputBar.className).toContain('border-purple-500');
        expect(inputBar.className).toContain('focus-within:ring-purple-500/30');
    });

    it('updates the Workflow trigger and composer accent for For Each', () => {
        mockForEachEnabled.value = true;

        render(<NewChatArea workspaceId="ws-1" />);
        fireEvent.click(screen.getByTestId('workflow-mode-trigger'));
        fireEvent.click(screen.getByTestId('workflow-mode-option-for-each'));

        const trigger = screen.getByTestId('workflow-mode-trigger');
        expect(trigger.getAttribute('data-selected-mode')).toBe('for-each');
        expect(trigger.className).toContain('shadow-[inset_0_0_0_1px_#d0d0d0]');
        expect(screen.getByTestId('chat-input-bar').className).toContain('border-sky-500');
    });

    it('shows the generic Workflow label on the trigger when no workflow mode is selected', () => {
        mockRalphEnabled.value = true;
        mockForEachEnabled.value = true;

        render(<NewChatArea workspaceId="ws-1" />);

        expect(screen.getByTestId('workflow-mode-trigger').textContent?.trim()).toBe('Workflow');
    });

    it('shows the selected workflow option label on the trigger after selecting Ralph', () => {
        mockRalphEnabled.value = true;
        mockForEachEnabled.value = true;

        render(<NewChatArea workspaceId="ws-1" />);
        fireEvent.click(screen.getByTestId('workflow-mode-trigger'));
        fireEvent.click(screen.getByTestId('workflow-mode-option-ralph'));

        expect(screen.getByTestId('workflow-mode-trigger').textContent?.trim()).toBe('Ralph');
    });

    it('shows the selected workflow option label on the trigger after selecting For Each', () => {
        mockRalphEnabled.value = true;
        mockForEachEnabled.value = true;

        render(<NewChatArea workspaceId="ws-1" />);
        fireEvent.click(screen.getByTestId('workflow-mode-trigger'));
        fireEvent.click(screen.getByTestId('workflow-mode-option-for-each'));

        expect(screen.getByTestId('workflow-mode-trigger').textContent?.trim()).toBe('For Each');
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

    describe('session context drops', () => {
        it('creates a removable session chip when the feature and retrieval tool are enabled', async () => {
            mockSessionContextAttachmentsEnabled.value = true;
            render(<NewChatArea workspaceId="ws-1" />);
            await waitFor(() => expect(mockGetLlmToolsConfig).toHaveBeenCalledWith('ws-1'));
            await act(async () => {});

            fireEvent.drop(screen.getByTestId('chat-input-stack'), {
                dataTransfer: makeSessionDataTransfer(makeSessionPayload()),
            });

            const chip = screen.getByTestId('attached-session-context-chip');
            expect(chip.textContent).toContain('Source chat');
            expect(chip.textContent).toContain('completed');
            expect(chip.textContent).toContain('source-p…3456');

            fireEvent.click(screen.getByTestId('attached-context-remove'));
            expect(screen.queryByTestId('attached-session-context-chip')).toBeNull();
        });

        it('highlights the composer with copy semantics while dragging supported context', async () => {
            mockSessionContextAttachmentsEnabled.value = true;
            render(<NewChatArea workspaceId="ws-1" />);
            await waitFor(() => expect(mockGetLlmToolsConfig).toHaveBeenCalledWith('ws-1'));

            const dataTransfer = makeSessionDataTransfer(makeSessionPayload());
            fireEvent.dragEnter(screen.getByTestId('chat-input-stack'), { dataTransfer });

            expect(dataTransfer.dropEffect).toBe('copy');
            expect(screen.getByTestId('session-context-drop-hint').textContent).toBe('Drop to copy context');
            expect(screen.getByTestId('chat-input-bar').className).toContain('ring-[#0078d4]/60');

            fireEvent.drop(screen.getByTestId('chat-input-stack'), { dataTransfer });
            expect(screen.queryByTestId('session-context-drop-hint')).toBeNull();
        });

        it('shows inline feedback for unsupported composer drops', () => {
            mockSessionContextAttachmentsEnabled.value = true;
            render(<NewChatArea workspaceId="ws-1" />);

            fireEvent.drop(screen.getByTestId('chat-input-stack'), {
                dataTransfer: makeUnsupportedDataTransfer(),
            });

            expect(screen.getByTestId('new-chat-session-context-error').textContent).toBe(
                'Drop a supported CoC context item from this workspace to attach it as context.',
            );
            expect(screen.queryByTestId('attached-session-context-chip')).toBeNull();
        });

        it('creates a removable Ralph group chip when the feature and retrieval tool are enabled', async () => {
            mockSessionContextAttachmentsEnabled.value = true;
            render(<NewChatArea workspaceId="ws-1" />);
            await waitFor(() => expect(mockGetLlmToolsConfig).toHaveBeenCalledWith('ws-1'));
            await act(async () => {});

            fireEvent.drop(screen.getByTestId('chat-input-stack'), {
                dataTransfer: makeSessionDataTransfer(makeRalphPayload(), RALPH_SESSION_CONTEXT_DRAG_MIME),
            });

            const chip = screen.getByTestId('attached-ralph-context-chip');
            expect(chip.textContent).toContain('RALPH');
            expect(chip.textContent).toContain('Ralph source - 2 iter');
            expect(chip.textContent).toContain('executing/running');
            expect(chip.textContent).toContain('3 processes');
            expect(chip.textContent).toContain('2 iterations');
            expect(chip.textContent).toContain('ralph-se…0001');

            fireEvent.click(screen.getByTestId('attached-context-remove'));
            expect(screen.queryByTestId('attached-ralph-context-chip')).toBeNull();
        });

        it('shows a clear error for duplicate Ralph group drops', async () => {
            mockSessionContextAttachmentsEnabled.value = true;
            render(<NewChatArea workspaceId="ws-1" />);
            await waitFor(() => expect(mockGetLlmToolsConfig).toHaveBeenCalledWith('ws-1'));
            await act(async () => {});

            const dataTransfer = makeSessionDataTransfer(makeRalphPayload(), RALPH_SESSION_CONTEXT_DRAG_MIME);
            fireEvent.drop(screen.getByTestId('chat-input-stack'), { dataTransfer });
            fireEvent.drop(screen.getByTestId('chat-input-stack'), { dataTransfer });

            expect(screen.getByTestId('new-chat-session-context-error').textContent).toBe(
                'This Ralph session is already attached to the message.',
            );
            expect(screen.getAllByTestId('attached-ralph-context-chip')).toHaveLength(1);
        });

        it('shows a clear error for cross-workspace session drops', () => {
            mockSessionContextAttachmentsEnabled.value = true;
            render(<NewChatArea workspaceId="ws-1" />);

            fireEvent.drop(screen.getByTestId('chat-input-stack'), {
                dataTransfer: makeSessionDataTransfer(makeSessionPayload({ sourceWorkspaceId: 'ws-other' })),
            });

            expect(screen.getByTestId('new-chat-session-context-error').textContent).toBe(
                'Only context from the active workspace can be attached.',
            );
            expect(screen.queryByTestId('attached-session-context-chip')).toBeNull();
        });

        it('shows a clear error when conversation retrieval is disabled', async () => {
            mockSessionContextAttachmentsEnabled.value = true;
            mockGetLlmToolsConfig.mockResolvedValueOnce({
                tools: [{ name: 'get_conversation', label: 'Get Conversation', description: '', enabledByDefault: true }],
                disabledLlmTools: ['get_conversation'],
                conversationRetrievalAvailable: true,
            });
            render(<NewChatArea workspaceId="ws-1" />);
            await waitFor(() => expect(mockGetLlmToolsConfig).toHaveBeenCalledWith('ws-1'));
            await act(async () => {});

            fireEvent.drop(screen.getByTestId('chat-input-stack'), {
                dataTransfer: makeSessionDataTransfer(makeSessionPayload()),
            });

            expect(screen.getByTestId('new-chat-session-context-error').textContent).toBe(
                'Conversation retrieval is not available for this chat.',
            );
        });

        it('blocks sending a previously attached session when the feature is disabled before submit', async () => {
            mockSessionContextAttachmentsEnabled.value = true;
            const { rerender } = render(<NewChatArea workspaceId="ws-1" />);
            await waitFor(() => expect(mockGetLlmToolsConfig).toHaveBeenCalledWith('ws-1'));
            await act(async () => {});

            fireEvent.drop(screen.getByTestId('chat-input-stack'), {
                dataTransfer: makeSessionDataTransfer(makeSessionPayload()),
            });
            expect(screen.getByTestId('attached-session-context-chip')).toBeTruthy();

            mockSessionContextAttachmentsEnabled.value = false;
            rerender(<NewChatArea workspaceId="ws-1" />);
            fireEvent.change(screen.getByTestId('new-chat-input'), { target: { value: 'Use this context' } });

            await act(async () => {
                fireEvent.click(screen.getByTestId('new-chat-send-btn'));
            });

            expect(mockEnqueueTask).not.toHaveBeenCalled();
            expect(screen.getByTestId('new-chat-session-context-error').textContent).toBe(
                'Session context attachments are disabled.',
            );
        });
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
            fireEvent.click(screen.getByTestId('mode-pill-autopilot'));
            expect(screen.getByTestId('mode-pill-autopilot').getAttribute('aria-checked')).toBe('true');
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
            expect(screen.getByTestId('mode-pill-autopilot').getAttribute('aria-checked')).toBe('true');
        });

        it('Shift+Tab cycles into enabled workflow modes using the visible mode list', () => {
            mockRalphEnabled.value = true;

            render(<NewChatArea workspaceId="ws-1" />);
            const input = screen.getByTestId('new-chat-input') as HTMLInputElement;

            fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
            expect(screen.getByTestId('mode-pill-autopilot').getAttribute('aria-checked')).toBe('true');

            fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
            expect(screen.getByTestId('workflow-mode-trigger').getAttribute('data-selected-mode')).toBe('ralph');
            expect(screen.getByTestId('chat-input-bar').className).toContain('border-purple-500');
        });
    });

    describe('compact AI settings layout', () => {
        function renderCompactComposer(onSubmit = vi.fn().mockResolvedValue(null)) {
            return render(
                <InitialChatComposer
                    workspaceId="ws-1"
                    onSubmit={onSubmit}
                    testIdPrefix="lens-chat"
                    enableRalphDirectGoal={false}
                    settingsLayout="compact"
                />,
            );
        }

        it('renders one settings chip and only slash, attach, and send as compact toolbar actions', () => {
            mockDefaultModelResult.effectiveModel = 'gpt-5.4';
            mockDefaultModelResult.effectiveModelName = 'GPT-5.4';

            renderCompactComposer();

            expect(screen.getByTestId('compact-ai-settings-chip')).toBeTruthy();
            expect(screen.getByTestId('compact-ai-settings-label').textContent).toBe('Copilot · Ask · Auto');
            expect(screen.getByTestId('compact-ai-settings-label').textContent).not.toContain('GPT-5.4');
            expect(screen.queryByTestId('agent-selector-chip-btn')).toBeNull();
            expect(screen.queryByTestId('mode-selector')).toBeNull();
            expect(screen.queryByTestId('model-picker-chip')).toBeNull();
            expect(screen.queryByTestId('effort-pill-selector')).toBeNull();
            expect(screen.queryByTestId('chat-toolbar-mention-btn')).toBeNull();
            expect(screen.getByTestId('chat-toolbar-slash-btn')).toBeTruthy();
            expect(screen.getByTestId('lens-chat-attach-btn')).toBeTruthy();
            expect(screen.getByTestId('lens-chat-send-btn')).toBeTruthy();

            const toolbar = screen.getByTestId('chat-input-toolbar');
            const chip = within(toolbar).getByTestId('compact-ai-settings-chip');
            const attach = within(toolbar).getByTestId('lens-chat-attach-btn');
            const slash = within(toolbar).getByTestId('chat-toolbar-slash-btn');
            const send = within(toolbar).getByTestId('lens-chat-send-btn');
            expect(chip.compareDocumentPosition(attach) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
            expect(attach.compareDocumentPosition(slash) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
            expect(slash.compareDocumentPosition(send) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        });

        it('opens an editor with provider, mode/workflow, model, and effort controls', () => {
            mockRalphEnabled.value = true;
            mockDefaultModelResult.effectiveModel = 'gpt-5.4';
            mockDefaultModelResult.effectiveModelName = 'GPT-5.4';

            renderCompactComposer();

            fireEvent.click(screen.getByTestId('compact-ai-settings-chip'));

            expect(screen.getByTestId('compact-ai-settings-editor')).toBeTruthy();
            expect(screen.getByTestId('compact-ai-settings-provider-control')).toBeTruthy();
            expect(screen.getByTestId('compact-ai-settings-mode-control')).toBeTruthy();
            expect(screen.getByTestId('compact-ai-settings-model-control')).toBeTruthy();
            expect(screen.getByTestId('compact-ai-settings-effort-control')).toBeTruthy();
            expect(screen.getByTestId('agent-selector-chip-btn')).toBeTruthy();
            expect(screen.getByTestId('mode-pill-ask')).toBeTruthy();
            expect(screen.getByTestId('workflow-mode-trigger')).toBeTruthy();
            expect(screen.getByTestId('model-picker-chip').textContent).toContain('GPT-5.4');
            expect(screen.getByTestId('effort-pill-selector')).toBeTruthy();
        });

        it('hides the model control in the editor when effort-tier mode is active (tier supplies the model)', async () => {
            // Concrete provider + effortLevels flag on + provider has tiers → effort-tier mode.
            mockEffortLevelsEnabled.value = true;
            mockEffortTiers.value = {
                low: { model: 'gpt-5-mini', reasoningEffort: 'low' },
                medium: { model: 'gpt-5.4', reasoningEffort: 'medium' },
                high: { model: 'gpt-5.4', reasoningEffort: 'high' },
            };
            mockDefaultModelResult.effectiveModel = 'gpt-5.4';
            mockDefaultModelResult.effectiveModelName = 'GPT-5.4';

            renderCompactComposer();
            fireEvent.click(screen.getByTestId('compact-ai-settings-chip'));

            // Tier selector replaces the legacy model picker once tiers load.
            await waitFor(() => {
                expect(screen.getByTestId('effort-tier-selector')).toBeTruthy();
            });
            expect(screen.queryByTestId('compact-ai-settings-model-control')).toBeNull();
            expect(screen.queryByTestId('model-picker-chip')).toBeNull();
            // Effort control stays — it now hosts the tier selector.
            expect(screen.getByTestId('compact-ai-settings-effort-control')).toBeTruthy();
        });

        it('lays out the provider and effort controls in a shared flex row', () => {
            renderCompactComposer();
            fireEvent.click(screen.getByTestId('compact-ai-settings-chip'));

            const provider = screen.getByTestId('compact-ai-settings-provider-control');
            const effort = screen.getByTestId('compact-ai-settings-effort-control');
            const mode = screen.getByTestId('compact-ai-settings-mode-control');

            // Provider and effort share a parent row; mode sits on its own row.
            expect(provider.parentElement).toBe(effort.parentElement);
            expect(provider.parentElement).not.toBe(mode.parentElement);
            expect(provider.parentElement?.className).toContain('flex');
        });

        it('anchors the compact settings editor as a popover when the composer can fit it', () => {
            vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(420);

            renderCompactComposer();
            fireEvent.click(screen.getByTestId('compact-ai-settings-chip'));

            const editor = screen.getByTestId('compact-ai-settings-editor');
            expect(editor.getAttribute('data-placement')).toBe('popover');
            expect(editor.className).toContain('absolute');
            expect(editor.className).not.toContain('fixed');
        });

        it('uses a bottom-sheet compact settings editor when the composer is too narrow for the popover', async () => {
            vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(340);

            renderCompactComposer();
            fireEvent.click(screen.getByTestId('compact-ai-settings-chip'));

            await waitFor(() => {
                const editor = screen.getByTestId('compact-ai-settings-editor');
                expect(editor.getAttribute('data-placement')).toBe('sheet');
                expect(editor.className).toContain('fixed');
                expect(editor.className).not.toContain('absolute');
            });
        });

        it('updates the chip label when provider, workflow mode, or effort changes', async () => {
            mockRalphEnabled.value = true;
            mockAgentProvidersResponse.providers = [
                { id: 'copilot', label: 'Copilot', enabled: true, available: true, locked: true },
                { id: 'codex', label: 'Codex', enabled: true, available: true },
                { id: 'claude', label: 'Claude', enabled: false, available: false, reason: 'Claude Code not installed' },
            ];

            renderCompactComposer();
            fireEvent.click(screen.getByTestId('compact-ai-settings-chip'));

            await waitFor(() => {
                expect((screen.getByTestId('agent-selector-chip-btn') as HTMLButtonElement).disabled).toBe(false);
            });

            fireEvent.click(screen.getByTestId('agent-selector-chip-btn'));
            fireEvent.click(screen.getByTestId('agent-option-codex'));
            fireEvent.click(screen.getByTestId('workflow-mode-trigger'));
            fireEvent.click(screen.getByTestId('workflow-mode-option-ralph'));
            fireEvent.click(screen.getByTestId('effort-pill-trigger-btn'));
            fireEvent.click(screen.getByTestId('effort-pill-option-high'));

            expect(screen.getByTestId('compact-ai-settings-label').textContent).toBe('Codex · Ralph · High');
        });

        it('submits AI settings selected from the compact editor', async () => {
            mockRalphEnabled.value = true;
            mockModelCommand.modelOverride = 'claude-sonnet-4.6';
            mockAgentProvidersResponse.providers = [
                { id: 'copilot', label: 'Copilot', enabled: true, available: true, locked: true },
                { id: 'codex', label: 'Codex', enabled: true, available: true },
                { id: 'claude', label: 'Claude', enabled: false, available: false, reason: 'Claude Code not installed' },
            ];
            const onSubmit = vi.fn().mockResolvedValue(null);

            renderCompactComposer(onSubmit);
            fireEvent.click(screen.getByTestId('compact-ai-settings-chip'));

            await waitFor(() => {
                expect((screen.getByTestId('agent-selector-chip-btn') as HTMLButtonElement).disabled).toBe(false);
            });

            fireEvent.click(screen.getByTestId('agent-selector-chip-btn'));
            fireEvent.click(screen.getByTestId('agent-option-codex'));
            fireEvent.click(screen.getByTestId('workflow-mode-trigger'));
            fireEvent.click(screen.getByTestId('workflow-mode-option-ralph'));
            fireEvent.click(screen.getByTestId('effort-pill-trigger-btn'));
            fireEvent.click(screen.getByTestId('effort-pill-option-high'));

            fireEvent.change(screen.getByTestId('lens-chat-input'), { target: { value: 'Review this compact lens' } });
            await act(async () => {
                fireEvent.click(screen.getByTestId('lens-chat-send-btn'));
            });

            expect(onSubmit).toHaveBeenCalledTimes(1);
            const submission = onSubmit.mock.calls[0][0];
            expect(submission).toEqual(expect.objectContaining({
                mode: 'ask',
                workspaceId: 'ws-1',
                provider: 'codex',
                model: 'claude-sonnet-4.6',
                reasoningEffort: 'high',
            }));
            expect(submission.prompt).toContain('Review this compact lens');
            expect(submission.context).toEqual(expect.objectContaining({
                skills: ['grill-me'],
                ralph: expect.objectContaining({ phase: 'grilling' }),
            }));
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
        it('restores legacy plan draft mode as Ask on mount', () => {
            mockDraftStore.getDraft.mockReturnValue({
                text: 'saved message',
                mode: 'plan',
                updatedAt: Date.now(),
            });

            render(<NewChatArea workspaceId="ws-1" />);

            expect(mockDraftStore.getDraft).toHaveBeenCalledWith('new-chat:ws-1');
            expect(screen.getByTestId('mode-pill-ask').getAttribute('aria-checked')).toBe('true');
            expect(screen.queryByTestId('mode-pill-plan')).toBeNull();
            // The RichTextInput mock sets internal value via setValue — the
            // component called setInput('saved message') so later interactions
            // will see it. We can verify the draft was read.
            expect(mockDraftStore.getDraft).toHaveBeenCalled();
        });

        it('falls back to Ask when a saved workflow draft is no longer feature-enabled', () => {
            mockDraftStore.getDraft.mockReturnValue({
                text: 'saved workflow message',
                mode: 'ralph',
                updatedAt: Date.now(),
            });
            mockRalphEnabled.value = false;

            render(<NewChatArea workspaceId="ws-1" />);

            expect(screen.getByTestId('mode-pill-ask').getAttribute('aria-checked')).toBe('true');
            expect(screen.queryByTestId('workflow-mode-trigger')).toBeNull();
            expect(screen.getByTestId('chat-input-bar').className).toContain('border-yellow-500');
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

        it('shows a Ralph split submit control only when Ralph mode is selected', () => {
            render(<NewChatArea workspaceId="ws-1" />);

            expect(screen.queryByTestId('new-chat-ralph-submit-split')).toBeNull();
            expect(screen.queryByTestId('new-chat-ralph-start-from-goal-btn')).toBeNull();

            selectRalphMode();

            expect(screen.getByTestId('new-chat-ralph-submit-split')).toBeTruthy();
            expect(screen.getByTestId('new-chat-send-btn').textContent).toContain('Grill');
            expect(screen.getByTestId('new-chat-ralph-start-from-goal-btn').textContent).toContain('Start from goal...');

            fireEvent.click(screen.getByTestId('mode-pill-ask'));
            expect(screen.queryByTestId('new-chat-ralph-start-from-goal-btn')).toBeNull();
            expect(screen.getByTestId('new-chat-send-btn').textContent).toContain('Send');
        });

        it('appends goal.md instruction when ralph mode is selected', async () => {
            mockEnqueueTask.mockResolvedValueOnce({ task: { id: 'ralph-task-1' } });
            mockSlashCommands.parseAndExtract.mockReturnValue({ skills: [], prompt: '' });

            render(<NewChatArea workspaceId="ws-1" />);

            selectRalphMode();

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

        it('opens an editable direct-goal review dialog prefilled from the composer without mutating the draft on cancel', async () => {
            render(<NewChatArea workspaceId="ws-1" />);
            selectRalphMode();

            const input = screen.getByTestId('new-chat-input') as HTMLInputElement;
            fireEvent.change(input, { target: { value: '## Goal Build a thing' } });

            fireEvent.click(screen.getByTestId('new-chat-ralph-start-from-goal-btn'));

            const dialog = screen.getByTestId('ralph-launch-dialog');
            const editor = within(dialog).getByTestId('ralph-goal-preview') as HTMLTextAreaElement;
            expect(editor.value).toBe('## Goal Build a thing');

            fireEvent.change(editor, { target: { value: '## Goal\nEdited in review only' } });
            fireEvent.click(within(dialog).getByText('Cancel'));

            expect(screen.queryByTestId('ralph-launch-dialog')).toBeNull();
            expect(input.value).toBe('## Goal Build a thing');
        });

        it('posts edited direct-goal text to ralph-launch with workspace root and selected AI settings', async () => {
            mockModelCommand.modelOverride = 'gpt-5.4';
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ processId: 'queue_direct-goal-1' }),
            });

            render(<NewChatArea workspaceId="ws-1" />);
            selectRalphMode();

            fireEvent.click(screen.getByTestId('effort-pill-trigger-btn'));
            fireEvent.click(screen.getByTestId('effort-pill-option-high'));

            const input = screen.getByTestId('new-chat-input') as HTMLInputElement;
            fireEvent.change(input, { target: { value: '## Goal\nOriginal goal' } });
            fireEvent.click(screen.getByTestId('new-chat-ralph-start-from-goal-btn'));

            const dialog = screen.getByTestId('ralph-launch-dialog');
            const editor = within(dialog).getByTestId('ralph-goal-preview') as HTMLTextAreaElement;
            fireEvent.change(editor, { target: { value: '## Goal\nEdited goal' } });

            await act(async () => {
                fireEvent.click(within(dialog).getByTestId('ralph-launch-confirm-btn'));
            });

            const launchCall = mockFetch.mock.calls.find((call: any[]) => String(call[0]).endsWith('/ralph-launch'));
            expect(launchCall).toBeTruthy();
            const launchBody = JSON.parse(launchCall![1].body);
            expect(launchBody).toEqual({
                goalSpec: '## Goal\nEdited goal',
                workspaceId: 'ws-1',
                provider: 'copilot',
                folderPath: '/home/user/repo',
                workingDirectory: '/home/user/repo',
                config: {
                    model: 'gpt-5.4',
                    reasoningEffort: 'high',
                },
            });

            expect(mockEnqueueTask).not.toHaveBeenCalled();
            expect(mockQueueDispatch).toHaveBeenCalledWith({
                type: 'SELECT_QUEUE_TASK',
                id: 'queue_direct-goal-1',
                repoId: 'ws-1',
            });
            expect(mockAppDispatch).toHaveBeenCalledWith({
                type: 'UPDATE_ONBOARDING',
                payload: { hasUsedChat: true },
            });
            expect(mockDraftStore.clearDraft).toHaveBeenCalledWith('new-chat:ws-1');
            expect(input.value).toBe('');
        });

        it('shows a non-blocking warning for direct-goal text without a Goal heading', () => {
            render(<NewChatArea workspaceId="ws-1" />);
            selectRalphMode();

            const input = screen.getByTestId('new-chat-input') as HTMLInputElement;
            fireEvent.change(input, { target: { value: 'Build a thing without markdown heading' } });
            fireEvent.click(screen.getByTestId('new-chat-ralph-start-from-goal-btn'));

            expect(screen.getByTestId('ralph-goal-heading-warning').textContent).toContain('does not contain a ## Goal heading');
            expect((screen.getByTestId('ralph-launch-confirm-btn') as HTMLButtonElement).disabled).toBe(false);
        });

        it('keeps the direct-goal dialog open with edited text when ralph-launch fails', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 500,
                text: async () => JSON.stringify({ error: 'launch failed' }),
            });

            render(<NewChatArea workspaceId="ws-1" />);
            selectRalphMode();

            const input = screen.getByTestId('new-chat-input') as HTMLInputElement;
            fireEvent.change(input, { target: { value: '## Goal Original' } });
            fireEvent.click(screen.getByTestId('new-chat-ralph-start-from-goal-btn'));

            const editor = screen.getByTestId('ralph-goal-preview') as HTMLTextAreaElement;
            fireEvent.change(editor, { target: { value: '## Goal\nEdited after review' } });

            await act(async () => {
                fireEvent.click(screen.getByTestId('ralph-launch-confirm-btn'));
            });

            expect(screen.getByTestId('ralph-launch-dialog')).toBeTruthy();
            expect(screen.getByTestId('ralph-launch-error').textContent).toBe('launch failed');
            expect((screen.getByTestId('ralph-goal-preview') as HTMLTextAreaElement).value).toBe('## Goal\nEdited after review');
            expect(input.value).toBe('## Goal Original');
            expect(mockQueueDispatch).not.toHaveBeenCalledWith(expect.objectContaining({ id: expect.stringContaining('direct') }));
        });

        it('blocks direct-goal confirmation while composer attachments are present', async () => {
            mockFileReader();

            render(<NewChatArea workspaceId="ws-1" />);
            selectRalphMode();

            const input = screen.getByTestId('new-chat-input') as HTMLInputElement;
            fireEvent.change(input, { target: { value: '## Goal\nBuild with attached context' } });

            const fileInput = screen.getByTestId('new-chat-file-input-hidden') as HTMLInputElement;
            await act(async () => {
                fireEvent.change(fileInput, {
                    target: {
                        files: [new File(['details'], 'details.md', { type: 'text/markdown' })],
                    },
                });
            });

            expect(screen.getByTestId('attachment-preview-file')).toBeTruthy();

            fireEvent.click(screen.getByTestId('new-chat-ralph-start-from-goal-btn'));

            expect(screen.getByTestId('ralph-launch-attachment-warning').textContent).toContain('Direct-goal launch sends goal text only');
            expect((screen.getByTestId('ralph-launch-confirm-btn') as HTMLButtonElement).disabled).toBe(true);
            expect(mockFetch).not.toHaveBeenCalledWith('/api/ralph-launch', expect.anything());
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

    // ── AC-01/AC-03: items dropped onto the "+ New chat" button seed the composer ──
    describe('new-chat seed context', () => {
        beforeEach(() => {
            resetNewChatSeedContext();
            mockSessionContextAttachmentsEnabled.value = true;
        });
        afterEach(() => {
            resetNewChatSeedContext();
        });

        it('attaches a pointer item buffered before the composer mounted', async () => {
            // Simulate the button drop happening before the composer exists.
            pushNewChatSeedContext([makeCommitPayload()]);

            render(<NewChatArea workspaceId="ws-1" />);
            await act(async () => {});

            const chip = await screen.findByTestId('attached-commit-context-chip');
            expect(chip.textContent).toContain('Commit abcdef1');
            // No auto-send.
            expect(mockEnqueueTask).not.toHaveBeenCalled();
        });

        it('attaches a session item pushed while the composer is already open', async () => {
            render(<NewChatArea workspaceId="ws-1" />);
            await waitFor(() => expect(mockGetLlmToolsConfig).toHaveBeenCalledWith('ws-1'));
            await act(async () => {});

            await act(async () => {
                pushNewChatSeedContext([makeSessionPayload()]);
            });

            const chip = await screen.findByTestId('attached-session-context-chip');
            expect(chip.textContent).toContain('Source chat');
            expect(mockEnqueueTask).not.toHaveBeenCalled();
        });

        it('appends to an open composer without discarding typed text (append-keep)', async () => {
            render(<NewChatArea workspaceId="ws-1" />);
            await waitFor(() => expect(mockGetLlmToolsConfig).toHaveBeenCalledWith('ws-1'));
            await act(async () => {});

            const input = screen.getByTestId('new-chat-input') as HTMLInputElement;
            fireEvent.change(input, { target: { value: 'review these' } });

            await act(async () => {
                pushNewChatSeedContext([makeCommitPayload()]);
            });
            await screen.findByTestId('attached-commit-context-chip');

            // Second drop appends a chat while keeping the commit and typed text.
            await act(async () => {
                pushNewChatSeedContext([makeSessionPayload()]);
            });
            await screen.findByTestId('attached-session-context-chip');

            expect(screen.getByTestId('attached-commit-context-chip')).toBeTruthy();
            expect((screen.getByTestId('new-chat-input') as HTMLInputElement).value).toBe('review these');
        });

        it('dedupes a repeated item to a single chip', async () => {
            render(<NewChatArea workspaceId="ws-1" />);
            await act(async () => {});

            await act(async () => {
                pushNewChatSeedContext([makeCommitPayload()]);
            });
            await screen.findByTestId('attached-commit-context-chip');

            await act(async () => {
                pushNewChatSeedContext([makeCommitPayload()]);
            });
            await act(async () => {});

            expect(screen.getAllByTestId('attached-commit-context-chip')).toHaveLength(1);
        });

        it('attaches every item carried in a single multi-select bundle push (AC-02)', async () => {
            render(<NewChatArea workspaceId="ws-1" />);
            await act(async () => {});

            await act(async () => {
                pushNewChatSeedContext([
                    makeCommitPayload({ commitHash: '1'.repeat(16), shortHash: '1111111', label: 'Commit 1111111', subject: 'One', title: 'One' }),
                    makeCommitPayload({ commitHash: '2'.repeat(16), shortHash: '2222222', label: 'Commit 2222222', subject: 'Two', title: 'Two' }),
                ]);
            });
            await waitFor(() => expect(screen.getAllByTestId('attached-commit-context-chip')).toHaveLength(2));
            expect(mockEnqueueTask).not.toHaveBeenCalled();
        });

        it('dedupes duplicate items carried within a single bundle push (AC-03)', async () => {
            // The bundle reader dedupes, but a batch can still reach the composer
            // with repeats; getItems() is stale mid-loop, so the merge must guard
            // against adding the same logical item twice in one pass.
            render(<NewChatArea workspaceId="ws-1" />);
            await act(async () => {});

            await act(async () => {
                pushNewChatSeedContext([makeCommitPayload(), makeCommitPayload()]);
            });
            await screen.findByTestId('attached-commit-context-chip');
            await act(async () => {});

            expect(screen.getAllByTestId('attached-commit-context-chip')).toHaveLength(1);
        });

        it('keeps the default mode when an item is seeded (no auto-switch, AC-03)', async () => {
            render(<NewChatArea workspaceId="ws-1" />);
            await act(async () => {});
            // Default new-chat mode is "ask".
            expect(screen.getByTestId('mode-pill-ask').getAttribute('aria-checked')).toBe('true');

            await act(async () => {
                pushNewChatSeedContext([makeCommitPayload()]);
            });
            await screen.findByTestId('attached-commit-context-chip');

            // Dropping a commit must not switch the mode based on the item kind.
            expect(screen.getByTestId('mode-pill-ask').getAttribute('aria-checked')).toBe('true');
        });
    });
});
