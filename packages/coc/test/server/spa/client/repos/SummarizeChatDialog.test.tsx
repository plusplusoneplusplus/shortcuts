/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks – declared before component import
// ---------------------------------------------------------------------------

vi.mock('../../../../../src/server/spa/client/react/shared/Dialog', () => ({
    Dialog: ({ open, children, footer, title, onClose }: any) =>
        open ? (
            <div data-testid="dialog">
                <span data-testid="dialog-title">{title}</span>
                <div data-testid="dialog-body">{children}</div>
                <div data-testid="dialog-footer">{footer}</div>
            </div>
        ) : null,
}));

vi.mock('../../../../../src/server/spa/client/react/shared', () => ({
    Button: ({ onClick, disabled, children, variant, ...rest }: any) => (
        <button
            onClick={onClick}
            disabled={disabled}
            data-variant={variant}
            data-testid={rest['data-testid']}
        >
            {children}
        </button>
    ),
}));

import { SummarizeChatDialog } from '../../../../../src/server/spa/client/react/features/chat/SummarizeChatDialog';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const noop = () => {};

interface RenderOpts {
    open?: boolean;
    chatCount?: number;
    onClose?: () => void;
    onConfirm?: (userPrompt: string) => Promise<void>;
}

function renderDialog(opts: RenderOpts = {}) {
    const {
        open = true,
        chatCount = 3,
        onClose = noop,
        onConfirm = vi.fn().mockResolvedValue(undefined),
    } = opts;
    return render(
        <SummarizeChatDialog
            open={open}
            chatCount={chatCount}
            onClose={onClose}
            onConfirm={onConfirm}
        />,
    );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SummarizeChatDialog', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    // -- Rendering ----------------------------------------------------------

    it('does not render when open is false', () => {
        renderDialog({ open: false });
        expect(screen.queryByTestId('dialog')).toBeNull();
    });

    it('renders dialog with title "Summarize chats"', () => {
        renderDialog();
        expect(screen.getByTestId('dialog-title').textContent).toBe('Summarize chats');
    });

    it('shows singular subtitle for chatCount=1', () => {
        renderDialog({ chatCount: 1 });
        expect(screen.getByText('Summarizing 1 conversation')).toBeTruthy();
    });

    it('shows plural subtitle for chatCount > 1', () => {
        renderDialog({ chatCount: 5 });
        expect(screen.getByText('Summarizing 5 conversations')).toBeTruthy();
    });

    it('renders a textarea with placeholder text', () => {
        renderDialog();
        const textarea = screen.getByPlaceholderText(
            'Optional: add a question or focus area for the summary…',
        );
        expect(textarea).toBeTruthy();
    });

    it('renders Cancel and Summarize buttons', () => {
        renderDialog();
        expect(screen.getByText('Cancel')).toBeTruthy();
        expect(screen.getByText('Summarize')).toBeTruthy();
    });

    // -- Submit / onConfirm -------------------------------------------------

    it('calls onConfirm with trimmed user prompt on Summarize click', async () => {
        const onConfirm = vi.fn().mockResolvedValue(undefined);
        renderDialog({ onConfirm });

        const textarea = screen.getByPlaceholderText(/optional/i);
        fireEvent.change(textarea, { target: { value: '  focus on auth  ' } });

        await act(async () => {
            fireEvent.click(screen.getByText('Summarize'));
        });

        expect(onConfirm).toHaveBeenCalledWith('focus on auth');
    });

    it('shows loading state during onConfirm execution', async () => {
        let resolveConfirm!: () => void;
        const onConfirm = vi.fn(
            () => new Promise<void>((resolve) => { resolveConfirm = resolve; }),
        );
        renderDialog({ onConfirm });

        await act(async () => {
            fireEvent.click(screen.getByText('Summarize'));
        });

        // During loading, button text changes
        expect(screen.getByText('Summarizing…')).toBeTruthy();
        expect(screen.queryByText('Summarize')).toBeNull();

        // Buttons and textarea are disabled
        const buttons = screen.getAllByRole('button');
        for (const btn of buttons) {
            expect(btn).toBeDisabled();
        }
        const textarea = screen.getByPlaceholderText(/optional/i);
        expect(textarea).toBeDisabled();

        // Resolve to clean up
        await act(async () => { resolveConfirm(); });
    });

    it('clears loading state after successful onConfirm', async () => {
        const onConfirm = vi.fn().mockResolvedValue(undefined);
        renderDialog({ onConfirm });

        await act(async () => {
            fireEvent.click(screen.getByText('Summarize'));
        });

        expect(screen.getByText('Summarize')).toBeTruthy();
        expect(screen.queryByText('Summarizing…')).toBeNull();
    });

    // -- Error handling -----------------------------------------------------

    it('displays error message when onConfirm rejects with Error', async () => {
        const onConfirm = vi.fn().mockRejectedValue(new Error('Network failure'));
        renderDialog({ onConfirm });

        await act(async () => {
            fireEvent.click(screen.getByText('Summarize'));
        });

        expect(screen.getByText('Network failure')).toBeTruthy();
    });

    it('displays generic error for non-Error rejection', async () => {
        const onConfirm = vi.fn().mockRejectedValue('string error');
        renderDialog({ onConfirm });

        await act(async () => {
            fireEvent.click(screen.getByText('Summarize'));
        });

        expect(screen.getByText('Failed to summarize')).toBeTruthy();
    });

    it('clears previous error on new submit attempt', async () => {
        const onConfirm = vi.fn()
            .mockRejectedValueOnce(new Error('First error'))
            .mockResolvedValueOnce(undefined);
        renderDialog({ onConfirm });

        // First attempt — error appears
        await act(async () => {
            fireEvent.click(screen.getByText('Summarize'));
        });
        expect(screen.getByText('First error')).toBeTruthy();

        // Second attempt — error is cleared
        await act(async () => {
            fireEvent.click(screen.getByText('Summarize'));
        });
        expect(screen.queryByText('First error')).toBeNull();
    });

    // -- Cancel -------------------------------------------------------------

    it('calls onClose on Cancel click without calling onConfirm', () => {
        const onClose = vi.fn();
        const onConfirm = vi.fn().mockResolvedValue(undefined);
        renderDialog({ onClose, onConfirm });

        fireEvent.click(screen.getByText('Cancel'));

        expect(onClose).toHaveBeenCalledTimes(1);
        expect(onConfirm).not.toHaveBeenCalled();
    });

    // -- Keyboard shortcut --------------------------------------------------

    it('triggers confirm on Ctrl+Enter', async () => {
        const onConfirm = vi.fn().mockResolvedValue(undefined);
        renderDialog({ onConfirm });

        const textarea = screen.getByPlaceholderText(/optional/i);

        await act(async () => {
            fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
        });

        expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('triggers confirm on Meta+Enter', async () => {
        const onConfirm = vi.fn().mockResolvedValue(undefined);
        renderDialog({ onConfirm });

        const textarea = screen.getByPlaceholderText(/optional/i);

        await act(async () => {
            fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });
        });

        expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('does not trigger confirm on plain Enter', async () => {
        const onConfirm = vi.fn().mockResolvedValue(undefined);
        renderDialog({ onConfirm });

        const textarea = screen.getByPlaceholderText(/optional/i);

        await act(async () => {
            fireEvent.keyDown(textarea, { key: 'Enter' });
        });

        expect(onConfirm).not.toHaveBeenCalled();
    });

    // -- State reset on re-open ---------------------------------------------

    it('resets user prompt and error when dialog re-opens', async () => {
        const onConfirm = vi.fn().mockRejectedValue(new Error('Oops'));
        const { rerender } = render(
            <SummarizeChatDialog open={true} chatCount={2} onClose={noop} onConfirm={onConfirm} />,
        );

        // Type into textarea and trigger an error
        const textarea = screen.getByPlaceholderText(/optional/i);
        fireEvent.change(textarea, { target: { value: 'some text' } });
        await act(async () => {
            fireEvent.click(screen.getByText('Summarize'));
        });
        expect(screen.getByText('Oops')).toBeTruthy();

        // Close
        rerender(
            <SummarizeChatDialog open={false} chatCount={2} onClose={noop} onConfirm={onConfirm} />,
        );

        // Re-open
        rerender(
            <SummarizeChatDialog open={true} chatCount={2} onClose={noop} onConfirm={onConfirm} />,
        );

        // Error should be gone and textarea should be empty
        expect(screen.queryByText('Oops')).toBeNull();
        const freshTextarea = screen.getByPlaceholderText(/optional/i) as HTMLTextAreaElement;
        expect(freshTextarea.value).toBe('');
    });
});
