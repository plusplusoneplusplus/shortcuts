import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { cn } from '../ui/cn';
import { pasteHtmlToMarkdown } from './pasteHtmlToMarkdown';
import { atomicFragment, atomicPoint, atomicSelection, readAtomicText, replaceAtomicRange } from './atomicTargetText';
import { targetSpans, targetPlainText } from '../../../../shared/sentinel-target-reference';
import { splitFilePathPills } from './richTextPills';

export interface RichTextInputHandle {
    getValue(): string;
    /** Set the text content. Pass cursorPos to place the cursor at that offset after setting. */
    setValue(text: string, cursorPos?: number): void;
    focus(): void;
    /** Replace a raw serialized range as one native undo operation. */
    replaceRange?(start: number, end: number, text: string): void;
}

export interface RichTextInputProps {
    value?: string;
    atomicTargets?: boolean;
    onCursorChange?: (position: number) => void;
    role?: string;
    'aria-label'?: string;
    'aria-expanded'?: boolean;
    'aria-controls'?: string;
    'aria-activedescendant'?: string;
    onChange: (val: string, cursorPos: number) => void;
    onPaste?: (e: React.ClipboardEvent) => void;
    onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
    disabled?: boolean;
    placeholder?: string;
    className?: string;
    id?: string;
    'data-testid'?: string;
    /**
     * Inline ghost-text suffix rendered after the cursor in gray italic.
     * Pure visual; does not affect the input's value or events.
     * Hidden when `disabled` or empty.
     */
    ghostText?: string;
    /**
     * When true, backticked file paths in `value` are painted with a pill
     * background by the same transparent-text overlay that draws ghost text.
     * Purely visual: the contenteditable below stays plain text and
     * `getValue()` is unaffected.
     */
    pillPaths?: boolean;
}

/**
 * Pill chrome for a backticked path in the overlay. The background is
 * translucent and the text transparent, so the real characters in the
 * contenteditable underneath show through as normal. The visual padding comes
 * from a box-shadow spread rather than real padding — padding would shift every
 * following character out of alignment with the text below.
 */
const PILL_CLASS = [
    'rounded-[3px]',
    // rgba() literals rather than `bg-[#hex]/12`: this project's Tailwind
    // build does not emit the arbitrary-color + slash-opacity combination.
    'bg-[rgba(0,120,212,0.12)] dark:bg-[rgba(79,193,255,0.20)]',
    'shadow-[0_0_0_2px_rgba(0,120,212,0.12)] dark:shadow-[0_0_0_2px_rgba(79,193,255,0.20)]',
].join(' ');

export const RichTextInput = forwardRef<RichTextInputHandle, RichTextInputProps>(
    function RichTextInput(props, ref) {
        const divRef = useRef<HTMLDivElement>(null);

        useImperativeHandle(ref, () => ({
            getValue: () => readValue(),
            replaceRange: (start, end, text) => {
                if (!divRef.current) return;
                replaceAtomicRange(divRef.current, start, end, text);
                handleInput();
            },
            setValue: (text, cursorPos) => {
                const div = divRef.current;
                if (!div) return;
                if (props.atomicTargets) div.replaceChildren(atomicFragment(text));
                else div.innerText = text;
                if (cursorPos == null) return;
                const sel = window.getSelection?.();
                if (!sel) return;
                const range = document.createRange();
                if (props.atomicTargets) {
                    range.setStart(...atomicPoint(div, cursorPos));
                    range.collapse(true); sel.removeAllRanges(); sel.addRange(range);
                    return;
                }
                let remaining = cursorPos;
                let placed = false;
                const walk = (node: Node) => {
                    if (placed) return;
                    if (node.nodeType === Node.TEXT_NODE) {
                        const len = node.textContent?.length ?? 0;
                        if (remaining <= len) {
                            range.setStart(node, remaining);
                            range.collapse(true);
                            placed = true;
                            return;
                        }
                        remaining -= len;
                    } else {
                        for (const child of Array.from(node.childNodes)) {
                            walk(child);
                            if (placed) return;
                        }
                    }
                };
                walk(div);
                if (!placed) {
                    range.selectNodeContents(div);
                    range.collapse(false);
                }
                sel.removeAllRanges();
                sel.addRange(range);
            },
            focus: () => divRef.current?.focus(),
        }));

        useEffect(() => {
            if (props.value != null && divRef.current) {
                if (props.atomicTargets) divRef.current.replaceChildren(atomicFragment(props.value));
                else divRef.current.innerText = props.value;
            }
        }, [props.atomicTargets]); // eslint-disable-line react-hooks/exhaustive-deps

        const readValue = () => (props.atomicTargets && divRef.current
            ? readAtomicText(divRef.current) : divRef.current?.innerText ?? '').replace(/\n+$/, '');

        const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
            props.onPaste?.(e);
            if (e.defaultPrevented) return;
            // Always insert as plain text — pasted HTML never reaches the
            // contentEditable; rich pastes are converted to markdown source.
            e.preventDefault();
            const getData = (type: string): string => {
                try {
                    return typeof e.clipboardData?.getData === 'function'
                        ? (e.clipboardData.getData(type) ?? '')
                        : '';
                } catch {
                    return '';
                }
            };
            const structured = props.atomicTargets ? getData('application/x-coc-sentinel-target-text') : '';
            if (structured && targetSpans(structured).length && divRef.current) {
                const range = atomicSelection(divRef.current);
                if (range) {
                    replaceAtomicRange(divRef.current, range.start, range.end, structured);
                    handleInput(); return;
                }
            }
            const plain = getData('text/plain');
            // Rich pastes carry a text/html flavor: convert meaningful markup
            // to markdown source; trivial/absent HTML falls back to text/plain.
            const text = pasteHtmlToMarkdown(getData('text/html'), plain) ?? plain;
            if (!text) return;
            // execCommand maintains undo history in most browsers
            if (document.execCommand) {
                document.execCommand('insertText', false, text);
            } else {
                // Fallback: insert text via Selection API
                const sel = window.getSelection?.();
                if (sel && sel.rangeCount > 0) {
                    const range = sel.getRangeAt(0);
                    range.deleteContents();
                    range.insertNode(document.createTextNode(text));
                    range.collapse(false);
                    sel.removeAllRanges();
                    sel.addRange(range);
                }
            }
        };

        const handleInput = () => {
            const text = readValue();
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
                        cursorPos = Math.min(props.atomicTargets ? readAtomicText(pre.cloneContents()).length : pre.toString().length, text.length);
                    }
                }
            } catch { /* fallback to text.length */ }
            props.onChange(text, cursorPos);
        };

        const overlayTestId = props['data-testid']
            ? `${props['data-testid']}-ghost`
            : 'rich-input-ghost';
        const pillTestId = props['data-testid']
            ? `${props['data-testid']}-pill`
            : 'rich-input-pill';
        const displayValue = props.atomicTargets ? targetPlainText(props.value ?? '') : props.value ?? '';
        const segments = props.pillPaths
            ? splitFilePathPills(displayValue)
            : [{ text: displayValue, pill: false }];
        // The overlay is shared by ghost text and path pills; it only mounts
        // when one of them actually has something to draw.
        const showOverlay = !props.disabled && props.value !== undefined
            && (!!props.ghostText || segments.some((s) => s.pill));

        return (
            <div className="relative w-full">
                <div
                    ref={divRef}
                    contentEditable={props.disabled ? 'false' : 'true'}
                    aria-disabled={props.disabled || undefined}
                    data-placeholder={props.placeholder}
                    data-rich-input=""
                    onInput={handleInput}
                    role={props.role ?? 'textbox'}
                    aria-label={props['aria-label']}
                    aria-multiline="true"
                    aria-expanded={props['aria-expanded']}
                    aria-controls={props['aria-controls']}
                    aria-activedescendant={props['aria-activedescendant']}
                    onKeyDown={e => {
                        if (props.atomicTargets && divRef.current && !e.nativeEvent.isComposing) {
                            const selected = atomicSelection(divRef.current);
                            if (selected && selected.start === selected.end && (e.key === 'Backspace' || e.key === 'Delete')) {
                                const span = targetSpans(readValue()).find(s => e.key === 'Backspace' ? s.end === selected.start : s.start === selected.start);
                                if (span) { e.preventDefault(); replaceAtomicRange(divRef.current, span.start, span.end, ''); handleInput(); return; }
                            }
                        }
                        props.onKeyDown?.(e);
                    }}
                    onKeyUp={() => { if (divRef.current) { const selection = atomicSelection(divRef.current); if (selection) props.onCursorChange?.(selection.end); } }}
                    onMouseUp={() => { if (divRef.current) { const selection = atomicSelection(divRef.current); if (selection) props.onCursorChange?.(selection.end); } }}
                    onCopy={e => {
                        if (!props.atomicTargets) return;
                        const selected = window.getSelection();
                        if (!selected?.rangeCount) return;
                        const text = readAtomicText(selected.getRangeAt(0).cloneContents());
                        if (!targetSpans(text).length) return;
                        e.preventDefault();
                        e.clipboardData.setData('text/plain', targetPlainText(text));
                        e.clipboardData.setData('application/x-coc-sentinel-target-text', text);
                    }}
                    onCut={e => {
                        if (!props.atomicTargets || !divRef.current) return;
                        const selected = atomicSelection(divRef.current);
                        if (!selected || selected.start === selected.end) return;
                        const text = readValue().slice(selected.start, selected.end);
                        if (!targetSpans(text).length) return;
                        e.preventDefault();
                        e.clipboardData.setData('text/plain', targetPlainText(text));
                        e.clipboardData.setData('application/x-coc-sentinel-target-text', text);
                        replaceAtomicRange(divRef.current, selected.start, selected.end, ''); handleInput();
                    }}
                    onPaste={handlePaste}
                    className={cn(
                        'w-full min-h-[34px] max-h-28 overflow-y-auto resize-y rounded border',
                        'whitespace-pre-wrap',
                        'bg-white dark:bg-[#1f1f1f] px-2 py-1.5 text-sm text-[#1e1e1e] dark:text-[#cccccc]',
                        'focus:outline-none focus:ring-2',
                        'relative',
                        props.disabled && 'opacity-60 cursor-not-allowed',
                        props.className,
                    )}
                    id={props.id}
                    data-testid={props['data-testid']}
                />
                {showOverlay ? (
                    // Overlay rendered ABOVE the contenteditable. The typed
                    // value is repeated here in fully-transparent text so the
                    // ghost suffix lines up exactly after the caret. The
                    // contenteditable below remains the source of truth and
                    // renders the user's actual text in normal color (the
                    // overlay's transparent text passes through to it).
                    <div
                        aria-hidden="true"
                        data-testid={overlayTestId}
                        className={cn(
                            'pointer-events-none absolute inset-0 z-10 overflow-hidden',
                            'rounded border border-transparent',
                            'whitespace-pre-wrap break-words',
                            'px-2 py-1.5 text-sm',
                            props.className,
                        )}
                        style={{
                            color: 'transparent',
                            background: 'transparent',
                        }}
                    >
                        {segments.map((seg, i) => (
                            <span
                                key={i}
                                className={seg.pill ? PILL_CLASS : undefined}
                                data-testid={seg.pill ? pillTestId : undefined}
                                style={{ color: 'transparent' }}
                            >
                                {seg.text}
                            </span>
                        ))}
                        {props.ghostText ? (
                        <span
                            className="italic"
                            style={{ color: '#9e9e9e' }}
                            data-testid={`${overlayTestId}-suffix`}
                        >
                            {props.ghostText}
                        </span>
                        ) : null}
                    </div>
                ) : null}
            </div>
        );
    }
);
