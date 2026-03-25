import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { cn } from './cn';

export interface RichTextInputHandle {
    getValue(): string;
    setValue(text: string): void;
    focus(): void;
}

export interface RichTextInputProps {
    value?: string;
    onChange: (val: string, cursorPos: number) => void;
    onPaste?: (e: React.ClipboardEvent) => void;
    onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
    disabled?: boolean;
    placeholder?: string;
    className?: string;
    id?: string;
    'data-testid'?: string;
}

export const RichTextInput = forwardRef<RichTextInputHandle, RichTextInputProps>(
    function RichTextInput(props, ref) {
        const divRef = useRef<HTMLDivElement>(null);

        useImperativeHandle(ref, () => ({
            getValue: () => (divRef.current?.innerText ?? '').replace(/\n+$/, ''),
            setValue: (text) => { if (divRef.current) divRef.current.innerText = text; },
            focus: () => divRef.current?.focus(),
        }));

        useEffect(() => {
            if (props.value != null && divRef.current) {
                divRef.current.innerText = props.value;
            }
        }, []); // eslint-disable-line react-hooks/exhaustive-deps

        const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
            props.onPaste?.(e);
            if (e.defaultPrevented) return;
            // Let the browser handle HTML/text paste natively
        };

        const handleInput = () => {
            const text = (divRef.current?.innerText ?? '').replace(/\n+$/, '');
            let cursorPos = text.length;
            try {
                const sel = window.getSelection?.();
                if (sel && sel.rangeCount > 0 && divRef.current
                    && document.activeElement === divRef.current) {
                    const range = sel.getRangeAt(0);
                    if (divRef.current.contains(range.startContainer)) {
                        const pre = document.createRange();
                        pre.selectNodeContents(divRef.current);
                        pre.setEnd(range.startContainer, range.startOffset);
                        cursorPos = Math.min(pre.toString().length, text.length);
                    }
                }
            } catch { /* fallback to text.length */ }
            props.onChange(text, cursorPos);
        };

        return (
            <div
                ref={divRef}
                contentEditable={props.disabled ? 'false' : 'true'}
                data-placeholder={props.placeholder}
                data-rich-input=""
                onInput={handleInput}
                onKeyDown={props.onKeyDown}
                onPaste={handlePaste}
                className={cn(
                    'w-full min-h-[34px] max-h-28 overflow-y-auto resize-y rounded border',
                    'bg-white dark:bg-[#1f1f1f] px-2 py-1.5 text-sm text-[#1e1e1e] dark:text-[#cccccc]',
                    'focus:outline-none focus:ring-2',
                    props.disabled && 'opacity-60 cursor-not-allowed',
                    props.className,
                )}
                id={props.id}
                data-testid={props['data-testid']}
            />
        );
    }
);
