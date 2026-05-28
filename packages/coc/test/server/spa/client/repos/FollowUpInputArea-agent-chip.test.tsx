/**
 * @vitest-environment jsdom
 *
 * Tests that the disabled AgentSelectorChip renders leftmost in the
 * FollowUpInputArea toolbar and reflects the active provider.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

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
    QueueFollowUpButton: ({ onSend, ...rest }: any) => (
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
    ModePillSelector: () => null,
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
    cycleMode: (m: string) => m,
}));

vi.mock('@plusplusoneplusplus/forge', () => ({}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { FollowUpInputArea } from '../../../../../src/server/spa/client/react/features/chat/FollowUpInputArea';
import { createRef } from 'react';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FollowUpInputArea – disabled AgentSelectorChip', () => {
    beforeEach(() => {
        Element.prototype.scrollIntoView = vi.fn();
    });

    it('renders the agent selector chip', () => {
        render(<FollowUpInputArea {...defaultProps()} />);
        expect(screen.getByTestId('agent-selector-chip-btn')).toBeTruthy();
    });

    it('renders the chip as disabled', () => {
        render(<FollowUpInputArea {...defaultProps()} />);
        const chip = screen.getByTestId('agent-selector-chip-btn');
        expect(chip).toHaveProperty('disabled', true);
    });

    it('shows "Copilot" when activeProvider is undefined', () => {
        render(<FollowUpInputArea {...defaultProps()} />);
        const chip = screen.getByTestId('agent-selector-chip-btn');
        expect(chip.textContent).toContain('Copilot');
    });

    it('shows "Codex" when activeProvider is codex', () => {
        render(<FollowUpInputArea {...defaultProps({ activeProvider: 'codex' })} />);
        const chip = screen.getByTestId('agent-selector-chip-btn');
        expect(chip.textContent).toContain('Codex');
    });

    it('shows "Claude" when activeProvider is claude', () => {
        render(<FollowUpInputArea {...defaultProps({ activeProvider: 'claude' })} />);
        const chip = screen.getByTestId('agent-selector-chip-btn');
        expect(chip.textContent).toContain('Claude');
    });

    it('renders the provider divider after the chip', () => {
        render(<FollowUpInputArea {...defaultProps()} />);
        expect(screen.getByTestId('chat-toolbar-divider-provider')).toBeTruthy();
    });

    it('does not open the provider menu when the chip is clicked (disabled)', () => {
        render(<FollowUpInputArea {...defaultProps()} />);
        const chip = screen.getByTestId('agent-selector-chip-btn');
        chip.click();
        expect(screen.queryByTestId('agent-selector-menu')).toBeNull();
    });
});
