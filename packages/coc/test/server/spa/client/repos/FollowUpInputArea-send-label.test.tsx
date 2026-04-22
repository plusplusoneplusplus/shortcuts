/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks – declared before importing component under test
// ---------------------------------------------------------------------------

let mockModHeld = false;
vi.mock('../../../../../src/server/spa/client/react/hooks/ui/useModifierKey', () => ({
    useModifierKey: () => mockModHeld,
}));

vi.mock('../../../../../src/server/spa/client/react/ui', () => ({
    Button: ({ children, ...rest }: any) => <button {...rest}>{children}</button>,
    SuggestionChips: () => null,
    SendButton: ({ disabled, ctrlHeld, onSend, ...rest }: any) => {
        const testId = rest['data-testid'] ?? 'activity-chat-send-btn';
        const steering = ctrlHeld;
        return (
            <button
                disabled={disabled}
                className={steering ? 'bg-[#e8912d] hover:bg-[#c97a25]' : 'bg-[#0078d4] hover:bg-[#106ebe]'}
                onClick={() => onSend(steering ? 'immediate' : 'enqueue')}
                data-testid={testId}
                title={steering ? 'Release Ctrl to queue instead' : 'Send (Enter) · Ctrl+Enter to steer AI · Shift+Enter for newline'}
            >
                {steering ? '⚡ Steer' : 'Send'}
            </button>
        );
    },
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
}));

vi.mock('../../../../../src/server/spa/client/react/repos/modeConfig', () => ({
    MODE_BORDER_COLORS: {
        ask: { border: '', ring: '' },
        plan: { border: '', ring: '' },
        autopilot: { border: '', ring: '' },
    },
    MODE_ICONS: { ask: '?', plan: 'P', autopilot: 'A' },
    MODE_LABELS: { ask: 'Ask', plan: 'Plan', autopilot: 'Autopilot' },
    cycleMode: (m: string) => m,
}));

vi.mock('@plusplusoneplusplus/forge', () => ({}));

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

function getSendButton() {
    return screen.getByTestId('activity-chat-send-btn');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FollowUpInputArea – single send button', () => {
    beforeEach(() => {
        mockModHeld = false;
    });

    it('shows "Send" by default (no modifier)', () => {
        render(<FollowUpInputArea {...defaultProps()} />);
        expect(getSendButton().textContent).toBe('Send');
    });

    it('shows Stop button when sending=true (no split button)', () => {
        render(<FollowUpInputArea {...defaultProps({ sending: true })} />);
        expect(screen.getByTestId('activity-chat-stop-btn')).toBeTruthy();
        expect(screen.queryByTestId('activity-chat-send-btn')).toBeNull();
        expect(screen.queryByTestId('split-send-group')).toBeNull();
    });

    it('shows "⚡ Steer" when Ctrl is held', () => {
        mockModHeld = true;
        render(<FollowUpInputArea {...defaultProps()} />);
        expect(getSendButton().textContent).toBe('⚡ Steer');
    });

    it('shows Stop button when Ctrl is held and sending=true', () => {
        mockModHeld = true;
        render(<FollowUpInputArea {...defaultProps({ sending: true })} />);
        expect(screen.getByTestId('activity-chat-stop-btn')).toBeTruthy();
        expect(screen.queryByTestId('activity-chat-send-btn')).toBeNull();
        expect(screen.queryByTestId('split-send-group')).toBeNull();
    });

    it('applies orange background when modHeld', () => {
        mockModHeld = true;
        render(<FollowUpInputArea {...defaultProps()} />);
        const btn = getSendButton();
        expect(btn.className).toContain('bg-[#e8912d]');
        expect(btn.className).toContain('hover:bg-[#c97a25]');
    });

    it('applies default blue background when not in steering mode', () => {
        render(<FollowUpInputArea {...defaultProps()} />);
        const btn = getSendButton();
        expect(btn.className).toContain('bg-[#0078d4]');
        expect(btn.className).toContain('hover:bg-[#106ebe]');
    });

    it('shows modifier-held tooltip when Ctrl is held', () => {
        mockModHeld = true;
        render(<FollowUpInputArea {...defaultProps()} />);
        expect(getSendButton().title).toBe('Release Ctrl to queue instead');
    });

    it('shows default tooltip when no modifier is held', () => {
        render(<FollowUpInputArea {...defaultProps()} />);
        expect(getSendButton().title).toBe('Send (Enter) · Ctrl+Enter to steer AI · Shift+Enter for newline');
    });
});
