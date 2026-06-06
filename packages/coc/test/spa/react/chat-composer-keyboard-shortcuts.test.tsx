/* @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React, { createRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentProviderStatus } from '@plusplusoneplusplus/coc-client';

const {
    richTextProps,
    tracker,
    mockQueueDispatch,
    mockAppState,
    mockClient,
    mockConfig,
    mockAgentProviders,
    mockModels,
    mockDefaultModel,
    mockReasoningEfforts,
    mockEffortTiers,
    mockSlashCommands,
    mockModelCommand,
    mockPromptHistoryHandleKeyDown,
    mockPromptHistoryReset,
    mockAutocomplete,
    mockClearAttachments,
    mockAttachedContextClear,
} = vi.hoisted(() => {
    const providers: AgentProviderStatus[] = [
        { id: 'copilot', label: 'Copilot', enabled: true, available: true },
        { id: 'codex', label: 'Codex', enabled: true, available: true },
        { id: 'claude', label: 'Claude', enabled: true, available: true },
    ];

    return {
        richTextProps: {} as Record<string, any>,
        tracker: { calls: [] as Array<[string, number?]>, domValue: '' },
        mockQueueDispatch: vi.fn(),
        mockAppState: { workspaces: [{ id: 'ws-1', rootPath: '/repo' }], onboardingProgress: { hasUsedChat: true } } as Record<string, any>,
        mockClient: {
            skills: { listAllWorkspace: vi.fn().mockResolvedValue({ merged: [] }) },
            preferences: {
                getRepo: vi.fn().mockResolvedValue({}),
                patchRepo: vi.fn().mockResolvedValue({}),
            },
            queue: { enqueue: vi.fn().mockResolvedValue({ task: { id: 'queued-1' } }) },
        },
        mockConfig: {
            effortLevelsEnabled: false,
            ralphEnabled: false,
            forEachEnabled: false,
            loopsEnabled: false,
            sessionContextAttachmentsEnabled: false,
            defaultProvider: 'copilot' as const,
        },
        mockAgentProviders: { providers, loading: false, error: null, reload: vi.fn() },
        mockModels: {
            models: [{
                id: 'gpt-test',
                name: 'GPT Test',
                enabled: true,
                tokenLimit: 100_000,
                capabilities: {
                    supports: { vision: true, reasoningEffort: true },
                    limits: { max_context_window_tokens: 100_000 },
                },
                supportedReasoningEfforts: ['low', 'high'],
            }],
            loading: false,
            error: null,
            reload: vi.fn(),
        },
        mockDefaultModel: { effectiveModel: 'gpt-test', effectiveModelName: 'GPT Test' },
        mockReasoningEfforts: {} as Record<string, string>,
        mockEffortTiers: {
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
        },
        mockSlashCommands: {
            menuVisible: false,
            menuFilter: '',
            filteredSkills: [] as any[],
            highlightIndex: 0,
            activeCommandHint: null as string | null,
            handleInputChange: vi.fn(),
            handleKeyDown: vi.fn(() => false),
            selectSkill: vi.fn(),
            parseAndExtract: vi.fn((prompt: string) => ({ skills: [], prompt })),
            dismissMenu: vi.fn(),
        },
        mockModelCommand: {
            modelMenuVisible: false,
            modelFilter: '',
            filteredModels: [] as any[],
            modelHighlightIndex: 0,
            modelOverride: null as string | null,
            setModelOverride: vi.fn(),
            handleModelSelect: vi.fn(),
            showModelMenu: vi.fn(),
            dismissModelMenu: vi.fn(),
            handleModelKeyDown: vi.fn(() => false),
            setModelFilter: vi.fn(),
        },
        mockPromptHistoryHandleKeyDown: vi.fn(() => false),
        mockPromptHistoryReset: vi.fn(),
        mockAutocomplete: {
            completion: null as string | null,
            accept: vi.fn(() => ''),
            dismiss: vi.fn(),
        },
        mockClearAttachments: vi.fn(),
        mockAttachedContextClear: vi.fn(),
    };
});

vi.mock('../../../src/server/spa/client/react/shared/RichTextInput', async () => {
    const R = await import('react');
    return {
        RichTextInput: R.forwardRef((props: any, ref: any) => {
            richTextProps[props['data-testid']] = props;
            R.useImperativeHandle(ref, () => ({
                getValue: () => tracker.domValue,
                setValue: (text: string, cursorPos?: number) => {
                    tracker.calls.push([text, cursorPos]);
                    tracker.domValue = text;
                },
                focus: () => {},
            }), []);
            return R.createElement('div', {
                'data-testid': props['data-testid'],
                className: props.className,
                onKeyDown: props.onKeyDown,
                onPaste: props.onPaste,
                tabIndex: 0,
            });
        }),
    };
});

vi.mock('../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => mockClient,
    getSpaCocClientErrorMessage: (_error: unknown, fallback: string) => fallback,
}));

vi.mock('../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ state: {}, dispatch: mockQueueDispatch }),
}));

vi.mock('../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({ state: mockAppState, dispatch: vi.fn() }),
}));

vi.mock('../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => '/api',
    getConfig: () => ({ apiBasePath: '/api' }),
    isRalphEnabled: () => mockConfig.ralphEnabled,
    isForEachEnabled: () => mockConfig.forEachEnabled,
    isLoopsEnabled: () => mockConfig.loopsEnabled,
    isCodexEnabled: () => false,
    getDefaultProvider: () => mockConfig.defaultProvider,
    getActiveProvider: () => mockConfig.defaultProvider,
    isEffortLevelsEnabled: () => mockConfig.effortLevelsEnabled,
    isSessionContextAttachmentsEnabled: () => mockConfig.sessionContextAttachmentsEnabled,
}));

vi.mock('../../../src/server/spa/client/react/hooks/useAgentProviders', () => ({
    useAgentProviders: () => mockAgentProviders,
}));

vi.mock('../../../src/server/spa/client/react/hooks/useModels', () => ({
    useModels: () => mockModels,
}));

vi.mock('../../../src/server/spa/client/react/hooks/useDefaultModelForMode', () => ({
    useDefaultModelForMode: () => mockDefaultModel,
}));

vi.mock('../../../src/server/spa/client/react/hooks/useProviderReasoningEfforts', () => ({
    useProviderReasoningEfforts: () => mockReasoningEfforts,
}));

vi.mock('../../../src/server/spa/client/react/hooks/useProviderEffortTiers', () => ({
    useProviderEffortTiers: () => mockEffortTiers,
}));

vi.mock('../../../src/server/spa/client/react/features/chat/hooks/useSlashCommands', () => ({
    useSlashCommands: () => mockSlashCommands,
}));

vi.mock('../../../src/server/spa/client/react/features/chat/hooks/useModelCommand', () => ({
    useModelCommand: () => mockModelCommand,
    selectPickableModels: (models: any[]) => models.filter(model => model.enabled !== false),
}));

vi.mock('../../../src/server/spa/client/react/features/chat/SlashCommandMenu', () => ({
    SlashCommandMenu: () => null,
    META_SKILL_ITEMS: [],
    getMetaSkillItems: () => [],
    mergeSkillsWithMeta: (skills: any[]) => skills,
}));

vi.mock('../../../src/server/spa/client/react/features/chat/ModelCommandMenu', () => ({
    ModelCommandMenu: () => null,
}));

vi.mock('../../../src/server/spa/client/react/hooks/usePromptAutocompleteEnabled', () => ({
    usePromptAutocompleteEnabled: () => true,
}));

vi.mock('../../../src/server/spa/client/react/hooks/usePromptAutocomplete', () => ({
    usePromptAutocomplete: () => mockAutocomplete,
}));

vi.mock('../../../src/server/spa/client/react/hooks/useChatPromptHistory', () => ({
    useChatPromptHistory: () => ({
        handleKeyDown: mockPromptHistoryHandleKeyDown,
        reset: mockPromptHistoryReset,
    }),
}));

vi.mock('../../../src/server/spa/client/react/hooks/useOnboardingPreferences', () => ({
    useOnboardingPreferences: () => ({ updateOnboarding: vi.fn().mockResolvedValue(undefined) }),
}));

vi.mock('../../../src/server/spa/client/react/features/chat/hooks/useFileAttachments', () => ({
    useFileAttachments: () => ({
        attachments: [],
        addFromPaste: vi.fn(),
        addFromFileInput: vi.fn(),
        removeAttachment: vi.fn(),
        clearAttachments: mockClearAttachments,
        error: null,
        toPayload: () => [],
    }),
}));

vi.mock('../../../src/server/spa/client/react/features/chat/hooks/useAttachedContext', () => ({
    formatAttachedContext: () => '',
    useAttachedContext: () => ({
        items: [],
        getItems: () => [],
        addSessionContext: vi.fn(),
        remove: vi.fn(),
        clear: mockAttachedContextClear,
    }),
}));

vi.mock('../../../src/server/spa/client/react/features/chat/sessionContextDrop', () => ({
    dataTransferHasSessionContext: () => false,
    readSessionContextDropPayload: () => null,
    useConversationRetrievalCapability: () => false,
    validateSessionContextAttachmentsForSend: () => null,
    validateSessionContextDrop: () => ({ ok: false, error: 'not mocked' }),
}));

import { NewChatArea } from '../../../src/server/spa/client/react/features/chat/NewChatArea';
import { FollowUpInputArea } from '../../../src/server/spa/client/react/features/chat/FollowUpInputArea';
import type { FollowUpInputAreaProps } from '../../../src/server/spa/client/react/features/chat/FollowUpInputArea';
import type { RichTextInputHandle } from '../../../src/server/spa/client/react/shared/RichTextInput';

beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(richTextProps)) delete richTextProps[key];
    tracker.calls = [];
    tracker.domValue = '';
    mockClient.skills.listAllWorkspace.mockResolvedValue({ merged: [] });
    mockClient.preferences.getRepo.mockResolvedValue({});
    mockClient.preferences.patchRepo.mockResolvedValue({});
    mockClient.queue.enqueue.mockResolvedValue({ task: { id: 'queued-1' } });
    mockConfig.effortLevelsEnabled = false;
    mockConfig.defaultProvider = 'copilot';
    mockAgentProviders.providers = [
        { id: 'copilot', label: 'Copilot', enabled: true, available: true },
        { id: 'codex', label: 'Codex', enabled: true, available: true },
        { id: 'claude', label: 'Claude', enabled: true, available: true },
    ];
    mockAgentProviders.loading = false;
    mockModels.models = [{
        id: 'gpt-test',
        name: 'GPT Test',
        enabled: true,
        tokenLimit: 100_000,
        capabilities: {
            supports: { vision: true, reasoningEffort: true },
            limits: { max_context_window_tokens: 100_000 },
        },
        supportedReasoningEfforts: ['low', 'high'],
    }];
    mockModels.loading = false;
    mockDefaultModel.effectiveModel = 'gpt-test';
    mockDefaultModel.effectiveModelName = 'GPT Test';
    for (const key of Object.keys(mockReasoningEfforts)) delete mockReasoningEfforts[key];
    mockEffortTiers.tiers = {};
    mockEffortTiers.loading = false;
    mockSlashCommands.menuVisible = false;
    mockSlashCommands.filteredSkills = [];
    mockSlashCommands.highlightIndex = 0;
    mockSlashCommands.activeCommandHint = null;
    mockSlashCommands.handleKeyDown.mockReturnValue(false);
    mockSlashCommands.parseAndExtract.mockImplementation((prompt: string) => ({ skills: [], prompt }));
    mockModelCommand.modelMenuVisible = false;
    mockModelCommand.filteredModels = [];
    mockModelCommand.modelHighlightIndex = 0;
    mockModelCommand.modelOverride = null;
    mockModelCommand.handleModelKeyDown.mockReturnValue(false);
    mockPromptHistoryHandleKeyDown.mockReturnValue(false);
    mockAutocomplete.completion = null;
    mockAutocomplete.accept.mockReturnValue('');
    Object.defineProperty(window.navigator, 'platform', { value: 'Linux x86_64', configurable: true });
    localStorage.clear();
});

function makeFollowUpProps(overrides: Partial<FollowUpInputAreaProps> = {}): FollowUpInputAreaProps {
    return {
        richTextRef: createRef<RichTextInputHandle>(),
        inputDisabled: false,
        sending: false,
        isActiveGeneration: false,
        isCancelling: false,
        error: null,
        resumeFeedback: null,
        suggestions: [],
        followUpInput: '',
        setFollowUpInput: vi.fn(),
        selectedMode: 'ask',
        setSelectedMode: vi.fn(),
        onSend: vi.fn().mockResolvedValue(undefined),
        onRetry: vi.fn(),
        skills: [],
        attachments: [],
        onAttachmentPaste: vi.fn(),
        onAttachmentRemove: vi.fn(),
        onAttachmentFiles: vi.fn(),
        attachmentError: null,
        pastePreview: null,
        task: { id: 'task-1', metadata: { workspaceId: 'ws-1' } },
        slashCommands: {
            handleInputChange: vi.fn(),
            handleKeyDown: vi.fn(() => false),
            selectSkill: vi.fn(),
            dismissMenu: vi.fn(),
            menuVisible: false,
            menuFilter: '',
            filteredSkills: [],
            highlightIndex: 0,
        },
        ...overrides,
    };
}

describe('chat composer keyboard shortcuts', () => {
    it('cycles the NewChatArea reasoning-effort pill with Shift+Down and skips prompt history', () => {
        render(<NewChatArea workspaceId="ws-1" />);

        const input = screen.getByTestId('new-chat-input');
        expect(screen.getByTestId('effort-pill-selector').getAttribute('data-effort-value')).toBe('auto');

        fireEvent.keyDown(input, { key: 'ArrowDown', shiftKey: true });
        expect(screen.getByTestId('effort-pill-selector').getAttribute('data-effort-value')).toBe('low');

        fireEvent.keyDown(input, { key: 'ArrowDown', shiftKey: true });
        expect(screen.getByTestId('effort-pill-selector').getAttribute('data-effort-value')).toBe('high');
        expect(mockPromptHistoryHandleKeyDown).not.toHaveBeenCalled();
    });

    it('does not cycle NewChatArea effort while the model menu owns arrow navigation', () => {
        mockModelCommand.modelMenuVisible = true;
        mockModelCommand.handleModelKeyDown.mockReturnValue(true);
        render(<NewChatArea workspaceId="ws-1" />);

        fireEvent.keyDown(screen.getByTestId('new-chat-input'), { key: 'ArrowDown', shiftKey: true });

        expect(mockModelCommand.handleModelKeyDown).toHaveBeenCalled();
        expect(screen.getByTestId('effort-pill-selector').getAttribute('data-effort-value')).toBe('auto');
    });

    it('lets the NewChatArea model menu own Shift+Tab before mode cycling', () => {
        mockModelCommand.modelMenuVisible = true;
        mockModelCommand.filteredModels = mockModels.models;
        mockModelCommand.handleModelKeyDown.mockReturnValue(true);
        render(<NewChatArea workspaceId="ws-1" />);

        fireEvent.keyDown(screen.getByTestId('new-chat-input'), { key: 'Tab', shiftKey: true });

        expect(mockModelCommand.handleModelKeyDown).toHaveBeenCalled();
        expect(screen.getByTestId('mode-pill-ask').getAttribute('data-selected')).toBe('true');
        expect(screen.getByTestId('mode-pill-autopilot').getAttribute('data-selected')).toBe('false');
    });

    it('keeps NewChatArea Shift+Tab mode cycling from accepting autocomplete', () => {
        mockAutocomplete.completion = 'llo';
        mockAutocomplete.accept.mockReturnValue('hello');
        render(<NewChatArea workspaceId="ws-1" />);

        fireEvent.keyDown(screen.getByTestId('new-chat-input'), { key: 'Tab', shiftKey: true });

        expect(mockAutocomplete.accept).not.toHaveBeenCalled();
        expect(screen.getByTestId('mode-pill-ask').getAttribute('data-selected')).toBe('false');
        expect(screen.getByTestId('mode-pill-autopilot').getAttribute('data-selected')).toBe('true');
    });

    it('cycles NewChatArea provider with Ctrl+Down, persists it, and sends it in the queue payload', async () => {
        mockAgentProviders.providers = [
            { id: 'copilot', label: 'Copilot', enabled: true, available: true },
            { id: 'codex', label: 'Codex', enabled: true, available: false },
            { id: 'claude', label: 'Claude', enabled: true, available: true },
        ];
        render(<NewChatArea workspaceId="ws-1" />);
        await waitFor(() => expect(mockClient.preferences.getRepo).toHaveBeenCalledWith('ws-1'));

        const input = screen.getByTestId('new-chat-input');
        fireEvent.keyDown(input, { key: 'ArrowDown', ctrlKey: true });

        expect(screen.getByTestId('agent-selector-chip-btn').textContent).toContain('Claude');
        expect(mockClient.preferences.patchRepo).toHaveBeenCalledWith('ws-1', { lastChatProvider: 'claude' });

        await act(async () => {
            richTextProps['new-chat-input'].onChange('hello from shortcut', 'hello from shortcut'.length);
        });
        fireEvent.click(screen.getByTestId('new-chat-send-btn'));

        await waitFor(() => expect(mockClient.queue.enqueue).toHaveBeenCalled());
        expect(mockClient.queue.enqueue.mock.calls[0][0].payload.provider).toBe('claude');
    });

    it('cycles FollowUpInputArea legacy reasoning effort with Shift+Down before prompt history', () => {
        const onEffortChange = vi.fn();
        render(<FollowUpInputArea {...makeFollowUpProps({
            effortOverride: 'low',
            onEffortChange,
            effortOptions: [{ value: 'low', label: 'Low', title: 'Low', barClass: '', filled: 1 }, { value: 'high', label: 'High', title: 'High', barClass: '', filled: 3 }],
        })} />);

        fireEvent.keyDown(screen.getByTestId('activity-chat-input'), { key: 'ArrowDown', shiftKey: true });

        expect(onEffortChange).toHaveBeenCalledWith('high');
        expect(mockPromptHistoryHandleKeyDown).not.toHaveBeenCalled();
    });

    it('cycles FollowUpInputArea configured effort tiers and skips unconfigured tiers', () => {
        const onEffortTierChange = vi.fn();
        render(<FollowUpInputArea {...makeFollowUpProps({
            useEffortTierMode: true,
            selectedEffortTier: 'low',
            onEffortTierChange,
            effortTierMap: {
                low: { model: 'fast', reasoningEffort: '', source: 'config' },
                high: { model: 'deep', reasoningEffort: 'high', source: 'config' },
            },
        })} />);

        fireEvent.keyDown(screen.getByTestId('activity-chat-input'), { key: 'ArrowDown', shiftKey: true });

        expect(onEffortTierChange).toHaveBeenCalledWith('high');
    });

    it('leaves follow-up provider locked when Ctrl+Down is pressed', () => {
        const onEffortChange = vi.fn();
        render(<FollowUpInputArea {...makeFollowUpProps({
            activeProvider: 'claude',
            effortOverride: 'low',
            onEffortChange,
        })} />);

        fireEvent.keyDown(screen.getByTestId('activity-chat-input'), { key: 'ArrowDown', ctrlKey: true });

        expect(screen.getByTestId('agent-selector-chip-btn').textContent).toContain('Claude');
        expect(onEffortChange).not.toHaveBeenCalled();
    });

    it('continues to route unmodified arrows to prompt history', () => {
        render(<FollowUpInputArea {...makeFollowUpProps()} />);

        fireEvent.keyDown(screen.getByTestId('activity-chat-input'), { key: 'ArrowUp' });

        expect(mockPromptHistoryHandleKeyDown).toHaveBeenCalled();
    });

    it('keeps autocomplete Tab and Escape behavior ahead of later shortcut handling', () => {
        const setFollowUpInput = vi.fn();
        mockAutocomplete.completion = 'llo';
        mockAutocomplete.accept.mockReturnValue('hello');
        render(<FollowUpInputArea {...makeFollowUpProps({ followUpInput: 'he', setFollowUpInput })} />);

        const input = screen.getByTestId('activity-chat-input');
        fireEvent.keyDown(input, { key: 'Tab' });
        expect(mockAutocomplete.accept).toHaveBeenCalled();
        expect(setFollowUpInput).toHaveBeenCalledWith('hello');

        fireEvent.keyDown(input, { key: 'Escape' });
        expect(mockAutocomplete.dismiss).toHaveBeenCalled();
    });

    it('keeps Shift+Tab mode cycling unchanged', () => {
        const setSelectedMode = vi.fn();
        render(<FollowUpInputArea {...makeFollowUpProps({ selectedMode: 'ask', setSelectedMode })} />);

        fireEvent.keyDown(screen.getByTestId('activity-chat-input'), { key: 'Tab', shiftKey: true });

        expect(setSelectedMode).toHaveBeenCalledWith('autopilot');
    });
});
