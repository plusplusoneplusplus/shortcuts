/**
 * Tests for the redesigned chat input layout.
 *
 * The default layout is the new stacked design: a horizontal mode pill row
 * sits above an input "card" whose bottom toolbar holds the model picker,
 * tool buttons, and the Send button.
 *
 * The legacy compact single-row layout (mode cycle button + dropdown + send
 * inline with the input) is retained for narrow side panels via the
 * `compactModeSelector` prop.
 */
/* @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React, { createRef } from 'react';

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const { tracker, mockQueueDispatch, mockAppState, mockFetch, mockAppDispatch, mockRalphEnabled, mockForEachEnabled } = vi.hoisted(() => ({
    tracker: { calls: [] as Array<[string, number?]>, domValue: '' },
    mockQueueDispatch: vi.fn(),
    mockAppState: { workspaces: [{ id: 'ws-1', rootPath: '/repo' }], onboardingProgress: { hasUsedChat: true } } as Record<string, any>,
    mockFetch: vi.fn(),
    mockAppDispatch: vi.fn(),
    mockRalphEnabled: { value: false },
    mockForEachEnabled: { value: false },
}));

vi.mock('../../../../src/server/spa/client/react/shared/RichTextInput', async () => {
    const R = await import('react');
    return {
        RichTextInput: R.forwardRef((props: any, ref: any) => {
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
            });
        }),
    };
});

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
    isForEachEnabled: () => mockForEachEnabled.value,
    isMapReduceEnabled: () => false,
    isLoopsEnabled: () => false,
    isCodexEnabled: () => false,
    getDefaultProvider: () => 'copilot',
    getConfiguredDefaultProvider: () => 'copilot',
    getActiveProvider: () => 'copilot',
    isAutoAgentProviderRoutingEnabled: () => false,
    isEffortLevelsEnabled: () => false,
    isSessionContextAttachmentsEnabled: () => false,
    getPrewarmDebounceMs: () => 500,
    getWarmClientTtlMs: () => 300000,
}));

vi.mock('../../../../src/server/spa/client/react/hooks/useProviderEffortTiers', () => ({
    useProviderEffortTiers: () => ({
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
    }),
}));

vi.mock('../../../../src/server/spa/client/react/hooks/useModels', () => ({
    useModels: () => ({ models: [], loading: false, error: null, reload: vi.fn() }),
}));

vi.mock('../../../../src/server/spa/client/react/features/chat/hooks/useSlashCommands', () => ({
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

vi.mock('../../../../src/server/spa/client/react/features/chat/hooks/useModelCommand', () => ({
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

vi.mock('../../../../src/server/spa/client/react/features/chat/SlashCommandMenu', () => ({
    SlashCommandMenu: () => null,
    META_SKILL_ITEMS: [],
    getMetaSkillItems: () => [],
    mergeSkillsWithMeta: (skills: any[]) => skills,
}));

vi.mock('../../../../src/server/spa/client/react/features/chat/ModelCommandMenu', () => ({
    ModelCommandMenu: () => null,
}));

import { FollowUpInputArea } from '../../../../src/server/spa/client/react/features/chat/FollowUpInputArea';
import type { FollowUpInputAreaProps } from '../../../../src/server/spa/client/react/features/chat/FollowUpInputArea';
import type { RichTextInputHandle } from '../../../../src/server/spa/client/react/shared/RichTextInput';
import { NewChatArea } from '../../../../src/server/spa/client/react/features/chat/NewChatArea';

beforeEach(() => {
    vi.clearAllMocks();
    tracker.calls = [];
    tracker.domValue = '';
    mockRalphEnabled.value = false;
    mockForEachEnabled.value = false;
    globalThis.fetch = mockFetch;
    Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
    vi.restoreAllMocks();
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
        task: null,
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

// ── Default stacked layout (FollowUpInputArea) ─────────────────────────────

describe('FollowUpInputArea — stacked input card layout', () => {
    it('renders chat-input-bar as a vertical input card (flex-col)', () => {
        render(<FollowUpInputArea {...makeFollowUpProps()} />);
        const bar = screen.getByTestId('chat-input-bar');
        expect(bar.className).toContain('flex-col');
        expect(bar.className).toContain('rounded-lg');
        expect(bar.className).toContain('border');
    });

    // Regression: stacked input card must not show two conflicting borders
    // (Tailwind default blue ring + mode-coloured border) when the
    // contenteditable child is focused. The fix requires `focus-within:`
    // prefix on the ring colour so it actually applies to the parent card.
    it('chat-input-bar applies a mode-coloured focus-within ring (no default-blue conflict)', () => {
        render(<FollowUpInputArea {...makeFollowUpProps({ selectedMode: 'ask' })} />);
        const bar = screen.getByTestId('chat-input-bar');
        // The activator that turns the ring on
        expect(bar.className).toContain('focus-within:ring-2');
        // The colour must use focus-within: (not bare focus:) so it
        // propagates from the focused child to this parent <div>.
        expect(bar.className).toContain('focus-within:ring-yellow-500/30');
        expect(bar.className).not.toMatch(/(?:^|\s)focus:ring-yellow/);
    });

    it('chat-input-bar uses the Autopilot ring class for autopilot mode', () => {
        const ringClass = 'focus-within:ring-green-500/30';
        render(<FollowUpInputArea {...makeFollowUpProps({ selectedMode: 'autopilot' })} />);
        const bar = screen.getByTestId('chat-input-bar');
        expect(bar.className).toContain(ringClass);
    });

    // Regression: even after fixing the focus-within prefix on the outer
    // card, the INNER contenteditable still drew its own 1px gray border
    // (Tailwind's default `border` color) AND a default-blue `focus:ring-2`
    // from the base RichTextInput chrome — producing a visible second
    // border-rectangle inside the mode-coloured card and a blue ring on
    // click. The stacked consumer must explicitly neutralize both with
    // `border-transparent` and `focus:ring-transparent`.
    it('inner activity-chat-input neutralizes the base border + default-blue focus:ring', () => {
        render(<FollowUpInputArea {...makeFollowUpProps({ selectedMode: 'ask' })} />);
        const editor = screen.getByTestId('activity-chat-input') as HTMLElement;
        expect(editor.className).toContain('border-transparent');
        expect(editor.className).toContain('focus:ring-transparent');
        // Guard against re-introducing a coloured inner border or a
        // mismatched ring colour. The visible focus indicator must come
        // from the outer chat-input-bar's mode-coloured focus-within ring.
        expect(editor.className).not.toMatch(/(?:^|\s)border-(?:[a-z]+-)/);
        expect(editor.className).not.toMatch(/(?:^|\s)focus:ring-(?:blue|yellow|green|red|gray)/);
    });

    it('renders the mode pill selector with one button per mode', () => {
        render(<FollowUpInputArea {...makeFollowUpProps({ selectedMode: 'autopilot' })} />);
        expect(screen.getByTestId('mode-selector')).toBeTruthy();
        expect(screen.getByTestId('mode-pill-ask')).toBeTruthy();
        expect(screen.getByTestId('mode-pill-autopilot')).toBeTruthy();
        expect(screen.queryByTestId('mode-pill-plan')).toBeNull();
        expect(screen.getByTestId('mode-pill-autopilot').getAttribute('aria-checked')).toBe('true');
        expect(screen.getByTestId('mode-pill-ask').getAttribute('aria-checked')).toBe('false');
    });

    it('does not render the legacy mode-dropdown / mode-cycle-btn in the default layout', () => {
        render(<FollowUpInputArea {...makeFollowUpProps()} />);
        expect(screen.queryByTestId('mode-dropdown')).toBeNull();
        expect(screen.queryByTestId('mode-cycle-btn')).toBeNull();
    });

    it('clicking a pill dispatches setSelectedMode with the new mode', () => {
        const setSelectedMode = vi.fn();
        render(<FollowUpInputArea {...makeFollowUpProps({ selectedMode: 'ask', setSelectedMode })} />);
        fireEvent.click(screen.getByTestId('mode-pill-autopilot'));
        expect(setSelectedMode).toHaveBeenCalledWith('autopilot');
    });

    it('respects allowedModes when rendering pills', () => {
        render(<FollowUpInputArea {...makeFollowUpProps({
            selectedMode: 'ask',
            allowedModes: ['ask', 'autopilot'],
        })} />);
        expect(screen.getByTestId('mode-pill-ask')).toBeTruthy();
        expect(screen.getByTestId('mode-pill-autopilot')).toBeTruthy();
        expect(screen.queryByTestId('mode-pill-plan')).toBeNull();
    });

    it('does not expose For Each in follow-up composers unless explicitly allowed', () => {
        mockForEachEnabled.value = true;

        render(<FollowUpInputArea {...makeFollowUpProps({ selectedMode: 'ask' })} />);

        expect(screen.queryByTestId('mode-pill-for-each')).toBeNull();
    });

    it('exposes For Each in follow-up composers only when explicitly allowed and feature-enabled', () => {
        mockForEachEnabled.value = true;

        render(<FollowUpInputArea {...makeFollowUpProps({
            selectedMode: 'for-each',
            allowedModes: ['ask', 'for-each'],
        })} />);

        expect(screen.getByTestId('mode-pill-for-each')).toBeTruthy();
        expect(screen.getByTestId('mode-pill-for-each').getAttribute('aria-checked')).toBe('true');
    });

    it('renders the bottom toolbar with attach + slash trigger buttons', () => {
        render(<FollowUpInputArea {...makeFollowUpProps()} />);
        expect(screen.getByTestId('chat-input-toolbar')).toBeTruthy();
        expect(screen.getByTestId('follow-up-attach-btn')).toBeTruthy();
        expect(screen.getByTestId('chat-toolbar-slash-btn')).toBeTruthy();
    });

    it('Send button has shrink-0 to prevent compression', () => {
        render(<FollowUpInputArea {...makeFollowUpProps()} />);
        const btn = screen.getByTestId('activity-chat-send-btn');
        expect(btn.className).toContain('shrink-0');
        expect(btn.className).not.toContain('w-full');
    });

    it('Send button uses ultra-compact 24px height + 11px label', () => {
        render(<FollowUpInputArea {...makeFollowUpProps()} />);
        const btn = screen.getByTestId('activity-chat-send-btn');
        expect(btn.className).toContain('h-[24px]');
        expect(btn.className).toContain('pl-2');
        expect(btn.className).toContain('pr-1.5');
        expect(btn.className).toContain('text-[11px]');
        // Guard against the previous (taller) sizing tokens.
        expect(btn.className).not.toContain('h-[28px]');
        expect(btn.className).not.toContain('text-[12px]');
        expect(btn.className).not.toContain('text-xs');
    });

    it('Send button shortcut hint uses a vertical separator (border-l), not a boxed kbd', () => {
        render(<FollowUpInputArea {...makeFollowUpProps()} />);
        const hint = screen.getByTestId('queue-follow-up-shortcut-hint');
        expect(hint.className).toContain('border-l');
        expect(hint.className).toContain('pl-1.5');
        expect(hint.className).toContain('text-[9px]');
        // Old boxed-kbd style had a full border + rounded corners — guard
        // against accidentally re-introducing them.
        expect(hint.className).not.toContain('border border-');
        expect(hint.className).not.toContain('rounded');
    });

    it('hides the mode selector when hideModeSelector is true', () => {
        render(<FollowUpInputArea {...makeFollowUpProps({ hideModeSelector: true })} />);
        expect(screen.queryByTestId('mode-selector')).toBeNull();
        expect(screen.queryByTestId('mode-pill-ask')).toBeNull();
        expect(screen.queryByTestId('mode-pill-plan')).toBeNull();
        expect(screen.queryByTestId('mode-pill-autopilot')).toBeNull();
    });

    // ── Compact density ────────────────────────────────────────────────────
    // The stacked layout must stay vertically tight; these regressions guard
    // against accidentally re-introducing taller paddings or heights that
    // previously made the input area waste a lot of vertical space.

    it('outer container uses compact py-2 (not p-3)', () => {
        const { container } = render(<FollowUpInputArea {...makeFollowUpProps()} />);
        const outer = container.querySelector('div.border-t') as HTMLElement;
        expect(outer).not.toBeNull();
        expect(outer.className).toContain('py-2');
        expect(outer.className).not.toContain('p-3');
    });

    it('chat-input-stack uses tight space-y-1 between pill row and input card', () => {
        render(<FollowUpInputArea {...makeFollowUpProps()} />);
        const stack = screen.getByTestId('chat-input-stack');
        expect(stack.className).toContain('space-y-1');
        expect(stack.className).not.toContain('space-y-2');
    });

    it('RichTextInput shrinks to min-h-[28px] (down from min-h-[40px])', () => {
        render(<FollowUpInputArea {...makeFollowUpProps()} />);
        const editor = screen.getByTestId('activity-chat-input') as HTMLElement;
        expect(editor.className).toContain('min-h-[28px]');
        expect(editor.className).not.toContain('min-h-[40px]');
    });

    it('chat-input-toolbar uses ultra-compact py-1 + asymmetric pl-2 pr-1.5', () => {
        render(<FollowUpInputArea {...makeFollowUpProps()} />);
        const toolbar = screen.getByTestId('chat-input-toolbar');
        expect(toolbar.className).toContain('py-1');
        expect(toolbar.className).toContain('pl-2');
        expect(toolbar.className).toContain('pr-1.5');
        // Guard against re-introducing the previous (taller) padding tokens.
        expect(toolbar.className).not.toContain('py-1.5');
        expect(toolbar.className).not.toContain('py-2');
        expect(toolbar.className).not.toContain('pl-2.5');
        expect(toolbar.className).not.toContain('p-3');
    });

    it('toolbar attach button uses ultra-compact 22x22 ctool sizing', () => {
        render(<FollowUpInputArea {...makeFollowUpProps()} />);
        const attach = screen.getByTestId('follow-up-attach-btn');
        expect(attach.className).toContain('h-[22px]');
        expect(attach.className).toContain('w-[22px]');
        expect(attach.className).toContain('ctool');
        expect(attach.className).not.toContain('h-[26px]');
        expect(attach.className).not.toContain('h-7');
    });

    it('toolbar slash button uses 22px ctool height with px-1.5 padding', () => {
        render(<FollowUpInputArea {...makeFollowUpProps()} />);
        const slash = screen.getByTestId('chat-toolbar-slash-btn');
        expect(slash.className).toContain('h-[22px]');
        expect(slash.className).toContain('px-1.5');
        expect(slash.className).toContain('text-[11px]');
        expect(slash.className).toContain('ctool');
        expect(slash.className).not.toContain('h-[26px]');
        expect(slash.className).not.toContain('px-[7px]');
    });

    // ── @ mention-skill button (matches reference .ctool with @ kbd) ──────
    it('renders an @ mention-skill toolbar button alongside the slash button', () => {
        render(<FollowUpInputArea {...makeFollowUpProps()} />);
        const mention = screen.getByTestId('chat-toolbar-mention-btn');
        expect(mention).toBeTruthy();
        expect(mention.className).toContain('h-[22px]');
        expect(mention.className).toContain('px-1.5');
        expect(mention.className).toContain('text-[11px]');
        expect(mention.className).toContain('ctool');
        expect(mention.getAttribute('aria-label')).toBe('Mention a skill');
        // Carries an @ glyph as a visible kbd hint
        expect(mention.textContent).toContain('@');
    });

    // ── Toolbar position + responsiveness ────────────────────────────────
    // The mode pill selector now lives INSIDE the toolbar, before the model
    // picker chip, instead of on its own row above the input card.

    it('mode pill selector is rendered inside the toolbar', () => {
        render(<FollowUpInputArea {...makeFollowUpProps()} />);
        const toolbar = screen.getByTestId('chat-input-toolbar');
        expect(toolbar.contains(screen.getByTestId('mode-selector'))).toBe(true);
    });

    function makeModelCommand(overrides: Partial<NonNullable<FollowUpInputAreaProps['modelCommand']>> = {}) {
        return {
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
            ...overrides,
        };
    }

    it('mode pill selector comes BEFORE the model picker chip in the toolbar', () => {
        render(<FollowUpInputArea {...makeFollowUpProps({ modelCommand: makeModelCommand() })} />);
        const selector = screen.getByTestId('mode-selector');
        const chip = screen.getByTestId('model-picker-chip');
        // bit 4 = DOCUMENT_POSITION_FOLLOWING
        const pos = selector.compareDocumentPosition(chip);
        expect(pos & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('toolbar wraps on narrow viewports (flex-wrap)', () => {
        render(<FollowUpInputArea {...makeFollowUpProps()} />);
        const toolbar = screen.getByTestId('chat-input-toolbar');
        expect(toolbar.className).toContain('flex-wrap');
    });

    it('separate model-override-badge is removed (chip is the single source)', () => {
        render(<FollowUpInputArea {...makeFollowUpProps({
            modelCommand: makeModelCommand({ modelOverride: 'gpt-5.4' }),
        })} />);
        expect(screen.queryByTestId('model-override-badge')).toBeNull();
        const chip = screen.getByTestId('model-picker-chip');
        expect(chip.textContent).toContain('gpt-5.4');
    });

    it('chip no longer renders an inline ✕ — clearing happens via the menu (mirrors AgentSelectorChip)', () => {
        // Now the chip exposes a chevron only, matching AgentSelectorChip.
        // The override is cleared via the "Use default" entry that
        // ModelCommandMenu renders at the top when an override is set.
        render(<FollowUpInputArea {...makeFollowUpProps({
            modelCommand: makeModelCommand({ modelOverride: 'gpt-5.4' }),
        })} />);
        const chip = screen.getByTestId('model-picker-chip');
        expect(chip).toBeTruthy();
        expect(screen.queryByTestId('model-picker-chip-clear')).toBeNull();
    });

    // The "Use default" entry that replaces the inline ✕ lives inside
    // ModelCommandMenu and is exercised in its own component test file
    // (ModelCommandMenu.test.tsx). This suite mocks ModelCommandMenu out
    // to keep the chip-layout tests focused, so we don't re-test the
    // menu contents here.

    it('Send button keyboard shortcut hint is hidden on small screens (sm:inline-flex)', () => {
        render(<FollowUpInputArea {...makeFollowUpProps()} />);
        const hint = screen.getByTestId('queue-follow-up-shortcut-hint');
        expect(hint.className).toContain('hidden');
        expect(hint.className).toContain('sm:inline-flex');
    });
});

// ── Legacy compact layout (compactModeSelector=true) ───────────────────────

describe('FollowUpInputArea — compactModeSelector legacy single-row layout', () => {
    it('renders chat-input-bar as a single horizontal row when compactModeSelector is true', () => {
        render(<FollowUpInputArea {...makeFollowUpProps({ compactModeSelector: true })} />);
        const bar = screen.getByTestId('chat-input-bar');
        expect(bar.className).toContain('flex-row');
        expect(bar.className).toContain('items-center');
        expect(bar.className).not.toContain('flex-col');
    });

    it('renders only the cycle button (no dropdown) when compactModeSelector is true', () => {
        render(<FollowUpInputArea {...makeFollowUpProps({ compactModeSelector: true })} />);
        expect(screen.getByTestId('mode-cycle-btn')).toBeTruthy();
        expect(screen.queryByTestId('mode-dropdown')).toBeNull();
        expect(screen.queryByTestId('mode-pill-ask')).toBeNull();
    });

    it('cycle button shows the icon for the current mode', () => {
        render(<FollowUpInputArea {...makeFollowUpProps({ compactModeSelector: true, selectedMode: 'autopilot' })} />);
        expect(screen.getByTestId('mode-cycle-btn').textContent).toContain('🤖');
    });

    it('clicking the cycle button advances to the next mode', () => {
        const setSelectedMode = vi.fn();
        render(<FollowUpInputArea {...makeFollowUpProps({ compactModeSelector: true, selectedMode: 'ask', setSelectedMode })} />);
        fireEvent.click(screen.getByTestId('mode-cycle-btn'));
        expect(setSelectedMode).toHaveBeenCalledWith('autopilot');
    });

    it('respects allowedModes when cycling (ask → autopilot)', () => {
        const setSelectedMode = vi.fn();
        render(<FollowUpInputArea {...makeFollowUpProps({
            compactModeSelector: true,
            selectedMode: 'ask',
            allowedModes: ['ask', 'autopilot'],
            setSelectedMode,
        })} />);
        fireEvent.click(screen.getByTestId('mode-cycle-btn'));
        expect(setSelectedMode).toHaveBeenCalledWith('autopilot');
    });

    it('hideModeSelector hides the selector even when compactModeSelector is true', () => {
        render(<FollowUpInputArea {...makeFollowUpProps({ compactModeSelector: true, hideModeSelector: true })} />);
        expect(screen.queryByTestId('mode-selector')).toBeNull();
        expect(screen.queryByTestId('mode-cycle-btn')).toBeNull();
    });

    it('text input wrapper has min-w-0 to prevent overflow in single-row layout', () => {
        render(<FollowUpInputArea {...makeFollowUpProps({ compactModeSelector: true })} />);
        const bar = screen.getByTestId('chat-input-bar');
        const inputWrapper = bar.querySelector('.flex-1.min-w-0');
        expect(inputWrapper).toBeTruthy();
    });
});

// ── NewChatArea stacked layout ─────────────────────────────────────────────

describe('NewChatArea — stacked input card layout', () => {
    it('renders chat-input-bar as a vertical input card (flex-col)', () => {
        render(<NewChatArea workspaceId="ws-1" />);
        const bar = screen.getByTestId('chat-input-bar');
        expect(bar.className).toContain('flex-col');
        expect(bar.className).toContain('rounded-lg');
        expect(bar.className).toContain('border');
    });

    it('renders the mode pill selector with active modes by default', () => {
        render(<NewChatArea workspaceId="ws-1" />);
        expect(screen.getByTestId('mode-selector')).toBeTruthy();
        expect(screen.getByTestId('mode-pill-ask')).toBeTruthy();
        expect(screen.getByTestId('mode-pill-autopilot')).toBeTruthy();
        expect(screen.queryByTestId('mode-pill-plan')).toBeNull();
        expect(screen.getByTestId('mode-pill-ask').getAttribute('aria-checked')).toBe('true');
    });

    it('does not render the legacy mode-dropdown / mode-cycle-btn', () => {
        render(<NewChatArea workspaceId="ws-1" />);
        expect(screen.queryByTestId('mode-dropdown')).toBeNull();
        expect(screen.queryByTestId('mode-cycle-btn')).toBeNull();
    });

    it('renders the bottom toolbar with attach + slash + mention trigger buttons', () => {
        render(<NewChatArea workspaceId="ws-1" />);
        expect(screen.getByTestId('chat-input-toolbar')).toBeTruthy();
        expect(screen.getByTestId('new-chat-attach-btn')).toBeTruthy();
        expect(screen.getByTestId('chat-toolbar-slash-btn')).toBeTruthy();
        expect(screen.getByTestId('chat-toolbar-mention-btn')).toBeTruthy();
    });

    it('Send button has shrink-0 + ultra-compact 24px height + vertical-separator hint', () => {
        render(<NewChatArea workspaceId="ws-1" />);
        const btn = screen.getByTestId('new-chat-send-btn');
        expect(btn.className).toContain('shrink-0');
        expect(btn.className).not.toContain('w-full');
        expect(btn.className).toContain('h-[24px]');
        expect(btn.className).toContain('text-[11px]');
        expect(btn.className).not.toContain('h-[28px]');
        // The shortcut hint nested inside should use a vertical separator
        // rather than a boxed kbd (matches the OpenDesign reference).
        const hint = btn.querySelector('span.border-l') as HTMLElement | null;
        expect(hint).not.toBeNull();
        expect(hint?.textContent).toMatch(/⌘/);
        expect(hint?.className).toContain('text-[9px]');
    });

    it('NewChatArea toolbar buttons use the uniform ctool class (h-[22px])', () => {
        render(<NewChatArea workspaceId="ws-1" />);
        for (const tid of ['model-picker-chip', 'chat-toolbar-slash-btn', 'chat-toolbar-mention-btn', 'new-chat-attach-btn']) {
            const btn = screen.getByTestId(tid);
            expect(btn.className).toContain('ctool');
            expect(btn.className).toContain('h-[22px]');
            expect(btn.className).not.toContain('h-[26px]');
        }
    });

    // Regression: the inner contenteditable in NewChatArea must also
    // neutralize the base RichTextInput border + default-blue focus ring,
    // matching FollowUpInputArea. Without this, clicking inside the new
    // chat input shows a blue inner ring conflicting with the outer
    // mode-coloured focus-within ring.
    it('inner new-chat-input neutralizes the base border + default-blue focus:ring', () => {
        render(<NewChatArea workspaceId="ws-1" />);
        const editor = screen.getByTestId('new-chat-input') as HTMLElement;
        expect(editor.className).toContain('border-transparent');
        expect(editor.className).toContain('focus:ring-transparent');
        expect(editor.className).not.toMatch(/(?:^|\s)border-(?:[a-z]+-)/);
        expect(editor.className).not.toMatch(/(?:^|\s)focus:ring-(?:blue|yellow|green|red|gray)/);
    });
});

// ── Source code validation ─────────────────────────────────────────────────

describe('Stacked input bar — source validation', () => {
    it('FollowUpInputArea.tsx contains the chat-input-stack stacked container', async () => {
        const fs = await import('fs');
        const path = await import('path');
        const src = fs.readFileSync(
            path.resolve(__dirname, '../../../../src/server/spa/client/react/features/chat/FollowUpInputArea.tsx'),
            'utf-8',
        );
        expect(src).toContain('chat-input-stack');
        expect(src).toContain('ModePillSelector');
    });

    it('NewChatArea.tsx uses the ModePillSelector and a vertical input card', async () => {
        const fs = await import('fs');
        const path = await import('path');
        const src = fs.readFileSync(
            path.resolve(__dirname, '../../../../src/server/spa/client/react/features/chat/NewChatArea.tsx'),
            'utf-8',
        );
        expect(src).toContain('ModePillSelector');
        expect(src).toContain('flex-col');
    });

    it('neither component uses the obsolete sm:flex-row stacked-mobile layout', async () => {
        const fs = await import('fs');
        const path = await import('path');
        const followUp = fs.readFileSync(
            path.resolve(__dirname, '../../../../src/server/spa/client/react/features/chat/FollowUpInputArea.tsx'),
            'utf-8',
        );
        const newChat = fs.readFileSync(
            path.resolve(__dirname, '../../../../src/server/spa/client/react/features/chat/NewChatArea.tsx'),
            'utf-8',
        );
        expect(followUp).not.toContain('flex flex-col sm:flex-row');
        expect(newChat).not.toContain('flex flex-col sm:flex-row');
    });
});
