import { useCallback, useRef } from 'react';
import { cn } from './cn';

export interface SourceEditorProps {
    content: string;
    onChange: (content: string) => void;
    readOnly?: boolean;
    className?: string;
}

export function SourceEditor({ content, onChange, readOnly, className }: SourceEditorProps) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);

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
}
