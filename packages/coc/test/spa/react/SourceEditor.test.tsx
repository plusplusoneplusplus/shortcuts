/* @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React, { useState } from 'react';
import { SourceEditor } from '../../../src/server/spa/client/react/shared/SourceEditor';

// Controlled wrapper so the textarea reflects real state changes (needed for
// undo/redo tests where onChange drives subsequent renders).
function ControlledEditor(props: { initial?: string; readOnly?: boolean }) {
    const [content, setContent] = useState(props.initial ?? '');
    return (
        <SourceEditor
            content={content}
            onChange={setContent}
            readOnly={props.readOnly}
        />
    );
}

describe('SourceEditor', () => {
    it('renders textarea with content', () => {
        render(<SourceEditor content="hello" onChange={vi.fn()} />);
        const textarea = screen.getByRole('textbox');
        expect(textarea).toBeDefined();
        expect((textarea as HTMLTextAreaElement).value).toBe('hello');
    });

    it('calls onChange on input', () => {
        const onChange = vi.fn();
        render(<SourceEditor content="initial" onChange={onChange} />);
        const textarea = screen.getByRole('textbox');
        fireEvent.change(textarea, { target: { value: 'updated' } });
        expect(onChange).toHaveBeenCalledWith('updated');
    });

    it('supports readOnly mode', () => {
        render(<SourceEditor content="locked" onChange={vi.fn()} readOnly={true} />);
        const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
        expect(textarea.readOnly).toBe(true);
    });

    it('Tab key inserts tab character', () => {
        const onChange = vi.fn();
        render(<SourceEditor content="abc" onChange={onChange} />);
        const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;

        // Set cursor position to index 1 (between 'a' and 'bc')
        textarea.selectionStart = 1;
        textarea.selectionEnd = 1;

        const notCancelled = fireEvent.keyDown(textarea, { key: 'Tab' });

        expect(notCancelled).toBe(false); // preventDefault was called
        expect(onChange).toHaveBeenCalledWith('a\tbc');
    });

    describe('undo / redo', () => {
        it('Ctrl+Z undoes the last text change', () => {
            render(<ControlledEditor initial="hello" />);
            const ta = screen.getByRole('textbox') as HTMLTextAreaElement;

            // Type a character
            fireEvent.change(ta, { target: { value: 'hello world' } });
            expect(ta.value).toBe('hello world');

            // Undo
            fireEvent.keyDown(ta, { key: 'z', ctrlKey: true });
            expect(ta.value).toBe('hello');
        });

        it('Ctrl+Shift+Z redoes after undo', () => {
            render(<ControlledEditor initial="a" />);
            const ta = screen.getByRole('textbox') as HTMLTextAreaElement;

            fireEvent.change(ta, { target: { value: 'ab' } });
            fireEvent.change(ta, { target: { value: 'abc' } });

            // Undo twice
            fireEvent.keyDown(ta, { key: 'z', ctrlKey: true });
            expect(ta.value).toBe('ab');
            fireEvent.keyDown(ta, { key: 'z', ctrlKey: true });
            expect(ta.value).toBe('a');

            // Redo once
            fireEvent.keyDown(ta, { key: 'z', ctrlKey: true, shiftKey: true });
            expect(ta.value).toBe('ab');
        });

        it('Ctrl+Y redoes after undo', () => {
            render(<ControlledEditor initial="x" />);
            const ta = screen.getByRole('textbox') as HTMLTextAreaElement;

            fireEvent.change(ta, { target: { value: 'xy' } });
            fireEvent.keyDown(ta, { key: 'z', ctrlKey: true }); // undo
            expect(ta.value).toBe('x');

            fireEvent.keyDown(ta, { key: 'y', ctrlKey: true }); // redo
            expect(ta.value).toBe('xy');
        });

        it('new change clears the redo stack', () => {
            render(<ControlledEditor initial="a" />);
            const ta = screen.getByRole('textbox') as HTMLTextAreaElement;

            fireEvent.change(ta, { target: { value: 'ab' } });
            fireEvent.keyDown(ta, { key: 'z', ctrlKey: true }); // undo → 'a'

            // New edit — redo stack should be cleared
            fireEvent.change(ta, { target: { value: 'ac' } });

            // Redo should be a no-op now
            fireEvent.keyDown(ta, { key: 'z', ctrlKey: true, shiftKey: true });
            expect(ta.value).toBe('ac');
        });

        it('Ctrl+Z is a no-op when history is empty', () => {
            render(<ControlledEditor initial="start" />);
            const ta = screen.getByRole('textbox') as HTMLTextAreaElement;

            fireEvent.keyDown(ta, { key: 'z', ctrlKey: true });
            expect(ta.value).toBe('start'); // unchanged
        });

        it('Tab key is undoable', () => {
            render(<ControlledEditor initial="abc" />);
            const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
            ta.selectionStart = 1;
            ta.selectionEnd = 1;

            fireEvent.keyDown(ta, { key: 'Tab' });
            expect(ta.value).toBe('a\tbc');

            fireEvent.keyDown(ta, { key: 'z', ctrlKey: true });
            expect(ta.value).toBe('abc');
        });

        it('multiple undo steps work sequentially', () => {
            render(<ControlledEditor initial="" />);
            const ta = screen.getByRole('textbox') as HTMLTextAreaElement;

            fireEvent.change(ta, { target: { value: 'a' } });
            fireEvent.change(ta, { target: { value: 'ab' } });
            fireEvent.change(ta, { target: { value: 'abc' } });

            fireEvent.keyDown(ta, { key: 'z', ctrlKey: true });
            expect(ta.value).toBe('ab');
            fireEvent.keyDown(ta, { key: 'z', ctrlKey: true });
            expect(ta.value).toBe('a');
            fireEvent.keyDown(ta, { key: 'z', ctrlKey: true });
            expect(ta.value).toBe('');
        });

        it('history resets when content changes externally (note switch)', () => {
            const { rerender } = render(<SourceEditor content="note1" onChange={vi.fn()} />);
            const ta = screen.getByRole('textbox') as HTMLTextAreaElement;

            // Build up some history using a change event
            const onChange1 = vi.fn();
            rerender(<SourceEditor content="note1" onChange={onChange1} />);
            fireEvent.change(ta, { target: { value: 'note1 edited' } });

            // Simulate note switch — new external content, new onChange
            const onChange2 = vi.fn();
            act(() => {
                rerender(<SourceEditor content="note2" onChange={onChange2} />);
            });

            // Ctrl+Z should not undo into old note content
            fireEvent.keyDown(ta, { key: 'z', ctrlKey: true });
            expect(onChange2).not.toHaveBeenCalled();
            expect(ta.value).toBe('note2'); // unchanged
        });
    });
});
