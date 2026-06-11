/**
 * @vitest-environment jsdom
 *
 * Tests for NewChatArea — focused on queue task selection and launch payloads.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks – declared before importing component under test
// ---------------------------------------------------------------------------

const mockQueueDispatch = vi.fn();
const mockAppDispatch = vi.fn();
const mockEnqueueTask = vi.fn();
const mockPatchRepo = vi.fn();
const mockHandleModelSelect = vi.fn();
const mockSetModelOverride = vi.fn((model: string | null) => { mockModelOverride = model; });
const mockParseAndExtract = vi.fn();
const mockClearAttachments = vi.fn();
let mockDefaultProvider: 'copilot' | 'codex' | 'claude' = 'copilot';
let mockConfiguredDefaultProvider: 'copilot' | 'codex' | 'claude' | 'auto' = 'copilot';
let mockAutoProviderRoutingEnabled = false;
let mockRepoPreferences: Record<string, unknown> = {};
let mockModelOverride: string | null = null;
let mockUseModelsProviders: Array<string | undefined> = [];
let mockUseDefaultModelArgs: Array<[string | undefined, string, string | undefined]> = [];
let mockForEachEnabled = false;
let mockMapReduceEnabled = false;
let mockRalphEnabled = false;
let mockRalphMultiAgentGrillEnabled = false;
let mockSessionContextAttachmentsEnabled = false;
let mockAttachments: any[] = [];
let mockAttachmentPayload: any[] = [];
let mockAgentProviders: any[] = [
    { id: 'copilot', label: 'Copilot', enabled: true, available: true, locked: true },
    { id: 'codex', label: 'Codex', enabled: false, available: false },
    { id: 'claude', label: 'Claude', enabled: false, available: false },
];

vi.mock('../../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({
        state: { selectedTaskIdByRepo: {} },
        dispatch: mockQueueDispatch,
    }),
}));

vi.mock('../../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({
        state: {
            workspaces: [{ id: 'ws-1', rootPath: '/repos/myrepo' }],
            onboardingProgress: { hasUsedChat: false },
        },
        dispatch: mockAppDispatch,
    }),
}));

let mockEffortLevelsEnabled = false;
let mockEffortTiers: Record<string, { model: string; reasoningEffort?: string | null }> = {};

vi.mock('../../../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => 'http://localhost:4000/api',
    isRalphEnabled: () => mockRalphEnabled,
    isRalphMultiAgentGrillEnabled: () => mockRalphMultiAgentGrillEnabled,
    isForEachEnabled: () => mockForEachEnabled,
    isMapReduceEnabled: () => mockMapReduceEnabled,
    isLoopsEnabled: () => false,
    isAutoAgentProviderRoutingEnabled: () => mockAutoProviderRoutingEnabled,
    getConfiguredDefaultProvider: () => mockConfiguredDefaultProvider,
    getDefaultProvider: () => mockDefaultProvider,
    isEffortLevelsEnabled: () => mockEffortLevelsEnabled,
    isSessionContextAttachmentsEnabled: () => mockSessionContextAttachmentsEnabled,
}));

vi.mock('../../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        queue: { enqueue: mockEnqueueTask },
        preferences: {
            patchGlobal: vi.fn().mockResolvedValue({}),
            getRepo: vi.fn().mockResolvedValue(mockRepoPreferences),
            patchRepo: mockPatchRepo,
            getLlmToolsConfig: vi.fn().mockResolvedValue({
                conversationRetrievalAvailable: true,
                tools: [{ name: 'get_conversation' }],
                disabledLlmTools: [],
            }),
        },
        skills: { listAllWorkspace: vi.fn().mockResolvedValue({ merged: [] }) },
        agentProviders: {
            list: vi.fn().mockResolvedValue({ providers: mockAgentProviders }),
            getReasoningEfforts: vi.fn().mockResolvedValue({ reasoningEfforts: {} }),
            getEffortTiers: vi.fn().mockImplementation(() =>
                Promise.resolve({ provider: 'copilot', effortTiers: mockEffortTiers }),
            ),
        },
    }),
    getSpaCocClientErrorMessage: (err: any, fallback: string) =>
        (err instanceof Error ? err.message : undefined) || fallback,
}));

vi.mock('../../../../../src/server/spa/client/react/features/chat/hooks/useFileAttachments', () => ({
    useFileAttachments: () => ({
        attachments: mockAttachments,
        addFromPaste: vi.fn(),
        addFromFileInput: vi.fn(),
        removeAttachment: vi.fn(),
        clearAttachments: mockClearAttachments,
        error: null,
        toPayload: () => mockAttachmentPayload,
    }),
}));

vi.mock('../../../../../src/server/spa/client/react/shared/RichTextInput', () => ({
    RichTextInput: vi.fn().mockImplementation(({ onChange, onKeyDown, placeholder, disabled, value, ...rest }: any) => (
        <input
            data-testid={rest['data-testid'] ?? 'rich-text-input'}
            placeholder={placeholder}
            disabled={disabled}
            value={value ?? ''}
            onChange={(e) => onChange?.(e.target.value)}
            onKeyDown={onKeyDown}
        />
    )),
}));

vi.mock('../../../../../src/server/spa/client/react/ui/AttachmentPreviews', () => ({
    AttachmentPreviews: () => null,
}));

vi.mock('../../../../../src/server/spa/client/react/repos/modeConfig', () => ({
    WORKFLOW_REGISTRY: [
        {
            mode: 'ask',
            icon: '💡',
            label: 'Ask',
            tooltip: 'Ask — get answers without making changes',
            dotClass: 'bg-yellow-500',
            border: 'border-yellow-500',
            ring: 'ring-yellow-500',
            text: 'text-yellow-600',
            defaultVisible: true,
        },
        {
            mode: 'autopilot',
            icon: '🤖',
            label: 'Autopilot',
            tooltip: 'Autopilot — execute changes automatically',
            dotClass: 'bg-green-500',
            border: 'border-green-500',
            ring: 'ring-green-500',
            text: 'text-green-600',
            defaultVisible: true,
        },
        {
            mode: 'ralph',
            icon: '🔄',
            label: 'Ralph',
            tooltip: 'Ralph — iterative AI coding loop with guided goal setting',
            dotClass: 'bg-purple-500',
            border: 'border-purple-500',
            ring: 'ring-purple-500',
            text: 'text-purple-600',
            category: 'workflow',
            featureFlag: 'ralph',
        },
        {
            mode: 'for-each',
            icon: '🔁',
            label: 'For Each',
            tooltip: 'For Each — generate a reviewed item plan, then run each item separately',
            dotClass: 'bg-sky-500',
            border: 'border-sky-500',
            ring: 'ring-sky-500',
            text: 'text-sky-600',
            category: 'workflow',
            featureFlag: 'for-each',
        },
        {
            mode: 'map-reduce',
            icon: '🧩',
            label: 'Map Reduce',
            tooltip: 'Map Reduce — fan out parallel map work, then aggregate with one reduce step',
            dotClass: 'bg-indigo-500',
            border: 'border-indigo-500',
            ring: 'ring-indigo-500',
            text: 'text-indigo-600',
            category: 'workflow',
            featureFlag: 'map-reduce',
        },
    ],
    DEFAULT_CHAT_MODES: ['ask', 'autopilot'],
    getVisibleChatModes: ({ category, featureFlags }: { category?: string; featureFlags?: Record<string, boolean> }) => {
        if (category === 'workflow') {
            const modes = [];
            if (featureFlags?.ralph) modes.push('ralph');
            if (featureFlags?.['for-each']) modes.push('for-each');
            if (featureFlags?.['map-reduce']) modes.push('map-reduce');
            return modes;
        }
        return ['ask', 'autopilot'];
    },
    MODE_BORDER_COLORS: {
        autopilot: { border: 'border-green-500', ring: 'ring-green-500' },
        ask: { border: 'border-yellow-500', ring: 'ring-yellow-500' },
        plan: { border: 'border-blue-500', ring: 'ring-blue-500' },
        ralph: { border: 'border-purple-500', ring: 'ring-purple-500' },
        'for-each': { border: 'border-sky-500', ring: 'ring-sky-500' },
        'map-reduce': { border: 'border-indigo-500', ring: 'ring-indigo-500' },
    },
    MODE_ICONS: {
        ask: '💡',
        plan: '📋',
        autopilot: '🤖',
        ralph: '🔄',
        'for-each': '🔁',
        'map-reduce': '🧩',
    },
    MODE_LABELS: {
        ask: '💡 Ask',
        plan: '📋 Plan',
        autopilot: '🤖 Autopilot',
        ralph: '🔄 Ralph',
        'for-each': '🔁 For Each',
        'map-reduce': '🧩 Map Reduce',
    },
    MODE_TOOLTIPS: {
        ask: 'Ask — get answers without making changes',
        plan: 'Plan — create a step-by-step plan',
        autopilot: 'Autopilot — execute changes automatically',
        ralph: 'Ralph — iterative AI coding loop with guided goal setting',
        'for-each': 'For Each — generate a reviewed item plan, then run each item separately',
        'map-reduce': 'Map Reduce — fan out parallel map work, then aggregate with one reduce step',
    },
    cycleMode: (current: string) => {
        const next: Record<string, string> = { autopilot: 'ask', ask: 'autopilot', plan: 'autopilot', 'for-each': 'ask', 'map-reduce': 'ask' };
        return next[current];
    },
    normalizeChatMode: (mode: string) => mode === 'plan' ? 'ask' : mode,
}));

vi.mock('../../../../../src/server/spa/client/react/ui/cn', () => ({
    cn: (...classes: any[]) => classes.filter(Boolean).join(' '),
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/useModels', () => ({
    useModels: (provider?: string) => {
        mockUseModelsProviders.push(provider);
        const modelsByProvider: Record<string, any[]> = {
            copilot: [
                { id: 'gpt-5.4', name: 'GPT 5.4', enabled: true },
                { id: 'shared-model', name: 'Shared Model', enabled: true },
            ],
            codex: [
                { id: 'codex-mini', name: 'Codex Mini', enabled: true },
                { id: 'shared-model', name: 'Shared Model', enabled: true },
            ],
            claude: [
                { id: 'claude-sonnet', name: 'Claude Sonnet', enabled: true },
            ],
        };
        return { models: modelsByProvider[provider ?? 'copilot'] ?? [], loading: false, error: null, reload: vi.fn() };
    },
}));

vi.mock('../../../../../src/server/spa/client/react/features/chat/hooks/useSlashCommands', () => ({
    useSlashCommands: () => ({
        menuVisible: false,
        menuFilter: '',
        filteredSkills: [],
        highlightIndex: 0,
        handleInputChange: vi.fn(),
        handleKeyDown: vi.fn(() => false),
        selectSkill: vi.fn(),
        parseAndExtract: mockParseAndExtract,
        dismissMenu: vi.fn(),
    }),
}));

vi.mock('../../../../../src/server/spa/client/react/features/chat/hooks/useModelCommand', () => ({
    useModelCommand: () => ({
        modelMenuVisible: true,
        modelFilter: '',
        filteredModels: [{ id: 'gpt-5.4', name: 'GPT 5.4', enabled: true }],
        modelHighlightIndex: 0,
        modelOverride: mockModelOverride,
        setModelOverride: mockSetModelOverride,
        handleModelSelect: mockHandleModelSelect,
        showModelMenu: vi.fn(),
        dismissModelMenu: vi.fn(),
        handleModelKeyDown: vi.fn(() => false),
        setModelFilter: vi.fn(),
    }),
    selectPickableModels: (models: unknown[]) => models,
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/useDefaultModelForMode', () => ({
    useDefaultModelForMode: (workspaceId: string | undefined, chatMode: string, _models: any[], provider?: string) => {
        mockUseDefaultModelArgs.push([workspaceId, chatMode, provider]);
        const defaults: Record<string, any> = {
            copilot: { effectiveModel: 'gpt-5.4', effectiveModelName: 'GPT 5.4' },
            codex: { effectiveModel: 'codex-mini', effectiveModelName: 'Codex Mini' },
        };
        return defaults[provider ?? 'copilot'] ?? { effectiveModel: undefined, effectiveModelName: undefined };
    },
}));

vi.mock('../../../../../src/server/spa/client/react/features/chat/SlashCommandMenu', () => ({
    SlashCommandMenu: () => null,
    META_SKILL_ITEMS: [],
    getMetaSkillItems: () => [],
    mergeSkillsWithMeta: (skills: any[]) => skills,
}));

vi.mock('../../../../../src/server/spa/client/react/features/chat/ModelCommandMenu', () => ({
    ModelCommandMenu: ({ onSelect }: any) => (
        <button type="button" data-testid="model-menu-select" onClick={() => onSelect('gpt-5.4')}>
            GPT 5.4
        </button>
    ),
}));

import { NewChatArea } from '../../../../../src/server/spa/client/react/features/chat/NewChatArea';
import { SESSION_CONTEXT_DRAG_KIND, SESSION_CONTEXT_DRAG_MIME } from '../../../../../src/server/spa/client/react/features/chat/sessionContextDrag';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderNewChatArea(workspaceId = 'ws-1') {
    return render(<NewChatArea workspaceId={workspaceId} />);
}

function typeInInput(text: string) {
    const input = screen.getByTestId('new-chat-input');
    fireEvent.change(input, { target: { value: text } });
}

async function clickSend() {
    const btn = screen.getByTestId('new-chat-send-btn');
    await act(async () => {
        fireEvent.click(btn);
    });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NewChatArea – queue_ prefix in handleSend', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockDefaultProvider = 'copilot';
        mockConfiguredDefaultProvider = 'copilot';
        mockAutoProviderRoutingEnabled = false;
        mockRepoPreferences = {};
        mockModelOverride = null;
        mockUseModelsProviders = [];
        mockUseDefaultModelArgs = [];
        mockForEachEnabled = false;
        mockSessionContextAttachmentsEnabled = false;
        mockRalphEnabled = false;
        mockRalphMultiAgentGrillEnabled = false;
        mockAttachments = [];
        mockAttachmentPayload = [];
        mockEffortLevelsEnabled = false;
        mockEffortTiers = {};
        mockPatchRepo.mockResolvedValue({});
        mockParseAndExtract.mockReturnValue({ skills: [], prompt: '' });
        mockAgentProviders = [
            { id: 'copilot', label: 'Copilot', enabled: true, available: true, locked: true },
            { id: 'codex', label: 'Codex', enabled: false, available: false },
            { id: 'claude', label: 'Claude', enabled: false, available: false },
        ];
        mockEnqueueTask.mockResolvedValue({ task: { id: 'default-task' } });
    });

    it('dispatches SELECT_QUEUE_TASK with queue_-prefixed ID when server returns bare task ID', async () => {
        mockEnqueueTask.mockResolvedValueOnce({ task: { id: '1776470192018-abc' } });

        renderNewChatArea();
        typeInInput('Hello world');
        await clickSend();

        await waitFor(() => {
            expect(mockQueueDispatch).toHaveBeenCalledWith({
                type: 'SELECT_QUEUE_TASK',
                id: 'queue_1776470192018-abc',
                repoId: 'ws-1',
            });
        });
    });

    it('does not double-prefix if server returns an already-prefixed processId', async () => {
        mockEnqueueTask.mockResolvedValueOnce({ task: { id: 'queue_1776470192018-xyz' } });

        renderNewChatArea();
        typeInInput('Hello world');
        await clickSend();

        await waitFor(() => {
            expect(mockQueueDispatch).toHaveBeenCalledWith({
                type: 'SELECT_QUEUE_TASK',
                id: 'queue_1776470192018-xyz',
                repoId: 'ws-1',
            });
        });
    });

    it('dispatches with queue_-prefixed ID when task ID comes from top-level id field', async () => {
        // Some API responses use result.id directly (no nested task)
        mockEnqueueTask.mockResolvedValueOnce({ id: '9999-no-task-wrapper' });

        renderNewChatArea();
        typeInInput('Test message');
        await clickSend();

        await waitFor(() => {
            expect(mockQueueDispatch).toHaveBeenCalledWith({
                type: 'SELECT_QUEUE_TASK',
                id: 'queue_9999-no-task-wrapper',
                repoId: 'ws-1',
            });
        });
    });

    it('shows error message when enqueue fails', async () => {
        mockEnqueueTask.mockRejectedValueOnce(new Error('Internal Server Error'));

        renderNewChatArea();
        typeInInput('Failing message');
        await clickSend();

        await waitFor(() => {
            expect(screen.getByTestId('new-chat-error')).toBeTruthy();
        });
        expect(mockQueueDispatch).not.toHaveBeenCalled();
    });

    it('includes provider=copilot in enqueue payload by default', async () => {
        mockEnqueueTask.mockResolvedValueOnce({ task: { id: 'queue_123' } });

        renderNewChatArea();
        typeInInput('Hello');
        await clickSend();

        await waitFor(() => {
            expect(mockEnqueueTask).toHaveBeenCalledWith(
                expect.objectContaining({
                    payload: expect.objectContaining({ provider: 'copilot' }),
                })
            );
        });
    });

    it('uses configured default provider when no last-used provider is saved', async () => {
        mockDefaultProvider = 'codex';
        mockConfiguredDefaultProvider = 'codex';
        mockAgentProviders = [
            { id: 'copilot', label: 'Copilot', enabled: true, available: true, locked: true },
            { id: 'codex', label: 'Codex', enabled: true, available: true },
            { id: 'claude', label: 'Claude', enabled: false, available: false },
        ];
        mockEnqueueTask.mockResolvedValueOnce({ task: { id: 'queue_123' } });

        renderNewChatArea();
        await waitFor(() => expect(screen.getByTestId('agent-selector-chip-btn').textContent).toContain('Codex'));
        typeInInput('Hello');
        await clickSend();

        await waitFor(() => {
            expect(mockEnqueueTask).toHaveBeenCalledWith(
                expect.objectContaining({
                    payload: expect.objectContaining({ provider: 'codex' }),
                })
            );
        });
    });

    it('selects Auto from the configured default and omits provider/model overrides on submit', async () => {
        mockAutoProviderRoutingEnabled = true;
        mockConfiguredDefaultProvider = 'auto';
        mockDefaultProvider = 'copilot';
        mockAgentProviders = [
            { id: 'copilot', label: 'Copilot', enabled: true, available: true, locked: true },
            { id: 'codex', label: 'Codex', enabled: true, available: true },
            { id: 'claude', label: 'Claude', enabled: true, available: true },
        ];
        mockEnqueueTask.mockResolvedValueOnce({ task: { id: 'queue_auto' } });

        renderNewChatArea();
        await waitFor(() => expect(screen.getByTestId('agent-selector-chip-btn').textContent).toContain('Auto'));
        expect(screen.getByTestId('effort-tier-selector')).toBeTruthy();
        expect(screen.queryByTestId('model-picker-chip-container')).toBeNull();

        typeInInput('Use Auto');
        await clickSend();

        await waitFor(() => expect(mockEnqueueTask).toHaveBeenCalledOnce());
        const body = mockEnqueueTask.mock.calls[0][0];
        expect(body.payload.provider).toBeUndefined();
        expect(body.payload.model).toBeUndefined();
        expect(body.payload.reasoningEffort).toBeUndefined();
        expect(body.payload.context).toEqual({ autoProviderRouting: { requested: true } });
        expect(body.config).toEqual({ effortTier: 'medium' });
    });

    it('persists Auto when selected explicitly', async () => {
        mockAutoProviderRoutingEnabled = true;
        mockAgentProviders = [
            { id: 'copilot', label: 'Copilot', enabled: true, available: true, locked: true },
            { id: 'codex', label: 'Codex', enabled: true, available: true },
            { id: 'claude', label: 'Claude', enabled: true, available: true },
        ];

        renderNewChatArea();
        await waitFor(() => expect(screen.getByTestId('agent-selector-chip-btn').textContent).toContain('Auto'));
        fireEvent.click(screen.getByTestId('agent-selector-chip-btn'));
        fireEvent.click(screen.getByTestId('agent-option-auto'));

        expect(mockPatchRepo).toHaveBeenCalledWith('ws-1', { lastChatProvider: 'auto' });
        await waitFor(() => expect(screen.getByTestId('agent-selector-chip-btn').textContent).toContain('Auto'));
    });

    it('ignores a persisted Auto provider when Auto routing is disabled', async () => {
        mockAutoProviderRoutingEnabled = false;
        mockRepoPreferences = { lastChatProvider: 'auto' };

        renderNewChatArea();

        await waitFor(() => expect(screen.getByTestId('agent-selector-chip-btn').textContent).toContain('Copilot'));
        fireEvent.click(screen.getByTestId('agent-selector-chip-btn'));
        expect(screen.queryByTestId('agent-option-auto')).toBeNull();
    });

    it('falls back to copilot when configured default provider is unavailable', async () => {
        mockDefaultProvider = 'codex';
        mockConfiguredDefaultProvider = 'codex';
        mockAgentProviders = [
            { id: 'copilot', label: 'Copilot', enabled: true, available: true, locked: true },
            { id: 'codex', label: 'Codex', enabled: true, available: false, reason: 'Sign in required' },
            { id: 'claude', label: 'Claude', enabled: false, available: false },
        ];
        mockEnqueueTask.mockResolvedValueOnce({ task: { id: 'queue_123' } });

        renderNewChatArea();
        await waitFor(() => expect(screen.getByTestId('agent-selector-chip-btn').textContent).toContain('Copilot'));
        typeInInput('Hello');
        await clickSend();

        await waitFor(() => {
            expect(mockEnqueueTask).toHaveBeenCalledWith(
                expect.objectContaining({
                    payload: expect.objectContaining({ provider: 'copilot' }),
                })
            );
        });
    });

    it('renders agent selector chip in the toolbar', async () => {
        renderNewChatArea();
        await waitFor(() => {
            expect(screen.getByTestId('agent-selector-chip-btn')).toBeTruthy();
        });
    });

    it('keeps the draft text when selecting a model from the picker', () => {
        renderNewChatArea();
        typeInInput('Keep this draft');

        fireEvent.click(screen.getByTestId('model-menu-select'));

        expect(mockHandleModelSelect).toHaveBeenCalledWith('gpt-5.4');
        expect((screen.getByTestId('new-chat-input') as HTMLInputElement).value).toBe('Keep this draft');
    });

    it('resolves models and default model against the selected provider after switching', async () => {
        mockAgentProviders = [
            { id: 'copilot', label: 'Copilot', enabled: true, available: true, locked: true },
            { id: 'codex', label: 'Codex', enabled: true, available: true },
            { id: 'claude', label: 'Claude', enabled: false, available: false },
        ];

        renderNewChatArea();
        await waitFor(() => expect(screen.getByTestId('agent-selector-chip-btn').textContent).toContain('Copilot'));

        fireEvent.click(screen.getByTestId('agent-selector-chip-btn'));
        fireEvent.click(screen.getByTestId('agent-option-codex'));

        await waitFor(() => {
            expect(mockUseModelsProviders).toContain('codex');
            expect(mockUseDefaultModelArgs.some(([, , provider]) => provider === 'codex')).toBe(true);
            expect(screen.getByTestId('model-picker-chip').textContent).toContain('Codex Mini');
        });
    });

    it('omits a stale model override after switching to a provider without that model', async () => {
        mockModelOverride = 'gpt-5.4';
        mockAgentProviders = [
            { id: 'copilot', label: 'Copilot', enabled: true, available: true, locked: true },
            { id: 'codex', label: 'Codex', enabled: true, available: true },
            { id: 'claude', label: 'Claude', enabled: false, available: false },
        ];
        mockEnqueueTask.mockResolvedValueOnce({ task: { id: 'queue_123' } });

        renderNewChatArea();
        await waitFor(() => expect((screen.getByTestId('agent-selector-chip-btn') as HTMLButtonElement).disabled).toBe(false));
        fireEvent.click(screen.getByTestId('agent-selector-chip-btn'));
        fireEvent.click(screen.getByTestId('agent-option-codex'));
        typeInInput('Hello');
        await clickSend();

        await waitFor(() => {
            expect(mockSetModelOverride).toHaveBeenCalledWith(null);
            expect(mockEnqueueTask).toHaveBeenCalledWith(
                expect.objectContaining({
                    payload: expect.objectContaining({ provider: 'codex' }),
                })
            );
        });
        const body = mockEnqueueTask.mock.calls[0][0];
        expect(body.payload.model).toBeUndefined();
    });

    it('preserves and sends an override that exists in both provider catalogs', async () => {
        mockModelOverride = 'shared-model';
        mockAgentProviders = [
            { id: 'copilot', label: 'Copilot', enabled: true, available: true, locked: true },
            { id: 'codex', label: 'Codex', enabled: true, available: true },
            { id: 'claude', label: 'Claude', enabled: false, available: false },
        ];
        mockEnqueueTask.mockResolvedValueOnce({ task: { id: 'queue_123' } });

        renderNewChatArea();
        await waitFor(() => expect((screen.getByTestId('agent-selector-chip-btn') as HTMLButtonElement).disabled).toBe(false));
        fireEvent.click(screen.getByTestId('agent-selector-chip-btn'));
        fireEvent.click(screen.getByTestId('agent-option-codex'));
        typeInInput('Hello');
        await clickSend();

        const body = mockEnqueueTask.mock.calls[0][0];
        expect(mockSetModelOverride).not.toHaveBeenCalledWith(null);
        expect(body.payload.provider).toBe('codex');
        expect(body.payload.model).toBe('shared-model');
    });

    it('creates and selects a persisted For Each generation chat when enabled', async () => {
        mockForEachEnabled = true;
        mockEnqueueTask.mockResolvedValueOnce({ task: { id: 'for-each-generation-task' } });

        render(<NewChatArea workspaceId="ws-1" />);
        fireEvent.click(screen.getByTestId('workflow-mode-trigger'));
        fireEvent.click(screen.getByTestId('workflow-mode-option-for-each'));
        typeInInput('Split this work into items');
        await clickSend();

        await waitFor(() => {
            expect(mockEnqueueTask).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'chat',
                    priority: 'normal',
                    payload: expect.objectContaining({
                        kind: 'chat',
                        mode: 'ask',
                        prompt: 'Split this work into items',
                        workspaceId: 'ws-1',
                        provider: 'copilot',
                        context: expect.objectContaining({
                            forEach: expect.objectContaining({
                                kind: 'generation',
                                workspaceId: 'ws-1',
                                childMode: 'ask',
                                originalRequest: 'Split this work into items',
                                status: 'draft',
                            }),
                        }),
                    }),
                }),
            );
        });
        const forEachContext = mockEnqueueTask.mock.calls[0][0].payload.context.forEach;
        expect(forEachContext.generationId).toMatch(/^for-each-gen-\d+-[a-z0-9]+$/);
        expect(mockQueueDispatch).toHaveBeenCalledWith({
            type: 'SELECT_QUEUE_TASK',
            id: 'queue_for-each-generation-task',
            repoId: 'ws-1',
        });
    });

    it('does not expose the For Each mode while the feature flag is disabled', () => {
        mockForEachEnabled = false;

        render(<NewChatArea workspaceId="ws-1" />);

        expect(screen.queryByTestId('mode-pill-for-each')).toBeNull();
        expect(screen.queryByTestId('workflow-mode-trigger')).toBeNull();
    });

    it('uses the normal chat payload capabilities for For Each generation', async () => {
        mockForEachEnabled = true;
        mockSessionContextAttachmentsEnabled = true;
        mockDefaultProvider = 'codex';
        mockConfiguredDefaultProvider = 'codex';
        mockModelOverride = 'shared-model';
        mockAgentProviders = [
            { id: 'copilot', label: 'Copilot', enabled: true, available: true, locked: true },
            { id: 'codex', label: 'Codex', enabled: true, available: true },
            { id: 'claude', label: 'Claude', enabled: false, available: false },
        ];
        mockAttachments = [
            {
                id: 'att-1',
                name: 'notes.md',
                mimeType: 'text/markdown',
                size: 12,
                dataUrl: 'data:text/markdown;base64,Tm90ZXM=',
                category: 'document',
            },
        ];
        mockAttachmentPayload = [
            {
                name: 'notes.md',
                mimeType: 'text/markdown',
                size: 12,
                dataUrl: 'data:text/markdown;base64,Tm90ZXM=',
            },
        ];
        mockParseAndExtract.mockImplementation((text: string) => ({
            skills: ['safety'],
            prompt: text.replace(/^\/safety\s*/, ''),
        }));
        mockEnqueueTask.mockResolvedValueOnce({ task: { id: 'for-each-generation-task' } });

        render(<NewChatArea workspaceId="ws-1" />);
        await waitFor(() => expect(screen.getByTestId('agent-selector-chip-btn').textContent).toContain('Codex'));

        fireEvent.drop(screen.getByTestId('chat-input-stack'), {
            dataTransfer: {
                types: [SESSION_CONTEXT_DRAG_MIME],
                dropEffect: 'copy',
                getData: (type: string) => type === SESSION_CONTEXT_DRAG_MIME
                    ? JSON.stringify({
                        kind: SESSION_CONTEXT_DRAG_KIND,
                        version: 1,
                        sourceWorkspaceId: 'ws-1',
                        sourceProcessId: 'queue_source-1',
                        title: 'Source chat',
                        status: 'completed',
                        lastActivityAt: '2026-01-01T00:00:00.000Z',
                    })
                    : '',
            },
        });
        await waitFor(() => expect(screen.getByTestId('attached-session-context-chip')).toBeTruthy());

        fireEvent.click(screen.getByTestId('effort-pill-trigger-btn'));
        fireEvent.click(screen.getByTestId('effort-pill-option-high'));
        fireEvent.click(screen.getByTestId('workflow-mode-trigger'));
        fireEvent.click(screen.getByTestId('workflow-mode-option-for-each'));
        typeInInput('/safety Split into safer tasks');
        await clickSend();

        await waitFor(() => expect(mockEnqueueTask).toHaveBeenCalledOnce());
        const body = mockEnqueueTask.mock.calls[0][0];
        expect(body.payload).toEqual(expect.objectContaining({
            kind: 'chat',
            mode: 'ask',
            workspaceId: 'ws-1',
            workingDirectory: '/repos/myrepo',
            provider: 'codex',
            model: 'shared-model',
            reasoningEffort: 'high',
            attachments: mockAttachmentPayload,
        }));
        expect(body.payload.prompt).toContain('<attached_session_context version="1">');
        expect(body.payload.prompt).toContain('process_id="queue_source-1"');
        expect(body.payload.prompt).toContain('Split into safer tasks');
        expect(body.payload.prompt).not.toContain('/safety');
        expect(body.payload.context).toEqual(expect.objectContaining({
            skills: ['safety'],
            forEach: expect.objectContaining({
                kind: 'generation',
                workspaceId: 'ws-1',
                childMode: 'ask',
                originalRequest: 'Split into safer tasks',
                status: 'draft',
            }),
        }));
        expect(body.payload.context.forEach.generationId).toMatch(/^for-each-gen-\d+-[a-z0-9]+$/);
        expect(mockClearAttachments).toHaveBeenCalled();
        expect(mockQueueDispatch).toHaveBeenCalledWith({
            type: 'SELECT_QUEUE_TASK',
            id: 'queue_for-each-generation-task',
            repoId: 'ws-1',
        });
    });

    it('sends selected Ralph grill depth and per-agent tier setup for New Chat Ralph grilling', async () => {
        mockRalphEnabled = true;
        mockRalphMultiAgentGrillEnabled = true;
        mockEffortLevelsEnabled = true;
        mockEffortTiers = {
            medium: { model: 'claude-sonnet', reasoningEffort: 'high' },
        };
        mockAgentProviders = [
            { id: 'copilot', label: 'Copilot', enabled: true, available: true, locked: true },
            { id: 'codex', label: 'Codex', enabled: true, available: true },
            { id: 'claude', label: 'Claude', enabled: true, available: true },
        ];
        mockEnqueueTask.mockResolvedValueOnce({ task: { id: 'ralph-grill-task' } });

        render(<NewChatArea workspaceId="ws-1" />);
        fireEvent.click(screen.getByTestId('workflow-mode-trigger'));
        fireEvent.click(screen.getByTestId('workflow-mode-option-ralph'));
        await waitFor(() => expect(screen.getByTestId('new-chat-ralph-grill-panel')).toBeTruthy());

        fireEvent.click(screen.getByTestId('new-chat-ralph-grill-depth-deep'));
        fireEvent.click(screen.getByTestId('new-chat-ralph-grill-agent-ux-edit'));
        fireEvent.change(screen.getByTestId('new-chat-ralph-grill-agent-ux-provider'), {
            target: { value: 'claude' },
        });
        expect(screen.getByTestId('new-chat-ralph-grill-agent-ux-tier').getAttribute('data-tier-value')).toBe('medium');
        typeInInput('Grill this goal');
        await clickSend();

        await waitFor(() => expect(mockEnqueueTask).toHaveBeenCalledOnce());
        const body = mockEnqueueTask.mock.calls[0][0];
        expect(body.payload.mode).toBe('ask');
        expect(body.payload.context.ralph.phase).toBe('grilling');
        expect(body.payload.context.ralph.grill).toEqual(expect.objectContaining({
            enabled: true,
            depth: 'deep',
        }));
        expect(body.payload.context.ralph.grill.agents).toEqual(expect.arrayContaining([
            { role: 'ux', provider: 'claude', model: 'claude-sonnet', reasoningEffort: 'high', effortTier: 'medium' },
            expect.objectContaining({ role: 'provenance' }),
        ]));
    });
});

// ---------------------------------------------------------------------------
// Effort Tier selector tests (AC-04)
// ---------------------------------------------------------------------------

describe('NewChatArea – Effort Tier selector', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockDefaultProvider = 'copilot';
        mockConfiguredDefaultProvider = 'copilot';
        mockAutoProviderRoutingEnabled = false;
        mockRepoPreferences = {};
        mockModelOverride = null;
        mockUseModelsProviders = [];
        mockUseDefaultModelArgs = [];
        mockForEachEnabled = false;
        mockSessionContextAttachmentsEnabled = false;
        mockAttachments = [];
        mockAttachmentPayload = [];
        mockEffortLevelsEnabled = false;
        mockEffortTiers = {};
        mockPatchRepo.mockResolvedValue({});
        mockParseAndExtract.mockReturnValue({ skills: [], prompt: '' });
        mockAgentProviders = [
            { id: 'copilot', label: 'Copilot', enabled: true, available: true, locked: true },
            { id: 'codex', label: 'Codex', enabled: false, available: false },
            { id: 'claude', label: 'Claude', enabled: false, available: false },
        ];
        mockEnqueueTask.mockResolvedValue({ task: { id: 'queue_tier-test' } });
        localStorage.clear();
    });

    it('shows legacy model picker when effortLevels flag is OFF', async () => {
        mockEffortLevelsEnabled = false;
        renderNewChatArea();
        await waitFor(() => expect(screen.getByTestId('model-picker-chip-container')).toBeTruthy());
        expect(screen.queryByTestId('effort-tier-selector')).toBeNull();
    });

    it('shows legacy model picker when flag is ON but provider has zero tiers', async () => {
        mockEffortLevelsEnabled = true;
        mockEffortTiers = {};
        renderNewChatArea();
        // Tiers load asynchronously — wait a tick then check legacy controls are still present
        await waitFor(() => expect(screen.getByTestId('model-picker-chip-container')).toBeTruthy());
        expect(screen.queryByTestId('effort-tier-selector')).toBeNull();
    });

    it('shows effort tier selector when flag is ON and provider has tiers configured', async () => {
        mockEffortLevelsEnabled = true;
        mockEffortTiers = {
            medium: { model: 'balanced-model', reasoningEffort: null },
        };
        renderNewChatArea();
        await waitFor(() => expect(screen.getByTestId('effort-tier-selector')).toBeTruthy());
        expect(screen.queryByTestId('model-picker-chip-container')).toBeNull();
    });

    it('defaults to "medium" tier on first use (no localStorage)', async () => {
        mockEffortLevelsEnabled = true;
        mockEffortTiers = {
            low: { model: 'fast', reasoningEffort: 'low' },
            medium: { model: 'balanced', reasoningEffort: null },
            high: { model: 'deep', reasoningEffort: 'high' },
        };
        renderNewChatArea();
        await waitFor(() => expect(screen.getByTestId('effort-tier-selector')).toBeTruthy());
        expect(screen.getByTestId('effort-tier-trigger-btn').textContent).toContain('Effort: Medium');
    });

    it('restores last-picked tier from localStorage', async () => {
        localStorage.setItem('coc:effort-tier:ws-1', 'high');
        mockEffortLevelsEnabled = true;
        mockEffortTiers = {
            low: { model: 'fast', reasoningEffort: 'low' },
            medium: { model: 'balanced', reasoningEffort: null },
            high: { model: 'deep', reasoningEffort: 'high' },
        };
        renderNewChatArea('ws-1');
        await waitFor(() => expect(screen.getByTestId('effort-tier-selector')).toBeTruthy());
        expect(screen.getByTestId('effort-tier-trigger-btn').textContent).toContain('Effort: High');
    });

    it('saves selected tier to localStorage on tier change', async () => {
        mockEffortLevelsEnabled = true;
        mockEffortTiers = {
            low: { model: 'fast', reasoningEffort: 'low' },
            medium: { model: 'balanced', reasoningEffort: null },
            high: { model: 'deep', reasoningEffort: 'high' },
        };
        renderNewChatArea('ws-1');
        await waitFor(() => expect(screen.getByTestId('effort-tier-selector')).toBeTruthy());

        fireEvent.click(screen.getByTestId('effort-tier-trigger-btn'));
        fireEvent.click(screen.getByTestId('effort-tier-option-low'));

        expect(localStorage.getItem('coc:effort-tier:ws-1')).toBe('low');
    });

    it('sends resolved model+effort from selected tier in enqueue payload', async () => {
        mockEffortLevelsEnabled = true;
        mockEffortTiers = {
            medium: { model: 'balanced-model', reasoningEffort: 'medium' },
        };
        mockEnqueueTask.mockResolvedValueOnce({ task: { id: 'queue_abc' } });

        renderNewChatArea('ws-1');
        await waitFor(() => expect(screen.getByTestId('effort-tier-selector')).toBeTruthy());

        typeInInput('Hello tier');
        await clickSend();

        await waitFor(() => {
            expect(mockEnqueueTask).toHaveBeenCalledWith(
                expect.objectContaining({
                    payload: expect.objectContaining({
                        model: 'balanced-model',
                        reasoningEffort: 'medium',
                    }),
                }),
            );
        });
    });

    it('sends model from tier with no reasoningEffort when tier effort is empty', async () => {
        mockEffortLevelsEnabled = true;
        mockEffortTiers = {
            medium: { model: 'auto-model', reasoningEffort: null },
        };
        mockEnqueueTask.mockResolvedValueOnce({ task: { id: 'queue_abc' } });

        renderNewChatArea('ws-1');
        await waitFor(() => expect(screen.getByTestId('effort-tier-selector')).toBeTruthy());

        typeInInput('Hello');
        await clickSend();

        await waitFor(() => {
            const body = mockEnqueueTask.mock.calls[0][0];
            expect(body.payload.model).toBe('auto-model');
            expect(body.payload.reasoningEffort).toBeUndefined();
        });
    });

    it('unconfigured tier option is disabled in the selector dropdown', async () => {
        mockEffortLevelsEnabled = true;
        mockEffortTiers = {
            medium: { model: 'balanced', reasoningEffort: null },
            high: { model: 'deep', reasoningEffort: 'high' },
        };
        renderNewChatArea();
        await waitFor(() => expect(screen.getByTestId('effort-tier-selector')).toBeTruthy());

        fireEvent.click(screen.getByTestId('effort-tier-trigger-btn'));
        const lowOption = screen.getByTestId('effort-tier-option-low');
        expect(lowOption.getAttribute('aria-disabled')).toBe('true');
        expect(lowOption.getAttribute('data-configured')).toBe('false');
    });
});
