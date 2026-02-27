/**
 * Tests for FileMoveDialog — props-only component, no context providers needed.
 * Follows patterns established in FolderMoveDialog.test.tsx.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { FileMoveDialog, type FileMoveDialogProps } from '../../../src/server/spa/client/react/tasks/FileMoveDialog';
import type { TaskFolder } from '../../../src/server/spa/client/react/hooks/useTaskTree';

// ── Fixtures ───────────────────────────────────────────────────────────

function makeTree(): TaskFolder {
    return {
        name: 'tasks',
        relativePath: '',
        children: [
            {
                name: 'feature1',
                relativePath: 'feature1',
                children: [
                    {
                        name: 'backlog',
                        relativePath: 'feature1/backlog',
                        children: [],
                        documentGroups: [],
                        singleDocuments: [],
                    },
                ],
                documentGroups: [],
                singleDocuments: [],
            },
            {
                name: 'feature2',
                relativePath: 'feature2',
                children: [],
                documentGroups: [],
                singleDocuments: [],
            },
        ],
        documentGroups: [],
        singleDocuments: [],
    };
}

function renderDialog(overrides: Partial<FileMoveDialogProps> = {}) {
    const defaults: FileMoveDialogProps = {
        open: true,
        onClose: vi.fn(),
        sourceName: 'task.md',
        tree: makeTree(),
        onConfirm: vi.fn<[string], Promise<void>>().mockResolvedValue(undefined),
    };
    const props = { ...defaults, ...overrides };
    return { ...render(<FileMoveDialog {...props} />), props };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('FileMoveDialog — visibility', () => {
    afterEach(() => cleanup());

    it('renders dialog when open=true and sourceName is provided', () => {
        renderDialog();
        expect(screen.getByText('Move File')).toBeTruthy();
        expect(screen.getByText(/task\.md/)).toBeTruthy();
    });

    it('does not render when open=false', () => {
        renderDialog({ open: false });
        expect(screen.queryByText('Move File')).toBeNull();
    });

    it('does not render when sourceName is null', () => {
        renderDialog({ sourceName: null });
        expect(screen.queryByText('Move File')).toBeNull();
    });
});

describe('FileMoveDialog — destination list', () => {
    afterEach(() => cleanup());

    it('renders "Tasks Root" as first destination option', () => {
        renderDialog();
        const root = screen.getByTestId('file-move-dest-root');
        expect(root).toBeTruthy();
        expect(root.textContent).toContain('Tasks Root');
    });

    it('renders folder destinations from tree prop', () => {
        renderDialog();
        expect(screen.getByTestId('file-move-dest-feature1')).toBeTruthy();
        expect(screen.getByTestId('file-move-dest-feature1/backlog')).toBeTruthy();
        expect(screen.getByTestId('file-move-dest-feature2')).toBeTruthy();
    });

    it('renders nested folders with correct depth indentation', () => {
        renderDialog();
        const feature1 = screen.getByTestId('file-move-dest-feature1');
        const backlog = screen.getByTestId('file-move-dest-feature1/backlog');
        // depth=0 → 0.75rem + 0rem
        expect(feature1.style.paddingLeft).toContain('0.75rem');
        // depth=1 → 0.75rem + 1rem
        expect(backlog.style.paddingLeft).toContain('1.75rem');
    });
});

describe('FileMoveDialog — selection and confirm', () => {
    afterEach(() => cleanup());

    it('default selection is Tasks Root (empty string) — confirm sends ""', async () => {
        const onConfirm = vi.fn<[string], Promise<void>>().mockResolvedValue(undefined);
        renderDialog({ onConfirm });
        fireEvent.click(screen.getByText('Move'));
        await waitFor(() => {
            expect(onConfirm).toHaveBeenCalledWith('');
        });
    });

    it('clicking a folder destination selects it (visual highlight)', () => {
        renderDialog();
        const feature2 = screen.getByTestId('file-move-dest-feature2');
        fireEvent.click(feature2);
        // Selected item gets the highlight class
        expect(feature2.className).toContain('bg-[#0066b8]/10');
    });

    it('confirm calls onConfirm with the selected relativePath', async () => {
        const onConfirm = vi.fn<[string], Promise<void>>().mockResolvedValue(undefined);
        renderDialog({ onConfirm });
        fireEvent.click(screen.getByTestId('file-move-dest-feature2'));
        fireEvent.click(screen.getByText('Move'));
        await waitFor(() => {
            expect(onConfirm).toHaveBeenCalledWith('feature2');
        });
    });

    it('Move button shows loading state while onConfirm is pending', async () => {
        let resolveConfirm: () => void;
        const onConfirm = vi.fn<[string], Promise<void>>().mockImplementation(
            () => new Promise<void>((resolve) => { resolveConfirm = resolve; }),
        );
        renderDialog({ onConfirm });
        fireEvent.click(screen.getByText('Move'));

        // Button should be disabled while pending
        await waitFor(() => {
            const moveButton = screen.getByText('Move').closest('button')!;
            expect(moveButton.disabled).toBe(true);
        });

        // Resolve and clean up
        resolveConfirm!();
    });
});

describe('FileMoveDialog — cancel and Escape', () => {
    afterEach(() => cleanup());

    it('clicking Cancel calls onClose without calling onConfirm', () => {
        const onClose = vi.fn();
        const onConfirm = vi.fn();
        renderDialog({ onClose, onConfirm });
        fireEvent.click(screen.getByText('Cancel'));
        expect(onClose).toHaveBeenCalled();
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it('pressing Escape calls onClose', () => {
        const onClose = vi.fn();
        renderDialog({ onClose });
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalled();
    });
});

describe('FileMoveDialog — error handling', () => {
    afterEach(() => cleanup());

    it('displays error message when onConfirm rejects', async () => {
        const onConfirm = vi.fn<[string], Promise<void>>().mockRejectedValue(new Error('Server error'));
        renderDialog({ onConfirm });
        fireEvent.click(screen.getByText('Move'));
        await waitFor(() => {
            const errorEl = screen.getByTestId('file-move-error');
            expect(errorEl).toBeTruthy();
            expect(errorEl.textContent).toBe('Server error');
        });
    });

    it('error clears when selecting a new destination', async () => {
        const onConfirm = vi.fn<[string], Promise<void>>().mockRejectedValue(new Error('Oops'));
        renderDialog({ onConfirm });

        // Trigger error
        fireEvent.click(screen.getByText('Move'));
        await waitFor(() => {
            expect(screen.getByTestId('file-move-error')).toBeTruthy();
        });

        // Click a destination to clear the error
        fireEvent.click(screen.getByTestId('file-move-dest-feature1'));
        expect(screen.queryByTestId('file-move-error')).toBeNull();
    });
});
