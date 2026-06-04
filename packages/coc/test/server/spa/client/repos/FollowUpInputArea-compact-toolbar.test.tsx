/**
 * @vitest-environment jsdom
 *
 * Tests for the compact mobile/tablet (≤1023px) layout of the
 * FollowUpInputArea inner toolbar.
 *
 * On narrow viewports the toolbar must stay on a single row (no flex-wrap):
 *  - the low-priority tool actions (slash / mention / attach) collapse into a
 *    single overflow ("⋯") menu, while remaining individually reachable;
 *  - the wide segmented mode pill collapses into a compact tap-to-cycle button;
 *  - the desktop layout (lg+) is preserved via responsive `lg:` utilities, so
 *    the inline buttons and mode pill are still present in the DOM.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../../../../src/server/spa/client/react/hooks/ui/useModifierKey', () => ({
    useModifierKey: () => false,
}));

vi.mock('../../../../../src/server/spa/client/react/ui', () => ({
    Button: ({ children, ...rest }: any) => <button {...rest}>{children}</button>,
    SuggestionChips: () => null,
    SendButton: () => <button data-testid="activity-chat-send-btn">Send</button>,
    QueueFollowUpButton: ({ onSend, mobileTapTarget }: any) => (
        <button
            data-testid="activity-chat-send-btn"
            className={mobileTapTarget ? 'h-8 lg:h-[24px]' : 'h-[24px]'}
            onClick={() => onSend('enqueue')}
        >
            Send
        </button>
    ),
}));

vi.mock('../../../../../src/server/spa/client/react/ui/AttachmentPreviews', () => ({
    AttachmentPreviews: () => null,
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

// Render the real ModePillSelector wrapper as an identifiable element so the
// test can confirm the desktop pill remains present alongside the compact
// mobile cycle button.
vi.mock('../../../../../src/server/spa/client/react/features/chat/ModePillSelector', () => ({
    ModePillSelector: () => <div data-testid="mode-pill-selector-inner" />,
    DEFAULT_MODE_PILL_OPTIONS: [],
    RALPH_MODE_PILL_OPTION: { value: 'ralph', label: 'Ralph' },
}));

vi.mock('../../../../../src/server/spa/client/react/features/chat/EffortPillSelector', () => ({
    EffortPillSelector: () => null,
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
    cycleMode: (m: string) => (m === 'ask' ? 'plan' : 'ask'),
}));

vi.mock('@plusplusoneplusplus/forge', () => ({}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { FollowUpInputArea } from '../../../../../src/server/spa/client/react/features/chat/FollowUpInputArea';
import { createRef } from 'react';

function defaultProps(overrides: Partial<Parameters<typeof FollowUpInputArea>[0]> = {}) {
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
        ...overrides,
    };
}

function classTokens(element: HTMLElement) {
    return element.className.split(/\s+/);
}

function expectMobileTapTarget(element: HTMLElement, desktopHeight: string) {
    const tokens = classTokens(element);
    expect(tokens).toContain('h-8');
    expect(tokens).toContain(desktopHeight);
}

function expectSquareMobileTapTarget(element: HTMLElement) {
    const tokens = classTokens(element);
    expect(tokens).toContain('h-8');
    expect(tokens).toContain('w-8');
}

describe('FollowUpInputArea – compact mobile toolbar', () => {
    beforeEach(() => {
        Element.prototype.scrollIntoView = vi.fn();
    });

    it('renders the inner toolbar as a single non-wrapping row on ≤1023px (no bare flex-wrap)', () => {
        render(<FollowUpInputArea {...defaultProps()} />);
        const toolbar = screen.getByTestId('chat-input-toolbar');
        const tokens = toolbar.className.split(/\s+/);
        // Mobile/tablet: explicit no-wrap single row.
        expect(tokens).toContain('flex-nowrap');
        // Desktop (lg+) preserves the original wrapping behaviour.
        expect(tokens).toContain('lg:flex-wrap');
        // The unprefixed `flex-wrap` (which would wrap on mobile) must be gone.
        expect(tokens).not.toContain('flex-wrap');
    });

    it('gives visible mobile/tablet toolbar actions approximately 32px tap targets', () => {
        render(<FollowUpInputArea
            {...defaultProps({
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
                    handleModelKeyDown: vi.fn(),
                    setModelFilter: vi.fn(),
                },
                sessionModel: 'gpt-5.5',
            })}
        />);

        expectMobileTapTarget(screen.getByTestId('agent-selector-chip-btn'), 'lg:h-[22px]');
        expectMobileTapTarget(screen.getByTestId('mode-cycle-btn-compact'), 'h-8');
        expectMobileTapTarget(screen.getByTestId('model-picker-chip'), 'lg:h-[22px]');
        expectSquareMobileTapTarget(screen.getByTestId('chat-toolbar-overflow-btn'));
        expectMobileTapTarget(screen.getByTestId('activity-chat-send-btn'), 'lg:h-[24px]');
    });

    it('gives the active-generation stop action a 32px mobile/tablet tap target', () => {
        render(<FollowUpInputArea {...defaultProps({ isActiveGeneration: true, onStop: vi.fn() })} />);

        expectMobileTapTarget(screen.getByTestId('activity-chat-stop-btn'), 'lg:h-[24px]');
    });

    it('gives the effort-tier selector a 32px mobile/tablet tap target', () => {
        render(<FollowUpInputArea
            {...defaultProps({
                useEffortTierMode: true,
                selectedEffortTier: 'low',
                onEffortTierChange: vi.fn(),
                effortTierMap: {
                    'very-low': { model: 'gpt-5-mini', reasoningEffort: '' },
                    low: { model: 'gpt-5.5', reasoningEffort: 'low' },
                    medium: { model: 'gpt-5.5', reasoningEffort: 'medium' },
                    high: { model: 'gpt-5.5', reasoningEffort: 'high' },
                } as any,
            })}
        />);

        expectMobileTapTarget(screen.getByTestId('effort-tier-trigger-btn'), 'lg:h-[22px]');
    });

    it('collapses slash/mention/attach into an overflow menu that is reachable', () => {
        render(<FollowUpInputArea {...defaultProps()} />);
        const overflowBtn = screen.getByTestId('chat-toolbar-overflow-btn');
        expect(overflowBtn).toBeTruthy();
        // Menu is closed initially.
        expect(screen.queryByTestId('chat-toolbar-overflow-menu')).toBeNull();
        // Opening it surfaces all three collapsed actions.
        fireEvent.click(overflowBtn);
        expect(screen.getByTestId('chat-toolbar-overflow-menu')).toBeTruthy();
        expect(screen.getByTestId('chat-toolbar-overflow-slash')).toBeTruthy();
        expect(screen.getByTestId('chat-toolbar-overflow-mention')).toBeTruthy();
        expect(screen.getByTestId('chat-toolbar-overflow-attach')).toBeTruthy();
    });

    it('triggers the file picker from the overflow attach action', () => {
        render(<FollowUpInputArea {...defaultProps()} />);
        const input = screen.getByTestId('follow-up-file-input-hidden') as HTMLInputElement;
        const clickSpy = vi.spyOn(input, 'click').mockImplementation(() => {});
        fireEvent.click(screen.getByTestId('chat-toolbar-overflow-btn'));
        fireEvent.click(screen.getByTestId('chat-toolbar-overflow-attach'));
        expect(clickSpy).toHaveBeenCalled();
        // Selecting an action closes the menu.
        expect(screen.queryByTestId('chat-toolbar-overflow-menu')).toBeNull();
    });

    it('renders a compact mode cycle button that cycles the mode', () => {
        const setSelectedMode = vi.fn();
        render(<FollowUpInputArea {...defaultProps({ setSelectedMode })} />);
        const cycleBtn = screen.getByTestId('mode-cycle-btn-compact');
        fireEvent.click(cycleBtn);
        expect(setSelectedMode).toHaveBeenCalledWith('plan');
    });

    it('keeps the desktop inline buttons and mode pill in the DOM (responsive, not removed)', () => {
        render(<FollowUpInputArea {...defaultProps()} />);
        // Desktop inline tool buttons still exist (hidden via lg: utilities only).
        expect(screen.getByTestId('chat-toolbar-slash-btn')).toBeTruthy();
        expect(screen.getByTestId('chat-toolbar-mention-btn')).toBeTruthy();
        expect(screen.getByTestId('follow-up-attach-btn')).toBeTruthy();
        // Desktop mode pill wrapper + inner selector still present.
        expect(screen.getByTestId('mode-selector')).toBeTruthy();
        expect(screen.getByTestId('mode-pill-selector-inner')).toBeTruthy();
    });
});
