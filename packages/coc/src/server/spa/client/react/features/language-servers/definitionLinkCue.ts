/**
 * Ctrl/Cmd-hover definition cue for Explorer-backed Monaco models.
 *
 * Standalone Monaco cannot decorate cross-file definitions until their target
 * model exists. This cue asks the live language document directly and applies
 * Monaco's built-in link class without changing global model resolution.
 */
import type { editor as monacoEditor } from 'monaco-editor';
import { isMacPlatform } from '../../utils/composerKeyboardShortcuts';
import type { LanguageDocumentView } from './documentStore';
import { toLocationLinks } from './languageFeatures';
import { toLspPosition } from './monacoBridge';

const CONTENT_TEXT_MOUSE_TARGET = 6;
export const DEFINITION_LINK_CUE_DELAY_MS = 100;

export type DefinitionLinkCueEditor = Pick<
    monacoEditor.IStandaloneCodeEditor,
    | 'createDecorationsCollection'
    | 'onDidChangeModelContent'
    | 'onDidScrollChange'
    | 'onKeyDown'
    | 'onKeyUp'
    | 'onMouseLeave'
    | 'onMouseMove'
>;

/** The slice of `window` the cue watches the modifier on. */
export type DefinitionLinkCueGlobalEvents = Pick<Window, 'addEventListener' | 'removeEventListener'>;

export interface InstallDefinitionLinkCueOptions {
    editor: DefinitionLinkCueEditor;
    model: Pick<monacoEditor.ITextModel, 'getWordAtPosition'>;
    view: Pick<LanguageDocumentView, 'documentParams' | 'sendRequest'>;
    isEnabled: () => boolean;
    /** Overridable for tests; defaults to the browser platform. */
    platform?: string;
    /** Overridable for tests; defaults to the page's window, `null` off-browser. */
    globalEvents?: DefinitionLinkCueGlobalEvents | null;
}

export function installDefinitionLinkCue({
    editor,
    model,
    view,
    isEnabled,
    platform,
    globalEvents = typeof window === 'undefined' ? null : window,
}: InstallDefinitionLinkCueOptions): { dispose(): void } {
    const useMetaKey = isMacPlatform(platform);
    const decorations = editor.createDecorationsCollection();
    const disposables: { dispose(): void }[] = [];
    let pendingTimer: ReturnType<typeof setTimeout> | null = null;
    let requestController: AbortController | null = null;
    let currentWordKey: string | null = null;
    let lastMouseEvent: monacoEditor.IEditorMouseEvent | null = null;
    let modifierHeld = false;
    let disposed = false;

    const cancelLookup = (): void => {
        if (pendingTimer !== null) {
            clearTimeout(pendingTimer);
            pendingTimer = null;
        }
        requestController?.abort();
        requestController = null;
    };

    const clear = (): void => {
        cancelLookup();
        currentWordKey = null;
        decorations.clear();
    };

    const modifierFrom = (event: { ctrlKey: boolean; metaKey: boolean }): boolean =>
        useMetaKey ? event.metaKey : event.ctrlKey;

    const inspectMouseTarget = (
        event: monacoEditor.IEditorMouseEvent,
        hasModifier = modifierFrom(event.event),
    ): void => {
        modifierHeld = hasModifier;
        if (!hasModifier || !isEnabled()) {
            clear();
            return;
        }

        const position = event.target.position;
        if (event.target.type !== CONTENT_TEXT_MOUSE_TARGET || !position) {
            clear();
            return;
        }

        const word = model.getWordAtPosition(position);
        if (!word) {
            clear();
            return;
        }

        const wordKey = `${position.lineNumber}:${word.startColumn}:${word.endColumn}:${word.word}`;
        if (wordKey === currentWordKey) {
            return;
        }

        cancelLookup();
        decorations.clear();
        currentWordKey = wordKey;
        pendingTimer = setTimeout(async () => {
            pendingTimer = null;
            const controller = new AbortController();
            requestController = controller;
            try {
                const result = await view.sendRequest(
                    'textDocument/definition',
                    view.documentParams({ position: toLspPosition(position) }),
                    { signal: controller.signal },
                );
                if (
                    disposed
                    || controller.signal.aborted
                    || requestController !== controller
                    || currentWordKey !== wordKey
                    || !modifierHeld
                    || !isEnabled()
                    || toLocationLinks(result).length === 0
                ) {
                    return;
                }
                decorations.set([{
                    range: {
                        startLineNumber: position.lineNumber,
                        startColumn: word.startColumn,
                        endLineNumber: position.lineNumber,
                        endColumn: word.endColumn,
                    },
                    options: { inlineClassName: 'goto-definition-link' },
                }]);
            } catch {
                // A failed language request means this word has no usable cue.
            } finally {
                if (requestController === controller) {
                    requestController = null;
                }
            }
        }, DEFINITION_LINK_CUE_DELAY_MS);
    };

    // Monaco only reports a key release while it holds DOM focus, and this cue
    // routinely appears without it: the modifier rides on the mouse event, so
    // hovering decorates the word whatever is focused. Left to the editor alone
    // the underline outlives the release and is retired by the next mouse move
    // instead — the move that opens a click. Tearing the decoration down there
    // re-renders the line under the pointer mid-gesture, and the click that
    // follows focuses the editor without moving the caret. Watching the window
    // catches the release wherever it lands, which is before that click.
    const onGlobalKeyUp = (event: KeyboardEvent): void => {
        if (modifierFrom(event)) return;
        modifierHeld = false;
        clear();
    };
    // A window that has lost focus never sees the release at all, so the
    // modifier is treated as dropped rather than held indefinitely.
    const onGlobalBlur = (): void => {
        modifierHeld = false;
        clear();
    };
    globalEvents?.addEventListener('keyup', onGlobalKeyUp, true);
    globalEvents?.addEventListener('blur', onGlobalBlur);

    disposables.push(
        {
            dispose: () => {
                globalEvents?.removeEventListener('keyup', onGlobalKeyUp, true);
                globalEvents?.removeEventListener('blur', onGlobalBlur);
            },
        },
        editor.onMouseMove((event) => {
            lastMouseEvent = event;
            inspectMouseTarget(event);
        }),
        editor.onMouseLeave(() => {
            lastMouseEvent = null;
            clear();
        }),
        editor.onKeyDown((event) => {
            modifierHeld = modifierFrom(event);
            if (modifierHeld && lastMouseEvent) {
                inspectMouseTarget(lastMouseEvent, true);
            }
        }),
        editor.onKeyUp((event) => {
            modifierHeld = modifierFrom(event);
            if (!modifierHeld) {
                clear();
            }
        }),
        editor.onDidScrollChange(() => {
            lastMouseEvent = null;
            clear();
        }),
        editor.onDidChangeModelContent(() => {
            lastMouseEvent = null;
            clear();
        }),
    );

    return {
        dispose: () => {
            if (disposed) return;
            disposed = true;
            clear();
            for (const disposable of disposables) {
                disposable.dispose();
            }
        },
    };
}
