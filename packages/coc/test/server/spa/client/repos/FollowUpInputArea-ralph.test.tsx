/**
 * @vitest-environment jsdom
 *
 * Ralph-pill gating + Ralph-mode visual cues for FollowUpInputArea.
 *
 * Verifies:
 *   1. Ralph pill is added to ModePillSelector options only when `allowedModes`
 *      includes 'ralph'.
 *   2. Selecting Ralph flips the queue-button label to "Promote to Ralph".
 *   3. The purple Ralph hint banner is shown above the input when ralph is
 *      selected and hidden otherwise.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let mockModHeld = false;
vi.mock('../../../../../src/server/spa/client/react/hooks/ui/useModifierKey', () => ({
    useModifierKey: () => mockModHeld,
}));

vi.mock('../../../../../src/server/spa/client/react/ui', () => ({
    Button: ({ children, ...rest }: any) => <button {...rest}>{children}</button>,
    SuggestionChips: () => null,
    SendButton: ({ disabled, onSend, ...rest }: any) => (
        <button disabled={disabled} onClick={() => onSend('immediate')} data-testid={rest['data-testid'] ?? 'activity-chat-send-btn'}>
            Send
        </button>
    ),
    QueueFollowUpButton: ({ disabled, onSend, label, ...rest }: any) => (
        <button disabled={disabled} onClick={() => onSend('enqueue')} data-testid={rest['data-testid'] ?? 'activity-chat-send-btn'}>
            {label ?? 'Send'}
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

// ModePillSelector mock renders each option as a span so tests can assert
// what the parent passed in (including the Ralph option when eligible).
vi.mock('../../../../../src/server/spa/client/react/features/chat/ModePillSelector', () => ({
    ModePillSelector: ({ options }: { options: Array<{ value: string; label: string }> }) => (
        <div data-testid="mode-pill-selector">
            {options.map((o) => (
                <span key={o.value} data-testid={`mode-pill-option-${o.value}`}>{o.label}</span>
            ))}
        </div>
    ),
    DEFAULT_MODE_PILL_OPTIONS: [
        { value: 'ask', label: 'Ask', dotClass: 'bg-yellow-500' },
        { value: 'autopilot', label: 'Autopilot', dotClass: 'bg-green-500' },
    ],
    RALPH_MODE_PILL_OPTION: { value: 'ralph', label: 'Ralph', dotClass: 'bg-purple-500' },
    getVisibleModePillOptions: ({ allowedModes }: { allowedModes?: readonly string[] } = {}) => {
        const all = [
            { value: 'ask', label: 'Ask', dotClass: 'bg-yellow-500' },
            { value: 'autopilot', label: 'Autopilot', dotClass: 'bg-green-500' },
            { value: 'ralph', label: 'Ralph', dotClass: 'bg-purple-500' },
        ];
        return allowedModes ? all.filter(o => allowedModes.includes(o.value)) : all.filter(o => o.value !== 'ralph');
    },
}));

vi.mock('../../../../../src/server/spa/client/react/repos/modeConfig', () => ({
    MODE_BORDER_COLORS: {
        ask: { border: '', ring: '' },
        autopilot: { border: '', ring: '' },
        ralph: { border: '', ring: '' },
    },
    MODE_ICONS: { ask: '?', autopilot: 'A', ralph: 'R' },
    MODE_LABELS: { ask: 'Ask', autopilot: 'Autopilot', ralph: 'Ralph' },
    MODE_TOOLTIPS: {
        ask: 'Ask tooltip',
        autopilot: 'Autopilot tooltip',
        ralph: 'Ralph tooltip',
    },
    cycleMode: (m: string) => m,
}));

vi.mock('@plusplusoneplusplus/forge', () => ({}));

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
        selectedMode: 'ask' as any,
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

describe('FollowUpInputArea — Ralph pill gating and visual cues', () => {
    beforeEach(() => {
        mockModHeld = false;
    });

    it('does NOT render the Ralph pill option when allowedModes is undefined', () => {
        render(<FollowUpInputArea {...defaultProps()} />);
        expect(screen.queryByTestId('mode-pill-option-ralph')).toBeNull();
        expect(screen.getByTestId('mode-pill-option-ask')).toBeTruthy();
    });

    it('does NOT render the Ralph pill option when allowedModes omits ralph', () => {
        render(<FollowUpInputArea {...defaultProps({ allowedModes: ['ask', 'autopilot'] as any })} />);
        expect(screen.queryByTestId('mode-pill-option-ralph')).toBeNull();
    });

    it('renders the Ralph pill option when allowedModes includes ralph', () => {
        render(<FollowUpInputArea {...defaultProps({ allowedModes: ['ask', 'ralph'] as any })} />);
        expect(screen.getByTestId('mode-pill-option-ralph')).toBeTruthy();
        expect(screen.getByTestId('mode-pill-option-ask')).toBeTruthy();
    });

    it('flips the queue-button label to "Promote to Ralph" when ralph is selected', () => {
        render(<FollowUpInputArea {...defaultProps({
            selectedMode: 'ralph' as any,
            allowedModes: ['ask', 'ralph'] as any,
        })} />);
        const btn = screen.getByTestId('activity-chat-send-btn');
        expect(btn.textContent).toContain('Promote to Ralph');
    });

    it('keeps the default "Send" label when ralph is not selected', () => {
        render(<FollowUpInputArea {...defaultProps({ allowedModes: ['ask', 'ralph'] as any })} />);
        const btn = screen.getByTestId('activity-chat-send-btn');
        expect(btn.textContent).toContain('Send');
        expect(btn.textContent).not.toContain('Promote to Ralph');
    });

    it('shows the Ralph hint banner when ralph is selected', () => {
        render(<FollowUpInputArea {...defaultProps({
            selectedMode: 'ralph' as any,
            allowedModes: ['ask', 'ralph'] as any,
        })} />);
        expect(screen.getByTestId('follow-up-ralph-hint')).toBeTruthy();
    });

    it('does NOT show the Ralph hint banner when ralph is not selected', () => {
        render(<FollowUpInputArea {...defaultProps()} />);
        expect(screen.queryByTestId('follow-up-ralph-hint')).toBeNull();
    });
});
