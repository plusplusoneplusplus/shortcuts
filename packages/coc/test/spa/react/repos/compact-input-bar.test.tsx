/**
 * Tests for compact chat input bar layout — verifies that both FollowUpInputArea
 * and NewChatArea render mode selector, text input, and send button in a single
 * horizontal row (flex-row) at all viewport sizes.
 *
 * Also tests the mobile-specific icon-only mode cycle button.
 */
/* @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import React, { createRef } from 'react';

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const { tracker, mockQueueDispatch, mockAppState, mockFetch } = vi.hoisted(() => ({
    tracker: { calls: [] as Array<[string, number?]>, domValue: '' },
    mockQueueDispatch: vi.fn(),
    mockAppState: { workspaces: [{ id: 'ws-1', rootPath: '/repo' }] },
    mockFetch: vi.fn(),
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

vi.mock('../../../../src/server/spa/client/react/context/QueueContext', () => ({
    useQueue: () => ({ state: {}, dispatch: mockQueueDispatch }),
}));

vi.mock('../../../../src/server/spa/client/react/context/AppContext', () => ({
    useApp: () => ({ state: mockAppState, dispatch: vi.fn() }),
}));

vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    getApiBase: () => '/api',
    getConfig: () => ({ apiBasePath: '/api' }),
}));

import { FollowUpInputArea } from '../../../../src/server/spa/client/react/repos/FollowUpInputArea';
import type { FollowUpInputAreaProps } from '../../../../src/server/spa/client/react/repos/FollowUpInputArea';
import type { RichTextInputHandle } from '../../../../src/server/spa/client/react/shared/RichTextInput';
import { NewChatArea } from '../../../../src/server/spa/client/react/repos/NewChatArea';

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
        images: [],
        onImagePaste: vi.fn(),
        onImageRemove: vi.fn(),
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

// ── Layout structure tests ─────────────────────────────────────────────────

describe('FollowUpInputArea — compact input bar layout', () => {
    it('renders chat-input-bar container with flex-row', () => {
        render(<FollowUpInputArea {...makeFollowUpProps()} />);
        const bar = screen.getByTestId('chat-input-bar');
        expect(bar.className).toContain('flex-row');
        expect(bar.className).toContain('items-center');
        expect(bar.className).not.toContain('flex-col');
    });

    it('renders mode-cycle-btn for mobile (sm:hidden) and mode-dropdown for desktop (hidden sm:block)', () => {
        render(<FollowUpInputArea {...makeFollowUpProps()} />);
        const cycleBtn = screen.getByTestId('mode-cycle-btn');
        const dropdown = screen.getByTestId('mode-dropdown');

        expect(cycleBtn.className).toContain('sm:hidden');
        expect(dropdown.className).toContain('hidden');
        expect(dropdown.className).toContain('sm:block');
    });

    it('mode-cycle-btn shows icon-only text for current mode', () => {
        render(<FollowUpInputArea {...makeFollowUpProps({ selectedMode: 'ask' })} />);
        expect(screen.getByTestId('mode-cycle-btn').textContent).toBe('💡');

        const { unmount } = render(<FollowUpInputArea {...makeFollowUpProps({ selectedMode: 'plan' })} />);
        expect(screen.getAllByTestId('mode-cycle-btn')[1].textContent).toBe('📋');
        unmount();
    });

    it('mode-cycle-btn has aria-label indicating current mode', () => {
        render(<FollowUpInputArea {...makeFollowUpProps({ selectedMode: 'autopilot' })} />);
        const btn = screen.getByTestId('mode-cycle-btn');
        expect(btn.getAttribute('aria-label')).toContain('autopilot');
    });

    it('tapping mode-cycle-btn calls setSelectedMode with next mode', () => {
        const setSelectedMode = vi.fn();
        render(<FollowUpInputArea {...makeFollowUpProps({ selectedMode: 'ask', setSelectedMode })} />);
        fireEvent.click(screen.getByTestId('mode-cycle-btn'));
        // cycleMode('ask') → 'autopilot'
        expect(setSelectedMode).toHaveBeenCalledWith('autopilot');
    });

    it('tapping mode-cycle-btn cycles through modes correctly', () => {
        const setSelectedMode = vi.fn();

        // ask → autopilot
        const { unmount: u1 } = render(<FollowUpInputArea {...makeFollowUpProps({ selectedMode: 'ask', setSelectedMode })} />);
        fireEvent.click(screen.getByTestId('mode-cycle-btn'));
        expect(setSelectedMode).toHaveBeenCalledWith('autopilot');
        u1();

        setSelectedMode.mockClear();

        // autopilot → ask
        const { unmount: u2 } = render(<FollowUpInputArea {...makeFollowUpProps({ selectedMode: 'autopilot', setSelectedMode })} />);
        fireEvent.click(screen.getByTestId('mode-cycle-btn'));
        expect(setSelectedMode).toHaveBeenCalledWith('ask');
        u2();

        setSelectedMode.mockClear();

        // plan → autopilot
        render(<FollowUpInputArea {...makeFollowUpProps({ selectedMode: 'plan', setSelectedMode })} />);
        fireEvent.click(screen.getByTestId('mode-cycle-btn'));
        expect(setSelectedMode).toHaveBeenCalledWith('autopilot');
    });

    it('send button has shrink-0 to prevent compression', () => {
        render(<FollowUpInputArea {...makeFollowUpProps()} />);
        const btn = screen.getByTestId('activity-chat-send-btn');
        expect(btn.className).toContain('shrink-0');
        expect(btn.className).not.toContain('w-full');
    });

    it('send button has compact padding on mobile (px-2 sm:px-3)', () => {
        render(<FollowUpInputArea {...makeFollowUpProps()} />);
        const btn = screen.getByTestId('activity-chat-send-btn');
        expect(btn.className).toContain('px-2');
        expect(btn.className).toContain('sm:px-3');
    });

    it('text input wrapper has min-w-0 to prevent overflow', () => {
        render(<FollowUpInputArea {...makeFollowUpProps()} />);
        const bar = screen.getByTestId('chat-input-bar');
        const inputWrapper = bar.querySelector('.flex-1.min-w-0');
        expect(inputWrapper).toBeTruthy();
    });

    it('mode selector is hidden when hideModeSelector is true', () => {
        render(<FollowUpInputArea {...makeFollowUpProps({ hideModeSelector: true })} />);
        expect(screen.queryByTestId('mode-selector')).toBeNull();
        expect(screen.queryByTestId('mode-cycle-btn')).toBeNull();
        expect(screen.queryByTestId('mode-dropdown')).toBeNull();
    });

    it('all three children (mode, input, send) are direct children of the flex-row container', () => {
        render(<FollowUpInputArea {...makeFollowUpProps()} />);
        const bar = screen.getByTestId('chat-input-bar');
        // mode-selector, input wrapper, send button
        const children = Array.from(bar.children);
        expect(children.length).toBe(3);
    });
});

// ── NewChatArea compact layout tests ───────────────────────────────────────

describe('NewChatArea — compact input bar layout', () => {
    it('renders chat-input-bar container with flex-row', () => {
        render(<NewChatArea workspaceId="ws-1" />);
        const bar = screen.getByTestId('chat-input-bar');
        expect(bar.className).toContain('flex-row');
        expect(bar.className).toContain('items-center');
        expect(bar.className).not.toContain('flex-col');
    });

    it('renders mode-cycle-btn for mobile and dropdown for desktop', () => {
        render(<NewChatArea workspaceId="ws-1" />);
        const cycleBtn = screen.getByTestId('mode-cycle-btn');
        const dropdown = screen.getByTestId('new-chat-mode-dropdown');

        expect(cycleBtn.className).toContain('sm:hidden');
        expect(dropdown.className).toContain('hidden');
        expect(dropdown.className).toContain('sm:block');
    });

    it('mode-cycle-btn shows autopilot icon by default', () => {
        render(<NewChatArea workspaceId="ws-1" />);
        expect(screen.getByTestId('mode-cycle-btn').textContent).toBe('🤖');
    });

    it('tapping mode-cycle-btn cycles modes', () => {
        render(<NewChatArea workspaceId="ws-1" />);
        const btn = screen.getByTestId('mode-cycle-btn');

        // Default is autopilot → cycles to ask
        fireEvent.click(btn);
        expect(btn.textContent).toBe('💡');
        expect(btn.getAttribute('aria-label')).toContain('ask');

        // ask → cycles to autopilot
        fireEvent.click(btn);
        expect(btn.textContent).toBe('🤖');
    });

    it('send button has shrink-0 and no w-full', () => {
        render(<NewChatArea workspaceId="ws-1" />);
        const btn = screen.getByTestId('new-chat-send-btn');
        expect(btn.className).toContain('shrink-0');
        expect(btn.className).not.toContain('w-full');
    });

    it('send button has compact padding (px-2 sm:px-3)', () => {
        render(<NewChatArea workspaceId="ws-1" />);
        const btn = screen.getByTestId('new-chat-send-btn');
        expect(btn.className).toContain('px-2');
        expect(btn.className).toContain('sm:px-3');
    });

    it('text input wrapper has min-w-0', () => {
        render(<NewChatArea workspaceId="ws-1" />);
        const bar = screen.getByTestId('chat-input-bar');
        const inputWrapper = bar.querySelector('.flex-1.min-w-0');
        expect(inputWrapper).toBeTruthy();
    });

    it('mode-cycle-btn has correct fixed dimensions for square appearance', () => {
        render(<NewChatArea workspaceId="ws-1" />);
        const btn = screen.getByTestId('mode-cycle-btn');
        expect(btn.className).toContain('h-[34px]');
        expect(btn.className).toContain('w-[34px]');
    });

    it('all three children (mode, input, send) are direct children of the flex-row container', () => {
        render(<NewChatArea workspaceId="ws-1" />);
        const bar = screen.getByTestId('chat-input-bar');
        const children = Array.from(bar.children);
        expect(children.length).toBe(3);
    });
});

// ── Source code validation (CSS class presence) ────────────────────────────

describe('Compact input bar — source validation', () => {
    it('FollowUpInputArea.tsx no longer uses flex-col for the input bar', async () => {
        const fs = await import('fs');
        const path = await import('path');
        const src = fs.readFileSync(
            path.resolve(__dirname, '../../../../src/server/spa/client/react/repos/FollowUpInputArea.tsx'),
            'utf-8',
        );
        // Should not have old stacked layout
        expect(src).not.toContain('flex flex-col sm:flex-row');
        // Should have always-horizontal layout
        expect(src).toContain('flex flex-row items-center');
    });

    it('NewChatArea.tsx no longer uses flex-col for the input bar', async () => {
        const fs = await import('fs');
        const path = await import('path');
        const src = fs.readFileSync(
            path.resolve(__dirname, '../../../../src/server/spa/client/react/repos/NewChatArea.tsx'),
            'utf-8',
        );
        expect(src).not.toContain('flex flex-col sm:flex-row');
        expect(src).toContain('flex flex-row items-center');
    });

    it('neither component uses w-full sm:w-auto on send button', async () => {
        const fs = await import('fs');
        const path = await import('path');
        const followUp = fs.readFileSync(
            path.resolve(__dirname, '../../../../src/server/spa/client/react/repos/FollowUpInputArea.tsx'),
            'utf-8',
        );
        const newChat = fs.readFileSync(
            path.resolve(__dirname, '../../../../src/server/spa/client/react/repos/NewChatArea.tsx'),
            'utf-8',
        );
        expect(followUp).not.toContain('w-full sm:w-auto');
        expect(newChat).not.toContain('w-full sm:w-auto');
    });
});
