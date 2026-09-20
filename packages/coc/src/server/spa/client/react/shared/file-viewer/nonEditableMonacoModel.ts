import type { EditorModelMountContext } from './MonacoFileEditor';

/** Lock a viewer-only Monaco model for its lifetime. */
export function mountNonEditableModel({ editor }: EditorModelMountContext): () => void {
    editor.updateOptions({ readOnly: true });
    return () => editor.updateOptions({ readOnly: false });
}
