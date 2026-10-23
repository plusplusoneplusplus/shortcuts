/**
 * Ctrl/Cmd+Alt+Click in a diff side peeks the definition inline (AC-03).
 *
 * Monaco reads that gesture as "open to the side", which a diff has no place
 * for: it would route the jump like a plain Ctrl/Cmd+Click and leave the diff.
 * This catches the gesture on the editor's container in the capture phase,
 * before Monaco's own mouse handling sees it, and runs Peek Definition at the
 * clicked word instead. Alt+F12 is Monaco's own Peek and needs nothing here.
 */
import type { editor as monacoEditor } from 'monaco-editor';
import { isMacPlatform } from '../../../utils/composerKeyboardShortcuts';

const CONTENT_TEXT_MOUSE_TARGET = 6;
export const PEEK_DEFINITION_ACTION = 'editor.action.peekDefinition';

const SWALLOWED_EVENTS = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'] as const;

export interface InstallPeekDefinitionClickOptions {
    /** Test doubles may omit DOM access; the gesture is then left to Monaco. */
    editor: Partial<Pick<monacoEditor.ICodeEditor,
        'getContainerDomNode' | 'getTargetAtClientPoint' | 'setPosition' | 'focus' | 'trigger'>>;
    model: Pick<monacoEditor.ITextModel, 'getWordAtPosition'>;
    /** Overridable for tests; defaults to the browser platform. */
    platform?: string;
}

export function installPeekDefinitionClick({
    editor, model, platform,
}: InstallPeekDefinitionClickOptions): { dispose(): void } {
    const container = editor.getContainerDomNode?.();
    if (!container || !editor.getTargetAtClientPoint || !editor.trigger) return { dispose() {} };
    const useMetaKey = isMacPlatform(platform);

    const onEvent = (event: Event) => {
        const mouse = event as MouseEvent;
        if (mouse.button !== 0 || !mouse.altKey || !(useMetaKey ? mouse.metaKey : mouse.ctrlKey)) return;
        const target = editor.getTargetAtClientPoint!(mouse.clientX, mouse.clientY);
        const position = target?.position;
        if (target?.type !== CONTENT_TEXT_MOUSE_TARGET || !position || !model.getWordAtPosition(position)) return;
        // Every event of the gesture is kept from Monaco, so neither its
        // open-to-side jump nor its click bookkeeping runs.
        event.stopPropagation();
        // One gesture fires exactly one mousedown (pointerdown is left
        // unprevented so the compatibility mousedown still follows).
        if (event.type !== 'mousedown') return;
        event.preventDefault();
        editor.setPosition?.(position);
        editor.focus?.();
        editor.trigger!('mouse', PEEK_DEFINITION_ACTION, null);
    };

    for (const type of SWALLOWED_EVENTS) container.addEventListener(type, onEvent, true);
    let disposed = false;
    return {
        dispose() {
            if (disposed) return;
            disposed = true;
            for (const type of SWALLOWED_EVENTS) container.removeEventListener(type, onEvent, true);
        },
    };
}
