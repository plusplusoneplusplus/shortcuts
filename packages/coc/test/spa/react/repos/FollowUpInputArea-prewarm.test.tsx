/**
 * Integration test for FollowUpInputArea → useTypingPrewarmClient + the warm dot.
 *
 * Proves the two halves of the warm-client UX stay separate:
 *  - typing a follow-up POSTs `/processes/:id/prewarm` once after the debounce,
 *    routed through the workspace-specific client;
 *  - the warm dot is driven ONLY by the SSE stream (initial snapshot + later
 *    transitions), never by the prewarm response.
 */
/* @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React, { createRef } from 'react';

// ── Minimal EventSource double (warm-only stream) ───────────────────────────
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

// Hoisted prewarm spy referenced by the cloneRegistry mock.
const { getClientSpy, prewarmSpy } = vi.hoisted(() => {
    const prewarmSpy = vi.fn().mockResolvedValue({ warming: true, provider: 'copilot' });
    const getClientSpy = vi.fn((_ws: string | null | undefined) => ({ processes: { prewarm: prewarmSpy } }));
    return { getClientSpy, prewarmSpy };
});

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
}));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({ preferences: { getLlmToolsConfig: vi.fn().mockResolvedValue({ tools: [], disabledLlmTools: [] }) } }),
}));

// Partial mock: keep the real cloneRegistry surface and only pin cloneApiBase
// (deterministic SSE URL) + getCocClientForWorkspace (prewarm spy).
vi.mock('../../../../src/server/spa/client/react/repos/cloneRegistry', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../../src/server/spa/client/react/repos/cloneRegistry')>();
    return {
        ...actual,
        cloneApiBase: (ws: string | null | undefined) => `https://api.test/${ws}/api`,
        getCocClientForWorkspace: (ws: string | null | undefined) => getClientSpy(ws),
    };
});

import { FollowUpInputArea } from '../../../../src/server/spa/client/react/features/chat/FollowUpInputArea';
import type { FollowUpInputAreaProps } from '../../../../src/server/spa/client/react/features/chat/FollowUpInputArea';
import type { RichTextInputHandle } from '../../../../src/server/spa/client/react/shared/RichTextInput';

const DOT = 'warm-indicator-dot';
const originalEventSource = (globalThis as any).EventSource;

beforeEach(() => {
    vi.useFakeTimers();
    MockEventSource.reset();
    getClientSpy.mockClear();
    prewarmSpy.mockClear();
    (globalThis as any).EventSource = MockEventSource;
    Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
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

describe('FollowUpInputArea — typing-driven prewarm', () => {
    it('POSTs prewarm once after the debounce when the composer has text', () => {
        const { rerender } = render(<FollowUpInputArea {...makeProps({ followUpInput: '' })} />);
        // Empty → no prewarm.
        act(() => { vi.advanceTimersByTime(500); });
        expect(prewarmSpy).not.toHaveBeenCalled();

        // Typing → one debounced prewarm routed through the workspace client.
        rerender(<FollowUpInputArea {...makeProps({ followUpInput: 'hello' })} />);
        act(() => { vi.advanceTimersByTime(499); });
        expect(prewarmSpy).not.toHaveBeenCalled();
        act(() => { vi.advanceTimersByTime(1); });
        expect(prewarmSpy).toHaveBeenCalledTimes(1);
        expect(getClientSpy).toHaveBeenCalledWith('ws-1');
        expect(prewarmSpy).toHaveBeenCalledWith('proc-1', { workspace: 'ws-1' });
    });

    it('does not prewarm while a generation is active (suppressed)', () => {
        render(<FollowUpInputArea {...makeProps({ followUpInput: 'hello', isActiveGeneration: true })} />);
        act(() => { vi.advanceTimersByTime(1000); });
        expect(prewarmSpy).not.toHaveBeenCalled();
    });

    it('keeps the warm dot driven by SSE — the prewarm response never sets it', () => {
        const { getByTestId } = render(<FollowUpInputArea {...makeProps({ followUpInput: 'hello' })} />);
        // Prewarm fires (resolves warming:true)…
        act(() => { vi.advanceTimersByTime(500); });
        expect(prewarmSpy).toHaveBeenCalledTimes(1);
        // …but the dot stays cold until the SSE stream says otherwise.
        expect(getByTestId(DOT).getAttribute('data-status')).toBe('cold');

        // Stream pushes warm → dot turns green.
        act(() => { MockEventSource.last!.emitWarm('warm'); });
        expect(getByTestId(DOT).getAttribute('data-status')).toBe('warm');
    });

    it('shows green immediately when the stream sends warm as its initial snapshot', () => {
        const { getByTestId } = render(<FollowUpInputArea {...makeProps()} />);
        // Backend's initial snapshot for an already-warm chat.
        act(() => { MockEventSource.last!.emitWarm('warm'); });
        expect(getByTestId(DOT).getAttribute('data-status')).toBe('warm');
        // No prewarm needed for the dot to be green.
        expect(prewarmSpy).not.toHaveBeenCalled();
    });
});
