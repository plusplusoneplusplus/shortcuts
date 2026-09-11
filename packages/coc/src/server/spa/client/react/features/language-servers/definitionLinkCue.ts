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

export interface InstallDefinitionLinkCueOptions {
    editor: DefinitionLinkCueEditor;
    model: Pick<monacoEditor.ITextModel, 'getWordAtPosition'>;
    view: Pick<LanguageDocumentView, 'documentParams' | 'sendRequest'>;
    isEnabled: () => boolean;
    /** Overridable for tests; defaults to the browser platform. */
    platform?: string;
}

export function installDefinitionLinkCue({
    editor,
    model,
    view,
    isEnabled,
    platform,
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

    disposables.push(
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
