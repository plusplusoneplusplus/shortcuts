/**
 * @vitest-environment jsdom
 *
 * Tests for NewChatArea — focused on the queue_ prefix fix in handleSend.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks – declared before importing component under test
// ---------------------------------------------------------------------------

const mockQueueDispatch = vi.fn();
const mockAppDispatch = vi.fn();
const mockEnqueueTask = vi.fn();
const mockHandleModelSelect = vi.fn();
const mockSetModelOverride = vi.fn((model: string | null) => { mockModelOverride = model; });
let mockDefaultProvider: 'copilot' | 'codex' | 'claude' = 'copilot';
let mockRepoPreferences: Record<string, unknown> = {};
let mockModelOverride: string | null = null;
let mockUseModelsProviders: Array<string | undefined> = [];
let mockUseDefaultModelArgs: Array<[string | undefined, string, string | undefined]> = [];
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
    isRalphEnabled: () => false,
    isLoopsEnabled: () => false,
    getDefaultProvider: () => mockDefaultProvider,
    isEffortLevelsEnabled: () => mockEffortLevelsEnabled,
}));

vi.mock('../../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        queue: { enqueue: mockEnqueueTask },
        preferences: {
            patchGlobal: vi.fn().mockResolvedValue({}),
            getRepo: vi.fn().mockResolvedValue(mockRepoPreferences),
            patchRepo: vi.fn().mockResolvedValue({}),
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
        attachments: [],
        addFromPaste: vi.fn(),
        addFromFileInput: vi.fn(),
        removeAttachment: vi.fn(),
        clearAttachments: vi.fn(),
        error: null,
        toPayload: () => [],
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
    MODE_BORDER_COLORS: {
        autopilot: { border: 'border-green-500', ring: 'ring-green-500' },
        ask: { border: 'border-yellow-500', ring: 'ring-yellow-500' },
        plan: { border: 'border-blue-500', ring: 'ring-blue-500' },
    },
    MODE_ICONS: {
        ask: '💡',
        plan: '📋',
        autopilot: '🤖',
    },
    MODE_LABELS: {
        ask: '💡 Ask',
        plan: '📋 Plan',
        autopilot: '🤖 Autopilot',
    },
    MODE_TOOLTIPS: {
        ask: 'Ask — get answers without making changes',
        plan: 'Plan — create a step-by-step plan',
        autopilot: 'Autopilot — execute changes automatically',
    },
    cycleMode: (current: string) => {
        const next: Record<string, string> = { autopilot: 'ask', ask: 'autopilot', plan: 'autopilot' };
        return next[current];
    },
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
        parseAndExtract: vi.fn(() => ({ skills: [], prompt: '' })),
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
        mockRepoPreferences = {};
        mockModelOverride = null;
        mockUseModelsProviders = [];
        mockUseDefaultModelArgs = [];
        mockEffortLevelsEnabled = false;
        mockEffortTiers = {};
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

    it('falls back to copilot when configured default provider is unavailable', async () => {
        mockDefaultProvider = 'codex';
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
});

// ---------------------------------------------------------------------------
// Effort Tier selector tests (AC-04)
// ---------------------------------------------------------------------------

describe('NewChatArea – Effort Tier selector', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockDefaultProvider = 'copilot';
        mockRepoPreferences = {};
        mockModelOverride = null;
        mockUseModelsProviders = [];
        mockUseDefaultModelArgs = [];
        mockEffortLevelsEnabled = false;
        mockEffortTiers = {};
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

