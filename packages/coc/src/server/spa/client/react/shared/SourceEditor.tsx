import { useCallback, useRef, forwardRef, useImperativeHandle } from 'react';
import { cn } from '../ui/cn';

export interface SourceEditorProps {
    content: string;
    onChange: (content: string) => void;
    readOnly?: boolean;
    className?: string;
}

export const SourceEditor = forwardRef<HTMLTextAreaElement, SourceEditorProps>(
    function SourceEditor({ content, onChange, readOnly, className }, ref) {
        const textareaRef = useRef<HTMLTextAreaElement>(null);

        useImperativeHandle(ref, () => textareaRef.current!, []);

        const handleKeyDown = useCallback(
            (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
                if (e.key === 'Tab') {
                    e.preventDefault();
                    const textarea = textareaRef.current;
                    if (!textarea) return;
                    const { selectionStart, selectionEnd } = textarea;
                    const newValue =
                        content.slice(0, selectionStart) + '\t' + content.slice(selectionEnd);
                    onChange(newValue);
                    requestAnimationFrame(() => {
                        textarea.setSelectionRange(selectionStart + 1, selectionStart + 1);
                    });
                }
            },
            [content, onChange],
        );

        const handleChange = useCallback(
            (e: React.ChangeEvent<HTMLTextAreaElement>) => {
                onChange(e.target.value);
            },
            [onChange],
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
