/**
 * RenameDialog — unit tests for the shared rename modal.
 *
 * Covers rendering, validation, keyboard interaction, and callback wiring.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { RenameDialog } from '../../../src/server/spa/client/react/shared/RenameDialog';

// Portal passthrough so Dialog renders inline
vi.mock('react-dom', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-dom')>();
    return { ...actual, createPortal: (children: React.ReactNode) => children };
});

// Stub useBreakpoint used by Dialog
vi.mock('../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false }),
}));

describe('RenameDialog', () => {
    let onConfirm: ReturnType<typeof vi.fn>;
    let onCancel: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        onConfirm = vi.fn();
        onCancel = vi.fn();
    });

    // ── Rendering ──────────────────────────────────────────────────────

    it('renders nothing when open=false', () => {
        const { container } = render(
            <RenameDialog open={false} currentTitle="Old" onConfirm={onConfirm} onCancel={onCancel} />
        );
        expect(container.innerHTML).toBe('');
    });

    it('renders dialog with title "Rename Chat" when open', () => {
        render(
            <RenameDialog open={true} currentTitle="My Chat" onConfirm={onConfirm} onCancel={onCancel} />
        );
        expect(screen.getByText('Rename Chat')).toBeTruthy();
    });

    it('pre-fills input with currentTitle', () => {
        render(
            <RenameDialog open={true} currentTitle="Existing Title" onConfirm={onConfirm} onCancel={onCancel} />
        );
        const input = screen.getByPlaceholderText('Chat title') as HTMLInputElement;
        expect(input.value).toBe('Existing Title');
    });

    it('renders Cancel and Rename buttons', () => {
        render(
            <RenameDialog open={true} currentTitle="X" onConfirm={onConfirm} onCancel={onCancel} />
        );
        expect(screen.getByText('Cancel')).toBeTruthy();
        expect(screen.getByText('Rename')).toBeTruthy();
    });

    // ── Confirm ────────────────────────────────────────────────────────

    it('calls onConfirm with trimmed title on Rename click', () => {
        render(
            <RenameDialog open={true} currentTitle="" onConfirm={onConfirm} onCancel={onCancel} />
        );
        const input = screen.getByPlaceholderText('Chat title') as HTMLInputElement;
        fireEvent.change(input, { target: { value: '  New Title  ' } });
        fireEvent.click(screen.getByText('Rename'));
        expect(onConfirm).toHaveBeenCalledWith('New Title');
    });

    it('calls onConfirm when Enter key is pressed in input', () => {
        render(
            <RenameDialog open={true} currentTitle="Orig" onConfirm={onConfirm} onCancel={onCancel} />
        );
        const input = screen.getByPlaceholderText('Chat title') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'Updated' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(onConfirm).toHaveBeenCalledWith('Updated');
    });

    // ── Cancel ─────────────────────────────────────────────────────────

    it('calls onCancel when Cancel button is clicked', () => {
        render(
            <RenameDialog open={true} currentTitle="X" onConfirm={onConfirm} onCancel={onCancel} />
        );
        fireEvent.click(screen.getByText('Cancel'));
        expect(onCancel).toHaveBeenCalled();
    });

    // ── Validation ─────────────────────────────────────────────────────

    it('shows error and does NOT call onConfirm when title is empty', () => {
        render(
            <RenameDialog open={true} currentTitle="" onConfirm={onConfirm} onCancel={onCancel} />
        );
        fireEvent.click(screen.getByText('Rename'));
        expect(screen.getByText('Title is required')).toBeTruthy();
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it('shows error and does NOT call onConfirm when title is only whitespace', () => {
        render(
            <RenameDialog open={true} currentTitle="" onConfirm={onConfirm} onCancel={onCancel} />
        );
        const input = screen.getByPlaceholderText('Chat title') as HTMLInputElement;
        fireEvent.change(input, { target: { value: '   ' } });
        fireEvent.click(screen.getByText('Rename'));
        expect(screen.getByText('Title is required')).toBeTruthy();
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it('shows error when title exceeds 80 characters', () => {
        render(
            <RenameDialog open={true} currentTitle="" onConfirm={onConfirm} onCancel={onCancel} />
        );
        const input = screen.getByPlaceholderText('Chat title') as HTMLInputElement;
        // Note: The <input maxLength=80> prevents typing beyond 80, but
        // handleConfirm still validates against trimmed length. We simulate
        // a value that would bypass the HTML maxLength (e.g. programmatic set).
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'a'.repeat(81));
        fireEvent.change(input, { target: { value: 'a'.repeat(81) } });
        fireEvent.click(screen.getByText('Rename'));
        expect(screen.getByText('Title must be 80 characters or less')).toBeTruthy();
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it('clears error when user types after validation failure', () => {
        render(
            <RenameDialog open={true} currentTitle="" onConfirm={onConfirm} onCancel={onCancel} />
        );
        fireEvent.click(screen.getByText('Rename')); // triggers empty error
        expect(screen.getByText('Title is required')).toBeTruthy();

        const input = screen.getByPlaceholderText('Chat title') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'x' } });
        expect(screen.queryByText('Title is required')).toBeNull();
    });

    // ── Re-open resets state ───────────────────────────────────────────

    it('resets input to new currentTitle when dialog re-opens', () => {
        const { rerender } = render(
            <RenameDialog open={true} currentTitle="First" onConfirm={onConfirm} onCancel={onCancel} />
        );
        const input = screen.getByPlaceholderText('Chat title') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'Modified' } });
        expect(input.value).toBe('Modified');

        // Close then reopen with a different title
        rerender(<RenameDialog open={false} currentTitle="First" onConfirm={onConfirm} onCancel={onCancel} />);
        rerender(<RenameDialog open={true} currentTitle="Second" onConfirm={onConfirm} onCancel={onCancel} />);

        const reopened = screen.getByPlaceholderText('Chat title') as HTMLInputElement;
        expect(reopened.value).toBe('Second');
    });
});
