import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { cn } from './cn';

export interface RichTextInputHandle {
    getValue(): string;
    setValue(text: string): void;
    focus(): void;
}

export interface RichTextInputProps {
    value?: string;
    onChange: (val: string) => void;
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
            getValue: () => divRef.current?.innerText ?? '',
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
            const text = divRef.current?.innerText ?? '';
            props.onChange(text);
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
