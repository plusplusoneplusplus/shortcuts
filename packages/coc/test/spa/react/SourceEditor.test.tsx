/* @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { SourceEditor } from '../../../src/server/spa/client/react/shared/SourceEditor';

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
});
