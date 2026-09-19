/**
 * @vitest-environment jsdom
 *
 * Tests that the disabled AgentSelectorChip renders leftmost in the
 * FollowUpInputArea toolbar and reflects the active provider.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

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

    it('explains that the concrete follow-up provider is locked and never offers Auto', () => {
        render(<FollowUpInputArea {...defaultProps({ activeProvider: 'codex' })} />);
        const chip = screen.getByTestId('agent-selector-chip-btn');

        expect(chip).toHaveTextContent('Codex');
        expect(chip).toHaveAttribute('title', 'Agent: Codex (locked to this conversation)');

        chip.click();
        expect(screen.queryByTestId('agent-selector-menu')).toBeNull();
        expect(screen.queryByTestId('agent-option-auto')).toBeNull();
    });
});

const PROVIDERS = [
    { id: 'copilot' as const, label: 'Copilot', enabled: true, available: true },
    { id: 'codex' as const, label: 'Codex', enabled: true, available: true },
    { id: 'claude' as const, label: 'Claude', enabled: true, available: true },
    { id: 'opencode' as const, label: 'OpenCode', enabled: false, available: false, reason: 'Not configured' },
];

describe('FollowUpInputArea – provider switching', () => {
    beforeEach(() => {
        Element.prototype.scrollIntoView = vi.fn();
    });

    function renderEnabled(overrides: Partial<Parameters<typeof FollowUpInputArea>[0]> = {}) {
        const onProviderChange = vi.fn();
        render(<FollowUpInputArea {...defaultProps({
            activeProvider: 'copilot',
            selectedProvider: 'copilot',
            providerOptions: PROVIDERS,
            onProviderChange,
            ...overrides,
        })} />);
        return onProviderChange;
    }

    it('lists concrete owning-server providers without Auto and exposes unavailable reasons', () => {
        renderEnabled();
        fireEvent.click(screen.getByTestId('agent-selector-chip-btn'));

        expect(screen.queryByTestId('agent-option-auto')).toBeNull();
        expect(screen.getByTestId('agent-option-codex')).toBeEnabled();
        expect(screen.getByTestId('agent-option-opencode')).toBeDisabled();
        expect(screen.getByTestId('agent-option-opencode')).toHaveAttribute('title', 'Not configured');
    });

    it('requires the exact non-lossless warning before changing the pending provider', () => {
        const onProviderChange = renderEnabled();
        fireEvent.click(screen.getByTestId('agent-selector-chip-btn'));
        fireEvent.click(screen.getByTestId('agent-option-codex'));

        expect(onProviderChange).not.toHaveBeenCalled();
        expect(screen.getByText('Switch from Copilot to Codex?')).toBeTruthy();
        expect(screen.getByText(/bounded reconstruction of this conversation, but the transfer is not lossless/)).toBeTruthy();
        expect(screen.getByText(/Some earlier details, tool results, images, or provider-specific state may be omitted/)).toBeTruthy();
        expect(screen.getByText(/visible chat history, workspace files, and git state will not be changed/)).toBeTruthy();
    });

    it('Cancel leaves the pending provider unchanged and restores focus', async () => {
        const onProviderChange = renderEnabled();
        const chip = screen.getByTestId('agent-selector-chip-btn');
        fireEvent.click(chip);
        fireEvent.click(screen.getByTestId('agent-option-codex'));
        fireEvent.click(screen.getByTestId('provider-switch-cancel'));

        expect(onProviderChange).not.toHaveBeenCalled();
        expect(screen.queryByText('Switch from Copilot to Codex?')).toBeNull();
        await waitFor(() => expect(chip).toHaveFocus());
    });

    it('Escape, close, and backdrop clicks cancel without changing the provider', () => {
        const onProviderChange = renderEnabled();
        fireEvent.click(screen.getByTestId('agent-selector-chip-btn'));
        fireEvent.click(screen.getByTestId('agent-option-codex'));
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onProviderChange).not.toHaveBeenCalled();

        fireEvent.click(screen.getByTestId('agent-selector-chip-btn'));
        fireEvent.click(screen.getByTestId('agent-option-codex'));
        fireEvent.click(screen.getByTestId('dialog-close-btn'));
        expect(onProviderChange).not.toHaveBeenCalled();

        fireEvent.click(screen.getByTestId('agent-selector-chip-btn'));
        fireEvent.click(screen.getByTestId('agent-option-codex'));
        fireEvent.click(screen.getByTestId('dialog-overlay'));
        expect(onProviderChange).not.toHaveBeenCalled();
    });

    it('confirm changes only the pending selection and restores focus', async () => {
        const onProviderChange = renderEnabled();
        const chip = screen.getByTestId('agent-selector-chip-btn');
        fireEvent.click(chip);
        fireEvent.click(screen.getByTestId('agent-option-codex'));
        fireEvent.click(screen.getByTestId('provider-switch-confirm'));

        expect(onProviderChange).toHaveBeenCalledOnce();
        expect(onProviderChange).toHaveBeenCalledWith('codex');
        await waitFor(() => expect(chip).toHaveFocus());
    });

    it('choosing the active provider clears a pending switch without another warning', () => {
        const onProviderChange = renderEnabled({ selectedProvider: 'codex' });
        fireEvent.click(screen.getByTestId('agent-selector-chip-btn'));
        fireEvent.click(screen.getByTestId('agent-option-copilot'));

        expect(onProviderChange).toHaveBeenCalledWith('copilot');
        expect(screen.queryByTestId('provider-switch-confirm-dialog')).toBeNull();
    });

    it('describes the active provider as source when replacing a pending target', () => {
        renderEnabled({ selectedProvider: 'codex' });
        fireEvent.click(screen.getByTestId('agent-selector-chip-btn'));
        fireEvent.click(screen.getByTestId('agent-option-claude'));
        expect(screen.getByText('Switch from Copilot to Claude?')).toBeTruthy();
    });

    it('announces the eligibility reason when switching is disabled', () => {
        renderEnabled({ providerSwitchDisabledReason: 'Wait for the conversation to become idle before switching provider' });
        const chip = screen.getByTestId('agent-selector-chip-btn');
        expect(chip).toBeDisabled();
        expect(chip).toHaveAttribute('aria-label', 'Agent: Copilot (Wait for the conversation to become idle before switching provider)');
    });
});
