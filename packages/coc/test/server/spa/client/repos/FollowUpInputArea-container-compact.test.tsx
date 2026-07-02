/**
 * @vitest-environment jsdom
 *
 * Tests for the CONTAINER-width driven compact composer footer.
 *
 * Unlike the viewport-driven (`lg:` / `sm:`) compaction covered by
 * FollowUpInputArea-compact-toolbar.test.tsx, these behaviours fire when the
 * toolbar measures its OWN width below the `narrow` threshold (<500px) via the
 * `useContainerWidth` hook — so the footer compacts when the composer pane is
 * narrow even on a wide browser window (reference/note panel open beside it).
 *
 * Covers:
 *  - AC-01: the container-width signal drives compaction; full layout when wide.
 *  - AC-04: the "Claude" model chip collapses to icon-only when narrow while
 *    keeping the model name as its accessible name.
 *  - AC-02: the cwd chip collapses to the last folder name (basename) with the
 *    full path in its title, driven by the same container-narrow signal threaded
 *    down into ComposerMetaStrip.
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
    QueueFollowUpButton: ({ onSend }: any) => (
        <button data-testid="activity-chat-send-btn" onClick={() => onSend('enqueue')}>Send</button>
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
});
