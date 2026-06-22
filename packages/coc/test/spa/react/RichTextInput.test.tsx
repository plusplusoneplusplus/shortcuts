/* @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React, { createRef } from 'react';
import { RichTextInput } from '../../../src/server/spa/client/react/shared/RichTextInput';
import type { RichTextInputHandle } from '../../../src/server/spa/client/react/shared/RichTextInput';

afterEach(() => {
    vi.restoreAllMocks();
});

describe('RichTextInput', () => {
    it('renders without crashing', () => {
        render(<RichTextInput onChange={vi.fn()} data-testid="rich" />);
        expect(screen.getByTestId('rich')).toBeDefined();
    });

    it('sets initial value on mount', () => {
        const ref = createRef<RichTextInputHandle>();
        render(<RichTextInput ref={ref} value="hello" onChange={vi.fn()} data-testid="rich" />);
        expect(ref.current!.getValue()).toBe('hello');
    });

    it('calls onChange with innerText on input', () => {
        const ref = createRef<RichTextInputHandle>();
        const onChange = vi.fn();
        render(<RichTextInput ref={ref} onChange={onChange} data-testid="rich" />);
        act(() => {
            ref.current!.setValue('typed text');
        });
        const div = screen.getByTestId('rich');
        fireEvent.input(div);
        expect(onChange).toHaveBeenCalledWith('typed text', expect.any(Number));
    });

    it('disabled renders contentEditable false', () => {
        render(<RichTextInput disabled onChange={vi.fn()} data-testid="rich" />);
        const div = screen.getByTestId('rich');
        expect(div.getAttribute('contenteditable')).toBe('false');
    });

    it('disabled applies opacity class', () => {
        render(<RichTextInput disabled onChange={vi.fn()} data-testid="rich" />);
        const div = screen.getByTestId('rich');
        expect(div.className).toContain('opacity-60');
    });

    it('enabled renders contentEditable true', () => {
        render(<RichTextInput onChange={vi.fn()} data-testid="rich" />);
        const div = screen.getByTestId('rich');
        expect(div.getAttribute('contenteditable')).toBe('true');
    });

    it('paste with images: delegates to onPaste prop and stops', () => {
        const onPaste = vi.fn((e: React.ClipboardEvent) => {
            e.preventDefault();
        });
        render(<RichTextInput onPaste={onPaste} onChange={vi.fn()} data-testid="rich" />);
        const div = screen.getByTestId('rich');
        const wasCancelled = !fireEvent.paste(div);
        expect(onPaste).toHaveBeenCalled();
        expect(wasCancelled).toBe(true);
    });

    it('paste without images: always prevents default for plain-text paste', () => {
        const onPaste = vi.fn(); // does NOT call preventDefault
        document.execCommand = vi.fn().mockReturnValue(true);
        render(<RichTextInput onPaste={onPaste} onChange={vi.fn()} data-testid="rich" />);
        const div = screen.getByTestId('rich');
        const wasCancelled = !fireEvent.paste(div, {
            clipboardData: { getData: () => 'plain text' },
        });
        expect(onPaste).toHaveBeenCalled();
        // Now always prevented to force plain-text insertion
        expect(wasCancelled).toBe(true);
        expect(document.execCommand).toHaveBeenCalledWith('insertText', false, 'plain text');
    });

    it('imperative getValue and setValue', () => {
        const ref = createRef<RichTextInputHandle>();
        render(<RichTextInput ref={ref} onChange={vi.fn()} data-testid="rich" />);
        act(() => {
            ref.current!.setValue('test');
        });
        expect(ref.current!.getValue()).toBe('test');
    });

    it('imperative focus', () => {
        const ref = createRef<RichTextInputHandle>();
        render(<RichTextInput ref={ref} onChange={vi.fn()} data-testid="rich" />);
        act(() => {
            ref.current!.focus();
        });
        const div = screen.getByTestId('rich');
        expect(document.activeElement).toBe(div);
    });

    it('sets data-placeholder attribute', () => {
        render(<RichTextInput placeholder="Type here..." onChange={vi.fn()} data-testid="rich" />);
        const div = screen.getByTestId('rich');
        expect(div.getAttribute('data-placeholder')).toBe('Type here...');
    });

    it('forwards onKeyDown to the div', () => {
        const onKeyDown = vi.fn();
        render(<RichTextInput onKeyDown={onKeyDown} onChange={vi.fn()} data-testid="rich" />);
        const div = screen.getByTestId('rich');
        fireEvent.keyDown(div, { key: 'Enter' });
        expect(onKeyDown).toHaveBeenCalled();
    });

    it('applies custom className', () => {
        render(<RichTextInput className="my-custom" onChange={vi.fn()} data-testid="rich" />);
        const div = screen.getByTestId('rich');
        expect(div.className).toContain('my-custom');
    });

    it('strips trailing newlines from onChange (Chromium contentEditable quirk)', () => {
        const ref = createRef<RichTextInputHandle>();
        const onChange = vi.fn();
        render(<RichTextInput ref={ref} onChange={onChange} data-testid="rich" />);
        const div = screen.getByTestId('rich');
        // Simulate Chromium behavior: innerText has trailing \n
        Object.defineProperty(div, 'innerText', { value: '/\n', writable: true, configurable: true });
        fireEvent.input(div);
        expect(onChange).toHaveBeenCalledWith('/', expect.any(Number));
    });

    it('strips multiple trailing newlines from onChange', () => {
        const ref = createRef<RichTextInputHandle>();
        const onChange = vi.fn();
        render(<RichTextInput ref={ref} onChange={onChange} data-testid="rich" />);
        const div = screen.getByTestId('rich');
        Object.defineProperty(div, 'innerText', { value: 'hello\n\n', writable: true, configurable: true });
        fireEvent.input(div);
        expect(onChange).toHaveBeenCalledWith('hello', expect.any(Number));
    });

    it('preserves interior newlines in onChange', () => {
        const ref = createRef<RichTextInputHandle>();
        const onChange = vi.fn();
        render(<RichTextInput ref={ref} onChange={onChange} data-testid="rich" />);
        const div = screen.getByTestId('rich');
        Object.defineProperty(div, 'innerText', { value: 'line1\nline2\n', writable: true, configurable: true });
        fireEvent.input(div);
        expect(onChange).toHaveBeenCalledWith('line1\nline2', expect.any(Number));
    });

    it('passes cursor position as second argument to onChange', () => {
        const onChange = vi.fn();
        render(<RichTextInput onChange={onChange} data-testid="rich" />);
        const div = screen.getByTestId('rich');
        Object.defineProperty(div, 'innerText', { value: 'hello', writable: true, configurable: true });
        fireEvent.input(div);
        // In jsdom, getSelection may return offset 0; in real browsers, actual cursor position
        expect(onChange).toHaveBeenCalledWith('hello', expect.any(Number));
    });

    it('falls back to text.length when getSelection is unavailable', () => {
        const origGetSelection = window.getSelection;
        window.getSelection = () => null as any;
        try {
            const onChange = vi.fn();
            render(<RichTextInput onChange={onChange} data-testid="rich2" />);
            const div = screen.getByTestId('rich2');
            Object.defineProperty(div, 'innerText', { value: '/cmd', writable: true, configurable: true });
            fireEvent.input(div);
            expect(onChange).toHaveBeenCalledWith('/cmd', 4);
        } finally {
            window.getSelection = origGetSelection;
        }
    });

    it('getValue strips trailing newlines', () => {
        const ref = createRef<RichTextInputHandle>();
        render(<RichTextInput ref={ref} onChange={vi.fn()} data-testid="rich" />);
        const div = screen.getByTestId('rich');
        Object.defineProperty(div, 'innerText', { value: '/\n', writable: true, configurable: true });
        expect(ref.current!.getValue()).toBe('/');
    });

    it('setValue with cursorPos still sets innerText correctly', () => {
        const ref = createRef<RichTextInputHandle>();
        render(<RichTextInput ref={ref} onChange={vi.fn()} data-testid="rich" />);
        act(() => {
            ref.current!.setValue('/impl ', 6);
        });
        expect(ref.current!.getValue()).toBe('/impl ');
    });

    it('setValue with cursorPos does not throw when getSelection is null', () => {
        const origGetSelection = window.getSelection;
        window.getSelection = () => null as any;
        try {
            const ref = createRef<RichTextInputHandle>();
            render(<RichTextInput ref={ref} onChange={vi.fn()} data-testid="rich-gs-null" />);
            expect(() => {
                act(() => { ref.current!.setValue('/impl ', 6); });
            }).not.toThrow();
            expect(ref.current!.getValue()).toBe('/impl ');
        } finally {
            window.getSelection = origGetSelection;
        }
    });

    it('setValue with cursorPos calls getSelection and addRange', () => {
        const addRange = vi.fn();
        const removeAllRanges = vi.fn();
        const origGetSelection = window.getSelection;
        window.getSelection = () => ({ addRange, removeAllRanges, rangeCount: 0 }) as any;
        try {
            const ref = createRef<RichTextInputHandle>();
            render(<RichTextInput ref={ref} onChange={vi.fn()} data-testid="rich-sel" />);
            act(() => { ref.current!.setValue('/impl ', 6); });
            expect(removeAllRanges).toHaveBeenCalled();
            expect(addRange).toHaveBeenCalled();
        } finally {
            window.getSelection = origGetSelection;
        }
    });

    it('setValue without cursorPos does not call getSelection', () => {
        const getSelectionSpy = vi.spyOn(window, 'getSelection');
        const ref = createRef<RichTextInputHandle>();
        render(<RichTextInput ref={ref} onChange={vi.fn()} data-testid="rich-no-cur" />);
        act(() => { ref.current!.setValue('/impl '); });
        expect(getSelectionSpy).not.toHaveBeenCalled();
    });

    // Regression: pasting rich HTML should strip formatting and insert plain text only.
    it('paste strips HTML formatting and inserts plain text only', () => {
        document.execCommand = vi.fn().mockReturnValue(true);
        render(<RichTextInput onChange={vi.fn()} data-testid="rich" />);
        const div = screen.getByTestId('rich');
        const wasCancelled = !fireEvent.paste(div, {
            clipboardData: {
                getData: (type: string) => type === 'text/plain' ? 'just plain text' : '<b>just plain text</b>',
            },
        });
        expect(wasCancelled).toBe(true);
        expect(document.execCommand).toHaveBeenCalledWith('insertText', false, 'just plain text');
    });

    it('paste with empty clipboard does not call execCommand', () => {
        document.execCommand = vi.fn().mockReturnValue(true);
        render(<RichTextInput onChange={vi.fn()} data-testid="rich" />);
        const div = screen.getByTestId('rich');
        fireEvent.paste(div, {
            clipboardData: { getData: () => '' },
        });
        expect(document.execCommand).not.toHaveBeenCalled();
    });

    it('paste with clipboard data missing getData does not throw or call execCommand', () => {
        document.execCommand = vi.fn().mockReturnValue(true);
        render(<RichTextInput onChange={vi.fn()} data-testid="rich" />);
        const div = screen.getByTestId('rich');

        expect(() => {
            fireEvent.paste(div, {
                clipboardData: { items: [] },
            });
        }).not.toThrow();
        expect(document.execCommand).not.toHaveBeenCalled();
    });

    it('contentEditable div has whitespace-pre-wrap class (browser trailing-space preservation)', () => {
        render(<RichTextInput onChange={vi.fn()} data-testid="rich-ws" />);
        const div = screen.getByTestId('rich-ws');
        expect(div.className).toContain('whitespace-pre-wrap');
    });
});
