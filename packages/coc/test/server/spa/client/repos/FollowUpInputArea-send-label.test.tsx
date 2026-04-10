/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks – declared before importing component under test
// ---------------------------------------------------------------------------

let mockModHeld = false;
vi.mock('../../../../../src/server/spa/client/react/hooks/useModifierKey', () => ({
    useModifierKey: () => mockModHeld,
}));

vi.mock('../../../../../src/server/spa/client/react/shared', () => ({
    Button: ({ children, ...rest }: any) => <button {...rest}>{children}</button>,
    SuggestionChips: () => null,
}));

vi.mock('../../../../../src/server/spa/client/react/shared/ImagePreviews', () => ({
    ImagePreviews: () => null,
}));

vi.mock('../../../../../src/server/spa/client/react/shared/PastePreview', () => ({
    PastePreview: () => null,
}));

vi.mock('../../../../../src/server/spa/client/react/shared/cn', () => ({
    cn: (...classes: any[]) => classes.filter(Boolean).join(' '),
}));

vi.mock('../../../../../src/server/spa/client/react/shared/RichTextInput', () => ({
    RichTextInput: vi.fn().mockImplementation(() => null),
}));

vi.mock('../../../../../src/server/spa/client/react/repos/SlashCommandMenu', () => ({
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

import { FollowUpInputArea } from '../../../../../src/server/spa/client/react/repos/FollowUpInputArea';
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
        images: [],
        onImagePaste: vi.fn(),
        onImageRemove: vi.fn(),
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

function getSendButton() {
    return screen.getByTestId('activity-chat-send-btn');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FollowUpInputArea – dynamic send button label', () => {
    beforeEach(() => {
        mockModHeld = false;
    });

    it('shows "Send" by default (not sending, no modifier)', () => {
        render(<FollowUpInputArea {...defaultProps()} />);
        expect(getSendButton().textContent).toBe('Send');
    });

    it('shows "Queue" when sending=true and no modifier', () => {
        render(<FollowUpInputArea {...defaultProps({ sending: true })} />);
        expect(getSendButton().textContent).toBe('Queue');
    });

    it('shows "⚡ Steer" when sending=true and Ctrl is held', () => {
        mockModHeld = true;
        render(<FollowUpInputArea {...defaultProps({ sending: true })} />);
        expect(getSendButton().textContent).toBe('⚡ Steer');
    });

    it('shows "⚡ Send Now" when not sending and Ctrl is held', () => {
        mockModHeld = true;
        render(<FollowUpInputArea {...defaultProps()} />);
        expect(getSendButton().textContent).toBe('⚡ Send Now');
    });

    it('applies orange background when modHeld && sending', () => {
        mockModHeld = true;
        render(<FollowUpInputArea {...defaultProps({ sending: true })} />);
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
