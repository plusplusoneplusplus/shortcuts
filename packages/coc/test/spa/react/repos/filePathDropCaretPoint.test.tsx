/**
 * Drop-point caret resolution, exercised through a real composer.
 *
 * `filePathDropCaret.test.ts` covers the helper in isolation and the round-trip
 * suite covers the tracked-offset fallback, but nothing wires the two together:
 * in jsdom neither `caretRangeFromPoint` nor `caretPositionFromPoint` exists, so
 * every other composer test silently takes the fallback branch and the code a
 * real browser actually runs is never reached. These tests stub the caret API
 * and give the composer a faithful contentEditable double, so the "the path
 * lands where you pointed" half of the demo script is checked deterministically.
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

/**
 * Unlike the other composer doubles this one renders the `data-rich-input`
 * contentEditable node RichTextInput really renders, holding the current text —
 * `findComposerEditable` looks that attribute up and `textOffsetFromPoint`
 * needs real text nodes to measure against.
 */
vi.mock('../../../../src/server/spa/client/react/shared/RichTextInput', async () => {
    const R = await import('react');
    return {
        RichTextInput: R.forwardRef((props: any, ref: any) => {
            const nodeRef = R.useRef<HTMLDivElement | null>(null);
            R.useImperativeHandle(ref, () => ({
                getValue: () => tracker.domValue,
                setValue: (value: string, cursorPos?: number) => {
                    tracker.calls.push([value, cursorPos]);
                    tracker.domValue = value;
                    if (nodeRef.current) nodeRef.current.textContent = value;
                },
                focus: () => {},
            }), []);
            tracker.onChange = props.onChange;
            // No React children: like the real contentEditable, the text lives in
            // the DOM and React never reconciles it.
            return R.createElement('div', {
                ref: nodeRef,
                'data-testid': props['data-testid'],
                'data-rich-input': '',
                contentEditable: true,
            });
        }),
    };
});

vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    isRalphEnabled: () => false,
    isForEachEnabled: () => false,
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

import { FollowUpInputArea } from '../../../../src/server/spa/client/react/features/chat/FollowUpInputArea';
import type { FollowUpInputAreaProps } from '../../../../src/server/spa/client/react/features/chat/FollowUpInputArea';
import type { RichTextInputHandle } from '../../../../src/server/spa/client/react/shared/RichTextInput';
import {
    FILE_PATH_DRAG_MIME,
    createFilePathDragPayload,
} from '../../../../src/server/spa/client/react/features/chat/sessionContextDrag';

const WS = 'ws-1';
const PATH = 'packages/coc/docs/ralph.md';

function makeDataTransfer(paths: string[] = [PATH]) {
    const store = new Map<string, string>([
        [FILE_PATH_DRAG_MIME, JSON.stringify(createFilePathDragPayload(WS, paths))],
        ['text/plain', paths.join('\n')],
    ]);
    return {
        effectAllowed: 'copy' as string,
        dropEffect: 'none' as string,
        setData(format: string, data: string) { store.set(format, data); },
        getData(format: string) { return store.get(format) ?? ''; },
        get types() { return Array.from(store.keys()); },
    };
}

function makeProps(): FollowUpInputAreaProps {
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
    };
}

async function renderComposer() {
    render(<FollowUpInputArea {...makeProps()} />);
    await act(async () => { await Promise.resolve(); });
}

/** The contentEditable the composer rendered, as the browser would see it. */
function editable(): HTMLElement {
    const el = screen.getByTestId('chat-input-bar').querySelector<HTMLElement>('[data-rich-input]');
    if (!el) throw new Error('composer rendered no [data-rich-input] node');
    return el;
}

/** Make the browser report a caret at `offset` inside the composer's text. */
function caretPointsAt(offset: number) {
    (document as any).caretRangeFromPoint = () => {
        const range = document.createRange();
        range.setStart(editable().firstChild!, offset);
        return range;
    };
}

/** Type `text` and leave the tracked caret at `cursorPos`. */
async function typeInto(text: string, cursorPos: number) {
    tracker.domValue = text;
    editable().textContent = text;
    await act(async () => { tracker.onChange?.(text, cursorPos); });
    tracker.calls = [];
}

beforeEach(() => {
    tracker.calls = [];
    tracker.domValue = '';
    tracker.onChange = undefined;
    Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
    cleanup();
    delete (document as any).caretRangeFromPoint;
    delete (document as any).caretPositionFromPoint;
    vi.restoreAllMocks();
});

describe('file-path drop caret resolved from the pointer', () => {
    it('inserts where the pointer is, not at the tracked offset', async () => {
        await renderComposer();
        // Tracked caret is at the end; the pointer is over character 8.
        await typeInto('look at and explain', 19);
        caretPointsAt(8);

        fireEvent.drop(screen.getByTestId('chat-input-bar'), {
            dataTransfer: makeDataTransfer(),
            clientX: 40,
            clientY: 12,
        });

        expect(tracker.calls).toEqual([[`look at \`${PATH}\` and explain`, 8 + PATH.length + 3]]);
    });

    it('honours caretPositionFromPoint when caretRangeFromPoint is absent', async () => {
        await renderComposer();
        await typeInto('look at and explain', 19);
        (document as any).caretPositionFromPoint = () => ({ offsetNode: editable().firstChild, offset: 8 });

        fireEvent.drop(screen.getByTestId('chat-input-bar'), {
            dataTransfer: makeDataTransfer(),
            clientX: 40,
            clientY: 12,
        });

        expect(tracker.calls).toEqual([[`look at \`${PATH}\` and explain`, 8 + PATH.length + 3]]);
    });

    it('uses the pointer even when the composer was never focused', async () => {
        await renderComposer();
        // No onChange ever fired, so the tracked offset would append at the end.
        tracker.domValue = 'look at and explain';
        editable().textContent = 'look at and explain';
        caretPointsAt(8);

        fireEvent.drop(screen.getByTestId('chat-input-bar'), {
            dataTransfer: makeDataTransfer(),
            clientX: 40,
            clientY: 12,
        });

        expect(tracker.calls).toEqual([[`look at \`${PATH}\` and explain`, 8 + PATH.length + 3]]);
    });

    it('falls back to the tracked offset when the point lands outside the editor', async () => {
        await renderComposer();
        await typeInto('look at and explain', 8);
        const stray = document.createElement('div');
        stray.textContent = 'toolbar';
        document.body.appendChild(stray);
        (document as any).caretRangeFromPoint = () => {
            const range = document.createRange();
            range.setStart(stray.firstChild!, 3);
            return range;
        };

        fireEvent.drop(screen.getByTestId('chat-input-bar'), {
            dataTransfer: makeDataTransfer(),
            clientX: 40,
            clientY: 12,
        });

        expect(tracker.calls).toEqual([[`look at \`${PATH}\` and explain`, 8 + PATH.length + 3]]);
    });

    it('joins several dragged paths at the pointer position', async () => {
        await renderComposer();
        await typeInto('look at and explain', 19);
        caretPointsAt(8);

        fireEvent.drop(screen.getByTestId('chat-input-bar'), {
            dataTransfer: makeDataTransfer(['a/one.ts', 'b/two.ts']),
            clientX: 40,
            clientY: 12,
        });

        expect(tracker.calls).toEqual([['look at `a/one.ts` `b/two.ts` and explain', 8 + '`a/one.ts` `b/two.ts` '.length]]);
    });
});
