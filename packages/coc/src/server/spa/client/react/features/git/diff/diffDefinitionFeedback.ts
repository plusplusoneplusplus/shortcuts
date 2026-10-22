/**
 * "No definition found" feedback for Ctrl/Cmd+Click in a diff side.
 *
 * Monaco mutes its own empty-result message for the mouse gesture, so a click
 * on a word without a definition would otherwise do nothing at all. This
 * watches the same gesture, asks the mount's own resolver, and reports words
 * that resolve to nothing. Keyboard F12 / Alt+F12 keep Monaco's inline message.
 */
import type { editor as monacoEditor } from 'monaco-editor';
import { isMacPlatform } from '../../../utils/composerKeyboardShortcuts';

const CONTENT_TEXT_MOUSE_TARGET = 6;

export type DiffNoDefinition = (word: string) => void;

export function noDefinitionMessage(word: string): string {
    return `No definition found for '${word}'`;
}

export interface InstallNoDefinitionFeedbackOptions {
    /** Test doubles may omit `onMouseUp`; the feedback is then inert. */
    editor: Partial<Pick<monacoEditor.ICodeEditor, 'onMouseUp'>>;
    model: Pick<monacoEditor.ITextModel, 'getWordAtPosition'>;
    resolve: (position: { lineNumber: number; column: number }, signal: AbortSignal) => Promise<boolean>;
    onNoDefinition?: DiffNoDefinition;
    /** Overridable for tests; defaults to the browser platform. */
    platform?: string;
}

export function installNoDefinitionFeedback({
    editor, model, resolve, onNoDefinition, platform,
}: InstallNoDefinitionFeedbackOptions): { dispose(): void } {
    if (!onNoDefinition || !editor.onMouseUp) return { dispose() {} };
    const useMetaKey = isMacPlatform(platform);
    let pending: AbortController | null = null;
    let disposed = false;
    const subscription = editor.onMouseUp(event => {
        const mouse = event.event;
        const position = event.target.position;
        if (!mouse.leftButton || !(useMetaKey ? mouse.metaKey : mouse.ctrlKey)
            || event.target.type !== CONTENT_TEXT_MOUSE_TARGET || !position) return;
        const word = model.getWordAtPosition(position);
        if (!word) return;
        pending?.abort();
        const controller = new AbortController();
        pending = controller;
        void resolve(position, controller.signal).catch(() => false).then(found => {
            if (pending === controller) pending = null;
            if (!found && !disposed && !controller.signal.aborted) onNoDefinition(word.word);
        });
    });
    return {
        dispose() {
            if (disposed) return;
            disposed = true;
            pending?.abort();
            subscription.dispose();
        },
    };
}
