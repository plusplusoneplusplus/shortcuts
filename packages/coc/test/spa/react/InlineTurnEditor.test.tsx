/**
 * Tests for InlineTurnEditor — the in-bubble "Edit message" editor (AC-02).
 *
 * The editor is a draft surface only: it never talks to the API. Everything
 * here is about what the user sees and what the component hands back to its
 * owner — prefill from the original turn, chip removal, the Enter/Escape key
 * contract, and the pending/error states the rewind+send caller drives.
 */

// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InlineTurnEditor } from '../../../src/server/spa/client/react/features/chat/conversation/InlineTurnEditor';

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';
const JPEG_DATA_URL = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

function renderEditor(props: Partial<React.ComponentProps<typeof InlineTurnEditor>> = {}) {
    const onCancel = vi.fn();
    const onSubmit = vi.fn();
    const utils = render(
        <InlineTurnEditor
            initialText="original text"
            onCancel={onCancel}
            onSubmit={onSubmit}
            {...props}
        />,
    );
    return { onCancel, onSubmit, ...utils };
}

const input = () => screen.getByTestId('inline-turn-editor-input');

/** Type into the contenteditable the way RichTextInput reads it back. */
function typeInto(text: string) {
    const div = input();
    (div as HTMLElement & { innerText: string }).innerText = text;
    fireEvent.input(div);
}

describe('InlineTurnEditor', () => {
    it('prefills the editor with the original turn text', () => {
        renderEditor();
        expect((input() as HTMLElement & { innerText?: string }).innerText).toBe('original text');
    });

    it('prefills the original turn images as removable chips', () => {
        renderEditor({ initialImages: [PNG_DATA_URL, JPEG_DATA_URL] });
        expect(screen.getAllByTestId('attachment-preview-image')).toHaveLength(2);
    });

    it('renders no chips when the turn had no images', () => {
        renderEditor();
        expect(screen.queryByTestId('attachment-preview-image')).toBeNull();
    });

    it('Save & Send submits the edited text with the retained images', () => {
        const { onSubmit } = renderEditor({ initialImages: [PNG_DATA_URL] });
        typeInto('edited text');
        fireEvent.click(screen.getByTestId('inline-turn-editor-save'));
        expect(onSubmit).toHaveBeenCalledTimes(1);
        const submission = onSubmit.mock.calls[0][0];
        expect(submission.text).toBe('edited text');
        expect(submission.attachments).toHaveLength(1);
        expect(submission.attachments[0].dataUrl).toBe(PNG_DATA_URL);
    });

    it('drops a removed image chip from the submission', () => {
        const { onSubmit } = renderEditor({ initialImages: [PNG_DATA_URL, JPEG_DATA_URL] });
        // The remove control sits inside each preview tile.
        const removeButtons = screen.getAllByTitle(/^Remove /);
        fireEvent.click(removeButtons[0]);
        expect(screen.getAllByTestId('attachment-preview-image')).toHaveLength(1);
        fireEvent.click(screen.getByTestId('inline-turn-editor-save'));
        const submission = onSubmit.mock.calls[0][0];
        expect(submission.attachments).toHaveLength(1);
        expect(submission.attachments[0].dataUrl).toBe(JPEG_DATA_URL);
    });

    it('Cancel is inert: it closes without submitting', () => {
        const { onCancel, onSubmit } = renderEditor();
        typeInto('half-written edit');
        fireEvent.click(screen.getByTestId('inline-turn-editor-cancel'));
        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('Escape cancels', () => {
        const { onCancel, onSubmit } = renderEditor();
        fireEvent.keyDown(input(), { key: 'Escape' });
        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('Enter submits', () => {
        const { onSubmit } = renderEditor();
        typeInto('send me');
        fireEvent.keyDown(input(), { key: 'Enter' });
        expect(onSubmit).toHaveBeenCalledTimes(1);
        expect(onSubmit.mock.calls[0][0].text).toBe('send me');
    });

    it('Shift+Enter inserts a newline instead of submitting', () => {
        const { onSubmit } = renderEditor();
        typeInto('line one');
        fireEvent.keyDown(input(), { key: 'Enter', shiftKey: true });
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('pending disables the editor and both buttons so the action cannot double-fire', () => {
        const { onSubmit } = renderEditor({ pending: true });
        const save = screen.getByTestId('inline-turn-editor-save') as HTMLButtonElement;
        const cancel = screen.getByTestId('inline-turn-editor-cancel') as HTMLButtonElement;
        expect(save.disabled).toBe(true);
        expect(cancel.disabled).toBe(true);
        expect(input().getAttribute('contenteditable')).toBe('false');
        fireEvent.click(save);
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('renders an inline error under the buttons', () => {
        renderEditor({ error: 'The conversation is busy' });
        expect(screen.getByTestId('inline-turn-editor-error').textContent).toBe('The conversation is busy');
    });

    it('renders no error region when there is no error', () => {
        renderEditor();
        expect(screen.queryByTestId('inline-turn-editor-error')).toBeNull();
    });
});
