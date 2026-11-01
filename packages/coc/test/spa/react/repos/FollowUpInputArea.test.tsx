/**
 * Regression tests for FollowUpInputArea.
 *
 * Key regression: after Tab-selecting a skill, the useEffect sync-guard must NOT
 * call setValue a second time without a cursorPos, which would reset the cursor
 * to position 0 (before the slash).
 */
/* @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, act, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React, { createRef } from 'react';

// Hoist a call tracker so the mock factory can reference it before imports
const { tracker, mockBrowserEnabled, mockPatchMetadata, mockRalphEnabled, mockForEachEnabled, mockSessionContextAttachmentsEnabled, mockGetLlmToolsConfig, mockGetSentinelTodos } = vi.hoisted(() => ({
    mockBrowserEnabled: { value: false },
    mockPatchMetadata: vi.fn(),
    tracker: {
        calls: [] as Array<[string, number?]>,
        domValue: '',
        onChange: undefined as undefined | ((val: string, cursorPos: number) => void),
    },
    mockRalphEnabled: { value: false },
    mockForEachEnabled: { value: false },
    mockSessionContextAttachmentsEnabled: { value: false },
    mockGetLlmToolsConfig: vi.fn(),
    mockGetSentinelTodos: vi.fn(),
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
            tracker.onChange = props.onChange;
            return R.createElement('div', {
                'data-testid': props['data-testid'],
                onKeyDown: props.onKeyDown,
            });
        }),
    };
});

vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    getFeatureValue: () => false,
    isBrowserControlEnabled: () => mockBrowserEnabled.value,
    isComposerWordHintEnabled: () => false,
    DASHBOARD_CONFIG_UPDATED_EVENT: 'coc-dashboard-config-updated',
    isRalphEnabled: () => mockRalphEnabled.value,
    isForEachEnabled: () => mockForEachEnabled.value,
    isSessionContextAttachmentsEnabled: () => mockSessionContextAttachmentsEnabled.value,
    getPrewarmDebounceMs: () => 500,
    getWarmClientTtlMs: () => 300000,
}));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getCocClientFor: () => ({
        processes: { patchMetadata: mockPatchMetadata },
        sentinelTodos: { get: mockGetSentinelTodos },
        preferences: { getLlmToolsConfig: mockGetLlmToolsConfig },
    }),
    getSpaCocClient: () => ({
        processes: { patchMetadata: mockPatchMetadata },
        sentinelTodos: { get: mockGetSentinelTodos },
        preferences: {
            getLlmToolsConfig: mockGetLlmToolsConfig,
        },
    }),
}));

import { UnifiedPanelHostProvider } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelHost';
import * as panelOpen from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelOpen';
import { clearUnifiedPanelState, readUnifiedPanelState } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelStore';
import { readPasteSnapshot } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPasteTabs';
import { FollowUpInputArea } from '../../../../src/server/spa/client/react/features/chat/FollowUpInputArea';
import type { FollowUpInputAreaProps } from '../../../../src/server/spa/client/react/features/chat/FollowUpInputArea';
import type { RichTextInputHandle } from '../../../../src/server/spa/client/react/shared/RichTextInput';
import {
    FILE_PATH_DRAG_KIND,
    FILE_PATH_DRAG_MIME,
    POINTER_CONTEXT_DRAG_MIME,
    createGitCommitContextDragPayload,
    RALPH_SESSION_CONTEXT_DRAG_KIND,
    RALPH_SESSION_CONTEXT_DRAG_MIME,
    SESSION_CONTEXT_DRAG_KIND,
    SESSION_CONTEXT_DRAG_MIME,
    type RalphSessionContextDragPayload,
    type SessionContextDragPayload,
} from '../../../../src/server/spa/client/react/features/chat/sessionContextDrag';
import { createWorkingTreeFileContextPayload } from '../../../../src/server/spa/client/react/features/chat/gitFileContext';
import { createSentinelTodoContextPayload } from '../../../../src/server/spa/client/react/features/chat/sentinelTodoContext';
import { useAttachedContext } from '../../../../src/server/spa/client/react/features/chat/hooks/useAttachedContext';
import { attachSelectionToChat, resetActiveChatAttach } from '../../../../src/server/spa/client/react/features/chat/activeChatAttach';
import { registerCloneBaseUrls, resetCloneRegistryForTests } from '../../../../src/server/spa/client/react/repos/cloneRegistry';

afterEach(() => {
    resetCloneRegistryForTests();
    delete (window as any).cocDesktop;
    vi.restoreAllMocks();
});

beforeEach(() => {
    mockBrowserEnabled.value = false;
    mockPatchMetadata.mockReset().mockResolvedValue({ process: { metadata: { browserMode: false } } });
    tracker.calls = [];
    tracker.domValue = '';
    tracker.onChange = undefined;
    mockRalphEnabled.value = false;
    mockForEachEnabled.value = false;
    mockSessionContextAttachmentsEnabled.value = false;
    mockGetSentinelTodos.mockReset();
    resetActiveChatAttach();
    mockGetLlmToolsConfig.mockResolvedValue({
        tools: [{ name: 'get_conversation', label: 'Get Conversation', description: '', enabledByDefault: true }],
        disabledLlmTools: [],
        conversationRetrievalAvailable: true,
    });
    // JSDOM does not implement scrollIntoView
    Element.prototype.scrollIntoView = vi.fn();
});

function makeSessionPayload(overrides: Partial<SessionContextDragPayload> = {}): SessionContextDragPayload {
    return {
        kind: SESSION_CONTEXT_DRAG_KIND,
        version: 1,
        sourceWorkspaceId: 'ws-1',
        sourceProcessId: 'source-process-123456',
        title: 'Source chat',
        status: 'completed',
        lastActivityAt: '2026-01-01T00:00:00.000Z',
        ...overrides,
    };
}

function makeRalphPayload(overrides: Partial<RalphSessionContextDragPayload> = {}): RalphSessionContextDragPayload {
    return {
        kind: RALPH_SESSION_CONTEXT_DRAG_KIND,
        version: 1,
        sourceWorkspaceId: 'ws-1',
        sourceRalphSessionId: 'ralph-session-0001',
        title: 'Ralph source',
        displayLabel: 'Ralph source - 2 iter',
        phase: 'executing',
        status: 'running',
        lastActivityAt: '2026-01-01T00:00:00.000Z',
        childProcessIds: ['grill-proc', 'iter-1', 'iter-2'],
        processCount: 3,
        iterationCount: 2,
        ...overrides,
    };
}

function makeSessionDataTransfer(payload: unknown, mime = SESSION_CONTEXT_DRAG_MIME) {
    return {
        types: [mime],
        dropEffect: 'none',
        getData: vi.fn((format: string) => format === mime ? JSON.stringify(payload) : ''),
    };
}

function makeUnsupportedDataTransfer() {
    return {
        types: ['text/plain'],
        dropEffect: 'none',
        getData: vi.fn(() => 'not coc context'),
    };
}

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
        skills: [{ name: 'impl', description: 'Implement' }],
        attachments: [],
        onAttachmentPaste: vi.fn(),
        onAttachmentRemove: vi.fn(),
        onAttachmentFiles: vi.fn(),
        attachmentError: null,
        attachedContext: [],
        onRemoveAttachedContext: vi.fn(),
        onAttachSessionContext: vi.fn(),
        workspaceId: 'ws-1',
        currentProcessId: 'current-process',
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

describe('FollowUpInputArea browser mode', () => {
    it('uses the concrete conversation owner rather than the selected repo group', async () => {
        mockBrowserEnabled.value = true;
        (window as any).cocDesktop = { browser: {} };
        mockGetLlmToolsConfig.mockResolvedValue({ tools: [{ name: 'browser' }], disabledLlmTools: [] });
        render(<FollowUpInputArea {...makeProps({ browserModeActive: true, workspaceId: 'group-scope',
            browserOwner: { workspaceId: 'ws-child', routingRef: 'ws-child' } })} />);
        await screen.findByTestId('browser-mode-pill');
        expect(mockGetLlmToolsConfig).toHaveBeenCalledWith('ws-child');
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Turn off browser mode' })); });
        expect(mockPatchMetadata).toHaveBeenCalledWith('current-process', { set: { browserMode: false } }, { workspace: 'ws-child' });
    });
    it('persists removal on the owning process without submitting a message', async () => {
        mockBrowserEnabled.value = true;
        (window as any).cocDesktop = { browser: {} };
        mockGetLlmToolsConfig.mockResolvedValue({ tools: [{ name: 'browser' }], disabledLlmTools: [] });
        const onChange = vi.fn();
        const props = makeProps({ browserModeActive: true, onBrowserModeChange: onChange });
        render(<FollowUpInputArea {...props} />);
        await screen.findByTestId('browser-mode-pill');
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Turn off browser mode' })); });
        expect(mockPatchMetadata).toHaveBeenCalledWith('current-process', { set: { browserMode: false } }, { workspace: 'ws-1' });
        expect(onChange).toHaveBeenCalledWith(false);
        expect(props.onSend).not.toHaveBeenCalled();
        expect(screen.queryByTestId('browser-mode-pill')).toBeNull();
    });
    it.each([false, true])('suppresses persisted browser mode when flag/repo gating is off: flag=%s', async flag => {
        mockBrowserEnabled.value = flag;
        (window as any).cocDesktop = { browser: {} };
        mockGetLlmToolsConfig.mockResolvedValue({ tools: [{ name: 'browser' }], disabledLlmTools: ['browser'] });
        await act(async () => { render(<FollowUpInputArea {...makeProps({ browserModeActive: true })} />); });
        expect(screen.queryByTestId('browser-mode-pill')).toBeNull();
    });
});

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

    it('normal click on suggestion chip populates input instead of sending', () => {
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
        fireEvent.click(screen.getByTestId('suggestion-chip'));
        expect(onSend).not.toHaveBeenCalled();
        expect(setFollowUpInput).toHaveBeenCalledWith('Run tests');
        expect(tracker.calls).toContainEqual(['Run tests', undefined]);
    });

    it('Ctrl+click on suggestion chip sends instead of populating', () => {
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
        expect(onSend).toHaveBeenCalledWith('Run tests');
        expect(setFollowUpInput).not.toHaveBeenCalled();
    });

    it('Meta+click on suggestion chip sends (macOS parity)', () => {
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
        expect(onSend).toHaveBeenCalledWith('Run tests');
        expect(setFollowUpInput).not.toHaveBeenCalled();
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

    it('keeps follow-up draft text when selecting a model from the picker', () => {
        const setFollowUpInput = vi.fn();
        const handleModelSelect = vi.fn();
        render(<FollowUpInputArea {...makeProps({
            followUpInput: 'Keep this follow-up',
            setFollowUpInput,
            modelCommand: {
                modelMenuVisible: true,
                modelFilter: '',
                filteredModels: [{ id: 'gpt-5.4', name: 'GPT 5.4', enabled: true }],
                modelHighlightIndex: 0,
                modelOverride: null,
                setModelOverride: vi.fn(),
                handleModelSelect,
                showModelMenu: vi.fn(),
                dismissModelMenu: vi.fn(),
                handleModelKeyDown: vi.fn(() => false),
                setModelFilter: vi.fn(),
            },
        })} />);

        fireEvent.mouseDown(screen.getByText('GPT 5.4'));

        expect(handleModelSelect).toHaveBeenCalledWith('gpt-5.4');
        expect(setFollowUpInput).not.toHaveBeenCalledWith('');
        expect(tracker.calls).not.toContainEqual(['', undefined]);
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

    it('shows the "Send" label by default', () => {
        render(<FollowUpInputArea {...makeProps()} />);
        const btn = screen.getByTestId('activity-chat-send-btn');
        expect(btn.textContent).toContain('Send');
    });
});

describe('FollowUpInputArea — composer metadata strip', () => {
    it('renders the cwd chip when workingDirectory is provided (stacked layout)', () => {
        render(<FollowUpInputArea {...makeProps({ workingDirectory: '/Users/yh/proj/shortcuts' })} />);
        const chip = screen.getByTestId('composer-cwd-chip');
        expect(chip).toBeTruthy();
        expect(chip.textContent).toContain('shortcuts');
    });

    it('renders the ctx fuel gauge when token limit is provided (stacked layout)', () => {
        render(<FollowUpInputArea {...makeProps({ sessionTokenLimit: 200_000, sessionCurrentTokens: 84_300 })} />);
        expect(screen.getByTestId('composer-ctx-fuel')).toBeTruthy();
        expect(screen.getByTestId('composer-ctx-pct').textContent).toBe('42%');
    });

    it('renders nothing for the strip when neither cwd nor ctx is provided (stacked layout)', () => {
        render(<FollowUpInputArea {...makeProps()} />);
        expect(screen.queryByTestId('composer-meta-strip')).toBeNull();
    });
});

describe('FollowUpInputArea — dismiss suggestions', () => {
    it('shows dismiss button when suggestions are present', () => {
        render(<FollowUpInputArea {...makeProps({ suggestions: ['Option A', 'Option B', 'Option C'] })} />);
        expect(screen.getByTestId('dismiss-suggestions-btn')).toBeTruthy();
    });

    it('hides chips after dismiss button is clicked', () => {
        render(<FollowUpInputArea {...makeProps({ suggestions: ['Option A', 'Option B', 'Option C'] })} />);
        fireEvent.click(screen.getByTestId('dismiss-suggestions-btn'));
        expect(screen.queryByTestId('suggestion-chips')).toBeNull();
        expect(screen.queryByTestId('dismiss-suggestions-btn')).toBeNull();
    });

    it('does not show dismiss button when suggestions is empty', () => {
        render(<FollowUpInputArea {...makeProps({ suggestions: [] })} />);
        expect(screen.queryByTestId('dismiss-suggestions-btn')).toBeNull();
    });

    it('resets dismissed state when suggestions prop changes', async () => {
        const { rerender } = render(
            <FollowUpInputArea {...makeProps({ suggestions: ['Option A'] })} />
        );
        // Dismiss the first set
        fireEvent.click(screen.getByTestId('dismiss-suggestions-btn'));
        expect(screen.queryByTestId('suggestion-chips')).toBeNull();

        // New suggestions arrive — chips should reappear
        await act(async () => {
            rerender(<FollowUpInputArea {...makeProps({ suggestions: ['New suggestion'] })} />);
        });
        expect(screen.getByTestId('suggestion-chips')).toBeTruthy();
        expect(screen.getByTestId('dismiss-suggestions-btn')).toBeTruthy();
    });
});

describe('FollowUpInputArea — session context drops', () => {
    it.each([false, true])('attaches a concrete member commit to a group-owned follow-up composer (remote=%s)', async remote => {
        mockSessionContextAttachmentsEnabled.value = true;
        const workspaceId = 'group-team';
        const memberId = 'ws-member';
        const owner = remote ? `remote:server-a:${workspaceId}` : workspaceId;
        const sourceRoutingRef = remote ? `remote:server-a:${memberId}` : null;
        if (remote) registerCloneBaseUrls([workspaceId, memberId].map(id => ({
            workspaceId: id, serverId: 'server-a', baseUrl: 'https://a.example',
        })));
        const onAttachSessionContext = vi.fn();
        render(<FollowUpInputArea {...makeProps({
            workspaceId, attachmentDestinationId: owner, canRetrieveConversations: false, onAttachSessionContext,
        })} />);
        const payload = createGitCommitContextDragPayload({ hash: 'abcdef1234567890' }, {
            activeWorkspaceId: memberId, sourceRoutingRef,
        });
        fireEvent.drop(screen.getByTestId('chat-input-bar'), {
            dataTransfer: makeSessionDataTransfer(payload, POINTER_CONTEXT_DRAG_MIME),
        });
        expect(onAttachSessionContext).toHaveBeenCalledWith(expect.objectContaining({
            sourceWorkspaceId: memberId, sourceRoutingRef, commitHash: 'abcdef1234567890',
        }));
        expect(screen.queryByTestId('follow-up-session-context-error')).toBeNull();
    });

    const todoOwner = { ownerWorkspaceId: 'ws-1', ownerRoutingRef: null, processId: 'current-process' };
    const todoPayload = createSentinelTodoContextPayload(todoOwner, { id: 'todo-1', title: 'Dragged title' });
    function TodoComposer({ owner = todoOwner, ...overrides }: Partial<FollowUpInputAreaProps> & { owner?: typeof todoOwner }) {
        const context = useAttachedContext();
        return <FollowUpInputArea {...makeProps({
            sentinelTodoOwner: owner, canRetrieveConversations: false,
            getAttachedContext: context.getItems,
            attachedContext: context.items, onAttachSessionContext: context.addSessionContext,
            onRemoveAttachedContext: context.remove, ...overrides,
        })} />;
    }

    it('resolves a drop without sending or changing text, deduplicates, removes and reattaches a native chip', async () => {
        mockSessionContextAttachmentsEnabled.value = true;
        mockGetSentinelTodos.mockResolvedValue({ items: [{ id: 'todo-1', title: 'Authoritative title' }] });
        const onSend = vi.fn();
        const setFollowUpInput = vi.fn();
        render(<TodoComposer onSend={onSend} followUpInput="Keep my draft" setFollowUpInput={setFollowUpInput} />);
        const transfer = makeSessionDataTransfer(todoPayload, POINTER_CONTEXT_DRAG_MIME);
        fireEvent.dragEnter(screen.getByTestId('chat-input-bar'), { dataTransfer: transfer });
        expect(screen.getByTestId('session-context-drop-hint')).toBeTruthy();
        await act(async () => { fireEvent.drop(screen.getByTestId('chat-input-bar'), { dataTransfer: transfer }); });
        expect(screen.getByTestId('attached-sentinel-todo-context-chip').textContent).toContain('Authoritative title');
        expect(screen.getByTestId('attached-sentinel-todo-context-chip').textContent).toContain('todo-1');
        expect(screen.getByTestId('attached-sentinel-todo-context-chip').querySelector('[title="todo-1"]')?.className).toContain('shrink-0');
        expect(mockGetSentinelTodos).toHaveBeenCalledWith('ws-1', 'current-process', { itemId: 'todo-1' });
        expect(onSend).not.toHaveBeenCalled();
        expect(setFollowUpInput).not.toHaveBeenCalled();
        fireEvent.drop(screen.getByTestId('chat-input-bar'), { dataTransfer: transfer });
        expect(screen.getByTestId('follow-up-session-context-error').textContent).toContain('already attached');
        expect(screen.getAllByTestId('attached-sentinel-todo-context-chip')).toHaveLength(1);
        expect(mockGetSentinelTodos).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByRole('button', { name: 'Remove context' }));
        expect(screen.queryByTestId('attached-sentinel-todo-context-chip')).toBeNull();
        await act(async () => { fireEvent.drop(screen.getByTestId('chat-input-bar'), { dataTransfer: transfer }); });
        expect(screen.getByTestId('attached-sentinel-todo-context-chip')).toBeTruthy();
    });

    it('supports the attach channel for the owning Sentinel without a new-chat fallback', async () => {
        mockSessionContextAttachmentsEnabled.value = true;
        mockGetSentinelTodos.mockResolvedValue({ items: [{ id: 'todo-1', title: 'From keyboard or touch' }] });
        render(<TodoComposer />);
        await act(async () => {
            expect(attachSelectionToChat('ws-1', todoPayload)).toBe('active-chat');
        });
        expect(screen.getByTestId('attached-sentinel-todo-context-chip').textContent).toContain('From keyboard or touch');
        expect(mockGetSentinelTodos).toHaveBeenCalledWith('ws-1', 'current-process', { itemId: 'todo-1' });
    });

    it('enforces the shared context cap when several authoritative drop reads finish together', async () => {
        mockSessionContextAttachmentsEnabled.value = true;
        let resolve!: (value: unknown) => void;
        mockGetSentinelTodos.mockReturnValue(new Promise(r => { resolve = r; }));
        render(<TodoComposer />);
        for (let index = 1; index <= 4; index++) {
            fireEvent.drop(screen.getByTestId('chat-input-bar'), {
                dataTransfer: makeSessionDataTransfer({ ...todoPayload, todoItemId: `todo-${index}` }, POINTER_CONTEXT_DRAG_MIME),
            });
        }
        await act(async () => {
            resolve({ items: [1, 2, 3, 4].map(index => ({ id: `todo-${index}`, title: `Item ${index}` })) });
        });
        expect(screen.getAllByTestId('attached-sentinel-todo-context-chip')).toHaveLength(3);
        expect(screen.getByTestId('follow-up-session-context-error').textContent).toContain('up to 3');
    });

    it.each([
        { ...todoPayload, sourceWorkspaceId: 'ws-other' },
        { ...todoPayload, sourceProcessId: 'other-sentinel' },
        { ...todoPayload, sourceRoutingRef: 'remote:other:ws-1' },
    ])('rejects a wrong owner before any ledger read', async payload => {
        mockSessionContextAttachmentsEnabled.value = true;
        render(<TodoComposer />);
        fireEvent.drop(screen.getByTestId('chat-input-bar'), {
            dataTransfer: makeSessionDataTransfer(payload, POINTER_CONTEXT_DRAG_MIME),
        });
        expect(screen.getByTestId('follow-up-session-context-error')).toBeTruthy();
        expect(mockGetSentinelTodos).not.toHaveBeenCalled();
        expect(screen.queryByTestId('attached-sentinel-todo-context-chip')).toBeNull();
    });

    it.each(['missing', 'error'])('reports %s items without attaching or sending', async failure => {
        mockSessionContextAttachmentsEnabled.value = true;
        if (failure === 'missing') mockGetSentinelTodos.mockResolvedValue({ items: [] });
        else mockGetSentinelTodos.mockRejectedValue(new Error('Ledger unavailable'));
        const onSend = vi.fn();
        render(<TodoComposer onSend={onSend} />);
        await act(async () => {
            fireEvent.drop(screen.getByTestId('chat-input-bar'), {
                dataTransfer: makeSessionDataTransfer(todoPayload, POINTER_CONTEXT_DRAG_MIME),
            });
        });
        expect(screen.getByTestId('follow-up-session-context-error').textContent).toMatch(/missing|unavailable/);
        expect(screen.queryByTestId('attached-sentinel-todo-context-chip')).toBeNull();
        expect(onSend).not.toHaveBeenCalled();
    });

    it('blocks send and duplicate drops during resolution and ignores a late response after an owner switch', async () => {
        mockSessionContextAttachmentsEnabled.value = true;
        let resolve!: (value: unknown) => void;
        mockGetSentinelTodos.mockReturnValue(new Promise(r => { resolve = r; }));
        const onSend = vi.fn();
        const { rerender } = render(<TodoComposer onSend={onSend} selectedMode="sentinel" sentinelNextStepsEnabled suggestions={['Finish safeguards']} />);
        const transfer = makeSessionDataTransfer(todoPayload, POINTER_CONTEXT_DRAG_MIME);
        fireEvent.drop(screen.getByTestId('chat-input-bar'), { dataTransfer: transfer });
        expect(screen.getByTestId('activity-chat-send-btn').hasAttribute('disabled')).toBe(true);
        fireEvent.click(screen.getByTestId('suggestion-chip'));
        expect(onSend).not.toHaveBeenCalled();
        fireEvent.drop(screen.getByTestId('chat-input-bar'), { dataTransfer: transfer });
        expect(mockGetSentinelTodos).toHaveBeenCalledTimes(1);
        rerender(<TodoComposer owner={{ ...todoOwner, processId: 'next-sentinel' }} onSend={onSend} />);
        await act(async () => { resolve({ items: [{ id: 'todo-1', title: 'Stale title' }] }); });
        expect(screen.queryByTestId('attached-sentinel-todo-context-chip')).toBeNull();
        expect(onSend).not.toHaveBeenCalled();
        mockGetSentinelTodos.mockResolvedValue({ items: [{ id: 'todo-1', title: 'Next owner' }] });
        await act(async () => { fireEvent.drop(screen.getByTestId('chat-input-bar'), {
            dataTransfer: makeSessionDataTransfer({ ...todoPayload, sourceProcessId: 'next-sentinel' }, POINTER_CONTEXT_DRAG_MIME),
        }); });
        expect(screen.getByTestId('attached-sentinel-todo-context-chip').textContent).toContain('Next owner');
    });

    it('passes a valid dropped session to the parent when enabled', async () => {
        mockSessionContextAttachmentsEnabled.value = true;
        const onAttachSessionContext = vi.fn();
        render(<FollowUpInputArea {...makeProps({ onAttachSessionContext })} />);
        await act(async () => { await Promise.resolve(); });

        fireEvent.drop(screen.getByTestId('chat-input-bar'), {
            dataTransfer: makeSessionDataTransfer(makeSessionPayload()),
        });

        expect(onAttachSessionContext).toHaveBeenCalledWith(makeSessionPayload());
        expect(screen.queryByTestId('follow-up-session-context-error')).toBeNull();
    });

    it('highlights the composer with copy semantics while dragging supported context', async () => {
        mockSessionContextAttachmentsEnabled.value = true;
        const onAttachSessionContext = vi.fn();
        render(<FollowUpInputArea {...makeProps({ onAttachSessionContext })} />);
        await act(async () => { await Promise.resolve(); });

        const dataTransfer = makeSessionDataTransfer(makeSessionPayload());
        fireEvent.dragEnter(screen.getByTestId('chat-input-bar'), { dataTransfer });

        expect(dataTransfer.dropEffect).toBe('copy');
        expect(screen.getByTestId('session-context-drop-hint').textContent).toBe('Drop to copy context');
        expect(screen.getByTestId('chat-input-bar').className).toContain('ring-[#0078d4]/60');

        fireEvent.drop(screen.getByTestId('chat-input-bar'), { dataTransfer });
        expect(screen.queryByTestId('session-context-drop-hint')).toBeNull();
        expect(onAttachSessionContext).toHaveBeenCalledWith(makeSessionPayload());
    });

    it('shows inline feedback for unsupported composer drops', () => {
        mockSessionContextAttachmentsEnabled.value = true;
        const onAttachSessionContext = vi.fn();
        render(<FollowUpInputArea {...makeProps({ onAttachSessionContext })} />);

        fireEvent.drop(screen.getByTestId('chat-input-bar'), {
            dataTransfer: makeUnsupportedDataTransfer(),
        });

        expect(onAttachSessionContext).not.toHaveBeenCalled();
        expect(screen.getByTestId('follow-up-session-context-error').textContent).toBe(
            'Drop a supported CoC context item from this workspace to attach it as context.',
        );
    });

    it('passes a valid dropped Ralph group to the parent when enabled', async () => {
        mockSessionContextAttachmentsEnabled.value = true;
        const onAttachSessionContext = vi.fn();
        render(<FollowUpInputArea {...makeProps({ onAttachSessionContext })} />);
        await act(async () => { await Promise.resolve(); });

        fireEvent.drop(screen.getByTestId('chat-input-bar'), {
            dataTransfer: makeSessionDataTransfer(makeRalphPayload(), RALPH_SESSION_CONTEXT_DRAG_MIME),
        });

        expect(onAttachSessionContext).toHaveBeenCalledWith(makeRalphPayload());
        expect(screen.queryByTestId('follow-up-session-context-error')).toBeNull();
    });

    it('blocks self-attachment of the current follow-up session', () => {
        mockSessionContextAttachmentsEnabled.value = true;
        const onAttachSessionContext = vi.fn();
        render(<FollowUpInputArea {...makeProps({
            onAttachSessionContext,
            currentProcessId: 'source-process-123456',
        })} />);

        fireEvent.drop(screen.getByTestId('chat-input-bar'), {
            dataTransfer: makeSessionDataTransfer(makeSessionPayload()),
        });

        expect(onAttachSessionContext).not.toHaveBeenCalled();
        expect(screen.getByTestId('follow-up-session-context-error').textContent).toBe(
            'A follow-up cannot attach its own current session as context.',
        );
    });

    it('blocks Ralph groups that include the current follow-up session', () => {
        mockSessionContextAttachmentsEnabled.value = true;
        const onAttachSessionContext = vi.fn();
        render(<FollowUpInputArea {...makeProps({
            onAttachSessionContext,
            currentProcessId: 'iter-1',
        })} />);

        fireEvent.drop(screen.getByTestId('chat-input-bar'), {
            dataTransfer: makeSessionDataTransfer(makeRalphPayload(), RALPH_SESSION_CONTEXT_DRAG_MIME),
        });

        expect(onAttachSessionContext).not.toHaveBeenCalled();
        expect(screen.getByTestId('follow-up-session-context-error').textContent).toBe(
            'A follow-up cannot attach a Ralph session that includes the current chat.',
        );
    });
});

describe('FollowUpInputArea — resume feedback dismiss', () => {
    it('shows resume feedback message when resumeFeedback is set', () => {
        render(<FollowUpInputArea {...makeProps({
            resumeFeedback: { type: 'success', message: 'Copied resume command.', command: 'claude --resume abc123' },
        })} />);
        expect(screen.getByText('Copied resume command.')).toBeTruthy();
        expect(screen.getByText('claude --resume abc123')).toBeTruthy();
    });

    it('renders dismiss button when onDismissResumeFeedback is provided', () => {
        render(<FollowUpInputArea {...makeProps({
            resumeFeedback: { type: 'success', message: 'Copied resume command.' },
            onDismissResumeFeedback: vi.fn(),
        })} />);
        expect(screen.getByRole('button', { name: 'Dismiss' })).toBeTruthy();
    });

    it('does not render dismiss button when onDismissResumeFeedback is not provided', () => {
        render(<FollowUpInputArea {...makeProps({
            resumeFeedback: { type: 'success', message: 'Copied resume command.' },
        })} />);
        expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
    });

    it('calls onDismissResumeFeedback when dismiss button is clicked', () => {
        const onDismissResumeFeedback = vi.fn();
        render(<FollowUpInputArea {...makeProps({
            resumeFeedback: { type: 'success', message: 'Copied resume command.' },
            onDismissResumeFeedback,
        })} />);
        fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
        expect(onDismissResumeFeedback).toHaveBeenCalledTimes(1);
    });

    it('does not render feedback banner when resumeFeedback is null', () => {
        render(<FollowUpInputArea {...makeProps({ resumeFeedback: null })} />);
        expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
    });

    it('renders non-retryable inline errors without the retry button', () => {
        render(<FollowUpInputArea {...makeProps({
            inputDisabled: true,
            nonRetryableError: 'This stopped chat cannot be continued because no SDK session was saved. Start a new chat manually.',
            disabledPlaceholder: 'Cannot continue this stopped chat.',
        })} />);
        expect(screen.getByTestId('follow-up-inline-error').textContent).toContain('no SDK session was saved');
        expect(screen.queryByTestId('retry-btn')).toBeNull();
    });

    it('dismiss button appears for error-type feedback too', () => {
        const onDismissResumeFeedback = vi.fn();
        render(<FollowUpInputArea {...makeProps({
            resumeFeedback: { type: 'error', message: 'Failed to copy resume command.' },
            onDismissResumeFeedback,
        })} />);
        expect(screen.getByText('Failed to copy resume command.')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Dismiss' })).toBeTruthy();
    });
});

describe('FollowUpInputArea — retry-task affordance', () => {
    const nonRetryableError = 'This stopped chat cannot be continued because no SDK session was saved. Start a new chat manually.';

    it('renders a "Retry task" button inside the non-retryable error when onRetryTask is provided', () => {
        const onRetryTask = vi.fn();
        render(<FollowUpInputArea {...makeProps({
            inputDisabled: true,
            nonRetryableError,
            onRetryTask,
            disabledPlaceholder: 'Cannot continue this stopped chat.',
        })} />);
        const btn = screen.getByTestId('retry-task-button');
        expect(btn.textContent).toBe('Retry task');
        fireEvent.click(btn);
        expect(onRetryTask).toHaveBeenCalledTimes(1);
    });

    it('does not render the "Retry task" button when onRetryTask is absent (back-compat)', () => {
        render(<FollowUpInputArea {...makeProps({
            inputDisabled: true,
            nonRetryableError,
            disabledPlaceholder: 'Cannot continue this stopped chat.',
        })} />);
        expect(screen.getByTestId('follow-up-inline-error').textContent).toContain('no SDK session was saved');
        expect(screen.queryByTestId('retry-task-button')).toBeNull();
    });

    it('disables the "Retry task" button and shows a busy label while retrying', () => {
        const onRetryTask = vi.fn();
        render(<FollowUpInputArea {...makeProps({
            inputDisabled: true,
            nonRetryableError,
            onRetryTask,
            retryingTask: true,
        })} />);
        const btn = screen.getByTestId('retry-task-button') as HTMLButtonElement;
        expect(btn.disabled).toBe(true);
        expect(btn.textContent).toBe('Retrying…');
    });

    it('shows no "Retry task" button when there is no non-retryable error', () => {
        const onRetryTask = vi.fn();
        render(<FollowUpInputArea {...makeProps({ onRetryTask })} />);
        expect(screen.queryByTestId('retry-task-button')).toBeNull();
    });
});


function makeFilePathDataTransfer(paths: string[], workspaceId = 'ws-1') {
    const payload = { kind: FILE_PATH_DRAG_KIND, version: 1, workspaceId, paths };
    return {
        types: [FILE_PATH_DRAG_MIME, 'text/plain'],
        dropEffect: 'none',
        getData: vi.fn((format: string) => (format === FILE_PATH_DRAG_MIME ? JSON.stringify(payload) : paths.join('\n'))),
    };
}

describe('FollowUpInputArea — Explorer file-path drops (AC-02/AC-03)', () => {
    it('inserts the backticked path at the tracked caret with one trailing space', async () => {
        render(<FollowUpInputArea {...makeProps()} />);
        await act(async () => { await Promise.resolve(); });

        // Simulate the user having typed, leaving the caret after "explain ".
        tracker.domValue = 'explain hello';
        await act(async () => { tracker.onChange?.('explain hello', 8); });
        tracker.calls = [];

        fireEvent.drop(screen.getByTestId('chat-input-bar'), {
            dataTransfer: makeFilePathDataTransfer(['packages/coc/src/foo.ts']),
        });

        expect(tracker.calls).toEqual([['explain `packages/coc/src/foo.ts` hello', 34]]);
        expect(screen.queryByTestId('follow-up-session-context-error')).toBeNull();
    });

    it('appends at the end when the composer was never focused', async () => {
        render(<FollowUpInputArea {...makeProps({ followUpInput: 'explain ' })} />);
        await act(async () => { await Promise.resolve(); });
        tracker.domValue = 'explain ';
        tracker.calls = [];

        fireEvent.drop(screen.getByTestId('chat-input-bar'), {
            dataTransfer: makeFilePathDataTransfer(['docs/a.md']),
        });

        expect(tracker.calls).toEqual([['explain `docs/a.md` ', 20]]);
    });

    it('joins multiple dragged paths, each individually backticked', async () => {
        render(<FollowUpInputArea {...makeProps()} />);
        await act(async () => { await Promise.resolve(); });
        tracker.calls = [];

        fireEvent.drop(screen.getByTestId('chat-input-bar'), {
            dataTransfer: makeFilePathDataTransfer(['a.ts', 'b.ts']),
        });

        expect(tracker.calls[0][0]).toBe('`a.ts` `b.ts` ');
    });

    it('never shows the unsupported-payload error for a file-path drop, even with attachments disabled', async () => {
        mockSessionContextAttachmentsEnabled.value = false;
        const onAttachSessionContext = vi.fn();
        render(<FollowUpInputArea {...makeProps({ onAttachSessionContext })} />);
        await act(async () => { await Promise.resolve(); });

        fireEvent.drop(screen.getByTestId('chat-input-bar'), {
            dataTransfer: makeFilePathDataTransfer(['a.ts']),
        });

        expect(screen.queryByTestId('follow-up-session-context-error')).toBeNull();
        expect(onAttachSessionContext).not.toHaveBeenCalled();
    });

    it('shows the drop hint while a file-path drag is over the composer', async () => {
        mockSessionContextAttachmentsEnabled.value = false;
        render(<FollowUpInputArea {...makeProps()} />);
        await act(async () => { await Promise.resolve(); });

        const dataTransfer = makeFilePathDataTransfer(['a.ts']);
        fireEvent.dragEnter(screen.getByTestId('chat-input-bar'), { dataTransfer });

        expect(dataTransfer.dropEffect).toBe('copy');
        expect(screen.getByTestId('session-context-drop-hint')).toBeTruthy();

        fireEvent.dragLeave(screen.getByTestId('chat-input-bar'), { dataTransfer });
        expect(screen.queryByTestId('session-context-drop-hint')).toBeNull();
    });

    it('leaves an OS file drop (no CoC payload) to the existing attachment path', async () => {
        render(<FollowUpInputArea {...makeProps()} />);
        await act(async () => { await Promise.resolve(); });
        tracker.calls = [];

        fireEvent.drop(screen.getByTestId('chat-input-bar'), {
            dataTransfer: { types: ['Files'], dropEffect: 'none', getData: vi.fn(() => '') },
        });

        expect(tracker.calls).toEqual([]);
    });
});


describe('FollowUpInputArea — source tab file drops', () => {
    const skillPath = 'packages/forge/resources/bundled-skills/delegate/SKILL.md';
    function FileComposer(overrides: Partial<FollowUpInputAreaProps>) {
        const context = useAttachedContext();
        return <FollowUpInputArea {...makeProps({
            canRetrieveConversations: false, getAttachedContext: context.getItems,
            attachedContext: context.items, onAttachSessionContext: context.addSessionContext,
            onRemoveAttachedContext: context.remove, ...overrides,
        })} />;
    }
    const tabTransfer = (tab: { ownerWorkspaceId: string; ownerRoutingRef?: string | null; resourceId: string }) =>
        makeSessionDataTransfer(createWorkingTreeFileContextPayload(tab), POINTER_CONTEXT_DRAG_MIME);

    it('attaches a dropped file tab as a removable File chip without sending or touching the draft', async () => {
        mockSessionContextAttachmentsEnabled.value = true;
        const onSend = vi.fn();
        const setFollowUpInput = vi.fn();
        render(<FileComposer onSend={onSend} followUpInput="Keep my draft" setFollowUpInput={setFollowUpInput} />);
        await act(async () => { await Promise.resolve(); });
        tracker.calls = [];
        const transfer = tabTransfer({ ownerWorkspaceId: 'ws-1', resourceId: skillPath });
        fireEvent.dragEnter(screen.getByTestId('chat-input-bar'), { dataTransfer: transfer });
        expect(transfer.dropEffect).toBe('copy');
        expect(screen.getByTestId('session-context-drop-hint')).toBeTruthy();
        fireEvent.drop(screen.getByTestId('chat-input-bar'), { dataTransfer: transfer });
        expect(screen.getByTestId('attached-git-file-context-chip').textContent).toContain(skillPath);
        expect(onSend).not.toHaveBeenCalled();
        expect(setFollowUpInput).not.toHaveBeenCalled();
        expect(tracker.calls).toEqual([]);

        fireEvent.drop(screen.getByTestId('chat-input-bar'), { dataTransfer: transfer });
        expect(screen.getByTestId('follow-up-session-context-error').textContent).toContain('This file is already attached');
        expect(screen.getAllByTestId('attached-git-file-context-chip')).toHaveLength(1);
        fireEvent.click(screen.getByRole('button', { name: 'Remove context' }));
        expect(screen.queryByTestId('attached-git-file-context-chip')).toBeNull();
    });

    it('keeps same-path tabs from two group members as separate chips', () => {
        mockSessionContextAttachmentsEnabled.value = true;
        render(<FileComposer workspaceId="group-team" />);
        for (const ownerWorkspaceId of ['member-a', 'member-b']) {
            fireEvent.drop(screen.getByTestId('chat-input-bar'), { dataTransfer: tabTransfer({ ownerWorkspaceId, resourceId: 'README.md' }) });
        }
        expect(screen.getAllByTestId('attached-git-file-context-chip')).toHaveLength(2);
        expect(screen.queryByTestId('follow-up-session-context-error')).toBeNull();
    });

    it('rejects a tab from another server with the shared drop error', () => {
        mockSessionContextAttachmentsEnabled.value = true;
        registerCloneBaseUrls([{ workspaceId: 'ws-1', serverId: 'server-b', baseUrl: 'https://b.example' }]);
        const onAttachSessionContext = vi.fn();
        render(<FollowUpInputArea {...makeProps({ onAttachSessionContext, attachmentDestinationId: 'ws-1' })} />);
        fireEvent.drop(screen.getByTestId('chat-input-bar'), {
            dataTransfer: tabTransfer({ ownerWorkspaceId: 'ws-1', ownerRoutingRef: 'remote:server-b:ws-1', resourceId: skillPath }),
        });
        expect(onAttachSessionContext).not.toHaveBeenCalled();
        expect(screen.getByTestId('follow-up-session-context-error').textContent).toContain('only to a chat on its owning server');
    });

    it('leaves a file tab drop alone while session-context attachments are off', () => {
        mockSessionContextAttachmentsEnabled.value = false;
        const onAttachSessionContext = vi.fn();
        render(<FollowUpInputArea {...makeProps({ onAttachSessionContext })} />);
        fireEvent.drop(screen.getByTestId('chat-input-bar'), { dataTransfer: tabTransfer({ ownerWorkspaceId: 'ws-1', resourceId: skillPath }) });
        expect(onAttachSessionContext).not.toHaveBeenCalled();
        expect(screen.queryByTestId('follow-up-session-context-error')).toBeNull();
    });
});

describe('FollowUpInputArea paste panel snapshots', () => {
    const fullContent = '# Pasted heading\n' + 'Full raw content with trailing spaces  \n'.repeat(600);
    const preview = (content = fullContent) => ({
        pastedContent: content,
        charCount: content.length,
        previewLines: ['# Pasted heading', 'truncated preview…'],
        onTextPaste: vi.fn(),
        clearPaste: vi.fn(),
    });

    beforeEach(() => {
        clearUnifiedPanelState();
        localStorage.clear();
    });
    afterEach(() => {
        clearUnifiedPanelState();
        localStorage.clear();
    });

    it.each([
        ['ws-1', 'ws-1', 'ws-1'],
        ['ws-2', 'ws-2', 'ws-2'],
        ['group-scope', 'remote-workspace', 'clone:remote:remote-workspace'],
    ])('opens full content in %s with owner %s', (scope, owner, route) => {
        const open = vi.spyOn(panelOpen, 'openUnifiedPasteTab');
        render(<UnifiedPanelHostProvider host={{ workspaceId: scope, chatId: 'current-process' }}>
            <FollowUpInputArea {...makeProps({ workspaceId: owner, attachmentDestinationId: route, pastePreview: preview() })} />
        </UnifiedPanelHostProvider>);
        fireEvent.click(screen.getByTestId('paste-preview-open'));
        expect(open).toHaveBeenCalledWith(scope, fullContent, {
            ownerWorkspaceId: owner, ownerRoutingRef: route, chatId: 'current-process',
        });
        const tab = readUnifiedPanelState(scope).chatTabs['current-process'][0];
        expect(tab.ownerWorkspaceId).toBe(owner);
        expect(tab.ownerRoutingRef).toBe(route);
        expect(readPasteSnapshot(scope, tab.resourceId)).toBe(fullContent);
    });

    it('preserves opened snapshots through paste replacement and dismissal, and refocuses the same content', () => {
        const open = vi.spyOn(panelOpen, 'openUnifiedPasteTab');
        const props = makeProps({ pastePreview: preview() });
        const view = (pastePreview: FollowUpInputAreaProps['pastePreview']) => (
            <UnifiedPanelHostProvider host={{ workspaceId: 'ws-1', chatId: 'current-process' }}>
                <FollowUpInputArea {...props} pastePreview={pastePreview} />
            </UnifiedPanelHostProvider>
        );
        const { rerender } = render(view(props.pastePreview));
        fireEvent.click(screen.getByTestId('paste-preview-open'));
        const originalTab = readUnifiedPanelState('ws-1').chatTabs['current-process'][0];
        const editedContent = fullContent + 'later edit';
        rerender(view(preview(editedContent)));
        expect(readPasteSnapshot('ws-1', originalTab.resourceId)).toBe(fullContent);
        fireEvent.click(screen.getByTestId('paste-preview-open'));
        expect(open).toHaveBeenLastCalledWith('ws-1', editedContent, expect.any(Object));
        const editedTab = readUnifiedPanelState('ws-1').chatTabs['current-process'][1];
        const clearPaste = vi.fn();
        rerender(view({ ...preview(editedContent), clearPaste }));
        fireEvent.click(screen.getByTestId('paste-preview-dismiss'));
        expect(clearPaste).toHaveBeenCalledOnce();
        rerender(view(null));
        expect(screen.queryByTestId('paste-preview')).toBeNull();
        expect(readPasteSnapshot('ws-1', originalTab.resourceId)).toBe(fullContent);
        expect(readPasteSnapshot('ws-1', editedTab.resourceId)).toBe(editedContent);
        // The sent card uses the same owner/content seam after send.
        act(() => { panelOpen.openUnifiedPasteTab('ws-1', fullContent, {
            ownerWorkspaceId: 'ws-1', ownerRoutingRef: 'ws-1', chatId: 'current-process',
        }); });
        const state = readUnifiedPanelState('ws-1');
        expect(state.chatTabs['current-process']).toHaveLength(2);
        expect(state.activeByScope['current-process']).toBe(originalTab.id);
    });

    it.each([
        [null, 'ws-1', 'current-process', fullContent],
        [{ workspaceId: 'ws-1', chatId: 'other-chat' }, 'ws-1', 'current-process', fullContent],
        [{ workspaceId: 'ws-1', chatId: null }, 'ws-1', null, fullContent],
        [{ workspaceId: 'ws-1', chatId: 'current-process' }, undefined, 'current-process', fullContent],
        [{ workspaceId: 'ws-1', chatId: 'current-process' }, 'ws-1', 'current-process', undefined],
    ])('keeps inline preview when a matching panel or full payload is unavailable (%j)', (host, owner, chat, content) => {
        render(<UnifiedPanelHostProvider host={host}>
            <FollowUpInputArea {...makeProps({ workspaceId: owner, currentProcessId: chat,
                pastePreview: { ...preview(), pastedContent: content } })} />
        </UnifiedPanelHostProvider>);
        expect(screen.queryByTestId('paste-preview-open')).toBeNull();
        fireEvent.click(screen.getByTestId('paste-preview-toggle'));
        expect(screen.getByTestId('paste-preview-content').textContent).toContain('truncated preview');
    });
});


describe('Sentinel suggestion activation', () => {
    it.each([1, 2, 3])('renders %i actions without sending on arrival', count => {
        const onSend = vi.fn().mockResolvedValue(undefined);
        render(<FollowUpInputArea {...makeProps({ selectedMode: 'sentinel', sentinelNextStepsEnabled: true, suggestions: ['Finish safeguards', 'Run checks', 'Commit changes'].slice(0, count), onSend })} />);
        expect(screen.getAllByTestId('suggestion-chip')).toHaveLength(count);
        expect(onSend).not.toHaveBeenCalled();
        expect(screen.getAllByTestId('suggestion-chip')[0].title).toBe('Finish safeguards\nClick to send');
    });

    it.each([0, 1])('sends only the named action once on activation (detail %i)', async detail => {
        let finish!: () => void;
        const onSend = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
        const setFollowUpInput = vi.fn();
        render(<FollowUpInputArea {...makeProps({ selectedMode: 'sentinel', sentinelNextStepsEnabled: true, suggestions: ['Finish safeguards'], followUpInput: 'Keep draft', onSend, setFollowUpInput })} />);
        const button = screen.getByTestId('suggestion-chip');
        // Native buttons emit a detail-0 click for Enter/Space activation.
        fireEvent.click(button, { detail });
        fireEvent.click(button, { detail });
        expect(onSend).toHaveBeenCalledExactlyOnceWith('Finish safeguards');
        expect(setFollowUpInput).not.toHaveBeenCalled();
        await act(async () => finish());
    });

    it.each(['{Enter}', ' '])('sends once on native button keyboard activation %s', async key => {
        const onSend = vi.fn().mockResolvedValue(undefined);
        const setFollowUpInput = vi.fn();
        render(<FollowUpInputArea {...makeProps({ selectedMode: 'sentinel', sentinelNextStepsEnabled: true,
            suggestions: ['Finish safeguards'], onSend, setFollowUpInput })} />);
        screen.getByTestId('suggestion-chip').focus();
        await userEvent.setup().keyboard(key);
        expect(onSend).toHaveBeenCalledExactlyOnceWith('Finish safeguards');
        expect(setFollowUpInput).not.toHaveBeenCalled();
    });

    it('activates only the owning composer when two workspaces show actions', async () => {
        const sendA = vi.fn().mockResolvedValue(undefined);
        const sendB = vi.fn().mockResolvedValue(undefined);
        render(<>
            <div data-testid="owner-a"><FollowUpInputArea {...makeProps({ workspaceId: 'ws-a', currentProcessId: 'chat-a',
                selectedMode: 'sentinel', sentinelNextStepsEnabled: true, suggestions: ['Finish safeguards'], onSend: sendA })} /></div>
            <div data-testid="owner-b"><FollowUpInputArea {...makeProps({ workspaceId: 'ws-b', currentProcessId: 'chat-b',
                selectedMode: 'sentinel', sentinelNextStepsEnabled: true, suggestions: ['Run checks'], onSend: sendB })} /></div>
        </>);
        await act(async () => { fireEvent.click(within(screen.getByTestId('owner-b')).getByTestId('suggestion-chip')); });
        expect(sendA).not.toHaveBeenCalled();
        expect(sendB).toHaveBeenCalledExactlyOnceWith('Run checks');
    });

    it('retains composer-fill behavior with the flag off', () => {
        const onSend = vi.fn();
        const setFollowUpInput = vi.fn();
        render(<FollowUpInputArea {...makeProps({ selectedMode: 'sentinel', suggestions: ['Finish safeguards'], onSend, setFollowUpInput })} />);
        fireEvent.click(screen.getByTestId('suggestion-chip'));
        expect(setFollowUpInput).toHaveBeenCalledWith('Finish safeguards');
        expect(onSend).not.toHaveBeenCalled();
    });

    it.each(['ask', 'autopilot'] as const)('retains %s composer-fill with the flag on', selectedMode => {
        const onSend = vi.fn();
        const setFollowUpInput = vi.fn();
        render(<FollowUpInputArea {...makeProps({ selectedMode, sentinelNextStepsEnabled: true, suggestions: ['Run checks'], onSend, setFollowUpInput })} />);
        fireEvent.click(screen.getByTestId('suggestion-chip'));
        expect(setFollowUpInput).toHaveBeenCalledWith('Run checks');
        expect(onSend).not.toHaveBeenCalled();
    });

    it.each([
        { inputDisabled: true }, { sending: true }, { isActiveGeneration: true },
    ])('respects submission guards %j', guards => {
        const onSend = vi.fn();
        render(<FollowUpInputArea {...makeProps({ selectedMode: 'sentinel', sentinelNextStepsEnabled: true, suggestions: ['Finish safeguards'], onSend, ...guards })} />);
        const chip = screen.queryByTestId('suggestion-chip');
        if (chip) fireEvent.click(chip);
        expect(onSend).not.toHaveBeenCalled();
    });
});


describe('follow-up Configure tiers', () => {
    it('uses the pending provider and leaves the tier and draft untouched', () => {
        const props = makeProps({
            followUpInput: 'Unsent follow-up', activeProvider: 'copilot', selectedProvider: 'codex',
            useEffortTierMode: true, selectedEffortTier: 'medium', onEffortTierChange: vi.fn(),
            effortTierMap: { medium: { model: 'm', reasoningEffort: 'high', source: 'config' } },
        });
        render(<FollowUpInputArea {...props} />);
        fireEvent.click(screen.getByTestId('effort-tier-trigger-btn'));
        fireEvent.click(screen.getByTestId('effort-tier-configure'));
        expect(window.location.hash).toBe('#admin/agents?section=effort-tiers&provider=codex');
        expect(props.onSend).not.toHaveBeenCalled();
        expect(props.setFollowUpInput).not.toHaveBeenCalled();
        expect(props.onEffortTierChange).not.toHaveBeenCalled();
        expect(screen.getByTestId('follow-up-effort-tier-selector')).toHaveAttribute('data-tier-value', 'medium');
    });
});

describe('FollowUpInputArea browser demo recording', () => {
    afterEach(async () => {
        const { resetBrowserDemosForTest } = await import('../../../../src/server/spa/client/react/shared/file-path/browser-demo');
        resetBrowserDemosForTest();
        delete (window as any).cocDesktop;
    });

    it('blocks sends while this chat records a demo and allows them once it stops', async () => {
        const listeners: Array<(state: unknown) => void> = [];
        (window as any).cocDesktop = { browser: { demo: {
            command: vi.fn().mockResolvedValue({ ok: true, drafts: [] }),
            onState: (callback: (state: unknown) => void) => { listeners.push(callback); return () => {}; },
        } } };
        const onSend = vi.fn().mockResolvedValue(undefined);
        render(<FollowUpInputArea {...makeProps({ suggestions: ['Run tests'], onSend, currentProcessId: 'queue_chat-1' })} />);
        const demo = { id: 'd', owner: { workspaceId: 'ws-1', processId: 'chat-1', routingRef: 'ws-1' }, stepCount: 0, tabCount: 1, viewIds: ['v'], incomplete: false };
        act(() => { for (const listener of listeners) listener({ ...demo, status: 'recording' }); });
        expect(screen.getByTestId('follow-up-demo-recording').textContent).toContain('Recording a browser demo for this chat');
        fireEvent.click(screen.getByTestId('suggestion-chip'), { ctrlKey: true });
        expect(onSend).not.toHaveBeenCalled();
        act(() => { for (const listener of listeners) listener({ ...demo, status: 'stopped' }); });
        expect(screen.queryByTestId('follow-up-demo-recording')).toBeNull();
        fireEvent.click(screen.getByTestId('suggestion-chip'), { ctrlKey: true });
        expect(onSend).toHaveBeenCalledWith('Run tests');
    });

    it('does not block a different chat', () => {
        const listeners: Array<(state: unknown) => void> = [];
        (window as any).cocDesktop = { browser: { demo: {
            command: vi.fn().mockResolvedValue({ ok: true, drafts: [] }),
            onState: (callback: (state: unknown) => void) => { listeners.push(callback); return () => {}; },
        } } };
        const onSend = vi.fn().mockResolvedValue(undefined);
        render(<FollowUpInputArea {...makeProps({ suggestions: ['Run tests'], onSend, currentProcessId: 'other-chat' })} />);
        act(() => { for (const listener of listeners) listener({ id: 'd', owner: { workspaceId: 'ws-1', processId: 'chat-1', routingRef: 'ws-1' },
            status: 'recording', stepCount: 0, tabCount: 1, viewIds: ['v'], incomplete: false }); });
        expect(screen.queryByTestId('follow-up-demo-recording')).toBeNull();
        fireEvent.click(screen.getByTestId('suggestion-chip'), { ctrlKey: true });
        expect(onSend).toHaveBeenCalledWith('Run tests');
    });

    it.each([
        { workspaceId: 'ws-2', routingRef: 'ws-2' },
        { workspaceId: 'ws-1', routingRef: 'remote:server-b:ws-1' },
        { workspaceId: 'ws-2', routingRef: 'remote:server-a:ws-2' },
    ])('does not block equal chat IDs on a different concrete owner: %j', browserOwner => {
        const listeners: Array<(state: unknown) => void> = [];
        (window as { cocDesktop?: unknown }).cocDesktop = { browser: { demo: {
            command: vi.fn().mockResolvedValue({ ok: true, drafts: [] }),
            onState: (callback: (state: unknown) => void) => { listeners.push(callback); return () => {}; },
        } } };
        const onSend = vi.fn().mockResolvedValue(undefined);
        const props = makeProps({ workspaceId: 'group-g', suggestions: ['Run tests'], onSend, currentProcessId: 'queue_chat-1', browserOwner });
        const view = render(<FollowUpInputArea {...props} />);
        const recordedOwner = { workspaceId: 'ws-1', routingRef: 'remote:server-a:ws-1' };
        const demo = { id: 'd', owner: { ...recordedOwner, processId: 'chat-1' },
            status: 'paused', stepCount: 0, tabCount: 1, viewIds: ['v'], incomplete: false };
        act(() => { for (const listener of listeners) listener(demo); });
        expect(screen.queryByTestId('follow-up-demo-recording')).toBeNull();
        fireEvent.click(screen.getByTestId('suggestion-chip'), { ctrlKey: true });
        expect(onSend).toHaveBeenCalledWith('Run tests');
        onSend.mockClear();
        view.rerender(<FollowUpInputArea {...props} browserOwner={recordedOwner} />);
        expect(screen.getByTestId('follow-up-demo-recording')).toBeTruthy();
        fireEvent.click(screen.getByTestId('suggestion-chip'), { ctrlKey: true });
        expect(onSend).not.toHaveBeenCalled();
    });
});
