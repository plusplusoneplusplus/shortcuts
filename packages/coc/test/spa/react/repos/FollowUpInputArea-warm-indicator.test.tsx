/**
 * Render test for FollowUpInputArea → WarmIndicatorDot (AC-02).
 *
 * Proves the tiny "session warm" dot next to the send button reflects the
 * SSE-pushed warm status from usePrewarmClient: invisible spacer while cold
 * (incl. permanently-cold providers like Claude), amber-pulse while warming,
 * green while warm/active. It exposes an accessible label and never displaces
 * the send button.
 */
/* @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React, { createRef } from 'react';

// ── Minimal EventSource double ──────────────────────────────────────────────
class MockEventSource {
    static instances: MockEventSource[] = [];
    url: string;
    closed = false;
    private listeners: Record<string, Array<(e: any) => void>> = {};

    constructor(url: string) {
        this.url = url;
        MockEventSource.instances.push(this);
    }
    addEventListener(type: string, fn: (e: any) => void) {
        (this.listeners[type] ||= []).push(fn);
    }
    close() { this.closed = true; }
    emitWarm(status: string) {
        const data = JSON.stringify({ status });
        (this.listeners['warm_status'] || []).forEach((fn) => fn({ data }));
    }
    static reset() { MockEventSource.instances = []; }
    static get last(): MockEventSource | undefined {
        return MockEventSource.instances[MockEventSource.instances.length - 1];
    }
}

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
}));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({ preferences: { getLlmToolsConfig: vi.fn().mockResolvedValue({ tools: [], disabledLlmTools: [] }) } }),
}));

// Partial mock: keep the real cloneRegistry surface (used by sibling chat hooks)
// and only pin cloneApiBase so the warm EventSource URL is deterministic.
vi.mock('../../../../src/server/spa/client/react/repos/cloneRegistry', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../../src/server/spa/client/react/repos/cloneRegistry')>();
    return {
        ...actual,
        cloneApiBase: (ws: string | null | undefined) => `https://api.test/${ws}/api`,
    };
});

import { FollowUpInputArea } from '../../../../src/server/spa/client/react/features/chat/FollowUpInputArea';
import type { FollowUpInputAreaProps } from '../../../../src/server/spa/client/react/features/chat/FollowUpInputArea';
import type { RichTextInputHandle } from '../../../../src/server/spa/client/react/shared/RichTextInput';

const SEND_BTN = 'activity-chat-send-btn';
const DOT = 'warm-indicator-dot';

const originalEventSource = (globalThis as any).EventSource;

beforeEach(() => {
    MockEventSource.reset();
    (globalThis as any).EventSource = MockEventSource;
    Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
    (globalThis as any).EventSource = originalEventSource;
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

describe('FollowUpInputArea — warm indicator dot (AC-02)', () => {
    it('opens the warm SSE stream and walks cold → warming → warm', () => {
        const props = makeProps();
        const { getByTestId } = render(<FollowUpInputArea {...props} />);

        // Subscription opened for this process; no push yet → cold spacer.
        expect(MockEventSource.last!.url).toContain('/processes/proc-1/stream?warm=1');
        expect(getByTestId(DOT).getAttribute('data-status')).toBe('cold');
        expect(getByTestId(DOT).getAttribute('aria-hidden')).toBe('true');

        // Backend pushes warming → amber-pulse.
        act(() => { MockEventSource.last!.emitWarm('warming'); });
        expect(getByTestId(DOT).getAttribute('data-status')).toBe('warming');

        // Backend pushes warm → green.
        act(() => { MockEventSource.last!.emitWarm('warm'); });
        expect(getByTestId(DOT).getAttribute('data-status')).toBe('warm');
    });

    it('shows green for the active status (turn in flight)', () => {
        const props = makeProps();
        const { getByTestId } = render(<FollowUpInputArea {...props} />);
        act(() => { MockEventSource.last!.emitWarm('active'); });

        const dot = getByTestId(DOT);
        expect(dot.getAttribute('data-status')).toBe('active');
        // Active reuses the same "ready" green + label as warm.
        expect(dot.getAttribute('aria-label')).toMatch(/warm/i);
    });

    it('exposes an accessible label / tooltip for warm', () => {
        const props = makeProps();
        const { getByTestId } = render(<FollowUpInputArea {...props} />);
        act(() => { MockEventSource.last!.emitWarm('warm'); });

        const dot = getByTestId(DOT);
        expect(dot.getAttribute('role')).toBe('img');
        expect(dot.getAttribute('aria-label')).toMatch(/warm/i);
        expect(dot.getAttribute('title')).toBe(dot.getAttribute('aria-label'));
    });

    it('stays an invisible spacer for providers that never warm (Claude → no push)', () => {
        const props = makeProps();
        const { getByTestId, queryByLabelText } = render(<FollowUpInputArea {...props} />);

        // Claude never enters the registry → no warm_status ever arrives.
        const dot = getByTestId(DOT);
        expect(dot.getAttribute('data-status')).toBe('cold');
        expect(dot.getAttribute('aria-hidden')).toBe('true');
        expect(queryByLabelText(/warm/i)).toBeNull();
    });

    it('does not displace or overlap the send button', () => {
        const props = makeProps();
        const { getByTestId } = render(<FollowUpInputArea {...props} />);

        const dot = getByTestId(DOT);
        const sendBtn = getByTestId(SEND_BTN);

        expect(sendBtn).toBeTruthy();
        expect(dot.contains(sendBtn)).toBe(false);
        expect(dot.className).toContain('pointer-events-none');
        expect(dot.className).toContain('shrink-0');
        // Dot sits before the send button in DOM order.
        expect(dot.compareDocumentPosition(sendBtn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
});
