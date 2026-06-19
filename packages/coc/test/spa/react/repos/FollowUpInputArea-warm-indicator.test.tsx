/**
 * Render test for FollowUpInputArea → WarmIndicatorDot (AC-03, AC-04).
 *
 * Proves the tiny "session warm" dot next to the send button reflects the
 * usePrewarmClient status, is hidden for `unsupported` providers, exposes an
 * accessible label, never displaces the send button, and stays neutral when
 * warming is disabled (TTL = 0 kill-switch).
 */
/* @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React, { createRef } from 'react';

const { prewarmSpy, getClientSpy, warmTtlHolder } = vi.hoisted(() => ({
    prewarmSpy: vi.fn(),
    getClientSpy: vi.fn(),
    // Mutable so individual tests can flip the surfaced TTL (e.g. 0 = disabled).
    warmTtlHolder: { value: 300000 },
}));

// Minimal RichTextInput double — composer text is driven by the followUpInput
// prop, so the double only needs a stable imperative handle.
vi.mock('../../../../src/server/spa/client/react/shared/RichTextInput', async () => {
    const R = await import('react');
    return {
        RichTextInput: R.forwardRef((props: any, ref: any) => {
            R.useImperativeHandle(ref, () => ({
                getValue: () => '',
                setValue: () => {},
                focus: () => {},
            }), []);
            return R.createElement('div', { 'data-testid': props['data-testid'] });
        }),
    };
});

vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    isRalphEnabled: () => false,
    isForEachEnabled: () => false,
    isSessionContextAttachmentsEnabled: () => false,
    getPrewarmDebounceMs: () => 500,
    getWarmClientTtlMs: () => warmTtlHolder.value,
}));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({ preferences: { getLlmToolsConfig: vi.fn().mockResolvedValue({ tools: [], disabledLlmTools: [] }) } }),
}));

vi.mock('../../../../src/server/spa/client/react/repos/cloneRegistry', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../../src/server/spa/client/react/repos/cloneRegistry')>();
    return {
        ...actual,
        getCocClientForWorkspace: (workspaceId: string | null | undefined) => {
            getClientSpy(workspaceId);
            return { processes: { prewarm: prewarmSpy } };
        },
    };
});

import { FollowUpInputArea } from '../../../../src/server/spa/client/react/features/chat/FollowUpInputArea';
import type { FollowUpInputAreaProps } from '../../../../src/server/spa/client/react/features/chat/FollowUpInputArea';
import { PREWARM_DEBOUNCE_MS } from '../../../../src/server/spa/client/react/features/chat/hooks/usePrewarmClient';
import type { RichTextInputHandle } from '../../../../src/server/spa/client/react/shared/RichTextInput';

const SEND_BTN = 'activity-chat-send-btn';
const DOT = 'warm-indicator-dot';

function makeDeferred<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
}

beforeEach(() => {
    vi.useFakeTimers();
    warmTtlHolder.value = 300000;
    prewarmSpy.mockReset().mockResolvedValue({ warming: true });
    getClientSpy.mockReset();
    Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

function makeProps(overrides: Partial<FollowUpInputAreaProps> = {}): FollowUpInputAreaProps {
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
        attachedContext: [],
        onRemoveAttachedContext: vi.fn(),
        onAttachSessionContext: vi.fn(),
        workspaceId: 'ws-1',
        currentProcessId: 'proc-1',
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

describe('FollowUpInputArea — warm indicator dot (AC-03)', () => {
    it('walks idle → warming → warm as the prewarm resolves', async () => {
        const deferred = makeDeferred<{ warming: boolean }>();
        prewarmSpy.mockReturnValue(deferred.promise);

        const props = makeProps();
        const { rerender, getByTestId } = render(<FollowUpInputArea {...props} />);

        // No typing yet → idle (neutral spacer, no label).
        expect(getByTestId(DOT).getAttribute('data-status')).toBe('idle');
        expect(getByTestId(DOT).getAttribute('aria-hidden')).toBe('true');

        // Type → debounce fires → warming (POST in flight, not yet resolved).
        act(() => { rerender(<FollowUpInputArea {...props} followUpInput="hello" />); });
        act(() => { vi.advanceTimersByTime(PREWARM_DEBOUNCE_MS); });
        expect(getByTestId(DOT).getAttribute('data-status')).toBe('warming');

        // POST resolves { warming: true } → warm.
        await act(async () => { deferred.resolve({ warming: true }); });
        expect(getByTestId(DOT).getAttribute('data-status')).toBe('warm');
    });

    it('exposes an accessible label / tooltip for warming and warm', async () => {
        const props = makeProps();
        const { rerender, getByTestId } = render(<FollowUpInputArea {...props} />);

        act(() => { rerender(<FollowUpInputArea {...props} followUpInput="hi" />); });
        await act(async () => { vi.advanceTimersByTime(PREWARM_DEBOUNCE_MS); });

        const dot = getByTestId(DOT);
        expect(dot.getAttribute('data-status')).toBe('warm');
        expect(dot.getAttribute('role')).toBe('img');
        expect(dot.getAttribute('aria-label')).toMatch(/warm/i);
        expect(dot.getAttribute('title')).toBe(dot.getAttribute('aria-label'));
    });

    it('hides the dot entirely for unsupported providers (no false promise)', async () => {
        prewarmSpy.mockReset().mockResolvedValue({ warming: false, reason: 'unsupported' });

        const props = makeProps();
        const { rerender, queryByTestId } = render(<FollowUpInputArea {...props} />);

        act(() => { rerender(<FollowUpInputArea {...props} followUpInput="claude says hi" />); });
        await act(async () => { vi.advanceTimersByTime(PREWARM_DEBOUNCE_MS); });

        expect(queryByTestId(DOT)).toBeNull();
    });

    it('does not displace or overlap the send button', () => {
        const props = makeProps();
        const { getByTestId } = render(<FollowUpInputArea {...props} />);

        const dot = getByTestId(DOT);
        const sendBtn = getByTestId(SEND_BTN);

        // Both render; the dot never wraps the send button (would steal its hit
        // target) and is pointer-transparent + non-growing so it cannot relayout.
        expect(sendBtn).toBeTruthy();
        expect(dot.contains(sendBtn)).toBe(false);
        expect(dot.className).toContain('pointer-events-none');
        expect(dot.className).toContain('shrink-0');
        // Dot sits before the send button in DOM order.
        expect(dot.compareDocumentPosition(sendBtn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
});

describe('FollowUpInputArea — warm indicator kill-switch (AC-04)', () => {
    it('stays neutral/hidden when warming is disabled (TTL = 0)', async () => {
        warmTtlHolder.value = 0;
        // Server would no-op, but the mock still resolves warm; the dot must
        // ignore it because the hook is gated on ttlMs > 0.
        prewarmSpy.mockReset().mockResolvedValue({ warming: true });

        const props = makeProps();
        const { rerender, getByTestId, queryByLabelText } = render(<FollowUpInputArea {...props} />);

        act(() => { rerender(<FollowUpInputArea {...props} followUpInput="hello" />); });
        await act(async () => { vi.advanceTimersByTime(PREWARM_DEBOUNCE_MS); });

        // Dot never lights up: stays the neutral idle spacer, no warm label.
        expect(getByTestId(DOT).getAttribute('data-status')).toBe('idle');
        expect(queryByLabelText(/warm/i)).toBeNull();
        // The prewarm POST still fires server-side (existing behavior preserved).
        expect(prewarmSpy).toHaveBeenCalledTimes(1);
    });
});
