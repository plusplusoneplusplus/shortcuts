import type { editor, IRange } from 'monaco-editor';

type SelectionEditor = Pick<editor.ICodeEditor, 'getDomNode' | 'hasTextFocus'> & {
    getSelection(): (IRange & { isEmpty(): boolean }) | null;
    getModel(): Pick<editor.ITextModel, 'getValueInRange'> | null;
};

const editors = new WeakMap<HTMLElement, SelectionEditor>();

export function registerSelectionEditor(codeEditor: SelectionEditor): () => void {
    const host = codeEditor.getDomNode();
    if (!host) return () => {};
    editors.set(host, codeEditor);
    return () => {
        if (editors.get(host) === codeEditor) editors.delete(host);
    };
}

/** Resolve only the focused buffer, never a retained selection in another editor or find widget. */
export function focusedMonacoSelection(doc: Document = document): string | undefined {
    for (let node = doc.activeElement; node; node = node.parentElement) {
        if (!(node instanceof HTMLElement)) continue;
        const codeEditor = editors.get(node);
        if (!codeEditor) continue;
        if (!codeEditor.hasTextFocus()) return undefined;
        const selection = codeEditor.getSelection();
        if (!selection || selection.isEmpty()) return undefined;
        return codeEditor.getModel()?.getValueInRange(selection) || undefined;
    }
    return undefined;
}
