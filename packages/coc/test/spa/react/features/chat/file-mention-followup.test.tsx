/**
 * @vitest-environment jsdom
 *
 * Composer integration for file mentions in `FollowUpInputArea` (AC-06) — the
 * second composer surface, alongside `file-mention-composer.test.tsx` which
 * covers `NewChatArea`.
 *
 * Beyond the same trigger/search/accept contract, this surface is controlled:
 * the parent owns `followUpInput`, and a value-sync effect pushes programmatic
 * changes back into the editor. The accept must set `skipNextSyncRef` so that
 * effect does not clobber the caret position it just placed.
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
    mockSearchFiles,
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
        mockSearchFiles: vi.fn(),
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

// `buildFilePathInsertion` must stay real — the backticked text it produces is
// exactly what the accept path shares with file drops.
vi.mock('../../../../../src/server/spa/client/react/features/chat/sessionContextDrop', async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    dataTransferHasSessionContext: () => false,
    readSessionContextDropPayload: () => null,
    useConversationRetrievalCapability: () => false,
    validateSessionContextAttachmentsForSend: () => null,
    validateSessionContextDrop: () => ({ ok: false, error: 'not mocked' }),
}));

vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi', () => ({
    explorerApi: { searchFiles: mockSearchFiles },
}));

import { FollowUpInputArea } from '../../../../../src/server/spa/client/react/features/chat/FollowUpInputArea';
import type { FollowUpInputAreaProps } from '../../../../../src/server/spa/client/react/features/chat/FollowUpInputArea';
import type { RichTextInputHandle } from '../../../../../src/server/spa/client/react/shared/RichTextInput';
import { splitFilePathPills } from '../../../../../src/server/spa/client/react/shared/richTextPills';

function member(name: string, extra: Record<string, any> = {}) {
    return { workspaceId: `ws-${name}`, stale: false, name, ...extra };
}

const GROUP = [member('alpha'), member('beta')];

/** `src/foo.ts` in alpha outranks `src/foobar.ts` in beta on score. */
const ALPHA_HITS = [{ path: 'src/foo.ts', score: 90, indices: [0, 1, 2, 3, 4, 5] }];
const BETA_HITS = [{ path: 'src/foobar.ts', score: 80, indices: [0, 1, 2, 3, 4, 5] }];

/**
 * Stateful host for the controlled composer. `setFollowUpInput` also updates the
 * fake editor's DOM value, mirroring the real `RichTextInput` where the typed
 * text is already in the DOM by the time the value-sync effect runs.
 */
function Host({ overrides = {} }: { overrides?: Partial<FollowUpInputAreaProps> }) {
    const [value, setValue] = React.useState('');
    const richTextRef = React.useRef<RichTextInputHandle>(null);
    return (
        <FollowUpInputArea
            {...({
                richTextRef,
                inputDisabled: false,
                sending: false,
                isActiveGeneration: false,
                isCancelling: false,
                error: null,
                resumeFeedback: null,
                suggestions: [],
                followUpInput: value,
                setFollowUpInput: setValue,
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
                slashCommands: mockSlashCommands,
                modelCommand: mockModelCommand,
                workspaceId: 'group-demo',
                ...overrides,
            } as unknown as FollowUpInputAreaProps)}
        />
    );
}

function renderFollowUp(overrides: Partial<FollowUpInputAreaProps> = {}) {
    return render(<Host overrides={overrides} />);
}

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
    mockSlashCommands.activeCommandHint = null;
    mockSlashCommands.handleKeyDown.mockReturnValue(false);
    mockModelCommand.modelMenuVisible = false;
    mockModelCommand.filteredModels = [];
    mockModelCommand.handleModelKeyDown.mockReturnValue(false);
    mockPromptHistoryHandleKeyDown.mockReturnValue(false);
    mockAutocomplete.completion = null;
    mockAutocomplete.accept.mockReturnValue('');
    mockSearchFiles.mockImplementation((workspaceId: string) => Promise.resolve({
        results: workspaceId === 'ws-alpha' ? ALPHA_HITS : BETA_HITS,
    }));
    localStorage.clear();
});

/** Drive the composer's onChange the way RichTextInput would. */
function type(text: string, cursor = text.length) {
    act(() => {
        tracker.domValue = text;
        richTextProps['activity-chat-input'].onChange(text, cursor);
    });
}

function editor() {
    return screen.getByTestId('activity-chat-input');
}

/** Type an explicit file mention and wait out the search debounce. */
async function typeAndOpen(text: string) {
    type(text);
    await screen.findByTestId('file-mention-menu');
}

/** Let the 40ms debounce elapse without a menu appearing. */
async function settle() {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 60)); });
}

describe('FollowUpInputArea file mentions', () => {
    it('opens on an @ path token with merged, repo-labelled results', async () => {
        renderFollowUp();
        expect(screen.queryByTestId('file-mention-menu')).toBeNull();

        await typeAndOpen('@src/fo');

        expect(mockSearchFiles.mock.calls.map(call => call[0]).sort()).toEqual(['ws-alpha', 'ws-beta']);
        expect(screen.getByTestId('file-mention-name-0').textContent).toContain('foo.ts');
        expect(screen.getByTestId('file-mention-repo-0').textContent).toBe('alpha');
        expect(screen.getByTestId('file-mention-name-1').textContent).toContain('foobar.ts');
        expect(screen.getByTestId('file-mention-repo-1').textContent).toBe('beta');
    });

    it('never opens on a bare prose word', async () => {
        renderFollowUp();
        type('index');
        await settle();

        expect(screen.queryByTestId('file-mention-menu')).toBeNull();
        expect(mockSearchFiles).not.toHaveBeenCalled();
    });

    it('never opens on a bare path-shaped token', async () => {
        renderFollowUp();
        type('src/fo');
        await settle();

        expect(screen.queryByTestId('file-mention-menu')).toBeNull();
        expect(mockSearchFiles).not.toHaveBeenCalled();
    });

    it('replaces the token with a backticked path on Tab after ArrowDown', async () => {
        renderFollowUp();
        await typeAndOpen('@src/fo');

        fireEvent.keyDown(editor(), { key: 'ArrowDown' });
        fireEvent.keyDown(editor(), { key: 'Tab' });

        expect(tracker.calls).toEqual([['`src/foobar.ts` ', '`src/foobar.ts` '.length]]);
        // The controlled value the parent holds tracks the insert, and the
        // value-sync effect did not echo it back through a second setValue.
        expect(richTextProps['activity-chat-input'].value).toBe('`src/foobar.ts` ');
    });

    it('renders the accepted path as a pill in the composer overlay', async () => {
        renderFollowUp();
        await typeAndOpen('@src/fo');
        fireEvent.keyDown(editor(), { key: 'ArrowDown' });
        fireEvent.keyDown(editor(), { key: 'Tab' });

        // The overlay draws the pill; the composer only has to opt in and hand
        // it text the splitter recognises as a path.
        expect(richTextProps['activity-chat-input'].pillPaths).toBe(true);
        expect(splitFilePathPills(richTextProps['activity-chat-input'].value)).toEqual([
            { text: '`src/foobar.ts`', pill: true },
            { text: ' ', pill: false },
        ]);
    });

    it('drops the @ sigil when the token was @-prefixed', async () => {
        renderFollowUp();
        await typeAndOpen('look at @src/fo');

        fireEvent.keyDown(editor(), { key: 'Tab' });

        expect(tracker.calls).toEqual([['look at `src/foo.ts` ', 'look at `src/foo.ts` '.length]]);
    });

    it('inserts on click', async () => {
        renderFollowUp();
        await typeAndOpen('@src/fo');

        fireEvent.mouseDown(screen.getByTestId('file-mention-item-1'));

        expect(tracker.calls).toEqual([['`src/foobar.ts` ', '`src/foobar.ts` '.length]]);
        expect(screen.queryByTestId('file-mention-menu')).toBeNull();
    });

    it('suppresses ghost text while the popup is open, and Tab does not accept it', async () => {
        mockAutocomplete.completion = ' and the rest';
        renderFollowUp();
        await typeAndOpen('@src/fo');

        expect(richTextProps['activity-chat-input'].ghostText).toBeUndefined();

        fireEvent.keyDown(editor(), { key: 'Tab' });

        expect(mockAutocomplete.accept).not.toHaveBeenCalled();
        expect(tracker.calls).toEqual([['`src/foo.ts` ', '`src/foo.ts` '.length]]);
    });

    it('does not send on Enter while the popup is open', async () => {
        const onSend = vi.fn().mockResolvedValue(undefined);
        renderFollowUp({ onSend });
        await typeAndOpen('@src/fo');

        fireEvent.keyDown(editor(), { key: 'Enter' });

        expect(onSend).not.toHaveBeenCalled();
        expect(tracker.calls).toEqual([['`src/foo.ts` ', '`src/foo.ts` '.length]]);
    });

    it('leaves the slash menu ahead of the file popup in the keyboard chain', async () => {
        renderFollowUp();
        await typeAndOpen('@src/fo');

        mockSlashCommands.menuVisible = true;
        mockSlashCommands.handleKeyDown.mockReturnValue(true);
        type('@src/fo');
        fireEvent.keyDown(editor(), { key: 'Tab' });

        expect(mockSlashCommands.handleKeyDown).toHaveBeenCalled();
        expect(tracker.calls).toEqual([]);
    });

    it('leaves the model menu ahead of the file popup in the keyboard chain', async () => {
        renderFollowUp();
        await typeAndOpen('@src/fo');

        mockModelCommand.modelMenuVisible = true;
        mockModelCommand.handleModelKeyDown.mockReturnValue(true);
        type('@src/fo');
        fireEvent.keyDown(editor(), { key: 'ArrowDown' });

        expect(mockModelCommand.handleModelKeyDown).toHaveBeenCalled();
        expect(tracker.calls).toEqual([]);
    });

    it('still accepts ghost text on Tab when the popup is closed', async () => {
        mockAutocomplete.completion = ' world';
        mockAutocomplete.accept.mockReturnValue('hello world');
        renderFollowUp();
        type('hello');
        await settle();

        expect(screen.queryByTestId('file-mention-menu')).toBeNull();
        expect(richTextProps['activity-chat-input'].ghostText).toBe(' world');

        fireEvent.keyDown(editor(), { key: 'Tab' });

        expect(mockAutocomplete.accept).toHaveBeenCalled();
        expect(tracker.calls).toEqual([['hello world', 'hello world'.length]]);
    });

    it('closes on Escape and leaves the typed token alone', async () => {
        renderFollowUp();
        await typeAndOpen('@src/fo');

        fireEvent.keyDown(editor(), { key: 'Escape' });

        expect(screen.queryByTestId('file-mention-menu')).toBeNull();
        expect(tracker.calls).toEqual([]);
    });

    it('stays closed outside a repo group when the workspace is unknown', async () => {
        mockGroupMembers.value = undefined;
        renderFollowUp({ workspaceId: undefined });
        type('src/fo');
        await settle();

        expect(screen.queryByTestId('file-mention-menu')).toBeNull();
        expect(mockSearchFiles).not.toHaveBeenCalled();
    });

    it('sends the accepted mention as backticked plain text', async () => {
        const onSend = vi.fn().mockResolvedValue(undefined);
        renderFollowUp({ onSend });
        await typeAndOpen('look at @src/fo');
        fireEvent.keyDown(editor(), { key: 'Tab' });

        expect(screen.queryByTestId('file-mention-menu')).toBeNull();
        expect(richTextProps['activity-chat-input'].value).toBe('look at `src/foo.ts` ');

        fireEvent.keyDown(editor(), { key: 'Enter' });
        expect(onSend).toHaveBeenCalledTimes(1);
    });
});
