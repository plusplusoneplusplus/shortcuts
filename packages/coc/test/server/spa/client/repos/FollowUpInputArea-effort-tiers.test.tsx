/**
 * @vitest-environment jsdom
 *
 * Tests for AC-05: Effort Tier selector in the follow-up input area.
 *
 * Verifies that:
 * - When useEffortTierMode is false, the model picker and effort pill render
 *   normally and the EffortTierSelector is absent.
 * - When useEffortTierMode is true (flag ON + provider has tiers), the
 *   EffortTierSelector replaces the model picker and effort pill.
 * - onEffortTierChange fires when the user picks a tier.
 * - Zero-tier legacy fallback: if useEffortTierMode is false (enforced by
 *   the parent when no tiers are configured), legacy controls remain.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks — declared before imports
// ---------------------------------------------------------------------------

vi.mock('../../../../../src/server/spa/client/react/hooks/ui/useModifierKey', () => ({
    useModifierKey: () => false,
}));

vi.mock('../../../../../src/server/spa/client/react/ui', () => ({
    Button: ({ children, ...rest }: any) => <button {...rest}>{children}</button>,
    SuggestionChips: () => null,
    SendButton: () => <button data-testid="activity-chat-send-btn">Send</button>,
    QueueFollowUpButton: ({ onSend, ...rest }: any) => (
        <button data-testid="activity-chat-send-btn" onClick={() => onSend('enqueue')}>Send</button>
    ),
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

vi.mock('../../../../../src/server/spa/client/react/ui/cn', () => ({
    cn: (...classes: any[]) => classes.filter(Boolean).join(' '),
}));

vi.mock('../../../../../src/server/spa/client/react/shared/RichTextInput', () => ({
    RichTextInput: vi.fn().mockImplementation(() => null),
}));

vi.mock('../../../../../src/server/spa/client/react/features/chat/SlashCommandMenu', () => ({
    SlashCommandMenu: () => null,
    META_SKILL_ITEMS: [],
}));

vi.mock('../../../../../src/server/spa/client/react/features/chat/ModelCommandMenu', () => ({
    ModelCommandMenu: () => null,
}));

vi.mock('../../../../../src/server/spa/client/react/features/chat/ModePillSelector', () => ({
    ModePillSelector: () => null,
    DEFAULT_MODE_PILL_OPTIONS: [],
    RALPH_MODE_PILL_OPTION: { value: 'ralph', label: 'Ralph' },
    getVisibleModePillOptions: () => [
        { value: 'ask', label: 'Ask', dotClass: 'bg-yellow-500' },
        { value: 'autopilot', label: 'Autopilot', dotClass: 'bg-green-500' },
    ],
}));

// EffortPillSelector — renders a recognizable sentinel element when shown
vi.mock('../../../../../src/server/spa/client/react/features/chat/EffortPillSelector', () => ({
    EffortPillSelector: () => <div data-testid="effort-pill-selector" />,
}));

// EffortTierSelector — renders a recognizable sentinel element when shown
vi.mock('../../../../../src/server/spa/client/react/features/chat/EffortTierSelector', () => ({
    EffortTierSelector: ({ tiers, selectedTier, onChange }: any) => (
        <div data-testid="follow-up-effort-tier-selector" data-tier={selectedTier}>
            {(['low', 'medium', 'high'] as const).map(t => (
                <button
                    key={t}
                    data-testid={`tier-option-${t}`}
                    disabled={!tiers[t]?.model}
                    onClick={() => tiers[t]?.model && onChange(t)}
                >
                    {t}
                </button>
            ))}
        </div>
    ),
}));

vi.mock('../../../../../src/server/spa/client/react/repos/modeConfig', () => ({
    MODE_BORDER_COLORS: {
        ask: { border: '', ring: '' },
        plan: { border: '', ring: '' },
        autopilot: { border: '', ring: '' },
    },
    MODE_ICONS: { ask: '?', plan: 'P', autopilot: 'A' },
    MODE_LABELS: { ask: 'Ask', plan: 'Plan', autopilot: 'Autopilot' },
    MODE_TOOLTIPS: { ask: 'Ask', plan: 'Plan', autopilot: 'Autopilot' },
    cycleMode: (m: string) => m,
}));

vi.mock('@plusplusoneplusplus/forge', () => ({}));

vi.mock('../../../../../src/server/spa/client/react/features/chat/ComposerMetaStrip', () => ({
    ComposerMetaStrip: () => null,
}));

vi.mock('../../../../../src/server/spa/client/react/features/chat/AgentSelectorChip', () => ({
    AgentSelectorChip: ({ selected, ...rest }: any) => (
        <button data-testid="agent-selector-chip-btn" {...rest}>{selected}</button>
    ),
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/usePromptAutocomplete', () => ({
    usePromptAutocomplete: () => ({ completion: null, accept: vi.fn(), dismiss: vi.fn() }),
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/usePromptAutocompleteEnabled', () => ({
    usePromptAutocompleteEnabled: () => false,
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/useChatPromptHistory', () => ({
    useChatPromptHistory: () => ({ handleKeyDown: vi.fn(() => false), reset: vi.fn() }),
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { createRef } from 'react';
import { FollowUpInputArea } from '../../../../../src/server/spa/client/react/features/chat/FollowUpInputArea';
import type { FollowUpInputAreaProps } from '../../../../../src/server/spa/client/react/features/chat/FollowUpInputArea';
import type { RichTextInputHandle } from '../../../../../src/server/spa/client/react/shared/RichTextInput';
import type { LocalEffortTiersMap, EffortTierKey } from '../../../../../src/server/spa/client/react/hooks/useProviderEffortTiers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CONFIGURED_TIER_MAP: LocalEffortTiersMap = {
    low: { model: 'gpt-4.1', reasoningEffort: 'low' },
    medium: { model: 'claude-sonnet-4.6', reasoningEffort: '' },
    high: { model: 'claude-opus-4.7', reasoningEffort: 'high' },
};

function makeModelCommand() {
    return {
        modelMenuVisible: false,
        modelFilter: '',
        filteredModels: [{ id: 'gpt-4.1', name: 'GPT 4.1', enabled: true }],
        modelHighlightIndex: 0,
        modelOverride: null,
        setModelOverride: vi.fn(),
        handleModelSelect: vi.fn(),
        showModelMenu: vi.fn(),
        dismissModelMenu: vi.fn(),
        handleModelKeyDown: vi.fn(() => false),
        setModelFilter: vi.fn(),
    };
}

function makeSlashCommands() {
    return {
        handleInputChange: vi.fn(),
        handleKeyDown: vi.fn().mockReturnValue(false),
        selectSkill: vi.fn(),
        dismissMenu: vi.fn(),
        menuVisible: false,
        menuFilter: '',
        filteredSkills: [],
        highlightIndex: 0,
    };
}

function defaultProps(overrides: Partial<FollowUpInputAreaProps> = {}): FollowUpInputAreaProps {
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
        task: null,
        slashCommands: makeSlashCommands(),
        modelCommand: makeModelCommand(),
        onEffortChange: vi.fn(),
        effortOverride: null,
        activeProvider: 'copilot',
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FollowUpInputArea — Effort Tier selector (AC-05)', () => {
    beforeEach(() => {
        Element.prototype.scrollIntoView = vi.fn();
    });

    describe('flag OFF (useEffortTierMode = false)', () => {
        it('renders the model picker chip when useEffortTierMode is false', () => {
            render(<FollowUpInputArea {...defaultProps({ useEffortTierMode: false })} />);
            // model-picker-chip is rendered inside modelCommand container
            expect(screen.getByTestId('model-picker-chip-container')).toBeTruthy();
        });

        it('renders the effort pill when onEffortChange is wired and useEffortTierMode is false', () => {
            render(<FollowUpInputArea {...defaultProps({ useEffortTierMode: false, onEffortChange: vi.fn() })} />);
            expect(screen.getByTestId('effort-pill-selector')).toBeTruthy();
        });

        it('does NOT render the EffortTierSelector when useEffortTierMode is false', () => {
            render(<FollowUpInputArea {...defaultProps({
                useEffortTierMode: false,
                selectedEffortTier: 'medium',
                effortTierMap: CONFIGURED_TIER_MAP,
                onEffortTierChange: vi.fn(),
            })} />);
            expect(screen.queryByTestId('follow-up-effort-tier-selector')).toBeNull();
        });

        it('renders legacy controls when useEffortTierMode is omitted', () => {
            render(<FollowUpInputArea {...defaultProps()} />);
            expect(screen.getByTestId('model-picker-chip-container')).toBeTruthy();
            expect(screen.getByTestId('effort-pill-selector')).toBeTruthy();
            expect(screen.queryByTestId('follow-up-effort-tier-selector')).toBeNull();
        });
    });

    describe('flag ON (useEffortTierMode = true)', () => {
        function tierProps(tierOverrides: Partial<FollowUpInputAreaProps> = {}): FollowUpInputAreaProps {
            return defaultProps({
                useEffortTierMode: true,
                selectedEffortTier: 'medium',
                effortTierMap: CONFIGURED_TIER_MAP,
                onEffortTierChange: vi.fn(),
                ...tierOverrides,
            });
        }

        it('renders the EffortTierSelector when tier mode is active', () => {
            render(<FollowUpInputArea {...tierProps()} />);
            expect(screen.getByTestId('follow-up-effort-tier-selector')).toBeTruthy();
        });

        it('hides the model picker chip when tier mode is active', () => {
            render(<FollowUpInputArea {...tierProps()} />);
            expect(screen.queryByTestId('model-picker-chip-container')).toBeNull();
        });

        it('hides the effort pill when tier mode is active', () => {
            render(<FollowUpInputArea {...tierProps()} />);
            expect(screen.queryByTestId('effort-pill-selector')).toBeNull();
        });

        it('shows the currently selected tier on the selector', () => {
            render(<FollowUpInputArea {...tierProps({ selectedEffortTier: 'high' })} />);
            const selector = screen.getByTestId('follow-up-effort-tier-selector');
            expect(selector.getAttribute('data-tier')).toBe('high');
        });

        it('calls onEffortTierChange when user picks a configured tier', () => {
            const onEffortTierChange = vi.fn();
            render(<FollowUpInputArea {...tierProps({ onEffortTierChange })} />);
            fireEvent.click(screen.getByTestId('tier-option-low'));
            expect(onEffortTierChange).toHaveBeenCalledWith('low');
        });

        it('does NOT call onEffortTierChange for an unconfigured tier', () => {
            const onEffortTierChange = vi.fn();
            const sparseMap: LocalEffortTiersMap = {
                medium: { model: 'claude-sonnet-4.6', reasoningEffort: '' },
                // low and high not configured
            };
            render(<FollowUpInputArea {...tierProps({ effortTierMap: sparseMap, onEffortTierChange })} />);
            fireEvent.click(screen.getByTestId('tier-option-high')); // disabled
            expect(onEffortTierChange).not.toHaveBeenCalled();
        });

        it('does NOT render EffortTierSelector if effortTierMap is undefined', () => {
            render(<FollowUpInputArea {...defaultProps({
                useEffortTierMode: true,
                selectedEffortTier: 'medium',
                effortTierMap: undefined,
                onEffortTierChange: vi.fn(),
            })} />);
            // Neither the tier selector nor the model picker render when the
            // map is missing (the parent should not reach this state in practice).
            expect(screen.queryByTestId('follow-up-effort-tier-selector')).toBeNull();
            expect(screen.queryByTestId('model-picker-chip-container')).toBeNull();
        });

        it('does NOT render EffortTierSelector if onEffortTierChange is undefined', () => {
            render(<FollowUpInputArea {...defaultProps({
                useEffortTierMode: true,
                selectedEffortTier: 'medium',
                effortTierMap: CONFIGURED_TIER_MAP,
                onEffortTierChange: undefined,
            })} />);
            expect(screen.queryByTestId('follow-up-effort-tier-selector')).toBeNull();
        });
    });
});
