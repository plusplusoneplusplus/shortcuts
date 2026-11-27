import { useState, useEffect } from 'react';
import type { Editor } from '@tiptap/react';

/**
 * Re-render the caller on every editor transaction.
 *
 * The toolbar is not the component that calls `useEditor` — `RichEditorCore`
 * is, and it is a sibling below the toolbar's owner — so the toolbar has no
 * reactivity of its own. The only editor→React bridge above it is `onUpdate`,
 * which tiptap fires solely when `transaction.docChanged`. Selection-only
 * transactions therefore never reach the toolbar, and every button that reads
 * editor state while rendering (the contextual table strip, the mark/heading/
 * list pressed states, the colour and font readouts) shows whatever was true
 * at the last document change.
 *
 * Subscribing once here, at the boundary where editor state enters the
 * toolbar, fixes all of them at once — no per-widget subscription needed.
 *
 * Tolerates a test double without an event emitter by doing nothing.
 */
export function useEditorTransactionTick(editor: Editor | null): void {
    const [, bump] = useState(0);

    useEffect(() => {
        if (!editor || typeof editor.on !== 'function') return;
        const onTransaction = () => bump((n) => n + 1);
        editor.on('transaction', onTransaction);
        return () => {
            editor.off('transaction', onTransaction);
        };
    }, [editor]);
}
