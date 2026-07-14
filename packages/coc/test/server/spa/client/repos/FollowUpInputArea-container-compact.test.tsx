/**
 * @vitest-environment jsdom
 *
 * Tests for the CONTAINER-width driven compact composer footer.
 *
 * Unlike the viewport-driven (`lg:` / `sm:`) compaction covered by
 * FollowUpInputArea-compact-toolbar.test.tsx, these behaviours fire when the
 * toolbar measures its OWN width via the `useContainerWidth` hook — so the
 * footer compacts when the composer pane is narrow even on a wide browser
 * window (reference/note panel open beside it). The toolbar passes a raised
 * `wideThreshold` (820px) and compacts whenever it is NOT `wide` — full labels
 * need ~820px, so waiting for the 500px `narrow` tier used to leave a
 * 500–820px dead zone where the toolbar wrapped onto a second line instead of
 * compacting.
 *
 * Covers:
 *  - AC-01: the container-width signal drives compaction; full layout when wide.
 *  - AC-04: the "Claude" model chip collapses to icon-only when narrow while
 *    keeping the model name as its accessible name.
 *  - AC-02: the cwd chip collapses to the last folder name (basename) with the
 *    full path in its title, driven by the same container-narrow signal threaded
 *    down into ComposerMetaStrip.
 *  - Single-line regression: compaction already fires in the `medium` tier, and
 *    the meta strip lives inside a flex-basis-0 middle so it can never wrap the
 *    toolbar onto a second row.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Container-width mock — controlled per-test via setContainerWidthTier().
// ---------------------------------------------------------------------------

let currentTier: 'wide' | 'medium' | 'narrow' = 'wide';
let currentWidth = 900;

function setContainerWidth(tier: 'wide' | 'medium' | 'narrow', width: number) {
    currentTier = tier;
    currentWidth = width;
}

vi.mock('../../../../../src/server/spa/client/react/features/chat/hooks/useContainerWidth', () => ({
    useContainerWidth: () => ({
        width: currentWidth,
        tier: currentTier,
        isWide: currentTier === 'wide',
        isMedium: currentTier === 'medium',
        isNarrow: currentTier === 'narrow',
    }),
}));

// ---------------------------------------------------------------------------
// Standard FollowUpInputArea harness mocks (mirror the compact-toolbar test).
// ---------------------------------------------------------------------------

vi.mock('../../../../../src/server/spa/client/react/hooks/ui/useModifierKey', () => ({
    useModifierKey: () => false,
}));

vi.mock('../../../../../src/server/spa/client/react/ui', () => ({
    Button: ({ children, ...rest }: any) => <button {...rest}>{children}</button>,
    SuggestionChips: () => null,
    SendButton: () => <button data-testid="activity-chat-send-btn">Send</button>,
    QueueFollowUpButton: ({ onSend, iconOnly }: any) => (
        <button
            data-testid="activity-chat-send-btn"
            data-icon-only={iconOnly ? 'true' : 'false'}
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

vi.mock('../../../../../src/server/spa/client/react/features/chat/ModePillSelector', () => ({
    ModePillSelector: () => <div data-testid="mode-pill-selector-inner" />,
    DEFAULT_MODE_PILL_OPTIONS: [],
    RALPH_MODE_PILL_OPTION: { value: 'ralph', label: 'Ralph' },
    getVisibleModePillOptions: () => [
        { value: 'ask', label: 'Ask', dotClass: 'bg-yellow-500' },
        { value: 'autopilot', label: 'Autopilot', dotClass: 'bg-green-500' },
    ],
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

const MODEL_COMMAND = {
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
};

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
        modelCommand: { ...MODEL_COMMAND },
        sessionModel: 'claude-opus-4-8',
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

describe('FollowUpInputArea – container-driven compact footer', () => {
    beforeEach(() => {
        Element.prototype.scrollIntoView = vi.fn();
        setContainerWidth('wide', 900);
    });

    describe('AC-01 – container-width signal', () => {
        it('renders the full model label when the toolbar is wide (≥700px)', () => {
            setContainerWidth('wide', 900);
            render(<FollowUpInputArea {...defaultProps()} />);
            expect(screen.getByTestId('model-picker-chip-label')).toBeTruthy();
            expect(screen.getByTestId('model-picker-chip-label').textContent).toBe('claude-opus-4-8');
        });

        it('collapses to compact rendering when the measured width is below the narrow threshold', () => {
            setContainerWidth('narrow', 420);
            render(<FollowUpInputArea {...defaultProps()} />);
            // AC-04 compaction is visible: the model text label is dropped.
            expect(screen.queryByTestId('model-picker-chip-label')).toBeNull();
        });

        it('keeps the full layout when width is unmeasured (0) to avoid a compact flash', () => {
            setContainerWidth('narrow', 0);
            render(<FollowUpInputArea {...defaultProps()} />);
            // width 0 is "not yet measured" → full layout despite the narrow tier.
            expect(screen.getByTestId('model-picker-chip-label')).toBeTruthy();
        });

        it('compacts already in the medium tier (regression: 500–820px used to wrap instead)', () => {
            setContainerWidth('medium', 600);
            render(<FollowUpInputArea {...defaultProps({
                workingDirectory: '/Users/yihengtao/Documents/Projects/nanochat',
            })} />);
            // Anything below `wide` compacts: model chip icon-only + cwd basename.
            expect(screen.queryByTestId('model-picker-chip-label')).toBeNull();
            expect(screen.getByTestId('composer-cwd-path').textContent).toBe('nanochat');
        });
    });

    describe('Single-line toolbar – meta strip cannot force a wrap', () => {
        it('hosts the meta strip inside the flex-basis-0 flexible middle', () => {
            setContainerWidth('wide', 900);
            render(<FollowUpInputArea {...defaultProps({
                workingDirectory: '/Users/yihengtao/Documents/Projects/nanochat',
            })} />);
            const middle = screen.getByTestId('chat-toolbar-flex-middle');
            // basis-0 keeps the strip's hypothetical size at 0 so flex wrapping
            // never sees it as an overflowing item; flex-1 + min-w-0 make it
            // grow into free space and shrink by truncating the cwd path.
            expect(middle.className).toContain('flex-1');
            expect(middle.className).toContain('basis-0');
            expect(middle.className).toContain('min-w-0');
            const strip = screen.getByTestId('composer-meta-strip');
            expect(middle.contains(strip)).toBe(true);
        });

        it('hides the strip via container query instead of overlapping when free space runs out', () => {
            setContainerWidth('wide', 900);
            render(<FollowUpInputArea {...defaultProps({
                workingDirectory: '/Users/yihengtao/Documents/Projects/nanochat',
                sessionTokenLimit: 200_000,
                sessionCurrentTokens: 28_000,
            })} />);
            // The middle is an inline-size @container whose width equals the
            // toolbar's free space (basis-0). The strip's unshrinkable pieces
            // hide via container queries below their fit widths — regression
            // for the ctx gauge bleeding over the tools/send zone.
            const middle = screen.getByTestId('chat-toolbar-flex-middle');
            expect(middle.className).toContain('[container-type:inline-size]');
            const fitGate = screen.getByTestId('chat-toolbar-meta-fit-gate');
            expect(fitGate.className).toContain('[@container_(max-width:159px)]:hidden');
            expect(fitGate.contains(screen.getByTestId('composer-meta-strip'))).toBe(true);
            // The cwd group (chip + divider) is the first to go, keeping the
            // ctx gauge; the divider hides together with the chip.
            const cwdGroup = screen.getByTestId('composer-cwd-group');
            expect(cwdGroup.className).toContain('[@container_(max-width:319px)]:hidden');
            expect(cwdGroup.contains(screen.getByTestId('composer-cwd-chip'))).toBe(true);
        });

        it('keeps the flexible middle as a spacer when no meta content is present', () => {
            setContainerWidth('wide', 900);
            render(<FollowUpInputArea {...defaultProps()} />);
            // No cwd/ctx → the strip renders nothing, but the middle div still
            // exists to push the tools/send zone to the right edge.
            expect(screen.getByTestId('chat-toolbar-flex-middle')).toBeTruthy();
            expect(screen.queryByTestId('composer-meta-strip')).toBeNull();
        });
    });

    describe('AC-04 – model chip → icon only when narrow', () => {
        it('hides the model text label when narrow but keeps the accessible name', () => {
            setContainerWidth('narrow', 420);
            render(<FollowUpInputArea {...defaultProps()} />);
            const chip = screen.getByTestId('model-picker-chip');
            expect(screen.queryByTestId('model-picker-chip-label')).toBeNull();
            expect(chip.getAttribute('aria-label')).toBe('Model: claude-opus-4-8');
        });

        it('shows icon + model name when wide, with the accessible name preserved', () => {
            setContainerWidth('wide', 900);
            render(<FollowUpInputArea {...defaultProps()} />);
            const chip = screen.getByTestId('model-picker-chip');
            expect(screen.getByTestId('model-picker-chip-label').textContent).toBe('claude-opus-4-8');
            expect(chip.getAttribute('aria-label')).toBe('Model: claude-opus-4-8');
        });

        it('uses the model override in the accessible name when one is active', () => {
            setContainerWidth('narrow', 420);
            render(<FollowUpInputArea {...defaultProps({
                modelCommand: { ...MODEL_COMMAND, modelOverride: 'claude-sonnet-4-6' },
            })} />);
            expect(screen.getByTestId('model-picker-chip').getAttribute('aria-label'))
                .toBe('Model: claude-sonnet-4-6');
        });
    });

    describe('AC-02 – cwd chip → basename when narrow (prop threaded)', () => {
        const CWD = '/Users/yihengtao/Documents/Projects/nanochat';

        it('shows only the last folder name and drops the cwd label when narrow', () => {
            setContainerWidth('narrow', 420);
            render(<FollowUpInputArea {...defaultProps({ workingDirectory: CWD })} />);
            const chip = screen.getByTestId('composer-cwd-chip');
            expect(screen.getByTestId('composer-cwd-path').textContent).toBe('nanochat');
            expect(chip.textContent).not.toMatch(/\bcwd\b/);
            // Full path preserved in the title tooltip.
            expect(chip.getAttribute('title')).toBe(`Working directory: ${CWD}`);
        });

        it('shows the head-truncated path and cwd label when wide', () => {
            setContainerWidth('wide', 900);
            render(<FollowUpInputArea {...defaultProps({ workingDirectory: CWD })} />);
            const chip = screen.getByTestId('composer-cwd-chip');
            // Wide keeps the ellipsis-prefixed head-truncated form + the `cwd` label.
            expect(screen.getByTestId('composer-cwd-path').textContent?.startsWith('…')).toBe(true);
            expect(chip.querySelector('span[class*="uppercase"]')?.textContent).toBe('cwd');
        });
    });

    describe('Tight tier (<500px) – mobile controls driven by the container signal', () => {
        it('keeps the desktop controls at medium width (500–819px)', () => {
            setContainerWidth('medium', 600);
            render(<FollowUpInputArea {...defaultProps()} />);
            expect(screen.getByTestId('mode-selector')).toBeTruthy();
            expect(screen.getByTestId('chat-toolbar-slash-btn')).toBeTruthy();
            expect(screen.getByTestId('follow-up-attach-btn')).toBeTruthy();
            expect(screen.queryByTestId('chat-toolbar-mention-btn')).toBeNull();
            // The mobile fallbacks stay viewport-gated (hidden on lg+).
            expect(screen.getByTestId('chat-toolbar-overflow').className).toContain('lg:hidden');
            expect(screen.getByTestId('mode-cycle-btn-compact').className).toContain('lg:hidden');
        });

        it('swaps the mode pills for the cycle button when the pane is tight', () => {
            setContainerWidth('narrow', 420);
            render(<FollowUpInputArea {...defaultProps()} />);
            expect(screen.queryByTestId('mode-selector')).toBeNull();
            // The cycle button loses its lg:hidden gate so it shows on desktop too.
            expect(screen.getByTestId('mode-cycle-btn-compact').className).not.toContain('lg:hidden');
        });

        it('folds slash/attach into the overflow menu when the pane is tight', () => {
            setContainerWidth('narrow', 420);
            render(<FollowUpInputArea {...defaultProps()} />);
            expect(screen.queryByTestId('chat-toolbar-slash-btn')).toBeNull();
            expect(screen.queryByTestId('chat-toolbar-mention-btn')).toBeNull();
            expect(screen.queryByTestId('follow-up-attach-btn')).toBeNull();
            expect(screen.getByTestId('chat-toolbar-overflow').className).not.toContain('lg:hidden');
            expect(screen.getByTestId('chat-toolbar-overflow-btn')).toBeTruthy();
        });

        it('keeps provider and Send labels down to 380px', () => {
            setContainerWidth('narrow', 420);
            render(<FollowUpInputArea {...defaultProps()} />);
            expect(screen.getByTestId('agent-selector-chip-label')).toBeTruthy();
            expect(screen.getByTestId('activity-chat-send-btn').getAttribute('data-icon-only')).toBe('false');
        });
    });

    describe('Minimal tier (<380px) – icon-only provider chip and Send', () => {
        it('drops the provider label but keeps the accessible name', () => {
            setContainerWidth('narrow', 320);
            render(<FollowUpInputArea {...defaultProps()} />);
            expect(screen.queryByTestId('agent-selector-chip-label')).toBeNull();
            expect(screen.getByTestId('agent-selector-chip-btn').getAttribute('aria-label')).toContain('Copilot');
        });

        it('sends the icon-only signal to the Send button', () => {
            setContainerWidth('narrow', 320);
            render(<FollowUpInputArea {...defaultProps()} />);
            expect(screen.getByTestId('activity-chat-send-btn').getAttribute('data-icon-only')).toBe('true');
        });

        it('keeps full labels when width is unmeasured (0)', () => {
            setContainerWidth('narrow', 0);
            render(<FollowUpInputArea {...defaultProps()} />);
            expect(screen.getByTestId('agent-selector-chip-label')).toBeTruthy();
            expect(screen.getByTestId('mode-selector')).toBeTruthy();
            expect(screen.getByTestId('activity-chat-send-btn').getAttribute('data-icon-only')).toBe('false');
        });
    });

    describe('AC-03 – Effort tier selector drops the "Effort:" prefix when narrow', () => {
        const tierProps = {
            useEffortTierMode: true,
            selectedEffortTier: 'medium' as const,
            onEffortTierChange: vi.fn(),
            effortTierMap: {
                'very-low': { model: 'gpt-5.4-mini', reasoningEffort: 'low', source: 'default' as const },
                low: { model: 'gpt-5-mini', reasoningEffort: 'low', source: 'config' as const },
                medium: { model: 'gpt-5', reasoningEffort: '', source: 'default' as const },
                high: { model: 'gpt-5-pro', reasoningEffort: 'high', source: 'config' as const },
            },
        };

        it('shows only the tier value (no "Effort:" word) when narrow', () => {
            setContainerWidth('narrow', 420);
            render(<FollowUpInputArea {...defaultProps(tierProps)} />);
            const label = screen.getByTestId('effort-tier-label');
            expect(label.textContent).toBe('Medium');
            expect(label.textContent).not.toMatch(/Effort:/);
        });

        it('shows "Effort: <tier>" when wide', () => {
            setContainerWidth('wide', 900);
            render(<FollowUpInputArea {...defaultProps(tierProps)} />);
            expect(screen.getByTestId('effort-tier-label').textContent).toBe('Effort: Medium');
        });
    });
});
