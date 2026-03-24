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
        expect(onChange).toHaveBeenCalledWith('typed text');
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

    it('paste without images: does not call preventDefault', () => {
        const onPaste = vi.fn(); // does NOT call preventDefault
        render(<RichTextInput onPaste={onPaste} onChange={vi.fn()} data-testid="rich" />);
        const div = screen.getByTestId('rich');
        const wasNotCancelled = fireEvent.paste(div);
        expect(onPaste).toHaveBeenCalled();
        expect(wasNotCancelled).toBe(true);
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
});
