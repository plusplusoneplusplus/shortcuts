/**
 * Regression tests for FollowUpInputArea.
 *
 * Key regression: after Tab-selecting a skill, the useEffect sync-guard must NOT
 * call setValue a second time without a cursorPos, which would reset the cursor
 * to position 0 (before the slash).
 */
/* @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import React, { createRef } from 'react';

// Hoist a call tracker so the mock factory can reference it before imports
const { tracker } = vi.hoisted(() => ({
    tracker: {
        calls: [] as Array<[string, number?]>,
        domValue: '',
    },
}));

// Replace RichTextInput with a minimal stable test double that records setValue calls
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
                onKeyDown: props.onKeyDown,
            });
        }),
    };
});

import { FollowUpInputArea } from '../../../../src/server/spa/client/react/repos/FollowUpInputArea';
import type { FollowUpInputAreaProps } from '../../../../src/server/spa/client/react/repos/FollowUpInputArea';
import type { RichTextInputHandle } from '../../../../src/server/spa/client/react/shared/RichTextInput';

afterEach(() => {
    vi.restoreAllMocks();
});

beforeEach(() => {
    tracker.calls = [];
    tracker.domValue = '';
    // JSDOM does not implement scrollIntoView
    Element.prototype.scrollIntoView = vi.fn();
});

function makeProps(overrides: Partial<FollowUpInputAreaProps> = {}): FollowUpInputAreaProps {
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
        skills: [{ name: 'impl', description: 'Implement' }],
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

describe('FollowUpInputArea — cursor regression', () => {
    /**
     * Regression: when Tab is pressed to select a skill, selectSkill calls
     * ref.current.setValue(text, cursorPos) which places the cursor correctly.
     * A subsequent React state update triggers useEffect; the skipNextSyncRef flag
     * must prevent useEffect from calling setValue again (which would reset the cursor
     * to 0 — before the slash).
     */
    it('useEffect does not call setValue after selectSkill sets the cursor (Tab)', async () => {
        const richTextRef = createRef<RichTextInputHandle>();

        // selectSkill simulates what the real hook does: update DOM via ref + queue state
        const selectSkill = vi.fn((
            _name: string,
            _text: string,
            setText: (v: string) => void,
            ref?: React.RefObject<RichTextInputHandle>,
        ) => {
            const newText = '/impl ';
            setText(newText);
            ref?.current?.setValue(newText, 6); // cursor right after "/impl "
        });

        const props = makeProps({
            richTextRef,
            followUpInput: '/im',
            slashCommands: {
                handleInputChange: vi.fn(),
                handleKeyDown: vi.fn((e: React.KeyboardEvent) => {
                    if (e.key === 'Tab') { e.preventDefault(); return true; }
                    return false;
                }),
                selectSkill,
                dismissMenu: vi.fn(),
                menuVisible: true,
                menuFilter: 'im',
                filteredSkills: [{ name: 'impl', description: 'Implement' }],
                highlightIndex: 0,
            },
        });

        const { rerender } = render(<FollowUpInputArea {...props} />);
        tracker.calls = []; // clear any mount-time calls

        // Press Tab → handleKeyDown returns true → selectSkill fires
        const input = screen.getByTestId('activity-chat-input');
        fireEvent.keyDown(input, { key: 'Tab' });

        // selectSkill must have called setValue once with the cursor position
        expect(selectSkill).toHaveBeenCalledTimes(1);
        expect(tracker.calls).toEqual([['/impl ', 6]]);

        tracker.calls = [];

        // Simulate React state update (setFollowUpInput('/impl ') was called by selectSkill)
        await act(async () => {
            rerender(<FollowUpInputArea {...props} followUpInput="/impl " />);
        });

        // skipNextSyncRef must prevent the useEffect from calling setValue again.
        // A second call WITHOUT cursorPos would reset the cursor to 0 — that's the bug.
        expect(tracker.calls).toHaveLength(0);
    });

    it('normal click on suggestion chip calls onSend', () => {
        const onSend = vi.fn().mockResolvedValue(undefined);
        const props = makeProps({
            suggestions: ['Run tests'],
            onSend,
        });
        render(<FollowUpInputArea {...props} />);
        fireEvent.click(screen.getByTestId('suggestion-chip'));
        expect(onSend).toHaveBeenCalledWith('Run tests');
    });

    it('Ctrl+click on suggestion chip populates input instead of sending', () => {
        const onSend = vi.fn().mockResolvedValue(undefined);
        const setFollowUpInput = vi.fn();
        const richTextRef = createRef<RichTextInputHandle>();
        const props = makeProps({
            richTextRef,
            suggestions: ['Run tests'],
            onSend,
            setFollowUpInput,
        });
        render(<FollowUpInputArea {...props} />);
        fireEvent.click(screen.getByTestId('suggestion-chip'), { ctrlKey: true });
        expect(onSend).not.toHaveBeenCalled();
        expect(setFollowUpInput).toHaveBeenCalledWith('Run tests');
        expect(tracker.calls).toContainEqual(['Run tests', undefined]);
    });

    it('Meta+click on suggestion chip populates input (macOS parity)', () => {
        const onSend = vi.fn().mockResolvedValue(undefined);
        const setFollowUpInput = vi.fn();
        const richTextRef = createRef<RichTextInputHandle>();
        const props = makeProps({
            richTextRef,
            suggestions: ['Run tests'],
            onSend,
            setFollowUpInput,
        });
        render(<FollowUpInputArea {...props} />);
        fireEvent.click(screen.getByTestId('suggestion-chip'), { metaKey: true });
        expect(onSend).not.toHaveBeenCalled();
        expect(setFollowUpInput).toHaveBeenCalledWith('Run tests');
    });

    it('useEffect DOES sync DOM when followUpInput changes externally (no Tab/skill)', async () => {
        const richTextRef = createRef<RichTextInputHandle>();
        const props = makeProps({ richTextRef, followUpInput: '' });

        const { rerender } = render(<FollowUpInputArea {...props} />);
        tracker.calls = [];

        // External update (draft restore, clear after send) — no skill was selected
        await act(async () => {
            rerender(<FollowUpInputArea {...props} followUpInput="restored draft" />);
        });

        // useEffect must sync the new value to the DOM
        expect(tracker.calls).toContainEqual(['restored draft', undefined]);
    });
});

describe('FollowUpInputArea — Send button tooltip', () => {
    it('renders a title with keyboard shortcut hints', () => {
        render(<FollowUpInputArea {...makeProps()} />);
        const btn = screen.getByTestId('activity-chat-send-btn');
        expect(btn.getAttribute('title')).toBe(
            'Send (Enter) · Ctrl+Enter to steer AI · Shift+Enter for newline',
        );
    });
});


