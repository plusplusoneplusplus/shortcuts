/**
 * Wiring test for FollowUpInputArea → usePrewarmClient (AC-05).
 *
 * Proves the composer drives a debounced, workspace-routed prewarm of the
 * provider client while the user types a follow-up, and that it is suppressed
 * while a turn is generating.
 */
/* @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React, { createRef } from 'react';

const { prewarmSpy, getClientSpy } = vi.hoisted(() => ({
    prewarmSpy: vi.fn(),
    getClientSpy: vi.fn(),
}));

// Minimal RichTextInput double — the composer text is driven by the
// followUpInput prop, so the double only needs a stable imperative handle.
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

// Partial mock: keep the real cloneRegistry surface (lookupCloneBaseUrl, etc.,
// used by sibling chat hooks) and only override the prewarm entry point.
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

beforeEach(() => {
    vi.useFakeTimers();
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

describe('FollowUpInputArea — prewarm wiring', () => {
    it('prewarms the workspace-routed client after debounced typing', () => {
        const props = makeProps();
        const { rerender } = render(<FollowUpInputArea {...props} />);

        act(() => { rerender(<FollowUpInputArea {...props} followUpInput="hello" />); });
        act(() => { vi.advanceTimersByTime(PREWARM_DEBOUNCE_MS); });

        expect(getClientSpy).toHaveBeenCalledWith('ws-1');
        expect(prewarmSpy).toHaveBeenCalledTimes(1);
        expect(prewarmSpy).toHaveBeenCalledWith('proc-1', { workspace: 'ws-1' });
    });

    it('does not prewarm on empty input', () => {
        const props = makeProps();
        render(<FollowUpInputArea {...props} />);
        act(() => { vi.advanceTimersByTime(PREWARM_DEBOUNCE_MS * 4); });
        expect(prewarmSpy).not.toHaveBeenCalled();
    });

    it('does not prewarm while a turn is generating', () => {
        const props = makeProps({ isActiveGeneration: true });
        const { rerender } = render(<FollowUpInputArea {...props} />);
        act(() => { rerender(<FollowUpInputArea {...props} followUpInput="queued" />); });
        act(() => { vi.advanceTimersByTime(PREWARM_DEBOUNCE_MS * 4); });
        expect(prewarmSpy).not.toHaveBeenCalled();
    });
});
