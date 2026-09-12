import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { editor as monacoEditor } from 'monaco-editor';
import {
    DEFINITION_LINK_CUE_DELAY_MS,
    installDefinitionLinkCue,
    type DefinitionLinkCueEditor,
} from '../../../../src/server/spa/client/react/features/language-servers/definitionLinkCue';

type ListenerName = 'change' | 'keyDown' | 'keyUp' | 'mouseLeave' | 'mouseMove' | 'scroll';

class FakeEditor {
    readonly collection = {
        clear: vi.fn(),
        set: vi.fn(),
    };
    private readonly listeners = new Map<ListenerName, Array<(event: unknown) => void>>();

    readonly createDecorationsCollection = vi.fn(() => this.collection);
    readonly onDidChangeModelContent = this.event<unknown>('change');
    readonly onDidScrollChange = this.event<unknown>('scroll');
    readonly onKeyDown = this.event<{ ctrlKey: boolean; metaKey: boolean }>('keyDown');
    readonly onKeyUp = this.event<{ ctrlKey: boolean; metaKey: boolean }>('keyUp');
    readonly onMouseLeave = this.event<unknown>('mouseLeave');
    readonly onMouseMove = this.event<monacoEditor.IEditorMouseEvent>('mouseMove');

    asEditor(): DefinitionLinkCueEditor {
        return this as unknown as DefinitionLinkCueEditor;
    }

    emitKeyDown(ctrlKey: boolean, metaKey = false): void {
        this.emit('keyDown', { ctrlKey, metaKey });
    }

    emitKeyUp(ctrlKey: boolean, metaKey = false): void {
        this.emit('keyUp', { ctrlKey, metaKey });
    }

    emitMouse(column: number | null, ctrlKey = true, metaKey = false): void {
        this.emit('mouseMove', {
            event: { ctrlKey, metaKey },
            target: {
                type: column === null ? 7 : 6,
                position: column === null ? null : { lineNumber: 2, column },
            },
        } as monacoEditor.IEditorMouseEvent);
    }

    emitMouseLeave(): void {
        this.emit('mouseLeave', undefined);
    }

    emitScroll(): void {
        this.emit('scroll', undefined);
    }

    emitContentChange(): void {
        this.emit('change', undefined);
    }

    private event<T>(name: ListenerName) {
        return (listener: (event: T) => void) => {
            const listeners = this.listeners.get(name) ?? [];
            const wrapped = (event: unknown) => listener(event as T);
            listeners.push(wrapped);
            this.listeners.set(name, listeners);
            return {
                dispose: () => {
                    this.listeners.set(name, (this.listeners.get(name) ?? []).filter(item => item !== wrapped));
                },
            };
        };
    }

    private emit(name: ListenerName, event: unknown): void {
        for (const listener of this.listeners.get(name) ?? []) {
            listener(event);
        }
    }
}

const definition = [{
    uri: 'coc-file://ws-1/src/b.ts',
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
}];

/**
 * A window stand-in that records its listeners, so a test can fire a key
 * release the editor never saw and still assert the removal on dispose.
 */
class FakeWindow {
    private readonly listeners = new Map<string, Set<(event: unknown) => void>>();

    readonly addEventListener = (type: string, listener: (event: never) => void): void => {
        const set = this.listeners.get(type) ?? new Set();
        set.add(listener as (event: unknown) => void);
        this.listeners.set(type, set);
    };

    readonly removeEventListener = (type: string, listener: (event: never) => void): void => {
        this.listeners.get(type)?.delete(listener as (event: unknown) => void);
    };

    count(type: string): number {
        return this.listeners.get(type)?.size ?? 0;
    }

    emit(type: string, event: unknown = {}): void {
        for (const listener of [...(this.listeners.get(type) ?? [])]) {
            listener(event);
        }
    }
}

function setup(sendRequest = vi.fn().mockResolvedValue(definition), platform = 'Linux') {
    const editor = new FakeEditor();
    const globalEvents = new FakeWindow();
    const model = {
        getWordAtPosition: ({ column }: { column: number }) => (
            column < 3
                ? { word: 'a', startColumn: 1, endColumn: 2 }
                : { word: 'beta', startColumn: 3, endColumn: 7 }
        ),
    };
    const view = {
        documentParams: (params: Record<string, unknown> = {}) => ({
            ...params,
            textDocument: { uri: 'coc-file://ws-1/src/a.ts' },
        }),
        sendRequest,
    };
    const cue = installDefinitionLinkCue({
        editor: editor.asEditor(),
        model: model as never,
        view: view as never,
        isEnabled: () => true,
        platform,
        globalEvents: globalEvents as never,
    });
    return { cue, editor, globalEvents, sendRequest };
}

async function finishDebounce(): Promise<void> {
    await vi.advanceTimersByTimeAsync(DEFINITION_LINK_CUE_DELAY_MS);
}

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('installDefinitionLinkCue', () => {
    it('decorates a word with Monaco’s definition-link class when a definition exists', async () => {
        const { editor, sendRequest } = setup();

        editor.emitMouse(4);
        await finishDebounce();

        expect(sendRequest).toHaveBeenCalledWith(
            'textDocument/definition',
            {
                textDocument: { uri: 'coc-file://ws-1/src/a.ts' },
                position: { line: 1, character: 3 },
            },
            { signal: expect.any(AbortSignal) },
        );
        expect(editor.collection.set).toHaveBeenCalledWith([{
            range: { startLineNumber: 2, startColumn: 3, endLineNumber: 2, endColumn: 7 },
            options: { inlineClassName: 'goto-definition-link' },
        }]);
    });

    it.each([
        ['an empty definition answer', vi.fn().mockResolvedValue([])],
        ['a failed definition request', vi.fn().mockRejectedValue(new Error('offline'))],
    ])('adds nothing for %s', async (_label, sendRequest) => {
        const { editor } = setup(sendRequest);

        editor.emitMouse(1);
        await finishDebounce();

        expect(editor.collection.set).not.toHaveBeenCalled();
    });

    it.each([
        ['modifier release', ({ editor }: ReturnType<typeof setup>) => editor.emitKeyUp(false)],
        [
            'a modifier release the unfocused editor never sees',
            ({ globalEvents }: ReturnType<typeof setup>) => globalEvents.emit('keyup', {
                ctrlKey: false,
                metaKey: false,
            }),
        ],
        ['the window losing focus', ({ globalEvents }: ReturnType<typeof setup>) => globalEvents.emit('blur')],
        ['moving off the word', ({ editor }: ReturnType<typeof setup>) => editor.emitMouse(null)],
        ['mouse leave', ({ editor }: ReturnType<typeof setup>) => editor.emitMouseLeave()],
        ['scroll', ({ editor }: ReturnType<typeof setup>) => editor.emitScroll()],
        ['content change', ({ editor }: ReturnType<typeof setup>) => editor.emitContentChange()],
        ['disposal', ({ cue }: ReturnType<typeof setup>) => cue.dispose()],
    ])('clears the decoration on %s', async (_label, clearCue) => {
        const context = setup();
        context.editor.emitMouse(1);
        await finishDebounce();
        const clearsBefore = context.editor.collection.clear.mock.calls.length;

        clearCue(context);

        expect(context.editor.collection.clear.mock.calls.length).toBeGreaterThan(clearsBefore);
    });

    it('issues one request while the pointer moves within the same word', async () => {
        const { editor, sendRequest } = setup();

        editor.emitMouse(3);
        editor.emitMouse(4);
        editor.emitMouse(5);
        await finishDebounce();

        expect(sendRequest).toHaveBeenCalledTimes(1);
    });

    it('aborts a request superseded by a different word', async () => {
        const sendRequest = vi.fn().mockImplementation(() => new Promise(() => {}));
        const { cue, editor } = setup(sendRequest);
        editor.emitMouse(1);
        await finishDebounce();
        const signal = sendRequest.mock.calls[0][2].signal as AbortSignal;

        editor.emitMouse(4);

        expect(signal.aborted).toBe(true);
        cue.dispose();
    });

    it('keeps the cue while a window key release leaves the modifier down', async () => {
        const { editor, globalEvents } = setup();
        editor.emitMouse(1);
        await finishDebounce();
        const clearsBefore = editor.collection.clear.mock.calls.length;

        globalEvents.emit('keyup', { ctrlKey: true, metaKey: false });

        expect(editor.collection.clear.mock.calls.length).toBe(clearsBefore);
    });

    it('stops listening on the window once disposed', () => {
        const { cue, globalEvents } = setup();
        expect(globalEvents.count('keyup')).toBe(1);
        expect(globalEvents.count('blur')).toBe(1);

        cue.dispose();

        expect(globalEvents.count('keyup')).toBe(0);
        expect(globalEvents.count('blur')).toBe(0);
    });

    it('uses Cmd rather than Ctrl on macOS', async () => {
        const { editor, sendRequest } = setup(undefined, 'MacIntel');

        editor.emitMouse(1, true, false);
        await finishDebounce();
        expect(sendRequest).not.toHaveBeenCalled();

        editor.emitMouse(1, false, true);
        await finishDebounce();
        expect(sendRequest).toHaveBeenCalledTimes(1);
    });
});
