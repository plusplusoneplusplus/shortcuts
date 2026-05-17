/**
 * @vitest-environment jsdom
 *
 * Tests for file attachment support in FollowUpInputArea:
 * - "+" button renders and triggers file input
 * - Attachment previews render
 * - Paste delegates to onAttachmentPaste
 * - Attachment error displays
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
    SendButton: ({ disabled, ctrlHeld, onSend, ...rest }: any) => (
        <button data-testid="activity-chat-send-btn" onClick={() => onSend('enqueue')}>Send</button>
    ),
    QueueFollowUpButton: ({ disabled, onSend, ...rest }: any) => (
        <button
            data-testid={rest['data-testid'] ?? 'activity-chat-send-btn'}
            disabled={disabled}
            onClick={() => onSend('enqueue')}
        >
            Send
        </button>
    ),
}));

let capturedAttachments: any[] = [];
vi.mock('../../../../../src/server/spa/client/react/ui/AttachmentPreviews', () => ({
    AttachmentPreviews: ({ attachments, onRemove }: any) => {
        capturedAttachments = attachments;
        return (
            <div data-testid="attachment-previews">
                {(attachments ?? []).map((a: any) => (
                    <div key={a.id} data-testid={`attachment-${a.id}`}>
                        {a.name}
                        <button data-testid={`remove-${a.id}`} onClick={() => onRemove(a.id)}>×</button>
                    </div>
                ))}
            </div>
        );
    },
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FollowUpInputArea – file attachments', () => {
    beforeEach(() => {
        capturedAttachments = [];
    });

    it('renders the attach button (paperclip icon)', () => {
        render(<FollowUpInputArea {...defaultProps()} />);
        const btn = screen.getByTestId('follow-up-attach-btn');
        expect(btn).toBeTruthy();
        // New stacked layout renders a paperclip SVG icon instead of text
        expect(btn.querySelector('svg')).not.toBeNull();
        expect(btn.getAttribute('aria-label')).toBe('Attach file');
    });

    it('renders hidden file input', () => {
        render(<FollowUpInputArea {...defaultProps()} />);
        const input = screen.getByTestId('follow-up-file-input-hidden');
        expect(input).toBeTruthy();
        expect(input.getAttribute('type')).toBe('file');
        expect(input.hasAttribute('multiple')).toBe(true);
        expect(input.className).toContain('hidden');
    });

    it('clicking "+" triggers file input click', () => {
        render(<FollowUpInputArea {...defaultProps()} />);
        const fileInput = screen.getByTestId('follow-up-file-input-hidden') as HTMLInputElement;
        const clickSpy = vi.spyOn(fileInput, 'click');
        const attachBtn = screen.getByTestId('follow-up-attach-btn');
        fireEvent.click(attachBtn);
        expect(clickSpy).toHaveBeenCalled();
    });

    it('"+" button is disabled when inputDisabled=true', () => {
        render(<FollowUpInputArea {...defaultProps({ inputDisabled: true })} />);
        const btn = screen.getByTestId('follow-up-attach-btn') as HTMLButtonElement;
        expect(btn.disabled).toBe(true);
    });

    it('renders AttachmentPreviews with passed attachments', () => {
        const attachments = [
            { id: 'a1', name: 'file.txt', mimeType: 'text/plain', size: 100, dataUrl: 'data:text/plain;base64,aGVsbG8=', category: 'text' as const },
            { id: 'a2', name: 'img.png', mimeType: 'image/png', size: 200, dataUrl: 'data:image/png;base64,abc', category: 'image' as const },
        ];
        render(<FollowUpInputArea {...defaultProps({ attachments })} />);
        expect(screen.getByTestId('attachment-previews')).toBeTruthy();
        expect(screen.getByTestId('attachment-a1')).toBeTruthy();
        expect(screen.getByTestId('attachment-a2')).toBeTruthy();
        expect(capturedAttachments).toHaveLength(2);
    });

    it('calls onAttachmentRemove when remove button clicked', () => {
        const onRemove = vi.fn();
        const attachments = [
            { id: 'a1', name: 'file.txt', mimeType: 'text/plain', size: 100, dataUrl: 'data:text/plain;base64,aGVsbG8=', category: 'text' as const },
        ];
        render(<FollowUpInputArea {...defaultProps({ attachments, onAttachmentRemove: onRemove })} />);
        fireEvent.click(screen.getByTestId('remove-a1'));
        expect(onRemove).toHaveBeenCalledWith('a1');
    });

    it('calls onAttachmentFiles when files selected via file input', () => {
        const onFiles = vi.fn();
        render(<FollowUpInputArea {...defaultProps({ onAttachmentFiles: onFiles })} />);
        const input = screen.getByTestId('follow-up-file-input-hidden') as HTMLInputElement;
        const file = new File(['hello'], 'test.txt', { type: 'text/plain' });
        Object.defineProperty(input, 'files', { value: [file], writable: false });
        Object.defineProperty(input, 'value', { value: 'C:\\test.txt', writable: true });
        fireEvent.change(input);
        expect(onFiles).toHaveBeenCalledTimes(1);
    });

    it('shows attachment error when present', () => {
        render(<FollowUpInputArea {...defaultProps({ attachmentError: 'File too large' })} />);
        const errorEl = screen.getByTestId('follow-up-attachment-error');
        expect(errorEl).toBeTruthy();
        expect(errorEl.textContent).toBe('File too large');
    });

    it('does not show attachment error when null', () => {
        render(<FollowUpInputArea {...defaultProps({ attachmentError: null })} />);
        expect(screen.queryByTestId('follow-up-attachment-error')).toBeNull();
    });

    it('renders empty AttachmentPreviews with no attachments', () => {
        render(<FollowUpInputArea {...defaultProps({ attachments: [] })} />);
        expect(screen.getByTestId('attachment-previews')).toBeTruthy();
        expect(capturedAttachments).toHaveLength(0);
    });
});
