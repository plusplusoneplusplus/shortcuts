/**
 * End-to-end round trip for the Explorer -> composer file-path drag.
 *
 * The producer suite (repos/explorer/TreeNode.drag.test.tsx) and the consumer
 * suites (FollowUpInputArea / NewChatArea) each build their own DataTransfer
 * stand-in, so on their own they cannot catch a mismatch between what TreeNode
 * writes and what the composer sniffs for. These tests drag a real TreeNode row
 * and drop *that same DataTransfer* on a real composer, which is the closest
 * deterministic analogue of the manual demo script.
 */
/* @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent, cleanup } from '@testing-library/react';
import React, { createRef } from 'react';

const { tracker } = vi.hoisted(() => ({
    tracker: {
        calls: [] as Array<[string, number?]>,
        domValue: '',
        onChange: undefined as undefined | ((val: string, cursorPos: number) => void),
    },
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
            tracker.onChange = props.onChange;
            return R.createElement('div', { 'data-testid': props['data-testid'] });
        }),
    };
});

vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    isRalphEnabled: () => false,
    isForEachEnabled: () => false,
    // Deliberately off: a file-path drop is a plain text edit and must not
    // depend on the session-context attachment flag.
    isSessionContextAttachmentsEnabled: () => false,
    getPrewarmDebounceMs: () => 500,
    getWarmClientTtlMs: () => 300000,
}));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        preferences: {
            getLlmToolsConfig: vi.fn().mockResolvedValue({
                tools: [],
                disabledLlmTools: [],
                conversationRetrievalAvailable: true,
            }),
        },
    }),
}));

vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi', () => ({
    explorerApi: { tree: vi.fn(), searchFiles: vi.fn(), reveal: vi.fn() },
}));

import { FollowUpInputArea } from '../../../../src/server/spa/client/react/features/chat/FollowUpInputArea';
import type { FollowUpInputAreaProps } from '../../../../src/server/spa/client/react/features/chat/FollowUpInputArea';
import type { RichTextInputHandle } from '../../../../src/server/spa/client/react/shared/RichTextInput';
import { TreeNode } from '../../../../src/server/spa/client/react/features/repo-detail/explorer/TreeNode';
import type { TreeEntry } from '../../../../src/server/spa/client/react/features/repo-detail/explorer/types';

const WS = 'ws-1';
const FILE: TreeEntry = {
    name: 'RichTextInput.tsx',
    type: 'file',
    path: 'packages/coc/src/server/spa/client/react/shared/RichTextInput.tsx',
};
const DIR: TreeEntry = { name: 'docs', type: 'dir', path: 'packages/coc/docs' };

/**
 * DataTransfer stand-in faithful on the one point that matters here: `types`
 * reflects what setData actually wrote, the way a browser's does. The composer
 * sniffs `types`, so a stand-in with a hardcoded list would hide a real bug.
 */
function makeDataTransfer() {
    const store = new Map<string, string>();
    return {
        effectAllowed: 'uninitialized' as string,
        dropEffect: 'none' as string,
        setData(format: string, data: string) { store.set(format, data); },
        getData(format: string) { return store.get(format) ?? ''; },
        get types() { return Array.from(store.keys()); },
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
        skills: [],
        attachments: [],
        onAttachmentPaste: vi.fn(),
        onAttachmentRemove: vi.fn(),
        onAttachmentFiles: vi.fn(),
        attachmentError: null,
        attachedContext: [],
        onRemoveAttachedContext: vi.fn(),
        onAttachSessionContext: vi.fn(),
        workspaceId: WS,
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

/** Render an Explorer row and a follow-up composer side by side. */
async function renderBoth(entry: TreeEntry, onAttachSessionContext = vi.fn()) {
    const view = render(
        <>
            <TreeNode
                entry={entry}
                depth={0}
                workspaceId={WS}
                selectedPath={null}
                expandedPaths={new Set()}
                childrenMap={new Map()}
                onToggle={vi.fn()}
                onSelect={vi.fn()}
                onChildrenLoaded={vi.fn()}
            />
            <FollowUpInputArea {...makeProps({ onAttachSessionContext })} />
        </>,
    );
    await act(async () => { await Promise.resolve(); });
    return view;
}

/** Drag `entry`'s row out and return the DataTransfer the browser would carry. */
function dragRowOut(entry: TreeEntry) {
    const dataTransfer = makeDataTransfer();
    fireEvent.dragStart(screen.getByTestId(`tree-node-${entry.path}`), { dataTransfer });
    return dataTransfer;
}

beforeEach(() => {
    tracker.calls = [];
    tracker.domValue = '';
    tracker.onChange = undefined;
    Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('Explorer -> composer file-path drag round trip', () => {
    it('inserts the dragged file path at the caret, backticked, with one trailing space', async () => {
        await renderBoth(FILE);

        // Demo script step 2: type "explain " and leave the caret at the end.
        tracker.domValue = 'explain ';
        await act(async () => { tracker.onChange?.('explain ', 8); });
        tracker.calls = [];

        const dataTransfer = dragRowOut(FILE);
        const bar = screen.getByTestId('chat-input-bar');

        // Step 3: the drop affordance appears for the payload TreeNode wrote.
        fireEvent.dragOver(bar, { dataTransfer });
        expect(dataTransfer.dropEffect).toBe('copy');
        expect(screen.getByTestId('session-context-drop-hint')).toBeTruthy();

        // Step 4: the drop is a pure text edit, with no error chip.
        fireEvent.drop(bar, { dataTransfer });
        expect(tracker.calls).toEqual([[`explain \`${FILE.path}\` `, 8 + FILE.path.length + 3]]);
        expect(screen.queryByTestId('follow-up-session-context-error')).toBeNull();
        expect(screen.queryByTestId('session-context-drop-hint')).toBeNull();
    });

    it('splices a dragged directory path in mid-text rather than appending', async () => {
        await renderBoth(DIR);

        tracker.domValue = 'look at and explain';
        await act(async () => { tracker.onChange?.('look at and explain', 8); });
        tracker.calls = [];

        fireEvent.drop(screen.getByTestId('chat-input-bar'), { dataTransfer: dragRowOut(DIR) });

        expect(tracker.calls).toEqual([[`look at \`${DIR.path}\` and explain`, 8 + DIR.path.length + 3]]);
    });

    it('never routes the dragged path into the session-context attachment path', async () => {
        const onAttachSessionContext = vi.fn();
        await renderBoth(FILE, onAttachSessionContext);

        fireEvent.drop(screen.getByTestId('chat-input-bar'), { dataTransfer: dragRowOut(FILE) });

        expect(onAttachSessionContext).not.toHaveBeenCalled();
        expect(screen.queryByTestId('follow-up-session-context-error')).toBeNull();
    });

    it('carries a bare text/plain path so non-CoC drop targets still get something sane', async () => {
        await renderBoth(FILE);
        expect(dragRowOut(FILE).getData('text/plain')).toBe(FILE.path);
    });
});
