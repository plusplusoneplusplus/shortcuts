/**
 * Tests for the redesigned chat input layout.
 *
 * The default layout is the new stacked design: a horizontal mode pill row
 * sits above an input "card" whose bottom toolbar holds the model picker,
 * tool buttons, and the Queue follow-up button.
 *
 * The legacy compact single-row layout (mode cycle button + dropdown + send
 * inline with the input) is retained for narrow side panels via the
 * `compactModeSelector` prop.
 */
/* @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React, { createRef } from 'react';

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const { tracker, mockQueueDispatch, mockAppState, mockFetch, mockAppDispatch } = vi.hoisted(() => ({
    tracker: { calls: [] as Array<[string, number?]>, domValue: '' },
    mockQueueDispatch: vi.fn(),
    mockAppState: { workspaces: [{ id: 'ws-1', rootPath: '/repo' }], onboardingProgress: { hasUsedChat: true } } as Record<string, any>,
    mockFetch: vi.fn(),
    mockAppDispatch: vi.fn(),
}));

vi.mock('../../../../src/server/spa/client/react/shared/RichTextInput', async () => {
    const R = await import('react');
    return {
        RichTextInput: R.forwardRef((props: any, ref: any) => {
            R.useImperativeHandle(ref, () => ({
                getValue: () => tracker.domValue,
                setValue: (text: string, cursorPos?: number) => {
                    tracker.calls.push([text, cursorPos]);
                    tracker.domValue = text;
                },
                focus: () => {},
            }), []);
            return R.createElement('div', {
                'data-testid': props['data-testid'],
                className: props.className,
                onKeyDown: props.onKeyDown,
            });
        }),
    };
});

vi.mock('../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ state: {}, dispatch: mockQueueDispatch }),
}));

vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({ state: mockAppState, dispatch: mockAppDispatch }),
}));

vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    getApiBase: () => '/api',
    getConfig: () => ({ apiBasePath: '/api' }),
}));

vi.mock('../../../../src/server/spa/client/react/hooks/useModels', () => ({
    useModels: () => ({ models: [], loading: false, error: null, reload: vi.fn() }),
}));

vi.mock('../../../../src/server/spa/client/react/features/chat/hooks/useSlashCommands', () => ({
    useSlashCommands: () => ({
        menuVisible: false,
        menuFilter: '',
        filteredSkills: [],
        highlightIndex: 0,
        handleInputChange: vi.fn(),
        handleKeyDown: vi.fn(() => false),
        selectSkill: vi.fn(),
        parseAndExtract: vi.fn(() => ({ skills: [], prompt: '' })),
        dismissMenu: vi.fn(),
    }),
}));

vi.mock('../../../../src/server/spa/client/react/features/chat/hooks/useModelCommand', () => ({
    useModelCommand: () => ({
        modelMenuVisible: false,
        modelFilter: '',
        filteredModels: [],
        modelHighlightIndex: 0,
        modelOverride: null,
        setModelOverride: vi.fn(),
        handleModelSelect: vi.fn(),
        showModelMenu: vi.fn(),
        dismissModelMenu: vi.fn(),
        handleModelKeyDown: vi.fn(() => false),
        setModelFilter: vi.fn(),
    }),
}));

vi.mock('../../../../src/server/spa/client/react/features/chat/SlashCommandMenu', () => ({
    SlashCommandMenu: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/features/chat/ModelCommandMenu', () => ({
    ModelCommandMenu: () => null,
}));

import { FollowUpInputArea } from '../../../../src/server/spa/client/react/features/chat/FollowUpInputArea';
import type { FollowUpInputAreaProps } from '../../../../src/server/spa/client/react/features/chat/FollowUpInputArea';
import type { RichTextInputHandle } from '../../../../src/server/spa/client/react/shared/RichTextInput';
import { NewChatArea } from '../../../../src/server/spa/client/react/features/chat/NewChatArea';

beforeEach(() => {
    vi.clearAllMocks();
    tracker.calls = [];
    tracker.domValue = '';
    globalThis.fetch = mockFetch;
    Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
    vi.restoreAllMocks();
});

function makeFollowUpProps(overrides: Partial<FollowUpInputAreaProps> = {}): FollowUpInputAreaProps {
    return {
        richTextRef: createRef<RichTextInputHandle>(),
        inputDisabled: false,
        sending: false,
        isActiveGeneration: false,
        isCancelling: false,
        error: null,
        resumeFeedback: null,
        suggestions: [],
        followUpInput: '',
        setFollowUpInput: vi.fn(),
        selectedMode: 'ask',
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
            handleKeyDown: vi.fn(() => false),
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

// ── Default stacked layout (FollowUpInputArea) ─────────────────────────────

describe('FollowUpInputArea — stacked input card layout', () => {
    it('renders chat-input-bar as a vertical input card (flex-col)', () => {
        render(<FollowUpInputArea {...makeFollowUpProps()} />);
        const bar = screen.getByTestId('chat-input-bar');
        expect(bar.className).toContain('flex-col');
        expect(bar.className).toContain('rounded-lg');
        expect(bar.className).toContain('border');
    });

    it('renders the mode pill selector with one button per mode', () => {
        render(<FollowUpInputArea {...makeFollowUpProps({ selectedMode: 'autopilot' })} />);
        expect(screen.getByTestId('mode-selector')).toBeTruthy();
        expect(screen.getByTestId('mode-pill-ask')).toBeTruthy();
        expect(screen.getByTestId('mode-pill-plan')).toBeTruthy();
        expect(screen.getByTestId('mode-pill-autopilot')).toBeTruthy();
        expect(screen.getByTestId('mode-pill-autopilot').getAttribute('aria-checked')).toBe('true');
        expect(screen.getByTestId('mode-pill-ask').getAttribute('aria-checked')).toBe('false');
    });

    it('does not render the legacy mode-dropdown / mode-cycle-btn in the default layout', () => {
        render(<FollowUpInputArea {...makeFollowUpProps()} />);
        expect(screen.queryByTestId('mode-dropdown')).toBeNull();
        expect(screen.queryByTestId('mode-cycle-btn')).toBeNull();
    });

    it('clicking a pill dispatches setSelectedMode with the new mode', () => {
        const setSelectedMode = vi.fn();
        render(<FollowUpInputArea {...makeFollowUpProps({ selectedMode: 'ask', setSelectedMode })} />);
        fireEvent.click(screen.getByTestId('mode-pill-plan'));
        expect(setSelectedMode).toHaveBeenCalledWith('plan');
    });

    it('respects allowedModes when rendering pills', () => {
        render(<FollowUpInputArea {...makeFollowUpProps({
            selectedMode: 'ask',
            allowedModes: ['ask', 'autopilot'],
        })} />);
        expect(screen.getByTestId('mode-pill-ask')).toBeTruthy();
        expect(screen.getByTestId('mode-pill-autopilot')).toBeTruthy();
        expect(screen.queryByTestId('mode-pill-plan')).toBeNull();
    });

    it('renders the bottom toolbar with attach + slash trigger buttons', () => {
        render(<FollowUpInputArea {...makeFollowUpProps()} />);
        expect(screen.getByTestId('chat-input-toolbar')).toBeTruthy();
        expect(screen.getByTestId('follow-up-attach-btn')).toBeTruthy();
        expect(screen.getByTestId('chat-toolbar-slash-btn')).toBeTruthy();
    });

    it('Queue follow-up button has shrink-0 to prevent compression', () => {
        render(<FollowUpInputArea {...makeFollowUpProps()} />);
        const btn = screen.getByTestId('activity-chat-send-btn');
        expect(btn.className).toContain('shrink-0');
        expect(btn.className).not.toContain('w-full');
    });

    it('Queue follow-up button has compact padding (px-2 sm:px-3)', () => {
        render(<FollowUpInputArea {...makeFollowUpProps()} />);
        const btn = screen.getByTestId('activity-chat-send-btn');
        expect(btn.className).toContain('px-2');
        expect(btn.className).toContain('sm:px-3');
    });

    it('hides the mode selector when hideModeSelector is true', () => {
        render(<FollowUpInputArea {...makeFollowUpProps({ hideModeSelector: true })} />);
        expect(screen.queryByTestId('mode-selector')).toBeNull();
        expect(screen.queryByTestId('mode-pill-ask')).toBeNull();
        expect(screen.queryByTestId('mode-pill-plan')).toBeNull();
        expect(screen.queryByTestId('mode-pill-autopilot')).toBeNull();
    });
});

// ── Legacy compact layout (compactModeSelector=true) ───────────────────────

describe('FollowUpInputArea — compactModeSelector legacy single-row layout', () => {
    it('renders chat-input-bar as a single horizontal row when compactModeSelector is true', () => {
        render(<FollowUpInputArea {...makeFollowUpProps({ compactModeSelector: true })} />);
        const bar = screen.getByTestId('chat-input-bar');
        expect(bar.className).toContain('flex-row');
        expect(bar.className).toContain('items-center');
        expect(bar.className).not.toContain('flex-col');
    });

    it('renders only the cycle button (no dropdown) when compactModeSelector is true', () => {
        render(<FollowUpInputArea {...makeFollowUpProps({ compactModeSelector: true })} />);
        expect(screen.getByTestId('mode-cycle-btn')).toBeTruthy();
        expect(screen.queryByTestId('mode-dropdown')).toBeNull();
        expect(screen.queryByTestId('mode-pill-ask')).toBeNull();
    });

    it('cycle button shows the icon for the current mode', () => {
        render(<FollowUpInputArea {...makeFollowUpProps({ compactModeSelector: true, selectedMode: 'autopilot' })} />);
        expect(screen.getByTestId('mode-cycle-btn').textContent).toContain('🤖');
    });

    it('clicking the cycle button advances to the next mode', () => {
        const setSelectedMode = vi.fn();
        render(<FollowUpInputArea {...makeFollowUpProps({ compactModeSelector: true, selectedMode: 'ask', setSelectedMode })} />);
        fireEvent.click(screen.getByTestId('mode-cycle-btn'));
        expect(setSelectedMode).toHaveBeenCalledWith('plan');
    });

    it('respects allowedModes when cycling (ask → autopilot)', () => {
        const setSelectedMode = vi.fn();
        render(<FollowUpInputArea {...makeFollowUpProps({
            compactModeSelector: true,
            selectedMode: 'ask',
            allowedModes: ['ask', 'autopilot'],
            setSelectedMode,
        })} />);
        fireEvent.click(screen.getByTestId('mode-cycle-btn'));
        expect(setSelectedMode).toHaveBeenCalledWith('autopilot');
    });

    it('hideModeSelector hides the selector even when compactModeSelector is true', () => {
        render(<FollowUpInputArea {...makeFollowUpProps({ compactModeSelector: true, hideModeSelector: true })} />);
        expect(screen.queryByTestId('mode-selector')).toBeNull();
        expect(screen.queryByTestId('mode-cycle-btn')).toBeNull();
    });

    it('text input wrapper has min-w-0 to prevent overflow in single-row layout', () => {
        render(<FollowUpInputArea {...makeFollowUpProps({ compactModeSelector: true })} />);
        const bar = screen.getByTestId('chat-input-bar');
        const inputWrapper = bar.querySelector('.flex-1.min-w-0');
        expect(inputWrapper).toBeTruthy();
    });
});

// ── NewChatArea stacked layout ─────────────────────────────────────────────

describe('NewChatArea — stacked input card layout', () => {
    it('renders chat-input-bar as a vertical input card (flex-col)', () => {
        render(<NewChatArea workspaceId="ws-1" />);
        const bar = screen.getByTestId('chat-input-bar');
        expect(bar.className).toContain('flex-col');
        expect(bar.className).toContain('rounded-lg');
        expect(bar.className).toContain('border');
    });

    it('renders the mode pill selector with all three modes by default', () => {
        render(<NewChatArea workspaceId="ws-1" />);
        expect(screen.getByTestId('mode-selector')).toBeTruthy();
        expect(screen.getByTestId('mode-pill-ask')).toBeTruthy();
        expect(screen.getByTestId('mode-pill-plan')).toBeTruthy();
        expect(screen.getByTestId('mode-pill-autopilot')).toBeTruthy();
        expect(screen.getByTestId('mode-pill-ask').getAttribute('aria-checked')).toBe('true');
    });

    it('does not render the legacy mode-dropdown / mode-cycle-btn', () => {
        render(<NewChatArea workspaceId="ws-1" />);
        expect(screen.queryByTestId('mode-dropdown')).toBeNull();
        expect(screen.queryByTestId('mode-cycle-btn')).toBeNull();
    });

    it('renders the bottom toolbar with attach + slash trigger buttons', () => {
        render(<NewChatArea workspaceId="ws-1" />);
        expect(screen.getByTestId('chat-input-toolbar')).toBeTruthy();
        expect(screen.getByTestId('new-chat-attach-btn')).toBeTruthy();
        expect(screen.getByTestId('chat-toolbar-slash-btn')).toBeTruthy();
    });

    it('Queue follow-up button has shrink-0', () => {
        render(<NewChatArea workspaceId="ws-1" />);
        const btn = screen.getByTestId('new-chat-send-btn');
        expect(btn.className).toContain('shrink-0');
        expect(btn.className).not.toContain('w-full');
    });
});

// ── Source code validation ─────────────────────────────────────────────────

describe('Stacked input bar — source validation', () => {
    it('FollowUpInputArea.tsx contains the chat-input-stack stacked container', async () => {
        const fs = await import('fs');
        const path = await import('path');
        const src = fs.readFileSync(
            path.resolve(__dirname, '../../../../src/server/spa/client/react/features/chat/FollowUpInputArea.tsx'),
            'utf-8',
        );
        expect(src).toContain('chat-input-stack');
        expect(src).toContain('ModePillSelector');
    });

    it('NewChatArea.tsx uses the ModePillSelector and a vertical input card', async () => {
        const fs = await import('fs');
        const path = await import('path');
        const src = fs.readFileSync(
            path.resolve(__dirname, '../../../../src/server/spa/client/react/features/chat/NewChatArea.tsx'),
            'utf-8',
        );
        expect(src).toContain('ModePillSelector');
        expect(src).toContain('flex-col');
    });

    it('neither component uses the obsolete sm:flex-row stacked-mobile layout', async () => {
        const fs = await import('fs');
        const path = await import('path');
        const followUp = fs.readFileSync(
            path.resolve(__dirname, '../../../../src/server/spa/client/react/features/chat/FollowUpInputArea.tsx'),
            'utf-8',
        );
        const newChat = fs.readFileSync(
            path.resolve(__dirname, '../../../../src/server/spa/client/react/features/chat/NewChatArea.tsx'),
            'utf-8',
        );
        expect(followUp).not.toContain('flex flex-col sm:flex-row');
        expect(newChat).not.toContain('flex flex-col sm:flex-row');
    });
});
