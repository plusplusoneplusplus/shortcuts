/**
 * @vitest-environment jsdom
 *
 * Tests for the provider-first composer ordering in NewChatArea and
 * FollowUpInputArea. Verifies that the toolbar reads left-to-right as:
 *
 *   provider · | · mode · | · model · …spacer… · tools · | · send
 *
 * Dividers are rendered between ownership zones so the bar visually
 * separates "who's running this" (provider/mode/model) from "what I'm
 * adding to it" (tools) from the terminal send action.
 *
 * This is a pure UI-layout test and does not exercise any business logic
 * beyond rendering.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks – declared before importing components under test
// ---------------------------------------------------------------------------

let mockDefaultProvider: 'copilot' | 'codex' | 'claude' = 'copilot';
const mockAgentProviders = [
    { id: 'copilot', label: 'Copilot', enabled: true, available: true, locked: true },
    { id: 'codex', label: 'Codex', enabled: true, available: true },
    { id: 'claude', label: 'Claude', enabled: true, available: true },
];

vi.mock('../../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({
        state: { selectedTaskIdByRepo: {} },
        dispatch: vi.fn(),
    }),
}));

vi.mock('../../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({
        state: {
            workspaces: [{ id: 'ws-1', rootPath: '/repos/myrepo' }],
            onboardingProgress: { hasUsedChat: false },
        },
        dispatch: vi.fn(),
    }),
}));

vi.mock('../../../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => 'http://localhost:4000/api',
    isRalphEnabled: () => false,
    isForEachEnabled: () => false,
    isMapReduceEnabled: () => false,
    isLoopsEnabled: () => false,
    getDefaultProvider: () => mockDefaultProvider,
    isEffortLevelsEnabled: () => false,
    isSessionContextAttachmentsEnabled: () => false,
}));

vi.mock('../../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        queue: { enqueue: vi.fn().mockResolvedValue({ task: { id: 'queue_123' } }) },
        preferences: {
            patchGlobal: vi.fn().mockResolvedValue({}),
            getRepo: vi.fn().mockResolvedValue({}),
            patchRepo: vi.fn().mockResolvedValue({}),
        },
        skills: { listAllWorkspace: vi.fn().mockResolvedValue({ merged: [] }) },
        agentProviders: { list: vi.fn().mockResolvedValue({ providers: mockAgentProviders }), getReasoningEfforts: vi.fn().mockResolvedValue({ reasoningEfforts: {} }),
            getEffortTiers: vi.fn().mockResolvedValue({ effortTiers: {} }) },
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
    RichTextInput: vi.fn().mockImplementation(({ onChange, onKeyDown, placeholder, disabled, ...rest }: any) => (
        <input
            data-testid={rest['data-testid'] ?? 'rich-text-input'}
            placeholder={placeholder}
            disabled={disabled}
            onChange={(e) => onChange?.(e.target.value)}
            onKeyDown={onKeyDown}
        />
    )),
}));

vi.mock('../../../../../src/server/spa/client/react/ui/AttachmentPreviews', () => ({
    AttachmentPreviews: () => null,
}));

vi.mock('../../../../../src/server/spa/client/react/ui/PastePreview', () => ({
    PastePreview: () => null,
}));

vi.mock('../../../../../src/server/spa/client/react/ui/AttachedContextPreviews', () => ({
    AttachedContextPreviews: () => null,
}));

vi.mock('../../../../../src/server/spa/client/react/ui', () => ({
    Button: ({ children, ...rest }: any) => <button {...rest}>{children}</button>,
    SuggestionChips: () => null,
    SendButton: ({ disabled, onSend, ...rest }: any) => (
        <button
            data-testid={rest['data-testid'] ?? 'activity-chat-send-btn'}
            disabled={disabled}
            onClick={() => onSend('enqueue')}
        >
            Send
        </button>
    ),
    QueueFollowUpButton: ({ disabled, onSend, label, ...rest }: any) => (
        <button
            data-testid={rest['data-testid'] ?? 'activity-chat-send-btn'}
            disabled={disabled}
            onClick={() => onSend('enqueue')}
        >
            {label ?? 'Send'}
        </button>
    ),
}));

vi.mock('../../../../../src/server/spa/client/react/repos/modeConfig', () => ({
    MODE_BORDER_COLORS: {
        autopilot: { border: '', ring: '' },
        ask: { border: '', ring: '' },
        plan: { border: '', ring: '' },
    },
    MODE_ICONS: { ask: '?', plan: 'P', autopilot: 'A' },
    MODE_LABELS: { ask: 'Ask', plan: 'Plan', autopilot: 'Autopilot' },
    MODE_TOOLTIPS: { ask: 'Ask', plan: 'Plan', autopilot: 'Autopilot' },
    cycleMode: (m: string) => m,
}));

vi.mock('../../../../../src/server/spa/client/react/ui/cn', () => ({
    cn: (...classes: any[]) => classes.filter(Boolean).join(' '),
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/useModels', () => ({
    useModels: () => ({ models: [], loading: false, error: null, reload: vi.fn() }),
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
        modelMenuVisible: false,
        modelFilter: '',
        filteredModels: [],
        modelHighlightIndex: 0,
        modelOverride: null,
        setModelOverride: vi.fn(),
        handleModelSelect: vi.fn(),
        showModelMenu: vi.fn(),
        dismissModelMenu: vi.fn(),
        handleModelKeyDown: vi.fn(() => false),
        setModelFilter: vi.fn(),
    }),
    selectPickableModels: (models: unknown[]) => models,
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/useDefaultModelForMode', () => ({
    useDefaultModelForMode: () => ({ effectiveModel: undefined, effectiveModelName: undefined }),
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

vi.mock('../../../../../src/server/spa/client/react/features/chat/ModePillSelector', () => ({
    ModePillSelector: ({ value }: any) => <div data-testid="mode-pill-mock">{value}</div>,
    DEFAULT_MODE_PILL_OPTIONS: [
        { value: 'ask', label: 'Ask' },
        { value: 'plan', label: 'Plan' },
        { value: 'autopilot', label: 'Autopilot' },
    ],
    RALPH_MODE_PILL_OPTION: { value: 'ralph', label: 'Ralph' },
    getVisibleModePillOptions: () => [
        { value: 'ask', label: 'Ask', dotClass: 'bg-yellow-500' },
        { value: 'autopilot', label: 'Autopilot', dotClass: 'bg-green-500' },
    ],
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/ui/useModifierKey', () => ({
    useModifierKey: () => false,
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/usePromptAutocomplete', () => ({
    usePromptAutocomplete: () => ({ completion: null, accept: () => '', dismiss: vi.fn() }),
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/usePromptAutocompleteEnabled', () => ({
    usePromptAutocompleteEnabled: () => false,
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/useChatPromptHistory', () => ({
    useChatPromptHistory: () => ({ handleKeyDown: () => false, reset: vi.fn() }),
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/useOnboardingPreferences', () => ({
    useOnboardingPreferences: () => ({ updateOnboarding: vi.fn().mockResolvedValue(undefined) }),
}));

vi.mock('../../../../../src/server/spa/client/react/features/chat/hooks/useDraftStore', () => ({
    getDraft: () => null,
    setDraft: vi.fn(),
    clearDraft: vi.fn(),
    newChatDraftKey: (ws?: string) => `nc:${ws ?? '__global__'}`,
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/useAgentProviders', () => ({
    useAgentProviders: () => ({ providers: mockAgentProviders, loading: false, error: null, refresh: vi.fn() }),
}));

vi.mock('@plusplusoneplusplus/forge', () => ({}));

import { NewChatArea } from '../../../../../src/server/spa/client/react/features/chat/NewChatArea';
import { FollowUpInputArea } from '../../../../../src/server/spa/client/react/features/chat/FollowUpInputArea';
import { createRef } from 'react';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns the index of `el` among the direct children of its parent. */
function indexInParent(el: Element | null): number {
    if (!el || !el.parentElement) return -1;
    return Array.from(el.parentElement.children).indexOf(el);
}

function defaultFollowUpProps(overrides: Partial<Parameters<typeof FollowUpInputArea>[0]> = {}) {
    return {
        richTextRef: createRef<any>(),
        inputDisabled: false,
        sending: false,
        isActiveGeneration: false,
        isCancelling: false,
        error: null,
        resumeFeedback: null,
        suggestions: [],
        followUpInput: '',
        setFollowUpInput: vi.fn(),
        selectedMode: 'ask' as const,
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
        task: null,
        slashCommands: {
            handleInputChange: vi.fn(),
            handleKeyDown: vi.fn().mockReturnValue(false),
            selectSkill: vi.fn(),
            dismissMenu: vi.fn(),
            menuVisible: false,
            menuFilter: '',
            filteredSkills: [],
            highlightIndex: 0,
        },
        modelCommand: {
            modelMenuVisible: false,
            modelFilter: '',
            filteredModels: [],
            modelHighlightIndex: 0,
            modelOverride: null,
            setModelOverride: vi.fn(),
            handleModelSelect: vi.fn(),
            showModelMenu: vi.fn(),
            dismissModelMenu: vi.fn(),
            handleModelKeyDown: vi.fn(() => false),
            setModelFilter: vi.fn(),
        },
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Composer provider-first ordering', () => {
    beforeEach(() => {
        mockDefaultProvider = 'copilot';
    });

    describe('NewChatArea toolbar', () => {
        it('renders the agent selector chip before the mode pill', () => {
            render(<NewChatArea workspaceId="ws-1" />);
            const provider = screen.getByTestId('agent-selector-chip-container');
            const mode = screen.getByTestId('mode-selector');
            // Both live as direct children of the toolbar flex row.
            expect(provider.parentElement).toBe(mode.parentElement);
            expect(indexInParent(provider)).toBeLessThan(indexInParent(mode));
        });

        it('renders a divider between provider and mode zones', () => {
            render(<NewChatArea workspaceId="ws-1" />);
            const provider = screen.getByTestId('agent-selector-chip-container');
            const divider = screen.getByTestId('chat-toolbar-divider-provider');
            const mode = screen.getByTestId('mode-selector');
            expect(indexInParent(provider)).toBeLessThan(indexInParent(divider));
            expect(indexInParent(divider)).toBeLessThan(indexInParent(mode));
        });

        it('renders a divider between mode and model zones', () => {
            render(<NewChatArea workspaceId="ws-1" />);
            const mode = screen.getByTestId('mode-selector');
            const divider = screen.getByTestId('chat-toolbar-divider-mode');
            // Compare the chip's container (direct toolbar child) rather than
            // the nested button, because the chip is wrapped in a relative
            // div to anchor its dropdown.
            const modelContainer = screen.getByTestId('model-picker-chip-container');
            expect(indexInParent(mode)).toBeLessThan(indexInParent(divider));
            expect(indexInParent(divider)).toBeLessThan(indexInParent(modelContainer));
        });

        it('renders slash/mention/attach buttons after the model picker (tools-on-the-right zone)', () => {
            render(<NewChatArea workspaceId="ws-1" />);
            const model = screen.getByTestId('model-picker-chip');
            const slash = screen.getByTestId('chat-toolbar-slash-btn');
            const mention = screen.getByTestId('chat-toolbar-mention-btn');
            const attach = screen.getByTestId('new-chat-attach-btn');
            expect(indexInParent(model)).toBeLessThan(indexInParent(slash));
            expect(indexInParent(slash)).toBeLessThan(indexInParent(mention));
            expect(indexInParent(mention)).toBeLessThan(indexInParent(attach));
        });

        it('renders a divider between the tools zone and the send button', () => {
            render(<NewChatArea workspaceId="ws-1" />);
            const attach = screen.getByTestId('new-chat-attach-btn');
            const divider = screen.getByTestId('chat-toolbar-divider-send');
            const send = screen.getByTestId('new-chat-send-btn');
            expect(indexInParent(attach)).toBeLessThan(indexInParent(divider));
            expect(indexInParent(divider)).toBeLessThan(indexInParent(send));
        });

        it('renders the effort pill after the model picker and before the tools zone', () => {
            render(<NewChatArea workspaceId="ws-1" />);
            const model = screen.getByTestId('model-picker-chip');
            const effort = screen.getByTestId('effort-pill-selector');
            const slash = screen.getByTestId('chat-toolbar-slash-btn');
            expect(indexInParent(model)).toBeLessThan(indexInParent(effort));
            expect(indexInParent(effort)).toBeLessThan(indexInParent(slash));
        });

        it('renders the effort pill in the unselected (auto) state by default', () => {
            render(<NewChatArea workspaceId="ws-1" />);
            const effort = screen.getByTestId('effort-pill-selector');
            expect(effort.getAttribute('data-effort-value')).toBe('auto');
            const trigger = screen.getByTestId('effort-pill-trigger-btn');
            expect(trigger.textContent).toContain('Auto');
            expect(trigger.getAttribute('aria-expanded')).toBe('false');
        });
    });

    describe('FollowUpInputArea stacked toolbar', () => {
        it('renders the mode pill before the model picker', () => {
            render(<FollowUpInputArea {...defaultFollowUpProps()} />);
            const mode = screen.getByTestId('mode-selector');
            // Compare the chip's container (direct toolbar child) rather than
            // the nested button, because the chip is wrapped in a relative
            // div to anchor its dropdown.
            const modelContainer = screen.getByTestId('model-picker-chip-container');
            expect(indexInParent(mode)).toBeLessThan(indexInParent(modelContainer));
        });

        it('renders a divider between mode and model zones', () => {
            render(<FollowUpInputArea {...defaultFollowUpProps()} />);
            const mode = screen.getByTestId('mode-selector');
            const divider = screen.getByTestId('chat-toolbar-divider-mode');
            // Compare the chip's container (direct toolbar child) rather than
            // the nested button, because the chip is wrapped in a relative
            // div to anchor its dropdown.
            const modelContainer = screen.getByTestId('model-picker-chip-container');
            expect(indexInParent(mode)).toBeLessThan(indexInParent(divider));
            expect(indexInParent(divider)).toBeLessThan(indexInParent(modelContainer));
        });

        it('renders slash/mention/attach buttons after the model picker', () => {
            render(<FollowUpInputArea {...defaultFollowUpProps()} />);
            const model = screen.getByTestId('model-picker-chip');
            const slash = screen.getByTestId('chat-toolbar-slash-btn');
            const mention = screen.getByTestId('chat-toolbar-mention-btn');
            const attach = screen.getByTestId('follow-up-attach-btn');
            expect(indexInParent(model)).toBeLessThan(indexInParent(slash));
            expect(indexInParent(slash)).toBeLessThan(indexInParent(mention));
            expect(indexInParent(mention)).toBeLessThan(indexInParent(attach));
        });

        it('renders a divider between the tools zone and the send button', () => {
            render(<FollowUpInputArea {...defaultFollowUpProps()} />);
            const attach = screen.getByTestId('follow-up-attach-btn');
            const divider = screen.getByTestId('chat-toolbar-divider-send');
            const send = screen.getByTestId('activity-chat-send-btn');
            expect(indexInParent(attach)).toBeLessThan(indexInParent(divider));
            expect(indexInParent(divider)).toBeLessThan(indexInParent(send));
        });

        it('does not render the mode divider when hideModeSelector is true', () => {
            render(<FollowUpInputArea {...defaultFollowUpProps({ hideModeSelector: true })} />);
            expect(screen.queryByTestId('mode-selector')).toBeNull();
            expect(screen.queryByTestId('chat-toolbar-divider-mode')).toBeNull();
        });

        it('renders the effort pill after the model picker when onEffortChange is wired', () => {
            render(<FollowUpInputArea {...defaultFollowUpProps({ onEffortChange: vi.fn(), effortOverride: null })} />);
            const model = screen.getByTestId('model-picker-chip');
            const effort = screen.getByTestId('effort-pill-selector');
            const slash = screen.getByTestId('chat-toolbar-slash-btn');
            expect(indexInParent(model)).toBeLessThan(indexInParent(effort));
            expect(indexInParent(effort)).toBeLessThan(indexInParent(slash));
        });

        it('hides the effort pill when onEffortChange is not wired (legacy callers unchanged)', () => {
            render(<FollowUpInputArea {...defaultFollowUpProps()} />);
            expect(screen.queryByTestId('effort-pill-selector')).toBeNull();
        });

        it('shows the effort pill labelled with the supplied override', () => {
            render(<FollowUpInputArea {...defaultFollowUpProps({ onEffortChange: vi.fn(), effortOverride: 'high' })} />);
            const effort = screen.getByTestId('effort-pill-selector');
            expect(effort.getAttribute('data-effort-value')).toBe('high');
            const trigger = screen.getByTestId('effort-pill-trigger-btn');
            expect(trigger.textContent).toContain('High');
        });
    });
});
