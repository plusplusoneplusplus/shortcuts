/**
 * Tests for MinimizedDialogsContext — centralized manager for minimized dialog pills.
 */
/* @vitest-environment jsdom */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { useState } from 'react';
import {
    MinimizedDialogsProvider,
    MinimizedDialogsTray,
    useMinimizedDialog,
    type MinimizedDialogEntry,
} from '../../../src/server/spa/client/react/context/MinimizedDialogsContext';

afterEach(cleanup);

// ── helpers ─────────────────────────────────────────────────────────────────

/** Minimal component that registers a minimized dialog entry via the hook. */
function TestDialog({
    entry,
}: {
    entry: MinimizedDialogEntry | null;
}) {
    useMinimizedDialog(entry);
    return null;
}

/** Wrapper that toggles a dialog between minimized and not. */
function ToggleableDialog({
    id,
    icon,
    label,
    preview,
    onRestore,
    onClose,
    startMinimized = false,
}: {
    id: string;
    icon: string;
    label: string;
    preview?: string;
    onRestore: () => void;
    onClose?: () => void;
    startMinimized?: boolean;
}) {
    const [minimized, setMinimized] = useState(startMinimized);
    useMinimizedDialog(
        minimized
            ? { id, icon, label, preview, onRestore, onClose }
            : null,
    );
    return (
        <button
            data-testid={`toggle-${id}`}
            onClick={() => setMinimized(prev => !prev)}
        >
            Toggle {id}
        </button>
    );
}

function renderWithProvider(ui: React.ReactElement) {
    return render(
        <MinimizedDialogsProvider>
            {ui}
            <MinimizedDialogsTray />
        </MinimizedDialogsProvider>,
    );
}

// ── tests ───────────────────────────────────────────────────────────────────

describe('MinimizedDialogsContext', () => {
    // ── tray rendering ──────────────────────────────────────────────────

    it('tray is hidden when no dialogs are minimized', () => {
        renderWithProvider(<TestDialog entry={null} />);
        expect(document.querySelector('[data-testid="minimized-dialogs-tray"]')).toBeNull();
    });

    it('tray appears when a dialog is minimized', () => {
        renderWithProvider(
            <TestDialog
                entry={{ id: 'a', icon: '✨', label: 'Dialog A', onRestore: vi.fn() }}
            />,
        );
        const tray = document.querySelector('[data-testid="minimized-dialogs-tray"]');
        expect(tray).not.toBeNull();
        expect(tray!.textContent).toContain('Dialog A');
    });

    it('renders pill with correct test id for each dialog', () => {
        renderWithProvider(
            <TestDialog
                entry={{ id: 'my-dialog', icon: '📄', label: 'My Dialog', onRestore: vi.fn() }}
            />,
        );
        expect(document.querySelector('[data-testid="minimized-pill-my-dialog"]')).not.toBeNull();
    });

    // ── multiple dialogs stack ──────────────────────────────────────────

    it('renders multiple minimized dialogs without overlapping', () => {
        renderWithProvider(
            <>
                <TestDialog entry={{ id: 'a', icon: '✨', label: 'Dialog A', onRestore: vi.fn() }} />
                <TestDialog entry={{ id: 'b', icon: '💬', label: 'Dialog B', onRestore: vi.fn() }} />
            </>,
        );

        const pillA = document.querySelector('[data-testid="minimized-pill-a"]');
        const pillB = document.querySelector('[data-testid="minimized-pill-b"]');
        expect(pillA).not.toBeNull();
        expect(pillB).not.toBeNull();

        // Both should be inside the same tray container
        const tray = document.querySelector('[data-testid="minimized-dialogs-tray"]');
        expect(tray).not.toBeNull();
        expect(tray!.contains(pillA!)).toBe(true);
        expect(tray!.contains(pillB!)).toBe(true);
    });

    it('renders three minimized dialogs as a list', () => {
        renderWithProvider(
            <>
                <TestDialog entry={{ id: 'x', icon: '✨', label: 'X', onRestore: vi.fn() }} />
                <TestDialog entry={{ id: 'y', icon: '💬', label: 'Y', onRestore: vi.fn() }} />
                <TestDialog entry={{ id: 'z', icon: '📄', label: 'Z', onRestore: vi.fn() }} />
            </>,
        );

        const tray = document.querySelector('[data-testid="minimized-dialogs-tray"]');
        expect(tray!.children.length).toBe(3);
    });

    // ── restore / close interactions ────────────────────────────────────

    it('clicking pill calls onRestore', () => {
        const onRestore = vi.fn();
        renderWithProvider(
            <TestDialog entry={{ id: 'dlg', icon: '✨', label: 'Dlg', onRestore }} />,
        );
        const pill = document.querySelector('[data-testid="minimized-pill-dlg"]')!;
        fireEvent.click(pill);
        expect(onRestore).toHaveBeenCalledOnce();
    });

    it('close button calls onClose without calling onRestore', () => {
        const onRestore = vi.fn();
        const onClose = vi.fn();
        renderWithProvider(
            <TestDialog entry={{ id: 'dlg', icon: '✨', label: 'Dlg', onRestore, onClose }} />,
        );
        const closeBtn = document.querySelector('[data-testid="minimized-pill-dlg"] button[aria-label="Close Dlg"]')!;
        fireEvent.click(closeBtn);
        expect(onClose).toHaveBeenCalledOnce();
        expect(onRestore).not.toHaveBeenCalled();
    });

    it('close button is not rendered when onClose is not provided', () => {
        renderWithProvider(
            <TestDialog entry={{ id: 'dlg', icon: '✨', label: 'Dlg', onRestore: vi.fn() }} />,
        );
        const closeBtn = document.querySelector('[data-testid="minimized-pill-dlg"] button[title="Close"]');
        expect(closeBtn).toBeNull();
    });

    // ── toggle behavior ─────────────────────────────────────────────────

    it('pill disappears when dialog is un-minimized', () => {
        renderWithProvider(
            <ToggleableDialog
                id="toggle-test"
                icon="✨"
                label="Toggle"
                onRestore={vi.fn()}
                startMinimized={true}
            />,
        );

        expect(document.querySelector('[data-testid="minimized-pill-toggle-test"]')).not.toBeNull();

        // Un-minimize
        fireEvent.click(document.querySelector('[data-testid="toggle-toggle-test"]')!);
        expect(document.querySelector('[data-testid="minimized-pill-toggle-test"]')).toBeNull();
    });

    it('pill appears when dialog is minimized after being open', () => {
        renderWithProvider(
            <ToggleableDialog
                id="late-min"
                icon="💬"
                label="Late"
                onRestore={vi.fn()}
                startMinimized={false}
            />,
        );

        expect(document.querySelector('[data-testid="minimized-pill-late-min"]')).toBeNull();

        // Minimize
        fireEvent.click(document.querySelector('[data-testid="toggle-late-min"]')!);
        expect(document.querySelector('[data-testid="minimized-pill-late-min"]')).not.toBeNull();
    });

    // ── content rendering ───────────────────────────────────────────────

    it('pill shows icon and label', () => {
        renderWithProvider(
            <TestDialog entry={{ id: 'x', icon: '🔥', label: 'Hot Dialog', onRestore: vi.fn() }} />,
        );
        const pill = document.querySelector('[data-testid="minimized-pill-x"]')!;
        expect(pill.textContent).toContain('🔥');
        expect(pill.textContent).toContain('Hot Dialog');
    });

    it('pill shows preview text when provided', () => {
        renderWithProvider(
            <TestDialog
                entry={{ id: 'x', icon: '✨', label: 'X', preview: 'Build an API', onRestore: vi.fn() }}
            />,
        );
        const pill = document.querySelector('[data-testid="minimized-pill-x"]')!;
        expect(pill.textContent).toContain('Build an API');
    });

    it('pill does not show preview when not provided', () => {
        renderWithProvider(
            <TestDialog entry={{ id: 'x', icon: '✨', label: 'X', onRestore: vi.fn() }} />,
        );
        const pill = document.querySelector('[data-testid="minimized-pill-x"]')!;
        expect(pill.textContent).not.toContain('▪');
    });

    it('pill shows Restore button', () => {
        renderWithProvider(
            <TestDialog entry={{ id: 'x', icon: '✨', label: 'X', onRestore: vi.fn() }} />,
        );
        const pill = document.querySelector('[data-testid="minimized-pill-x"]')!;
        expect(pill.textContent).toContain('Restore');
    });

    it('pill renders extra ReactNode when provided', () => {
        const SpinnerStub = () => <span data-testid="spinner-stub">⏳</span>;
        renderWithProvider(
            <TestDialog
                entry={{
                    id: 'x',
                    icon: '💬',
                    label: 'Chat',
                    onRestore: vi.fn(),
                    extra: <SpinnerStub />,
                }}
            />,
        );
        expect(document.querySelector('[data-testid="spinner-stub"]')).not.toBeNull();
    });

    // ── tray positioning ────────────────────────────────────────────────

    it('tray is rendered as a portal into document.body', () => {
        renderWithProvider(
            <TestDialog entry={{ id: 'x', icon: '✨', label: 'X', onRestore: vi.fn() }} />,
        );
        const tray = document.querySelector('[data-testid="minimized-dialogs-tray"]');
        expect(tray?.parentElement).toBe(document.body);
    });

    it('tray has fixed positioning and flex-col-reverse for bottom-up stacking', () => {
        renderWithProvider(
            <TestDialog entry={{ id: 'x', icon: '✨', label: 'X', onRestore: vi.fn() }} />,
        );
        const tray = document.querySelector('[data-testid="minimized-dialogs-tray"]') as HTMLElement;
        expect(tray.className).toContain('fixed');
        expect(tray.className).toContain('right-4');
        expect(tray.className).toContain('flex-col-reverse');
    });

    // ── unregister on unmount ───────────────────────────────────────────

    it('cleans up entry when component unmounts', () => {
        function Wrapper({ showDialog }: { showDialog: boolean }) {
            return (
                <MinimizedDialogsProvider>
                    {showDialog && (
                        <TestDialog entry={{ id: 'unmount-test', icon: '✨', label: 'Bye', onRestore: vi.fn() }} />
                    )}
                    <MinimizedDialogsTray />
                </MinimizedDialogsProvider>
            );
        }

        const { rerender } = render(<Wrapper showDialog={true} />);
        expect(document.querySelector('[data-testid="minimized-pill-unmount-test"]')).not.toBeNull();

        rerender(<Wrapper showDialog={false} />);
        expect(document.querySelector('[data-testid="minimized-pill-unmount-test"]')).toBeNull();
    });

    // ── entry updates ───────────────────────────────────────────────────

    it('updates entry content when props change', () => {
        function DynamicDialog() {
            const [label, setLabel] = useState('Initial');
            useMinimizedDialog({ id: 'dyn', icon: '✨', label, onRestore: vi.fn() });
            return <button data-testid="change-label" onClick={() => setLabel('Updated')}>Change</button>;
        }

        renderWithProvider(<DynamicDialog />);
        const pill = document.querySelector('[data-testid="minimized-pill-dyn"]')!;
        expect(pill.textContent).toContain('Initial');

        fireEvent.click(document.querySelector('[data-testid="change-label"]')!);
        const updatedPill = document.querySelector('[data-testid="minimized-pill-dyn"]')!;
        expect(updatedPill.textContent).toContain('Updated');
    });
});
