import { useCallback, useRef, forwardRef, useImperativeHandle, useEffect } from 'react';
import { cn } from '../ui/cn';
import { useUndoRedo } from './useUndoRedo';

export interface SourceEditorProps {
    content: string;
    onChange: (content: string) => void;
    readOnly?: boolean;
    className?: string;
}

export const SourceEditor = forwardRef<HTMLTextAreaElement, SourceEditorProps>(
    function SourceEditor({ content, onChange, readOnly, className }, ref) {
        const textareaRef = useRef<HTMLTextAreaElement>(null);
        const { push, undo, redo, reset } = useUndoRedo();

        useImperativeHandle(ref, () => textareaRef.current!, []);

        // Track every content value we set internally so we can tell external
        // changes (note switch) from our own undo/redo/edit round-trips.
        const internalValuesRef = useRef(new Set<string>());

        // Reset history whenever content changes from outside (e.g. note switch).
        useEffect(() => {
            if (internalValuesRef.current.has(content)) {
                internalValuesRef.current.delete(content);
                return;
            }
            // External change — clear stacks so we don't undo into stale content.
            reset();
            internalValuesRef.current.clear();
        }, [content, reset]);

        // Capture the selection just before a key-driven change so the pushed
        // snapshot has the pre-change cursor position.
        const selBeforeChange = useRef<{ start: number; end: number } | null>(null);

        const handleKeyDown = useCallback(
            (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
                const ta = textareaRef.current;
                if (!ta) return;

                const ctrl = e.ctrlKey || e.metaKey;

                const isUndo = ctrl && !e.shiftKey && e.key === 'z';
                const isRedo =
                    (ctrl && e.shiftKey && e.key === 'z') ||
                    (ctrl && e.key === 'y');

                if (isUndo) {
                    e.preventDefault();
                    const prev = undo({
                        value: content,
                        selStart: ta.selectionStart,
                        selEnd: ta.selectionEnd,
                    });
                    if (prev) {
                        internalValuesRef.current.add(prev.value);
                        onChange(prev.value);
                        requestAnimationFrame(() =>
                            ta.setSelectionRange(prev.selStart, prev.selEnd),
                        );
                    }
                    return;
                }

                if (isRedo) {
                    e.preventDefault();
                    const next = redo({
                        value: content,
                        selStart: ta.selectionStart,
                        selEnd: ta.selectionEnd,
                    });
                    if (next) {
                        internalValuesRef.current.add(next.value);
                        onChange(next.value);
                        requestAnimationFrame(() =>
                            ta.setSelectionRange(next.selStart, next.selEnd),
                        );
                    }
                    return;
                }

                if (e.key === 'Tab') {
                    e.preventDefault();
                    const { selectionStart, selectionEnd } = ta;
                    push({ value: content, selStart: selectionStart, selEnd: selectionEnd });
                    const newValue =
                        content.slice(0, selectionStart) + '\t' + content.slice(selectionEnd);
                    internalValuesRef.current.add(newValue);
                    onChange(newValue);
                    requestAnimationFrame(() =>
                        ta.setSelectionRange(selectionStart + 1, selectionStart + 1),
                    );
                    return;
                }

                // For regular keystrokes, capture the current selection so the
                // onChange handler can save an accurate pre-change snapshot.
                selBeforeChange.current = {
                    start: ta.selectionStart,
                    end: ta.selectionEnd,
                };
            },
            [content, onChange, push, undo, redo],
        );

        const handleChange = useCallback(
            (e: React.ChangeEvent<HTMLTextAreaElement>) => {
                const sel = selBeforeChange.current ?? {
                    start: content.length,
                    end: content.length,
                };
                selBeforeChange.current = null;
                push({ value: content, selStart: sel.start, selEnd: sel.end });
                internalValuesRef.current.add(e.target.value);
                onChange(e.target.value);
            },
            [content, onChange, push],
        );

        return (
            <textarea
                ref={textareaRef}
                className={cn('source-editor-textarea', className)}
                value={content}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                readOnly={readOnly}
            />
        );
    },
);
