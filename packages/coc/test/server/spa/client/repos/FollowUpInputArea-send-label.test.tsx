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
    QueueFollowUpButton: ({ disabled, ctrlHeld, onSend, label, ...rest }: any) => {
        const testId = rest['data-testid'] ?? 'activity-chat-send-btn';
        const steering = ctrlHeld;
        const text = steering ? 'Steer' : (label ?? 'Send');
        return (
            <button
                disabled={disabled}
                className={steering ? 'bg-[#e8912d] text-white hover:bg-[#c97a25] border border-transparent' : 'bg-white border border-[#d0d0d0]'}
                onClick={() => onSend(steering ? 'immediate' : 'enqueue')}
                data-testid={testId}
                title={steering ? 'Release Ctrl to queue instead' : 'Send (Enter) · Ctrl+Enter to steer AI · Shift+Enter for newline'}
            >
                {steering ? '⚡' : '✉'} {text}
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
    META_SKILL_ITEMS: [],
}));

vi.mock('../../../../../src/server/spa/client/react/features/chat/ModelCommandMenu', () => ({
    ModelCommandMenu: () => null,
}));

vi.mock('../../../../../src/server/spa/client/react/features/chat/ModePillSelector', () => ({
    ModePillSelector: () => null,
    DEFAULT_MODE_PILL_OPTIONS: [
        { value: 'ask', label: 'Ask', dotClass: 'bg-blue-500' },
        { value: 'plan', label: 'Plan', dotClass: 'bg-blue-500' },
        { value: 'autopilot', label: 'Autopilot', dotClass: 'bg-orange-500' },
    ],
}));

vi.mock('../../../../../src/server/spa/client/react/repos/modeConfig', () => ({
    MODE_BORDER_COLORS: {
        ask: { border: '', ring: '' },
        plan: { border: '', ring: '' },
        autopilot: { border: '', ring: '' },
    },
    MODE_ICONS: { ask: '?', plan: 'P', autopilot: 'A' },
    MODE_LABELS: { ask: 'Ask', plan: 'Plan', autopilot: 'Autopilot' },
    MODE_TOOLTIPS: { ask: 'Ask tooltip', plan: 'Plan tooltip', autopilot: 'Autopilot tooltip' },
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

function getSendButton() {
    return screen.getByTestId('activity-chat-send-btn');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FollowUpInputArea – single send button (new stacked layout)', () => {
    beforeEach(() => {
        mockModHeld = false;
    });

    it('shows "Send" by default (no modifier)', () => {
        render(<FollowUpInputArea {...defaultProps()} />);
        expect(getSendButton().textContent).toContain('Send');
    });

    it('shows Stop button when active generation is true, even if sending is false', () => {
        render(<FollowUpInputArea {...defaultProps({ isActiveGeneration: true, sending: false })} />);
        expect(screen.getByTestId('activity-chat-stop-btn')).toBeTruthy();
        expect(screen.queryByTestId('activity-chat-send-btn')).toBeNull();
        expect(screen.queryByTestId('split-send-group')).toBeNull();
    });

    it('keeps Send visible but disabled during local request submission', () => {
        render(<FollowUpInputArea {...defaultProps({ sending: true, isActiveGeneration: false })} />);
        expect(screen.queryByTestId('activity-chat-stop-btn')).toBeNull();
        const sendButton = getSendButton();
        expect(sendButton.textContent).toContain('Send');
        expect(sendButton.hasAttribute('disabled')).toBe(true);
    });

    it('shows cancelling state and blocks duplicate stop clicks', () => {
        const onStop = vi.fn();
        render(<FollowUpInputArea {...defaultProps({ isActiveGeneration: true, isCancelling: true, onStop })} />);
        const stopButton = screen.getByTestId('activity-chat-stop-btn');
        expect(stopButton.textContent).toBe('Stopping...');
        expect(stopButton.hasAttribute('disabled')).toBe(true);
        stopButton.click();
        expect(onStop).not.toHaveBeenCalled();
    });

    it('shows "Steer" when Ctrl is held', () => {
        mockModHeld = true;
        render(<FollowUpInputArea {...defaultProps()} />);
        expect(getSendButton().textContent).toContain('Steer');
        expect(getSendButton().textContent).not.toContain('Queue follow-up');
    });

    it('shows Stop button when Ctrl is held and active generation is true', () => {
        mockModHeld = true;
        render(<FollowUpInputArea {...defaultProps({ isActiveGeneration: true })} />);
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

    it('applies outlined white background when not in steering mode', () => {
        render(<FollowUpInputArea {...defaultProps()} />);
        const btn = getSendButton();
        expect(btn.className).toContain('bg-white');
        expect(btn.className).toContain('border');
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
