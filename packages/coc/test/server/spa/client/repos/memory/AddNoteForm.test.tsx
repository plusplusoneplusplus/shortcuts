/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@plusplusoneplusplus/forge', () => ({}));

import { AddNoteForm } from '../../../../../../src/server/spa/client/react/features/memory/AddNoteForm';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultProps(overrides: Partial<{ onSave: any; onCancel: any }> = {}) {
    return {
        onSave: vi.fn(async () => {}),
        onCancel: vi.fn(),
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

describe('AddNoteForm — render', () => {
    it('renders textarea and save button', () => {
        render(<AddNoteForm {...defaultProps()} />);
        expect(screen.getByTestId('add-note-content')).toBeTruthy();
        expect(screen.getByTestId('add-note-save-btn')).toBeTruthy();
    });

    it('renders cancel button', () => {
        render(<AddNoteForm {...defaultProps()} />);
        expect(screen.getByTestId('add-note-cancel-btn')).toBeTruthy();
    });

    it('renders tag input', () => {
        render(<AddNoteForm {...defaultProps()} />);
        expect(screen.getByTestId('add-note-tag-input')).toBeTruthy();
    });

    it('save button shows "Remember →" by default', () => {
        render(<AddNoteForm {...defaultProps()} />);
        expect(screen.getByTestId('add-note-save-btn').textContent).toBe('Remember →');
    });

    it('save button is disabled when textarea is empty', () => {
        render(<AddNoteForm {...defaultProps()} />);
        expect(screen.getByTestId('add-note-save-btn')).toBeDisabled();
    });
});

// ---------------------------------------------------------------------------
// Submit with content
// ---------------------------------------------------------------------------

describe('AddNoteForm — submit', () => {
    it('calls onSave with trimmed content and empty tags on submit', async () => {
        const onSave = vi.fn(async () => {});
        render(<AddNoteForm {...defaultProps({ onSave })} />);

        await userEvent.type(screen.getByTestId('add-note-content'), '  Remember this pattern  ');
        await userEvent.click(screen.getByTestId('add-note-save-btn'));

        expect(onSave).toHaveBeenCalledOnce();
        expect(onSave).toHaveBeenCalledWith('Remember this pattern', []);
    });

    it('shows "Saving…" while submitting', async () => {
        let resolve!: () => void;
        const onSave = vi.fn(() => new Promise<void>(r => { resolve = r; }));
        render(<AddNoteForm {...defaultProps({ onSave })} />);

        await userEvent.type(screen.getByTestId('add-note-content'), 'note');
        await userEvent.click(screen.getByTestId('add-note-save-btn'));

        expect(screen.getByTestId('add-note-save-btn').textContent).toBe('Saving…');
        expect(screen.getByTestId('add-note-save-btn')).toBeDisabled();

        await act(async () => resolve());
    });

    it('re-enables save button after successful submit', async () => {
        const onSave = vi.fn(async () => {});
        render(<AddNoteForm {...defaultProps({ onSave })} />);

        await userEvent.type(screen.getByTestId('add-note-content'), 'note');
        await userEvent.click(screen.getByTestId('add-note-save-btn'));

        await waitFor(() => {
            expect(screen.getByTestId('add-note-save-btn').textContent).toBe('Remember →');
        });
    });
});

// ---------------------------------------------------------------------------
// Empty submit prevention
// ---------------------------------------------------------------------------

describe('AddNoteForm — empty submit', () => {
    it('save button is disabled when content is only whitespace', async () => {
        render(<AddNoteForm {...defaultProps()} />);
        await userEvent.type(screen.getByTestId('add-note-content'), '   ');
        expect(screen.getByTestId('add-note-save-btn')).toBeDisabled();
    });

    it('does not call onSave when clicking disabled save button', async () => {
        const onSave = vi.fn(async () => {});
        render(<AddNoteForm {...defaultProps({ onSave })} />);
        fireEvent.click(screen.getByTestId('add-note-save-btn'));
        expect(onSave).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// API error handling
// ---------------------------------------------------------------------------

describe('AddNoteForm — error handling', () => {
    // The component's handleSubmit uses try/finally without catch, so rejected
    // onSave calls surface as unhandled rejections. Temporarily suppress vitest's
    // unhandledRejection listeners for the whole describe block.
    let savedListeners: Function[];
    beforeEach(() => {
        savedListeners = process.rawListeners('unhandledRejection').slice();
        process.removeAllListeners('unhandledRejection');
        process.on('unhandledRejection', () => { /* swallow */ });
    });
    afterEach(async () => {
        // Flush pending microtasks so the rejection fires while suppressed
        await new Promise(r => setTimeout(r, 50));
        process.removeAllListeners('unhandledRejection');
        for (const l of savedListeners) process.on('unhandledRejection', l as any);
    });

    it('preserves content on onSave rejection', async () => {
        const onSave = vi.fn(async () => { throw new Error('API failure'); });
        render(<AddNoteForm {...defaultProps({ onSave })} />);

        await userEvent.type(screen.getByTestId('add-note-content'), 'precious note');
        await userEvent.click(screen.getByTestId('add-note-save-btn'));

        await waitFor(() => {
            expect(screen.getByTestId('add-note-save-btn')).not.toBeDisabled();
        });
        expect((screen.getByTestId('add-note-content') as HTMLTextAreaElement).value).toBe('precious note');
    });

    it('re-enables save button after onSave rejection', async () => {
        const onSave = vi.fn(async () => { throw new Error('fail'); });
        render(<AddNoteForm {...defaultProps({ onSave })} />);

        await userEvent.type(screen.getByTestId('add-note-content'), 'note');
        await userEvent.click(screen.getByTestId('add-note-save-btn'));

        await waitFor(() => {
            expect(screen.getByTestId('add-note-save-btn').textContent).toBe('Remember →');
        });
    });
});

// ---------------------------------------------------------------------------
// Tags input
// ---------------------------------------------------------------------------

describe('AddNoteForm — tags', () => {
    it('adds tag on Enter key and includes it in onSave', async () => {
        const onSave = vi.fn(async () => {});
        render(<AddNoteForm {...defaultProps({ onSave })} />);

        await userEvent.type(screen.getByTestId('add-note-tag-input'), 'frontend{enter}');
        expect(screen.getByText('frontend')).toBeTruthy();

        await userEvent.type(screen.getByTestId('add-note-content'), 'note');
        await userEvent.click(screen.getByTestId('add-note-save-btn'));

        expect(onSave).toHaveBeenCalledWith('note', ['frontend']);
    });

    it('adds tag on comma key', async () => {
        render(<AddNoteForm {...defaultProps()} />);
        await userEvent.type(screen.getByTestId('add-note-tag-input'), 'backend,');
        expect(screen.getByText('backend')).toBeTruthy();
    });

    it('adds tag on blur', async () => {
        render(<AddNoteForm {...defaultProps()} />);
        await userEvent.type(screen.getByTestId('add-note-tag-input'), 'utils');
        fireEvent.blur(screen.getByTestId('add-note-tag-input'));
        expect(screen.getByText('utils')).toBeTruthy();
    });

    it('trims whitespace from tag input', async () => {
        render(<AddNoteForm {...defaultProps()} />);
        await userEvent.type(screen.getByTestId('add-note-tag-input'), '  spaced  {enter}');
        expect(screen.getByText('spaced')).toBeTruthy();
    });

    it('ignores empty tag input on Enter', async () => {
        render(<AddNoteForm {...defaultProps()} />);
        await userEvent.type(screen.getByTestId('add-note-tag-input'), '   {enter}');
        expect(screen.queryByLabelText(/Remove tag/)).toBeNull();
    });

    it('does not add duplicate tags', async () => {
        render(<AddNoteForm {...defaultProps()} />);
        await userEvent.type(screen.getByTestId('add-note-tag-input'), 'dup{enter}');
        await userEvent.type(screen.getByTestId('add-note-tag-input'), 'dup{enter}');
        const removeBtns = screen.getAllByLabelText(/Remove tag dup/);
        expect(removeBtns).toHaveLength(1);
    });

    it('removes tag when × button is clicked', async () => {
        render(<AddNoteForm {...defaultProps()} />);
        await userEvent.type(screen.getByTestId('add-note-tag-input'), 'remove-me{enter}');
        expect(screen.getByText('remove-me')).toBeTruthy();

        await userEvent.click(screen.getByLabelText('Remove tag remove-me'));
        expect(screen.queryByText('remove-me')).toBeNull();
    });

    it('sends multiple tags in onSave', async () => {
        const onSave = vi.fn(async () => {});
        render(<AddNoteForm {...defaultProps({ onSave })} />);

        await userEvent.type(screen.getByTestId('add-note-tag-input'), 'a{enter}');
        await userEvent.type(screen.getByTestId('add-note-tag-input'), 'b{enter}');
        await userEvent.type(screen.getByTestId('add-note-tag-input'), 'c{enter}');

        await userEvent.type(screen.getByTestId('add-note-content'), 'note');
        await userEvent.click(screen.getByTestId('add-note-save-btn'));

        expect(onSave).toHaveBeenCalledWith('note', ['a', 'b', 'c']);
    });
});

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

describe('AddNoteForm — cancel', () => {
    it('calls onCancel when cancel button is clicked', async () => {
        const onCancel = vi.fn();
        render(<AddNoteForm {...defaultProps({ onCancel })} />);
        await userEvent.click(screen.getByTestId('add-note-cancel-btn'));
        expect(onCancel).toHaveBeenCalledOnce();
    });

    it('cancel button is disabled while submitting', async () => {
        let resolve!: () => void;
        const onSave = vi.fn(() => new Promise<void>(r => { resolve = r; }));
        render(<AddNoteForm {...defaultProps({ onSave })} />);

        await userEvent.type(screen.getByTestId('add-note-content'), 'note');
        await userEvent.click(screen.getByTestId('add-note-save-btn'));

        expect(screen.getByTestId('add-note-cancel-btn')).toBeDisabled();

        await act(async () => resolve());
    });
});
