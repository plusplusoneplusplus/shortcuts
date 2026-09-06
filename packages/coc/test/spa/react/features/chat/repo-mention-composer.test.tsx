/**
 * @vitest-environment jsdom
 *
 * Composer integration for `#repo_name` mentions in `NewChatArea` (AC-01..03).
 *
 * The pure core is covered by `repo-mentions.test.tsx`; this file exercises the
 * wiring: the workspace gate, the keyboard-priority slot, and the plain-text
 * insert that reaches `RichTextInput.setValue`.
 */
import { fireEvent, render, screen, act } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentProviderStatus } from '@plusplusoneplusplus/coc-client';

const {
    richTextProps,
    mockGroupMembers,
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
        mockGroupMembers: { value: undefined as any },
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
            cronEnabled: false,
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

vi.mock('../../../../../src/server/spa/client/react/shared/RichTextInput', async () => {
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

vi.mock('../../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => mockClient,
    getSpaCocClientErrorMessage: (_error: unknown, fallback: string) => fallback,
}));

vi.mock('../../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ state: {}, dispatch: mockQueueDispatch }),
}));

vi.mock('../../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({ state: mockAppState, dispatch: vi.fn() }),
}));

vi.mock('../../../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => '/api',
    getConfig: () => ({ apiBasePath: '/api' }),
    isRalphEnabled: () => mockConfig.ralphEnabled,
    isForEachEnabled: () => mockConfig.forEachEnabled,
    isMapReduceEnabled: () => false,
    isCronEnabled: () => mockConfig.cronEnabled,
    isCodexEnabled: () => false,
    getDefaultProvider: () => mockConfig.defaultProvider,
    getConfiguredDefaultProvider: () => mockConfig.defaultProvider,
    getActiveProvider: () => mockConfig.defaultProvider,
    isAutoAgentProviderRoutingEnabled: () => false,
    isEffortLevelsEnabled: () => mockConfig.effortLevelsEnabled,
    isChatStyleSelectorEnabled: () => false,
    getDefaultChatStyle: () => 'default',
    DASHBOARD_CONFIG_UPDATED_EVENT: 'dashboard-config-updated',
    isSessionContextAttachmentsEnabled: () => mockConfig.sessionContextAttachmentsEnabled,
    getPrewarmDebounceMs: () => 500,
    getWarmClientTtlMs: () => 300000,
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/useAgentProviders', () => ({
    useAgentProviders: () => mockAgentProviders,
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/useModels', () => ({
    useModels: () => mockModels,
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/useDefaultModelForMode', () => ({
    useDefaultModelForMode: () => mockDefaultModel,
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/useProviderReasoningEfforts', () => ({
    useProviderReasoningEfforts: () => mockReasoningEfforts,
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/useProviderEffortTiers', () => ({
    useProviderEffortTiers: () => mockEffortTiers,
}));

vi.mock('../../../../../src/server/spa/client/react/features/chat/hooks/useSlashCommands', () => ({
    useSlashCommands: () => mockSlashCommands,
}));

vi.mock('../../../../../src/server/spa/client/react/features/chat/hooks/useModelCommand', () => ({
    useModelCommand: () => mockModelCommand,
    selectPickableModels: (models: any[]) => models.filter(model => model.enabled !== false),
}));

vi.mock('../../../../../src/server/spa/client/react/features/chat/SlashCommandMenu', () => ({
    SlashCommandMenu: () => null,
    META_SKILL_ITEMS: [],
    getMetaSkillItems: () => [],
    mergeSkillsWithMeta: (skills: any[]) => skills,
}));

vi.mock('../../../../../src/server/spa/client/react/features/chat/ModelCommandMenu', () => ({
    ModelCommandMenu: () => null,
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/usePromptAutocompleteEnabled', () => ({
    usePromptAutocompleteEnabled: () => true,
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/usePromptAutocomplete', () => ({
    usePromptAutocomplete: () => mockAutocomplete,
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/useChatPromptHistory', () => ({
    useChatPromptHistory: () => ({
        handleKeyDown: mockPromptHistoryHandleKeyDown,
        reset: mockPromptHistoryReset,
    }),
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/useOnboardingPreferences', () => ({
    useOnboardingPreferences: () => ({ updateOnboarding: vi.fn().mockResolvedValue(undefined) }),
}));

vi.mock('../../../../../src/server/spa/client/react/features/chat/hooks/useFileAttachments', () => ({
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

vi.mock('../../../../../src/server/spa/client/react/features/chat/hooks/useAttachedContext', () => ({
    formatAttachedContext: () => '',
    useAttachedContext: () => ({
        items: [],
        getItems: () => [],
        addSessionContext: vi.fn(),
        remove: vi.fn(),
        clear: mockAttachedContextClear,
    }),
}));

vi.mock('../../../../../src/server/spa/client/react/repos/useRepoGroupMembers', () => ({
    useRepoGroupMembers: (_workspaceId: string, _baseUrl: string | undefined, enabled: boolean) =>
        (enabled ? mockGroupMembers.value : undefined),
}));

vi.mock('../../../../../src/server/spa/client/react/features/chat/sessionContextDrop', () => ({
    dataTransferHasSessionContext: () => false,
    readSessionContextDropPayload: () => null,
    useConversationRetrievalCapability: () => false,
    validateSessionContextAttachmentsForSend: () => null,
    validateSessionContextDrop: () => ({ ok: false, error: 'not mocked' }),
}));


import { NewChatArea } from '../../../../../src/server/spa/client/react/features/chat/NewChatArea';

function member(name: string, extra: Record<string, any> = {}) {
    return { workspaceId: `ws-${name}`, stale: false, name, ...extra };
}

const GROUP = [member('alpha'), member('beta', { description: 'the beta repo' }), member('gamma')];

beforeEach(() => {
    vi.clearAllMocks();
    // jsdom does not implement scrollIntoView; the menu calls it to keep the
    // highlighted row in view.
    Element.prototype.scrollIntoView = vi.fn();
    for (const key of Object.keys(richTextProps)) delete richTextProps[key];
    tracker.calls = [];
    tracker.domValue = '';
    mockGroupMembers.value = GROUP;
    mockClient.skills.listAllWorkspace.mockResolvedValue({ merged: [] });
    mockClient.preferences.getRepo.mockResolvedValue({});
    mockClient.preferences.patchRepo.mockResolvedValue({});
    mockConfig.effortLevelsEnabled = false;
    mockConfig.defaultProvider = 'copilot';
    mockAgentProviders.loading = false;
    mockModels.loading = false;
    mockSlashCommands.menuVisible = false;
    mockSlashCommands.filteredSkills = [];
    mockSlashCommands.handleKeyDown.mockReturnValue(false);
    mockSlashCommands.parseAndExtract.mockImplementation((prompt: string) => ({ skills: [], prompt }));
    mockModelCommand.modelMenuVisible = false;
    mockModelCommand.handleModelKeyDown.mockReturnValue(false);
    mockPromptHistoryHandleKeyDown.mockReturnValue(false);
    mockAutocomplete.completion = null;
    localStorage.clear();
});

/** Drive the composer's onChange the way RichTextInput would. */
function type(text: string, cursor = text.length) {
    act(() => { richTextProps['new-chat-input'].onChange(text, cursor); });
}

describe('NewChatArea #repo mentions', () => {
    it('opens the picker on a word-boundary # inside a repo group', () => {
        render(<NewChatArea workspaceId="group-demo" />);
        expect(screen.queryByTestId('repo-mention-menu')).toBeNull();

        type('#');

        expect(screen.getByTestId('repo-mention-menu')).toBeTruthy();
        expect(screen.getByTestId('repo-mention-item-alpha')).toBeTruthy();
        expect(screen.getByTestId('repo-mention-item-beta')).toBeTruthy();
        expect(screen.getByTestId('repo-mention-item-gamma')).toBeTruthy();
    });

    it('does not open on a # that is not at a word boundary', () => {
        render(<NewChatArea workspaceId="group-demo" />);
        type('issue#12');
        expect(screen.queryByTestId('repo-mention-menu')).toBeNull();
        type('abc#');
        expect(screen.queryByTestId('repo-mention-menu')).toBeNull();
    });

    it('does nothing new outside a repo-group workspace', () => {
        render(<NewChatArea workspaceId="ws-1" />);
        type('#');
        expect(screen.queryByTestId('repo-mention-menu')).toBeNull();
    });

    it('stays closed while the group membership is still loading', () => {
        mockGroupMembers.value = undefined;
        render(<NewChatArea workspaceId="group-demo" />);
        type('#');
        expect(screen.queryByTestId('repo-mention-menu')).toBeNull();
    });

    it('narrows the list as the filter is typed and closes on no match', () => {
        render(<NewChatArea workspaceId="group-demo" />);
        type('#');
        type('#be');

        expect(screen.getByTestId('repo-mention-item-beta')).toBeTruthy();
        expect(screen.queryByTestId('repo-mention-item-alpha')).toBeNull();
        expect(screen.queryByTestId('repo-mention-item-gamma')).toBeNull();

        type('#bezzz');
        expect(screen.queryByTestId('repo-mention-menu')).toBeNull();
    });

    it('closes on Escape and leaves the # in the text', () => {
        render(<NewChatArea workspaceId="group-demo" />);
        type('#');
        fireEvent.keyDown(screen.getByTestId('new-chat-input'), { key: 'Escape' });

        expect(screen.queryByTestId('repo-mention-menu')).toBeNull();
        expect(tracker.calls).toEqual([]);
    });

    it('inserts plain "#name " and places the caret after the space on Enter', () => {
        render(<NewChatArea workspaceId="group-demo" />);
        type('look at #be');
        fireEvent.keyDown(screen.getByTestId('new-chat-input'), { key: 'Enter' });

        expect(tracker.calls).toEqual([['look at #beta ', 'look at #beta '.length]]);
    });

    it('inserts on click without changing anything else about the composer', () => {
        render(<NewChatArea workspaceId="group-demo" />);
        type('#');
        fireEvent.mouseDown(screen.getByTestId('repo-mention-item-gamma'));

        expect(tracker.calls).toEqual([['#gamma ', '#gamma '.length]]);
        expect(screen.queryByTestId('repo-mention-menu')).toBeNull();
    });

    it('supports a second mention in the same message', () => {
        render(<NewChatArea workspaceId="group-demo" />);
        type('#al');
        fireEvent.keyDown(screen.getByTestId('new-chat-input'), { key: 'Tab' });
        type('#alpha and #ga');
        fireEvent.keyDown(screen.getByTestId('new-chat-input'), { key: 'Tab' });

        expect(tracker.calls.at(-1)).toEqual(['#alpha and #gamma ', '#alpha and #gamma '.length]);
    });

    it('leaves the model menu ahead of the repo menu in the keyboard chain', () => {
        mockModelCommand.modelMenuVisible = true;
        mockModelCommand.handleModelKeyDown.mockReturnValue(true);
        render(<NewChatArea workspaceId="group-demo" />);
        type('#');

        fireEvent.keyDown(screen.getByTestId('new-chat-input'), { key: 'ArrowDown' });

        expect(mockModelCommand.handleModelKeyDown).toHaveBeenCalled();
        expect(tracker.calls).toEqual([]);
    });

    it('leaves the slash menu ahead of the repo menu in the keyboard chain', () => {
        mockSlashCommands.menuVisible = true;
        mockSlashCommands.handleKeyDown.mockReturnValue(true);
        render(<NewChatArea workspaceId="group-demo" />);
        type('#');

        fireEvent.keyDown(screen.getByTestId('new-chat-input'), { key: 'Enter' });

        expect(mockSlashCommands.handleKeyDown).toHaveBeenCalled();
        expect(tracker.calls).toEqual([]);
    });

    it('marks a stale member in the list', () => {
        mockGroupMembers.value = [member('alpha', { stale: true })];
        render(<NewChatArea workspaceId="group-demo" />);
        type('#');
        expect(screen.getByTestId('repo-mention-stale')).toBeTruthy();
    });
});
