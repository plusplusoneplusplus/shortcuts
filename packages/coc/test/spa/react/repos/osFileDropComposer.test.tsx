/**
 * OS file drop -> composer round trip (AC-02 / AC-03).
 *
 * The helper suite (test/spa/react/osFileDrop.test.ts) covers path resolution
 * in isolation; this one drops a real DataTransfer carrying `files` onto a real
 * composer, so it catches a wiring mistake between the two — the closest
 * deterministic analogue of dragging a file out of Finder/Explorer.
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
    // Deliberately off: an OS file drop is a plain text edit and must not
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

import { FollowUpInputArea } from '../../../../src/server/spa/client/react/features/chat/FollowUpInputArea';
import type { FollowUpInputAreaProps } from '../../../../src/server/spa/client/react/features/chat/FollowUpInputArea';
import type { RichTextInputHandle } from '../../../../src/server/spa/client/react/shared/RichTextInput';

const WS = 'ws-1';
const ROOT = '/home/dev/repo';

/**
 * DataTransfer stand-in for an OS drag: `types` reports "Files" (as a browser
 * does) and `files` holds the dropped File stand-ins.
 */
function makeOsFileDataTransfer(files: object[]) {
    return {
        effectAllowed: 'uninitialized' as string,
        dropEffect: 'none' as string,
        setData() {},
        getData() { return ''; },
        types: ['Files'],
        files: files as unknown as FileList,
    };
}

/** Install the desktop preload bridge for the given File -> absolute path map. */
function installDesktopBridge(paths: Map<object, string>) {
    (window as any).cocDesktop = {
        isDesktop: true,
        getPathForFile: (file: object) => paths.get(file) ?? null,
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
        workspaceRoot: ROOT,
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

/** Render the composer with "explain " already typed and the caret at the end. */
async function renderComposerWithText(overrides: Partial<FollowUpInputAreaProps> = {}) {
    render(<FollowUpInputArea {...makeProps(overrides)} />);
    await act(async () => { await Promise.resolve(); });
    tracker.domValue = 'explain ';
    await act(async () => { tracker.onChange?.('explain ', 8); });
    tracker.calls = [];
    return screen.getByTestId('chat-input-bar');
}

beforeEach(() => {
    tracker.calls = [];
    tracker.domValue = '';
    tracker.onChange = undefined;
    Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
    cleanup();
    delete (window as any).cocDesktop;
    vi.restoreAllMocks();
});

describe('OS file drop -> composer round trip', () => {
    it('inserts a file from inside the workspace as a backticked relative path', async () => {
        const file = {};
        installDesktopBridge(new Map([[file, `${ROOT}/src/index.ts`]]));
        const bar = await renderComposerWithText();
        const dataTransfer = makeOsFileDataTransfer([file]);

        fireEvent.dragOver(bar, { dataTransfer });
        expect(dataTransfer.dropEffect).toBe('copy');
        expect(screen.getByTestId('session-context-drop-hint')).toBeTruthy();

        fireEvent.drop(bar, { dataTransfer });
        expect(tracker.calls).toEqual([['explain `src/index.ts` ', 23]]);
        expect(screen.queryByTestId('session-context-drop-error')).toBeNull();
    });

    it('inserts a file from outside the workspace as its absolute path', async () => {
        const file = {};
        installDesktopBridge(new Map([[file, '/home/dev/Downloads/x.pdf']]));
        const bar = await renderComposerWithText();

        fireEvent.drop(bar, { dataTransfer: makeOsFileDataTransfer([file]) });
        expect(tracker.calls).toEqual([['explain `/home/dev/Downloads/x.pdf` ', 36]]);
    });

    it('inserts every file of a multi-file drop, space separated, in drop order', async () => {
        const a = {}, b = {};
        installDesktopBridge(new Map<object, string>([
            [a, `${ROOT}/a.ts`],
            [b, '/tmp/b.txt'],
        ]));
        const bar = await renderComposerWithText();

        fireEvent.drop(bar, { dataTransfer: makeOsFileDataTransfer([a, b]) });
        expect(tracker.calls[0]?.[0]).toBe('explain `a.ts` `/tmp/b.txt` ');
    });

    it('falls back to the working directory when no workspace root is passed', async () => {
        const file = {};
        installDesktopBridge(new Map([[file, `${ROOT}/src/index.ts`]]));
        const bar = await renderComposerWithText({ workspaceRoot: undefined, workingDirectory: ROOT });

        fireEvent.drop(bar, { dataTransfer: makeOsFileDataTransfer([file]) });
        expect(tracker.calls[0]?.[0]).toBe('explain `src/index.ts` ');
    });

    it('does nothing in the browser SPA, where there is no path bridge', async () => {
        const bar = await renderComposerWithText();

        const dataTransfer = makeOsFileDataTransfer([{}]);
        fireEvent.dragOver(bar, { dataTransfer });
        expect(dataTransfer.dropEffect).toBe('none');
        expect(screen.queryByTestId('session-context-drop-hint')).toBeNull();

        fireEvent.drop(bar, { dataTransfer });
        expect(tracker.calls).toEqual([]);
    });
});
